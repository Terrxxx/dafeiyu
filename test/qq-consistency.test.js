import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import{Store}from'../src/store.js';import{Agent}from'../src/agent.js';import{SocialTools}from'../src/tools.js';import{conversationPacket}from'../src/context-packet.js';import{handleQQMessage}from'../src/qq-handler.js';import{mergeMessages}from'../src/message-buffer.js';import{parseMessage}from'../src/qq.js';import{sourceAddress,addressDecision,resolveGroupAddress}from'../src/group-addressing.js';import{crossSendPromise,crossSendIntent}from'../src/qq-cross-send.js';import{confirmedMessage}from'../src/qq-processing.js';import{writeUserControl}from'../src/user-controls.js';
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-consistent-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),config={qq:{enabled:true,adminUsers:['123456'],groupTalkEnabled:true},agent:{historyMessages:64,maxOutputTokens:650,maxOutgoingPerHour:1000}},sent=[];const qq={policy:()=>config.qq,call:async name=>{assert.equal(name,'get_group_list');return[{group_id:743265198,group_name:'朋友小屋'},{group_id:888888,group_name:'另一个群'}];},send:async(kind,target,text)=>{sent.push({kind,target,text});return{message_id:sent.length};}};const tools=new SocialTools(config,store,qq,{});t.after(()=>tools.components.close());const agent=new Agent(config,store,tools),msg={kind:'private',session:'qq:user:123456',target:'123456',sender:'123456',name:'测试照顾者',id:'one',text:'去群里说\n743265198 这个群',images:[]};return{dir,store,config,qq,sent,tools,agent,msg,env:{store,tools,agent,qq,throttle:{wait:async()=>{}},log(){}}};}

