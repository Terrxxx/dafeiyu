import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Accounts, passwordMatches, hash } from '../manager/accounts.js';
import { startManager } from '../manager/server.js';
import { checkBalance } from '../manager/runtime-client.js';
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'dfy-accounts-'));
test('invitations are atomic and single use; encrypted secrets are owner bound',async()=>{
 const root=temporary(),accounts=new Accounts(root);
 try{
  accounts.db.prepare('INSERT INTO users(username,role,created,email) VALUES(?,?,?,lower(hex(randomblob(8)))||char(64,101,120,97,109,112,108,101,46,116,101,115,116))').run('yutori','admin',Date.now());
  const invite=accounts.invite('yutori');
  const results=await Promise.allSettled([accounts.register('alice','alice-password-123',invite.code,{email:'alice@example.test'}),accounts.register('bob','bob-password-1234',invite.code,{email:'bob@example.test'})]);
  assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(accounts.db.prepare('SELECT COUNT(*) AS n FROM users').get().n,2);
  assert.equal(await passwordMatches('wrong',''),false);
  const encrypted=accounts.encrypt({apiKey:'sk-private'},'alice');assert.ok(!encrypted.includes('sk-private'));
  assert.deepEqual(accounts.decrypt(encrypted,'alice'),{apiKey:'sk-private'});assert.throws(()=>accounts.decrypt(encrypted,'bob'));
  assert.throws(()=>accounts.db.prepare('INSERT INTO bots VALUES (?,?,?,?,?,?,?)').run('missing','123456',encrypted,0,null,Date.now(),0));
 }finally{accounts.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('activation is single use; sessions are invalidated on password replacement',async()=>{
 const root=temporary(),accounts=new Accounts(root);try{
  accounts.db.prepare('INSERT INTO users(username,role,created,email) VALUES(?,?,?,lower(hex(randomblob(8)))||char(64,101,120,97,109,112,108,101,46,116,101,115,116))').run('yutori','admin',Date.now());
  const session=accounts.session('yutori'),activation=accounts.activation('yutori');assert.equal(accounts.authenticate(session.value).username,'yutori');
  assert.equal(await accounts.activate(activation,'fresh-password-123'),'yutori');assert.equal(accounts.authenticate(session.value),null);
  await assert.rejects(accounts.activate(activation,'fresh-password-456'));
 }finally{accounts.close();fs.rmSync(root,{recursive:true,force:true});}
});
test('balance handling distinguishes no funds, invalid credentials and outages',async()=>{
 assert.equal((await checkBalance('sample-api-key',async()=>Response.json({is_available:false,balance_infos:[]}))).available,false);
 await assert.rejects(checkBalance('sample-api-key',async()=>new Response('',{status:401})),/无效/);
 await assert.rejects(checkBalance('sample-api-key',async()=>new Response('',{status:429})),/暂时/);
 await assert.rejects(checkBalance('sample-api-key',async()=>Response.json({})),/异常/);
});
test('manager isolates tenant panels and enforces auth, Origin, CSRF, admin privileges and duplicate limits',async()=>{
 const root=temporary(),calls=[];
 const runtime=async(operation,username,options)=>{calls.push({operation,username,options});return operation==='logs'?{text:'hello'}:{phase:'stopped',qqRunning:false};};
 const manager=await startManager({dataRoot:root,port:0,origins:[],runtime,request:async()=>Response.json({is_available:true,balance_infos:[{currency:'CNY',total_balance:'10'}]})});
 const base='http://127.0.0.1:'+manager.server.address().port;
 const invoke=async(route,body,session,extra={})=>{const response=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json',Origin:base,'X-CSRF-Token':session?.csrf||''}),...(session?{Cookie:'dfy_session='+session.value}:{}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});return {response,value:await response.json()};};
 try{
  manager.accounts.db.prepare('INSERT INTO users(username,role,created,email) VALUES(?,?,?,lower(hex(randomblob(8)))||char(64,101,120,97,109,112,108,101,46,116,101,115,116))').run('yutori','admin',Date.now());
  const admin=manager.accounts.session('yutori'),inv=manager.accounts.invite('yutori',2);
  await manager.accounts.register('alice','alice-password-123',inv.code,{email:'alice@example.test',emailVerified:true});await manager.accounts.register('bobby','bobby-password-123',inv.code,{email:'bobby@example.test',emailVerified:true});
  const alice=manager.accounts.session('alice'),bob=manager.accounts.session('bobby');
  assert.equal((await invoke('/account/status')).response.status,401);
  assert.equal((await invoke('/admin/overview',undefined,alice)).response.status,403);
  assert.equal((await invoke('/account/create',{apiKey:'some-api-key',qq:'1234567',adminQQ:'7654321'},alice,{'X-CSRF-Token':'wrong'})).response.status,403);
  assert.equal((await invoke('/account/create',{apiKey:'some-api-key',qq:'1234567',adminQQ:'7654321'},alice,{Origin:'https://evil.example'})).response.status,403);
  assert.equal((await invoke('/account/create',{apiKey:'some-api-key',qq:'1234567',adminQQ:'7654321'},alice)).response.status,201);
  assert.equal((await invoke('/account/create',{apiKey:'some-api-key',qq:'1234568',adminQQ:'7654321'},alice)).response.status,409);
  assert.equal((await invoke('/account/create',{apiKey:'some-api-key',qq:'1234567',adminQQ:'7654321'},bob)).response.status,400);
  assert.equal((await invoke('/account/create',{apiKey:'some-api-key',qq:'2234567',adminQQ:'7654321'},bob)).response.status,201);
  fs.writeFileSync(path.join(root,'alice','state.json'),JSON.stringify({feelings:{users:{'111':{name:'ONLY_ALICE',qqNickname:'ONLY_ALICE'}}}}));
  fs.writeFileSync(path.join(root,'bobby','state.json'),JSON.stringify({feelings:{users:{'222':{name:'ONLY_BOB',qqNickname:'ONLY_BOB'}}}}));
  const getPanel=async session=>{const tokenValue=(await invoke('/api/session',undefined,session)).value.token;return invoke('/api/memories',undefined,session,{'X-Panel-Token':tokenValue});};
  const av=await getPanel(alice),bv=await getPanel(bob);assert.equal(av.response.status,200);assert.ok(JSON.stringify(av.value).includes('ONLY_ALICE'));assert.ok(!JSON.stringify(av.value).includes('ONLY_BOB'));assert.ok(JSON.stringify(bv.value).includes('ONLY_BOB'));
  const account=await invoke('/account/status?username=alice',undefined,bob);assert.equal(account.value.username,'bobby');assert.ok(!JSON.stringify(account.value).includes('some-api-key'));
  assert.equal((await invoke('/admin/user',{username:'yutori',action:'disable'},admin)).response.status,400);
  await invoke('/admin/user',{username:'alice',action:'disable'},admin);assert.equal((await invoke('/account/status',undefined,alice)).response.status,401);
  assert.ok(calls.some(x=>x.username==='alice'&&x.operation==='stop-all'));
  const result=await invoke('/auth/login',{username:'bobby',password:'bobby-password-123'},undefined);assert.equal(result.response.status,200);assert.match(result.response.headers.get('set-cookie'),/HttpOnly/);
  const logout=await invoke('/auth/logout',{},bob);assert.equal(logout.response.status,200);assert.equal(manager.accounts.authenticate(bob.value),null);
 }finally{await manager.close();fs.rmSync(root,{recursive:true,force:true});}
});

test('managed model 402 writes its own billing marker and blocks subsequent calls',async()=>{
 const root=temporary();try{
  const {execFile}=await import('node:child_process'),{promisify}=await import('node:util');
  const source=`import assert from 'node:assert/strict';import fs from 'node:fs';import {billingRequest} from './src/billing.js';let events=0,calls=0;process.on('billing-empty',()=>events++);const wrapped=billingRequest(async()=>{calls++;return new Response('',{status:402});});await wrapped('https://api.deepseek.com/chat/completions');assert.equal(events,1);assert.equal(JSON.parse(fs.readFileSync(process.env.DAFEIYU_DATA_DIR+'/billing-status.json')).code,'insufficient_balance');await assert.rejects(wrapped('https://api.deepseek.com/chat/completions'),/余额不足/);assert.equal(calls,1);`;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',source],{env:{...process.env,DAFEIYU_MANAGED:'1',DAFEIYU_DATA_DIR:root}});
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('unauthenticated page navigation redirects to login and preserves local destination; API fetch remains JSON',async()=>{
 const root=temporary(),manager=await startManager({dataRoot:root,port:0,origins:[],runtime:async()=>({phase:'stopped'})});const base='http://127.0.0.1:'+manager.server.address().port;
 try{
  for(const target of ['/','/account','/admin','/panel','/other-page']){const response=await fetch(base+target,{redirect:'manual',headers:{Accept:'text/html'}});assert.equal(response.status,302);assert.equal(response.headers.get('location'),'/login?next='+encodeURIComponent(target));assert.ok(!(response.headers.get('content-type')||'').includes('application/json'));}
  const deep=await fetch(base+'/panel?view=logs',{redirect:'manual',headers:{Accept:'text/html'}});assert.equal(deep.headers.get('location'),'/login?next=%2Fpanel%3Fview%3Dlogs');
  const api=await fetch(base+'/account/status',{redirect:'manual'});assert.equal(api.status,401);assert.match(api.headers.get('content-type'),/application\/json/);
  assert.equal((await fetch(base+'/api/status',{redirect:'manual',headers:{Accept:'text/html'}})).status,302);
  for(const target of ['/login','/register','/activate','/manager.js','/manager.css','/fish.svg'])assert.equal((await fetch(base+target,{redirect:'manual'})).status,200);
 }finally{await manager.close();fs.rmSync(root,{recursive:true,force:true});}
});
