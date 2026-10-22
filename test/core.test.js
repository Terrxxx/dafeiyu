import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store, Queue } from '../src/store.js';
import { parseMessage, ReplyThrottle } from '../src/qq.js';
import { Bilibili, parseMention, signWbi } from '../src/bilibili.js';
import { Agent } from '../src/agent.js';
import { SocialTools } from '../src/tools.js';
import { handleQQMessage } from '../src/qq-handler.js';

function tempStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return new Store(dir);
}
test('group decision uses context without tools and keeps silent messages in group history', async t => {
  const store = tempStore(t); let body;
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test', agent: { maxModelCallsPerHour: 10, historyMessages: 4 } };
  store.remember('g:1', 'previous', 'reply', 4);
  const agent = new Agent(config, store, {}, async (url, options) => {
    body = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: '{"reply":false}' } }] }) };
  });
  assert.equal(await agent.shouldReply('g:1', 'new message'), false);
  assert.equal(body.tools, undefined);
  assert.ok(body.messages.some(x => x.content === 'previous'));
  assert.equal(store.data.histories['g:1'].at(-1).content, 'new message');
  assert.equal(store.data.histories['g:2'], undefined);
  agent.request = async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"reply":"true"}' } }] }) });
  await assert.rejects(agent.shouldReply('g:1', 'invalid'));
});
test('both group and private messages are subject to AI participation decisions', async t => {
  const store = tempStore(t); let decision = false; let decisions = 0; let replies = 0; let sends = 0; let waits = 0;
  const services = { store, log: () => {},
    agent: { shouldReply: async () => { decisions++; return decision; }, run: async () => { replies++; return 'reply'; } },
    tools: { begin: () => {}, outgoing: () => {} }, qq: { send: async () => { sends++; return {}; } },
    throttle: { wait: async () => { waits++; } } };
  const msg = parseMessage({ post_type: 'message', message_type: 'group', user_id: 2, self_id: 1,
    group_id: 3, message_id: 10, message: [{ type: 'text', data: { text: 'hi' } }] },
  { allowGroups: ['3'], allowUsers: ['*'], requireMentionInGroup: false });
  assert.ok(msg); assert.equal(msg.mentioned, false);
  await handleQQMessage(msg, 'silent', services);
  assert.equal(store.data.actions.silent.state, 'silent');
  assert.equal(replies, 0); assert.equal(sends, 0); assert.equal(waits, 0);
  decision = true;
  await handleQQMessage(msg, 'reply', services);
  assert.equal(replies, 1); assert.equal(sends, 1);
  await handleQQMessage({ ...msg, kind: 'private', session: 'p:2' }, 'private', services);
  assert.equal(decisions, 3); assert.equal(sends, 2);
  decision = false;
  await handleQQMessage({ ...msg, kind: 'private', session: 'p:2' }, 'private-silent', services);
  assert.equal(sends, 2); assert.equal(store.data.actions['private-silent'].state, 'silent');
  services.agent.shouldReply = async () => { throw new Error('decision failed'); };
  await assert.rejects(handleQQMessage(msg, 'failed', services)); assert.equal(sends, 2);
});
test('QQ filters self messages and requires real group mention', () => {
  const config = { allowUsers: ['*'], allowGroups: ['*'], requireMentionInGroup: true };
  const event = { post_type: 'message', message_type: 'group', user_id: 2, self_id: 1, group_id: 3, message_id: 9, message: [{ type: 'text', data: { text: '[CQ:at,qq=1] hello' } }] };
  assert.equal(parseMessage(event, config), null);
  event.message.push({ type: 'at', data: { qq: '1' } });
  assert.equal(parseMessage(event, config).session, 'qq:group:3');
  event.user_id = 1; assert.equal(parseMessage(event, config), null);
  event.user_id = 2; config.allowGroups = ['4']; assert.equal(parseMessage(event, config), null);
});
test('uncertain sends are persisted and never replayed on restart', async t => {
  const store = tempStore(t); let calls = 0;
  await assert.rejects(store.once('send', async () => { calls++; throw new Error('timeout'); }));
  const restarted = new Store(path.dirname(store.file));
  const result = await restarted.once('send', async () => { calls++; });
  assert.equal(calls, 1); assert.equal(result.state, 'uncertain');
});
test('hourly budget persists; conversations remain separate', t => {
  const store = tempStore(t); store.reserve('model', 1);
  assert.throws(() => new Store(path.dirname(store.file)).reserve('model', 1));
  store.remember('user:a', 'secret a', 'answer', 4);
  assert.equal(store.data.histories['user:b'], undefined);
});
test('queue serializes tool scopes and continues after a failure', async () => {
  const queue = new Queue(); const order = [];
  const first = queue.add(async () => { order.push(1); throw new Error('failed'); });
  const second = queue.add(async () => { order.push(2); });
  await assert.rejects(first); await second; assert.deepEqual(order, [1, 2]);
});
test('rapid private messages all get processed after cooldown instead of being dropped', async () => {
  let now = 1000; const waits = []; const replies = [];
  const throttle = new ReplyThrottle(15, () => now, async ms => { waits.push(ms); now += ms; });
  const queue = new Queue();
  const config = { allowUsers: ['*'], allowGroups: [], requireMentionInGroup: true };
  const jobs = [1, 2, 3].map(id => {
    const message = parseMessage({ post_type: 'message', message_type: 'private', user_id: 2, self_id: 1,
      message_id: id, message: [{ type: 'text', data: { text: `message ${id}` } }] }, config);
    assert.ok(message);
    return queue.add(async () => { await throttle.wait(message.session); replies.push(message.id); });
  });
  await Promise.all(jobs);
  assert.deepEqual(replies, ['1', '2', '3']); assert.deepEqual(waits, [15000, 15000]);
  await throttle.wait('another-user'); assert.equal(waits.length, 2);
});
test('zero cooldown allows consecutive replies without sleeping', async () => {
  const throttle = new ReplyThrottle(0, () => 1000, async () => { assert.fail('should not wait'); });
  await throttle.wait('a'); await throttle.wait('a');
});
test('mention parser excludes non-video and preserves nested root', () => {
  const event = { id: 7, user: { mid: 8 }, item: { business_id: 1, id: 99, root_id: 88, uri: 'https://www.bilibili.com/video/BV1xx411c7mD#reply99' } };
  assert.equal(parseMention(event).root, '88');
  event.item.uri = 'https://evil.example/video/BV1xx411c7mD#reply99'; assert.equal(parseMention(event), null);
  event.item.business_id = 17; assert.equal(parseMention(event), null);
});
test('Bili posting preserves CSRF and correct thread; captcha is failure', async () => {
  let captured;
  const bili = new Bilibili('SESSDATA=a; bili_jct=csrf123', async (url, options) => {
    captured = { url, options }; return { ok: true, json: async () => ({ code: 0, data: { rpid_str: '42' } }) };
  });
  assert.deepEqual(await bili.comment(10, 'hello', '88', '99'), { rpid: '42' });
  assert.equal(captured.options.body.get('root'), '88');
  assert.equal(captured.options.body.get('parent'), '99');
  assert.equal(captured.options.body.get('csrf'), 'csrf123');
  bili.request = async () => ({ ok: true, json: async () => ({ code: 0, data: { need_captcha: true } }) });
  await assert.rejects(bili.comment(10, 'hello'));
});
test('thread verification rejects wrong sender before any posting', async () => {
  const bili = new Bilibili(''); bili.api = async () => ({ root: { rpid: 88, oid: 10, mid: 999, root: 0 } });
  await assert.rejects(bili.verifyThread({ parent: '88', root: '88', sender: '2' }, 10));
});
test('WBI signing matches published test vector', () => {
  const query = signWbi({ foo: '114', bar: '514', zab: 1919810 }, '7cd084941338484aae1ad9425b84077c4932caff0ff746eab6f01bf08b70ac45', 1702204169);
  assert.equal(query, 'bar=514&foo=114&wts=1702204169&zab=1919810&w_rid=8f6f2b5b3d485fe1886cec6a0be8c5d4');
});
test('agent executes tool requests then returns final text', async t => {
  const store = tempStore(t); let round = 0; let called = false;
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test', agent: { maxToolRounds: 3, maxModelCallsPerHour: 5, maxOutputTokens: 100, historyMessages: 4 } };
  const tools = { schemas: [{}], call: async (name, args) => { assert.equal(name, 'read'); assert.equal(args.id, 1); called = true; return { title: 'test' }; } };
  const request = async () => ({ ok: true, json: async () => ({ choices: [{ message: round++ === 0 ? { role: 'assistant', content: null, tool_calls: [{ id: 'a', type: 'function', function: { name: 'read', arguments: '{"id":1}' } }] } : { role: 'assistant', content: '完成' } }] }) });
  const agent = new Agent(config, store, tools, request);
  assert.equal(await agent.run('private', 'hello'), '完成'); assert.equal(called, true);
});
test('sharing requires discovered targets or a video read in current round', async t => {
  const store = tempStore(t);
  const tools = new SocialTools({ qq: { enabled: true }, bilibili: { enabled: true }, agent: {} }, store, {}, {});
  await assert.rejects(tools.call('qq_send_message', { kind: 'group', target: '1', text: 'x' }));
  await assert.rejects(tools.call('bili_post_comment', { bvid: 'BV1xx411c7mD', text: 'x' }));
});