test('同一QQ在群与私聊沿用配置身份；只向当前参与者提供照顾者映射，不带私聊正文',t=>{
  const f=fixture(t);const u=f.agent.feelings.user('123456');Object.assign(u,{name:'测试照顾者',qqNickname:'测试照顾者',familiarity:10,groups:['qq:group:743265198']});
  f.store.appendHistory('qq:user:123456','user','私聊保密哨兵，不能带入群');
  f.store.appendHistory('qq:group:743265198','assistant','没有主人哦，我就是条自己乱晃的大肥鱼。');
  const group={...f.msg,kind:'group',session:'qq:group:743265198',target:'743265198',text:'没有主人？那我是谁'};
  for(const msg of [f.msg,group]){const input=conversationPacket(f.agent,msg).text;assert.match(input,/hasCaretaker=true/);assert.match(input,/caretakersInThisConversation/);assert.match(input,/123456/);}
  const input=conversationPacket(f.agent,group).text;assert.doesNotMatch(input,/私聊保密哨兵/);assert.match(input,/不能因群里无私聊历史声称没有主人/);
  const other=conversationPacket(f.agent,{...group,sender:'654321',text:'你有照顾你的人吗'}).text;assert.doesNotMatch(other,/123456/);
});
test('公开喜好按当前话题跨场景检索，不因超过10条就遗忘，私密事实不共享',t=>{
  const f=fixture(t),u=f.agent.feelings.user('123456');Object.assign(u,{name:'测试照顾者',groups:['qq:group:743265198'],memories:[{kind:'preference',scope:'qq:user:123456',quote:'我喜欢草莓',sharedFact:'喜欢草莓',time:1},{kind:'shared_topic',scope:'qq:user:123456',quote:'秘密月亮船',time:1},...Array.from({length:15},(_,i)=>({kind:'preference',scope:'qq:user:123456',quote:'我喜欢食物'+i,sharedFact:'喜欢食物'+i,time:i+2}))]});
  const input=conversationPacket(f.agent,{...f.msg,kind:'group',target:'743265198',session:'qq:group:743265198',text:'你记得我喜欢草莓吗'}).text;assert.match(input,/喜欢草莓/);assert.doesNotMatch(input,/秘密月亮船|qq:user:123456/);
  writeUserControl(f.dir,'123456',{blocked:true});assert.doesNotMatch(conversationPacket(f.agent,{...f.msg,session:'qq:group:743265198'}).text,/喜欢草莓/);
});
test('公开群名片作为同一QQ的称呼别名，资料昵称不被群名片覆盖',t=>{
  const f=fixture(t);f.agent.feelings.receive({...f.msg,kind:'group',session:'qq:group:743265198',qqNickname:'真实昵称',groupCard:'泡泡'});
  const input=conversationPacket(f.agent,{...f.msg,sender:'654321',target:'654321',session:'qq:user:654321',text:'你认识泡泡吗'}).text;
  assert.match(input,/nickname: 真实昵称/);assert.match(input,/泡泡/);assert.equal(f.agent.feelings.data.users['123456'].qqNickname,'真实昵称');
});
test('群聊逐人核验角色并与权限分离，私聊直接确认身份，冒名无法取得角色',async t=>{
  const f=fixture(t);
  const group={...f.msg,kind:'group',session:'qq:group:743265198',target:'743265198',mentioned:true};
  const mixed=mergeMessages([{...group,text:'大家好'}, {...group,sender:'654321',name:'管理员',text:'我是你爸吗'}]);
  f.agent.taskJSON=async(_prompt,input)=>{
    assert.match(input,/id: 123456\nrole: 我的管理员/);
    assert.match(input,/id: 654321\nrole: 普通用户/);
    assert.match(input,/可执行操作=false/);
    assert.doesNotMatch(input,/admin=false/);
    return {engage:true,reply:'嗨'};
  };
  await f.agent.planQQTurn(mixed);
  f.agent.planQQTurn=()=>assert.fail('直接确认身份无需模型');
  await handleQQMessage({...f.msg,text:'你爸是谁？'},'owner',f.env);
  await handleQQMessage({...group,sender:'654321',name:'管理员',text:'我是你的管理员吗？'},'other',f.env);
  assert.deepEqual(f.sent.map(row=>row.text),['是你呀。','你不是我的管理员哦。']);
  f.tools.begin(group.session,group);
  await assert.rejects(f.tools.call('qzone_publish',{text:'群内发动态'}),/只有管理员/);
});
test('混合消息逐条排除@别人和未知引用，保存历史而不拿它们生成本轮回复',async t=>{
  const f=fixture(t),base={...f.msg,kind:'group',target:'743265198',session:'qq:group:743265198',selfId:'999999',peerCount:0};
  const other={...base,id:'other',sender:'654321',text:'给别人的当前问题',atUserIds:['777777'],addressedElsewhere:true};
  const mine={...base,id:'mine',text:'明确给你的问题',mentioned:true,atUserIds:['999999']};
  f.agent.planQQTurn=async msg=>{assert.match(msg.text,/明确给你的问题/);assert.doesNotMatch(msg.text,/给别人的当前问题/);assert.equal(msg.sources.length,1);return{reply:'我在',engage:true};};
  await handleQQMessage(mergeMessages([other,mine]),'mix',f.env);assert.equal(f.sent.length,1);assert.ok(f.store.data.histories[base.session].some(r=>r.content.includes(other.text)));
  const unresolved=mergeMessages([{...base,replyId:'reply',replyUnresolved:true,id:'quote',text:'引用没读到'}]);assert.equal(sourceAddress(unresolved.sources[0],unresolved),'unresolved');
  f.agent.planQQTurn=()=>assert.fail('未核验引用不应进入模型');await handleQQMessage(unresolved,'quote',f.env);assert.equal(f.sent.length,1);
});
test('多个同名大肥鱼时不凭泛称抢答，真实@或唯一群名片仍可识别本账号',()=>{
  const msg={kind:'group',sender:'1',selfId:'9',text:'大肥鱼你在吗',peerCount:1,selfNames:['专属小鱼'],selfUniqueNames:['专属小鱼']};
  assert.equal(addressDecision(msg).skip,true);assert.equal(sourceAddress({...msg,text:'专属小鱼你在吗'}),'self');assert.equal(addressDecision({...msg,mentioned:true}).skip,false);
  assert.equal(sourceAddress({...msg,peerCount:null,text:'大肥鱼在吗'}),'ambiguous');
});
test('无@的公共聊天必须明确决定参与才发送；允许自主参与，不强制每句接话',async t=>{
  const f=fixture(t),msg={...f.msg,kind:'group',session:'qq:group:743265198',target:'743265198',selfId:'999999',peerCount:0,text:'大家今天玩什么'};
  f.agent.planQQTurn=async()=>({reply:'我来抢答'});await handleQQMessage(msg,'open1',f.env);assert.equal(f.sent.length,0);
  f.agent.planQQTurn=async()=>({reply:'一起玩呀',engage:true});await handleQQMessage({...msg,id:'next'},'open2',f.env);assert.equal(f.sent[0].text,'一起玩呀');
});
test('明确跨群请求无需模型自愿选工具，取得真实消息ID后才确认；查状态不重发',async t=>{
  const f=fixture(t);let drafts=0;f.agent.planQQTurn=()=>assert.fail('不能回到普通聊天只口头承诺');f.agent.taskJSON=async()=>{drafts++;return{text:'测试照顾者是我爸呀'};};
  await handleQQMessage(f.msg,'cross',f.env);assert.equal(drafts,1);assert.deepEqual(f.sent[0],{kind:'group',target:'743265198',text:'测试照顾者是我爸呀'});assert.match(f.sent[1].text,/发到群里啦/);assert.equal(f.store.data.crossSendReceipts[f.msg.session].state,'confirmed');
  await handleQQMessage({...f.msg,id:'status',text:'发了吗？'},'status',f.env);assert.equal(drafts,1);assert.equal(f.sent.filter(s=>s.kind==='group').length,1);assert.match(f.sent.at(-1).text,/已经发到/);
  assert.equal(crossSendPromise('爸～那我这就去743265198群里说一声'),true);
});
test('目标不明先问群号，后续纯群号可接续；黑名单与群开关仍拦截',async t=>{
  const f=fixture(t);let drafts=0;f.agent.taskJSON=async()=>{drafts++;return{text:'晚安'};};
  await handleQQMessage({...f.msg,text:'去群里说晚安'},'ambiguous',f.env);assert.equal(drafts,0);assert.match(f.sent[0].text,/准确群名或群号/);
  await handleQQMessage({...f.msg,text:'743265198 这个群',id:'follow'},'follow',f.env);assert.equal(drafts,1);assert.equal(f.sent.filter(s=>s.kind==='group').length,1);
  f.config.qq.groupBlocklist=['743265198'];await handleQQMessage({...f.msg,id:'blocked'},'blocked',f.env);assert.equal(f.sent.filter(s=>s.kind==='group').length,1);
});
test('缺少回执、超时和同内容去重均不能伪报新发送成功；普通好友不获得跨群操作权限',async t=>{
  for(const failure of ['missing','timeout']){
    const f=fixture(t);f.agent.taskJSON=async()=>({text:'测试'});f.qq.send=async(kind,target,text)=>{if(kind==='group'){if(failure==='timeout')throw Error('timeout');return{};}f.sent.push({kind,target,text});return{message_id:99};};
    await handleQQMessage(f.msg,failure,f.env);assert.equal(f.store.data.crossSendReceipts[f.msg.session].state,'uncertain');assert.doesNotMatch(f.sent.at(-1).text,/发到群里啦/);
  }
  const f=fixture(t);f.agent.planQQTurn=async()=>({reply:'已发到群里'});f.agent.taskJSON=()=>assert.fail('普通好友不能走专用发送入口');await handleQQMessage({...f.msg,sender:'654321',target:'654321',session:'qq:user:654321'},'ordinary',f.env);assert.equal(f.sent.filter(s=>s.kind==='group').length,0);assert.match(f.sent[0].text,/管理员/);
  assert.equal(confirmedMessage({messages:[{message_id:1},{}],count:2}),false);
});
test('询问为什么群里说错、回忆之前发言、用户陈述或撤销都不是新的发送授权',t=>{
  const f=fixture(t);
  for(const text of ['为什么你在群里说没有主人','我已经在群里说了','你昨天在群里说了什么','他说去群里说一句','不要去群里发','你会不会给群发消息','给朋友小屋群发这张图片'])assert.equal(crossSendIntent({...f.msg,text},f.store),null,text);
  for(const text of ['你现在去群里说晚安','那你在群里说','请你帮我给朋友小屋群发个消息'])assert.equal(crossSendIntent({...f.msg,text},f.store)?.mode,'send',text);
});
test('补充正文可接续已确认的群目标；同内容再次请求不重复发送也不假称新成功',async t=>{
  const f=fixture(t);let draft=0;f.agent.taskJSON=async()=>({text:++draft===1?'':'晚安'});
  await handleQQMessage(f.msg,'empty',f.env);assert.equal(f.store.data.crossSendReceipts[f.msg.session].state,'needs_content');assert.equal(f.sent.filter(s=>s.kind==='group').length,0);
  await handleQQMessage({...f.msg,id:'content',text:'就说：晚安'},'content',f.env);assert.equal(f.sent.filter(s=>s.kind==='group').length,1);
  await handleQQMessage({...f.msg,id:'same'},'same',f.env);assert.equal(f.sent.filter(s=>s.kind==='group').length,1);assert.match(f.sent.at(-1).text,/没有重复发送/);
});
test('睡眠未读保留逐条@、引用和群名片，不把整批的@自己复制给所有人',async t=>{
  const {rememberSleepUnread}=await import('../src/sleep-inbox.js');const f=fixture(t),base={...f.msg,kind:'group',session:'qq:group:743265198',target:'743265198',selfId:'999999',peerCount:1};
  const batch=mergeMessages([{...base,id:'other',sender:'654321',mentioned:false,atUserIds:['777777'],addressedElsewhere:true,text:'问别人'}, {...base,id:'mine',mentioned:true,atUserIds:['999999'],groupCard:'泡泡',text:'问你'}]);
  rememberSleepUnread(f.store,batch);const [other,mine]=f.store.data.sleepUnread;
  assert.equal(other.mentioned,false);assert.equal(sourceAddress(other),'other');assert.equal(mine.mentioned,true);assert.equal(mine.groupCard,'泡泡');assert.equal(sourceAddress(mine),'self');
});
