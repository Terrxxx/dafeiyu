import test from 'node:test';
import assert from 'node:assert/strict';
import { billingRequest } from '../src/billing.js';

const url = 'https://api.example.com/v1/chat/completions';
const config = { provider: 'custom', baseUrl: 'https://api.example.com' };
const options = { body: JSON.stringify({ model: 'test-model', messages: [] }) };

test('custom provider cooldown honors Retry-After across chat and vision and recovers automatically', async () => {
  let now = Date.parse('2026-11-15T12:00:00Z');
  let calls = 0;
  const context = { config, store: {}, now: () => now, log() {} };
  const request = async () => {
    calls++;
    return calls === 1 ? new Response('overload', { status: 429, headers: { 'Retry-After': '12' } }) :
      Response.json({ choices: [{ message: { content: '已恢复' } }] });
  };
  const chat = billingRequest(request, context);
  const vision = billingRequest(request, context);
  const limited = await chat(url, options);
  assert.equal(limited.status, 429);
  assert.match((await limited.json()).error.message, /自定义供应商繁忙或限流，约 12 秒后可再试/);
  now += 5000;
  const held = await vision(url, options);
  assert.equal(held.headers.get('retry-after'), '7');
  assert.equal(calls, 1);
  now += 7000;
  assert.equal((await vision(url, options)).status, 200);
  assert.equal(calls, 2);
});

test('custom provider timeout is classified as 504 and does not retry the original request', async () => {
  let calls = 0;
  const chat = billingRequest(async () => {
    calls++;
    throw new DOMException('timed out', 'TimeoutError');
  }, { config, store: {}, now: () => 1000, log() {} });
  const timeout = await chat(url, options);
  assert.equal(timeout.status, 504);
  assert.match((await timeout.json()).error.message, /自定义供应商请求超时/);
  assert.equal((await chat(url, options)).status, 429);
  assert.equal(calls, 1);
});
