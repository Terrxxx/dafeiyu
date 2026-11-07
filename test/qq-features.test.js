import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { parseFeeds, parseQzoneJson, Qzone } from '../src/qzone.js';
import { publicUrl, publicAddress } from '../src/browser-search.js';
import { checkQzoneComments } from '../src/qzone-monitor.js';
import { handleQQMessage } from '../src/qq-handler.js';

const fixture = (owner = '1', tid = 'abc_123', comment = 'hello') => ({ data: { data: [{ html: `<div id="feed_${owner}_311_0_100_0_1" data-key="${tid}"><div class="f-info">post</div><input name="feed_data" data-uin="${owner}" data-appid="311" data-tid="${tid}"><li class="comments-item" data-type="commentroot" data-uin="2" data-tid="1"><div class="comments-content">${comment}</div></li></div>` }, null] } });
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-qq-extensions-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const calls = [];
  const qq = { call: async (name, args) => { calls.push({ name, args }); return { message_id: 5 }; } };
  const config = { qq: { enabled: true, adminUsers: ['1'] }, social: { qzoneEnabled: true }, agent: { maxOutgoingPerHour: 10, historyMessages: 20 } };
  const tools = new SocialTools(config, store, qq, {});
  tools.begin('qq:user:1', { kind: 'private', target: '1', sender: '1', session: 'qq:user:1', id: '9', key: 'reply:9' });
  return { store, tools, calls, qq };
}
test('空间数据解析不执行代码，隔离帖子与评论，处理undefined和空记录', () => {
  assert.equal(parseQzoneJson('_Callback({code:0, data:[undefined], text:"undefined"});').text, 'undefined');
  assert.throws(() => parseQzoneJson('_Callback((()=>{throw 1})());'));
  const f = fixture(); f.data.data.push(...fixture('3', 'other').data.data);
  const posts = parseFeeds(f, '1');
  assert.equal(posts.length, 1); assert.equal(posts[0].tid, 'abc_123');
  assert.equal(posts[0].comments[0].userId, '2'); assert.equal(posts[0].comments[0].text, 'hello');
  assert.notEqual(posts[0].comments[0].ref, parseFeeds(fixture('1', 'other'), '1')[0].comments[0].ref);
});
test('空间回复重新核验原评论，丢失/变化不写入，成功只向原楼层提交', async () => {
  const z = new Qzone({}); const post = parseFeeds(fixture(), '1')[0];
  z.auth = async () => ({ id: '1' }); let writes = 0;
  z.posts = async () => ({ posts: [] });
  z.call = async (_endpoint, args) => { writes++; assert.equal(args.commentUin, '2'); assert.equal(args.topicId, '1_abc_123__1'); return { code: 0 }; };
  await assert.rejects(() => z.reply(post, post.comments[0], 'hello')); assert.equal(writes, 0);
  z.posts = async () => ({ posts: [post] });
  assert.equal((await z.reply(post, post.comments[0], 'hello')).accepted, true); assert.equal(writes, 1);
});

test('空间点赞使用重新读取的真实参数，已赞、缺参及动态变化不写入', async () => {
  const z = new Qzone({}); const post = parseFeeds(fixture(), '1')[0]; let writes = 0;
  z.auth = async () => ({ id: '9' });
  z.posts = async () => ({ posts: [post] });
  z.call = async (endpoint, args, auth, isPost) => {
    writes++; assert.ok(endpoint.endsWith('internal_dolike_app')); assert.equal(isPost, true);
    assert.equal(args.opuin, '9'); assert.equal(args.ouin, '1'); assert.equal(args.fid, 'abc_123');
    assert.equal(args.abstime, '100'); assert.equal(args.appid, '311'); assert.equal(args.typeid, '0');
    return { code: 0 };
  };
  assert.equal((await z.like({ ...post, likeData: { abstime: 'fake' } })).accepted, true);
  z.posts = async () => ({ posts: [{ ...post, isLiked: true }] });
  assert.equal((await z.like(post)).alreadyLiked, true);
  z.posts = async () => ({ posts: [{ ...post, likeData: null }] });
  await assert.rejects(() => z.like(post), /点赞参数/);
  z.posts = async () => ({ posts: [{ ...post, text: 'edited' }] });
  await assert.rejects(() => z.like(post), /重新读取/);
  z.posts = async () => ({ posts: [{ ...post, owner: '2' }] });
  await assert.rejects(() => z.like(post), /重新读取/); assert.equal(writes, 1);
});

