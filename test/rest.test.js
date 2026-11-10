import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Feelings } from '../src/feelings.js';
import { Sleep } from '../src/sleep.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { adminRestCommand } from '../src/qq-rest-command.js';
import { socialCycle } from '../src/social-cycle-v3.js';
import { considerWakeGreeting } from '../src/sleep-social.js';

const minute = 60000;
function fixture(t, energy = 100, random = () => 0.6, iso = '2026-11-10T12:00:00+08:00') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-rest-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  let time = Date.parse(iso);
  const now = () => time;
  const feelings = new Feelings(store, now);
  feelings.data.mood.energy = energy;
  const sleep = new Sleep(store, feelings, now, random);
  return { directory, store, feelings, sleep, now, advance: ms => { time += ms; } };
}

test('低精力可以在原10%阈值前主动睡，低能量分支仍可选正常睡眠', t => {
  const f = fixture(t, 18, () => 0);
  assert.equal(f.sleep.sleeping(), true);
  assert.equal(f.sleep.data.reason, 'drowsy');
  assert.equal(f.sleep.shouldCompact(), true);
  const g = fixture(t, 24);
  assert.equal(g.sleep.sleeping(), false);
  assert.equal(g.sleep.requestRest().reason, 'drowsy');
  assert.equal(g.sleep.sleeping(), true);
});

test('满精力小睡不提前醒、不整理，重启保留原定闹钟', t => {
  const f = fixture(t);
  const due = f.now() + 15 * minute;
  f.sleep.setWakeEnergy(90);
  assert.throws(() => f.sleep.requestRest({ minutes: 4 }), /5至30/);
  assert.throws(() => f.sleep.requestRest({ minutes: 31 }), /5至30/);
  assert.equal(f.sleep.requestRest({ minutes: 15 }).napUntil, due);
  assert.equal(f.sleep.data.nextWakeEnergy, 90);
  assert.equal(f.sleep.shouldCompact(), false);
  assert.throws(() => f.sleep.assertAwake(), /正在睡觉/);
  f.advance(15 * minute - 1);
  const saved = new Store(f.directory);
  const restored = new Sleep(saved, new Feelings(saved, f.now), f.now);
  assert.equal(restored.sleeping(), true);
  assert.equal(restored.shouldCompact(), false);
  f.advance(1);
  assert.equal(restored.sleeping(), false);
  assert.equal(restored.data.lastSleep.wokeAt, due);
  assert.equal(restored.data.lastSleep.reason, 'nap');
  assert.equal(restored.data.lastSleep.endEnergy, 100);
  assert.equal(restored.shouldCompact(), false);
});

test('跨过夜间入睡点的小睡接上夜睡且只由夜睡触发整理', t => {
  const f = fixture(t, 100, () => 0.5, '2026-11-10T23:55:00+08:00');
  f.sleep.requestRest({ minutes: 10 });
  assert.equal(f.sleep.shouldCompact(), false);
  f.advance(5 * minute);
  assert.equal(f.sleep.sleeping(), true);
  assert.equal(f.sleep.data.reason, 'midnight');
  assert.equal(f.sleep.shouldCompact(), true);
  f.advance(5 * minute);
  assert.equal(f.sleep.sleeping(), false);
});

test('小睡恢复精力，30分钟小睡醒后也不自动问早', async t => {
  const f = fixture(t, 81);
  f.sleep.requestRest({ minutes: 30 });
  f.advance(30 * minute);
  assert.equal(f.sleep.sleeping(), false);
  assert.equal(f.feelings.data.mood.energy, 86);
  await considerWakeGreeting({ tools: { sleep: f.sleep }, store: f.store, now: f.now,
    agent: { run() { assert.fail('小睡醒来不应触发模型问候'); } } });
});

test('仅实时管理员私聊的明确指令执行，失败的QQ确认不阻止睡眠', async t => {
  const f = fixture(t, 24);
  const policy = { adminUsers: ['123456'] };
  const msg = { kind: 'private', sender: '123456', target: '123456', session: 'qq:user:123456',
    id: 'one', text: '大肥鱼，你现在去睡觉吧', receivedAt: f.now(), images: [] };
  assert.equal(adminRestCommand({ ...msg, text: '你几点去睡觉？' }, policy), null);
  assert.equal(adminRestCommand({ ...msg, text: '晚安' }, policy), null);
  assert.equal(adminRestCommand({ ...msg, unreadReview: true }, policy), null);
  assert.equal(adminRestCommand({ ...msg, kind: 'group' }, policy), null);
  assert.equal(adminRestCommand(msg, { adminUsers: ['234567'] }), null);
  assert.deepEqual(adminRestCommand({ ...msg, text: '你小睡二十五分钟吧' }, policy), { minutes: 25 });
  assert.deepEqual(adminRestCommand({ ...msg, text: '去睡半小时' }, policy), { minutes: 30 });
  let confirmations = 0;
  await handleQQMessage(msg, 'admin-rest', {
    store: f.store, qq: { policy: () => policy }, log() {},
    agent: { config: { qq: policy, agent: {} }, run() { assert.fail('明确指令不应调用模型'); } },
    tools: { sleep: f.sleep, begin() {}, async call(name, { text }) {
      confirmations++;
      assert.equal(name, 'qq_reply_current');
      assert.equal(text, '我先去睡啦');
      assert.equal(f.sleep.data.mode, 'awake');
      throw Error('本地模拟的发送失败');
    } },
  });
  assert.equal(confirmations, 1);
  assert.equal(f.sleep.sleeping(), true);
  assert.equal(f.sleep.data.reason, 'admin');
  assert.equal(f.sleep.shouldCompact(), true);
});

test('自主计划可用一次决策选择高精力小睡，不执行社交工具', async t => {
  const f = fixture(t);
  const config = { qq: { enabled: false }, social: {}, bilibili: { enabled: false } };
  const tools = { sleep: f.sleep, tasks: {}, begin() {}, schemas: [], components: { allowed: () => false },
    call() { assert.fail('选择小睡时不调用社交工具'); } };
  const agent = { feelings: f.feelings, personality: { data: { interests: [] } },
    async taskJSON(prompt, input) {
      assert.match(prompt, /5至30分钟/);
      assert.equal(input.rest.canSleep, false);
      return { activity: 'nap', minutes: 12 };
    } };
  const result = await socialCycle({ agent, tools, store: f.store, config, log() {} });
  assert.deepEqual(result, { calls: 1, resting: true });
  assert.equal(f.sleep.data.napUntil, f.now() + 12 * minute);
  assert.equal(f.sleep.shouldCompact(), false);
});
