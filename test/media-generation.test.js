import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../src/agent.js';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { generateMedia } from '../src/media-generation.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { mergeMessages } from '../src/message-buffer.js';

const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jFz8AAAAASUVORK5CYII=', 'base64');
const wave = Buffer.alloc(46);
wave.write('RIFF'); wave.writeUInt32LE(38, 4); wave.write('WAVEfmt ', 8);
wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
wave.writeUInt32LE(16000, 24); wave.writeUInt32LE(32000, 28);
wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(2, 40);

const endpoint = 'https://api.example.com/v1';
const profiles = {
  image: { endpoint: endpoint + '/images/generations', protocol: 'openai', model: 'image-model', apiKey: 'shared-test-key' },
  speech: { endpoint: endpoint + '/audio/speech', protocol: 'openai', model: 'speech-model', voice: 'alloy', apiKey: 'shared-test-key' },
  music: { endpoint: endpoint + '/music', protocol: 'elevenlabs', model: 'music_v2', apiKey: 'audio-test-key' },
  effect: { endpoint: endpoint + '/sound-generation', protocol: 'elevenlabs', model: 'sound-model', apiKey: 'audio-test-key' },
};

test('generated asset downloads accept signed HTTPS CDN links with no model credentials', async () => {
  const calls = [];
  const media = await generateMedia('image', profiles.image, '猫', async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return Response.json({ data: [{ url: 'https://cdn.example.com/image?sig=abc' }] });
    return new Response(image);
  });
  assert.equal(media.mime, 'image/png');
  assert.deepEqual(media.bytes, image);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer shared-test-key');
  assert.equal(calls[1].options.headers, undefined);
  assert.equal(calls[1].options.redirect, 'error');
  assert.match(calls[1].url, /\?sig=abc$/);
  await assert.rejects(generateMedia('image', profiles.image, '猫', async () =>
    Response.json({ data: [{ url: 'https://127.0.0.1/internal' }] })), /公网/);
  await assert.rejects(generateMedia('speech', profiles.speech, '你好', async () =>
    new Response('not an audio file')), /WAV 或 MP3/);
});

