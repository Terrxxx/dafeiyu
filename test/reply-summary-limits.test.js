import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { Agent } from '../src/agent.js';
import { HarnessAgent } from '../src/harness-agent.js';
import { unwrapReply } from '../src/reply-summary.js';
import { QQ } from '../src/qq.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-summary-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const config = { apiKey: 'api-secret', wsToken: 'ws-secret', baseUrl: 'https://test.invalid', model: 'test', persona: 'test',
    qq: { enabled: true }, bilibili: { enabled: true, maxDynamicsPerHour: 2 }, logging: { replySummary: true },
    social: { qzoneEnabled: true, qzoneVisibility: 1, maxQzonePostsPerHour: 2 },
    agent: { maxOutgoingPerHour: 100, maxModelCallsPerHour: 100, maxToolRounds: 3, maxOutputTokens: 500, historyMessages: 64 } };
  return { store, config };
}
test('两平台使用独立可配置小时发布限额，提额能继续发且重复内容不占额', async t => {
  const { store, config } = fixture(t); const calls = [];
  const tools = new SocialTools(config, store, { call: async (name, args) => { calls.push(name); return { tid: '1' }; } },
    { publishDynamic: async () => { calls.push('bili'); return { dynamicId: '2' }; } });
  tools.begin('autonomous-social');
  for (const name of ['qzone_publish', 'bili_publish_dynamic']) {
    for (let i = 0; i < 2; i++) await tools.call(name, { text: `${name}${i}` });
    await tools.call(name, { text: `${name}0` });
    await assert.rejects(() => tools.call(name, { text: `${name}2` }), /限额/);
  }
  assert.equal(calls.length, 4);
  config.social.maxQzonePostsPerHour = 3; config.bilibili.maxDynamicsPerHour = 3;
  await tools.call('qzone_publish', { text: 'qzone_publish2' });
  await tools.call('bili_publish_dynamic', { text: 'bili_publish_dynamic2' });
  assert.equal(calls.length, 6);
});
test('发布限额0禁止发布，但不把未尝试的内容错误标为不确定', async t => {
  const { store, config } = fixture(t);
  config.social.maxQzonePostsPerHour = 0; config.bilibili.maxDynamicsPerHour = 0;
  const tools = new SocialTools(config, store, {}, {}); tools.begin('autonomous-social');
  for (const name of ['qzone_publish', 'bili_publish_dynamic']) await assert.rejects(() => tools.call(name, { text: '正文' }), /限额为0/);
  assert.deepEqual(store.data.actions, {});
});
test('直接与Harness路径只返回聊天正文，简要概述进日志且不保留内部推理字段', async t => {
  for (const harness of [false, true]) {
    const { store, config } = fixture(t); const summaries = []; const requests = [];
    const responses = [JSON.stringify({ reply: true, summary: '对方延续话题，选择接话' }),
      JSON.stringify({ reply: '记得呀', summary: '顺着旧话题回应 api-secret\nws-secret' })];
    const tools = new SocialTools(config, store, {}, {});
    const agent = harness ? new HarnessAgent(config, store, tools, { run: async (input, options) => { requests.push(input); return responses.shift(); } }) :
      new Agent(config, store, tools, async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ choices: [{ message: { content: responses.shift(), reasoning_content: 'PRIVATE_REASONING_NOT_FOR_LOG' } }] }) }; });
    agent.onDecisionSummary = entry => summaries.push(entry);
    assert.equal(await agent.shouldReply('qq:user:1', '还记得吗'), true);
    assert.equal(await agent.run('qq:user:1', '还记得吗', false, { replySummary: true }), '记得呀');
    assert.equal(summaries.length, 2);
    assert.equal(store.context('qq:user:1').at(-1).content, '记得呀');
    const audit = fs.readFileSync(store.auditFile, 'utf8');
    assert.ok(!audit.includes('api-secret')); assert.ok(!audit.includes('ws-secret'));
    assert.ok(!audit.includes('PRIVATE_REASONING_NOT_FOR_LOG')); assert.ok(audit.includes('[已隐藏]'));
    const { buildSystemPrompt } = await import('../src/runtime-skills.js');
    assert.ok((buildSystemPrompt(config.persona) + JSON.stringify(requests)).includes('不要输出逐步推理'));
  }
});
test('概述缺失明确标记，损坏的封装不泄露到聊天，日志开关可关闭', async t => {
  assert.equal(unwrapReply('正常短句').text, '正常短句');
  assert.match(unwrapReply('正常短句').summary, /未提供/);
  assert.throws(() => unwrapReply('{"reply":"截断'), /封装不完整/);
  assert.throws(() => unwrapReply('{"reply":42,"summary":"字段错误"}'), /字段无效/);
  assert.equal(unwrapReply('{"reply":"","summary":"已通过工具发送图片"}', true).text, '');
  const { store, config } = fixture(t); config.logging.replySummary = false;
  const agent = new Agent(config, store, {}); agent.onDecisionSummary = () => assert.fail('日志已关闭');
  agent.reportDecision('s', '概述', 'test'); assert.equal(fs.existsSync(store.auditFile), false);
});

