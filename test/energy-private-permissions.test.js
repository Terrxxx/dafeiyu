import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Feelings } from '../src/feelings.js';
import { Sleep } from '../src/sleep.js';
import { SocialTools } from '../src/tools.js';
import { Agent } from '../src/agent.js';
import { HarnessAgent } from '../src/harness-agent.js';
import { effectiveMood, moodBase } from '../src/emotion-state.js';
import { weatherEmotion } from '../src/weather.js';
function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-private-permission-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const sent = [];
  const config = { qq: { enabled: true, adminUsers: ['99'] }, social: {}, agent: { historyMessages: 20, maxOutgoingPerHour: 100, maxToolRounds: 3, maxModelCallsPerHour: 20, maxOutputTokens: 500 }, apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test' };
  const tools = new SocialTools(config, store, { send: async (...args) => { sent.push(args); return { message_id: 1 }; } }, {});
  tools.begin('qq:user:7', { kind: 'private', target: '7', sender: '7', name: '爸', admin: true, session: 'qq:user:7', id: '1', key: 'r:1' });
  return { store, tools, config, sent };
}
test('10%时95%的概率睡眠，极少数周期可到0%，0%无条件锁定；旧阈值迁移', () => {
  let asleep = 0;
  for (let i = 0; i < 100; i++) {
    const store = { data: {}, save() {} }; const feelings = { data: { mood: { energy: 10 } }, settle() {} };
    const sleep = new Sleep(store, feelings, () => Date.parse('2026-10-27T12:00:00+08:00'), () => i / 100);
    if (sleep.sleeping()) asleep++;
    else { feelings.data.mood.energy = 0; assert.equal(sleep.sleeping(), true); assert.equal(sleep.data.reason, 'exhausted'); }
  }
  assert.equal(asleep, 95);
  const store = { data: { sleep: { version: 2, mode: 'awake', lastTick: Date.parse('2026-10-27T12:00:00+08:00'), dozeAtEnergy: 3 } }, save() {} };
  const sleep = new Sleep(store, { data: { mood: { energy: 9 } }, settle() {} }, () => store.data.sleep.lastTick, () => 0.5);
  assert.equal(sleep.data.dozeRuleVersion, 2); assert.equal(sleep.sleeping(), true);
});
test('精力显著调节积极情绪，恢复可逆，不反复扣值、不修改用户关系', t => {
  const { store } = setup(t); const feelings = new Feelings(store); const user = feelings.user('7'); user.affinity = 23;
  feelings.data.mood.energy = 10; const low = feelings.snapshot('qq:user:7').mood;
  feelings.data.mood.energy = 100; const high = feelings.snapshot('qq:user:7').mood;
  assert.ok(low.joy < high.joy / 2); assert.ok(low.inspiration < high.inspiration / 2);
  assert.equal(feelings.data.mood.joy, moodBase.joy); assert.equal(user.affinity, 23);
  feelings.data.mood.energy = 10; assert.deepEqual(feelings.snapshot('qq:user:7').mood, low);
  assert.deepEqual(effectiveMood({ ...moodBase, energy: 10 }), low);
});
test('温度、体感、湿度、风速分别影响情绪，不改精力或关系', () => {
  const normal = { temperature_2m: 23, apparent_temperature: 23, relative_humidity_2m: 55, wind_speed_10m: 12, precipitation: 0, weather_code: 0, is_day: 1 };
  const baseline = weatherEmotion(normal);
  for (const change of [{ temperature_2m: 35 }, { apparent_temperature: 36 }, { relative_humidity_2m: 90 }, { wind_speed_10m: 48 }]) assert.notDeepEqual(weatherEmotion({ ...normal, ...change }), baseline);
  const harsh = weatherEmotion({ ...normal, temperature_2m: 36, apparent_temperature: 42, relative_humidity_2m: 95, wind_speed_10m: 40 });
  assert.ok(harsh.irritation > 0); assert.ok(harsh.worry > 0); assert.equal(harsh.energy, undefined);
  assert.ok(Object.values(harsh).every(value => Math.abs(value) <= 5));
});
test('普通私聊隐藏操作工具且入口拒绝伪造身份、跨目标、任务和MCP，保留当前会话回复', async t => {
  const { tools, sent } = setup(t); const names = tools.schemas.map(s => s.function.name);
  assert.ok(names.includes('qq_reply_current')); assert.ok(!names.includes('qzone_publish'));
  for (const name of ['qq_list_targets', 'qq_set_avatar', 'qzone_publish', 'bili_publish_dynamic', 'bili_like_video', 'qq_save_sticker', 'qq_recall_message', 'task_create', 'task_cancel', 'local_weather', 'web_search', 'mcp__dafeiyu__shopping_home', 'mcp__dafeiyu__desktop_open', 'mcp__dafeiyu__notes_write']) await assert.rejects(tools.call(name, {}), /只有管理员/);
  for (const name of ['qq_send_message', 'qq_send_voice', 'qq_send_image', 'qq_send_sticker']) await assert.rejects(tools.call(name, { kind: 'group', target: '99', text: '发给别人' }), /只有管理员/);
  assert.equal(sent.length, 0);
  await tools.call('qq_reply_current', { text: '嗨' }); assert.equal(sent.length, 1); assert.equal(sent[0][1], '7');
  tools.begin('qq:user:7'); await assert.rejects(tools.call('task_create', {}), /只有管理员/);
  tools.begin('qq:user:99', { kind: 'private', sender: '99', target: '99' });
  assert.ok(tools.schemas.some(s => s.function.name === 'qzone_publish'));
  const image = tools.media.ingest('data:image/png;base64,aGVsbG8=', '本人头像', tools.scope); tools.media.markSticker(image.id);
  let verified = false; const calls = [];
  tools.avatarIdentity.verify = async () => { verified = true; }; tools.qq.call = async name => { calls.push(name); return {}; };
  assert.equal((await tools.call('qq_set_avatar', { imageId: image.id })).changed, true);
  assert.equal(verified, true); assert.deepEqual(calls, ['set_qq_avatar']);
  tools.begin('autonomous-social'); assert.ok(tools.schemas.some(s => s.function.name === 'qzone_publish'));
});
test('普通和Harness模型入口均提供私聊权限约束，群聊与视频感受继续更新情绪', async t => {
  const { tools, store, config } = setup(t);
  for (const AgentClass of [Agent, HarnessAgent]) {
    const agent = new AgentClass(config, store, tools, {}); assert.match(agent.timeContext('qq:user:7'), /不是管理员/);
  }
  const feelings = tools.feelings; const before = feelings.data.mood.joy;
  feelings.applyChat({ kind: 'group', session: 'qq:group:1', sender: '7', text: '这个也太好笑了' }, { users: [{ id: '7', reaction: 'amusing', evidence: '太好笑了' }] }, 'group-chat');
  assert.ok(feelings.data.mood.joy > before);
  const agent = new Agent(config, store, tools); agent.run = async () => '{"feeling":"inspiring"}'; const inspiration = feelings.data.mood.inspiration;
  await agent.experienceVideo({ bvid: 'BVtest', title: '测试视频', evidence: '简介' });
  assert.ok(feelings.data.mood.inspiration > inspiration);
});
