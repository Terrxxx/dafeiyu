import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.js';
import {HarnessRuntime} from '../src/harness-runtime.js';
import {withAICycleBudget,withExistingAICycle,currentAICycle,reserveAICycle} from '../src/ai-cycle-budget.js';
import {withTurnMeter,currentTurnMeter} from '../src/turn-meter.js';

test('缺省预算和计量器显式清除回调继承值，嵌套返回恢复原上下文',async()=>{
 await withAICycleBudget(async()=>{
  const original=currentAICycle();
  await withExistingAICycle(undefined,async()=>{await Promise.resolve();assert.equal(currentAICycle(),undefined);});
  assert.equal(currentAICycle(),original);
  await withExistingAICycle(original,async()=>{reserveAICycle({messages:[],max_tokens:1});reserveAICycle({messages:[],max_tokens:1});assert.throws(()=>reserveAICycle({messages:[]}),/最多2次/);});
 });
 await withTurnMeter({requests:10},async()=>{await withTurnMeter(undefined,async()=>assert.equal(currentTurnMeter(),undefined));assert.equal(currentTurnMeter().requests,10);});
});

function stream(text){return new Response(`data: ${JSON.stringify({id:'local',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]})}\n\ndata: ${JSON.stringify({id:'local',object:'chat.completion.chunk',created:1,model:'test',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:12,completion_tokens:2,total_tokens:14}})}\n\ndata: [DONE]\n\n`,{headers:{'Content-Type':'text/event-stream'}});}

test('真实Harness先在社交轮启动并耗尽两次预算，后续QQ不继承旧额度，新社交独立计数',async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-harness-budget-')),store=new Store(directory),observed=[];
 const config={apiKey:'test',baseUrl:'https://example.test',model:'test',agent:{maxOutputTokens:80,maxToolRounds:3,maxModelCallsPerHour:0}};
 const runtime=new HarnessRuntime(config,store,{schemas:[]},async()=>{observed.push(currentAICycle());return stream('好呀');});runtime.home=path.join(directory,'home');
 t.after(async()=>{await runtime.close();fs.rmSync(directory,{recursive:true,force:true});});
 let first;
 await withAICycleBudget(async()=>{first=currentAICycle();assert.equal(await runtime.run('社交一'),'好呀');assert.equal(await runtime.run('社交二'),'好呀');assert.equal(first.calls,2);});
 const pid=runtime.child.pid;
 for(let i=0;i<3;i++)assert.equal(await runtime.run('QQ正常聊天'),'好呀');
 assert.equal(first.calls,2);assert.deepEqual(observed.slice(2),[undefined,undefined,undefined]);
 await withAICycleBudget(async()=>{assert.equal(await runtime.run('下一轮社交'),'好呀');assert.equal(currentAICycle().calls,1);assert.notEqual(currentAICycle(),first);});
 assert.equal(runtime.child.pid,pid);
});