test('HTML换行附着封装时只提取正文，空正文、夹杂文字及嵌套封装不外发', async () => {
  for (const suffix of ['</br>', '<br>', '<br/>', '<BR />']) {
    assert.equal(unwrapReply(`{"reply":"好呀<br>走吧","summary":"接话"}${suffix}`).text, '好呀\n走吧');
    assert.throws(() => unwrapReply(`{"reply":"","summary":""}${suffix}`), /正文为空/);
  }
  assert.equal(unwrapReply('```json\n{"reply":"好呀","summary":"接话"}\n```</br>').text, '好呀');
  assert.equal(unwrapReply('{"reply":"","summary":""}</br>', true).text, '');
  for (const text of ['说明：{"reply":"好呀","summary":"接话"}</br>', '{"reply":"好呀","summary":"接话"}尾巴', '{"reply":"截断</br>', '{"reply":false,"summary":"不发"}</br>', JSON.stringify({ reply: '{"reply":"","summary":""}</br>', summary: '嵌套' })]) assert.throws(() => unwrapReply(text), /封装/);
  const qq = new QQ({}, () => {}); const sent = []; qq.call = async (action, params) => { sent.push(params); return { message_id: 1 }; };
  assert.throws(() => qq.send('private', '1', '{"reply":"","summary":""}</br>'), /正文为空/);
  assert.equal(sent.length, 0);
  await qq.send('group', '2', '{"reply":"好呀","summary":"内部概述"}</br>');
  assert.deepEqual(sent[0].message, [{ type: 'text', data: { text: '好呀' } }]);
});

test('两种模型入口即使关闭概述日志仍解析封装，工具发送也只使用正文', async t => {
  for (const harness of [false, true]) {
    const { store, config } = fixture(t); config.logging.replySummary = false;
    const responses = ['{"reply":"好呀","summary":"内部概述"}</br>', '{"reply":"","summary":""}</br>'];
    const sent = []; const qq = { send: async (kind, target, text) => { sent.push(text); return { message_id: 1 }; } };
    const tools = new SocialTools(config, store, qq, {});
    const agent = harness ? new HarnessAgent(config, store, tools, { run: async () => responses.shift() }) : new Agent(config, store, tools, async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: responses.shift() } }] }) }));
    agent.onDecisionSummary = () => assert.fail('logging disabled');
    assert.equal(await agent.run('qq:user:1', '你好', false, { replySummary: true }), '好呀');
    await assert.rejects(agent.run('qq:user:1', '你好', false, { replySummary: true }), /正文为空/);
    tools.begin('qq:user:1', { kind: 'private', target: '1', sender: '1', id: '9', key: 'reply:9' });
    await assert.rejects(tools.call('qq_reply_current', { text: '{"reply":"","summary":""}</br>' }), /正文为空/);
    await tools.call('qq_reply_current', { text: '{"reply":"好呀","summary":"内部概述"}</br>' });
    assert.deepEqual(sent, ['好呀']);
    assert.equal(store.context('qq:user:1').at(-1).content, '好呀');
  }
});
