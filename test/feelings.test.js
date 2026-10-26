import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Feelings } from '../src/feelings.js';
import { SocialTools } from '../src/tools.js';
import { Agent } from '../src/agent.js';
import { mergeMessages } from '../src/message-buffer.js';
import { proactiveChat } from '../src/proactive.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-feelings-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new Store(dir);
}
test('情绪有界、逐渐平复、事件去重并跨重启保留', t => {
  const store = setup(t); let now = 10000000;
  const feelings = new Feelings(store, () => now);
  feelings.event('a', { joy: 10000, sadness: -10000 }, 'video');
  assert.equal(feelings.data.mood.joy, 53); assert.equal(feelings.data.mood.sadness, 2);
  assert.equal(feelings.event('a', { joy: 8 }, 'video'), false);
  assert.equal(new Feelings(new Store(path.dirname(store.file)), () => now).data.mood.joy, 53);
  now += 7200000; feelings.settle();
  assert.equal(feelings.data.mood.joy, 49);
});
test('群消息按真实发送者归属，悲伤话题不降好感，私聊记忆不会带入群', t => {
  const feelings = new Feelings(setup(t));
  const msg = mergeMessages([
    { sender: '1', id: '1', text: '今天真的很难过', session: 'qq:group:9' },
    { sender: '2', id: '2', text: '我喜欢听音乐', session: 'qq:group:9' },
  ]);
  feelings.receive(msg);
  feelings.applyChat(msg, { users: [
    { id: '1', reaction: 'sad_topic', evidence: '真的很难过', memories: [] },
    { id: '2', reaction: 'friendly', evidence: '喜欢听音乐', memories: [{ kind: 'preference', quote: '我喜欢听音乐' }] },
    { id: '3', reaction: 'hurtful', evidence: '真的很难过' },
  ] }, 'batch');
  assert.equal(feelings.data.users['1'].affinity, 0);
  assert.equal(feelings.data.users['3'], undefined);
  assert.equal(feelings.data.users['2'].memories[0].quote, '我喜欢听音乐');
  assert.equal(feelings.data.users['1'].memories.length, 0);
  const privateMsg = { sender: '2', text: '我喜欢安静的私聊', session: 'qq:user:2' };
  feelings.applyChat(privateMsg, { users: [{ id: '2', reaction: 'neutral', evidence: '安静的私聊', memories: [{ kind: 'boundary', quote: '安静的私聊' }] }] }, 'private');
  assert.ok(!JSON.stringify(feelings.snapshot('qq:group:9')).includes('安静的私聊'));
  assert.ok(!JSON.stringify(feelings.snapshot('qq:user:1')).includes('听音乐'));
  const before = feelings.data.users['2'].affinity;
  feelings.applyChat(msg, { users: [{ id: '2', reaction: 'friendly', evidence: '喜欢听音乐' }] }, 'batch');
  assert.equal(feelings.data.users['2'].affinity, before);
});
test('暂停主动联系可恢复；未回复、冷却期间和未互动用户不追发', t => {
  let now = 100000000; const f = new Feelings(setup(t), () => now);
  const msg = { sender: '1', text: '别主动找我了', session: 'qq:user:1' };
  f.receive(msg);
  f.applyChat(msg, { users: [{ id: '1', reaction: 'neutral', evidence: '别主动找我了', contact: 'pause', contactEvidence: '别主动找我了' }] }, 'pause');
  now += 3600000; assert.equal(f.canContact('1'), false);
  msg.text = '可以主动找我了'; f.receive(msg);
  f.applyChat(msg, { users: [{ id: '1', reaction: 'neutral', evidence: msg.text, contact: 'allow', contactEvidence: msg.text }] }, 'allow');
  now += 3600000; assert.equal(f.canContact('1'), true);
  f.contacted('1'); now += 4 * 3600000;
  assert.equal(f.canContact('1'), false);
  f.receive(msg); now += 600001; assert.equal(f.canContact('1'), true);
  assert.equal(f.canContact('2'), false);
});
test('自主聊天使用单人记忆且只向选中用户发送，发送回执后才进入冷却', async t => {
  const store = setup(t); const config = { social: {}, qq: { enabled: true }, agent: { maxOutgoingPerHour: 10, historyMessages: 20 } };
  const sent = []; const tools = new SocialTools(config, store, { send: async (...args) => { sent.push(args); return { message_id: 1 }; } }, {});
  const f = tools.feelings; f.user('1').lastIncoming = Date.now() - 3600000;
  const agent = { feelings: f, run: async (scope, prompt, useTools, options) => {
    assert.equal(scope, 'qq:user:1'); assert.equal(options.remember, false);
    await assert.rejects(() => tools.call('qq_send_message', { kind: 'private', target: '2', text: '泄露' }));
    await tools.call('qq_send_message', { kind: 'private', target: '1', text: '上次那歌听了吗' });
  } };
  assert.equal(await proactiveChat(agent, tools, [{ kind: 'private', id: '1' }], config), true);
  assert.equal(sent.length, 1); assert.ok(f.user('1').lastProactive);
  assert.equal(await proactiveChat(agent, tools, [{ kind: 'private', id: '1' }], config), false);
});
test('视频感受通过实际阅读工具触发一次，伤感视频不改变用户关系', async t => {
  const store = setup(t); const config = { bilibili: { enabled: true, maxVideosPerRound: 3 }, agent: {} };
  const tools = new SocialTools(config, store, {}, { video: async bvid => ({ bvid, title: '伤感故事', evidence: '简介' }) });
  const agent = new Agent(config, store, tools);
  let calls = 0; agent.run = async () => { calls++; return '{"feeling":"sad"}'; };
  tools.experienceVideo = v => agent.experienceVideo(v); tools.begin('autonomous-browse');
  await tools.call('bili_read_video', { bvid: 'BV1234567890' });
  await tools.call('bili_read_video', { bvid: 'BV1234567890' });
  assert.equal(calls, 1); assert.ok(agent.feelings.data.mood.sadness > 14);
  assert.deepEqual(agent.feelings.data.users, {});
});
