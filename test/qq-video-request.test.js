import test from 'node:test';import assert from 'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';
import {Store}from'../src/store.js';import{Agent}from'../src/agent.js';import{SocialTools}from'../src/tools.js';import{handleQQMessage}from'../src/qq-handler.js';import{explicitVideoRequest}from'../src/qq-video-request.js';import{browseCycle}from'../src/activity-cycle.js';
function setup(t,admin='99999',sender=admin){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-video-route-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),requests=[],sends=[],reads=[];
 const config={apiKey:'test',baseUrl:'https://offline.invalid',model:'test',persona:'自然简短地聊天',qq:{enabled:true,adminUsers:[admin]},bilibili:{enabled:true,maxVideosPerRound:1},social:{},agent:{historyMessages:64,maxModelCallsPerHour:0,maxOutgoingPerHour:100,maxOutputTokens:1024}};
 const qq={send:async(...a)=>{sends.push(a);return{message_id:100+sends.length};},call:async()=>[]};const bili={video:async bvid=>{reads.push(bvid);return{bvid,title:'本地测试小鱼',subtitle:'小鱼游过水草',evidence:'本地假数据',historyRecorded:true};}};
 const tools=new SocialTools(config,store,qq,bili);tools.experienceVideo=()=>{throw Error('不应追加情绪请求');};t.after(()=>tools.components.close());
 const agent=new Agent(config,store,tools,async(_url,o)=>{requests.push(JSON.parse(o.body));return Response.json({choices:[{message:{content:'{"reply":"小鱼在逛水草呀","summary":"依据真实资料回应","rating":0,"feeling":"neutral"}'}}]});});
 const msg={kind:'private',session:'qq:user:'+sender,sender,target:sender,id:'one',text:'看看BV14oa961ELQ',images:[],receivedAt:Date.now()};const handle=()=>handleQQMessage(msg,'test-video',{agent,store,tools,qq,throttle:{wait:async()=>{}},log(){}});return{config,store,agent,tools,msg,reads,requests,sends,handle};}
test('不同租户各自的管理员都能固定读BV，只用一次无工具定义的模型请求',async t=>{
 for(const id of ['99999','77777']){const f=setup(t,id);await f.handle();assert.deepEqual(f.reads,['BV14oa961ELQ']);assert.equal(f.requests.length,1);assert.equal(f.requests[0].tools,undefined);assert.equal(f.sends.length,1);assert.ok(f.store.data.histories[f.msg.session].some(x=>x.content.includes(f.msg.text)));}
});
test('普通用户及群聊不触发管理员读取；否定、转述、点赞等指令不被误当只读',async t=>{
 const f=setup(t,'99999','77777');await f.handle();assert.equal(f.reads.length,0);
 for(const text of ['不要看看BV14oa961ELQ','他说：看看BV14oa961ELQ','看看BV14oa961ELQ并点赞','BV14oa961ELQ'])assert.equal(explicitVideoRequest({text}),null);
 assert.deepEqual(explicitVideoRequest({text:'请分析 https://www.bilibili.com/video/BV14oa961ELQ 的评论区'}),{bvid:'BV14oa961ELQ',comments:true});
});
test('视频读取失败不调用模型、不声称看过，原话保留',async t=>{const f=setup(t);f.tools.bili.video=async()=>{throw Error('本地假故障');};await f.handle();assert.equal(f.requests.length,0);assert.ok(f.sends[0][2].includes('没读到'));assert.ok(f.store.data.histories[f.msg.session][0].content.includes(f.msg.text));});
test('后台按租户1条额度提示及执行，模型超选有效候选不会整轮失败',async t=>{
 const f=setup(t),other='BV1234567890';f.tools.bili.popular=async()=>[{bvid:'BV14oa961ELQ',title:'甲'},{bvid:other,title:'乙'}];let count=0;
 f.agent.taskJSON=async protocol=>{if(++count===1){assert.ok(protocol.includes('最多1条'));return{bvids:['BV14oa961ELQ',other]};}return{actions:[]};};
 const result=await browseCycle({...f,log(){}});assert.equal(result.calls,2);assert.deepEqual(f.reads,['BV14oa961ELQ']);
});
