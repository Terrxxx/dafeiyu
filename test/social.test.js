import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Tasks } from '../src/tasks.js';
import { Store } from '../src/store.js';
import { QQ, parseMessage } from '../src/qq.js';
import { imageUrl, downloadImage } from '../src/images.js';
import { SocialTools } from '../src/tools.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { Agent } from '../src/agent.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-social-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return new Store(dir);
}
test('image-only messages reach the handler; untrusted image URLs and oversized bodies are rejected', async () => {
  const msg = parseMessage({ post_type: 'message', message_type: 'private', user_id: 2, self_id: 1, message_id: 4,
    message: [{ type: 'image', data: { file: 'pic', url: 'https://gchat.qpic.cn/a' } }] }, { allowUsers: ['*'] });
  assert.equal(msg.images.length, 1); assert.equal(msg.text, '');
  assert.throws(() => imageUrl('file:///C:/secret'));
  assert.throws(() => imageUrl('https://127.0.0.1/a'));
  assert.throws(() => imageUrl('https://qpic.cn.evil.example/a'));
  assert.equal(imageUrl('https://multimedia.nt.qq.com.cn/download?fileid=test').hostname, 'multimedia.nt.qq.com.cn');
  assert.throws(() => imageUrl('https://multimedia.nt.qq.com.cn.evil.example/a'));
  assert.throws(() => imageUrl('https://unverified.qq.com.cn/a'));
  assert.throws(() => imageUrl('https://user:secret@multimedia.nt.qq.com.cn/a'));
  const response = (chunks, type = 'image/png') => async () => ({ ok: true, headers: new Headers({ 'content-type': type }), body: (async function* () { yield* chunks; })() });
  assert.equal(await downloadImage('https://gchat.qpic.cn/a', response([Buffer.from('abc')])), 'data:image/png;base64,YWJj');
  await assert.rejects(downloadImage('https://gchat.qpic.cn/a', response([Buffer.alloc(8 * 1024 * 1024 + 1)])));
  await assert.rejects(downloadImage('https://gchat.qpic.cn/a', response([], 'text/html')));
});
test('QQ creates real at/reply segments and leaves CQ-looking text literal', async () => {
  const qq = new QQ({}, () => {}); let capture;
  qq.call = async (action, params) => { capture = { action, params }; };
  await qq.send('group', '123', '[CQ:at,qq=all] hi', { atUserIds: ['456'], replyTo: '789' });
  assert.equal(capture.action, 'send_group_msg');
  assert.deepEqual(capture.params.message[0], { type: 'reply', data: { id: '789' } });
  assert.deepEqual(capture.params.message[1], { type: 'at', data: { qq: '456' } });
  assert.equal(capture.params.message.at(-1).type, 'text');
  assert.throws(() => qq.send('group', '123', 'x', { atUserIds: ['all'] }));
});
test('tasks persist, isolate scopes, run once, and do not replay uncertain interrupted work', async t => {
  const store = setup(t); let tasks = new Tasks(store);
  const created = tasks.create('private:1', '找一个有趣视频', 1);
  assert.equal(tasks.list('private:2').length, 0);
  assert.throws(() => tasks.cancel('private:2', created.id));
  assert.throws(() => tasks.create('private:1', '找一个有趣视频', 1));
  assert.throws(() => tasks.create('x', 'task', 0));
  const restart = new Store(path.dirname(store.file)); tasks = new Tasks(restart);
  assert.equal(tasks.list('private:1').length, 1);
  restart.data.tasks[0].due = 0; let ran = 0;
  await tasks.tick(async () => { ran++; }); await tasks.tick(async () => { ran++; });
  assert.equal(ran, 1); assert.equal(restart.data.tasks[0].status, 'done');
  restart.data.tasks[0].status = 'running'; restart.save();
  const recovered = new Store(path.dirname(store.file)); new Tasks(recovered);
  assert.equal(recovered.data.tasks[0].status, 'uncertain');
});
test('reply_current sends once with quote and suppresses automatic final text', async t => {
  const store = setup(t); let sends = 0; let options;
  const config = { agent: { maxOutgoingPerHour: 5 } };
  const qq = { send: async (kind, target, text, opts) => { sends++; options = opts; return { message_id: 8 }; } };
  const tools = new SocialTools(config, store, qq, {});
  const agent = { shouldReply: async () => true, run: async () => {
    await tools.call('qq_reply_current', { text: '接话', mentionSender: true, quote: true });
    await tools.call('qq_reply_current', { text: '重复' });
    return '最终文本不再发送';
  } };
  await handleQQMessage({ kind: 'group', target: '1', sender: '2', id: '3', text: 'hello', session: 'g:1' }, 'key',
    { agent, tools, store, qq, throttle: { wait: async () => {} }, log: () => {} });
  assert.equal(sends, 1); assert.deepEqual(options, { atUserIds: ['2'], replyTo: '3' });
});
test('vision request carries image parts and only returns a valid description', async t => {
  let body;
  const agent = new Agent({ apiKey: 'test', baseUrl: 'https://example.test', model: 'test', agent: { maxModelCallsPerHour: 10 } }, setup(t), {},
    async (url, opts) => { body = JSON.parse(opts.body); return { ok: true, json: async () => ({ choices: [{ message: { content: '红色方块' } }] }) }; });
  assert.equal(await agent.describeImage('data:image/png;base64,YQ=='), '红色方块');
  assert.equal(body.messages[0].content[1].type, 'image_url'); assert.equal(body.tools, undefined);
});
