import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { Feelings } from '../src/feelings.js';
import { moodBase, relationBase } from '../src/emotion-state.js';
import { LocalWeather, normalizeWeather } from '../src/weather.js';
import { Agent } from '../src/agent.js';
import { HarnessAgent } from '../src/harness-agent.js';
import { SocialTools } from '../src/tools.js';

function setup(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-weather-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new Store(directory);
}
const current = now => ({ time: Math.floor(now / 1000), temperature_2m: 26, apparent_temperature: 28, relative_humidity_2m: 70, precipitation: 0, weather_code: 0, wind_speed_10m: 5, is_day: 1 });
const geo = { results: [{ name: '深圳', country_code: 'CN', latitude: 22.54554, longitude: 114.0683, admin1: '广东' }] };
test('旧情绪数据补齐且不重置精力；新增情绪按本人证据变动、去重、持久化和隐私隔离', t => {
  const store = setup(t); store.data.feelings = { mood: { energy: 17, joy: 49, sadness: 10, irritation: 5, curiosity: 50 }, updatedAt: Date.now(), events: [], users: {} };
  const feelings = new Feelings(store); assert.equal(feelings.data.mood.energy, 17);
  assert.equal(feelings.data.mood.calm, moodBase.calm);
  const msg = { sender: '123', text: '没关系我支持你', session: 'qq:user:123' };
  const result = { users: [{ id: '123', reaction: 'supportive', evidence: '我支持你' }, { id: '456', reaction: 'hurtful', evidence: '我支持你' }] };
  feelings.applyChat(msg, result, 'support');
  assert.equal(feelings.user('123').emotions.gratitude, 3);
  assert.equal(feelings.data.users['456'], undefined);
  feelings.applyChat(msg, result, 'support'); assert.equal(feelings.user('123').emotions.gratitude, 3);
  assert.ok(feelings.data.mood.tenderness > moodBase.tenderness);
  assert.equal(feelings.snapshot('qq:user:456').users.length, 0);
  assert.equal(new Feelings(new Store(path.dirname(store.file))).user('123').emotions.gratitude, 3);
  for (let i = 0; i < 40; i++) feelings.applyChat(msg, result, `support:${i}`);
  assert.ok(Object.values(feelings.user('123').emotions).every(n => n >= 0 && n <= 100));
  assert.deepEqual(Object.keys(feelings.user('123').emotions), Object.keys(relationBase));
});
test('天气定时缓存、并发合并、跨重启恢复；天气不改变精力或他人关系', async t => {
  const store = setup(t); let now = Date.now(); let requests = 0;
  const feelings = new Feelings(store, () => now);
  const request = async url => { requests++; return Response.json(String(url).includes('geocoding-api') ? geo : { current: current(now) }); };
  const weather = new LocalWeather({}, store, feelings, request, () => now);
  const energy = feelings.data.mood.energy;
  await Promise.all([weather.refresh(), weather.refresh()]); assert.equal(requests, 2);
  assert.equal(weather.snapshot().city, '深圳'); assert.equal(weather.snapshot().temperature, 26);
  await weather.refresh(); assert.equal(requests, 2);
  const recovered = new LocalWeather({}, new Store(path.dirname(store.file)), feelings, request, () => now);
  assert.equal(recovered.snapshot().available, true); await recovered.refresh(); assert.equal(requests, 2);
  now += 31 * 60000; await weather.refresh(); assert.equal(requests, 3);
  assert.equal(feelings.data.mood.energy, energy); assert.deepEqual(feelings.data.users, {});
  now += 3 * 3600000; assert.equal(weather.snapshot().available, false); assert.match(weather.prompt(), /没有有效/);
  assert.throws(() => normalizeWeather({ refreshMinutes: 1 }));
  assert.throws(() => normalizeWeather({ city: '' }));
});
test('天气睡眠前后拦截，失败不伪造新天气、不连续重试，重名城市不猜', async t => {
  const store = setup(t); let calls = 0; let sleeping = true;
  const weather = new LocalWeather({}, store, new Feelings(store), async () => { calls++; sleeping = true; return Response.json(geo); });
  weather.assertAwake = () => { if (sleeping) throw new Error('睡觉'); };
  await assert.rejects(weather.refresh(), /睡觉/); assert.equal(calls, 0);
  sleeping = false; await assert.rejects(weather.refresh(), /睡觉/); assert.equal(calls, 1); assert.equal(store.data.weather, undefined);
  const failed = new LocalWeather({}, store, new Feelings(store), async () => { calls++; return new Response('error', { status: 503 }); });
  await assert.rejects(failed.refresh(), /503/); const count = calls; await failed.refresh(); assert.equal(calls, count);
  const ambiguous = new LocalWeather({}, store, new Feelings(store), async () => Response.json({ results: [...geo.results, ...geo.results] }));
  await assert.rejects(ambiguous.refresh(), /重名/); assert.equal(store.data.weather, undefined);
});
test('天气缺失或过期返回不落盘；配置关闭后不注入旧天气；两种模型入口都有天气判断语境', async t => {
  const store = setup(t); const feelings = new Feelings(store); const now = Date.now();
  for (const data of [{}, { current: { ...current(now), time: 0 } }, { current: { ...current(now), relative_humidity_2m: null } }]) {
    const weather = new LocalWeather({}, store, feelings, async url => Response.json(String(url).includes('geocoding-api') ? geo : data));
    await assert.rejects(weather.refresh(), /缺失、过期或无效/); assert.equal(store.data.weather, undefined);
  }
  const weather = new LocalWeather({}, store, feelings, async url => Response.json(String(url).includes('geocoding-api') ? geo : { current: current(now) }));
  await weather.refresh();
  for (const AgentClass of [Agent, HarnessAgent]) {
    const agent = new AgentClass({ social: {}, agent: {} }, store, { weather }, {});
    assert.match(agent.timeContext('qq:user:123'), /深圳/);
    assert.match(agent.timeContext('qq:user:123'), /不代表对话用户所在地/);
  }
  const disabled = new LocalWeather({ enabled: false }, store, feelings, () => { throw new Error('must not fetch'); });
  assert.equal(disabled.prompt(), ''); assert.deepEqual(await disabled.refresh(), { enabled: false });
  const tools = new SocialTools({ social: {}, weather: {}, agent: {} }, store, {}, {});
  tools.sleep = { assertAwake() { throw new Error('睡觉'); } }; tools.weather.request = () => { throw new Error('must not fetch'); };
  await assert.rejects(tools.call('local_weather', {}), /睡觉/);
});
