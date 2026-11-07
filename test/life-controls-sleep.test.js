import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { Feelings } from '../src/feelings.js';
import { Sleep } from '../src/sleep.js';
import { saveLifeControls, lifeView } from '../src/life-controls.js';
import { installSleepFarewell, considerWakeGreeting } from '../src/sleep-social.js';

function setup(t, iso = '2026-10-27T12:00:00+08:00', random = () => 0.5) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-life-')); t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  let at = Date.parse(iso); const now = () => at;
  const store = new Store(directory); const feelings = new Feelings(store, now); feelings.data.mood.energy = 70;
  const sleep = new Sleep(store, feelings, now, random);
  return { store, feelings, sleep, directory, now, set: value => { at = Date.parse(value); } };
}
test('Web生活设置按变更时刻结算消耗，情绪只应用一次，耗尽锁定不会被管理员补精力解除', t => {
  const f = setup(t); f.set('2026-10-27T12:30:00+08:00');
  let control = saveLifeControls(f.directory, { revision: '', mood: { joy: 90, anticipation: 80 }, rates: { baseDrainPerHour: 10, maxDrainPerHour: 12, recoveryPerHour: 20 } }, f.now());
  f.set('2026-10-27T12:31:00+08:00'); f.sleep.tick();
  assert.ok(Math.abs(f.feelings.data.mood.energy - (70 - 2.5 - 10 / 60)) < 0.0001);
  assert.equal(f.feelings.data.mood.anticipation, 80); f.sleep.tick(); assert.equal(f.feelings.data.mood.anticipation, 80);
  assert.equal(f.sleep.drainRate(), 10);
  control = saveLifeControls(f.directory, { revision: control.revision, mood: { energy: 0 } }, f.now());
  assert.equal(lifeView(f.directory, f.store.data).mood.energy, 0);
  assert.equal(f.sleep.sleeping(), true); const locked = f.sleep.data.minWakeAt;
  f.set('2026-10-27T13:31:00+08:00'); f.sleep.tick(); assert.equal(f.feelings.data.mood.energy, 20);
  saveLifeControls(f.directory, { revision: control.revision, mood: { energy: 100 } }, f.now());
  assert.equal(f.sleep.sleeping(), true); assert.equal(f.sleep.data.minWakeAt, locked); assert.equal(f.feelings.data.mood.energy, 100);
  assert.throws(() => saveLifeControls(f.directory, { revision: '', mood: { joy: 0 } }), /改变/);
});
test('每晚浮动时间持久化，覆盖23:50和00:10边界，睡前10分钟渐少回应', t => {
  for (const random of [() => 0, () => 1]) {
    const f = setup(t, '2026-10-27T23:39:00+08:00', random); const night = f.sleep.day() + 1; const bedtime = f.sleep.bedtime(night);
    const offset = (bedtime - f.sleep.midnight(night)) / 60000; assert.ok(offset >= -10 && offset <= 10);
    assert.equal(offset, random() ? 10 : -10);
    f.set(new Date(bedtime - 5 * 60000).toISOString()); f.sleep.tick(); assert.equal(f.sleep.windDown().active, true);
    if (!random()) assert.equal(f.sleep.responseMode(), 'silent');
    const restart = new Sleep(f.store, f.feelings, f.now, () => 0.9); assert.equal(restart.bedtime(night), bedtime);
    f.set(new Date(bedtime).toISOString()); assert.equal(restart.sleeping(), true); assert.equal(restart.data.startedAt, bedtime);
    f.set(new Date(bedtime + 120000).toISOString()); assert.equal(restart.sleeping(), true);
  }
});
test('睡前仅真实有来有往的会话告别，每晚最多两处、每处一次，不向被动群和新会话广播', async t => {
  const f = setup(t, '2026-10-27T23:51:00+08:00'); const sent = [];
  const tools = { sleep: f.sleep, outgoing() {} }; const qq = { send: async (kind, target) => { assert.equal(f.sleep.data.mode, 'awake'); sent.push(`${kind}:${target}`); return { message_id: sent.length }; } };
  installSleepFarewell({ tools, qq, store: f.store, log() {}, now: f.now });
  for (const target of ['1', '2', '3', '4']) {
    f.sleep.observeIncoming({ kind: 'group', target }); f.sleep.recordOutgoing('group', target, { message_id: `sent:${target}` });
    if (target !== '4') f.sleep.markReply('group', target);
  }
  f.sleep.onWindDown(); await setImmediate(); f.sleep.onWindDown(); await setImmediate();
  assert.equal(sent.length, 2); assert.ok(!sent.includes('group:4'));
  f.set('2026-10-27T23:59:00+08:00');
  for (const target of ['1', '2', '3', '4']) { f.sleep.observeIncoming({ kind: 'group', target }); f.sleep.recordOutgoing('group', target, { message_id: `later:${target}` }); if (target !== '4') f.sleep.markReply('group', target); }
  f.set('2026-10-28T00:00:00+08:00'); assert.equal(f.sleep.sleeping(), true); await setImmediate(); assert.equal(sent.length, 2);
});
test('起床记录按已醒时长描述，过时自称刚醒和主动早安在发送端被阻止', t => {
  const f = setup(t); f.sleep.data.lastSleep = { wokeAt: f.now() - 3 * 3600000, startedAt: f.now() - 10 * 3600000 };
  assert.match(f.sleep.prompt(), /已醒180分钟/);
  assert.throws(() => f.sleep.assertTemporalReply('我刚起床呢'), /超过15分钟/);
  assert.doesNotThrow(() => f.sleep.assertTemporalReply('你刚起床吗'));
  assert.throws(() => f.sleep.assertTemporalReply('早上好', true), /问候窗口/);
});
test('起床自动问候超过30分钟不调用模型，非早晨不发早安，超过15分钟不发刚醒', async t => {
  for (const [time, age, answer, callsExpected] of [['2026-10-27T08:00:00+08:00', 31, '早呀', 0], ['2026-10-27T12:00:00+08:00', 1, '早上好', 1], ['2026-10-27T08:00:00+08:00', 20, '我刚睡醒', 1]]) {
    const f = setup(t, time); let calls = 0; let sends = 0;
    f.sleep.data.lastSleep = { id: 'r', wokeAt: f.now() - age * 60000, durationMinutes: 400, chats: [{ kind: 'private', target: '1', lastOutgoing: f.now() - 8 * 3600000 }] };
    const services = { tools: { sleep: f.sleep }, store: f.store, now: f.now, log() {}, qq: { send() { sends++; } }, agent: { run: async () => { calls++; return JSON.stringify({ send: true, text: answer }); } } };
    await considerWakeGreeting(services); assert.equal(calls, callsExpected); assert.equal(sends, 0);
  }
});

