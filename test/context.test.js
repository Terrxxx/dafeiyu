import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { Agent } from '../src/agent.js';
import { handleQQMessage } from '../src/qq-handler.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-context-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Store(dir);
}
test('context survives restart, respects length and keeps sessions isolated', t => {
  const store = setup(t);
  store.appendHistory('a', 'user', 'old text', 4);
  store.appendHistory('a', 'assistant', 'recent text', 4);
  store.appendHistory('b', 'user', 'private secret', 4);
  const restored = new Store(path.dirname(store.file));
  assert.deepEqual(restored.context('a', 4, 6), [{ role: 'assistant', content: 't text' }]);
  assert.equal(restored.context('a', 4, 100, true)[0].content, 'old text');
  assert.ok(!JSON.stringify(restored.context('a')).includes('private secret'));
  assert.ok(restored.data.histories.a[0].time);
  assert.deepEqual(Object.keys(restored.context('a')[0]), ['role', 'content']);
});
test('context window shifts in blocks so the prompt prefix stays stable', t => {
  const store = setup(t);
  for (let i = 0; i < 10; i++) store.appendHistory('s', 'user', `m${i}`);
  const first = () => store.context('s', 8, 1000)[0].content;
  assert.equal(first(), 'm2');
  store.appendHistory('s', 'user', 'm10');
  assert.equal(first(), 'm2');
  store.appendHistory('s', 'user', 'm11');
  assert.equal(first(), 'm4');
});
test('proactive sends enter recipient context exactly once and failed sends do not', async t => {  const store = setup(t);
  const config = { qq: { enabled: true }, agent: { maxOutgoingPerHour: 10, historyMessages: 64 } };
  const qq = { send: async () => ({ message_id: 1 }) };
  const tools = new SocialTools(config, store, qq, {});
  tools.begin('autonomous-social'); tools.targets.add('private:123');
  tools.feelings.user('123').lastIncoming = Date.now() - 3600000;
  const args = { kind: 'private', target: '123', text: '刚发现一个有趣的话题' };
  await tools.call('qq_send_message', args);
  await assert.rejects(tools.call('qq_send_message', args), /暂不主动联系/);
  assert.equal(store.context('qq:user:123').length, 1);
  assert.equal(store.context('qq:user:123')[0].content, args.text);
  qq.send = async () => { throw new Error('offline'); };
  tools.feelings.user('123').lastProactive = 0;
  await assert.rejects(tools.call('qq_send_message', { ...args, text: '发送失败' }));
  assert.equal(store.context('qq:user:123').length, 1);
});
test('QQ tool reply history stores actual delivered text, not model closing commentary', async t => {
  const store = setup(t);
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: '',
    agent: { historyMessages: 64, contextMaxChars: 24000, maxModelCallsPerHour: 10, maxOutgoingPerHour: 10, maxToolRounds: 3, maxOutputTokens: 100 } };
  const qq = { send: async () => ({ message_id: 1 }) };
  const tools = new SocialTools(config, store, qq, {});
  let calls = 0; const requests = [];
  const agent = new Agent(config, store, tools, async (url, options) => {
    requests.push(JSON.parse(options.body)); calls++;
    const message = calls === 1 ? { content: '{"users":[]}' } : calls === 2 ? { content: '{"reply":true}' } : calls === 3
      ? { tool_calls: [{ id: 'reply', function: { name: 'qq_reply_current', arguments: '{"text":"实际回复"}' } }] }
      : { content: '已完成发送' };
    return { ok: true, json: async () => ({ choices: [{ message }] }) };
  });
  const msg = { session: 'qq:user:123', kind: 'private', target: '123', sender: '123', id: '1', text: '今天聊什么' };
  await handleQQMessage(msg, 'reply:1', { store, tools, qq, agent, throttle: { wait: async () => {} }, log: () => {} });
  const history = store.context(msg.session);
  assert.equal(history.length, 2);
  assert.match(history[0].content, /今天聊什么/);
  assert.equal(history[1].content, '实际回复');
  assert.equal(requests[2].messages.filter(m => m.role === 'user').length, 1);
  assert.ok(!JSON.stringify(history).includes('已完成发送'));
});