test('空间顶层评论绑定真实作者和动态，不能伪装楼层回复', async () => {
  const z = new Qzone({}); const post = parseFeeds(fixture(), '1')[0];
  z.auth = async () => ({ id: '9' }); z.posts = async () => ({ posts: [post] });
  z.call = async (endpoint, args, _auth, isPost) => {
    assert.ok(endpoint.endsWith('emotion_cgi_re_feeds')); assert.equal(isPost, true);
    assert.equal(args.hostUin, '1'); assert.equal(args.topicId, '1_abc_123__1');
    assert.equal(args.content, '好耶'); assert.equal(args.commentId, undefined);
    return { code: 0, commentid: '55' };
  };
  assert.equal((await z.comment(post, ' 好耶 ')).commentId, '55');
  await assert.rejects(() => z.comment(post, ' '), /1至300/);
});

test('空间新工具只操作本轮已读动态、持久去重，并遵守睡眠和限目标约束', async t => {
  const { tools, store } = setup(t); let likes = 0; let comments = 0;
  tools.qzone.posts = async owner => ({ owner, posts: parseFeeds(fixture(owner), owner) });
  tools.qzone.like = async () => { likes++; return { accepted: true }; };
  tools.qzone.comment = async () => { comments++; return { accepted: true, commentId: '5' }; };
  await assert.rejects(() => tools.call('qzone_read', { userId: '2' }), /核实用户/);
  await assert.rejects(() => tools.call('qzone_like_post', { postRef: 'invented' }), /先读取/);
  const { posts: [post] } = await tools.call('qzone_read', { userId: '1' });
  const args = { postRef: post.postRef, text: '好耶' };
  for (const guard of ['onlySpaceComment', 'proactiveTarget', 'followupTarget']) {
    tools[guard] = guard === 'followupTarget' ? { id: '1', sentAt: 0 } : '1';
    for (const name of ['qzone_like_post', 'qzone_comment_post']) await assert.rejects(() => tools.call(name, args));
    tools[guard] = null;
  }
  tools.sleep = { assertAwake() { throw new Error('睡觉'); } };
  await assert.rejects(() => tools.call('qzone_like_post', args), /睡觉/); tools.sleep = null;
  tools.config.social.qzoneEnabled = false;
  await assert.rejects(() => tools.call('qzone_comment_post', args), /未启用/); tools.config.social.qzoneEnabled = true;
  for (let i = 0; i < 2; i++) {
    await tools.call('qzone_like_post', args); await tools.call('qzone_comment_post', args);
  }
  assert.equal(likes, 1); assert.equal(comments, 1);
  assert.ok(fs.readFileSync(store.auditFile, 'utf8').includes('qzone_comment_post'));
  tools.begin('new-round');
  await assert.rejects(() => tools.call('qzone_like_post', args), /先读取/);
});