test('autonomous agent can browse, discover a group and share through real tool dispatch', async t => {
  const store = tempStore(t); const sent = []; let index = 0;
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test',
    qq: { enabled: true, allowUsers: ['*'], allowGroups: ['*'] },
    bilibili: { enabled: true, maxVideosPerRound: 3 },
    agent: { maxToolRounds: 6, maxModelCallsPerHour: 10, maxOutputTokens: 100, historyMessages: 4, maxOutgoingPerHour: 3, maxBiliCommentsPerHour: 2 } };
  const qq = { call: async name => name === 'get_friend_list' ? [] : [{ group_id: 7, group_name: '游戏群' }],
    send: async (...args) => { sent.push(args); return { message_id: 8 }; } };
  const bili = { popular: async () => [{ bvid: 'BV1xx411c7mD', title: 'Minecraft' }],
    video: async () => ({ bvid: 'BV1xx411c7mD', aid: 10, subtitle: '游戏教程' }) };
  const tools = new SocialTools(config, store, qq, bili); tools.begin('browse');
  const steps = [ ['bili_popular', {}], ['bili_read_video', { bvid: 'BV1xx411c7mD' }], ['qq_list_targets', {}],
    ['qq_send_message', { kind: 'group', target: '7', text: '发现一个游戏教程 https://www.bilibili.com/video/BV1xx411c7mD' }] ];
  const request = async (url, options) => {
    const step = steps[index++];
    if (!step) {
      const body = JSON.parse(options.body);
      assert.ok(body.messages.some(x => x.role === 'tool' && x.content.includes('message_id')));
    }
    return { ok: true, json: async () => ({ choices: [{ message: step
      ? { role: 'assistant', content: null, tool_calls: [{ id: String(index), type: 'function', function: { name: step[0], arguments: JSON.stringify(step[1]) } }] }
      : { role: 'assistant', content: '已向游戏群分享教程。' } }] }) };
  };
  const agent = new Agent(config, store, tools, request);
  assert.equal(await agent.run('browse', '自主浏览'), '已向游戏群分享教程。');
  assert.equal(sent.length, 1); assert.equal(sent[0][1], '7');
  const duplicate = await tools.call(...steps[3]);
  assert.equal(duplicate.skipped, true); assert.equal(sent.length, 1);
});
