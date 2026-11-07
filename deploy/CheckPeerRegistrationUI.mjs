import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startManager } from '../manager/server.js';
import { passwordHash } from '../manager/accounts.js';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-manager-ui-')),report='/opt/dafeiyu/backups/peer-registration-20261027/preview';fs.mkdirSync(report,{recursive:true});
const manager=await startManager({dataRoot:root,port:0,origins:[],runtime:async operation=>operation==='logs'?{text:'UI test only'}:{phase:'stopped',qqRunning:false},request:async()=>Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'10.00'}]})});
manager.accounts.db.prepare('INSERT INTO users(username,password,role,created,email) VALUES(?,?,?,?,lower(hex(randomblob(8)))||char(64,101,120,97,109,112,108,101,46,116,101,115,116))').run('yutori',await passwordHash('ui-test-password-123'),'admin',Date.now());
await manager.tenants.create('yutori',{apiKey:'ui-test-key',qq:'12345678',adminQQ:'87654321'});
for(const fixtureUser of ['yutori','alice']){const fixtureFile=path.join(typeof fixtureRoot!=='undefined'?fixtureRoot:root,fixtureUser,'state.json');if(fs.existsSync(fixtureFile)){const fixtureState=JSON.parse(fs.readFileSync(fixtureFile));for(const user of Object.values(fixtureState.feelings?.users||{}))user.qqNickname=user.name;fs.writeFileSync(fixtureFile,JSON.stringify(fixtureState));}}
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 const base='http://127.0.0.1:'+manager.server.address().port;
 await page.goto(base+'/register');await page.getByLabel('确认密码',{exact:true}).waitFor();
 await page.getByLabel('用户名',{exact:true}).fill('yutori');await page.getByLabel('设置密码',{exact:true}).focus();await page.getByRole('status').filter({hasText:'该用户名已被使用，请换一个'}).waitFor();
 await page.getByLabel('用户名',{exact:true}).fill('newperson');await page.getByLabel('设置密码',{exact:true}).focus();await page.getByRole('status').filter({hasText:'该用户名可以使用'}).waitFor();
 await page.getByLabel('设置密码',{exact:true}).fill('sample-password-123');await page.getByLabel('确认密码',{exact:true}).fill('different-password');assert.equal(await page.locator('#passwordConfirm').evaluate(el=>el.checkValidity()),false);
 await page.getByLabel('确认密码',{exact:true}).fill('sample-password-123');assert.equal(await page.locator('#passwordConfirm').evaluate(el=>el.checkValidity()),true);await page.screenshot({path:report+'/register-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:report+'/register-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
 await page.goto(base+'/login');await page.getByLabel('用户名',{exact:true}).waitFor();await page.screenshot({path:report+'/login-desktop.png',fullPage:true});
 await page.getByLabel('外观主题').selectOption('dark');await page.screenshot({path:report+'/login-dark.png',fullPage:true});await page.getByLabel('外观主题').selectOption('light');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:report+'/login-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByLabel('用户名',{exact:true}).fill('yutori');await page.getByLabel('密码',{exact:true}).fill('ui-test-password-123');await page.getByRole('button',{name:'登录',exact:true}).click();await page.waitForURL('**/account');await page.getByText('QQ 12345678',{exact:true}).waitFor();await page.screenshot({path:report+'/account-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:report+'/account-desktop.png',fullPage:true});
  await page.getByRole('tab',{name:'账号连接',exact:true}).click();await page.getByRole('button',{name:'打开扫码登录',exact:true}).waitFor({state:'visible'});assert.equal(await page.locator('#pane-connections .account-risk').count(),1);await page.screenshot({path:report+'/connections-desktop.png',fullPage:true});
 await page.getByRole('tab',{name:'密钥与安全',exact:true}).click();await page.getByLabel('新的 API Key',{exact:true}).waitFor({state:'visible'});await page.screenshot({path:report+'/security-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:report+'/security-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1440,height:1000});await page.getByRole('tab',{name:'实例概览',exact:true}).click();await page.getByLabel('外观主题').selectOption('dark');await page.screenshot({path:report+'/account-dark.png',fullPage:true});await page.getByLabel('外观主题').selectOption('light');
 await page.getByRole('link',{name:'站点管理',exact:true}).click();await page.getByRole('heading',{name:'用户管理',exact:true}).waitFor();await page.screenshot({path:report+'/admin-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'生成邀请码',exact:true}).click();await page.getByText('邀请码已生成',{exact:true}).waitFor();
 await page.getByRole('link',{name:'她的控制室',exact:true}).click();await page.getByText('账号：yutori',{exact:true}).waitFor();await page.waitForFunction(()=>document.getElementById('serviceBadge').textContent!=='连接中');assert.ok(!(await page.locator('#notice').textContent()).includes('Cannot'));await page.screenshot({path:report+'/panel-desktop.png',fullPage:true});
  await page.getByLabel('外观主题').selectOption('dark');await page.screenshot({path:report+'/panel-dark.png',fullPage:true});await page.getByLabel('外观主题').selectOption('light');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:report+'/panel-mobile.png',fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const fresh=await browser.newContext();const freshPage=await fresh.newPage();await freshPage.goto(base+'/panel');assert.match(freshPage.url(),/\/login\?next=%2Fpanel$/);await freshPage.getByLabel('用户名',{exact:true}).fill('yutori');await freshPage.getByLabel('密码',{exact:true}).fill('ui-test-password-123');await freshPage.getByRole('button',{name:'登录',exact:true}).click();await freshPage.waitForURL('**/panel');await fresh.close();
 assert.equal(await page.locator('[data-path="social.browserPath"]').count(),0);assert.deepEqual(errors,[]);console.log(JSON.stringify({screenshots:13,browserErrors:errors,login:true,account:true,admin:true,invite:true,panel:true,mobileOverflow:false}));
}finally{await browser.close();await manager.close();fs.rmSync(root,{recursive:true,force:true});}

