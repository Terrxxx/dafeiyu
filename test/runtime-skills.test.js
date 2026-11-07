import test from 'node:test';import assert from 'node:assert/strict';
import {buildSystemPrompt,replySkillActivation}from'../src/runtime-skills.js';
import {qqReplyInput}from'../src/qq-reply-input.js';import{unpack,promptData}from'../src/prompt-packing.js';
test('默认系统技能含权限、工具和输出约定，用户人格原文完整保留',()=>{
 const persona='喜欢草莓\n保留我的整段人格提示词。';const system=buildSystemPrompt(persona);
 assert.ok(system.endsWith(persona));for(const text of ['qq_reply_current','qq_send_image','Markdown','跨会话','私聊原话','summary'])assert.ok(system.includes(text));assert.equal(replySkillActivation.trim(),'启用聊天回复封装。');
});
test('第二次QQ输入只放资料，消息、身份、图片、表情候选和未读标记完整保留',()=>{
 const msg={kind:'private',target:'123',sender:'123',name:'爸',mentioned:true,text:'完整原话'.repeat(200),unreadReview:true,unreadCount:8};
 const stickers=[{imageId:'image1',description:'不截断的表情说明'}],input=qqReplyInput(msg,{qq:{adminUsers:['123']}},stickers,'图片真实描述','fog');
 for(const text of [msg.text,'image1','不截断的表情说明','图片真实描述','admin=true','unreadCount=8','fog=true'])assert.ok(input.includes(text));
 assert.ok(!input.includes('工具已回复后不要再次发送'));assert.ok(!input.includes('启用聊天回复封装'));
});
test('系统已定义表格格式时不重复添加说明，内部分析仍默认自带说明',()=>{
 const rows=Array.from({length:30},(_,i)=>({role:'user',content:'保留原话'+i}));const shared=promptData(rows,{legend:false});assert.deepEqual(unpack(JSON.parse(shared)),rows);assert.ok(!shared.includes('表格数据：'));assert.ok(promptData(rows).startsWith('表格数据：'));
});
