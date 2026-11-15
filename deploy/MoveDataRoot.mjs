import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DatabaseSync} from 'node:sqlite';
const exec=promisify(execFile),ROOT='/opt/dafeiyu',OLD='/data',TARGET=ROOT+'/data',BACKUP=ROOT+'/backups/data-root-20261027';
const files=['manager/server.js','manager/tenants.js','deploy/tenant-helper.mjs','deploy/dafeiyu-manager.service','deploy/dafeiyu-runtime.service','deploy/CheckMultiUser.mjs','deploy/CheckPublicUI.mjs','deploy/MigrateMultiUser.mjs','src/main.js','docs/archive/MULTIUSER.md'];
const sha=file=>new Promise((resolve,reject)=>{const digest=createHash('sha256'),stream=fs.createReadStream(file);stream.on('data',chunk=>digest.update(chunk));stream.on('error',reject);stream.on('end',()=>resolve(digest.digest('hex')));});
const command=async(program,args,options={})=>(await exec(program,args,{timeout:180000,maxBuffer:2*1024*1024,...options})).stdout;
const journal={phase:'preflight',source:OLD,target:TARGET,startedAt:new Date().toISOString()};
function record(phase,extra={}){Object.assign(journal,extra,{phase});fs.writeFileSync(BACKUP+'/journal.json',JSON.stringify(journal,null,2),{mode:0o600});console.log(JSON.stringify({phase,...extra}));}
async function manifest(root){const entries=[];async function visit(directory,relative=''){for(const row of fs.readdirSync(directory,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const rel=path.join(relative,row.name),file=path.join(directory,row.name),stat=fs.lstatSync(file);if(row.isSymbolicLink())entries.push({path:rel,type:'symlink',target:fs.readlinkSync(file)});else if(row.isDirectory()){entries.push({path:rel,type:'directory',mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid});await visit(file,rel);}else if(row.isFile())entries.push({path:rel,type:'file',size:stat.size,mode:stat.mode&0o777,uid:stat.uid,gid:stat.gid,sha256:await sha(file)});else entries.push({path:rel,type:'special',mode:stat.mode});}}await visit(root);return entries;}
function edit(relative,transform){const file=ROOT+'/'+relative;fs.writeFileSync(file,transform(fs.readFileSync(file,'utf8')));}
function assertPath(value,expected){if(path.resolve(value)!==expected||fs.realpathSync(value)!==expected)throw Error('Unexpected resolved migration path: '+expected);}
if(process.getuid()!==0)throw Error('Run as root');
assertPath(ROOT,ROOT);assertPath(OLD,OLD);assertPath(TARGET,TARGET);
if(!fs.existsSync(OLD+'/.platform/master.key')||!fs.existsSync(OLD+'/.platform/accounts.sqlite'))throw Error('Source credentials are missing');
if(fs.existsSync(TARGET+'/.platform'))throw Error('Target already contains platform data; do not overwrite');
if(fs.existsSync(BACKUP))throw Error('Backup directory already exists; inspect previous migration before retrying');
fs.mkdirSync(BACKUP,{mode:0o700});fs.mkdirSync(BACKUP+'/code',{mode:0o700});
for(const relative of files){const file=ROOT+'/'+relative;fs.copyFileSync(file,BACKUP+'/code/'+relative.replaceAll('/','__'));}
for(const unit of ['dafeiyu-manager.service','dafeiyu-runtime.service'])fs.copyFileSync('/etc/systemd/system/'+unit,BACKUP+'/'+unit+'.before');
fs.copyFileSync('/usr/local/lib/dafeiyu-tenant-helper.mjs',BACKUP+'/helper-installed.before.mjs');
try{
 record('stopping-account-service');await command('systemctl',['stop','dafeiyu-manager']);
 const db=new DatabaseSync(OLD+'/.platform/accounts.sqlite',{readOnly:true});
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Source database integrity failed');
 const users=db.prepare('SELECT users.username,users.disabled,bots.desired,bots.billing FROM users JOIN bots USING(username) ORDER BY username').all();
 const counts=Object.fromEntries(['users','bots','sessions','invites','audit','settings'].map(table=>[table,db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n]));db.close();
 const containers=[];for(const user of users){if(!/^[a-z][a-z0-9_]{2,23}$/.test(user.username))throw Error('Invalid stored username');for(const kind of ['agent','qq']){const name=`dfy-${kind}-${user.username}`;let info;try{info=JSON.parse(await command('docker',['inspect',name]))[0];}catch{continue;}if(info.Config.Labels?.['dafeiyu.owner']!==user.username||info.Config.Labels?.['dafeiyu.kind']!==kind)throw Error('Container ownership mismatch');containers.push({name,kind,username:user.username,running:info.State.Running});}}
 fs.writeFileSync(BACKUP+'/runtime-plan.json',JSON.stringify({users,counts,containers},null,2),{mode:0o600});
 record('stopping-agents',{users:users.map(u=>u.username),containers:containers.length});
 for(const container of containers.filter(c=>c.kind==='agent'&&c.running))await command('docker',['stop','-t','90',container.name]);
 record('stopping-qq');for(const container of containers.filter(c=>c.kind==='qq'&&c.running))await command('docker',['stop','-t','60',container.name]);
 await command('systemctl',['stop','dafeiyu-runtime']);
 record('snapshot');await command('tar',['-czf',BACKUP+'/data-before.tar.gz','-C','/','data'],{timeout:300000});
 const before=await manifest(OLD);fs.writeFileSync(BACKUP+'/manifest-before.json',JSON.stringify(before),{mode:0o600});const filesBefore=before.filter(e=>e.type==='file').length;
 record('moving-data',{files:filesBefore});
 assertPath(OLD,OLD);assertPath(TARGET,TARGET);
 fs.renameSync(TARGET,BACKUP+'/legacy-project-data');fs.renameSync(OLD,TARGET);
 const after=await manifest(TARGET);if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Full data manifest or file metadata mismatch after move');
 fs.writeFileSync(BACKUP+'/manifest-after.json',JSON.stringify(after),{mode:0o600});
 const transforms=[];
 for(const user of users){const file=TARGET+'/'+user.username+'/home/.local/share/pki/nssdb/pkcs11.txt';if(fs.existsSync(file)){const text=fs.readFileSync(file,'utf8'),oldPath=OLD+'/'+user.username+'/',newPath=TARGET+'/'+user.username+'/';if(text.includes(oldPath)){const originalHash=await sha(file);fs.copyFileSync(file,BACKUP+'/pkcs11-'+user.username+'.before.txt');fs.writeFileSync(file,text.replaceAll(oldPath,newPath));transforms.push({username:user.username,path:path.relative(TARGET,file),reason:'Browser NSS database directory',before:originalHash,after:await sha(file)});}}}
 record('data-verified',{files:filesBefore,matched:filesBefore,browserPathAdjustments:transforms.length});
 edit('manager/server.js',text=>text.replace("process.env.DAFEIYU_DATA_ROOT||'/data'","process.env.DAFEIYU_DATA_ROOT||path.join(ROOT,'data')"));
 edit('manager/tenants.js',text=>text.replace("dataRoot='/data'","dataRoot=path.join(ROOT,'data')"));
 edit('deploy/tenant-helper.mjs',text=>text.replace("BASE='/data'","BASE='/opt/dafeiyu/data'"));
 edit('src/main.js',text=>text.replace("fs.existsSync('/data/.platform/migration-complete.json')","fs.existsSync(path.join(ROOT, 'data/.platform/migration-complete.json'))"));
 for(const relative of ['deploy/dafeiyu-manager.service','deploy/dafeiyu-runtime.service'])edit(relative,text=>text.replaceAll('=/data','=/opt/dafeiyu/data'));
 for(const relative of ['deploy/CheckMultiUser.mjs','deploy/CheckPublicUI.mjs'])edit(relative,text=>text.replaceAll("'/data/","'/opt/dafeiyu/data/"));
 edit('deploy/MigrateMultiUser.mjs',text=>text.replace("if(fs.existsSync('/data/.platform/migration-complete.json'))","if(fs.existsSync('/data/.platform/migration-complete.json')||fs.existsSync(ROOT+'/data/.platform/migration-complete.json'))"));
 edit('docs/archive/MULTIUSER.md',text=>text.replaceAll('`/data/','`/opt/dafeiyu/data/').replace('旧 `/opt/dafeiyu/data`、QQ缓存和Harness home暂时保留为停止更新的回退副本，不是活跃用户目录。','旧版项目data目录已归档到本次路径迁移备份的legacy-project-data中；当前项目data目录用于多用户活跃数据。'));
 for(const relative of ['deploy/tenant-helper.mjs','manager/server.js','manager/tenants.js','src/main.js'])await command('/usr/local/bin/dafeiyu-node',['--check',ROOT+'/'+relative]);
 for(const unit of ['dafeiyu-manager.service','dafeiyu-runtime.service'])await command('install',['-o','root','-g','root','-m','644',ROOT+'/deploy/'+unit,'/etc/systemd/system/'+unit]);
 await command('install',['-o','root','-g','root','-m','644',ROOT+'/deploy/tenant-helper.mjs','/usr/local/lib/dafeiyu-tenant-helper.mjs']);
 for(const container of containers){const current=JSON.parse(await command('docker',['inspect',container.name]))[0];if(current.Config.Labels?.['dafeiyu.owner']!==container.username)throw Error('Ownership changed before container rebuild');await command('docker',['rm',container.name]);}
 await command('systemctl',['daemon-reload']);await command('systemctl',['start','dafeiyu-runtime']);
 const report={source:OLD,target:TARGET,backup:BACKUP,verifiedBeforeStart:true,filesBefore,matchedFiles:filesBefore,entries:before.length,counts,users:users.map(u=>u.username),transforms,rootDataExists:fs.existsSync(OLD),verifiedAt:new Date().toISOString()};
 fs.writeFileSync(BACKUP+'/verification.json',JSON.stringify(report,null,2),{mode:0o600});
 record('ready-to-restore',{files:filesBefore,rootDataExists:fs.existsSync(OLD)});
}catch(error){record('interrupted',{error:String(error.message).split('\n')[0].slice(0,300),rootDataExists:fs.existsSync(OLD),targetExists:fs.existsSync(TARGET)});console.error('Migration stopped with data preserved. Inspect private journal and backups before resuming.');process.exitCode=1;}
