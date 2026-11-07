import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { Accounts } from '../manager/accounts.js';
const ROOT='/opt/dafeiyu',TARGET='/data/yutori',BACKUP=ROOT+'/backups/multiuser-20261027';
if(process.getuid()!==0)throw Error('Migration requires root');
if(fs.existsSync('/data/.platform/migration-complete.json')||fs.existsSync(ROOT+'/data/.platform/migration-complete.json'))throw Error('Migration already completed; do not overwrite current data');
if(fs.existsSync('/data')&&fs.readdirSync('/data').some(name=>!['yutori','.platform'].includes(name)))throw Error('Unexpected /data entries; inspect before migration');
const env=parseEnv(fs.readFileSync(ROOT+'/.env','utf8'));
const reference=JSON.parse(fs.readFileSync(ROOT+'/data/avatar-reference.json','utf8'));
const qq=String(reference.owner);if(!/^\d{5,15}$/.test(qq)||!env.DEEPSEEK_API_KEY||!env.NAPCAT_TOKEN)throw Error('Missing original account data');
if(fs.existsSync(TARGET)&&fs.readdirSync(TARGET).length)throw Error('Target is not empty; preserve it and inspect before retry');
fs.mkdirSync(BACKUP,{recursive:true,mode:0o700});
execFileSync('systemctl',['stop','dafeiyu.service']);
execFileSync('docker',['stop','-t','60','dafeiyu-napcat'],{stdio:'ignore'});
let success=false;
try{
 execFileSync('tar',['-czf',BACKUP+'/final-data-snapshot.tar.gz','-C',ROOT,'data','harness-runtime/home','napcat','config.json','persona.md','.env']);
 fs.mkdirSync(TARGET,{recursive:true,mode:0o700});
 const hashes=[];
 function manifest(directory,prefix=''){for(const row of fs.readdirSync(directory,{withFileTypes:true})){const file=path.join(directory,row.name),key=path.join(prefix,row.name);if(row.isDirectory())manifest(file,key);else if(row.isFile())hashes.push({path:key,sha256:createHash('sha256').update(fs.readFileSync(file)).digest('hex')});}}
 manifest(ROOT+'/data');const dataFiles=hashes.length;
 fs.cpSync(ROOT+'/data',TARGET,{recursive:true,preserveTimestamps:true});
 fs.cpSync(ROOT+'/napcat',TARGET+'/napcat',{recursive:true,preserveTimestamps:true});
 fs.cpSync(ROOT+'/harness-runtime/home',TARGET+'/harness-home',{recursive:true,preserveTimestamps:true});
 for(const file of['config.json','persona.md'])fs.copyFileSync(ROOT+'/'+file,TARGET+'/'+file);
 let matched=0;for(const entry of hashes){const file=path.join(TARGET,entry.path);if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256)throw Error('Data verification failed: '+entry.path);matched++;}
 const extra=[];for(const[src,dest]of[[ROOT+'/napcat',TARGET+'/napcat'],[ROOT+'/harness-runtime/home',TARGET+'/harness-home']]){
  const begin=hashes.length;manifest(src);for(const item of hashes.splice(begin)){if(createHash('sha256').update(fs.readFileSync(path.join(dest,item.path))).digest('hex')!==item.sha256)throw Error('Account data verification failed');extra.push(item);}
 }
 fs.mkdirSync(ROOT+'/assets',{recursive:true});if(!fs.existsSync(ROOT+'/assets/tts'))fs.cpSync(ROOT+'/data/tts',ROOT+'/assets/tts',{recursive:true,preserveTimestamps:true});
 const accounts=new Accounts('/data/.platform');
 accounts.db.prepare('INSERT INTO users(username,role,created) VALUES (?,?,?)').run('yutori','admin',Date.now());
 const access=JSON.parse(fs.readFileSync(ROOT+'/deploy/server-access.json','utf8'));
 const authFile=TARGET+'/bilibili-auth.json';const secrets={apiKey:env.DEEPSEEK_API_KEY,napcatToken:env.NAPCAT_TOKEN,webuiToken:access.napcatToken,model:env.DEEPSEEK_MODEL||'deepseek-flash',baseUrl:env.DEEPSEEK_BASE_URL||'https://api.deepseek.com',biliCookie:env.BILIBILI_COOKIE||(fs.existsSync(authFile)?JSON.parse(fs.readFileSync(authFile,'utf8')).cookie:'')||'',legacyEnv:env};
 accounts.db.prepare('INSERT INTO bots(username,qq,secrets,created) VALUES (?,?,?,?)').run('yutori',qq,accounts.encrypt(secrets,'yutori'),Date.now());
 const activation=accounts.activation('yutori');accounts.audit('yutori','migration');accounts.close();
 fs.writeFileSync('/data/.platform/bootstrap-link.txt','http://192.168.1.149:3081/activate#'+activation+'\n',{mode:0o600});
 const state=JSON.parse(fs.readFileSync(TARGET+'/state.json','utf8'));
 const result={time:new Date().toISOString(),username:'yutori',sourceDataFiles:dataFiles,matchedDataFiles:matched,accountFiles:extra.length,users:Object.keys(state.feelings?.users||{}).length,sourceStateHash:createHash('sha256').update(fs.readFileSync(ROOT+'/data/state.json')).digest('hex'),targetStateHash:createHash('sha256').update(fs.readFileSync(TARGET+'/state.json')).digest('hex')};
 fs.writeFileSync(BACKUP+'/migration-verification.json',JSON.stringify(result,null,2),{mode:0o600});
 fs.writeFileSync(BACKUP+'/data-manifest.json',JSON.stringify(hashes),{mode:0o600});
 fs.writeFileSync('/data/.platform/migration-complete.json',JSON.stringify(result,null,2),{mode:0o600});
 execFileSync('chown',['-R','993:978','/data/yutori','/data/.platform']);fs.chmodSync('/data',0o711);fs.chmodSync('/data/.platform',0o700);fs.chmodSync(TARGET,0o700);
 execFileSync('systemctl',['disable','dafeiyu.service'],{stdio:'ignore'});
 success=true;console.log(JSON.stringify(result));
}finally{if(!success){console.error('Migration interrupted; original data remains at /opt/dafeiyu. Restarting original service only.');execFileSync('docker',['start','dafeiyu-napcat'],{stdio:'ignore'});execFileSync('systemctl',['start','dafeiyu.service']);}}
