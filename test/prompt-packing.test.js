import test from 'node:test';import assert from 'node:assert/strict';
import { pack, unpack, promptData } from '../src/prompt-packing.js';
import { estimateTokens } from '../src/ai-request-log.js';
import { Agent } from '../src/agent.js';
test('聊天原文、嵌套记忆、用户数值和顺序能逐字段完整还原，不修改输入',()=>{
 const value={history:Array.from({length:24},(_,i)=>({role:i%2?'assistant':'user',content:`原话${i}：喜欢猫，不喜欢鱼\nemoji🐟 "引号"`,time:i})),users:Array.from({length:6},(_,i)=>({id:String(i),affinity:-17+i,trust:25.5,memories:[{kind:'preference',quote:'原文完整保留',scope:'qq:user:1'},{kind:'boundary',quote:'这件事不要在群里说',scope:'qq:user:1'}]}))};
 const before=JSON.stringify(value);assert.deepEqual(unpack(pack(value)),value);assert.equal(JSON.stringify(value),before);
 const optimized=promptData(value);assert.ok(estimateTokens(optimized)<estimateTokens(before));assert.ok(optimized.includes('这件事不要在群里说'));assert.ok(optimized.includes('原话23'));
});
test('空值、不同字段、保留键碰撞和完整长文本都不丢失',()=>{
 for(const value of [[],null,[{x:null},{x:''}],[{a:1},{a:2,b:3}],{__cols:['原键'],__rows:['原值'],__object:'原文'},[{text:'内容'.repeat(10000)},{text:'内容'.repeat(10000)}]])assert.deepEqual(unpack(pack(value)),value);
 assert.equal(promptData([{role:'user',content:'你好'}]),JSON.stringify([{role:'user',content:'你好'}]));
});
test('完整状态和记忆放在动态时间前面，使缓存可复用，不移除时间信息',()=>{
 const fake={tools:{},feelings:{snapshot:()=>({mood:{joy:50},users:[]})},personality:{data:{interests:[],conversations:{}}},store:{data:{histories:{}}}};
 const text=Agent.prototype.timeContext.call(fake,'qq:user:123');assert.ok(text.indexOf('状态与偏好')<text.indexOf('当前时间'));assert.ok(text.includes('joy=50'));assert.ok(text.includes('UTC'));assert.ok(text.includes('qq:user:123'));
});
