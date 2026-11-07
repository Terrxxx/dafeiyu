import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Qzone } from '../src/qzone.js';
import { Bilibili } from '../src/bilibili.js';
import { rememberPosts } from '../src/qq-features.js';
import { SocialTools } from '../src/tools.js';
import { Store } from '../src/store.js';
import { checkQzoneComments } from '../src/qzone-monitor.js';

const post=(author='1')=>({owner:'2',tid:'post',text:'原动态',comments:[{ref:'comment',commentId:'3',userId:author,text:'评论',name:'鱼'}],images:[]});
function setup(t){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-no-self-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const store=new Store(dir),tools=new SocialTools({qq:{enabled:true},social:{qzoneEnabled:true},agent:{maxOutgoingPerHour:100}},store,{},{});
  t.after(()=>tools.components.close());tools.begin('autonomous-social');return{store,tools};
}
test('QQ空间本人身份取自登录账号而非动态主人；作者数字/字符串均禁止自回复',async()=>{
  for(const author of ['1',1]){
    const q=new Qzone({});let reads=0,writes=0;q.auth=async()=>({id:'1'});q.posts=async()=>{reads++;return{posts:[post(author)]};};q.call=async()=>{writes++;return{};};
    await assert.rejects(q.reply(post(author),post(author).comments[0],'回应'),/不能回复自己/);assert.equal(reads,0);assert.equal(writes,0);
  }
  const q=new Qzone({});q.auth=async()=>({id:'1'});q.posts=async()=>({posts:[post('3')]});let writes=0;q.call=async()=>{writes++;return{commentid:'9'};};
  assert.equal((await q.reply(post('3'),post('3').comments[0],'你好')).accepted,true);assert.equal(writes,1);
});
test('QQ空间预读标识本人，工具入口在记账及调用网络前拒绝自回复',async t=>{
  const {tools,store}=setup(t);let network=0;tools.qzone.reply=async()=>{network++;return{accepted:true};};
  const result=rememberPosts(tools,{owner:'2',selfId:'1',posts:[post('1')]});
  assert.equal(result.posts[0].comments[0].isSelf,true);assert.equal(result.posts[0].comments[0].canReply,false);
  await assert.rejects(tools.call('qzone_reply_comment',{commentRef:'comment',text:'再回我自己'}),/不能回复自己/);
  assert.equal(network,0);assert.equal(store.data.counters.length,0);assert.equal(Object.keys(store.data.actions).length,0);
  tools.begin('autonomous-social');assert.equal(tools.qzoneSelfId,null);
  const other=rememberPosts(tools,{owner:'2',selfId:'1',posts:[post('3')]});assert.equal(other.posts[0].comments[0].canReply,true);
});
test('自己的空间巡检排除本人评论，同时保留其他用户新评论的判断',async t=>{
  const {tools,store}=setup(t);let calls=0;
  tools.qzone.posts=async()=>({owner:1,selfId:'1',self:true,posts:[{...post(1),owner:'1'}]});
  store.data.meta.qzoneBaseline=1;store.data.meta.qzoneSeen=[];
  await checkQzoneComments({tools,store,agent:{run:()=>calls++},log(){}});assert.equal(calls,0);
  tools.qzone.posts=async()=>({owner:'1',selfId:'1',self:true,posts:[{...post('3'),owner:'1'}]});
  await checkQzoneComments({tools,store,agent:{run:()=>calls++},log(){}});assert.equal(calls,1);
});
test('B站通知和@入口过滤自己，其他作者通知仍可回复；不能伪造通知绕过',async()=>{
  const b=new Bilibili('');b.ownId=async()=> '1';
  const event=(id,mid)=>({id,user:{mid},item:{business_id:11,subject_id:10,source_id:20,root_id:20,source_content:'评论'}});
  b.api=async endpoint=>{if(endpoint==='/x/msgfeed/reply')return{items:[event(1,1),event(2,'2')]};if(endpoint==='/x/msgfeed/at')return{items:[event(3,'1'),event(4,2)],cursor:{is_end:true}};throw Error('不得发送');};
  assert.deepEqual((await b.notices('reply')).items.map(n=>n.ref),['reply:2']);assert.deepEqual((await b.mentions()).map(n=>n.id),[4]);
  b.noticeRecords.set('reply:own',event(5,'1'));await assert.rejects(b.replyNotice('reply:own','自言自语'),/不能回复自己/);
  await assert.rejects(b.verifyThread({sender:'1',root:'20',parent:'20'},10),/不能回复自己/);
});
test('B站最终评论写入前重新核验实际作者，自回复和缺失楼层均无POST，正常回复及顶层评论不受影响',async()=>{
  const b=new Bilibili('');b.ownId=async()=> '1';let author='1',missing=false,writes=0;
  b.api=async(endpoint,args,isPost)=>{if(isPost){writes++;return{rpid_str:'50'};}assert.equal(endpoint,'/x/v2/reply/reply');return{root:{rpid:10,oid:42,mid:'1'},replies:missing?[]:[{rpid:20,oid:42,member:{mid:author}}]};};
  await assert.rejects(b.comment(42,'自己回自己','10','20'),/不能回复自己/);assert.equal(writes,0);
  missing=true;await assert.rejects(b.comment(42,'看不到作者也不发','10','20'),/无法核验/);assert.equal(writes,0);
  missing=false;author='2';assert.equal((await b.comment(42,'正常回复','10','20')).rpid,'50');assert.equal(writes,1);
  await b.comment(42,'正常顶层评论');assert.equal(writes,2);
});
