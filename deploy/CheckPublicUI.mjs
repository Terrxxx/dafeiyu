import fs from 'node:fs';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {Accounts,hash} from '../manager/accounts.js';
const accounts=new Accounts('/opt/dafeiyu/data/.platform'),session=accounts.session('yutori'),base='https://dafeiyu.yrxs.net',report='/opt/dafeiyu/backups/ui-redesign-20261027';
let browser;
try{
 const unauth=await fetch(base+'/panel?view=logs',{redirect:'manual',headers:{Accept:'text/html'}});assert.equal(unauth.status,302);assert.equal(unauth.headers.get('location'),'/login?next=%2Fpanel%3Fview%3Dlogs');
 const api=await fetch(base+'/account/status',{redirect:'manual'});assert.equal(api.status,401);
 browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'America/New_York'}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base+'/panel');assert.match(page.url(),/\/login\?next=%2Fpanel$/);await page.getByRole('heading',{name:'登录控制台',exact:true}).waitFor();
 await context.addCookies([{name:'dfy_session',value:session.value,domain:'dafeiyu.yrxs.net',path:'/',httpOnly:true,secure:true,sameSite:'Strict'}]);
 await page.goto(base+'/account');await page.getByRole('tab',{name:'实例概览',exact:true}).waitFor();await page.getByRole('heading',{name:'我的大肥鱼',exact:true}).waitFor();await page.screenshot({path:report+'/public-account.png',fullPage:true});
 await page.getByRole('tab',{name:'账号连接',exact:true}).click();await page.getByRole('button',{name:'打开扫码登录',exact:true}).waitFor({state:'visible'});
 assert.deepEqual(errors,[]);
 const bad=await fetch(base+'/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://invalid.example',Cookie:'dfy_session='+session.value,'X-CSRF-Token':session.csrf},body:'{}'});assert.equal(bad.status,403);
 const logout=await fetch(base+'/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,Cookie:'dfy_session='+session.value,'X-CSRF-Token':session.csrf},body:'{}'});assert.equal(logout.status,200);assert.match(logout.headers.get('set-cookie'),/; Secure/);
 const result={checkedAt:new Date().toISOString(),https:true,certificateValidated:true,unauthenticatedPageRedirect:true,api401:true,authenticatedPage:true,tabs:true,originProtected:true,secureCookie:true,browserErrors:errors};fs.writeFileSync(report+'/public-verification.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser?.close();accounts.db.prepare('DELETE FROM sessions WHERE digest=?').run(hash(session.value));accounts.close();}