test('planned QQ generation uses image and native record segments, and only admins can generate on demand', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-media-generation-'));
  const store = new Store(dir);
  const config = {
    mediaModels: { ...profiles, speech: { ...profiles.speech, instructions: '用清亮的普通话和朋友打招呼' } },
    qq: { enabled: true, adminUsers: ['123456'], voiceEnabled: true },
    agent: { historyMessages: 64, maxModelCallsPerHour: 0, maxOutgoingPerHour: 20 }, social: {},
  };
  const sent = [], requests = [], logs = [];
  const qq = { async call(name, args) { sent.push({ name, args }); return { message_id: sent.length }; } };
  const tools = new SocialTools(config, store, qq, {});
  t.after(() => { tools.components.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  tools.mediaLog = line => logs.push(line);
  tools.mediaRequest = async (url, options) => {
    requests.push({ url, headers: options.headers, body: JSON.parse(options.body) });
    if (url === profiles.image.endpoint) return Response.json({ data: [{ b64_json: image.toString('base64') }] });
    return new Response(wave, { headers: { 'Content-Type': 'audio/wav' } });
  };
  const agent = new Agent(config, store, tools);
  const sender = '123456';
  const received = {
    kind: 'private', sender, target: sender, session: 'qq:user:' + sender, receivedAt: Date.now(),
  };
  const env = { agent, store, tools, qq, throttle: { wait: async () => {} }, log() {} };
  const explicitImage = '生成一张画着海边小猫的图片';
  for (const kind of ['image', 'fallback-image', 'music', 'effect', 'speech']) {
    agent.taskJSON = async (instructions, material) => {
      assert.match(material, /当前允许的媒体生成/);
      assert.match(instructions, /单独的 image 字段只填写资料中明确提供的已有图片 ID/);
      if (kind === 'fallback-image') return { image: 'bad1d0', reply: '发给你了' };
      return kind === 'speech' ? { voice: '这是一段语音', reply: '' } : { generate: { kind, prompt: '合成样例' } };
    };
    const incoming = { ...received, text: kind === 'fallback-image' ? explicitImage : '请生成测试媒体', id: kind };
    await handleQQMessage(mergeMessages([incoming]), 'test-' + kind, env);
  }
  assert.deepEqual(sent.map(entry => entry.args.message[0].type), ['image', 'image', 'record', 'record', 'record']);
  assert.ok(sent.every(entry => entry.name === 'send_private_msg'));
  assert.equal(requests[1].body.prompt, explicitImage);
  assert.equal(requests[2].headers['xi-api-key'], 'audio-test-key');
  assert.deepEqual(requests[2].body, { model_id: 'music_v2', prompt: '合成样例', music_length_ms: 12000 });
  assert.deepEqual(requests[3].body, { model_id: 'sound-model', text: '合成样例', duration_seconds: 5 });
  assert.deepEqual(requests[4].body, {
    model: 'speech-model', input: '这是一段语音', voice: 'alloy', response_format: 'wav',
    instructions: '用清亮的普通话和朋友打招呼',
  });
  const other = { ...received, id: 'other', key: 'other', sender: '234567', target: '234567', session: 'qq:user:234567' };
  tools.begin(other.session, other);
  assert.ok(!tools.schemas.some(schema => schema.function.name === 'qq_generate_media'));
  await assert.rejects(tools.call('qq_generate_media', { mediaKind: 'music', prompt: '禁止越权' }), /只有管理员/);
  assert.equal(requests.length, 5);
  assert.match(logs.join('\n'), /语音 · 发出请求 · 模型 speech-model · 音色 alloy/);
  assert.ok(logs.includes('媒体生成 · 语音 · 合成文本：这是一段语音'));
  assert.ok(logs.includes('媒体生成 · 语音 · 风格提示词：用清亮的普通话和朋友打招呼'));
  assert.match(logs.join('\n'), /语音 · 完成 · \d+\.\d+ 秒 · audio\/wav · 46 字节/);
  assert.ok(logs.includes('媒体生成 · 语音 · 向 QQ 提交原生语音'));
  assert.ok(logs.includes('媒体生成 · 语音 · QQ 已确认发送 · 消息 ID 5'));

  config.mediaModels.speech.instructions = '补充\nBearer shared-test-key';
  qq.call = async () => { throw Error('OneBot 动作失败 (1200)'); };
  await assert.rejects(handleQQMessage({ ...received, text: '再说一遍', id: 'voice-send-error' }, 'voice-send-error', env), /OneBot/);
  assert.ok(logs.includes('媒体生成 · 语音 · QQ 未确认发送 · OneBot 动作失败 (1200)'));
  assert.match(logs.join('\n'), /风格提示词：补充 Bearer \[已隐藏\]/);
  assert.doesNotMatch(logs.join('\n'), /shared-test-key/);
});

test('private and group illustrations send a confirmed caption before requesting and sending the image', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-qq-illustration-'));
  const store = new Store(dir);
  const config = {
    mediaModels: { image: profiles.image }, qq: { enabled: true, adminUsers: ['123456'] },
    agent: { historyMessages: 64, maxModelCallsPerHour: 0, maxOutgoingPerHour: 20 }, social: {},
  };
  const sent = [], logs = [], events = [];
  let textConfirmed = true;
  const qq = {
    async call(name, args) {
      events.push('image'); sent.push({ name, args }); return { message_id: sent.length };
    },
    async send(kind, target, text, options) {
      events.push('text'); sent.push({ kind, target, text, options });
      return textConfirmed ? { message_id: sent.length } : {};
    },
  };
  const tools = new SocialTools(config, store, qq, {});
  tools.mediaLog = line => logs.push(line);
  t.after(() => { tools.components.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const description = '想象中的蓝色小房间，窗边有鱼缸';
  const reply = '我想象的是蓝色小窝～';
  let prompt;
  tools.mediaRequest = async (_url, options) => {
    events.push('request'); prompt = JSON.parse(options.body).prompt;
    return Response.json({ data: [{ b64_json: image.toString('base64') }] });
  };
  const agent = new Agent(config, store, tools);
  let planned = { reply, illustration: description };
  let modelCalls = 0;
  agent.taskJSON = async protocol => {
    modelCalls++;
    assert.match(protocol, /群聊和私聊都可以自主给当前回复配图/);
    return { ...planned };
  };
  const sender = '789012';
  const message = { kind: 'private', sender, target: sender, session: 'qq:user:' + sender, id: '1', text: '大肥鱼你房间是什么样的呀', receivedAt: Date.now() };
  const group = { ...message, kind: 'group', target: '989001', session: 'qq:group:989001', text: '你房间是什么样的呀', peerCount: 0 };
  const env = { agent, store, tools, qq, throttle: { wait: async () => {} }, log: line => logs.push(line) };
  await handleQQMessage(message, 'room-private', env);
  assert.deepEqual(events.splice(0), ['text', 'request', 'image']);
  assert.equal(sent[0].text, reply);
  assert.deepEqual(sent[1].args.message.map(segment => segment.type), ['image']);
  assert.equal(prompt, description);
  assert.equal(store.data.sentMessages[1].text, reply);
  assert.match(store.data.sentMessages[2].text, /^\[图片 [a-f0-9]{6}\]$/);
  assert.match(logs.join('\n'), /QQ 已确认发送配文 · 消息 ID 1[\s\S]*发出请求 · 模型 image-model/);
  assert.ok(logs.some(line => line.includes(description)));
  assert.match(logs.join('\n'), /完成 · \d+\.\d+ 秒 · 图片 ID [a-f0-9]{6}/);
  assert.match(logs.join('\n'), /QQ 已确认发送 · 图片 ID [a-f0-9]{6} · 消息 ID 2/);

  planned = { engage: true, reply, quote: true };
  await handleQQMessage({ ...group, id: '2' }, 'room-group', env);
  assert.deepEqual(events.splice(0), ['text', 'request', 'image']);
  assert.equal(modelCalls, 2);
  assert.match(prompt, /大肥鱼想象中的小房间/);
  assert.equal(sent[2].options.replyTo, '2');
  assert.equal(sent[3].name, 'send_group_msg');
  assert.equal(sent[3].args.group_id, 989001);
  assert.deepEqual(sent[3].args.message.map(segment => segment.type), ['image']);
  await handleQQMessage({ ...group, id: '2' }, 'room-group', env);
  assert.deepEqual(events.splice(0), []);

  await handleQQMessage({ ...group, id: '3', text: '你房间是什么样的呀，不用配图' }, 'room-text-only', env);
  assert.deepEqual(events.splice(0), ['text']);
  planned = { ...planned, illustration: false };
  await handleQQMessage({ ...group, id: '4' }, 'room-declined', env);
  assert.deepEqual(events.splice(0), ['text']);
  planned = { ...planned, engage: false, illustration: description };
  await handleQQMessage({ ...group, id: '5' }, 'room-not-addressed', env);
  assert.deepEqual(events.splice(0), []);

  planned = { engage: true, reply, illustration: description };
  textConfirmed = false;
  await handleQQMessage({ ...group, id: '6' }, 'room-no-caption-receipt', env);
  assert.deepEqual(events.splice(0), ['text']);
  assert.match(logs.join('\n'), /配图正文未确认/);

  textConfirmed = true;
  planned = { engage: true, replies: [
    { ref: '1', reply }, { ref: '2', reply: '最喜欢天蓝色！', illustration: '一块天蓝色布料' },
  ] };
  const batch = mergeMessages([
    { ...group, id: '7', mentioned: true },
    { ...group, id: '8', mentioned: true, sender: '210987', text: '你喜欢什么颜色？' },
  ]);
  await handleQQMessage(batch, 'room-group-batch', env);
  assert.deepEqual(events.splice(0), ['text', 'text', 'request', 'image']);
  assert.deepEqual(sent.slice(-3, -1).map(entry => entry.options.replyTo), ['7', '8']);
  assert.match(prompt, /大肥鱼想象中的小房间/);

  planned = { reply, illustration: description };
  tools.mediaRequest = async () => { events.push('request'); return new Response('', { status: 503 }); };
  await handleQQMessage({ ...message, id: '9' }, 'room-failure', env);
  assert.deepEqual(events.splice(0), ['text', 'request']);
  assert.match(logs.join('\n'), /媒体生成 · 图片 · 失败.*HTTP 503/);
  assert.match(logs.join('\n'), /QQ 配图未完成，正文已发送/);
});

test('group and private voice modes apply independently to QQ chat', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-group-voice-'));
  const store = new Store(dir);
  const config = {
    mediaModels: { speech: profiles.speech },
    qq: { enabled: true, voiceEnabled: true, adminUsers: [] },
    agent: { historyMessages: 64, maxModelCallsPerHour: 0, maxOutgoingPerHour: 20 },
  };
  const sent = [], speech = [];
  const qq = {
    async send(kind, target, text) { sent.push({ kind, target, text }); return { message_id: sent.length }; },
    async call(action, args) { sent.push({ action, ...args }); return { message_id: sent.length }; },
  };
  const tools = new SocialTools(config, store, qq, {});
  t.after(() => { tools.components.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  tools.mediaRequest = async (_url, options) => {
    speech.push(JSON.parse(options.body).input);
    return new Response(wave, { headers: { 'Content-Type': 'audio/wav' } });
  };
  const agent = new Agent(config, store, tools);
  agent.taskJSON = async () => ({ engage: true, quote: true, reply: '今天好开心。' });
  const message = { kind: 'group', id: '51', sender: '23456', target: '12345', session: 'qq:group:12345',
    mentioned: true, text: '早上好', receivedAt: Date.now() };
  const env = { agent, store, tools, qq, throttle: { wait: async () => {} }, log() {} };
  await handleQQMessage(message, 'default', env);
  assert.equal(sent[0].text, '今天好开心。');
  config.qq.groupVoiceOnly = true;
  await handleQQMessage({ ...message, id: '52' }, 'voice', env);
  assert.equal(sent[1].action, 'send_group_msg');
  assert.equal(sent[1].group_id, 12345);
  assert.deepEqual(sent[1].message.map(segment => segment.type), ['reply', 'record']);
  assert.equal(sent[1].message[0].data.id, '52');
  await handleQQMessage({ ...message, id: '53', kind: 'private', target: message.sender, session: 'qq:user:23456' }, 'private', env);
  assert.equal(sent[2].kind, 'private');
  assert.equal(sent[2].text, '今天好开心。');
  tools.begin('autonomous-social');
  tools.targets.add('group:12345');
  await tools.call('qq_send_message', { kind: 'group', target: '12345', text: '大家早上好！' });
  assert.deepEqual(sent[3].message.map(segment => segment.type), ['record']);
  assert.deepEqual(speech, ['今天好开心。', '大家早上好！']);
  assert.equal(store.data.histories['qq:group:12345'].at(-1).content, '大家早上好！');
  config.qq.groupVoiceOnly = false;
  config.qq.privateVoiceOnly = true;
  await handleQQMessage({ ...message, id: '54', kind: 'private', target: message.sender, session: 'qq:user:23456' }, 'private-voice', env);
  assert.equal(sent[4].action, 'send_private_msg');
  assert.equal(sent[4].user_id, 23456);
  assert.deepEqual(sent[4].message.map(segment => segment.type), ['reply', 'record']);
  assert.equal(speech.at(-1), '今天好开心。');
  assert.equal(store.data.histories['qq:user:23456'].at(-1).content, '今天好开心。');
  await handleQQMessage({ ...message, id: '55' }, 'group-restored', env);
  assert.equal(sent[5].kind, 'group');
  assert.equal(sent[5].text, '今天好开心。');
});
