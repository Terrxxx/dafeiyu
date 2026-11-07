import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { recordQzoneAction } from '../src/qq-journal.js';

test('QQ足迹记录空间写入及真实状态，凭据与聊天字段不落盘，未知结果不伪装成功', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-qq-journal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const file = path.join(dir, 'qq-activity.jsonl');
  for (const operation of ['publish', 'like', 'comment', 'reply']) {
    await recordQzoneAction(store, operation, { owner: '123', tid: 'abc', text: '公开评论', cookie: 'secret-cookie', chat: 'private-chat' }, async () => {
      const before = fs.readFileSync(file, 'utf8'); assert.ok(before.includes('started'));
      return { accepted: true, tid: 'abc', cookie: 'receipt-secret' };
    });
  }
  await recordQzoneAction(store, 'like', {}, async () => ({ skipped: true, alreadyLiked: true }));
  await assert.rejects(() => recordQzoneAction(store, 'comment', {}, async () => { throw new Error('secret-error'); }));
  await assert.rejects(() => recordQzoneAction(store, 'chat', { text: '聊天' }, async () => ({})), /不支持/);
  const raw = fs.readFileSync(file, 'utf8'); const entries = raw.trim().split('\n').map(JSON.parse);
  assert.equal(entries.filter(x => x.state === 'succeeded').length, 4);
  assert.equal(entries.at(-1).state, 'uncertain'); assert.equal(entries.at(-3).state, 'skipped');
  for (const secret of ['secret-cookie','private-chat','receipt-secret','secret-error']) assert.ok(!raw.includes(secret));
});

test('空间发布、点赞、顶层评论和回复均接入足迹，去重重试不重复记账', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-qq-write-journal-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const tools = new SocialTools({ qq: { enabled: true, adminUsers: ['1'] }, social: { qzoneEnabled: true }, agent: { maxOutgoingPerHour: 100 } }, store, { call: async () => ({ tid: 'published' }) }, {});
  tools.begin('qq:user:1', { sender: '1', kind: 'private', target: '1' });
  const post = { owner: '1', tid: 'abc' }; tools.spacePosts.set('p', post);
  tools.spaceComments.set('c', { post, comment: { commentId: '7' } });
  for (const method of ['like', 'comment', 'reply']) tools.qzone[method] = async () => ({ accepted: true });
  for (const [name, args] of [['qzone_publish', { text: '动态' }], ['qzone_like_post', { postRef: 'p' }], ['qzone_comment_post', { postRef: 'p', text: '评论' }], ['qzone_reply_comment', { commentRef: 'c', text: '回复' }]]) {
    await tools.call(name, args); await tools.call(name, args);
  }
  const entries = fs.readFileSync(path.join(dir, 'qq-activity.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(entries.filter(x => x.state === 'succeeded').map(x => x.operation), ['publish', 'like', 'comment', 'reply']);
  assert.equal(entries.length, 8);
});
