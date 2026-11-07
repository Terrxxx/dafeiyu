import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import { gzipSync } from 'node:zlib';
import {Store}from'../src/store.js';import{Agent}from'../src/agent.js';import{SocialTools}from'../src/tools.js';import{handleQQMessage}from'../src/qq-handler.js';import{conversationPacket}from'../src/context-packet.js';import{browseCycle,shoppingCycle,executeActivityActions}from'../src/activity-cycle.js';import{writeUserControl,memoryEpoch}from'../src/user-controls.js';
function setup(t,replies=[]){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-v3-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const store=new Store(dir),sends=[],requests=[];
 const config={apiKey:'test',baseUrl:'https://example.test',model:'test',persona:'短句，有自己的判断。完整人格末尾标记。',qq:{enabled:true,adminUsers:['99999']},social:{contactCooldownMinutes:0},components:{},agent:{historyMessages:64,contextMaxChars:24000,maxModelCallsPerHour:0,maxOutgoingPerHour:100,maxOutputTokens:1024,maxBiliCommentsPerHour:10},bilibili:{enabled:true,maxVideosPerRound:2,maxDynamicsPerHour:2}};
 const qq={send:async(...args)=>{sends.push(args);return{message_id:100+sends.length};},call:async(name,args)=>name==='get_friend_list'?[{user_id:123456,nickname:'朋友'}]:name==='get_group_list'?[{group_id:88888,group_name:'测试群'}]:(sends.push([name,args]),{message_id:200+sends.length})};
 const tools=new SocialTools(config,store,qq,{});t.after(()=>tools.components.close());
 const agent=new Agent(config,store,tools,async(_url,o)=>{requests.push(JSON.parse(o.body));return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(replies.shift()??{reply:''})}}]});});
 tools.experienceVideo=()=>{throw Error('不应额外请求视频情绪分析');};
 const msg={kind:'private',session:'qq:user:123456',target:'123456',sender:'123456',name:'朋友',text:'今天喜欢草莓',id:'one',receivedAt:Date.now(),images:[]};
 const handle=(m=msg,key='turn-1')=>handleQQMessage(m,key,{agent,store,tools,qq,throttle:{wait:async()=>{}},log(){}});
 return{dir,config,store,tools,agent,qq,msg,sends,requests,handle,replies};
}
test('普通QQ一轮一次请求，保留完整人格、原话和记忆；图文同时发送不吞文字',async t=>{
 const f=setup(t);const asset=f.tools.media.ingest('data:image/png;base64,YQ==','小鱼挥手',f.msg.session);f.tools.media.markSticker(asset.id);
 f.replies.push({reply:'好耶',image:asset.id,users:[{id:'123456',reaction:'friendly',evidence:'喜欢草莓',memories:[{kind:'preference',quote:'喜欢草莓',sharedFact:'喜欢草莓'}]}]});
 await f.handle();assert.equal(f.requests.length,1);assert.equal(f.requests[0].tools,undefined);assert.ok(f.requests[0].messages[0].content.includes('完整人格末尾标记'));
 assert.ok(f.sends.some(x=>x[2]==='好耶'));assert.ok(f.store.data.histories[f.msg.session].some(x=>x.content.includes('[图片 '+asset.id+']')));assert.ok(f.agent.feelings.user('123456').memories.some(x=>x.quote==='喜欢草莓'));
 const input=f.requests[0].messages[1].content;assert.equal((input.match(/今天喜欢草莓/g)||[]).length,1);
});
test('沉默、API失败都保留原话；非管理员伪造能力请求不能执行操作',async t=>{
 const f=setup(t,[{reply:'',capabilities:['avatar','qq']}]);await f.handle();assert.equal(f.requests.length,1);assert.equal(f.sends.length,0);assert.ok(f.store.data.histories[f.msg.session][0].content.includes(f.msg.text));
 f.agent.request=async()=>{throw Error('本地假故障');};await assert.rejects(()=>f.handle({...f.msg,text:'这条也必须保存',id:'two'},'turn-2'),/本地假故障/);assert.ok(f.store.data.histories[f.msg.session].some(x=>x.content.includes('这条也必须保存')));
});
test('检索完整旧归档、重复清单去重、群私聊隔离，不修改任何存档或用户记忆',t=>{
 const f=setup(t),owner=f.agent.feelings.user('123456');owner.name='朋友';owner.memories=Array.from({length:35},(_,i)=>({scope:f.msg.session,quote:'长期记忆'+i,kind:'preference',time:Date.now()-50000}));
 fs.mkdirSync(path.join(f.dir,'memory'),{recursive:true});const record={id:'archive-only',scope:f.msg.session,role:'user',content:'朋友（123456）：上周种的向日葵开花了',time:'2026-10-01T01:02:03.123Z'};fs.writeFileSync(path.join(f.dir,'memory/2026-10-01.jsonl.gz'),gzipSync(JSON.stringify(record)+'\n'));
 f.store.appendHistory('qq:user:654321','user','另一个人的私密火星暗号');f.store.appendHistory('qq:group:88888','user','群里公开的话');
 const before=JSON.stringify(f.store.data.histories),memories=JSON.stringify(owner.memories),archive=fs.readFileSync(path.join(f.dir,'memory/2026-10-01.jsonl.gz'));
 const packet=conversationPacket(f.agent,{...f.msg,text:'向日葵怎么样了'});assert.ok(packet.text.includes('上周种的向日葵开花了'));assert.ok(!packet.text.includes('火星暗号'));assert.ok(!packet.text.includes('群里公开的话'));assert.equal(JSON.stringify(f.store.data.histories),before);assert.equal(JSON.stringify(owner.memories),memories);assert.deepEqual(fs.readFileSync(path.join(f.dir,'memory/2026-10-01.jsonl.gz')),archive);
 f.agent.feelings.applyChat(f.msg,{users:[{id:'123456',reaction:'friendly',evidence:'喜欢草莓',memories:[{kind:'preference',quote:'喜欢草莓'}]}]},'new-fact');assert.equal(owner.memories.length,36);
 const group=conversationPacket(f.agent,{kind:'group',session:'qq:group:88888',sender:'123456',text:'向日葵'});assert.ok(!group.text.includes('上周种的向日葵开花了'));
});
test('资料删除/屏蔽发生在生成中则拒绝发送；睡眠不请求',async t=>{
 const f=setup(t);f.agent.request=async()=>{writeUserControl(f.dir,'123456',{blocked:true});return Response.json({choices:[{message:{content:'{"reply":"旧回复"}'}}]});};await assert.rejects(()=>f.handle(),/记忆或屏蔽/);assert.equal(f.sends.length,0);
 const g=setup(t);g.tools.sleep={sleeping:()=>true};await g.handle();assert.equal(g.requests.length,0);
});
test('B站两阶段最多两请求，情绪/兴趣合并更新，安静不互动，伪造视频不执行',async t=>{
 const bv='BV1234567890',f=setup(t,[{bvids:[bv]},{actions:[],videos:[{bvid:bv,rating:1,feeling:'amusing'}]}]);
 f.tools.bili.popular=async()=>[{bvid:bv,title:'有趣的小鱼',category:'动物'}];f.tools.bili.video=async()=>({bvid:bv,title:'有趣的小鱼',category:'动物',authorId:'98765',subtitle:'小鱼游来游去。'.repeat(1000),evidence:'实际字幕',historyRecorded:true});
 const result=await browseCycle({...f,log(){}});assert.equal(result.calls,2);assert.equal(f.requests.length,2);assert.ok(f.agent.personality.data.videoVotes.includes(bv));assert.ok(f.agent.feelings.data.events.some(x=>x.key.startsWith('video:'+bv+':')));assert.equal(f.sends.length,0);assert.ok(f.requests.every(r=>r.tools===undefined));
 await assert.rejects(()=>executeActivityActions({decision:{actions:[{name:'bili_like_video',args:{bvid:'BVnotRead000'}}]},allowed:['bili_like_video'],tools:f.tools,store:f.store,epoch:memoryEpoch(f.store),videoIds:[bv]}),/实际读取/);
});
test('匿名逛店关闭时零请求；开启后两阶段只读真实商品，越界行为不执行',async t=>{
 const f=setup(t);await shoppingCycle({...f,log(){}});assert.equal(f.requests.length,0);
 f.config.components.shopping={installed:true,enabled:true};f.replies.push({platform:'jd',keyword:'鱼抱枕'},{actions:[]});f.tools.components.call=async()=>({status:'ok',products:[{productRef:'real',title:'鱼抱枕',url:'https://item.jd.com/123.html',imageAvailable:true}],evidence:'实际读取商品'});
 const result=await shoppingCycle({...f,log(){}});assert.equal(result.calls,2);assert.equal(f.requests.length,2);assert.equal(f.sends.length,0);
 await assert.rejects(()=>executeActivityActions({decision:{actions:[{name:'qq_set_avatar',args:{}}]},allowed:['qq_send_message'],tools:f.tools,store:f.store,epoch:memoryEpoch(f.store)}),/越界/);
});
test('具体旧事可补查一次、表达复盘不另请求；图文回执可用于撤回',async t=>{
 const f=setup(t,[{recall:'向日葵'},{reply:'开花啦'}]);await f.handle();assert.equal(f.requests.length,2);assert.equal(f.sends.length,1);
 const a=f.tools.media.ingest('data:image/png;base64,Yg==','小鱼',f.msg.session);const result=await f.tools.call('qq_send_image',{kind:'private',target:'123456',imageId:a.id});assert.deepEqual(JSON.parse(JSON.stringify(result)),{imageId:a.id});assert.ok(Object.values(f.store.data.sentMessages).some(x=>x.kind==='private'&&x.text==='[qq_send_image]'));
});
test('同一事实出现在清单、关系记忆和历史时仅输入一次，保存文件保持原样',t=>{
 const f=setup(t),user=f.agent.feelings.user('123456');user.name='朋友';user.memories=[{scope:f.msg.session,kind:'preference',quote:'喜欢草莓',time:Date.now()}];f.store.appendHistory(f.msg.session,'user','朋友（123456）：喜欢草莓');
 const ledger={version:1,id:'123456',generation:0,events:[],facts:[],sections:{[f.msg.session]:{text:'## 2026-10-28 · 记忆清单\n- 已确认记忆（2026-10-28T11:00:00.123Z）：喜欢草莓',updatedAt:Date.now()}}};
 fs.mkdirSync(path.join(f.dir,'user-memory'),{recursive:true});const file=path.join(f.dir,'user-memory/123456.json.gz'),bytes=gzipSync(JSON.stringify(ledger));fs.writeFileSync(file,bytes);
 const packet=conversationPacket(f.agent,{...f.msg,text:'还记得草莓吗'});assert.equal((packet.text.match(/喜欢草莓/g)||[]).length,1);assert.deepEqual(fs.readFileSync(file),bytes);
});
test('合并群聊保留各条消息的真实指向；全都指向别人时零请求',async t=>{
 const f=setup(t,[{reply:''}]);await f.handle({...f.msg,kind:'group',session:'qq:group:88888',target:'88888',mentioned:true,sources:[{sender:'123456',text:'问你呢',mentioned:true},{sender:'654321',text:'这句问别人',addressedElsewhere:true}]});
 assert.ok(f.requests[0].messages[1].content.includes('## addressing'));assert.ok(!f.requests[0].messages[1].content.split('# 当前消息')[1].includes('654321')); assert.ok(f.store.data.histories['qq:group:88888'].some(row=>row.content.includes('这句问别人')));
 const count=f.requests.length;await f.handle({...f.msg,kind:'group',session:'qq:group:88888',target:'88888',sources:[{sender:'123456',addressedElsewhere:true}]},'all-other');assert.equal(f.requests.length,count);
});
