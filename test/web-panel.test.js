import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { startWebPanel } from '../src/web-panel.js';

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-web-')); fs.mkdirSync(path.join(root, 'data'));
  fs.copyFileSync(path.join(ROOT, 'config.example.json'), path.join(root, 'config.json'));
  fs.writeFileSync(path.join(root, 'data/state.json'), JSON.stringify({ feelings: { mood: { energy: 42 }, users: { '123': { name: '测试用户', affinity: 2, trust: 30, memories: [{ scope: 'qq:user:123', quote: '<script>不要执行</script>' }] } } } }));
  const actions = [];
  const server = await startWebPanel({ root, port: 0, controller: {
    status: () => ({ phase: 'stopped' }), logs: () => [{ id: 1, text: '验证日志' }], control: async action => { actions.push(action); return { phase: 'starting' }; },
  } });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(base + '/api/session')).json()).token;
  const get = path => fetch(base + path, { headers: { 'X-Panel-Token': token } });
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'X-Panel-Token': token, Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { root, base, get, post, actions };
}
test('Web面板展示本机状态、日志和记忆，不暴露任意文件路径', async t => {
  const f = await setup(t);
  assert.equal((await (await f.get('/api/status')).json()).mood.energy, 42);
  assert.equal((await (await f.get('/api/logs')).json())[0].text, '验证日志');
  assert.equal((await (await f.get('/api/memories')).json())[0].name, '测试用户');
  assert.equal((await f.get('/.env')).status, 404);
  assert.equal((await f.get('/src/config.js')).status, 404);
  assert.equal((await f.get('/')).status, 200);
  assert.match((await f.get('/')).headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('配置保存验证数值、检查版本冲突并保留未改字段，非法修改不落盘', async t => {
  const f = await setup(t); const old = await (await f.get('/api/config')).json();
  const config = structuredClone(old.config); config.social.maxQzonePostsPerHour = 7;
  const response = await f.post('/api/config', { config, revision: old.revision }); assert.equal(response.status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'config.json')));
  assert.equal(saved.social.maxQzonePostsPerHour, 7); assert.equal(saved.qq.cooldownSeconds, old.config.qq.cooldownSeconds);
  assert.equal((await f.post('/api/config', { config, revision: old.revision })).status, 409);
  const latest = await (await f.get('/api/config')).json(); config.bilibili.maxDynamicsPerHour = -1;
  assert.equal((await f.post('/api/config', { config, revision: latest.revision })).status, 400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'config.json'))).bilibili.maxDynamicsPerHour, old.config.bilibili.maxDynamicsPerHour);
});
test('控制接口仅接收认证的本机JSON请求，拒绝跨站、未知操作和密钥写入', async t => {
  const f = await setup(t);
  assert.equal((await fetch(f.base + '/api/status')).status, 403);
  assert.equal((await f.post('/api/control', { action: 'start' }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.post('/api/control', { action: 'start' }, { 'X-Panel-Token': 'invalid' })).status, 403);
  assert.equal((await f.post('/api/control', { action: 'shell' })).status, 404);
  for (const action of ['start', 'stop', 'restart']) assert.equal((await f.post('/api/control', { action })).status, 202);
  assert.deepEqual(f.actions, ['start', 'stop', 'restart']);
  const old = await (await f.get('/api/config')).json();
  assert.equal((await f.post('/api/config', { config: { ...old.config, apiKey: 'secret' }, revision: old.revision })).status, 400);
});
