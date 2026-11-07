import test from 'node:test';
import assert from 'node:assert/strict';
import { billingRequest } from '../src/billing.js';
import { requestShape } from '../src/ai-request-log.js';
test('请求估算跳过图片base64，日志不包含消息正文和密钥', async () => {
  const logs = [], body = { messages: [{role:'user',content:[{type:'text',text:'私密正文测试'},{type:'image_url',image_url:{url:'data:image/png;base64,'+'x'.repeat(100000)}}]}], max_tokens:100 };
  assert.equal(requestShape(body).images, 1);
  assert.ok(requestShape(body).total < 100);
  const call = billingRequest(async () => Response.json({usage:{prompt_tokens:25,completion_tokens:5,prompt_cache_hit_tokens:10}}), {log:line=>logs.push(line)});
  await call('https://example.test', {body:JSON.stringify(body),headers:{Authorization:'secret-key'}});
  assert.equal(logs.length, 2);
  assert.match(logs[0], /输入≈/);
  assert.match(logs[1], /实际输入25.*输出5.*缓存命中10/);
  assert.ok(!logs.join('').includes('私密正文测试'));
  assert.ok(!logs.join('').includes('secret-key'));
});
test('SSE完成只记录一次实际用量，HTTP失败有独立结果', async () => {
  const logs=[];
  const call=billingRequest(async()=>new Response('data: {"usage":{"prompt_tokens":40,"completion_tokens":8}}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}),{log:line=>logs.push(line)});
  await (await call('https://example.test',{body:'{"stream":true}'})).text();
  assert.equal(logs.length,2);assert.match(logs[1],/实际输入40.*输出8/);
  const fail=billingRequest(async()=>new Response('',{status:429}),{log:line=>logs.push(line)});
  await fail('https://example.test',{body:'{}'});assert.equal(logs.length,4);assert.match(logs[3],/失败 HTTP 429/);
});
