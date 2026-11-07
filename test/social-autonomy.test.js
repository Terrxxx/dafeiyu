import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../src/store.js';import {SocialTools} from '../src/tools.js';import {Tasks} from '../src/tasks.js';import {socialCycle} from '../src/social-cycle.js';import {executeSocialTask} from '../src/social-planning.js';
function fixture(t,replies){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-social-auto-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),sent=[],calls=[],logs=[];
 const config={qq:{enabled:true,adminUsers:['99999']},social:{enabled:true},agent:{historyMessages:64,maxOutgoingPerHour:100,maxToolRounds:16},bilibili:{enabled:false}};
 const qq={call:async name=>name==='get_friend_list'?[{user_id:123456,nickname:'朋友'}]:[{group_id:88888,group_name:'朋友群'}],send:async(...args)=>{sent.push(args);return{message_id:sent.length};}};
 const tasks=new Tasks(store),tools=new SocialTools(config,store,qq,{},tasks);t.after(()=>tools.components.close());
 Object.assign(tools.feelings.user('123456'),{name:'朋友',lastIncoming:Date.now()-3600000,lastPrivateIncoming:Date.now()-3600000,affinity:10,familiarity:20});
 const agent={config,store,tools,feelings:tools.feelings,personality:tools.personality,taskJSON:async(p,d,o)=>{calls.push({p,d,o});assert.ok(replies.length,'不应追加额外请求');return replies.shift();}};
 return{dir,agent,tools,store,config,sent,calls,tasks,logs,log:s=>logs.push(s)};
}
test('自主社交提供情绪、联系空闲与关系依据，私聊和群各可主动发言，两次请求内完成',async t=>{
 for(const[kind,id]of [['private','123456'],['group','88888']]){const f=fixture(t,[{activity:'chat',kind,id},{actions:[{name:'qq_send_message',args:{kind:'group',target:'wrong',text:'今天想出门走走'}}]}]);await socialCycle(f);assert.equal(f.calls.length,2);assert.ok(Number.isFinite(f.calls[0].d.mood.energy));assert.ok(f.calls[0].d.choices.some(c=>c.kind==='group'));assert.ok(f.calls[0].d.choices.some(c=>c.kind==='private'));assert.equal(f.sent.length,1);assert.equal(f.sent[0][0],kind);assert.equal(f.sent[0][1],id);}
});
test('自主创建具体定时任务、重启后持久化、到期真实执行且只执行一次，不递归创建',async t=>{
 const f=fixture(t,[{activity:'task',kind:'private',id:'123456'},{actions:[],task:{prompt:'晚点聊聊周末散步计划',delayMinutes:30}},{actions:[{name:'qq_send_message',args:{text:'周末想去哪走走？',target:'wrong'}}]}]);
 await socialCycle(f);assert.equal(f.sent.length,0);assert.equal(f.store.data.tasks.length,1);const task=f.store.data.tasks[0];assert.equal(task.status,'pending');assert.deepEqual(task.autonomousTarget,{kind:'private',id:'123456'});
 assert.deepEqual(new Store(f.dir).data.tasks[0].autonomousTarget,task.autonomousTarget);
 task.due=0;await f.tasks.tick(t=>executeSocialTask(t,f));await f.tasks.tick(t=>executeSocialTask(t,f));assert.equal(task.status,'done');assert.equal(f.sent.length,1);assert.equal(f.sent[0][1],'123456');assert.equal(f.calls.length,3);assert.equal(f.store.data.tasks.length,1);
});
test('未回复跟进不会被普通冷却重复拦截，已用跟进不能再发',async t=>{
 const f=fixture(t,[{activity:'chat',kind:'private',id:'123456'},{actions:[{name:'qq_send_message',args:{text:'忙着的话晚点聊呀'}}]}]);const user=f.agent.feelings.user('123456'),at=Date.now()-3600000;user.lastProactive=at;user.lastPrivateIncoming=at-3600000;user.followup={sentAt:at,question:'吃饭了吗',checked:false,used:false};assert.equal(f.agent.feelings.canContact('123456'),false);
 await socialCycle(f);assert.equal(f.sent.length,1);assert.equal(user.followup,null);
 await assert.rejects(f.tools.call('qq_send_message',{kind:'private',target:'123456',text:'再次催促'}),/跟进已结束/);assert.equal(f.sent.length,1);
});
test('黑名单与关闭对话阻止主动联系和到期任务，静默可选且不填充虚假日程',async t=>{
 const f=fixture(t,[{activity:'quiet'}]);await socialCycle(f);assert.equal(f.calls.length,1);assert.equal(f.store.data.tasks.length,0);
 f.config.qq.groupTalkEnabled=false;f.config.qq.privateEnabled=false;f.config.qq.qzoneReadEnabled=false;f.agent.taskJSON=async()=>{f.calls.push({});return{activity:'quiet'};};await socialCycle(f);assert.equal(f.calls.length,2);
 const result=await executeSocialTask({prompt:'聊聊',autonomousTarget:{kind:'private',id:'123456'}},f);assert.match(result,/未联系/);assert.equal(f.sent.length,0);assert.equal(f.calls.length,2);
});
