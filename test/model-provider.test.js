import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startManager } from '../manager/server.js';
import { modelCompletionUrl, modelRequest, normalizeCustomUrl, publicLookup } from '../src/model-provider.js';
import { DailyBudget, dailyStatus } from '../src/daily-budget.js';
import { Store } from '../src/store.js';

test('custom model requests use the configured endpoint and reject internal and redirected destinations', async () => {
  for (const value of ['http://api.example.com/v1', 'https:api.example.com', 'https://127.1',
    'https://[::ffff:127.0.0.1]', 'https://10.0.0.1', 'https://[fe80::1]', 'https://app.internal',
    'https://user:pass@api.example.com', 'https://api.example.com/v1?key=secret',
    'https://api.example.com/v1#path', 'https://api.example.com\n/v1']) {
    assert.throws(() => normalizeCustomUrl(value), { status: 400 }, value);
  }
  const baseUrl = normalizeCustomUrl('https://api.example.com/v1/chat/completions/');
  assert.equal(baseUrl, 'https://api.example.com/v1');
  for (const [url, endpoint] of [
    ['https://api.example.com/', 'https://api.example.com/v1/chat/completions'],
    ['https://api.example.com/chat/completions/', 'https://api.example.com/chat/completions'],
    ['https://api.example.com/openai/v2', 'https://api.example.com/openai/v2/chat/completions'],
  ]) {
    assert.equal(modelCompletionUrl({ provider: 'custom', baseUrl: url }), endpoint);
  }
  const resolve = addresses => new Promise((resolve, reject) => {
    publicLookup('api.example.com', { all: true },
      (error, rows) => error ? reject(error) : resolve(rows),
      (_, options, receive) => {
        assert.equal(options.all, true);
        receive(null, addresses);
      });
  });
  const publicIp = { address: '8.8.8.8', family: 4 };
  assert.deepEqual(await resolve([publicIp]), [publicIp]);
  await assert.rejects(resolve([publicIp, { address: '192.168.1.42', family: 4 }]), /公网/);
  await assert.rejects(resolve([{ address: '::ffff:169.254.169.254', family: 6 }]), /公网/);
  const config = { provider: 'custom', baseUrl };
  const response = await modelRequest(async (url, options) => {
    assert.equal(url, 'https://api.example.com/v1/chat/completions');
    assert.equal(options.redirect, 'error');
    assert.equal(typeof options.dispatcher.dispatch, 'function');
    assert.deepEqual(JSON.parse(options.body), { model: 'provider-model', messages: [] });
    return Response.json({ choices: [] });
  }, config, baseUrl + '/chat/completions', {
    body: JSON.stringify({ model: 'provider-model', messages: [], thinking: { type: 'disabled' } }),
  });
  assert.equal(response.status, 200);
  assert.throws(() => modelRequest(() => assert.fail(), config, 'https://example.org', {}), /配置不符/);
});

