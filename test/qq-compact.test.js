import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import { compactQQ, adminOperation } from '../src/qq-compact.js';
import { Store } from '../src/store.js';import { HarnessRuntime } from '../src/harness-runtime.js';import { ROOT } from '../src/config.js';
import { executeQQFeature } from '../src/qq-features.js';
function fixture(t, result) {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qq-compact-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const sent=[],store=new Store(dir), config={qq:{enabled:true,adminUsers:[]},agent:{historyMessages:20}},msg={kind:'private',target:'123',sender:'123',session:'qq:user:123',id:'m',text:'你好',receivedAt:Date.now()};
 const agent={config,runtime:{run:async()=>JSON.stringify(result)},feelings:{data:{users:{}}}};
 const tools={store,config,begin(scope,current){this.scope=scope;this.current=current;this.targets=new Set(['private:123']);},outgoing(){},media:{stickers:()=>[{id:'i1',description:'挥手'}],get:()=>({description:'挥手'}),bytes:()=>Buffer.from('test'),markSent(){}},qq:{call:async()=>{sent.push('qq_send_image');return {message_id:2};}},call(n,a){return executeQQFeature(this,n,a);}};
 return {dir,msg,key:'test',agent,store,tools,qq:{send:async()=>{sent.push('text');return {message_id:1};}},throttle:{wait:async()=>{}},log(){},sent};
}
test('一次请求同时发送文字和图片，不因图片吞掉正文，纯图仍允许',async t=>{
 const f=fixture(t,{reply:true,text:'你好呀',imageId:'i1',summary:'打招呼'});await compactQQ(f.msg,f.key,f);assert.deepEqual(f.sent,['text','qq_send_image']);
 const p=fixture(t,{reply:true,text:'',imageId:'i1'});await compactQQ(p.msg,p.key,p);assert.deepEqual(p.sent,['qq_send_image']);
});
test('管理员明确操作走原工具链，普通用户不能请求操作',()=>{const c={qq:{adminUsers:['123']}};assert.equal(adminOperation({sender:'123',text:'换头像'},c),true);assert.equal(adminOperation({sender:'999',text:'换头像'},c),false);});
test('真实Harness普通聊天请求通过1536预算守卫，只调用一次模型', {skip:!fs.existsSync(path.join(ROOT,'harness-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'))},async t=>{
 const f=fixture(t,{reply:true,text:'你好呀'});let calls=0;
 const config={...f.agent.config,apiKey:'test',baseUrl:'https://example.test',model:'test-model',persona:'测试',agent:{...f.agent.config.agent,maxOutputTokens:160,maxToolRounds:2,maxModelCallsPerHour:0}};
 const runtime=new HarnessRuntime(config,f.store,{schemas:[]},async(_url,options)=>{
  calls++;const b=JSON.parse(options.body);assert.ok(!b.tools);assert.ok(Buffer.byteLength(JSON.stringify({messages:b.messages,tools:b.tools}))+b.max_tokens+64<=1536);
  return new Response('data: '+JSON.stringify({id:'x',choices:[{index:0,delta:{role:'assistant',content:JSON.stringify({reply:true,text:'你好呀'})},finish_reason:null}]})+'\n\ndata: '+JSON.stringify({id:'x',choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:300,completion_tokens:30,total_tokens:330}})+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
 });runtime.home=path.join(f.dir,'home');t.after(()=>runtime.close());f.agent.runtime=runtime;f.agent.config=config;
 await compactQQ(f.msg,f.key,f);assert.equal(calls,1);assert.deepEqual(f.sent,['text']);
});
