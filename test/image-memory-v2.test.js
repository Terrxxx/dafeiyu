import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store}from'../src/store.js';import{MediaLibrary}from'../src/media.js';import{imageDescription}from'../src/image-description.js';import{checklistMarkdown}from'../src/checklist-markdown.js';import{SocialTools}from'../src/tools.js';
import { markdownData } from '../src/markdown-input.js';
import { Agent } from '../src/agent.js';
import { HarnessAgent } from '../src/harness-agent.js';
const dir=t=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-image-v2-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;};
test('6位图片ID防碰撞、兼容旧哈希、跨重启稳定，内容校验与私聊隔离有效',t=>{
 const store=new Store(dir(t));let i=0;const ids=['abcdef','abcdef','123abc'];const media=new MediaLibrary(store,()=>ids[i++]);
 const a=media.ingest('data:image/png;base64,YQ==','一'.repeat(200),'qq:user:1'),b=media.ingest('data:image/png;base64,Yg==','二','qq:user:1');assert.equal(a.id,'abcdef');assert.equal(b.id,'123abc');assert.equal(Array.from(a.description).length,100);
 const item=media.get(a.id,'qq:user:1');assert.match(item.storageId,/^[a-f0-9]{64}$/);assert.equal(media.bytes(item).toString(),'a');assert.equal(media.get(item.storageId,'qq:user:1').id,a.id);assert.throws(()=>media.get(a.id,'qq:user:2'));
 const reloaded=new MediaLibrary(new Store(path.dirname(store.file)));assert.equal(reloaded.get(item.storageId,'qq:user:1').id,a.id);
 media.markSent(a.id);assert.ok(!Object.hasOwn(media.list('qq:user:1').find(x=>x.id===a.id),'description'));assert.equal(media.get(a.id,'qq:user:1').description.length,100);
});
test('已发送图片只返回短ID、历史不带描述，描述可按需取回',async t=>{
 const store=new Store(dir(t)),tools=new SocialTools({qq:{enabled:true,adminUsers:['1']},social:{},agent:{historyMessages:20,maxOutgoingPerHour:20}},store,{call:async()=>({message_id:123})},{});
 tools.begin('qq:user:1',{kind:'private',target:'1',sender:'1',key:'image-send',id:'msg'});
 const a=tools.media.ingest('data:image/png;base64,YQ==','小鱼在挥手','qq:user:1');const sent=await tools.call('qq_send_image',{kind:'private',target:'1',imageId:a.id});assert.deepEqual(sent,{imageId:a.id});assert.equal(store.context('qq:user:1').at(-1).content,'[图片 '+a.id+']');assert.equal((await tools.call('qq_read_image',{imageId:a.id})).description,'小鱼在挥手');
});
test('识图100字符含emoji，记忆清单提取用户与日期不重复且秒级、正文不丢',()=>{
 assert.equal(Array.from(imageDescription('🐟'.repeat(200))).length,100);
 const text='## 2026-10-28 · 记忆清单\n- 用户（2026-10-28T11:00:00.123Z）：喜欢草莓\n- 大肥鱼（2026-10-28T11:01:00.456Z）：记住啦\n- 已确认记忆（2026-10-28T11:02:00.789Z）：不要在群里提\n  第二行原文';
 const out=checklistMarkdown(text,{id:'123456',name:'朋友'},{data:{}},'qq:user:123456',Date.parse('2026-10-29T00:00:00Z'));assert.equal((out.match(/2026-10-28/g)||[]).length,1);assert.equal((out.match(/朋友\(123456\)/g)||[]).length,1);assert.ok(out.includes('19:00:00'));assert.ok(!out.includes('.123'));for(const s of ['喜欢草莓','记住啦','不要在群里提','第二行原文'])assert.ok(out.includes(s));
 const custom='手工备注\n## 特别记录\n不要改动';assert.equal(checklistMarkdown(custom,{id:'123456',name:'朋友'},{data:{}},'qq:user:123456'),custom);
});
test('时间元数据到秒，用户正文中的毫秒原文保持；两种识图引擎均硬截100字符',async()=>{
 const text=markdownData({time:'2026-10-28T11:00:00.123Z',wokeAt:1793185200123,text:'日志里的2026-10-28T11:00:00.123Z'});
 assert.ok(text.includes('time: 2026-10-28T11:00:00Z'));assert.ok(text.includes('text: 日志里的2026-10-28T11:00:00.123Z'));assert.ok(!/wokeAt: .*\.\d+Z/.test(text));
 const direct=Object.create(Agent.prototype);direct.tools={};direct.vision=async(_p,_images,max)=>{assert.equal(max,180);return '喵'.repeat(300);};assert.equal(Array.from(await direct.describeImage('data:image/png;base64,YQ==')).length,100);
 const harness=Object.create(HarnessAgent.prototype);harness.tools={};harness.runtime={run:async(_p,options)=>{assert.equal(options.maxTokens,180);return '🐟'.repeat(300);}};assert.equal(Array.from(await harness.describeImage('data:image/png;base64,YQ==')).length,100);
});
