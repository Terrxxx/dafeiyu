// Installed as a root-owned file outside the project. Only the local manager group may access its Unix socket.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec=promisify(execFile),BASE='/opt/dafeiyu/data',CODE='/opt/dafeiyu',SOCKET='/run/dafeiyu/helper.sock';
const NAPCAT='ghcr.io/napneko/nodenapcat@sha256:fa4f3cda11e79e3d5c0d8d271565ed4b12e79826ee04b78982484e49348841b7';
const ENV=new Set(['DEEPSEEK_API_KEY','DEEPSEEK_BASE_URL','DEEPSEEK_MODEL','DAFEIYU_MODEL_PROVIDER','DAFEIYU_MEDIA_MODELS','NAPCAT_TOKEN','BILIBILI_COOKIE']);
const docker=async args=>(await exec('/usr/bin/docker',args,{timeout:150000,maxBuffer:2*1024*1024})).stdout.trim();
function tenant(name){if(!/^[a-z][a-z0-9_]{2,23}$/.test(name))throw Error('非法用户名');const directory=path.join(BASE,name);if(fs.realpathSync(directory)!==directory)throw Error('禁止符号链接目录');return directory;}
async function inspect(name){try{return JSON.parse(await docker(['inspect',name]))[0];}catch{return null;}}
function owned(info,name){if(info&&info.Config.Labels?.['dafeiyu.owner']!==name)throw Error('拒绝操作不属于此用户的容器');}
async function remove(container,name){const info=await inspect(container);owned(info,name);if(info)await docker(['rm','-f',container]);}
async function qqEgress(network,kind='qq'){const result=await exec('/usr/local/sbin/dafeiyu-qq-egress',['ensure',network,kind],{timeout:30000});const address=result.stdout.trim();if(!/^\d+\.\d+\.\d+\.\d+$/.test(address))throw Error('QQ proxy routing unavailable');return address;}
const queues=new Map();let provisioning=Promise.resolve();
function queueProvision(body){const next=provisioning.catch(()=>{}).then(()=>execute(body));provisioning=next;return next;}
async function assertCapacity(){const rows=await docker(['ps','--filter','label=dafeiyu.kind=qq','--format','{{.Names}}']);if(rows.split('\n').filter(Boolean).length>=4)throw Error('CAPACITY');}
async function execute(body){
 const {username:name,operation}=body;
 if(operation==='prepare') {if(!/^[a-z][a-z0-9_]{2,23}$/.test(name))throw Error('非法用户名');const target=path.join(BASE,name);if(!fs.existsSync(target))fs.mkdirSync(target,{mode:0o770});if(fs.realpathSync(target)!==target)throw Error('禁止符号链接目录');fs.chownSync(target,0,978);fs.chmodSync(target,0o770);return {prepared:true};}
 if(operation==='delete-tenant'){
   if(!/^[a-z][a-z0-9_]{2,23}$/.test(name))throw Error('非法用户名');
   const directory=path.join(BASE,name),network=`dfy-net-${name}`;
   if(fs.existsSync(directory)&&fs.realpathSync(directory)!==directory)throw Error('禁止符号链接目录');
   for(const container of [`dfy-agent-${name}`,`dfy-qq-${name}`])await remove(container,name);
   const info=await docker(['network','inspect',network]).then(v=>JSON.parse(v)[0]).catch(()=>null);
   if(info){if(info.Labels?.['dafeiyu.owner']!==name)throw Error('拒绝操作不属于此用户的网络');await docker(['network','rm',network]);}
   if(fs.existsSync(directory))fs.rmSync(directory,{recursive:true,force:false});
   const devicesFile='/var/lib/dafeiyu-qq-egress/devices.json';
   if(fs.existsSync(devicesFile)){
     const devices=JSON.parse(fs.readFileSync(devicesFile,'utf8'));
     if(Object.hasOwn(devices,name)){
       delete devices[name];
       const temporary=devicesFile+'.tmp';
       fs.writeFileSync(temporary,JSON.stringify(devices),{mode:0o600});
       fs.renameSync(temporary,devicesFile);
     }
   }
   return {deleted:true};
 }
 const directory=tenant(name),agent=`dfy-agent-${name}`,qq=`dfy-qq-${name}`,network=`dfy-net-${name}`;
 if(operation==='groups'){
   const q=await inspect(qq);owned(q,name);if(!q?.State.Running)throw Error('QQ未启动');
   const address=q.NetworkSettings.Networks?.[network]?.IPAddress;if(!/^172\.|^192\.168\.|^10\./.test(address||''))throw Error('QQ连接地址无效');
   const settings=JSON.parse(fs.readFileSync(path.join(directory,'napcat/config/onebot11.json'),'utf8'));const access=settings.network.websocketServers.find(s=>s.enable)?.token;
   return await new Promise((resolve,reject)=>{const ws=new WebSocket('ws://'+address+':3001/?access_token='+encodeURIComponent(access));const finish=(error,value)=>{clearTimeout(timer);ws.close();error?reject(error):resolve(value);};const timer=setTimeout(()=>finish(Error('QQ群列表查询超时')),15000);ws.addEventListener('open',()=>ws.send(JSON.stringify({action:'get_group_list',params:{},echo:'groups'})));ws.addEventListener('error',()=>finish(Error('QQ连接失败')));ws.addEventListener('message',event=>{let value;try{value=JSON.parse(String(event.data));}catch{return;}if(value.echo!=='groups')return;if(value.retcode!==0||!Array.isArray(value.data))return finish(Error('群列表读取失败'));finish(null,{groups:value.data.filter(g=>/^[1-9]\d*$/.test(String(g.group_id))).map(g=>({id:String(g.group_id),name:String(g.group_name||g.group_id).slice(0,100)}))});});});
 }
 if(operation==='status') {const a=await inspect(agent),q=await inspect(qq);owned(a,name);owned(q,name);return {phase:a?.State.Running?'running':a?.State.ExitCode?'failed':'stopped',exitCode:a?.State.ExitCode,qqRunning:!!q?.State.Running,port:q?.NetworkSettings.Ports?.['6099/tcp']?.[0]?.HostPort};}
 if(operation==='logs'){const info=await inspect(agent);owned(info,name);return {text:info?await exec('/usr/bin/docker',['logs','--timestamps','--tail','200',agent],{timeout:10000,maxBuffer:2*1024*1024}).then(result=>result.stdout+'\n'+result.stderr).catch(()=> ''):''};}
 if(operation==='stop'){const info=await inspect(agent);owned(info,name);if(info?.State.Running)await docker(['stop','-t','90',agent]);return {phase:'stopped'};}
 if(operation==='stop-all'){for(const c of[agent,qq]){const info=await inspect(c);owned(info,name);if(info?.State.Running)await docker(['stop','-t','90',c]);}return {phase:'stopped'};}
 if(operation==='provision'){
   const old=await inspect(qq);owned(old,name);if(old){await qqEgress(network);if(!old.State.Running){await assertCapacity();await docker(['start',qq]);}return execute({username:name,operation:'status'});}
   await assertCapacity();
   for(const leaf of ['napcat/qq','napcat/config','napcat/logs','napcat/plugins','media']){const p=path.join(directory,leaf);fs.mkdirSync(p,{recursive:true,mode:0o700});if(fs.realpathSync(p)!==p)throw Error('禁止符号链接挂载');fs.chownSync(p,993,978);}
   if(!(await docker(['network','ls','--filter',`name=^${network}$`,'--format','{{.Name}}'])))await docker(['network','create','--label',`dafeiyu.owner=${name}`,network]);
   const qqAddress=await qqEgress(network);
   const devices=fs.existsSync('/var/lib/dafeiyu-qq-egress/devices.json')?JSON.parse(fs.readFileSync('/var/lib/dafeiyu-qq-egress/devices.json','utf8')):{};const device=devices[name];if(device&&!/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(device))throw Error('Invalid QQ network identity');
   const mounts=[['napcat/qq','/app/.config/QQ'],['napcat/qq','/root/.config/QQ'],['napcat/config','/app/napcat/config'],['napcat/logs','/app/napcat/logs'],['napcat/plugins','/app/napcat/plugins'],['media',`${directory}/media`]];
   const args=['run','-d','--name',qq,'--hostname',name==='yutori'?'dafeiyu-qq':qq,'--label',`dafeiyu.owner=${name}`,'--label','dafeiyu.kind=qq','--network',network,'--ip',qqAddress,'--dns','198.18.78.1','--restart','unless-stopped','--memory','1200m','--cpus','1','--pids-limit','512','-p','127.0.0.1::6099'];
   if(device)args.push('--mac-address',device);
   for(const[src,dest]of mounts)args.push('--mount',`type=bind,src=${directory}/${src},dst=${dest}${src==='media'?',readonly':''}`);
   args.push('-e','NAPCAT_UID=993','-e','NAPCAT_GID=978',NAPCAT);await docker(args);return execute({username:name,operation:'status'});
 }
 if(operation==='start'){
   const env=body.env;if(!env||Object.keys(env).some(k=>!ENV.has(k))||Object.values(env).some(v=>typeof v!=='string'||/[\x00\r\n]/.test(v)||v.length>20000))throw Error('无效运行参数');
   const a=await inspect(agent);owned(a,name);if(a?.State.Running)return {phase:'running'};
   const q=await inspect(qq);owned(q,name);if(!q?.State.Running)throw Error('请先登录QQ');
   const agentAddress=await qqEgress(network,'agent');
   await remove(agent,name);
   const args=['run','-d','--name',agent,'--label',`dafeiyu.owner=${name}`,'--label','dafeiyu.kind=agent','--network',network,'--ip',agentAddress,'--dns','198.18.78.1','--user','993:978','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','512','--memory','2200m','--cpus','1.5','--shm-size','256m','--tmpfs','/tmp:rw,nosuid,exec,size=512m','--restart','on-failure:3','-w',CODE];
   for(const leaf of ['src','node_modules','harness-runtime/node_modules'])args.push('--mount',`type=bind,src=${CODE}/${leaf},dst=${CODE}/${leaf},readonly`);
   args.push('--mount',`type=bind,src=${CODE}/package.json,dst=${CODE}/package.json,readonly`,'--mount',`type=bind,src=${directory},dst=${directory}`,'--mount',`type=bind,src=${CODE}/assets/tts,dst=/opt/voices,readonly`);
   const fixed={DAFEIYU_MANAGED:'1',DAFEIYU_DATA_DIR:directory,DAFEIYU_CONFIG_FILE:`${directory}/config.json`,DAFEIYU_PERSONA_FILE:`${directory}/persona.md`,DAFEIYU_HARNESS_HOME:`${directory}/harness-home`,DAFEIYU_TTS_DIR:'/opt/voices',NAPCAT_WS_URL:`ws://${qq}:3001`,TZ:'Asia/Shanghai',HOME:`${directory}/home`};
   const envFile=`/run/dafeiyu/${name}.env`;fs.writeFileSync(envFile,Object.entries({...env,...fixed}).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{mode:0o600});args.push('--env-file',envFile);
   args.push('dafeiyu-agent:multiuser','node','src/main.js');try{await docker(args);}finally{fs.unlinkSync(envFile);}return {phase:'running'};
 }
 throw Error('未知运行操作');
}
fs.mkdirSync(path.dirname(SOCKET),{recursive:true,mode:0o750});fs.chownSync(path.dirname(SOCKET),0,978);if(fs.existsSync(SOCKET))fs.unlinkSync(SOCKET);
const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json');try{if(req.method!=='POST'||req.url!=='/')throw Error('无效请求');let text='';for await(const c of req){text+=c;if(Buffer.byteLength(text)>65536)throw Error('请求过大');}const body=JSON.parse(text);if(typeof body.username!=='string')throw Error('用户名缺失');const previous=queues.get(body.username)||Promise.resolve();const job=previous.catch(()=>{}).then(()=>body.operation==='provision'?queueProvision(body):execute(body));queues.set(body.username,job);let result;try{result=await job;}finally{if(queues.get(body.username)===job)queues.delete(body.username);}res.end(JSON.stringify(result));}catch(error){res.statusCode=400;console.error('Runtime operation failed; inspect container status without credentials');res.end(JSON.stringify({error:error.message==='CAPACITY'?'服务器同时运行名额已满，请联系站点管理员':'运行操作失败，请查看服务状态或联系管理员'}));}});
server.listen(SOCKET,()=>{fs.chownSync(SOCKET,0,978);fs.chmodSync(SOCKET,0o660);});


