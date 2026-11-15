import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {SocialTools} from '../src/tools.js';import {Agent} from '../src/agent.js';import {handleQQMessage} from '../src/qq-handler.js';import {publicationIntent} from '../src/publication-turn.js';
import {mergeMessages} from '../src/message-buffer.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-publication-turn-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),published=[],sent=[];const config={qq:{enabled:true,adminUsers:['123456']},bilibili:{enabled:true,maxDynamicsPerHour:1},social:{qzoneEnabled:true,maxQzonePostsPerHour:1},agent:{historyMessages:64,maxOutputTokens:650,maxOutgoingPerHour:1000}};const qq={call:async(n,a)=>{assert.equal(n,'send_qzone_msg');published.push(a.content);return{tid:'real-receipt'};},send:async(k,id,text)=>{sent.push(text);return{message_id:sent.length};}};const tools=new SocialTools(config,store,qq,{publishDynamic:async text=>{published.push(text);return{dynamicId:'1234567'};}});t.after(()=>tools.components.close());const agent=new Agent(config,store,tools);agent.taskJSON=async()=>({operations:[{platform:'qzone',text:'今天花开了'}]});const msg={kind:'private',session:'qq:user:123456',sender:'123456',target:'123456',id:'one',text:'发一条QQ空间说说：今天花开了',images:[]};const env={agent,tools,store,qq,throttle:{wait:async()=>{}},log(){}};return{dir,store,tools,agent,qq,msg,env,published,sent};}
test('明确发布指令无需模型自愿调用工具，程序提交并确认ID；发了吗只查状态，不重发',async t=>{const f=fixture(t);f.agent.planQQTurn=()=>assert.fail('不应回到普通聊天口头承诺');f.agent.run=()=>assert.fail('不应依赖工具循环自愿执行');await handleQQMessage(f.msg,'one',f.env);assert.deepEqual(f.published,['今天花开了']);assert.match(f.sent[0],/发好啦/);await handleQQMessage({...f.msg,id:'two',text:'发了吗？'},'two',f.env);assert.equal(f.published.length,1);assert.match(f.sent[1],/发好啦/);assert.doesNotMatch(f.sent[1],/real-receipt/);assert.equal(new Store(f.dir).data.publicationReceipts[f.msg.session].qzone.state,'confirmed');});
test('查询当前没有回执只说没查到，不能承诺马上发；过期或其他会话草稿不触发',async t=>{const f=fixture(t);f.store.appendHistory(f.msg.session,'assistant','准备发QQ空间说说');f.agent.taskJSON=()=>assert.fail('查状态不调用模型');await handleQQMessage({...f.msg,text:'怎么还没有看到'},'status',f.env);assert.match(f.sent[0],/没有发布成功回执/);assert.equal(f.published.length,0);assert.equal(publicationIntent({...f.msg,session:'qq:user:99999',text:'发出去'},f.store),null);});
test('只有口头承诺、没有提交时不外发假承诺；看草稿不是授权发布',async t=>{const f=fixture(t);f.store.appendHistory(f.msg.session,'assistant','QQ空间文案我已经写好');f.agent.planQQTurn=async()=>({reply:'我这就发出去，发完给你看'});await handleQQMessage({...f.msg,text:'没有限额啦'},'observe',f.env);assert.equal(f.published.length,0);assert.doesNotMatch(f.sent[0],/我这就/);assert.match(f.sent[0],/没有取得/);assert.equal(publicationIntent({...f.msg,text:'先给我看看要发什么说说'},f.store).mode,'conversation');});
test('真实接口失败或缺少ID不报成功；0限额保持禁止；平台以外的生成操作不能执行',async t=>{for(const mode of ['failure','missing','zero','wrong']){const f=fixture(t);if(mode==='failure')f.qq.call=async()=>{throw Error('OneBot 动作失败 (1200)');};if(mode==='missing')f.qq.call=async()=>({});if(mode==='zero')f.tools.config.social.maxQzonePostsPerHour=0;if(mode==='wrong'){f.agent.taskJSON=async()=>({operations:[{platform:'bilibili',text:'越界'}]});await assert.rejects(handleQQMessage(f.msg,mode,f.env),/文案格式无效/);continue;}await handleQQMessage(f.msg,mode,f.env);assert.match(f.sent[0],/未确认发布成功/);assert.doesNotMatch(f.sent[0],/^QQ空间已发布/);assert.equal(f.store.data.publicationReceipts[f.msg.session].qzone.state,'failed');}});
test('普通用户无法通过新发布入口绕过QQ权限',async t=>{const f=fixture(t);f.agent.planQQTurn=async()=>({reply:'可以正常聊天'});await handleQQMessage({...f.msg,sender:'654321',target:'654321',session:'qq:user:654321'},'ordinary',f.env);assert.equal(f.published.length,0);assert.equal(f.sent[0],'可以正常聊天');});
test('询问发布能力、如何发布和假设示例均不是实际发布授权',t=>{const f=fixture(t);for(const text of ['你会不会发QQ空间','如何发B站动态','现在可以发空间了吗？','如果我说发一条QQ空间','举个例子，帮我发条QQ空间'])assert.notEqual(publicationIntent({...f.msg,text},f.store).mode,'publish',text);});
test('管理员请求式QQ动态优先于读空间词，合并发言不用昵称解析并跳过醒时低精力静默',async t=>{
 const f=fixture(t);
 const msg=mergeMessages([{...f.msg,name:'编辑：管理员',text:'能不能帮我发个你自己的QQ动态？'}, {...f.msg,id:'two',text:'正文：最近去看花啦'}]);
 f.tools.sleep={sleeping:()=>false,responseMode:()=>assert.fail('明确指令不走随机静默'),assertAwake(){}};
 f.agent.planQQTurn=()=>assert.fail('不应退回普通聊天');
 f.agent.taskJSON=async(_prompt,data)=>{assert.deepEqual(data.platforms,['qzone']);assert.match(data.request,/最近去看花啦/);return{operations:[{platform:'qzone',text:'最近去看花啦'}]};};
 await handleQQMessage(msg,'qzone-new',f.env);
 assert.deepEqual(f.published,['最近去看花啦']);
 assert.match(f.sent[0],/发好啦/);
});
test('平台不明确先问，QQ空间补充仅提交指定平台，群和睡眠旧指令不能发布',async t=>{
 const f=fixture(t);
 await handleQQMessage({...f.msg,text:'发一条动态：今天花开了'},'choose',f.env);
 assert.match(f.sent[0],/QQ空间，还是B站/);
 assert.deepEqual(f.published,[]);
 f.agent.taskJSON=async(_prompt,data)=>{assert.equal(data.request,'发一条动态：今天花开了');return{operations:[{platform:'qzone',text:'今天花开了'}]};};
 await handleQQMessage({...f.msg,text:'发到QQ空间吧'},'choose-qq',f.env);
 assert.deepEqual(f.published,['今天花开了']);
 f.agent.planQQTurn=async()=>({engage:true,reply:'知道啦',capabilities:['qzone']});
 f.agent.run=()=>assert.fail('群与旧消息不可进入操作');
 await handleQQMessage({...f.msg,kind:'group',session:'qq:group:55555',target:'55555',mentioned:true},'group',f.env);
 await handleQQMessage({...f.msg,unreadReview:true},'unread',f.env);
 assert.equal(f.published.length,1);
});
test('看空间、发评论和取消不会误发动态',t=>{
 const f=fixture(t);
 f.store.appendHistory(f.msg.session,'assistant','想发一条QQ空间动态');
 for(const text of ['帮我看一下你QQ空间最近发了什么','去QQ空间发个评论','先别发QQ动态','帮我发消息给朋友','在B站评论区发条评论','我想自己发个QQ动态','QQ空间链接发给我']) {
   assert.notEqual(publicationIntent({...f.msg,text},f.store)?.mode,'publish',text);
 }
});
