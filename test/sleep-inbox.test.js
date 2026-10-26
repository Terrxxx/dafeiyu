import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Sleep } from '../src/sleep.js';
import { SocialTools } from '../src/tools.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { rememberSleepUnread, reviewSleepUnread } from '../src/sleep-inbox.js';

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-unread-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return { directory, store: new Store(directory) };
}
const message = (id, user = '2', text = `消息${id}`) => ({ id: String(id), sender: user, name: user,
  kind: 'private', target: user, session: `qq:user:${user}`, text, images: [] });

test('最近99条QQ睡眠未读持久化，去重并淘汰最早消息', t => {
  const { store, directory } = setup(t);
  for (let i = 0; i < 103; i++) rememberSleepUnread(store, message(i));
  rememberSleepUnread(store, message(102));
  const restored = new Store(directory);
  assert.equal(restored.data.sleepUnread.length, 99);
  assert.equal(restored.data.sleepUnread[0].id, '4');
  assert.equal(restored.data.sleepUnread.at(-1).id, '102');
  assert.equal(restored.data.meta.sleepUnreadDropped, 4);
});
test('醒后只按同一会话分批看未读，长消息也不会在合并时截掉', async t => {
  const { store } = setup(t); const reviewed = [];
  for (let i = 0; i < 10; i++) rememberSleepUnread(store, message(i, i % 2 ? '2' : '3', '字'.repeat(6000)));
  await reviewSleepUnread({ store, tools: { sleep: { sleeping: () => false } }, log() {} }, async msg => {
    assert.ok(msg.sources.every(source => source.sender === msg.sender));
    assert.ok(msg.text.length >= 6000); assert.equal(msg.unreadReview, true);
    reviewed.push(...msg.sources.map(source => source.id));
  });
  assert.equal(new Set(reviewed).size, 10); assert.equal(store.data.sleepUnread.length, 0);
});
test('仍在睡觉时不读未读，醒后真实回复不被认领记录拦截，重启不重复发送', async t => {
  const { store, directory } = setup(t); let sends = 0; let asleep = true; let runs = 0;
  rememberSleepUnread(store, message(1)); rememberSleepUnread(store, message(2));
  const config = { qq: { enabled: true }, agent: { maxOutgoingPerHour: 100, historyMessages: 64 } };
  const qq = { send: async () => { sends++; return { message_id: 100 }; } };
  const tools = new SocialTools(config, store, qq, {});
  tools.sleep = { sleeping: () => asleep, responseMode: () => 'normal', assertAwake() { assert.equal(asleep, false); } };
  const agent = { config, shouldReply: async () => true, run: async (scope, input) => {
    runs++; assert.match(input, /醒后查看的2条/); return '刚看到，你说';
  } };
  const services = { store, tools, qq, agent, throttle: { wait: async () => {} }, log() {} };
  await reviewSleepUnread(services, handleQQMessage); assert.equal(runs, 0);
  asleep = false; await reviewSleepUnread(services, handleQQMessage);
  assert.equal(runs, 1); assert.equal(sends, 1);
  const restored = new Store(directory);
  await reviewSleepUnread({ ...services, store: restored }, handleQQMessage);
  assert.equal(sends, 1);
  assert.ok(Object.entries(restored.data.actions).some(([key, value]) => key.startsWith('wake-review:') && value.state === 'sent'));
});
test('未读处理失败或状态不明不自动重发；重新睡着保留尚未查看的消息', async t => {
  const { store } = setup(t); let asleep = false; let calls = 0;
  rememberSleepUnread(store, message(1, '2')); rememberSleepUnread(store, message(2, '3'));
  const services = { store, tools: { sleep: { sleeping: () => asleep } }, log() {} };
  await reviewSleepUnread(services, async (msg, key) => { calls++; asleep = true; store.data.actions[key] = { state: 'uncertain' }; throw new Error('timeout'); });
  assert.equal(calls, 1); assert.equal(store.data.sleepUnread.length, 1);
  await reviewSleepUnread(services, async () => { calls++; }); assert.equal(calls, 1);
  assert.ok(Object.values(store.data.actions).some(value => value.state === 'review-failed'));
});
test('梦境本地概率生成，醒后保留真实睡眠过程与梦境；不是每次都有梦', () => {
  for (const dreamChance of [0.1, 0.9]) {
    let now = Date.parse('2026-10-26T12:00:00+08:00');
    const store = { data: {}, save() {} }; const feelings = { data: { mood: { energy: 5 } }, settle() {} };
    const values = [0, 0, 0, dreamChance, 0.5];
    const sleep = new Sleep(store, feelings, () => now, () => values.shift() ?? 0.9);
    sleep.enter('drowsy', now, 5);
    assert.equal(sleep.sleeping(), true);
    now += 30 * 60000; sleep.tick();
    assert.equal(Boolean(sleep.data.dream), dreamChance < 0.4);
    const restart = new Sleep(store, feelings, () => now);
    now += 7 * 3600000;
    assert.equal(restart.sleeping(), false);
    assert.equal(restart.data.lastSleep.durationMinutes, 450);
    assert.equal(restart.data.lastSleep.startEnergy, 5);
    assert.equal(restart.data.lastSleep.endEnergy, 80);
    assert.equal(Boolean(restart.data.lastSleep.dream), dreamChance < 0.4);
    assert.match(restart.prompt(), /最近一次睡眠/);
    if (restart.data.lastSleep.dream) assert.equal(restart.data.lastSleep.dream.imaginary, true);
  }
});
