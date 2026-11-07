import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MessageBuffer } from '../src/message-buffer.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { Agent } from '../src/agent.js';

function timers(){
  let elapsed=0,offset=0,id=0;const jobs=new Map();
  const clock={now:()=>elapsed+offset,set:(fn,ms)=>{jobs.set(++id,{fn,at:elapsed+ms});return id;},clear:key=>jobs.delete(key)};
  const advance=async at=>{elapsed=at;for(const [key,job]of [...jobs].sort((a,b)=>a[1].at-b[1].at)){if(jobs.has(key)&&job.at<=elapsed){jobs.delete(key);job.fn();}}for(let i=0;i<5;i++)await Promise.resolve();};
  return{clock,jobs,advance,jump:value=>{offset=value;}};
}
test('连续新消息不能重置最长等待，固定截止时一次提交完整批次',async()=>{
  const t=timers(),batches=[],buffer=new MessageBuffer(8000,25000,items=>batches.push(items),assert.fail,t.clock);
  for(const at of [0,7000,14000,21000,24000]){await t.advance(at);buffer.add({session:'a',id:String(at)});}
  assert.equal(batches.length,0);await t.advance(25000);assert.equal(batches.length,1);assert.equal(batches[0].length,5);
  assert.equal(t.jobs.size,0);assert.equal(buffer.sessions.size,0);
});
test('系统时间向后调整，独立最长等待定时器仍到时提交',async()=>{
  const t=timers(),batches=[],buffer=new MessageBuffer(8000,25000,items=>batches.push(items),assert.fail,t.clock);
  for(const at of [0,7000,14000,21000]){await t.advance(at);buffer.add({session:'a'});}
  t.jump(-86400000);await t.advance(24000);buffer.add({session:'a'});await t.advance(25000);
  assert.equal(batches.length,1);assert.equal(batches[0].length,5);
});
test('已经结束的批次回调不能提交同一会话的下一批消息，关闭清理所有定时器',async()=>{
  const t=timers(),batches=[],buffer=new MessageBuffer(8000,25000,items=>batches.push(items),assert.fail,t.clock);
  buffer.add({session:'a',id:'first'});const stale=[...t.jobs.values()][0].fn;
  await t.advance(8000);buffer.add({session:'a',id:'second'});stale();await t.advance(9000);assert.equal(batches.length,1);
  await t.advance(16000);assert.equal(batches.length,2);assert.equal(batches[1][0].id,'second');
  buffer.add({session:'b'});buffer.close();assert.equal(t.jobs.size,0);await t.advance(50000);assert.equal(batches.length,2);
});
test('处理失败释放批次并报告错误，下一批消息仍能正常处理',async()=>{
  const t=timers(),errors=[],batches=[];let first=true;
  const buffer=new MessageBuffer(1000,5000,items=>{if(first){first=false;throw Error('模拟失败');}batches.push(items);},e=>errors.push(e.message),t.clock);
  buffer.add({session:'a'});await t.advance(1000);assert.deepEqual(errors,['模拟失败']);assert.equal(buffer.sessions.size,0);
  buffer.add({session:'a'});await t.advance(2000);assert.equal(batches.length,1);
});
test('低精力和睡前收尾都明确记录处理结束，不调用模型，原话保留，下一条仍可正常回复',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-wait-state-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),logs=[],sent=[],config={qq:{enabled:true,adminUsers:['1']},agent:{historyMessages:64,maxOutgoingPerHour:100}};
  const qq={send:async(k,id,text)=>{sent.push(text);return{message_id:1};}};
  const tools=new SocialTools(config,store,qq,{});t.after(()=>tools.components.close());
  let mode='silent',winding=false,requests=0;
  tools.sleep={sleeping:()=>false,responseMode:()=>mode,windDown:()=>({active:winding}),assertAwake(){}};
  const agent=new Agent(config,store,tools);agent.planQQTurn=async()=>{requests++;return{reply:'在呢'};};
  const services={agent,tools,store,qq,throttle:{wait:async()=>{}},log:s=>logs.push(s)};
  const msg={kind:'private',session:'qq:user:1',target:'1',sender:'1',id:'1',text:'第一条消息',images:[]};
  await handleQQMessage(msg,'one',services);assert.equal(requests,0);assert.equal(sent.length,0);assert.match(logs.at(-1),/本批判断结束.*精力不足.*消息已保存/);
  assert.equal(store.data.actions.one.state,'low-energy-silent');assert.ok(store.data.histories[msg.session].some(r=>r.content.includes(msg.text)));
  winding=true;await handleQQMessage({...msg,id:'2'},'two',services);assert.match(logs.at(-1),/本批判断结束.*睡前收尾/);
  mode='normal';winding=false;await handleQQMessage({...msg,id:'3',text:'下一条'},'three',services);assert.equal(requests,1);assert.deepEqual(sent,['在呢']);
});