test('空间接口不把失败、缺失和空回执当成功，支持明确ret成功码', async () => {
  for (const response of [{ code: -1 }, {}, { code: null }, { code: '' }, { code: false }]) {
    const z = new Qzone({}, async () => new Response(JSON.stringify(response)));
    await assert.rejects(() => z.call('example', {}, { id: '1', token: '1', cookie: '' }), /错误码/);
  }
  const z = new Qzone({}, async () => new Response('{"ret":0}'));
  assert.equal((await z.call('example', {}, { id: '1', token: '1', cookie: '' })).ret, 0);
});
test('收到的图片按会话隔离，只有自主收藏的表情才可复用', async t => {
  const { tools, calls } = setup(t);
  const image = tools.media.ingest('data:image/png;base64,aGVsbG8=', '测试表情', tools.scope);
  assert.equal((await tools.call('qq_list_images', {})).length, 1);
  assert.throws(() => tools.media.get(image.id, 'qq:user:2'));
  await tools.call('qq_save_sticker', { imageId: image.id });
  assert.equal(calls[0].name, 'add_custom_face'); assert.ok(path.isAbsolute(calls[0].args.file));
  assert.equal(tools.media.get(image.id, 'qq:user:2').savedSticker, true);
  await tools.call('qq_save_sticker', { imageId: image.id }); assert.equal(calls.length, 1);
  tools.begin('autonomous-social');
  tools.avatarIdentity.verify = async candidate => { assert.equal(candidate, 'data:image/png;base64,aGVsbG8='); };
  assert.equal((await tools.call('qq_set_avatar', { imageId: image.id })).changed, true);
  await assert.rejects(() => tools.call('qq_set_avatar', { imageId: image.id }), /24小时/);
  assert.throws(() => tools.media.get('../../secret', tools.scope));
});
test('图片发送引用真实消息并阻止自动文本重复；失败不记录成功历史', async t => {
  const { tools, calls, store, qq } = setup(t);
  const asset = tools.media.ingest('data:image/png;base64,aGVsbG8=', '表情', 'qq:user:1');
  const agent = { config: tools.config, shouldReply: async () => true, run: async () => {
    await tools.call('qq_send_image', { kind: 'private', target: '1', imageId: asset.id, quote: true }); return '';
  } };
  await handleQQMessage({ kind: 'private', target: '1', sender: '1', session: 'qq:user:1', id: '9', text: '发图' }, 'reply:9', { agent, tools, store, qq, throttle: { wait: async () => {} }, log() {} });
  assert.equal(calls.length, 1); assert.equal(calls[0].args.message[0].type, 'reply'); assert.equal(calls[0].args.message[1].type, 'image');
  assert.equal(store.context('qq:user:1').at(-1).content, '[图片 '+asset.id+']');
  tools.begin('qq:user:1', { kind: 'private', target: '1', sender: '1', key: 'fail', id: '10' });
  qq.call = async () => { throw new Error('offline'); };
  const before = store.context('qq:user:1').length;
  await assert.rejects(() => tools.call('qq_send_image', { kind: 'private', target: '1', imageId: asset.id }));
  assert.equal(store.context('qq:user:1').length, before); assert.equal(store.data.actions['fail:image:'+asset.id].state, 'uncertain');
});
test('语音发送真实record消息，同样受主动联系限制', async t => {
  const { tools, calls } = setup(t); tools.synthesizeSpeech = async text => { assert.equal(text, '你好'); return Buffer.from('audio'); };
  await tools.call('qq_send_voice', { kind: 'private', target: '1', text: '你好' });
  assert.equal(calls[0].args.message[0].type, 'record'); assert.equal(tools.currentAttempted, true);
  tools.begin('autonomous-social'); tools.targets.add('private:1');
  await assert.rejects(() => tools.call('qq_send_voice', { kind: 'private', target: '1', text: '你好' }), /暂不主动联系/);
});
test('空间自动评论首次建立基线，新增只判断一次，禁止跨楼回复', async t => {
  const { tools, store } = setup(t); let result = { owner: '1', posts: parseFeeds(fixture(), '1') }; let judgments = 0;
  tools.qzone.posts = async () => result;
  const agent = { run: async () => { judgments++; await assert.rejects(() => tools.call('qzone_reply_comment', { commentRef: 'wrong', text: 'x' })); } };
  const deps = { tools, store, agent, log() {} };
  await checkQzoneComments(deps); assert.equal(judgments, 0);
  result = { owner: '1', posts: parseFeeds(fixture('1', 'new'), '1') };
  await checkQzoneComments(deps); await checkQzoneComments(deps);
  assert.equal(judgments, 1);
});
test('搜索读取只允许当轮搜索结果，阻止本机/内网地址', async t => {
  const { tools } = setup(t);
  tools.browser.search = async () => ({ results: [{ url: 'https://example.com/' }] });
  tools.browser.read = async url => ({ url });
  await assert.rejects(() => tools.call('web_read', { url: 'https://example.com/' }));
  await tools.call('web_search', { query: '公开话题' });
  assert.equal((await tools.call('web_read', { url: 'https://example.com/' })).url, 'https://example.com/');
  for (const url of ['file:///etc/passwd', 'http://127.0.0.1/', 'http://[::1]/', 'http://10.1.1.1/', 'http://localhost/']) await assert.rejects(() => publicUrl(url));
  await assert.rejects(() => publicUrl('https://example.com', async () => [{ address: '192.168.1.1' }]));
  assert.equal(publicAddress('8.8.8.8'), true);
});
