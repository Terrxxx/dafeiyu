import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Bilibili } from '../src/bilibili.js';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { installBiliJournal } from '../src/bili-journal.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-bili-actions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, store: new Store(dir) };
}
test('关注UP主先核验关系，已关注不重发，不改黑名单、不关注自己', async () => {
  const bili = new Bilibili(''); const writes = []; let attribute = 0;
  bili.ownId = async () => '1';
  bili.api = async (url, args, post) => { if (post) { writes.push({ url, args }); return {}; } return { attribute }; };
  assert.equal((await bili.follow('2')).followed, true);
  assert.deepEqual(writes, [{ url: '/x/relation/modify', args: { fid: '2', act: 1, re_src: 14 } }]);
  for (attribute of [1, 2, 6]) assert.equal((await bili.follow('2')).alreadyFollowed, true);
  attribute = 128; await assert.rejects(() => bili.follow('2'), /关系/);
  await assert.rejects(() => bili.follow('1'), /自己/);
  await assert.rejects(() => bili.follow('invalid'), /UID/);
  assert.equal(writes.length, 1);
});
test('关注工具只用实际视频作者UID，跨视频按作者去重，纳入B站日志', async t => {
  const { store, dir } = fixture(t); const followed = [];
  const bili = { follow: async uid => { followed.push(uid); return { followed: true, uid }; } };
  installBiliJournal(bili, store);
  const tools = new SocialTools({ bilibili: { enabled: true } }, store, {}, bili);
  tools.begin('autonomous-browse');
  await assert.rejects(() => tools.call('bili_follow_up', { bvid: 'BV1234567890' }), /先读取/);
  tools.videos.set('BV1234567890', { authorId: '2' });
  tools.videos.set('BV1234567891', { authorId: '2' });
  await tools.call('bili_follow_up', { bvid: 'BV1234567890' });
  await tools.call('bili_follow_up', { bvid: 'BV1234567891' });
  assert.deepEqual(followed, ['2']);
  const rows = fs.readFileSync(path.join(dir, 'bilibili-activity.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows[0].operation, 'follow'); assert.equal(rows[0].input.uid, '2');
  assert.equal(rows[1].state, 'succeeded'); assert.equal(rows[1].receipt.uid, '2');
  tools.proactiveTarget = '3';
  await assert.rejects(() => tools.call('bili_follow_up', { bvid: 'BV1234567890' }), /只可联系/);
});
test('收藏核验本人收藏夹，提交视频aid且不删除其他收藏', async () => {
  const bili = new Bilibili(''); const writes = [];
  bili.ownFolders = async () => ({ items: [{ id: '10' }] });
  bili.api = async (url, args, post) => { if (post) writes.push({ url, args }); else return { aid: 42 }; return {}; };
  await assert.rejects(() => bili.favorite('BV1234567890', '99'), /本人|自己/);
  assert.equal(writes.length, 0);
  const result = await bili.favorite('BV1234567890', '10');
  assert.equal(result.favorited, true);
  assert.deepEqual(writes[0], { url: '/x/v3/fav/resource/deal', args: { rid: 42, type: 2, add_media_ids: '10', del_media_ids: '' } });
});
test('动态JSON发布携带CSRF和正文，保留大整数回执，无有效回执不报成功', async () => {
  const requests = [];
  const bili = new Bilibili('SESSDATA=secret;bili_jct=csrf-token;buvid3=device', async (url, options) => {
    requests.push({ url, options }); return { ok: true, json: async () => ({ code: 0, data: { dyn_id_str: '1234567890123456789' } }) };
  });
  const result = await bili.publishDynamic('今天看到个好玩的');
  assert.equal(result.dynamicId, '1234567890123456789');
  assert.match(requests[0].url, /create\/dyn\?csrf=csrf-token$/);
  assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(requests[0].options.body).dyn_req.content.contents[0].raw_text, '今天看到个好玩的');
  bili.api = async () => ({ dyn_id: 1234567890123456789 });
  await assert.rejects(() => bili.publishDynamic('无可靠回执'), /不确定/);
});
test('B站查询和互动记录跨重启留存正文及回执，观看不记录，网络超时留不确定', async t => {
  const { dir, store } = fixture(t);
  const bili = { popular: async () => [1, 2], video: async () => ({ bvid: 'BV1234567890' }),
    comment: async () => ({ rpid: '123' }), publishDynamic: async () => { throw new Error('timeout'); } };
  installBiliJournal(bili, store); installBiliJournal(bili, store);
  await bili.video('BV1234567890'); assert.ok(!fs.existsSync(path.join(dir, 'bilibili-activity.jsonl')));
  await bili.popular(); await bili.comment(42, '这段好玩', '0', '0');
  await assert.rejects(() => bili.publishDynamic('完整动态正文'));
  const rows = fs.readFileSync(path.join(dir, 'bilibili-activity.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(rows.length, 6);
  assert.equal(rows[2].input.text, '这段好玩'); assert.equal(rows[3].receipt.rpid, '123');
  assert.equal(rows[4].input.text, '完整动态正文'); assert.equal(rows[5].state, 'uncertain');
  assert.equal(fs.readFileSync(path.join(path.dirname(new Store(dir).file), 'bilibili-activity.jsonl'), 'utf8').trim().split('\n').length, 6);
});
test('收藏和动态工具走去重和范围限制，睡眠时不可互动', async t => {
  const { store } = fixture(t); let favorites = 0; let dynamics = 0;
  const config = { qq: { enabled: true }, bilibili: { enabled: true }, agent: { maxOutgoingPerHour: 100 } };
  const tools = new SocialTools(config, store, {}, { favorite: async () => { favorites++; return { favorited: true }; }, publishDynamic: async () => { dynamics++; return { dynamicId: '123' }; } });
  tools.begin('autonomous-browse');
  await assert.rejects(() => tools.call('bili_favorite_video', { bvid: 'BV1234567890', folderId: '10' }), /读取/);
  tools.videos.set('BV1234567890', { aid: 42 });
  await tools.call('bili_favorite_video', { bvid: 'BV1234567890', folderId: '10' });
  await tools.call('bili_favorite_video', { bvid: 'BV1234567890', folderId: '10' });
  await tools.call('bili_publish_dynamic', { text: '今天有个新发现' });
  await tools.call('bili_publish_dynamic', { text: '今天有个新发现' });
  assert.equal(favorites, 1); assert.equal(dynamics, 1);
  tools.proactiveTarget = '1';
  await assert.rejects(() => tools.call('bili_publish_dynamic', { text: '错误范围' }), /只可联系/);
  tools.proactiveTarget = null; tools.sleep = { assertAwake() { throw new Error('睡觉'); } };
  await assert.rejects(() => tools.call('bili_favorite_video', { bvid: 'BV1234567890', folderId: '10' }), /睡觉/);
});
