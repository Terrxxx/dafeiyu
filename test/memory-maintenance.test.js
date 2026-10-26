import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Store } from '../src/store.js';
import { compactMemories, archiveMemory, memoryDay } from '../src/memory-maintenance.js';

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-memory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); store.data.sleep = { needsCompaction: true };
  return { store, directory };
}
test('睡眠整理能覆盖已超过上下文上限的当天原文，按会话隔离并可无损解压', t => {
  const { store, directory } = setup(t);
  for (let i = 0; i < 100; i++) store.appendHistory('qq:user:1', 'user', `今天聊的具体事情${i}`, 16);
  store.appendHistory('qq:user:2', 'user', '另一个人的秘密话题');
  assert.equal(store.data.histories['qq:user:1'].length, 16);
  compactMemories(store);
  assert.equal(store.data.histories['qq:user:1'].length, 12);
  assert.equal(store.data.sleepSummaries['qq:user:1'][0].count, 100);
  const raw = gunzipSync(fs.readFileSync(path.join(directory, `memory/${memoryDay(Date.now())}.jsonl.gz`))).toString();
  assert.equal(raw.trim().split('\n').length, 101);
  assert.ok(raw.includes('今天聊的具体事情0')); assert.ok(raw.includes('今天聊的具体事情99'));
  const context = JSON.stringify(store.context('qq:user:1'));
  assert.ok(!context.includes('另一个人的秘密话题'));
  assert.ok(context.includes('原话')); assert.ok(!store.data.sleep.needsCompaction);
  assert.ok(store.context('qq:user:1', 64, 1000).reduce((n, x) => n + x.content.length, 0) <= 1000);
  const restored = new Store(directory);
  assert.ok(JSON.stringify(restored.context('qq:user:1')).includes('今天聊的具体事情99'));
});
test('旧版已有记忆迁移去重，长期记忆仍按用户与scope保留，保存压缩状态快照', t => {
  const { store, directory } = setup(t);
  store.data.histories.old = [{ role: 'user', content: '以前确认过的事', time: '2026-10-25T10:00:00.000Z' }];
  store.data.feelings = { users: { '1': { memories: [
    { scope: 'qq:user:1', kind: 'preference', quote: '喜欢橙子' },
    { scope: 'qq:user:1', kind: 'preference', quote: '喜欢橙子' },
    { scope: 'qq:group:3', kind: 'preference', quote: '喜欢橙子' },
  ] } } };
  const now = Date.parse('2026-10-26T01:00:00+08:00');
  compactMemories(store, now); compactMemories(store, now);
  assert.equal(store.data.sleepSummaries.old[0].count, 1);
  assert.equal(store.data.feelings.users['1'].memories.length, 2);
  assert.ok(!fs.existsSync(path.join(directory, 'memory/2026-10-25.jsonl')));
  assert.ok(fs.existsSync(path.join(directory, 'memory/2026-10-25.jsonl.gz')));
  const snapshot = JSON.parse(gunzipSync(fs.readFileSync(path.join(directory, 'memory/state-2026-10-26.json.gz'))));
  assert.ok(snapshot.feelings.users['1']);
});
test('同一天再次睡眠增量整理，不重复摘要，损坏日志保持原文不清理', t => {
  const { store, directory } = setup(t);
  const time = '2026-10-26T05:00:00.000Z';
  archiveMemory(store, 'scope', { id: '1', role: 'user', content: '第一件事', time });
  const now = Date.parse(time); compactMemories(store, now);
  archiveMemory(store, 'scope', { id: '2', role: 'user', content: '第二件事', time });
  compactMemories(store, now);
  assert.equal(store.data.sleepSummaries.scope.length, 1);
  assert.equal(store.data.sleepSummaries.scope[0].count, 2);
  const file = path.join(directory, 'memory/2026-10-26.jsonl');
  fs.appendFileSync(file, 'broken journal');
  assert.throws(() => compactMemories(store, now));
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('broken journal'));
});
