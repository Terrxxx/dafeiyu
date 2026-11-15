import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Store } from '../src/store.js';
import { parseMessage } from '../src/qq.js';
import { conversationPacket } from '../src/context-packet.js';
import { archiveMemory, compactMemories } from '../src/memory-maintenance.js';
import { readUserMemory, recordUserActivity } from '../src/user-memory.js';
import { personMemoryOverview } from '../src/person-memory.js';
import { memoryDateLabel } from '../src/memory-age.js';
import { writeUserControl } from '../src/user-controls.js';

const now = Date.parse('2026-11-10T12:00:00Z');
const group = 'qq:group:78901';
const privateScope = id => `qq:user:${id}`;
const [a, b, c] = ['123456', '234567', '345678'];
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-person-memory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  store.data.feelings = { users: {}, mood: {} };
  store.data.sleep = {};
  const agent = { store, config: {}, tools: {}, feelings: { data: store.data.feelings },
    personality: { data: { conversations: {} } } };
  const record = (id, session, text, receivedAt = now - 86400000) =>
    recordUserActivity(store, { sender: id, session, text, receivedAt, id: String(receivedAt) });
  return { dir, store, agent, record };
}

test('跨聊按当前发言人和话题限量召回，群与私聊各自保留归属', t => {
  const { dir, agent, record } = setup(t);
  record(a, privateScope(a), '向日葵在阳台开花了');
  record(a, privateScope(a), '私藏的草莓冰淇淋已经吃完');
  record(b, privateScope(b), '蓝莓面包在烤箱里');
  record(c, privateScope(c), '蓝莓面包落在书桌上');
  record(a, group, '蓝莓面包还有三片');
  record(b, group, '蓝莓面包已经送给小鱼');
  const sources = [
    { sender: a, text: '向日葵怎么样了' },
    { sender: b, text: '蓝莓面包呢' },
    { sender: c, text: '蓝莓面包呢', addressedElsewhere: true },
  ];
  const batch = { session: group, kind: 'group', sender: a, text: '向日葵和蓝莓面包', sources };
  const packet = conversationPacket(agent, batch, { now });
  assert.equal(packet.stats.crossPeople, 2);
  assert.ok(packet.stats.crossChars <= 720);
  assert.match(packet.text, /阳台开花.*\n.*烤箱/s);
  assert.match(packet.text, /不得复述/);
  assert.doesNotMatch(packet.text, /书桌上|草莓冰淇淋/);
  const priv = conversationPacket(agent, { session: privateScope(a), sender: a, text: '蓝莓面包呢' }, { now });
  assert.match(priv.text, /还有三片/);
  assert.doesNotMatch(priv.text, /送给小鱼|烤箱/);
  const greeting = conversationPacket(agent, { session: group, sender: a, text: '早上好呀' }, { now });
  assert.equal(greeting.stats.crossPeople, 0);
  writeUserControl(dir, a, { forgottenAt: now - 1 });
  const forgotten = conversationPacket(agent, batch, { now });
  assert.doesNotMatch(forgotten.text, /阳台开花/);
});

test('睡眠汇总保留逐条完整内容，旧记录显示模糊日期，重要经历保留到天', t => {
  const { dir, store, record } = setup(t);
  const text = '聊天原文'.repeat(1600) + '\n尾部细节仍在';
  const msg = parseMessage({ post_type: 'message', message_type: 'private',
    user_id: Number(a), self_id: 999999, message_id: 1, message: [{ type: 'text', data: { text } }] }, {});
  assert.equal(msg.text.length, 6000);
  recordUserActivity(store, { ...msg, receivedAt: now - 1 });
  record(a, group, '第一次见面是在漫展', Date.parse('2026-07-10T06:01:02Z'));
  record(a, group, '看了一部动画', Date.parse('2026-07-11T06:01:02Z'));
  record(a, group, '昨天买了草莓', Date.parse('2026-10-31T06:01:02Z'));
  compactMemories(store, now);
  const ledger = readUserMemory(dir, a);
  const overview = personMemoryOverview(ledger, 1, now);
  assert.equal(overview.updatedAt, now);
  assert.deepEqual(overview.records.find(row => row.content === text)?.origins, ['私聊']);
  assert.deepEqual(overview.records.slice(1).map(row => [row.day, row.time]), [
    ['上个月', ''], ['以前', ''], ['2026-07-10', ''],
  ]);
  assert.deepEqual(memoryDateLabel('2026-11-09T06:01:02.120Z', now), { day: '2026-11-09', time: '14:01:02' });
  compactMemories(store, now);
  assert.deepEqual(readUserMemory(dir, a), ledger);
});

test('睡眠归档不会被迟到的同日记录覆盖', t => {
  const { dir, store } = setup(t);
  const time = '2026-11-01T06:01:02.120Z';
  archiveMemory(store, privateScope(a), { time, id: 'old', role: 'user', content: '先前归档' });
  compactMemories(store, now);
  archiveMemory(store, privateScope(a), { time, id: 'new', role: 'user', content: '后来补写' });
  compactMemories(store, now + 60000);
  const file = path.join(dir, 'memory', '2026-11-01.jsonl.gz');
  const rows = gunzipSync(fs.readFileSync(file)).toString().trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(row => row.content), ['先前归档', '后来补写']);
});
