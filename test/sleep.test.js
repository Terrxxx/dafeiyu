import test from 'node:test';
import assert from 'node:assert/strict';
import { Sleep } from '../src/sleep.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { QQ } from '../src/qq.js';
import { Feelings } from '../src/feelings.js';
import { Agent } from '../src/agent.js';
import { HarnessAgent } from '../src/harness-agent.js';

function fixture(iso, energy = 20, random = () => 0) {
  let time = Date.parse(iso);
  const store = { data: {}, save() {} };
  const feelings = { data: { mood: { energy } }, settle() {} };
  const sleep = new Sleep(store, feelings, () => time, random);
  // Freeze bedtime in energy-only regression cases; jitter is covered separately.
  sleep.bedtime = day => sleep.midnight(day);
  return { sleep, store, feelings, set: iso => { time = Date.parse(iso); } };
}
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.0001, `${actual} != ${expected}`);

test('北京时间零点强制睡，精力80才醒，不存在熬夜工具', () => {
  const f = fixture('2026-10-25T23:59:00+08:00');
  assert.equal(f.sleep.sleeping(), false);
  f.sleep.setWakeEnergy(80);
  f.set('2026-10-26T00:00:00+08:00');
  assert.equal(f.sleep.sleeping(), true);
  assert.equal(f.sleep.data.reason, 'midnight');
  assert.equal(f.sleep.plan, undefined);
  f.set('2026-10-26T05:59:00+08:00'); assert.equal(f.sleep.sleeping(), true);
  f.set('2026-10-26T06:01:00+08:00'); assert.equal(f.sleep.sleeping(), false);
});
test('精力0立刻强制睡，每小时加10，跨重启按时间恢复不重复加', () => {
  const f = fixture('2026-10-26T12:00:00+08:00', 0);
  assert.equal(f.sleep.sleeping(), true);
  assert.equal(f.sleep.data.reason, 'exhausted');
  f.set('2026-10-26T13:00:00+08:00'); f.sleep.tick(); close(f.feelings.data.mood.energy, 10);
  f.sleep.tick(); close(f.feelings.data.mood.energy, 10);
  const restart = new Sleep(f.store, f.feelings, () => Date.parse('2026-10-26T14:00:00+08:00'));
  assert.equal(restart.sleeping(), true); close(f.feelings.data.mood.energy, 20);
});
test('可选择80后继续睡到100，满精力必须醒；零点高精力没有最短睡眠', () => {
  const f = fixture('2026-10-26T12:00:00+08:00', 20);
  f.sleep.setWakeEnergy(100); f.feelings.data.mood.energy = 3;
  assert.equal(f.sleep.sleeping(), true);
  f.set('2026-10-26T19:42:00+08:00'); assert.equal(f.sleep.sleeping(), true); close(f.feelings.data.mood.energy, 80);
  f.set('2026-10-26T21:42:00+08:00'); assert.equal(f.sleep.sleeping(), false); close(f.feelings.data.mood.energy, 100);
  const full = fixture('2026-10-26T00:00:00+08:00', 100);
  assert.equal(full.sleep.sleeping(), false); assert.ok(full.sleep.data.needsCompaction);
});
test('低于25概率随精力下降，25正常，0强制睡，不靠消息唤醒', () => {
  const f = fixture('2026-10-26T12:00:00+08:00', 24, () => 0.3);
  assert.equal(f.sleep.responseMode(), 'normal');
  f.sleep.data.dozeAtEnergy = 0; // Exercise the 5% awake branch below the new sleep threshold.
  f.feelings.data.mood.energy = 6; assert.equal(f.sleep.responseMode(), 'silent');
  f.sleep.random = () => 0.6; assert.equal(f.sleep.responseMode(), 'fog');
  f.feelings.data.mood.energy = 25; assert.equal(f.sleep.responseMode(), 'normal');
  f.feelings.data.mood.energy = 0; assert.equal(f.sleep.responseMode(), 'sleep');
  assert.throws(() => f.sleep.setWakeEnergy(80), /睡觉/);
});
test('精力不再随情绪自动回归65，睡眠事件也不能额外加减精力', () => {
  const store = { data: {}, save() {} }; let now = 0;
  const f = new Feelings(store, () => now); f.data.mood.energy = 5;
  now += 7200000; f.settle(); assert.equal(f.data.mood.energy, 5);
  store.data.sleep = { mode: 'sleep' };
  f.event('event', { energy: 8, joy: 2 }, 'test'); assert.equal(f.data.mood.energy, 5);
});
test('睡眠和低精力静默只记留言，不调用模型、查询、情绪复盘或发送', async () => {
  for (const mode of ['sleep', 'silent']) {
    const store = { data: { actions: {} }, save() {}, appendHistory() {} };
    await handleQQMessage({ session: 'qq:user:1', sender: '1', text: '醒醒' }, 'message:1', {
      tools: { sleep: { sleeping: () => mode === 'sleep', responseMode: () => mode } }, store, agent: {}, qq: {},
    });
    assert.equal(store.data.actions['message:1'].state, mode === 'sleep' ? 'sleeping' : 'low-energy-silent');
  }
});
test('睡眠拦截QQ查询及两种模型入口，不发出任何请求', async () => {
  const f = fixture('2026-10-26T12:00:00+08:00', 0);
  const qq = new QQ({}, () => {}); qq.beforeRequest = () => f.sleep.assertAwake();
  assert.throws(() => qq.call('get_stranger_info', {}), /睡觉/);
  let calls = 0; const tools = { sleep: f.sleep };
  const direct = new Agent({}, { data: {} }, tools, async () => { calls++; });
  const harness = new HarnessAgent({}, { data: {} }, tools, { run: async () => { calls++; } });
  for (const agent of [direct, harness]) {
    await assert.rejects(() => agent.run('x', 'test'), /睡觉/);
    await assert.rejects(() => agent.shouldReply('x', 'test'), /睡觉/);
    await assert.rejects(() => agent.describeImage('test'), /睡觉/);
  }
  assert.equal(calls, 0);
});
test('跨两天离线结算与逐分钟结算一致，零点睡和日间耗尽都能正确切换', () => {
  const start = Date.parse('2026-10-25T16:30:00+08:00');
  const batch = fixture(new Date(start).toISOString(), 15, () => 0.9);
  const steps = fixture(new Date(start).toISOString(), 15, () => 0.9);
  batch.sleep.tick(); steps.sleep.tick();
  for (let i = 1; i <= 48 * 60; i++) {
    steps.set(new Date(start + i * 60000).toISOString()); steps.sleep.tick();
  }
  batch.set(new Date(start + 48 * 3600000).toISOString()); batch.sleep.tick();
  close(batch.feelings.data.mood.energy, steps.feelings.data.mood.energy);
  assert.equal(batch.sleep.data.mode, steps.sleep.data.mode);
});
test('脑雾轮次只生成短句，不开放工具；回复发送仍受实际入口控制', async () => {
  const runs = []; let sends = 0;
  const store = { data: { actions: {} }, save() {}, appendHistory() {}, recordSent() {}, once: async (key, action) => action() };
  const tools = { sleep: { sleeping: () => false, responseMode: () => 'fog' }, begin() {}, outgoing() {}, currentAttempted: false };
  const agent = { shouldReply: async () => true, run: async (...args) => { runs.push(args); return '没跟上，让我缓缓'; } };
  await handleQQMessage({ kind: 'private', session: 'qq:user:1', target: '1', sender: '1', text: '在聊什么', images: [] }, 'fog-message', {
    tools, store, agent, qq: { send: async () => { sends++; return { message_id: 1 }; } }, throttle: { wait: async () => {} }, log() {},
  });
  assert.equal(runs[0][2], false); assert.match(runs[0][1], /fog=true/); assert.equal(sends, 1);
});
