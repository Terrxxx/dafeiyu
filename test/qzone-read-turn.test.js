import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';
import { SocialTools } from '../src/tools.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { qzoneReadIntent } from '../src/qzone-read-turn.js';

function fixture(t) {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-fresh-space-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),sent=[],log=[];
  const config={qq:{enabled:true,adminUsers:['123456']},social:{qzoneEnabled:true,maxQzonePostsPerHour:1},bilibili:{enabled:false},agent:{historyMessages:64,maxOutputTokens:650,maxOutgoingPerHour:1000}};
  const qq={send:async(k,id,text)=>{sent.push(text);return{message_id:sent.length};},call:()=>assert.fail('不能调用真实QQ')};
  const tools=new SocialTools(config,store,qq,{});
  t.after(()=>tools.components.close());
  const agent=new Agent(config,store,tools);
  const msg={kind:'private',session:'qq:user:123456',sender:'123456',target:'123456',id:'read',text:'爸最新的动态是啥你知道吗',images:[]};
  const calls=[];
  tools.qzone.posts=async id=>{calls.push(id);return{owner:id,source:'personal-msglist',posts:[{owner:id,tid:'latest',text:'今天的新动态',comments:[],images:[],imageCount:0}]};};
  store.appendHistory(msg.session,'assistant','空间翻了好几回都是空的，发我链接');
  agent.taskJSON=async(protocol,input)=>{assert.equal(typeof input,'string');assert.match(input,/本轮实际空间读取结果/);assert.match(input,/今天的新动态/);assert.match(input,/count=1/);assert.match(input,/不能再说没看到/);return{reply:'看到了，今天那条～',capabilities:[]};};
  const env={agent,store,tools,qq,throttle:{wait:async()=>{}},log:line=>log.push(line)};
  return{...env,env,msg,calls,sent,log,config};
}

test('旧的空页原话保留，明确最新动态问题在第一轮前真实读取发送者空间',async t=>{
  const f=fixture(t);await handleQQMessage(f.msg,'read',f.env);
  assert.deepEqual(f.calls,['123456']);assert.match(f.sent[0],/看到了/);
  assert.ok(f.store.data.histories[f.msg.session].some(r=>r.content.includes('翻了好几回都是空的')));
  const trail=fs.readFileSync(path.join(path.dirname(f.store.file),'qq-activity.jsonl'),'utf8');
  assert.match(trail,/"operation":"read"/);assert.match(trail,/"count":1/);
});

test('请求点赞评论时即使首轮漏选capabilities，也进入工具流程复用真实postRef',async t=>{
  const f=fixture(t);let ran=false;
  f.agent.run=async(session,input,useTools,options)=>{ran=true;assert.equal(useTools,true);assert.ok(f.tools.chatFamilies.includes('qzone'));assert.ok(f.tools.chatToolNames.has('qzone_comment_post'));assert.match(options.taskContext,/今天的新动态/);assert.match(options.taskContext,/postRef:/);assert.equal(f.tools.spacePosts.size,1);return'已按实际结果处理';};
  await handleQQMessage({...f.msg,text:'给爸的动态点赞评论！'},'act',f.env);
  assert.equal(ran,true);assert.deepEqual(f.calls,['123456']);
});

test('看不到我的空间是读取请求，不能误当成询问自己发布的回执',async t=>{
  const f=fixture(t);await handleQQMessage({...f.msg,text:'为什么看不到我的QQ空间？'},'why',f.env);
  assert.deepEqual(f.calls,['123456']);assert.doesNotMatch(f.sent[0],/发布成功回执/);
});

test('读取失败是实际失败，空列表只表示当前为空，不沿用历史结论',async t=>{
  for(const mode of ['failure','empty']){
    const f=fixture(t);f.tools.qzone.posts=async()=>{if(mode==='failure')throw Error('登录失效');return{owner:'123456',posts:[]};};
    f.agent.taskJSON=async(p,input)=>{assert.match(input,/本轮实际空间读取结果/);assert.match(input,mode==='failure'?/state=failed/:/count=0/);return{reply:'本次读取结果已确认'};};
    await handleQQMessage(f.msg,mode,f.env);assert.equal(f.tools.spacePosts.size,0);
  }
});

test('普通好友、关闭读取、睡眠均不能通过预读绕过原有权限',async t=>{
  for(const mode of ['ordinary','disabled','sleep']){
    const f=fixture(t);let planned=false;
    f.agent.taskJSON=async(p,input)=>{planned=true;if(mode==='ordinary')assert.doesNotMatch(input,/本轮实际空间读取结果/);if(mode==='disabled')assert.match(input,/此QQ能力已由用户关闭/);return{reply:'普通回复'};};
    if(mode==='disabled')f.config.qq.qzoneReadEnabled=false;
    if(mode==='sleep')f.tools.sleep={sleeping:()=>true};
    const msg=mode==='ordinary'?{...f.msg,sender:'654321',target:'654321',session:'qq:user:654321',text:'看看我的空间'}:f.msg;
    await handleQQMessage(msg,mode,f.env);assert.equal(f.calls.length,0);if(mode==='sleep')assert.equal(planned,false);
  }
});

test('不猜未指定用户、混合平台、多目标或转述；自己的空间不误认为发起者',t=>{
  const f=fixture(t);
  for(const text of ['看泡泡的空间','看看我的朋友泡泡的空间','我发了一条QQ空间','如果我说看看我的空间','不要看我的空间','看看我的B站动态','看看123456和654321的空间'])assert.equal(qzoneReadIntent({...f.msg,text},f.store),null,text);
  assert.equal(qzoneReadIntent({...f.msg,text:'看看你的QQ空间'},f.store).userId,'self');
  assert.equal(qzoneReadIntent({...f.msg,text:'查看我的QQ空间'},f.store).userId,'123456');
  assert.equal(qzoneReadIntent({...f.msg,text:'看看123456的空间'},f.store).userId,'123456');
});
