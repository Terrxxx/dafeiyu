import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Feelings } from '../src/feelings.js';
import { Agent } from '../src/agent.js';
import { HarnessAgent } from '../src/harness-agent.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-memory-visibility-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const feelings = new Feelings(store);
  const remember = (id, scope, text, memories) => {
    const msg = { sender: id, session: scope, text };
    feelings.receive(msg);
    feelings.applyChat(msg, { users: [{ id, reaction: 'friendly', evidence: text, memories }] }, `${scope}:${text}`);
  };
  remember('1', 'qq:user:1', '我喜欢草莓。私人暗号是月亮船', [
    { kind: 'preference', quote: '我喜欢草莓', sharedFact: '喜欢草莓' },
    { kind: 'shared_topic', quote: '私人暗号是月亮船' },
  ]);
  remember('2', 'qq:user:2', '私人暗号是小飞象', [{ kind: 'shared_topic', quote: '私人暗号是小飞象' }]);
  remember('1', 'qq:group:9', '大家晚上好呀', []);
  return { store, feelings, remember };
}

test('同一QQ号跨群和私聊沿用关系与可公开喜好，不携带私聊原话和来源', t => {
  const { feelings, store } = setup(t);
  const privateUser = feelings.snapshot('qq:user:1').users[0];
  const groupUser = feelings.snapshot('qq:group:9').users[0];
  for (const key of ['affinity', 'trust', 'familiarity']) assert.equal(groupUser[key], privateUser[key]);
  assert.deepEqual(groupUser.sharedPreferences, ['喜欢草莓']);
  assert.equal(groupUser.memories.length, 0);
  const group = JSON.stringify(feelings.snapshot('qq:group:9'));
  assert.ok(!group.includes('月亮船')); assert.ok(!group.includes('小飞象')); assert.ok(!group.includes('qq:user:1'));
  assert.ok(!JSON.stringify(feelings.snapshot('qq:user:2')).includes('草莓'));
  assert.ok(!JSON.stringify(feelings.snapshot('qq:user:1')).includes('小飞象'));
  assert.ok(JSON.stringify(feelings.snapshot('qq:user:1')).includes('月亮船'));
  assert.deepEqual(new Feelings(new Store(path.dirname(store.file))).snapshot('qq:group:9').users[0].sharedPreferences, ['喜欢草莓']);
});

test('未经明确提取的旧记忆、私密内容和无原话证据的喜好不能自动扩散', t => {
  const { feelings, remember } = setup(t);
  for (const [text, memory] of [
    ['我喜欢下雨', { kind: 'preference', quote: '我喜欢下雨' }],
    ['我喜欢热茶', { kind: 'preference', quote: '我喜欢热茶', sharedFact: '喜欢咖啡' }],
    ['别告诉别人我喜欢葡萄', { kind: 'preference', quote: '我喜欢葡萄', sharedFact: '喜欢葡萄' }],
    ['我的密码是123456', { kind: 'preference', quote: '我的密码是123456', sharedFact: '密码是123456' }],
    ['我很难过', { kind: 'shared_topic', quote: '我很难过', sharedFact: '很难过' }],
  ]) remember('1', 'qq:user:1', text, [memory]);
  assert.deepEqual(feelings.snapshot('qq:group:9').users[0].sharedPreferences, ['喜欢草莓']);
  assert.ok(!JSON.stringify(feelings.snapshot('qq:group:8')).includes('草莓'));
});

test('跨群共享仅本人的可公开喜好，别人的私聊和其他群记录不进入当前上下文', t => {
  const { feelings, remember } = setup(t);
  remember('1', 'qq:group:8', '我喜欢围棋，同群暗号是青山', [
    { kind: 'preference', quote: '我喜欢围棋', sharedFact: '喜欢围棋' },
    { kind: 'shared_topic', quote: '同群暗号是青山' },
  ]);
  const privateView = JSON.stringify(feelings.snapshot('qq:user:1'));
  assert.ok(privateView.includes('喜欢围棋')); assert.ok(!privateView.includes('青山'));
  const groupView = JSON.stringify(feelings.snapshot('qq:group:9'));
  assert.ok(groupView.includes('喜欢围棋')); assert.ok(!groupView.includes('青山'));
});

test('普通模型和Harness实际提示上下文都共享喜好并隔离聊天原文及睡眠摘要', async t => {
  const { store } = setup(t);
  store.appendHistory('qq:user:1', 'user', '私聊历史哨兵甲');
  store.appendHistory('qq:user:2', 'user', '私聊历史哨兵乙');
  store.data.sleepSummaries = { 'qq:user:1': [{ text: '私聊摘要哨兵甲' }] };
  const config = { apiKey: 'test', baseUrl: 'https://example.test', persona: '测试', agent: { historyMessages: 20, maxToolRounds: 1, maxModelCallsPerHour: 0 } };
  let payload;
  const agent = new Agent(config, store, {}, async (_url, options) => {
    payload = options.body;
    return new Response(JSON.stringify({ choices: [{ message: { content: '好呀' } }] }));
  });
  let harnessPrompt;
  const harness = new HarnessAgent(config, store, {}, { run: async prompt => { harnessPrompt = prompt; return '好呀'; } });
  await agent.run('qq:group:9', '你好', false, { remember: false });
  await harness.run('qq:group:9', '你好', false, { remember: false });
  for (const prompt of [payload, harnessPrompt]) {
    assert.ok(prompt.includes('喜欢草莓'));
    for (const secret of ['月亮船', '小飞象', '私聊历史哨兵甲', '私聊历史哨兵乙', '私聊摘要哨兵甲']) assert.ok(!prompt.includes(secret));
  }
  await agent.run('qq:user:2', '你好', false, { remember: false });
  assert.ok(!payload.includes('月亮船')); assert.ok(!payload.includes('私聊历史哨兵甲')); assert.ok(!payload.includes('草莓'));
});
