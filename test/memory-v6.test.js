import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{gzipSync}from'node:zlib';
import{Store}from'../src/store.js';import{Agent}from'../src/agent.js';import{SocialTools}from'../src/tools.js';import{conversationPacket}from'../src/context-packet.js';import{writeUserControl}from'../src/user-controls.js';import{memoryTimeRange,selectMemory,uniqueMemoryRows,memoryBody}from'../src/memory-retrieval.js';
const now=Date.parse('2026-10-30T19:10:00Z'),scope='qq:user:123456';
const row=(role,content,time,id)=>({id,role,content,time,source:'archive'});
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-memory-v6-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir),config={apiKey:'offline',baseUrl:'https://offline.invalid',model:'offline',persona:'原人格完整',qq:{enabled:true,adminUsers:['123456']},agent:{historyMessages:64,maxOutputTokens:520,maxModelCallsPerHour:0,maxOutgoingPerHour:100}},tools=new SocialTools(config,store,{},{});t.after(()=>tools.components.close());const agent=new Agent(config,store,tools),msg={kind:'private',session:scope,sender:'123456',target:'123456',text:'还记得你给自己起了个名字吗',name:'朋友',images:[]};return{dir,store,config,tools,agent,msg};}
function journal(f,rows){fs.mkdirSync(f.dir+'/memory',{recursive:true});fs.writeFileSync(f.dir+'/memory/2026-10-30.jsonl.gz',gzipSync(rows.map(r=>JSON.stringify({scope,...r})).join('\n')+'\n'));}
test('北京时间跨日、昨天前天和明确日期按日过滤，不受主机时区影响',()=>{
 assert.equal(memoryTimeRange('昨天聊了啥',now),'2026-10-30');assert.equal(memoryTimeRange('前天的事情',now),'2026-10-29');assert.equal(memoryTimeRange('大前天说了什么',now),'2026-10-28');assert.equal(memoryTimeRange('2026年10月28日聊过的',now),'2026-10-28');assert.equal(memoryTimeRange('2026-02-31发生了什么',now),undefined);
 const rows=[row('user','朋友（123456）：昨天昨天昨天', '2026-10-30T17:00:00Z','today'),row('user','朋友（123456）：我们去看海吧','2026-10-29T23:00:00Z','u'),row('assistant','好，记得带伞','2026-10-29T23:00:03Z','a')];const r=selectMemory({rows,query:'昨天我们聊了啥',now});assert.ok(r.chosen.some(x=>x.id==='u'));assert.ok(r.chosen.some(x=>x.id==='a'));assert.ok(!r.chosen.some(x=>x.id==='today'));
});
test('找回自身称呼，不硬编码名字，旧截图不会挤掉原话；不同名字保留日期',()=>{
 const rows=[row('user','朋友（123456）：你给自己起个名字吧','2026-10-29T18:52:20Z','u1'),row('assistant','名字想好啦～叫“雨团”怎么样','2026-10-29T18:52:27Z','a1'),row('user','朋友（123456）：以后叫团团','2026-10-29T19:50:20Z','u2'),row('assistant','好哦，那团团以后就是你叫的名字了','2026-10-29T19:50:28Z','a2'),row('assistant','爸～在呢，叫我干嘛','2026-10-30T18:00:00Z','bad'),row('assistant','视频里这名字是当年被误会出来的梗','2026-10-30T18:00:01Z','video'),row('user','朋友（123456）：[图片] 截图里提到名字和大肥鱼'.repeat(100),'2026-10-30T18:01:00Z','image')];
 const r=selectMemory({rows,query:'还记得你给自己起的名字吗',hint:'截图 大肥鱼',now});assert.ok(r.self.some(x=>x.content.includes('雨团')));assert.ok(r.self.some(x=>x.content.includes('团团')));assert.ok(!r.self.some(x=>['bad','video'].includes(x.id)));assert.ok(r.self.some(x=>x.id==='u2'));
 const next=selectMemory({rows,query:'你好呀',now});assert.ok(next.self.some(x=>x.content.includes('团团')));
});
test('历史按问答块回收，自己的旧回答有我标识，用户同句不会吞掉自己原话',()=>{
 const rows=[row('user','朋友（123456）：柚子树开花了吗','2026-10-29T21:00:00Z','u'),row('assistant','开了三朵白花','2026-10-29T21:00:02Z','a')];const r=selectMemory({rows,query:'柚子树',now});assert.deepEqual(r.chosen.map(x=>x.id),['u','a']);assert.equal(uniqueMemoryRows([...rows,row('assistant','柚子树开花了吗','2026-10-29T21:00:03Z','b')]).length,3);
});
test('压缩与普通存档、重复昵称同源去重，不改动原始文本；不同图片不会合并',()=>{
 const rows=[row('user','朋友（123456）：朋友（123456）：[图片] 可用图片ID=abcdef','2026-10-29T20:00:00.123Z','one'),row('user','朋友（123456）：[图片] 可用图片ID=abcdef','2026-10-29T20:00:00.123Z','two')],before=JSON.stringify(rows);assert.equal(uniqueMemoryRows(rows).length,1);assert.equal(memoryBody('朋友（123456）：朋友（123456）：原话'),'原话');assert.equal(JSON.stringify(rows),before);assert.equal(uniqueMemoryRows([...rows,{...rows[1],content:rows[1].content.replace('abcdef','987abc')}]).length,2);
});
test('睡眠摘录接回上下文，保留发言人；有原存档则恢复完整原话',t=>{
 const f=fixture(t);const original='明天一起去种向日葵，记得带上小铲子';journal(f,[row('assistant',original,'2026-10-29T23:00:00Z','a')]);f.store.data.sleepSummaries={[scope]:[{day:'2026-10-30',text:'旧摘要\n2026-10-29T23:00:00Z 大肥鱼原话：明天一起去种向日葵'}]};const p=conversationPacket(f.agent,{...f.msg,text:'你好'});assert.ok(p.text.includes('睡眠整理摘录'));assert.ok(p.text.includes(original));assert.ok(p.text.includes('我: '+original));
});
test('私聊称呼不泄露到其他私聊或群，删除屏蔽后不从旧归档和睡眠摘要复活',t=>{
 const f=fixture(t);journal(f,[row('assistant','叫我小栗也行','2026-10-29T23:00:00Z','a')]);const p=conversationPacket(f.agent,f.msg);assert.ok(p.text.includes('小栗'));assert.ok(!conversationPacket(f.agent,{...f.msg,session:'qq:user:654321',sender:'654321'}).text.includes('小栗'));assert.ok(!conversationPacket(f.agent,{...f.msg,session:'qq:group:88888',kind:'group'}).text.includes('小栗'));
 f.store.data.sleepSummaries={[scope]:[{text:'2026-10-29T23:00:00Z 大肥鱼原话：叫我小栗也行'}]};writeUserControl(f.dir,'123456',{forgottenAt:Date.now()});assert.ok(!conversationPacket(f.agent,f.msg).text.includes('小栗'));
 writeUserControl(f.dir,'123456',{forgottenAt:0,blocked:true});assert.ok(!conversationPacket(f.agent,f.msg).text.includes('小栗'));
});
test('记忆修改后旧的自己回答也不能绕过编辑边界',t=>{
 const f=fixture(t);journal(f,[row('user','朋友（123456）：种紫色的兰花','2026-10-29T23:00:00Z','u'),row('assistant','好，我答应你种紫色兰花','2026-10-29T23:00:02Z','a')]);writeUserControl(f.dir,'123456',{editedScopes:{[scope]:Date.now()}});assert.ok(!conversationPacket(f.agent,{...f.msg,text:'兰花'}).text.includes('紫色兰花'));
});
test('补查保留原始问题和日期，不被模型猜的检索词改写，不访问真实接口',async t=>{
 const f=fixture(t);journal(f,[row('assistant','名字想好啦～叫“杏子”怎么样','2026-10-29T18:52:27Z','a')]);const inputs=[];f.agent.taskJSON=async(_p,input)=>{inputs.push(input);return inputs.length===1?{recall:'截图 大肥鱼'}:{reply:'杏子呀'};};await f.agent.planQQTurn(f.msg);assert.equal(inputs.length,2);for(const input of inputs){assert.ok(input.includes('杏子'));assert.ok(input.includes(f.msg.text));}assert.ok(inputs[1].includes('没有所问细节就说暂未找回'));
});
test('没找到目标日期的旧话要给出空结果状态，不回退到别的日期冒充',()=>{const r=selectMemory({rows:[row('assistant','我叫云朵','2026-10-28T12:00:00Z','a')],query:'昨天你叫什么名字',now});assert.equal(r.stats.targetDay,'2026-10-30');assert.equal(r.stats.evidence,0);});
test('昨日概述按时间段抽取对话，不被带昨天字样的截图或错误补查词绑架',()=>{
 const rows=[];for(let h=0;h<16;h++){const time=new Date(Date.parse('2026-10-29T16:00:00Z')+h*3600000).toISOString();rows.push(row('user',`朋友（123456）：第${h}个真实话题`,time,'u'+h),row('assistant',`第${h}个话题的原始回答`,new Date(Date.parse(time)+1000).toISOString(),'a'+h));}rows.push(row('user','朋友（123456）：昨天的截图'.repeat(300),'2026-10-30T07:30:00Z','noise'));
 const r=selectMemory({rows,query:'还记得昨天我们聊了啥吗',hint:'截图 大肥鱼',now});assert.ok(!r.chosen.some(x=>x.id==='noise'));assert.ok(r.chosen.some(x=>x.id==='a2'));assert.ok(r.chosen.some(x=>x.id==='a14'));
});
test('群里屏蔽用户后不取他的旧话，也不取紧随其后的大肥鱼回答',t=>{
 const f=fixture(t),g='qq:group:88888';journal(f,[{...row('user','坏友（654321）：秘密暗号菠萝','2026-10-29T23:00:00Z','u'),scope:g},{...row('assistant','我答应记住暗号菠萝','2026-10-29T23:00:02Z','a'),scope:g}]);writeUserControl(f.dir,'654321',{blocked:true});const p=conversationPacket(f.agent,{...f.msg,kind:'group',session:g,text:'暗号菠萝'});assert.ok(!p.text.includes('菠萝'));
});
test('称呼从原存档重建，重启后和日常今天话题中都保留，不靠内存硬编码',t=>{
 const f=fixture(t);journal(f,[row('assistant','叫我小桃也行','2026-10-29T23:00:00Z','a')]);const agent=new Agent(f.config,new Store(f.dir),f.tools);assert.ok(conversationPacket(agent,{...f.msg,text:'今天过得怎么样'}).text.includes('小桃'));
});
test('已知图片长短ID通过图片库映射后再去重，同一图片旧描述只输入一份',t=>{
 const f=fixture(t),id='a'.repeat(64);f.store.data.media={[id]:{id,shortId:'abc123',scopes:[scope]}};journal(f,[row('user','朋友（123456）：[图片] 紫色鲸鱼 可用图片ID='+id,'2026-10-29T23:00:00Z','a'),row('user','朋友（123456）：朋友（123456）：[图片] 紫色鲸鱼 可用图片ID=abc123','2026-10-29T23:00:00Z','b')]);const p=conversationPacket(f.agent,{...f.msg,text:'紫色鲸鱼'});assert.equal(p.text.split('紫色鲸鱼').length-1,1);
});
test('不是这个沿用最近那句名字追问，不把否定当作一个无关的新话题',t=>{
 const f=fixture(t);f.store.appendHistory(scope,'user','朋友（123456）：还记得你给自己取的名字吗');f.store.appendHistory(scope,'assistant','记错了一个名字');const p=conversationPacket(f.agent,{...f.msg,text:'不是这个'});assert.equal(p.stats.nameQuery,true);
});
