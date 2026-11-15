import{LoginCodes}from'./login-codes.js';
import{RegistrationCodes}from'./registration-codes.js';
import{PasswordCodes}from'./password-codes.js';
import{SiteSettings}from'./site-settings.js';
import{emailAddress}from'./email-address.js';
import{componentCatalog}from'../src/component-catalog.js';
import{atomicWriteFile}from'../src/atomic-file.js';
import{publishComponentPolicy}from'../src/component-policy.js';
import{dailyStatus}from'../src/daily-budget.js';
import { modelSettings } from '../src/model-provider.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Accounts, username, hash, passwordHash, passwordMatches, token } from './accounts.js';
import { Tenants } from './tenants.js';
import { startWebPanel } from '../src/web-panel.js';
import { ROOT } from '../src/config.js';
const FRONT=path.join(ROOT,'frontend/dist');
const WEB=path.join(path.dirname(fileURLToPath(import.meta.url)),'web');
export async function startManager({dataRoot=process.env.DAFEIYU_DATA_ROOT||path.join(ROOT,'data'),port=Number(process.env.PORT||13082),origins=(process.env.DAFEIYU_ORIGINS||'http://192.168.1.149:3081,https://dafeiyu.yrxs.net').split(','),runtime,request=fetch,mailerFactory}={}){
 const accounts=new Accounts(path.join(dataRoot,'.platform')),tenants=new Tenants(accounts,{dataRoot,runtime,request});
 const site=new SiteSettings(accounts,mailerFactory?{createTransport:mailerFactory}:{});
 const loginCodes=new LoginCodes(accounts);
 const registrationCodes=new RegistrationCodes(accounts);
 const passwordCodes=new PasswordCodes(accounts);
 const policyFile=path.join(dataRoot,'.platform/component-policy.json');
 const getPolicy=()=>fs.existsSync(policyFile)?JSON.parse(fs.readFileSync(policyFile,'utf8')):{disabled:[],revision:'initial'};
 const syncPolicy=()=>publishComponentPolicy(dataRoot,getPolicy(),accounts.db.prepare('SELECT username FROM bots').all().map(x=>x.username));
 const panels=new Map(),snapshots=new Map(),logs=new Map(),rates=new Map();let ticking=false,closing=false;
 const allowedOrigins=new Set(origins);let actualPort;
 const error=(status,message)=>Object.assign(new Error(message),{status});
 const rate=(key,limit=15,ms=600000)=>{const now=Date.now(),old=rates.get(key);if(!old||old.until<now){rates.set(key,{until:now+ms,count:1});return;}if(++old.count>limit)throw error(429,'操作过于频繁，请稍后再试');};
 const csrf=(req,user)=>{if(req.headers['x-csrf-token']!==user.csrf)throw error(403,'页面会话已更新，请刷新后重试');};
 const admin=user=>{if(user.role!=='admin')throw error(403,'仅站点管理员可操作');};
 const bodyOf=async req=>{let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>524288)throw error(413,'请求过大');}try{return JSON.parse(value||'{}');}catch{throw error(400,'请求格式无效');}};
 async function refresh(name){const state=await tenants.runtime('status',name);snapshots.set(name,state);return state;}
 async function panelFor(name){
  if(!panels.has(name))panels.set(name,(async()=>{
   await refresh(name);logs.set(name,await tenants.logs(name));
   const panel=await startWebPanel({root:tenants.directory(name),dataRoot:tenants.directory(name),port:0,controller:{status:()=>snapshots.get(name)||{phase:'stopped'},logs:()=>logs.get(name)||[],model:()=>modelSettings(accounts.bot(name)?.secrets),control:async action=>{const value=await tenants.control(name,action);await refresh(name);return value;}}});return panel;
  })().catch(e=>{panels.delete(name);throw e;}));
  return panels.get(name);
 }
 function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}
 function cookie(req,res,session){const secure=(req.headers['x-forwarded-proto']==='https'&&['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress))||req.socket.encrypted;res.setHeader('Set-Cookie',`dfy_session=${session?.value||''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${session?604800:0}${secure?'; Secure':''}`);}
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  try{
   const allowedHosts=new Set([...allowedOrigins].map(o=>new URL(o).host));if(!allowedHosts.has(req.headers.host))throw error(403,'访问地址无效');
   if(!['GET','POST'].includes(req.method))throw error(405,'不支持的请求方法');
   const url=new URL(req.url,`http://${req.headers.host}`);const pathname=url.pathname;
   const ip=['127.0.0.1','::ffff:127.0.0.1','::1'].includes(req.socket.remoteAddress)?req.headers['x-real-ip']||req.socket.remoteAddress:req.socket.remoteAddress;
   if(req.method==='POST'){
    if(!allowedOrigins.has(req.headers.origin)||req.headers['content-type']?.split(';')[0]!=='application/json')throw error(403,'请求来源无效');
    rate(`write:${ip}`,120,60000);
   }
   const sessionValue=req.headers.cookie?.match(/(?:^|;\s*)dfy_session=([A-Za-z0-9_-]+)/)?.[1];const user=accounts.authenticate(sessionValue);
   const publicPage=['/login','/register','/activate','/verify-email'].includes(pathname);
   const browserNavigation=req.headers['sec-fetch-mode']==='navigate'||req.headers.accept?.includes('text/html');
   const pagePath=!/^\/(?:auth|api|account|admin)\//.test(pathname)&&!/\.[a-z0-9]{1,8}$/i.test(pathname);
   if(!user&&req.method==='GET'&&!publicPage&&(browserNavigation||pagePath)){
    res.writeHead(302,{Location:'/login?next='+encodeURIComponent(url.pathname+url.search)});res.end();return;
   }
   if(pathname==='/auth/options'&&req.method==='GET')return json(res,200,site.public());
   if(pathname==='/auth/me'&&req.method==='GET')return json(res,200,user?{authenticated:true,username:user.username,role:user.role,csrf:user.csrf,emailRequired:!user.email,emailVerified:!!user.email_verified}:{authenticated:false});
   if(pathname.startsWith('/auth/')&&req.method==='POST'){
    const body=await bodyOf(req);
    if(pathname==='/auth/logout'){if(user)csrf(req,user);if(sessionValue)accounts.db.prepare('DELETE FROM sessions WHERE digest=?').run(hash(sessionValue));cookie(req,res,null);return json(res,200,{ok:true});}
    if(pathname==='/auth/username'){rate('username:'+ip,40,60000);rate('username-global',240,60000);username(body.username);return json(res,200,{available:!accounts.user(body.username)});}
    rate(`auth:${ip}`);rate('auth-global',120,60000);
    if(pathname==='/auth/register/captcha'){rate('register-captcha:'+ip,12,600000);const settings=site.read();if(settings.registrationMode==='closed')throw error(403,'站点暂不允许新用户注册');if(!settings.captcha.registrationEnabled)throw error(403,'注册图形验证已关闭');return json(res,200,registrationCodes.captcha(body.username,body.email,settings.captcha));}
    if(pathname==='/auth/register/code/request'){rate('register-code-ip:'+ip,5,3600000);rate('register-code-global',100,3600000);const settings=site.read();if(settings.registrationMode==='closed')throw error(403,'站点暂不允许新用户注册');if(!site.configured(settings))throw error(503,'站点尚未配置邮箱发信，暂时无法注册');const {name,email}=settings.captcha.registrationEnabled?registrationCodes.solve(body.username,body.email,body.captchaChallenge,body.captchaAnswer):registrationCodes.available(body.username,body.email),issued=registrationCodes.issue(name,email);try{await site.registrationCode(name,email,issued.code);}catch(e){registrationCodes.invalidate(issued.challenge);throw e;}return json(res,200,{challenge:issued.challenge,retryAfter:issued.retryAfter,expiresIn:issued.expiresIn,message:'注册验证码已发送，请检查收件箱与垃圾邮件'});}
    if(pathname==='/auth/login/captcha'){rate('login-captcha:'+ip,20,600000);const identifier=String(body.username||'').trim().toLowerCase();if(identifier.length<3||identifier.length>254)throw error(400,'账号格式无效');if(!site.read().captcha.loginEnabled)throw error(403,'登录图形验证已关闭');return json(res,200,registrationCodes.captchaFor('login',identifier,site.read().captcha));}
    if(pathname==='/auth/register/code/verify'){rate('register-code-verify:'+ip,20,600000);if(site.read().registrationMode==='closed')throw error(403,'站点暂不允许新用户注册');return json(res,200,registrationCodes.verify(body.username,body.email,body.challenge,body.code));}
    if(pathname==='/auth/register'){const settings=site.read();if(settings.registrationMode==='closed')throw error(403,'站点暂不允许新用户注册');if(typeof body.passwordConfirm!=='string'||body.password!==body.passwordConfirm)throw error(400,'两次输入的密码不一致');const {name,email}=registrationCodes.assertVerified(body.username,body.email,body.proof);const value=await accounts.register(name,body.password,body.invite,{email,mode:settings.registrationMode,emailVerified:true});registrationCodes.consume(body.proof);cookie(req,res,accounts.session(value.username));return json(res,201,{ok:true});}
    if(pathname==='/auth/verify-email'){rate('verify-email:'+ip,20,600000);const name=accounts.verifyEmail(body.token);return json(res,200,{ok:true,username:name});}
    if(pathname==='/auth/resend-email'){rate('resend-email:'+ip,5,3600000);if(typeof body.username!=='string'||body.username.length>24||typeof body.password!=='string'||body.password.length>128)throw error(400,'账号或密码格式无效');const row=accounts.db.prepare('SELECT * FROM users WHERE username=?').get(body.username);if(!await passwordMatches(body.password,row?.password)||row?.disabled)throw error(401,'用户名或密码错误');if(!row.email_pending||!row.email)throw error(400,'该账号无需邮件激活');rate('resend-account:'+row.username,1,60000);await site.verification(row.username,row.email,'register');return json(res,200,{ok:true,message:'激活邮件已重新发送'});}
    if(pathname==='/auth/login-code/request'){rate('login-code-ip:'+ip,5,3600000);rate('login-code-global',100,3600000);if(!site.configured())throw error(503,'站点尚未配置邮箱发信，请使用密码登录');const email=emailAddress(body.email);if(site.read().captcha.loginEnabled)registrationCodes.solveFor('login',email,body.captchaChallenge,body.captchaAnswer);const issued=loginCodes.issue(email);if(issued.username){try{await site.loginCode(issued.username,issued.email,issued.code);}catch(e){loginCodes.invalidate(issued.challenge);throw e;}}return json(res,200,{challenge:issued.challenge,retryAfter:60,expiresIn:600,message:'若该邮箱对应可登录账号，验证码已发送，请检查收件箱与垃圾邮件'});}
    if(pathname==='/auth/login-code/verify'){rate('login-code-verify:'+ip,30,600000);const name=loginCodes.verify(body.email,body.challenge,body.code);cookie(req,res,accounts.session(name));return json(res,200,{ok:true});}
    if(pathname==='/auth/login'){

     if(typeof body.username!=='string'||body.username.length>254||typeof body.password!=='string'||body.password.length>128)throw error(400,'账号或密码格式无效');
     const identifier=body.username.trim();rate('login:'+identifier.toLowerCase(),10);
     if(site.read().captcha.loginEnabled)registrationCodes.solveFor('login',identifier.toLowerCase(),body.captchaChallenge,body.captchaAnswer);
     const row=identifier.includes('@')?accounts.db.prepare('SELECT * FROM users WHERE lower(email)=?').get(emailAddress(identifier)):accounts.db.prepare('SELECT * FROM users WHERE username=?').get(identifier);
     if(!await passwordMatches(body.password,row?.password)||row?.disabled)throw error(401,'用户名或密码错误，或账号已被停用');
     if(row.email_pending)throw error(403,'请先点击激活邮件中的链接验证邮箱；可在登录页重新发送激活邮件');
     cookie(req,res,accounts.session(row.username));accounts.audit(row.username,'login');return json(res,200,{ok:true});
    }
    if(pathname==='/auth/activate'){const name=await accounts.activate(body.token,body.password);cookie(req,res,accounts.session(name));return json(res,200,{ok:true});}
    throw error(404,'接口不存在');
   }
   if(user&&!user.email&&req.method==='GET'&&['/','/account','/admin','/panel'].includes(pathname)){res.writeHead(302,{Location:'/bind-email'});res.end();return;}
   if(user?.email&&pathname==='/bind-email'&&req.method==='GET'){res.writeHead(302,{Location:'/account'});res.end();return;}
   if(req.method==='GET'&&/^\/console\/assets\/[A-Za-z0-9_-]+\.(?:js|css)$/.test(pathname)){
    const file=path.join(FRONT,'assets',path.basename(pathname));if(!fs.existsSync(file))throw error(404,'资源不存在');res.setHeader('Content-Type',pathname.endsWith('.css')?'text/css; charset=utf-8':'text/javascript; charset=utf-8');return res.end(fs.readFileSync(file));
   }
   if(req.method==='GET'&&['/','/login','/register','/activate','/verify-email','/bind-email','/account','/admin','/panel'].includes(pathname)&&fs.existsSync(path.join(FRONT,'index.html'))){
    if(pathname==='/admin'&&user)admin(user);res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(FRONT,'index.html')));
   }
   const managerAssets={'/brand.svg':['brand.svg','image/svg+xml'],'/fish.svg':['fish.svg','image/svg+xml'],'/manager.css':['manager.css','text/css'],'/manager.js':['manager.js','text/javascript'],'/tenant-bar.js':['tenant-bar.js','text/javascript']};
   if(req.method==='GET'&&managerAssets[pathname]){const[file,type]=managerAssets[pathname];res.setHeader('Content-Type',`${type}; charset=utf-8`);return res.end(fs.readFileSync(path.join(WEB,file)));}
   if(['/', '/login','/register','/activate','/account','/admin'].includes(pathname)&&req.method==='GET'){
    if(pathname==='/admin'&&user)admin(user);
    res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(fs.readFileSync(path.join(WEB,'index.html')));
   }
   if(!user)throw error(401,'请先登录');
   if(req.method==='POST'&&!pathname.startsWith('/api/'))csrf(req,user);
   if(!user.email&&!['/account/email'].includes(pathname)&&!(user.role==='admin'&&['/admin/settings','/admin/settings/test-email','/admin/settings/mail-preview'].includes(pathname)))return json(res,403,{error:'请先绑定并验证邮箱，完成后才能使用功能',code:'EMAIL_REQUIRED',bindUrl:'/bind-email'});
   if(pathname==='/account/email'&&req.method==='GET'){const row=accounts.user(user.username),pending=accounts.db.prepare("SELECT email FROM email_verifications WHERE username=? AND purpose='bind' AND expires>?").get(user.username,Date.now());return json(res,200,{email:row.email||'',verified:!!row.email_verified,locked:!!row.email_verified,required:!row.email,pendingEmail:pending?.email||'',mailConfigured:site.configured()});}
   if(pathname==='/account/email'&&req.method==='POST'){rate('email-bind:'+user.username,3,3600000);const body=await bodyOf(req),row=accounts.db.prepare('SELECT * FROM users WHERE username=?').get(user.username);if(row.email_verified)throw error(403,'邮箱已绑定，无法更换');if(!await passwordMatches(body.password,row.password))throw error(400,'当前密码不正确');const email=emailAddress(body.email);await site.verification(user.username,email,'bind');return json(res,200,{ok:true,message:'验证邮件已发送，点击链接验证后绑定邮箱'});}
   if(pathname==='/account/status'&&req.method==='GET'){
    const bot=accounts.bot(user.username);const status=bot?await refresh(user.username):null;
    const model=bot?modelSettings(bot.secrets):null;
    return json(res,200,{daily:bot?dailyStatus(tenants.directory(user.username),model):null,username:user.username,role:user.role,bot:bot?{qq:bot.qq,created:bot.created,billing:bot.billing,keySet:!!bot.secrets.apiKey,biliConfigured:!!bot.secrets.biliCookie,desired:!!bot.desired,...status,provider:model.provider,...(model.provider==='custom'?{baseUrl:model.baseUrl,customModel:bot.secrets.customModel||''}:{})}:null,balance:tenants.balances.get(user.username)||null});
   }
   if(pathname==='/account/create'&&req.method==='POST'){const created=await tenants.create(user.username,await bodyOf(req));syncPolicy();return json(res,201,created);}
   if(pathname==='/account/key'&&req.method==='POST')return json(res,200,await tenants.saveKey(user.username,await bodyOf(req)));
   if(pathname==='/account/credits'&&req.method==='GET'){
    const cached=tenants.balances.get(user.username);if(cached&&Date.now()-cached.checkedAt<60000)return json(res,200,cached);
    if(!balancePending.has(user.username)){const job=tenants.exclusive(user.username,()=>tenants.balance(user.username)).finally(()=>balancePending.delete(user.username));balancePending.set(user.username,job);}
    return json(res,200,await balancePending.get(user.username));
   }
   if(pathname==='/account/qq/groups'&&req.method==='GET'){
    if(url.searchParams.get('refresh')==='1')rate('groups:'+user.username,6,60000);const cached=groupCache.get(user.username);if(url.searchParams.get('refresh')!=='1'&&cached&&Date.now()-cached.at<60000)return json(res,200,cached.rows);
    if(!groupPending.has(user.username)){const job=(async()=>{const qq=await tenants.qqStatus(user.username);if(!qq.loggedIn)throw error(400,'请先完成QQ登录');const value=await tenants.runtime('groups',user.username);const rows=value.groups||[];groupCache.set(user.username,{rows,at:Date.now()});return rows;})().finally(()=>groupPending.delete(user.username));groupPending.set(user.username,job);}
    return json(res,200,await groupPending.get(user.username));
   }
   if(pathname==='/account/balance'&&req.method==='POST'){rate(`balance:${user.username}`,6,60000);return json(res,200,await tenants.exclusive(user.username,()=>tenants.balance(user.username)));}
   if(pathname==='/account/qq/start'&&req.method==='POST'){rate(`provision:${user.username}`,3,60000);return json(res,200,await tenants.provision(user.username));}
   if(pathname==='/account/qq/status'&&req.method==='GET')return json(res,200,await tenants.qqStatus(user.username));
   if(pathname==='/account/qq/qr'&&req.method==='POST'){rate(`qr:${user.username}`,10,60000);return json(res,200,await tenants.qr(user.username,(await bodyOf(req)).refresh===true));}
   if(pathname==='/account/control'&&req.method==='POST')return json(res,200,await tenants.control(user.username,(await bodyOf(req)).action));
   if(pathname==='/account/password'&&req.method==='POST'){
    const body=await bodyOf(req),row=accounts.db.prepare('SELECT password,email,email_verified FROM users WHERE username=?').get(user.username);rate(`password:${user.username}`,5);
    if(!row.email||!row.email_verified)throw error(403,'请先绑定并验证邮箱');
    if(!await passwordMatches(body.current,row.password))throw error(400,'当前密码不正确');passwordCodes.assertVerified(user.username,body.proof);const encoded=await passwordHash(body.password);
    accounts.transaction(()=>{accounts.db.prepare('UPDATE users SET password=? WHERE username=?').run(encoded,user.username);accounts.db.prepare('DELETE FROM sessions WHERE username=?').run(user.username);accounts.db.prepare('DELETE FROM password_verified WHERE username=?').run(user.username);accounts.db.prepare('DELETE FROM password_codes WHERE username=?').run(user.username);accounts.audit(user.username,'password-update');});cookie(req,res,accounts.session(user.username));return json(res,200,{ok:true});
   }
   if(pathname==='/account/password/captcha'&&req.method==='POST'){rate('password-captcha:'+user.username,12,600000);if(!site.read().captcha.passwordEnabled)throw error(403,'改密图形验证已关闭');return json(res,200,registrationCodes.captchaFor('password',user.username,site.read().captcha));}
   if(pathname==='/account/password/code/request'&&req.method==='POST'){rate('password-code:'+user.username,5,3600000);const body=await bodyOf(req),row=accounts.db.prepare('SELECT password,email,email_verified FROM users WHERE username=?').get(user.username);if(!row.email||!row.email_verified)throw error(403,'请先绑定并验证邮箱');if(!await passwordMatches(body.current,row.password))throw error(400,'当前密码不正确');if(site.read().captcha.passwordEnabled)registrationCodes.solveFor('password',user.username,body.captchaChallenge,body.captchaAnswer);const issued=passwordCodes.issue(user.username);try{await site.passwordCode(user.username,row.email,issued.code);}catch(e){passwordCodes.invalidate(issued.challenge);throw e;}return json(res,200,{challenge:issued.challenge,retryAfter:issued.retryAfter,expiresIn:issued.expiresIn,message:'修改密码验证码已发送至绑定邮箱'});}
   if(pathname==='/account/password/code/verify'&&req.method==='POST'){rate('password-code-verify:'+user.username,20,600000);const body=await bodyOf(req);return json(res,200,passwordCodes.verify(user.username,body.challenge,body.code));}
   if(pathname.startsWith('/account/bili')){
    const bot=accounts.bot(user.username);if(!bot)throw error(400,'请先创建大肥鱼');
    if(pathname==='/account/bili/qr'&&req.method==='POST'){
     rate(`bili:${user.username}`,5,60000);const response=await request('https://passport.bilibili.com/x/passport-login/web/qrcode/generate',{signal:AbortSignal.timeout(15000)});const value=await response.json();if(value.code!==0)throw error(502,'B站二维码获取失败');biliPolls.set(user.username,{key:value.data.qrcode_key,expires:Date.now()+180000});return json(res,200,{image:await(await import('qrcode')).default.toDataURL(value.data.url,{width:360,margin:3})});
    }
    if(pathname==='/account/bili/poll'&&req.method==='POST'){
     rate(`bili-poll:${user.username}`,30,60000);const entry=biliPolls.get(user.username);if(!entry||entry.expires<Date.now())throw error(400,'二维码已过期，请重新获取');const response=await request('https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key='+encodeURIComponent(entry.key),{signal:AbortSignal.timeout(15000)});const value=await response.json();if(value.code!==0)throw error(502,'B站登录检查失败');
     if(value.data.code===0){const cookieValue=response.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');if(!/(?:^|;\s*)SESSDATA=/.test(cookieValue))throw error(502,'B站未返回完整登录信息');await tenants.updateBili(user.username,cookieValue);biliPolls.delete(user.username);return json(res,200,{loggedIn:true});}return json(res,200,{loggedIn:false,message:String(value.data.message||'等待扫码')});
    }
    if(pathname==='/account/bili/logout'&&req.method==='POST'){await tenants.updateBili(user.username,null);return json(res,200,{ok:true});}
   }
   if(pathname.startsWith('/admin/tenants/')){
    admin(user);
    if(req.method!=='GET')throw error(403,'管理员查看模式为只读，不能修改此大肥鱼');
    const match=pathname.match(/^\/admin\/tenants\/([a-z][a-z0-9_]{2,23})(\/.*)$/);
    if(!match)throw error(404,'只读面板地址无效');
    const name=match[1],apiPath=match[2];
    if(!accounts.user(name)||!accounts.bot(name))throw error(404,'该用户尚未创建大肥鱼');
    const allowed=new Set(['/api/session','/api/status','/api/message-status','/api/config','/api/persona','/api/persona/backups','/api/components','/api/logs','/api/activity','/api/qq-activity','/api/memories','/api/storage','/api/voices','/api/usage']);
    if(apiPath==='/qq/groups'){
     const cached=groupCache.get(name);if(cached&&Date.now()-cached.at<60000)return json(res,200,cached.rows);
     const status=await tenants.qqStatus(name);if(!status.loggedIn)throw error(400,'该用户的QQ尚未登录');
     const value=await tenants.runtime('groups',name),rows=value.groups||[];groupCache.set(name,{rows,at:Date.now()});return json(res,200,rows);
    }
    if(!allowed.has(apiPath)&&!/^\/api\/memories\/[1-9]\d*$/.test(apiPath)&&!/^\/api\/persona\/backups\/\d{13}-[a-f0-9]{12}\.md$/.test(apiPath))throw error(403,'该接口不在只读面板允许范围');
    const auditKey='inspect-audit:'+user.username+':'+name;
    if(!rates.has(auditKey)){accounts.audit(user.username,'tenant-inspect',name);rates.set(auditKey,{until:Date.now()+600000,count:0});}
    const panel=await panelFor(name),targetPort=panel.address().port;
    const proxy=http.request({hostname:'127.0.0.1',port:targetPort,path:apiPath+url.search,method:'GET',headers:{host:'127.0.0.1:'+targetPort,'x-panel-token':req.headers['x-panel-token']||''}},upstream=>{res.statusCode=upstream.statusCode;res.setHeader('Content-Type',upstream.headers['content-type']||'application/json');upstream.pipe(res);});
    proxy.setTimeout(30000,()=>proxy.destroy());proxy.on('error',()=>{if(!res.headersSent)json(res,502,{error:'只读面板暂时不可用'});else res.end();});proxy.end();return;
   }
   if(pathname.startsWith('/admin/')){
    admin(user);
    if(pathname==='/admin/settings'&&req.method==='GET')return json(res,200,site.safe());
    if(pathname==='/admin/components'&&req.method==='GET')return json(res,200,{...getPolicy(),components:componentCatalog.map(c=>({id:c.id,name:c.name,description:c.description,unavailable:!!c.unavailable,enabled:!c.unavailable&&!getPolicy().disabled.includes(c.id)}))});
    if(pathname==='/admin/overview'&&req.method==='GET')return json(res,200,{users:accounts.db.prepare('SELECT users.username,users.role,users.disabled,users.created,users.email,users.email_verified,users.email_pending,bots.qq,bots.desired,bots.billing FROM users LEFT JOIN bots USING(username) ORDER BY users.created').all(),invites:accounts.db.prepare('SELECT id,created_by,expires,max_uses,uses,revoked FROM invites ORDER BY expires DESC LIMIT 100').all(),audit:accounts.db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 100').all()});
    const body=req.method==='POST'?await bodyOf(req):{};
    if(pathname==='/admin/settings'&&req.method==='POST'){const current=site.read();if(!user.email&&(body.registrationMode!==current.registrationMode||body.emailActivation!==current.emailActivation||JSON.stringify(body.captcha??current.captcha)!==JSON.stringify(current.captcha)))throw error(403,'绑定邮箱前仅允许配置发信，不能修改注册或验证码规则');return json(res,200,site.save(body,user.username));}
    if(pathname==='/admin/settings/mail-preview'&&req.method==='POST'){rate('mail-preview:'+user.username,60,60000);return json(res,200,site.preview(body.template,body.kind));}
    if(pathname==='/admin/settings/test-email'&&req.method==='POST'){rate('smtp-test:'+user.username,6,3600000);await site.testMessage(body.email,body.kind);accounts.audit(user.username,'smtp-test');return json(res,200,{ok:true,message:'测试邮件已提交，请检查收件箱与垃圾邮件'});}
    if(pathname==='/admin/components'&&req.method==='POST'){const item=componentCatalog.find(c=>c.id===body.id);if(!item||typeof body.enabled!=='boolean')throw error(400,'组件配置无效');if(item.unavailable&&body.enabled)throw error(403,'该组件尚未开放');const old=getPolicy();if(body.revision!==old.revision)throw error(409,'站点策略已更新，请刷新后重试');const disabled=new Set(old.disabled);body.enabled?disabled.delete(item.id):disabled.add(item.id);const policy={disabled:[...disabled],revision:token(),updatedAt:Date.now()};atomicWriteFile(policyFile,JSON.stringify(policy));syncPolicy();accounts.audit(user.username,body.enabled?'component-enable':'component-disable',item.id);return json(res,200,{ok:true});}
    if(pathname==='/admin/invites'&&req.method==='POST')return json(res,201,accounts.invite(user.username,body.maxUses,body.days));
    if(pathname==='/admin/revoke'&&req.method==='POST'){accounts.db.prepare('UPDATE invites SET revoked=1 WHERE id=?').run(String(body.id));accounts.audit(user.username,'invite-revoke',String(body.id));return json(res,200,{ok:true});}
    if(pathname==='/admin/user'&&req.method==='POST'){
     if(body.username===user.username)throw error(400,'不能通过此处操作自己的账号');const target=accounts.user(body.username);if(!target)throw error(404,'用户不存在');
     if(body.action==='disable'){accounts.db.prepare('UPDATE users SET disabled=1 WHERE username=?').run(target.username);accounts.db.prepare('DELETE FROM sessions WHERE username=?').run(target.username);if(accounts.bot(target.username)){accounts.db.prepare('UPDATE bots SET desired=0 WHERE username=?').run(target.username);await tenants.runtime('stop-all',target.username);}accounts.audit(user.username,'disable',target.username);}
     else if(body.action==='enable'){accounts.db.prepare('UPDATE users SET disabled=0 WHERE username=?').run(target.username);accounts.audit(user.username,'enable',target.username);}
     else if(body.action==='reset'){return json(res,200,{activation:accounts.activation(target.username)});}
     else if(body.action==='delete'){
      if(target.role==='admin')throw error(403,'不能删除站点管理员');
      if(body.confirmUsername!==target.username)throw error(400,'请准确输入用户名确认删除');
      await tenants.exclusive(target.username,async()=>{
       accounts.db.prepare('UPDATE users SET disabled=1 WHERE username=?').run(target.username);
       accounts.db.prepare('UPDATE bots SET desired=0 WHERE username=?').run(target.username);
       const pending=panels.get(target.username);panels.delete(target.username);
       if(pending){const panel=await pending.catch(()=>null);if(panel){panel.closeAllConnections();await new Promise(resolve=>panel.close(resolve));}}
       await tenants.runtime('delete-tenant',target.username);
       accounts.deleteUser(target.username,user.username);
       tenants.balances.delete(target.username);tenants.loginKeys.delete(target.username);tenants.recovery.delete(target.username);
       snapshots.delete(target.username);logs.delete(target.username);groupCache.delete(target.username);biliPolls.delete(target.username);
       tenants.syncPeers();syncPolicy();
      });
     }
     else throw error(400,'无效用户操作');return json(res,200,{ok:true});
    }
    throw error(404,'管理接口不存在');
   }
   if(pathname==='/panel'||pathname.startsWith('/api/')||['/app.js','/style.css','/theme.js'].includes(pathname)){
    if(!accounts.bot(user.username))throw error(400,'请先创建大肥鱼');
    const panel=await panelFor(user.username),targetPort=panel.address().port;
    const headers={...req.headers,host:`127.0.0.1:${targetPort}`,origin:`http://127.0.0.1:${targetPort}`};delete headers.cookie;delete headers.authorization;
    const proxy=http.request({hostname:'127.0.0.1',port:targetPort,path:pathname==='/panel'?'/':req.url,method:req.method,headers},upstream=>{
     if(pathname==='/panel'){let html='';upstream.on('data',chunk=>html+=chunk);upstream.on('end',()=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(html.replace('<script defer src="/app.js"></script>','<script defer src="/tenant-bar.js"></script><script defer src="/app.js"></script>').replace('面板端口变更需重新打开 start.cmd。','账号连接在账号设置中管理。').replace('密钥仍保存在本机 .env 文件中。','密钥在账号设置中加密保存。').replace('正在读取本机保存的状态…','正在读取你的大肥鱼状态…'));});}
     else{res.statusCode=upstream.statusCode;res.setHeader('Content-Type',upstream.headers['content-type']||'application/json');upstream.pipe(res);}
    });proxy.setTimeout(180000,()=>proxy.destroy());proxy.on('error',()=>{if(!res.headersSent)json(res,502,{error:'控制室暂时不可用，请重试'});else res.end();});req.pipe(proxy);return;
   }
   throw error(404,'页面不存在');
  }catch(e){if(!res.headersSent)json(res,e.status||400,{error:e.status?e.message:cleanError(e)});else res.end();}
 });
 const cleanError=e=>{const text=String(e.message);return /sk-|cookie|token|command failed|fetch failed|ECONN|SQLITE|UNIQUE/i.test(text)?'操作未完成，请检查连接状态或稍后重试':text.slice(0,240);};
 const biliPolls=new Map(),groupCache=new Map(),groupPending=new Map(),balancePending=new Map();
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});actualPort=server.address().port;allowedOrigins.add(`http://127.0.0.1:${actualPort}`);allowedOrigins.add(`http://localhost:${actualPort}`);
 tenants.syncPeers();syncPolicy();await tenants.tick();
 const timer=setInterval(async()=>{if(ticking||closing)return;ticking=true;try{tenants.syncPeers();syncPolicy();await tenants.tick();for(const name of panels.keys()){await refresh(name).catch(()=>{});logs.set(name,await tenants.logs(name).catch(()=>[]));}for(const[k,v]of rates)if(v.until<Date.now())rates.delete(k);}finally{ticking=false;}},5000);timer.unref();
 async function close(){closing=true;clearInterval(timer);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));for(const pending of panels.values()){const panel=await pending.catch(()=>null);if(panel){panel.closeAllConnections();await new Promise(resolve=>panel.close(resolve));}}while(ticking)await new Promise(r=>setTimeout(r,20));accounts.close();}
 return {server,accounts,tenants,registrationCodes,passwordCodes,close};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const manager=await startManager();console.log('大肥鱼账户管理服务已启动');for(const signal of['SIGINT','SIGTERM'])process.once(signal,async()=>{await manager.close();process.exit(0);});
}

