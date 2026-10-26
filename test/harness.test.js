import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { Store } from '../src/store.js';
import { HarnessRuntime, runIdFromMessages } from '../src/harness-runtime.js';
import { HarnessAgent } from '../src/harness-agent.js';
import { SocialTools } from '../src/tools.js';

const installed = fs.existsSync(path.join(ROOT, 'harness-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'));
test('完整社交工具在真实Harness注册，查询目标后继续发送并取得回执', { skip: !installed }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-full-tools-'));
  const store = new Store(directory); const executed = [];
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test',
    qq: { enabled: true, allowUsers: [], allowGroups: ['123456'] },
    agent: { maxOutputTokens: 100, maxToolRounds: 4, maxModelCallsPerHour: 20, maxOutgoingPerHour: 100, historyMessages: 20 } };
  const qq = { call: async name => name === 'get_group_list' ? [{ group_id: 123456, group_name: '测试群' }] : [],
    send: async (...args) => { executed.push(args); return { message_id: 42 }; } };
  const tools = new SocialTools(config, store, qq, {}); tools.begin('qq:user:1');
  let calls = 0;
  const runtime = new HarnessRuntime(config, store, tools, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.tools.length, tools.schemas.length);
    const n = ++calls;
    if (n <= 2) return stream({ role: 'assistant', tool_calls: [{ index: 0, id: `call${n}`, type: 'function', function: {
      name: n === 1 ? 'qq_list_targets' : 'qq_send_message',
      arguments: n === 1 ? '{}' : JSON.stringify({ kind: 'group', target: '123456', text: '人呢' }),
    } }] }, 'tool_calls');
    assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('42')));
    return stream({ role: 'assistant', content: '发了' });
  });
  runtime.home = path.join(directory, 'home');
  t.after(async () => { await runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(await runtime.run('向测试群发人呢', { useTools: true }), '发了');
  assert.equal(executed.length, 1); assert.equal(executed[0][2], '人呢');
});
function stream(delta, finish = 'stop') {
  const chunk = (d, reason) => 'data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0,
    model: 'test-model', choices: [{ index: 0, delta: d, finish_reason: reason }] }) + '\n\n';
  return new Response(chunk(delta, null) + chunk({}, finish) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
test('real Harness loop calls only bridged tools and returns their result', { skip: !installed }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-harness-test-'));
  const store = new Store(directory); let calls = 0; const requests = []; const executed = [];
  const config = { apiKey: 'test-key', baseUrl: 'https://example.test', model: 'test-model', persona: 'Test agent',
    agent: { maxOutputTokens: 100, maxToolRounds: 3, maxModelCallsPerHour: 10 } };
  const tools = { schemas: [{ type: 'function', function: { name: 'lookup', description: 'Look up a value',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }],
    call: async (name, args) => { executed.push({ name, args }); return { answer: 'found' }; } };
  const runtime = new HarnessRuntime(config, store, tools, async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (++calls === 1) return stream({ role: 'assistant', tool_calls: [{ index: 0, id: 'lookup1', type: 'function', function: { name: 'lookup', arguments: '{"query":"test"}' } }] }, 'tool_calls');
    return stream({ role: 'assistant', content: 'found' });
  });
  runtime.home = path.join(directory, 'home');
  t.after(async () => { await runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(await runtime.run('Look up test', { useTools: true }), 'found');
  runtime.runs.set('missing-tools', { useTools: true });
  const missing = await fetch(`http://127.0.0.1:${runtime.server.address().port}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '[DAFEIYU_RUN:missing-tools]' }] }),
  });
  assert.equal(missing.status, 503);
  runtime.runs.delete('missing-tools');
  assert.deepEqual(executed, [{ name: 'lookup', args: { query: 'test' } }]);
  assert.deepEqual(requests[0].tools.map(x => x.function.name), ['lookup']);
  assert.equal(requests[1].messages.find(x => x.role === 'tool').content, '{"answer":"found"}');
  assert.equal(store.data.counters.length, 2);
  assert.equal(await runtime.run('No tools this time'), 'found');
  assert.equal(requests[2].tools, undefined);
  const denied = await fetch(`http://127.0.0.1:${runtime.server.address().port}/schemas`);
  assert.equal(denied.status, 401);
  const stale = await fetch(`http://127.0.0.1:${runtime.server.address().port}/tool`, { method: 'POST',
    headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'retired', name: 'lookup', args: {} }) });
  assert.equal(stale.status, 403);
});

test('Harness agent migrates bounded context and keeps silent decisions without sending', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-harness-context-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); store.appendHistory('a', 'assistant', 'earlier'); store.appendHistory('b', 'user', 'private');
  const inputs = [];
  const runtime = { run: async (input, options) => { inputs.push({ input, options }); return '{"reply":false}'; } };
  const agent = new HarnessAgent({ agent: { historyMessages: 64, contextMaxChars: 100 } }, store, {}, runtime);
  assert.equal(await agent.shouldReply('a', 'hello'), false);
  assert.ok(inputs[0].input.includes('earlier')); assert.ok(!inputs[0].input.includes('private'));
  assert.ok(inputs[0].input.indexOf('earlier') < inputs[0].input.indexOf('当前时间'));
  assert.equal(inputs[0].options.json, true); assert.equal(store.context('a').at(-1).content, 'hello');
  assert.equal(runIdFromMessages([{ role: 'user', content: '[DAFEIYU_RUN:test-123]\nhello' }]), 'test-123');
  assert.equal(runIdFromMessages([{ role: 'user', content: 'hello\n\n[DAFEIYU_RUN:test-456]' }]), 'test-456');
  runtime.run = async () => '<｜｜DSML｜｜ calls>fake</｜｜DSML｜｜ calls>';
  await assert.rejects(() => agent.run('a', 'send'), /已阻止发送/);
});