test('manager keeps DeepSeek as default, saves custom settings and never checks its key with DeepSeek', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'dafeiyu-provider-'));
  const runtimeCalls = [], checkedKeys = [];
  const manager = await startManager({
    dataRoot: root, port: 0, origins: [],
    runtime: async (operation, username, options) => {
      runtimeCalls.push({ operation, username, options });
      return operation === 'logs' ? { text: '' } : { phase: 'stopped', port: '6000' };
    },
    request: async (url, options) => {
      const target = new URL(url);
      if (target.hostname === 'api.deepseek.com') {
        checkedKeys.push(options.headers.Authorization);
        return Response.json({ is_available: true, balance_infos: [] });
      }
      assert.equal(target.hostname, '127.0.0.1');
      const data = target.pathname.endsWith('/auth/login') ? { Credential: 'test' } :
        target.pathname.endsWith('CheckLoginStatus') ? { isLogin: true } : { uin: '1234567' };
      return Response.json({ code: 0, data });
    },
  });
  t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }); });
  manager.accounts.db.prepare('INSERT INTO users(username,created,email) VALUES(?,?,?)')
    .run('alice', Date.now(), 'alice@example.com');
  await manager.tenants.create('alice', { qq: '1234567', adminQQ: '7654321', apiKey: 'deepseek-key-first' });
  const configFile = path.join(root, 'alice', 'config.json');
  const config = JSON.parse(readFileSync(configFile, 'utf8'));
  config.limits = { tokenEnabled: true, tokensPerDay: 1, costEnabled: true, cnyPerDay: 1 };
  writeFileSync(configFile, JSON.stringify(config));
  const session = manager.accounts.session('alice');
  const host = 'http://127.0.0.1:' + manager.server.address().port;
  const call = async (route, body, extraHeaders = {}) => {
    const headers = { Cookie: 'dfy_session=' + session.value, ...extraHeaders };
    const options = { headers };
    if (body !== undefined) Object.assign(options, {
      method: 'POST', headers: { ...headers, Origin: host, 'Content-Type': 'application/json',
        'X-CSRF-Token': session.csrf }, body: JSON.stringify(body),
    });
    const reply = await fetch(host + route, options);
    return { status: reply.status, value: await reply.json() };
  };
  const status = () => call('/account/status');
  assert.equal((await status()).value.bot.provider, 'deepseek');
  for (const baseUrl of [undefined, 'https://127.0.0.1/v1']) {
    assert.equal((await call('/account/key', { provider: 'custom', apiKey: 'custom-key-test', baseUrl })).status, 400);
  }
  assert.equal(runtimeCalls.filter(row => row.operation === 'stop').length, 0);
  assert.equal((await call('/account/key', { provider: 'custom', apiKey: 'custom-key-test',
    baseUrl: 'https://api.example.com/v1/chat/completions', model: 'provider/model' })).status, 200);
  const custom = (await status()).value;
  assert.equal(custom.bot.provider, 'custom');
  assert.equal(custom.bot.baseUrl, 'https://api.example.com/v1');
  assert.equal(custom.bot.customModel, 'provider/model');
  assert.doesNotMatch(JSON.stringify(custom), /custom-key-test/);
  const stops = runtimeCalls.filter(row => row.operation === 'stop').length;
  for (const change of [
    { provider: 'deepseek' },
    { provider: 'custom', baseUrl: 'https://other.example.com/v1' },
    { provider: 'custom', baseUrl: 'https://api.example.com:8443/v1' },
  ]) {
    assert.equal((await call('/account/key', { ...change, apiKey: '' })).status, 400);
  }
  assert.equal(runtimeCalls.filter(row => row.operation === 'stop').length, stops);
  assert.equal((await call('/account/key', { provider: 'custom', baseUrl: custom.bot.baseUrl,
    model: 'provider/second', apiKey: '' })).status, 200);
  assert.equal((await status()).value.bot.customModel, 'provider/second');
  assert.equal((await call('/account/key', { model: 'provider/third' })).status, 200);
  assert.equal((await status()).value.bot.customModel, 'provider/third');
  assert.equal(custom.daily.limitsSuspended, true);
  assert.equal(custom.daily.limits.tokenEnabled, false);
  assert.equal(custom.daily.limits.costEnabled, false);
  const panelHeaders = { 'X-Panel-Token': (await call('/api/session')).value.token };
  const settings = await call('/api/config', undefined, panelHeaders);
  assert.equal(settings.value.limitsSuspended, true);
  assert.deepEqual(settings.value.config.limits, config.limits);
  assert.equal((await call('/api/status', undefined, panelHeaders)).value.daily.paused, false);
  assert.equal((await call('/account/credits')).value.supported, false);
  const image = { kind: 'image', enabled: true, source: 'chat', protocol: 'openai', model: 'image-model' };
  const effect = { kind: 'effect', enabled: true, source: 'custom', protocol: 'elevenlabs',
    model: 'sound-model', baseUrl: 'https://audio.example.com', apiKey: 'media-key-test' };
  assert.equal((await call('/account/media-model', image)).status, 200);
  assert.equal((await call('/account/media-model', { ...effect, baseUrl: 'https://127.0.0.1' })).status, 400);
  assert.equal((await call('/account/media-model', effect)).status, 200);
  assert.equal((await call('/account/media-model', { ...effect, baseUrl: 'https://other.example.com', apiKey: '' })).status, 400);
  const withMedia = (await status()).value.bot.mediaModels;
  assert.equal(withMedia.effect.keySet, true);
  assert.doesNotMatch(JSON.stringify(withMedia), /media-key-test|custom-key-test/);
  assert.equal((await call('/account/control', { action: 'start' })).status, 200);
  const env = runtimeCalls.findLast(row => row.operation === 'start').options.env;
  const configured = JSON.parse(env.DAFEIYU_MEDIA_MODELS);
  assert.equal(configured.image.endpoint, 'https://api.example.com/v1/images/generations');
  assert.equal(configured.image.apiKey, 'custom-key-test');
  assert.equal(configured.effect.endpoint, 'https://audio.example.com/v1/sound-generation');
  assert.equal(configured.effect.apiKey, 'media-key-test');
  assert.equal(env.DAFEIYU_MODEL_PROVIDER, 'custom');
  assert.equal(env.DEEPSEEK_MODEL, 'provider/third');
  assert.equal(env.DEEPSEEK_BASE_URL, custom.bot.baseUrl);
  assert.equal(env.DEEPSEEK_API_KEY, 'custom-key-test');
  assert.deepEqual(checkedKeys, ['Bearer deepseek-key-first']);
  assert.equal((await call('/account/key', { provider: 'deepseek', apiKey: 'deepseek-key-last',
    baseUrl: 'https://api.example.com/v1' })).status, 200);
  const restored = (await status()).value;
  assert.equal(restored.bot.baseUrl, undefined);
  assert.equal(restored.daily.limitsSuspended, false);
  assert.deepEqual(restored.daily.limits, config.limits);
  assert.equal((await call('/account/media-model', { kind: 'effect', enabled: false })).status, 200);
  assert.equal((await status()).value.bot.mediaModels.effect.enabled, false);
  assert.equal((await call('/account/control', { action: 'start' })).status, 200);
  const deepseek = runtimeCalls.findLast(row => row.operation === 'start').options.env;
  assert.equal(JSON.parse(deepseek.DAFEIYU_MEDIA_MODELS).effect, undefined);
  assert.equal(deepseek.DEEPSEEK_BASE_URL, 'https://api.deepseek.com');
  assert.equal(deepseek.DEEPSEEK_MODEL, 'deepseek-flash');
  assert.ok(checkedKeys.every(key => !key.includes('custom-key-test')));
});

test('custom daily limits are suspended even over budget and when usage is unavailable', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'dafeiyu-provider-budget-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir);
  const limits = { tokenEnabled: true, tokensPerDay: 10, costEnabled: true, cnyPerDay: 1 };
  const config = { provider: 'custom', model: 'custom-model', limits };
  const at = Date.parse('2026-11-15T12:00:00Z');
  const budget = new DailyBudget(config, store, () => at);
  budget.record({ prompt_tokens: 15, completion_tokens: 5, total_tokens: 20 }, at, budget.begin());
  budget.record(undefined, at, budget.begin());
  assert.equal(budget.status().tokens, 20);
  assert.equal(budget.status().missingUsage, true);
  assert.equal(budget.status().paused, false);
  assert.doesNotThrow(() => budget.assert());
  const restored = dailyStatus(dir, { provider: 'deepseek', model: 'deepseek-flash', limits }, at);
  assert.deepEqual(restored.reasons, ['每日token上限']);
  assert.equal(restored.limits.costEnabled, true);
});
