import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Sleep } from '../src/sleep.js';
import { Feelings } from '../src/feelings.js';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { installSleepFarewell, considerWakeGreeting } from '../src/sleep-social.js';

function fixture(t, energy = 100, random = () => 0.9) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-energy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); let time = Date.parse('2026-10-26T12:00:00+08:00');
  const feelings = new Feelings(store, () => time); feelings.data.mood.energy = energy;
  const sleep = new Sleep(store, feelings, () => time, random);
  return { store, feelings, sleep, now: () => time, set: value => { time = Date.parse(value); } };
}
const close = (a, b) => assert.ok(Math.abs(a - b) < 0.0001, `${a} != ${b}`);

test('零聊天每小时5%，频繁聊天最多8%，相同回执不重复计数', t => {
  const quiet = fixture(t); quiet.set('2026-10-26T13:00:00+08:00'); quiet.sleep.tick();
  close(quiet.feelings.data.mood.energy, 95);
  const busy = fixture(t);
  for (let i = 0; i < 100; i++) busy.sleep.recordOutgoing('private', '2', { message_id: i });
  busy.sleep.recordOutgoing('private', '2', { message_id: 99 });
  assert.equal(busy.sleep.data.chatEvents.length, 100);
  assert.equal(busy.sleep.drainRate(), 8);
  busy.set('2026-10-26T13:00:00+08:00'); busy.sleep.tick(); close(busy.feelings.data.mood.energy, 92);
  busy.set('2026-10-26T14:00:00+08:00'); busy.sleep.tick(); close(busy.feelings.data.mood.energy, 87);
});
test('按聊天发生时间分段结算，工具事件不会叠加突破每小时上限', t => {
  const f = fixture(t); f.set('2026-10-26T12:30:00+08:00');
  for (let i = 0; i < 20; i++) f.sleep.noteChat(`message:${i}`);
  for (let i = 0; i < 100; i++) f.feelings.event(`activity:${i}`, { energy: -8, joy: 0.1 }, 'test');
  f.set('2026-10-26T13:00:00+08:00'); f.sleep.tick(); close(f.feelings.data.mood.energy, 93.5);
});
test('10%有极大概率提前睡，0耗尽必须锁到次日8点，即使100也不能提前醒', t => {
  const drowsy = fixture(t, 4, () => 0.6);
  assert.equal(drowsy.sleep.sleeping(), true); assert.equal(drowsy.sleep.data.reason, 'drowsy');
  const awake = fixture(t, 4, () => 0.99); assert.equal(awake.sleep.sleeping(), false);
  awake.feelings.data.mood.energy = 0; assert.equal(awake.sleep.sleeping(), true);
  assert.equal(awake.sleep.data.reason, 'exhausted');
  awake.set('2026-10-26T23:59:00+08:00'); assert.equal(awake.sleep.sleeping(), true); close(awake.feelings.data.mood.energy, 100);
  const restored = new Sleep(new Store(path.dirname(awake.store.file)), awake.feelings, awake.now, () => 0.99);
  awake.set('2026-10-27T07:59:59+08:00'); assert.equal(restored.sleeping(), true);
  awake.set(new Date(restored.data.minWakeAt).toISOString()); assert.equal(restored.sleeping(), false); close(awake.feelings.data.mood.energy, 100);
});
test('活跃聊天睡前先告别，然后进入睡眠；无聊天不打扰，事后不补发告别', async t => {
  const f = fixture(t, 20); const sends = [];
  const qq = { send: async (kind, target, text) => {
    assert.equal(f.sleep.data.mode, 'awake'); sends.push({ kind, target, text }); return { message_id: 2 };
  } };
  const tools = new SocialTools({ agent: { maxOutgoingPerHour: 100 } }, f.store, qq, {}); tools.sleep = f.sleep;
  installSleepFarewell({ tools, store: f.store, qq, log() {}, now: f.now });
  f.sleep.observeIncoming({ kind: 'private', target: '2' });
  f.sleep.recordOutgoing('private', '2', { message_id: 1 });
  f.sleep.markReply('private', '2');
  f.feelings.data.mood.energy = 0;
  assert.equal(f.sleep.sleeping(), true);
  await setImmediate();
  assert.equal(sends.length, 1); assert.match(sends[0].text, /睡/);
  f.sleep.tick(); await setImmediate(); assert.equal(sends.length, 1);
  const quiet = fixture(t, 0); quiet.sleep.onBeforeSleep = info => assert.equal(info.chats.length, 0);
  assert.equal(quiet.sleep.sleeping(), true);
});
test('醒后问候仅一次、只看目标会话，暂停联系或已开始聊天不再问候', async t => {
  const f = fixture(t, 100); f.set('2026-10-27T08:00:00+08:00'); f.sleep.tick();
  const wokeAt = f.now();
  f.sleep.data.lastSleep = { id: 'rest', wokeAt, durationMinutes: 600, chats: [{ kind: 'private', target: '2', lastOutgoing: wokeAt - 36000000 }] };
  const calls = []; const sends = [];
  const qq = { send: async (...args) => { sends.push(args); return { message_id: 5 }; } };
  const tools = new SocialTools({ agent: { maxOutgoingPerHour: 100 } }, f.store, qq, {}); tools.sleep = f.sleep;
  const agent = { config: { agent: { historyMessages: 64 } }, run: async (session, input, useTools) => {
    calls.push(session); assert.equal(useTools, false); assert.match(input, /北京时间/); return '{"send":true,"text":"早呀，睡饱了"}';
  } };
  const services = { tools, store: f.store, qq, agent, now: f.now, log() {} };
  await considerWakeGreeting(services); await considerWakeGreeting(services);
  assert.deepEqual(calls, ['qq:user:2']); assert.equal(sends.length, 1);
  f.sleep.data.lastSleep.id = 'rest2'; tools.feelings.user('2').contactPaused = true;
  await considerWakeGreeting(services); assert.equal(sends.length, 1);
});
