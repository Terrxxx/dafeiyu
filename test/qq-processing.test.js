import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { QQProcessing, messageStatusView } from '../src/qq-processing.js';
import { startWebPanel } from '../src/web-panel.js';
import { ROOT } from '../src/config.js';
import { Store } from '../src/store.js';
import { Agent } from '../src/agent.js';
import { SocialTools } from '../src/tools.js';
import { handleQQMessage } from '../src/qq-handler.js';

const message=(id='a')=>({processingId:id,kind:'private',session:'qq:user:123456',target:'123456',sender:'123456',id,name:'朋友',text:'不能写进状态文件的聊天正文',images:[]});
function directory(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-message-status-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;}
test('状态独立于聊天数据，多个批次互不覆盖，处理中优先于等待合并，完成后释放活动项',t=>{
  const dir=directory(t),stateFile=path.join(dir,'state.json'),raw='{"histories":{"old":"原始记忆"}}';fs.writeFileSync(stateFile,raw);
  let now=1000;const tracker=new QQProcessing(dir,{now:()=>now++});
  tracker.update(message(),'merging',{count:2,waitUntil:9000});tracker.update(message(),'queued');tracker.update(message(),'generating');tracker.update(message('b'),'merging');
  let s=messageStatusView(dir,{service:{phase:'running'}});assert.equal(s.pending,2);assert.equal(s.current.id,'a');assert.equal(s.current.phase,'generating');
  tracker.update(message(),'low_energy',{energy:16.12345});tracker.complete(message());
  s=messageStatusView(dir,{service:{phase:'running'}});assert.equal(s.pending,1);assert.match(s.recent[0].reason,/16.12%/);
  assert.equal(fs.readFileSync(stateFile,'utf8'),raw);assert.ok(!fs.readFileSync(path.join(dir,'qq-processing.json'),'utf8').includes(message().text));
});
test('睡眠和每日暂停显示当前原因，后台停止不再显示过时的正在生成',t=>{
  const dir=directory(t),tracker=new QQProcessing(dir);tracker.update(message(),'generating');
  assert.equal(messageStatusView(dir,{service:{phase:'running'},sleep:{mode:'sleep'}}).current.phase,'sleeping');
  assert.match(messageStatusView(dir,{service:{phase:'running'},sleep:{mode:'sleep'}}).current.reason,/不回复或查询/);
  assert.equal(messageStatusView(dir,{service:{phase:'running'},daily:{paused:true}}).current.phase,'paused');
  const stopped=messageStatusView(dir,{service:{phase:'stopped'}});assert.equal(stopped.current.phase,'stopped');assert.equal(stopped.pending,0);
});
test('重启清理活动状态并保留中断记录，发送超时不标成功且不泄露错误里的凭据',t=>{
  const dir=directory(t),tracker=new QQProcessing(dir);tracker.update(message(),'sending');
  tracker.fail(message(),Error('timeout token=secret_cookie'));tracker.fail(message(),Error('timeout again'));
  let s=messageStatusView(dir,{service:{phase:'running'}});assert.equal(s.current.phase,'uncertain');assert.ok(!JSON.stringify(s).includes('secret_cookie'));
  tracker.update(message('pending'),'queued');new QQProcessing(dir);
  s=messageStatusView(dir,{service:{phase:'running'}});assert.equal(s.pending,0);assert.equal(s.recent[0].phase,'interrupted');
});
test('真实QQ处理链保存低精力、睡前静默和睡眠原因，正常回复只在收到回执后显示成功',async t=>{
  const dir=directory(t),store=new Store(dir),config={qq:{enabled:true,adminUsers:['123456']},agent:{historyMessages:64,maxOutgoingPerHour:100}};
  store.qqProcessing=new QQProcessing(dir);let calls=0,sends=0,mode='silent',asleep=false,winding=false;
  const qq={send:async()=>{sends++;return{message_id:42};}};
  const tools=new SocialTools(config,store,qq,{});t.after(()=>tools.components.close());tools.feelings.data.mood.energy=16.1234;
  tools.sleep={sleeping:()=>asleep,responseMode:()=>mode,windDown:()=>({active:winding}),assertAwake(){}};
  const agent=new Agent(config,store,tools);agent.planQQTurn=async()=>{calls++;return{reply:'在呢'};};
  const services={agent,tools,store,qq,throttle:{wait:async()=>{}},log(){}};
  await handleQQMessage(message(),'first',services);assert.equal(calls,0);assert.equal(sends,0);
  let s=messageStatusView(dir,{service:{phase:'running'}});assert.equal(s.current.phase,'low_energy');assert.match(s.current.reason,/16.12%/);
  winding=true;await handleQQMessage(message('wind'),'wind',services);assert.equal(messageStatusView(dir).current.phase,'wind_down');
  asleep=true;await handleQQMessage(message('sleep'),'sleep',services);assert.equal(messageStatusView(dir).current.phase,'sleeping');assert.equal(calls,0);assert.ok(store.data.sleepUnread.length);
  asleep=false;winding=false;mode='normal';await handleQQMessage(message('reply'),'reply',services);s=messageStatusView(dir,{service:{phase:'running'}});assert.equal(s.current.phase,'replied');assert.equal(s.pending,0);assert.equal(sends,1);
});
test('独立状态接口需要面板认证，账号目录隔离，GET不修改聊天或状态文件',async t=>{
  const dir=directory(t);fs.mkdirSync(path.join(dir,'data'));fs.copyFileSync(path.join(ROOT,'config.example.json'),path.join(dir,'config.json'));
  const stateFile=path.join(dir,'data/state.json'),raw=JSON.stringify({histories:{},actions:{},meta:{},counters:[],feelings:{mood:{energy:16.12}}});fs.writeFileSync(stateFile,raw);
  const tracker=new QQProcessing(path.join(dir,'data'));tracker.update(message(),'low_energy',{energy:16.12});
  const server=await startWebPanel({root:dir,port:0,controller:{status:()=>({phase:'running'}),logs:()=>[]}});
  t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));});
  const base='http://127.0.0.1:'+server.address().port;
  assert.equal((await fetch(base+'/api/message-status')).status,403);
  const {token}=await(await fetch(base+'/api/session')).json();
  const response=await fetch(base+'/api/message-status',{headers:{'X-Panel-Token':token}});assert.equal(response.status,200);
  const body=await response.json();assert.equal(body.current.phase,'low_energy');assert.match(body.current.reason,/16.12%/);assert.equal(fs.readFileSync(stateFile,'utf8'),raw);
  const overview=await(await fetch(base+'/api/status',{headers:{'X-Panel-Token':token}})).json();assert.equal(overview.messageStatus.current.phase,'low_energy');assert.equal(overview.messageStatus.sleeping,false);
  const other=directory(t);assert.equal(messageStatusView(other,{service:{phase:'running'}}).recent.length,0);
});
