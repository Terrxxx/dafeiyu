import assert from 'node:assert/strict';
import fs from 'node:fs';
import {Accounts,hash} from '../manager/accounts.js';
const accounts=new Accounts('/opt/dafeiyu/data/.platform'),session=accounts.session('yutori'),base='http://192.168.1.149:3081';
async function get(route,auth=true,extra={}){const response=await fetch(base+route,{headers:{...(auth?{Cookie:'dfy_session='+session.value}:{}),...extra}});return {response,value:await response.json()};}
try{
 const page=await fetch(base+'/login');assert.equal(page.status,200);assert.ok(!(page.headers.get('www-authenticate')));assert.match(await page.text(),/id="root"/);
 assert.equal((await get('/account/status',false)).response.status,401);assert.equal((await get('/api/session',false)).response.status,401);
 const account=await get('/account/status');assert.equal(account.value.username,'yutori');assert.equal(account.value.role,'admin');assert.equal(account.value.bot.phase,'running');assert.equal(account.value.bot.billing,null);
 const qq=await get('/account/qq/status');assert.equal(qq.value.loggedIn,true);
 const panelSession=(await get('/api/session')).value.token;
 const users=await get('/api/memories',true,{'X-Panel-Token':panelSession});assert.equal(users.response.status,200);assert.ok(users.value.length>=29);
 const settings=await get('/api/config',true,{'X-Panel-Token':panelSession});const secrets=accounts.bot('yutori').secrets;for(const key of[secrets.apiKey,secrets.napcatToken,secrets.webuiToken,secrets.biliCookie])if(key)assert.ok(!JSON.stringify(settings.value).includes(key));
 const publicChecks=await Promise.all([fetch(base+'/manager.js'),fetch(base+'/manager.css'),fetch(base+'/fish.svg')]);assert.ok(publicChecks.every(r=>r.status===200));
 const result={checkedAt:new Date().toISOString(),loginPage:200,oldBasicAuth:false,unauthenticatedBlocked:true,account:'yutori',role:'admin',agentRunning:true,qqLoggedIn:true,userMemories:users.value.length,configSecretsExposed:false};
 fs.writeFileSync('/opt/dafeiyu/data/.platform/online-verification.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));
}finally{accounts.db.prepare('DELETE FROM sessions WHERE digest=?').run(hash(session.value));accounts.close();}
