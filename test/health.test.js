import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store}from'../src/store.js';import{Feelings}from'../src/feelings.js';import{Sleep}from'../src/sleep.js';import{lifeView,saveLifeControls}from'../src/life-controls.js';
test('旧健康数值不再影响接话、没有心率和健康提示词，精力睡眠保持生效',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-no-health-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const at=Date.parse('2026-10-30T12:00:00+08:00'),store=new Store(dir),feelings=new Feelings(store,()=>at);store.data.health={value:0,restingHeartRate:40,history:[]};feelings.data.mood.energy=80;
 const old=JSON.stringify(store.data.health),sleep=new Sleep(store,feelings,()=>at,()=>0);
 assert.equal(sleep.responseMode(),'normal');assert.ok(!Object.hasOwn(sleep,'health'));assert.doesNotMatch(sleep.prompt(),/心率|虚拟健康|健康状态/);assert.equal(JSON.stringify(store.data.health),old);
 assert.ok(!Object.hasOwn(lifeView(dir,store.data),'health'));assert.throws(()=>saveLifeControls(dir,{revision:'',health:{value:100}}),/已移除/);
 feelings.data.mood.energy=0;assert.equal(sleep.responseMode(),'sleep');
});
