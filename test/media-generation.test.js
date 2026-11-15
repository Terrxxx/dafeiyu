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
    mediaModels: profiles, qq: { enabled: true, adminUsers: ['123456'], voiceEnabled: true },
    agent: { historyMessages: 64, maxModelCallsPerHour: 0, maxOutgoingPerHour: 20 }, social: {},
  };
  const sent = [], requests = [];
  const qq = { async call(name, args) { sent.push({ name, args }); return { message_id: sent.length }; } };
  const tools = new SocialTools(config, store, qq, {});
  t.after(() => { tools.components.close(); fs.rmSync(dir, { recursive: true, force: true }); });
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
  for (const kind of ['image', 'music', 'effect', 'speech']) {
    agent.taskJSON = async (_instructions, material) => {
      assert.match(material, /当前允许的媒体生成/);
      return kind === 'speech' ? { voice: '这是一段语音', reply: '' } : { generate: { kind, prompt: '合成样例' } };
    };
    await handleQQMessage({ ...received, text: '请生成测试媒体', id: kind }, 'test-' + kind, env);
  }
  assert.deepEqual(sent.map(entry => entry.args.message[0].type), ['image', 'record', 'record', 'record']);
  assert.ok(sent.every(entry => entry.name === 'send_private_msg'));
  assert.equal(requests[1].headers['xi-api-key'], 'audio-test-key');
  assert.deepEqual(requests[1].body, { model_id: 'music_v2', prompt: '合成样例', music_length_ms: 12000 });
  assert.deepEqual(requests[2].body, { model_id: 'sound-model', text: '合成样例', duration_seconds: 5 });
  assert.equal(requests[3].body.response_format, 'wav');
  const other = { ...received, id: 'other', key: 'other', sender: '234567', target: '234567', session: 'qq:user:234567' };
  tools.begin(other.session, other);
  assert.ok(!tools.schemas.some(schema => schema.function.name === 'qq_generate_media'));
  await assert.rejects(tools.call('qq_generate_media', { mediaKind: 'music', prompt: '禁止越权' }), /只有管理员/);
  assert.equal(requests.length, 4);
});
