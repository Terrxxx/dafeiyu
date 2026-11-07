import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Store } from '../src/store.js';
import { Feelings } from '../src/feelings.js';
import { compactMemories } from '../src/memory-maintenance.js';
import { recordUserActivity, readUserMemory, saveUserMemory, userMemoryRevision } from '../src/user-memory.js';
import { writeUserControl, readUserControls, filterUserMessage } from '../src/user-controls.js';
import { mergeMessages } from '../src/message-buffer.js';
import { rememberSleepUnread, reviewSleepUnread } from '../src/sleep-inbox.js';
import { Agent } from '../src/agent.js';
import { HarnessAgent } from '../src/harness-agent.js';
import { SocialTools } from '../src/tools.js';
import { describeMessageImages } from '../src/images.js';
function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-user-memory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); store.data.sleep = { needsCompaction: true };
  return { directory, store };
}
test('睡前按真实用户整合完整日记和旧记忆，跨私聊/群隔离，重复睡眠不重复记账', t => {
  const { store, directory } = setup(t); const feelings = new Feelings(store); const now = Date.now();
  feelings.user('1').memories.push({ scope: 'qq:user:1', quote: '很久以前确认的喜好', time: now - 86400000 });
  for (let i = 0; i < 90; i++) store.appendHistory('qq:user:1', 'user', `用户一的完整事情${i}`, 8);
  store.appendHistory('qq:user:2', 'user', '用户二的私人事情');
  recordUserActivity(store, { sender: '1', id: 'group-1', session: 'qq:group:9', text: '用户一在群里说的话', receivedAt: now });
  recordUserActivity(store, { sender: '2', id: 'group-2', session: 'qq:group:9', text: '用户二在群里说的话', receivedAt: now });
  feelings.user('1').groups = ['qq:group:9']; feelings.user('2').groups = ['qq:group:9'];
  compactMemories(store, now); const before = readUserMemory(directory, '1');
  assert.ok(before.sections['qq:user:1'].text.includes('完整事情0')); assert.ok(before.sections['qq:user:1'].text.includes('完整事情89'));
  assert.ok(before.sections['qq:user:1'].text.includes('很久以前确认的喜好'));
  assert.ok(!JSON.stringify(before).includes('用户二'));
  assert.ok(before.sections['qq:group:9'].text.includes('用户一在群里说的话'));
  compactMemories(store, now); assert.deepEqual(readUserMemory(directory, '1'), before);
  const group = JSON.stringify(feelings.snapshot('qq:group:9')); assert.ok(!group.includes('完整事情')); assert.ok(group.includes('用户一在群里说的话'));
  assert.ok(!JSON.stringify(feelings.snapshot('qq:user:2')).includes('用户一的完整事情'));
  assert.ok(JSON.parse(gunzipSync(fs.readFileSync(path.join(directory, 'user-memory/1.json.gz')))).sections);
});
test('手动清单修订不会被旧日记覆盖，新消息仍会增量合并并可检索', async t => {
  const { store, directory } = setup(t); const oldTime = Date.now() - 10000;
  recordUserActivity(store, { sender: '1', session: 'qq:group:9', id: 'old', text: '旧喜好是苹果', receivedAt: oldTime });
  compactMemories(store); const value = readUserMemory(directory, '1');
  value.sections['qq:group:9'].text = '- 新喜好是草莓'; saveUserMemory(directory, '1', value);
  writeUserControl(directory, '1', { editedScopes: { 'qq:group:9': Date.now() - 1000 } });
  recordUserActivity(store, { sender: '1', session: 'qq:group:9', id: 'new', text: '今天种了一盆花', receivedAt: Date.now() });
  compactMemories(store); const updated = readUserMemory(directory, '1');
  assert.ok(updated.sections['qq:group:9'].text.includes('新喜好是草莓')); assert.ok(!updated.sections['qq:group:9'].text.includes('苹果')); assert.ok(updated.sections['qq:group:9'].text.includes('种了一盆花'));
  const tools = new SocialTools({ qq: { enabled: true }, agent: {} }, store, {}, {});
  tools.begin('qq:group:9', { kind: 'group', target: '9', sender: '1', session: 'qq:group:9' });
  const result = await tools.call('qq_search_user_memory', { userId: '1', query: '种了一盆花' }); assert.ok(result.excerpts.length);
  await assert.rejects(() => tools.call('qq_search_user_memory', { userId: '2', query: '秘密' }), /当前会话/);
  tools.begin('qq:user:2', { kind: 'private', target: '2', sender: '2', session: 'qq:user:2' });
  await assert.rejects(() => tools.call('qq_search_user_memory', { userId: '1', query: '草莓' }), /当前会话/);
});
test('屏蔽在合并前、处理排队消息和睡眠未读时生效，不触发模型或主动发送', async t => {
  const { store, directory } = setup(t); writeUserControl(directory, '1', { blocked: true });
  const messages = ['1', '2'].map(id => ({ kind: 'group', target: '9', session: 'qq:group:9', sender: id, name: `用户${id}`, id, text: `消息${id}`, receivedAt: Date.now() }));
  const result = filterUserMessage(store, mergeMessages(messages)); assert.equal(result.sources.length, 1); assert.equal(result.sender, '2'); assert.ok(!result.text.includes('消息1'));
  assert.equal(filterUserMessage(store, messages[0]), null);
  rememberSleepUnread(store, mergeMessages(messages)); assert.equal(store.data.sleepUnread.length, 1); assert.equal(store.data.sleepUnread[0].sender, '2');
  const seen = [];
  await reviewSleepUnread({ store, tools: { sleep: { sleeping: () => false } }, log() {} }, async msg => { seen.push(msg.sender); }); assert.deepEqual(seen, ['2']);
  const tools = new SocialTools({ qq: { enabled: true }, agent: {} }, store, {}, {}); tools.begin('autonomous-social'); tools.targets.add('private:1');
  await assert.rejects(() => tools.call('qq_send_message', { kind: 'private', target: '1', text: '不应该发' }), /屏蔽/);
  const feelings = new Feelings(store); feelings.receive(messages[0]); assert.equal(feelings.data.users['1'], undefined);
  assert.equal(feelings.canContact('1'), false);
});
test('删除后运行中Store清空旧上下文、关系及群缓存，压缩旧数据不能重建档案，新消息从零认识', t => {
  const { store, directory } = setup(t); const feelings = new Feelings(store); const now = Date.now();
  Object.assign(feelings.user('1'), { affinity: 75, familiarity: 60, lastIncoming: now - 10000, groups: ['qq:group:9'] });
  feelings.user('2').memories.push({ scope: 'qq:user:2', quote: '用户二保留记忆', time: now });
  store.appendHistory('qq:user:1', 'user', '用户一的旧秘密'); store.appendHistory('qq:group:9', 'user', '含用户一的群上下文'); store.appendHistory('qq:user:2', 'user', '用户二的私聊'); compactMemories(store);
  const cutoff = Date.now() + 1; writeUserControl(directory, '1', { forgottenAt: cutoff });
  assert.deepEqual(store.context('qq:user:1'), []); assert.deepEqual(store.context('qq:group:9'), []);
  assert.equal(feelings.data.users['1'], undefined); assert.equal(feelings.data.users['2'].memories[0].quote, '用户二保留记忆');
  compactMemories(store); assert.deepEqual(readUserMemory(directory, '1').sections, {});
  assert.equal(filterUserMessage(store, { sender: '1', receivedAt: cutoff - 1 }), null);
  const fresh = { sender: '1', session: 'qq:user:1', text: '重新认识', receivedAt: cutoff + 10 }; feelings.receive(fresh);
  assert.equal(feelings.user('1').affinity, 0); assert.equal(feelings.user('1').familiarity, 0);
  assert.ok(!JSON.stringify(feelings.snapshot('qq:user:1')).includes('旧秘密'));
});
test('模型生成途中编辑或屏蔽用户，普通与Harness路径都丢弃旧回复', async t => {
  const { store, directory } = setup(t); const config = { apiKey: 'test', baseUrl: 'https://example.test', persona: 'test', agent: { maxModelCallsPerHour: 0, maxToolRounds: 1, historyMessages: 20 } };
  const direct = new Agent(config, store, {}, async () => { writeUserControl(directory, '1', { blocked: true }); return new Response(JSON.stringify({ choices: [{ message: { content: '旧回复' } }] })); });
  await assert.rejects(() => direct.run('qq:user:1', '问题', false), /旧回复已取消/); assert.equal(store.data.histories['qq:user:1'], undefined);
  const harness = new HarnessAgent(config, store, {}, { run: async () => { writeUserControl(directory, '1', { blocked: false }); return '旧回复'; } });
  await assert.rejects(() => harness.run('qq:user:1', '问题', false), /旧回复已取消/);
});

test('图片识别过程中删除用户，旧图片描述不会重新缓存成记忆素材', async t => {
  const { store, directory } = setup(t); let cached = 0; const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(Buffer.from('image'), { headers: { 'content-type': 'image/png' } });
  try {
    const agent = { store, tools: { media: { ingest() { cached++; } } }, describeImage: async () => { writeUserControl(directory, '1', { forgottenAt: Date.now() }); return '旧的私人截图描述'; } };
    await describeMessageImages({ session: 'qq:user:1', images: [{ url: 'https://q1.qlogo.cn/g?b=qq&nk=1&s=640' }] }, {}, agent, () => {});
    assert.equal(cached, 0);
  } finally { globalThis.fetch = originalFetch; }
});
