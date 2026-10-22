import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { MessageBuffer, mergeMessages } from '../src/message-buffer.js';
import { Bilibili } from '../src/bilibili.js';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';

test('buffer waits for a quiet gap, caps total wait, and isolates conversations', async () => {
  let now = 0; let next = 0; const timers = new Map(); const batches = [];
  const clock = { now: () => now, set: (fn, ms) => { const id = ++next; timers.set(id, { fn, at: now + ms }); return id; }, clear: id => timers.delete(id) };
  const advance = async t => { now = t; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await Promise.resolve(); };
  const buffer = new MessageBuffer(8000, 25000, items => batches.push(items), assert.fail, clock);
  buffer.add({ session: 'a', text: 'one' }); await advance(7000);
  assert.equal(batches.length, 0); buffer.add({ session: 'a', text: 'two' });
  buffer.add({ session: 'b', text: 'other' }); await advance(14000);
  buffer.add({ session: 'a', text: 'three' }); await advance(15000);
  assert.equal(batches.length, 1); assert.equal(batches[0][0].session, 'b');
  await advance(21000); buffer.add({ session: 'a', text: 'four' }); await advance(25000);
  assert.equal(batches[1].length, 4);
  buffer.add({ session: 'c' }); buffer.close(); await advance(40000); assert.equal(batches.length, 2);
});
test('merged messages retain speakers and use the latest message for reply targeting', () => {
  const merged = mergeMessages([{ id: '1', sender: 'a', text: '你好', mentioned: true }, { id: '2', sender: 'b', text: '等一下', images: [] }]);
  assert.equal(merged.id, '2'); assert.equal(merged.mentioned, true); assert.match(merged.text, /a（a）：你好/); assert.match(merged.text, /b（b）：等一下/);
});
test('video reading reports real video identity to history without pretending completion', async () => {
  const bili = new Bilibili(''); const calls = [];
  bili.api = async (endpoint, params, post) => {
    calls.push({ endpoint, params, post });
    if (endpoint.endsWith('/view')) return { aid: 1, cid: 2, title: 'test' };
    if (endpoint.includes('/player/')) return { subtitle: { subtitles: [] } };
  };
  const result = await bili.video('BV1xx411c7mD');
  assert.equal(result.historyRecorded, true);
  assert.deepEqual(calls.at(-1), { endpoint: '/x/v2/history/report', params: { aid: 1, cid: 2, progress: 0, platform: 'android' }, post: true });
  bili.api = async endpoint => { if (endpoint.endsWith('/view')) return { aid: 1, cid: 2 }; throw new Error('offline'); };
  assert.equal((await bili.video('BV1xx411c7mD')).historyRecorded, false);
});
test('Qzone publish requires a receipt and likes only target a read video', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-autonomy-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); let post; let likes = 0;
  const tools = new SocialTools({ qq: { enabled: true }, social: { qzoneEnabled: true, qzoneVisibility: 4 }, bilibili: { enabled: true }, agent: { maxOutgoingPerHour: 10 } }, store,
    { call: async (action, args) => { post = { action, args }; return { tid: 'tid' }; } }, { like: async () => { likes++; return { liked: true }; } });
  assert.equal((await tools.call('qzone_publish', { text: '今天发现一个好玩的视频' })).tid, 'tid');
  assert.equal(post.action, 'send_qzone_msg'); assert.equal(post.args.ugc_right, 4);
  assert.equal((await tools.call('qzone_publish', { text: '今天发现一个好玩的视频' })).skipped, true);
  await assert.rejects(tools.call('bili_like_video', { bvid: 'BV1xx411c7mD' }));
  tools.videos.set('BV1xx411c7mD', {});
  await tools.call('bili_like_video', { bvid: 'BV1xx411c7mD' }); await tools.call('bili_like_video', { bvid: 'BV1xx411c7mD' });
  assert.equal(likes, 1);
});
