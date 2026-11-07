import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startManager } from '../manager/server.js';
import { passwordHash } from '../manager/accounts.js';

test('管理员删除用户需要准确确认，并清理账号与用户目录', async t => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-delete-'));
  const operations=[];
  const manager=await startManager({dataRoot:root,port:0,origins:[],runtime:async (operation,name)=>{
    operations.push([operation,name]);
    if(operation==='delete-tenant')fs.rmSync(path.join(root,name),{recursive:true,force:true});
    return {phase:'stopped'};
  }});
  t.after(async()=>{await manager.close();fs.rmSync(root,{recursive:true,force:true});});
  const db=manager.accounts.db;
  const password=await passwordHash('long-password-123');
  db.prepare('INSERT INTO users(username,password,role,created,email) VALUES(?,?,?,?,?)').run('owner',password,'admin',Date.now(),'owner@example.test');
  db.prepare('INSERT INTO users(username,password,created,email) VALUES(?,?,?,?)').run('alice',password,Date.now(),'alice@example.test');
  const issued=manager.passwordCodes.issue('alice');manager.passwordCodes.verify('alice',issued.challenge,issued.code);
  const directory=path.join(root,'alice');fs.mkdirSync(directory);fs.writeFileSync(path.join(directory,'memory.txt'),'private memory');
  const session=manager.accounts.session('owner');
  const base='http://127.0.0.1:'+manager.server.address().port;
  const post=(body,token=session.csrf)=>fetch(base+'/admin/user',{method:'POST',headers:{Origin:base,'Content-Type':'application/json',Cookie:'dfy_session='+session.value,'X-CSRF-Token':token},body:JSON.stringify(body)});
  assert.equal((await post({username:'alice',action:'delete',confirmUsername:'wrong'})).status,400);
  assert.equal((await post({username:'owner',action:'delete',confirmUsername:'owner'})).status,400);
  assert.ok(manager.accounts.user('alice'));
  assert.equal((await post({username:'alice',action:'delete',confirmUsername:'alice'},'wrong')).status,403);
  assert.equal((await post({username:'alice',action:'delete',confirmUsername:'alice'})).status,200);
  assert.equal(manager.accounts.user('alice'),undefined);
  assert.equal(fs.existsSync(directory),false);
  assert.ok(operations.some(([operation,name])=>operation==='delete-tenant'&&name==='alice'));
});
