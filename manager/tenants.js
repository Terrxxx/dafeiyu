import{publishBalance}from'../src/low-balance.js';
import { peerDigest } from '../src/qq-peers.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
import { ROOT } from '../src/config.js';
import { atomicWriteFile } from '../src/atomic-file.js';
import { token } from './accounts.js';
import { helper, checkBalance } from './runtime-client.js';
import { modelSettings, normalizeCustomUrl } from '../src/model-provider.js';
import { normalizeMediaModel, publicMediaModels, runtimeMediaModels } from '../src/media-model-settings.js';

const customCredits = billing => ({
  available: billing === 'insufficient_balance' ? false : null, supported: false, balances: [], checkedAt: Date.now(),
});
const DEFAULT_PERSONA=`你叫大肥鱼，是一位有自己性格、情绪与生活节奏的虚拟伙伴。日常回复简短自然，通常十字左右，有内容再多说，合适时发表情包或偶尔用颜文字。不要每句话都卖萌，不要写成客服或工作报告。先理解语境再决定是否参与，允许沉默、不同意、开玩笑，但不要恶意辱骂。\n关系和记忆逐渐形成，不凭空假装熟悉。只有配置中的管理员能通过私聊指挥跨会话操作。称呼要根据管理员设置和真实相处决定，不把所有人都叫爸爸。\n群与私聊保持同一个性格和用户印象，可以自然提对方的普通喜好，但不透露私聊内容、隐私或信息来源。不要泄露其他用户的私聊。\n自己浏览和分享要有取舍，真的有趣才分享，不广播不刷屏。按程序的精力与睡眠状态行动，睡着时完全静默。工具结果才是操作依据，不假装成功，不编造资料。不要用断token、死亡或悲惨身世让人产生负担。\n`;
export class Tenants {
 constructor(accounts,{dataRoot=path.join(ROOT,'data'),request=fetch,runtime=helper}={}){Object.assign(this,{accounts,dataRoot,request,runtime});this.balances=new Map();this.loginKeys=new Map();this.pending=new Map();this.recovery=new Map();this.emailStops=new Set();}
 syncPeers(){
  const rows=this.accounts.db.prepare('SELECT username,qq FROM bots WHERE qq IS NOT NULL ORDER BY qq').all();
  const biliPeers=rows.flatMap(row=>{const bot=this.accounts.bot(row.username);const cookie=bot?.secrets.biliCookie||'';const id=cookie.match(/(?:^|;\s*)DedeUserID=(\d+)/)?.[1];return id?[peerDigest('bili:'+id)]:[];});
  const output=JSON.stringify({version:1,peers:[...new Set(rows.map(row=>peerDigest(row.qq)))],biliPeers:[...new Set(biliPeers)]})+'\n';
  for(const row of rows){const file=path.join(this.directory(row.username),'.qq-peers.json');if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==output)atomicWriteFile(file,output);}
 }
 directory(name){return path.join(this.dataRoot,name);}
 exclusive(name,fn){const previous=this.pending.get(name)||Promise.resolve();const job=previous.catch(()=>{}).then(fn);this.pending.set(name,job);return job.finally(()=>{if(this.pending.get(name)===job)this.pending.delete(name);});}
 async create(name,{apiKey,qq,adminQQ}){
  return this.exclusive(name,async()=>{
   if(this.accounts.bot(name))throw Object.assign(new Error('每个账号只能创建一只大肥鱼'),{status:409});
   if(typeof qq!=='string'||!/^\d{5,15}$/.test(qq)||typeof adminQQ!=='string'||!/^\d{5,15}$/.test(adminQQ))throw new Error('请填写大肥鱼QQ号和你的管理员QQ号');
   if(this.accounts.db.prepare('SELECT username FROM bots WHERE qq=?').get(qq))throw new Error('这个QQ已绑定其他大肥鱼');
   const balance=await checkBalance(apiKey,this.request);
   await this.runtime('prepare',name);
   const directory=this.directory(name);fs.mkdirSync(directory,{recursive:true,mode:0o700});
   const config=JSON.parse(fs.readFileSync(path.join(ROOT,'config.example.json'),'utf8'));
   config.qq.adminUsers=[adminQQ];config.bilibili.enabled=false;config.social.voiceName='kokoro-zf_017';config.social.browserPath='/usr/bin/chromium';config.web.openBrowser=false;
   config.agent.maxModelCallsPerHour=0;
   atomicWriteFile(path.join(directory,'config.json'),JSON.stringify(config,null,2));
   atomicWriteFile(path.join(directory,'persona.md'),DEFAULT_PERSONA);
   const secrets={apiKey,napcatToken:token(),webuiToken:token(),model:'deepseek-flash'};
   this.accounts.db.prepare('INSERT INTO bots(username,qq,secrets,billing,created) VALUES (?,?,?,?,?)').run(name,qq,this.accounts.encrypt(secrets,name),balance.available?null:'insufficient_balance',Date.now());
   this.balances.set(name,balance);this.accounts.audit(name,'bot-create');
   this.syncPeers();this.writeQQ(name);return {created:true,balance};
  });
 }
 writeQQ(name){
  const bot=this.accounts.bot(name),directory=path.join(this.directory(name),'napcat/config');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const network={httpServers:[],httpClients:[],websocketClients:[],websocketServers:[{name:'dafeiyu',enable:true,host:'0.0.0.0',port:3001,token:bot.secrets.napcatToken,messagePostFormat:'array',reportSelfMessage:false}]};
  for(const file of['onebot11.json',`onebot11_${bot.qq}.json`])atomicWriteFile(path.join(directory,file),JSON.stringify({network}));
  atomicWriteFile(path.join(directory,'webui.json'),JSON.stringify({host:'0.0.0.0',port:6099,token:bot.secrets.webuiToken,loginRate:10,autoLoginAccount:bot.qq}));
 }
 async napcat(name,route,body={}){
  const bot=this.accounts.bot(name);if(!bot)throw new Error('请先创建大肥鱼');
  const status=await this.runtime('status',name);if(!status.port)throw new Error('QQ登录服务尚未启动');
  const base=`http://127.0.0.1:${Number(status.port)}/api`;
  const post=async(route,body,credential)=>{const response=await this.request(base+route,{method:'POST',headers:{'Content-Type':'application/json',...(credential?{Authorization:`Bearer ${credential}`}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error('QQ登录服务暂时不可用');const value=await response.json();if(value.code!==0)throw new Error('QQ登录操作未完成，请稍后刷新');return value.data;};
  let entry=this.loginKeys.get(name);if(!entry||entry.expires<Date.now()){const auth=await post('/auth/login',{hash:createHash('sha256').update(bot.secrets.webuiToken+'.napcat').digest('hex')});entry={credential:auth.Credential,expires:Date.now()+300000};this.loginKeys.set(name,entry);}
  return post(route,body,entry.credential);
 }
 async provision(name){this.writeQQ(name);this.loginKeys.delete(name);return this.runtime('provision',name);}
 async restartQQ(name){return this.exclusive(name,async()=>{
  if(!this.accounts.bot(name))throw Object.assign(Error('请先创建大肥鱼'),{status:400});
  const result=await this.runtime('restart-qq',name);
  if(!result.restarted)throw Object.assign(Error('QQ 容器尚未启动，请先点击扫码登录'),{status:409});
  this.loginKeys.delete(name);
  this.accounts.audit(name,'qq-restart');
  return result;
 });}
 async qqStatus(name){const status=await this.napcat(name,'/QQLogin/CheckLoginStatus');if(!status.isLogin)return {loggedIn:false,phase:status.loginPhase};const info=await this.napcat(name,'/QQLogin/GetQQLoginInfo');const actual=String(info.uin||info.user_id||info.account?.uin||'');const bot=this.accounts.bot(name);if(actual!==bot.qq){await this.runtime('stop-all',name);throw new Error('登录QQ与填写的QQ号不一致，已停止此实例');}return {loggedIn:true,qq:actual,nickname:String(info.nick||'')};}
 async qr(name,refresh=false){if(refresh)await this.napcat(name,'/QQLogin/RefreshQRcode');const info=await this.napcat(name,'/QQLogin/GetQQLoginQrcode');if(typeof info.qrcode!=='string'||info.qrcode.length>500000)throw new Error('二维码尚未就绪，请稍后刷新');return {image:info.qrcode.startsWith('data:image/')?info.qrcode:await QRCode.toDataURL(info.qrcode,{width:360,margin:3})};}
 async balance(name){const bot=this.accounts.bot(name);if(!bot)return null;
  if(modelSettings(bot.secrets).provider==='custom')return customCredits(bot.billing);
  const value=await checkBalance(bot.secrets.apiKey,this.request);this.balances.set(name,value);publishBalance(this.directory(name),value);if(!value.available){this.accounts.db.prepare('UPDATE bots SET desired=0,billing=? WHERE username=?').run('insufficient_balance',name);await this.runtime('stop',name);}else if(bot.billing){this.accounts.db.prepare('UPDATE bots SET billing=NULL WHERE username=?').run(name);try{fs.unlinkSync(path.join(this.directory(name),'billing-status.json'));}catch{}}
  return value;
 }
 async saveKey(name, { apiKey, provider, baseUrl, model } = {}) {
  return this.exclusive(name, async () => {
   const bot = this.accounts.bot(name);
   if (!bot) throw Error('请先创建大肥鱼');
   const previous = modelSettings(bot.secrets);
   provider ??= previous.provider;
   if (!['deepseek', 'custom'].includes(provider)) throw Object.assign(Error('模型供应商无效'), { status: 400 });
   const sameProvider = provider === previous.provider;
   const secrets = { ...bot.secrets, provider };
   if (provider === 'custom') {
    if (sameProvider) {
     if (baseUrl === undefined) baseUrl = previous.baseUrl;
     if (model === undefined) model = bot.secrets.customModel;
    }
    if (model !== undefined && (typeof model !== 'string' || model.length > 128 || /[^\x21-\x7e]/.test(model))) {
     throw Object.assign(Error('模型 ID 必须为不含空格的可见字符'), { status: 400 });
    }
    secrets.baseUrl = normalizeCustomUrl(baseUrl);
    secrets.customModel = model || '';
   } else {
    delete secrets.baseUrl;
    delete secrets.customModel;
   }
   const sameOrigin = new URL(modelSettings(secrets).baseUrl).origin === new URL(previous.baseUrl).origin;
   if (apiKey === undefined || apiKey === '') {
    if (!sameProvider || !sameOrigin || !bot.secrets.apiKey) {
     throw Object.assign(Error('更换供应商或 API 地址时，请填写对应的 API Key'), { status: 400 });
    }
    apiKey = bot.secrets.apiKey;
   } else if (typeof apiKey !== 'string' || apiKey.length < 8 || apiKey.length > 300 || /[\s\x00-\x1f\x7f]/.test(apiKey)) {
    throw Object.assign(Error('请输入有效的 API Key'), { status: 400 });
   }
   secrets.apiKey = apiKey;
   const balance = provider === 'custom' ? customCredits() : await checkBalance(apiKey, this.request);
   await this.runtime('stop', name);
   const directory = this.directory(name);
   fs.rmSync(path.join(directory, 'balance-notice.json'), { force: true });
   fs.rmSync(path.join(directory, 'billing-status.json'), { force: true });
   this.accounts.transaction(() => {
    this.accounts.saveSecrets(name, secrets);
    this.accounts.db.prepare('UPDATE bots SET desired=0,billing=? WHERE username=?')
      .run(balance.available === false ? 'insufficient_balance' : null, name);
    this.accounts.audit(name, 'api-key-update');
   });
   this.balances.set(name, balance);
   return balance;
  });
 }
 async control(name,action){return this.exclusive(name,()=>this.controlLocked(name,action));}
 async restartRunning(name){return this.exclusive(name,async()=>{
  const user=this.accounts.user(name),bot=this.accounts.bot(name);
  if(!user||user.disabled||!user.email||!bot?.desired)return 'skipped';
  const status=await this.runtime('status',name);
  if(status.phase!=='running')return 'skipped';
  await this.controlLocked(name,'restart');
  return 'restarted';
 });}
 async controlLocked(name,action){
  const bot=this.accounts.bot(name);if(!bot)throw new Error('请先创建大肥鱼');
  if(action==='stop'){this.accounts.db.prepare('UPDATE bots SET desired=0 WHERE username=?').run(name);this.accounts.audit(name,'bot-stop');return this.runtime('stop',name);}
  if(!['start','restart'].includes(action))throw new Error('无效操作');
  if(!this.accounts.user(name)?.email)throw Object.assign(Error('请先绑定并验证邮箱'),{status:403});
  const balance=await this.balance(name);if(balance.available===false)throw Object.assign(new Error('API余额不足，请充值或更换API Key后重新启动'),{status:402});
  const qq=await this.qqStatus(name);if(!qq.loggedIn)throw new Error('请先在账号设置中扫码登录QQ');
  if(action==='restart')await this.runtime('stop',name);
  const latest=this.accounts.bot(name),secrets=latest.secrets;
  const model = modelSettings(secrets);
  const env={DEEPSEEK_API_KEY:secrets.apiKey,DEEPSEEK_BASE_URL:model.baseUrl,DEEPSEEK_MODEL:model.model,DAFEIYU_MODEL_PROVIDER:model.provider,NAPCAT_TOKEN:secrets.napcatToken,BILIBILI_COOKIE:secrets.biliCookie||''};
  const mediaModels = runtimeMediaModels(secrets);
  if (Object.keys(mediaModels).length) env.DAFEIYU_MEDIA_MODELS = JSON.stringify(mediaModels);
  const result=await this.runtime('start',name,{env});this.accounts.db.prepare('UPDATE bots SET desired=1 WHERE username=?').run(name);this.accounts.audit(name,`bot-${action}`);return result;
 }
 async saveMediaModel(name, { kind, ...configuration }) {
  return this.exclusive(name, async () => {
   const bot = this.accounts.bot(name);
   if (!bot) throw Object.assign(Error('请先创建大肥鱼'), { status: 400 });
   const previous = bot.secrets.mediaModels || {};
   const saved = normalizeMediaModel(kind, configuration, previous[kind], modelSettings(bot.secrets).baseUrl);
   const secrets = { ...bot.secrets, mediaModels: { ...previous, [kind]: saved } };
   this.accounts.transaction(() => {
    this.accounts.saveSecrets(name, secrets);
    this.accounts.audit(name, 'media-model-update');
   });
   return { mediaModels: publicMediaModels(secrets) };
  });
 }
 async logs(name){
  const {text}=await this.runtime('logs',name);
  const secrets=this.accounts.bot(name)?.secrets||{};
  const keys=Object.values(secrets.mediaModels||{}).map(profile=>profile.apiKey);
  let safe=text;
  for(const secret of [...Object.values(secrets), ...keys])if(typeof secret==='string'&&secret.length>=8)safe=safe.split(secret).join('[已隐藏]');
  return safe.split('\n').filter(Boolean).slice(-200).map((line,id)=>{const match=line.match(/^(\d{4}-\d{2}-\d{2}T\S+) (.*)$/);return {id,time:match?match[1]:new Date().toISOString(),level:'info',text:(match?match[2]:line).slice(0,4000)};});
 }
 async updateBili(name,cookie){return this.exclusive(name,async()=>{
  await this.runtime('stop',name);const bot=this.accounts.bot(name);if(!bot)throw new Error('请先创建大肥鱼');
  const secrets={...bot.secrets};if(cookie)secrets.biliCookie=cookie;else delete secrets.biliCookie;
  this.accounts.saveSecrets(name,secrets);this.accounts.db.prepare('UPDATE bots SET desired=0 WHERE username=?').run(name);
  const file=path.join(this.directory(name),'config.json'),config=JSON.parse(fs.readFileSync(file,'utf8'));config.bilibili.enabled=!!cookie;atomicWriteFile(file,JSON.stringify(config,null,2));
  const legacy=path.join(this.directory(name),'bilibili-auth.json');if(!cookie&&fs.existsSync(legacy))fs.unlinkSync(legacy);
  this.accounts.audit(name,cookie?'bili-login':'bili-logout');
 });}
 async tick(){for(const {username:name,desired}of this.accounts.db.prepare('SELECT username,desired FROM bots').all()){
   if(this.pending.has(name))continue;
   const account=this.accounts.user(name);
   if(account?.disabled){await this.runtime('stop-all',name).catch(()=>{});continue;}
   if(!account?.email){this.accounts.db.prepare('UPDATE bots SET desired=0 WHERE username=?').run(name);if(!this.emailStops.has(name)){await this.runtime('stop',name);this.emailStops.add(name);}continue;}this.emailStops.delete(name);
   const marker=path.join(this.directory(name),'billing-status.json');
   if(fs.existsSync(marker)){this.accounts.db.prepare('UPDATE bots SET desired=0,billing=? WHERE username=?').run('insufficient_balance',name);await this.runtime('stop',name).catch(()=>{});continue;}
   if(desired&&modelSettings(this.accounts.bot(name)?.secrets).provider==='deepseek'&&(!this.balances.has(name)||this.balances.get(name).checkedAt<Date.now()-300000))await this.exclusive(name,()=>this.balance(name)).catch(()=>{});
   if(desired&&this.accounts.bot(name)?.desired&&(this.recovery.get(name)||0)<Date.now()-60000){
     const state=await this.runtime('status',name).catch(()=>null);
     if(state&&state.phase!=='running'){this.recovery.set(name,Date.now());await this.control(name,'start').catch(()=>{});}
   }
  }}
}

