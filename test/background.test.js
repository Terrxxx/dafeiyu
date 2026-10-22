import test from 'node:test';
import assert from 'node:assert/strict';
import { messageParts } from '../src/message-parts.js';
import { QQ } from '../src/qq.js';
import { Queue, Store } from '../src/store.js';
import { scheduleRecurring } from '../src/scheduler.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('long replies preserve content and URLs, and blank lines create separate bubbles', () => {
  assert.deepEqual(messageParts('第一句\n\n第二句'), ['第一句', '第二句']);
  const text = '鱼🐟'.repeat(1000);
  const parts = messageParts(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(p => Array.from(p).length <= 240));
  const url = 'https://www.bilibili.com/video/BV1234567890';
  assert.ok(messageParts('鱼'.repeat(230) + url).includes(url));
});

test('QQ sends sequential bubbles and includes mentions/quotes only on the first', async () => {
  const qq = new QQ({}, () => {}); const sent = [];
  qq.call = async (action, params) => { sent.push(params); return { message_id: sent.length }; };
  const result = await qq.send('group', '123', '第一句\n\n第二句', { atUserIds: ['456'], replyTo: '789' });
  assert.equal(result.count, 2);
  assert.equal(sent[0].message[0].type, 'reply');
  assert.equal(sent[0].message[1].type, 'at');
  assert.deepEqual(sent[1].message, [{ type: 'text', data: { text: '第二句' } }]);
});

test('failed partial send stops subsequent bubbles and preserves uncertain action', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-parts-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); const qq = new QQ({}, () => {}); let calls = 0;
  qq.call = async () => { if (++calls === 2) throw new Error('timeout'); return { message_id: 1 }; };
  await assert.rejects(store.once('parts', () => qq.send('private', '123', '一\n\n二\n\n三')), /已确认 1\/3/);
  await store.once('parts', () => qq.send('private', '123', '一\n\n二\n\n三'));
  assert.equal(calls, 2); assert.equal(store.data.actions.parts.state, 'uncertain');
  store.reserve('outgoing', 3, 2);
  assert.throws(() => store.reserve('outgoing', 3, 2));
  assert.equal(store.data.counters.length, 2);
});

test('background work runs without messages, repeats after errors, and stops cleanly', async () => {
  const pending = []; const timers = new Set(); let stopped = false; let calls = 0; let errors = 0;
  scheduleRecurring(async () => { calls++; if (calls === 1) throw new Error('temporary'); }, 600000, {
    queue: new Queue(), timers, stopped: () => stopped, firstMs: 60000,
    onError: () => { errors++; }, setTimer: (fn, ms) => { const timer = { fn, ms }; pending.push(timer); return timer; },
  });
  assert.equal(pending[0].ms, 60000);
  await pending.shift().fn();
  assert.equal(calls, 1); assert.equal(errors, 1); assert.equal(pending[0].ms, 600000);
  await pending.shift().fn();
  assert.equal(calls, 2);
  stopped = true;
  await pending.shift().fn();
  assert.equal(calls, 2); assert.equal(timers.size, 0); assert.equal(pending.length, 0);
});
