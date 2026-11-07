import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright-core';
import {startManager} from '../manager/server.js';
import {SiteSettings} from '../manager/site-settings.js';
import {passwordHash,passwordMatches} from '../manager/accounts.js';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-password-ui-')),sent=[];
const manager=await startManager({dataRoot:root,port:0,origins:[],runtime:async()=>({phase:'stopped'}),mailerFactory:()=>({verify:async()=>{},sendMail:async mail=>{sent.push(mail);return{accepted:[mail.to]};},close(){}})});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
try{
  manager.accounts.db.prepare('INSERT INTO users(username,password,role,created,email,email_verified) VALUES(?,?,?,?,?,1)').run('owner',await passwordHash('owner-password-123'),'admin',Date.now(),'owner@example.test');
  manager.accounts.db.prepare('INSERT INTO bots(username,qq,secrets,created) VALUES(?,?,?,?)').run('owner','12345678',manager.accounts.encrypt({apiKey:'testing-only',napcatToken:'testing-only',webuiToken:'testing-only'},'owner'),Date.now());
  fs.mkdirSync(path.join(root,'owner'));
  const site=new SiteSettings(manager.accounts);site.save({...site.safe(),registrationMode:'open',smtp:{host:'smtp.example.test',port:465,encryption:'tls',from:'sender@example.test'}},'owner');
  const base='http://127.0.0.1:'+manager.server.address().port,page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base+'/login');await page.getByLabel('用户名或邮箱').fill('owner');await page.getByLabel('密码',{exact:true}).fill('owner-password-123');await page.getByRole('button',{name:'登录工作空间'}).click();await page.waitForURL(base+'/account');
  await page.goto(base+'/account#security');await page.getByLabel('当前密码').fill('owner-password-123');await page.getByRole('button',{name:'发送邮箱验证码'}).click();await page.getByLabel('邮箱验证码',{exact:true}).waitFor();assert.equal(sent.length,1);
  await page.getByLabel('邮箱验证码',{exact:true}).fill(sent[0].text.match(/验证码为：(\d{6})/)[1]);await page.getByRole('button',{name:'验证邮箱'}).click();await page.getByLabel('新密码',{exact:true}).fill('new-owner-password-456');await page.getByLabel('确认新密码',{exact:true}).fill('new-owner-password-456');await page.getByRole('button',{name:'更新密码'}).click();await page.getByText('密码已更新，其他会话已退出').waitFor();
  assert.equal(await passwordMatches('new-owner-password-456',manager.accounts.db.prepare('SELECT password FROM users WHERE username=?').get('owner').password),true);
  await page.goto(base+'/admin#settings');await page.getByRole('button',{name:'保存站点设置'}).waitFor();assert.equal(await page.getByRole('button',{name:'保存邮箱设置'}).count(),0);assert.equal(await page.getByRole('button',{name:'保存验证码设置'}).count(),0);
  await page.goto(base+'/admin#email');await page.getByRole('button',{name:'保存邮箱设置'}).waitFor();await page.getByText('发送测试邮件').waitFor();assert.equal(await page.getByRole('button',{name:'保存站点设置'}).count(),0);
  await page.goto(base+'/admin#captcha');await page.getByRole('button',{name:'保存验证码设置'}).waitFor();assert.equal(await page.getByRole('button',{name:'保存邮箱设置'}).count(),0);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('label.switch-row').filter({hasText:'登录图形验证'}).locator('input').check();await page.getByLabel('长度',{exact:true}).fill('4');await page.locator('label.field').filter({hasText:'模式'}).locator('select').selectOption('digits');await page.getByRole('button',{name:'保存验证码设置'}).click();await page.getByText('验证码设置已保存').waitFor();
  assert.equal(site.read().captcha.loginEnabled,true);assert.equal(site.read().captcha.length,4);
  manager.registrationCodes.captchaCode=()=> '1234';
  const other=await browser.newContext({viewport:{width:390,height:844}}),login=await other.newPage();login.on('pageerror',e=>errors.push(e.message));await login.goto(base+'/login');await login.getByLabel('用户名或邮箱').fill('owner');await login.getByLabel('密码',{exact:true}).fill('new-owner-password-456');await login.getByRole('button',{name:'登录工作空间'}).click();await login.getByRole('dialog',{name:'人机验证'}).waitFor();await login.getByLabel('图片中的字符').fill('1234');await login.getByRole('button',{name:'登录工作空间'}).last().click();await login.waitForURL(base+'/account');
  assert.ok(await login.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  manager.accounts.db.prepare('UPDATE users SET email=NULL,email_verified=0 WHERE username=?').run('owner');
  await page.goto(base+'/bind-email#smtp');await page.getByRole('button',{name:'保存邮箱设置'}).waitFor();assert.equal(await page.getByRole('button',{name:'保存站点设置'}).count(),0);
  assert.deepEqual(errors,[]);console.log('password-captcha-ui-ok');
}finally{await browser.close();await manager.close();fs.rmSync(root,{recursive:true,force:true});}
