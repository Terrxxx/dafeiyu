import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Store } from '../src/store.js';
import { QQ } from '../src/qq.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-state-save-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); store.data.meta.marker = 'old'; store.save();
  return { dir, file: store.file };
}
test('Windows短暂EPERM/EACCES/EBUSY重试后保存成功，重试期间旧状态仍完整', t => {
  const { dir, file } = setup(t); const waits = []; const names = new Set(); let count = 0;
  const io = { ...fs, renameSync(from, to) {
    names.add(from);
    if (count < 3) {
      assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).meta.marker, 'old');
      throw Object.assign(new Error('sharing violation'), { code: ['EPERM', 'EACCES', 'EBUSY'][count++] });
    }
    count++; return fs.renameSync(from, to);
  } };
  const store = new Store(dir, { io, wait: ms => waits.push(ms) }); store.data.meta.marker = 'new'; store.save();
  assert.equal(count, 4); assert.deepEqual(waits, [15, 30, 60]); assert.equal(names.size, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).meta.marker, 'new');
  assert.ok(!fs.existsSync([...names][0]));
});
test('持续占用保留旧状态和最新恢复副本，保存失败时不发送，恢复后清理副本', async t => {
  const { dir, file } = setup(t); let blocked = true; let sent = 0; let renames = 0;
  const io = { ...fs, renameSync(from, to) { renames++; if (blocked) throw Object.assign(new Error('locked'), { code: 'EPERM' }); return fs.renameSync(from, to); } };
  const store = new Store(dir, { io, wait() {}, attempts: 3 }); store.data.meta.marker = 'new';
  assert.throws(() => store.save(), error => error.code === 'EPERM' && /恢复副本/.test(error.message));
  const first = store.recoveryFile; assert.ok(fs.existsSync(first)); assert.equal(renames, 3);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).meta.marker, 'old');
  assert.equal(JSON.parse(fs.readFileSync(first, 'utf8')).meta.marker, 'new');
  await assert.rejects(() => store.once('send:1', async () => { sent++; }), /状态保存失败/);
  assert.equal(sent, 0); assert.ok(!fs.existsSync(first));
  const latest = store.recoveryFile; assert.ok(fs.existsSync(latest));
  assert.equal(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 1);
  blocked = false; store.save();
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).actions['send:1'].state, 'pending');
  assert.ok(!fs.existsSync(latest)); assert.equal(store.recoveryFile, null);
});
test('非瞬时写入错误不反复重试，清理不完整临时文件且不覆盖原状态', t => {
  const { dir, file } = setup(t); let writes = 0;
  const io = { ...fs, writeFileSync() { writes++; throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
  const store = new Store(dir, { io, wait() { assert.fail('磁盘满不应等待重试'); } });
  assert.throws(() => store.save(), error => error.code === 'ENOSPC');
  assert.equal(writes, 1); assert.equal(fs.readdirSync(dir).filter(name => name.endsWith('.tmp')).length, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).meta.marker, 'old');
});
test('QQ同步和异步回调错误被捕获，后续消息仍能处理而不是event_target崩溃', async t => {
  class FakeWebSocket extends EventTarget { close() {} }
  const logs = []; let calls = 0;
  const qq = new QQ({ wsUrl: 'ws://127.0.0.1:3001' }, () => {
    calls++;
    if (calls === 1) throw new Error('同步状态保存失败');
    if (calls === 2) return Promise.reject(new Error('异步处理失败'));
  }, message => logs.push(message), () => new FakeWebSocket());
  qq.connect();
  for (let i = 0; i < 3; i++) qq.socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ post_type: 'message', message_id: i }) }));
  await setImmediate(); qq.close();
  assert.equal(calls, 3); assert.equal(logs.length, 2);
  assert.match(logs[0], /同步状态保存失败/); assert.match(logs[1], /异步处理失败/);
});