test('耗尽睡眠随机锁到08:00至08:30，跨重启不重抽，旧锁定迁移一次且仍检查恢复精力', () => {
  for (const random of [() => 0, () => 0.5, () => 1]) {
    let at = Date.parse('2026-10-27T12:00:00+08:00');
    const store = { data: {}, save() {} }; const feelings = { data: { mood: { energy: 0 } }, settle() {} };
    const sleep = new Sleep(store, feelings, () => at, random); assert.equal(sleep.sleeping(), true);
    const earliest = Date.parse('2026-10-28T08:00:00+08:00'); const locked = sleep.data.minWakeAt;
    assert.ok(locked >= earliest && locked <= earliest + 30 * 60000);
    assert.equal(locked - earliest, Math.min(30, Math.floor(random() * 31)) * 60000);
    const restart = new Sleep(store, feelings, () => at, () => { throw new Error('must not redraw'); });
    assert.equal(restart.data.minWakeAt, locked);
    restart.chooseWakeDelay = () => { throw new Error('must not redraw wake delay'); }; restart.random = () => 0.5;
    at = locked - 1; assert.equal(restart.sleeping(), true);
    restart.random = () => 0.5; at = locked; assert.equal(restart.sleeping(), false);
  }
  let now = Date.parse('2026-10-28T07:30:00+08:00'); const eight = Date.parse('2026-10-28T08:00:00+08:00');
  const store = { data: { sleep: { version: 2, mode: 'sleep', reason: 'exhausted', minWakeAt: eight, startedAt: now - 3600000, lastTick: now, wakeEnergy: 80, dozeRuleVersion: 2, dozeAtEnergy: 10, dreamChecked: true } }, save() {} };
  const feelings = { data: { mood: { energy: 20 } }, settle() {} };
  const sleep = new Sleep(store, feelings, () => now, () => 0.5); assert.equal(sleep.data.minWakeAt, eight + 15 * 60000);
  const again = new Sleep(store, feelings, () => now, () => 1); assert.equal(again.data.minWakeAt, eight + 15 * 60000);
  now = eight + 15 * 60000; assert.equal(again.sleeping(), true, 'low energy must still keep resting');
});
