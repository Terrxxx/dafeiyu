import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { calculate, componentAction } from '../src/component-actions.js';
import { ComponentManager } from '../src/component-client.js';
import { SocialTools } from '../src/tools.js';
import { Store } from '../src/store.js';
import { ROOT } from '../src/config.js';
import { createRequire } from 'node:module';
function setup(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-components-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
test('计算不执行代码，处理优先级及错误输入', () => {
  assert.equal(calculate('2+3*4').result, 14); assert.equal(calculate('2^3^2').result, 512);
  assert.equal(calculate('-2^2').result, -4); assert.equal(calculate('2^-2').result, .25);
  for (const value of ['process.exit()', '1/0', '2..3', '(2+3', '1+']) assert.throws(() => calculate(value));
});
test('标准MCP子进程握手和工具列表有效，便签跨会话隔离，关闭后拒绝调用', async t => {
  const dir = setup(t); const config = { components: { utilities: { installed: true, enabled: true }, notes: { installed: true, enabled: true } } };
  const manager = new ComponentManager(config, dir); t.after(() => manager.close());
  assert.equal((await manager.call('mcp__dafeiyu__calculate', { expression: '(3+5)/2' }, 'qq:user:1')).result, 4);
  const saved = await manager.call('mcp__dafeiyu__notes_write', { title: '想法', text: '仅属于用户一' }, 'qq:user:1');
  assert.equal((await manager.call('mcp__dafeiyu__notes_read', { id: saved.id }, 'qq:user:1')).text, '仅属于用户一');
  assert.deepEqual(await manager.call('mcp__dafeiyu__notes_list', {}, 'qq:user:2'), []);
  await assert.rejects(() => manager.call('mcp__dafeiyu__notes_read', { id: saved.id }, 'qq:group:9'), /当前会话/);
  config.components.utilities.enabled = false;
  await assert.rejects(() => manager.call('mcp__dafeiyu__calculate', { expression: '2+2' }, 'qq:user:1'), /关闭/);
});
test('工具列表随配置文件启停，直接调用也被阻止，睡眠拒绝组件请求', async t => {
  const dir = setup(t); const store = new Store(dir); const tools = new SocialTools({ agent: {}, qq: {} }, store, {}, {}); t.after(() => tools.components.close());
  const file = path.join(dir, 'config.json'); fs.writeFileSync(file, JSON.stringify({ components: { utilities: { installed: true, enabled: true }, web: { enabled: false } } })); tools.components.settingsFile = file;
  assert.ok(tools.schemas.some(s => s.function.name === 'mcp__dafeiyu__calculate')); assert.ok(!tools.schemas.some(s => s.function.name === 'web_search'));
  await assert.rejects(() => tools.call('web_search', { query: '任何内容' }), /关闭/);
  tools.begin('autonomous-social'); assert.equal((await tools.call('mcp__dafeiyu__calculate', { expression: '2+2' })).result, 4);
  tools.sleep = { assertAwake() { throw new Error('睡觉'); } }; await assert.rejects(() => tools.call('mcp__dafeiyu__clock', {}), /睡觉/); tools.sleep = null;
  fs.writeFileSync(file, JSON.stringify({ components: { utilities: { installed: true, enabled: false } } }));
  await assert.rejects(() => tools.call('mcp__dafeiyu__calculate', { expression: '2+2' }), /关闭/);
});
test('RSS不能读取未配置源和内网，应用工具不允许任意路径或私聊直接启动', async t => {
  const dir = setup(t);
  await assert.rejects(() => componentAction('rss_read', { id: 'x' }, { feeds: [] }, dir), /停用/);
  await assert.rejects(() => componentAction('rss_read', { id: 'x' }, { feeds: [{ id: 'x', url: 'http://127.0.0.1/' }] }, dir), /停用/);
  await assert.rejects(() => componentAction('desktop_open', { app: 'notepad' }, { scope: 'qq:user:1' }, dir), /停用/);
  await assert.rejects(() => componentAction('desktop_open', { app: 'powershell.exe' }, { scope: 'autonomous-social' }, dir), /停用/);
});
const sdk = fs.existsSync(path.join(ROOT, 'harness-runtime/node_modules/@modelcontextprotocol/client/package.json'));
test('组件服务兼容Harness已安装的官方MCP SDK，不只是自定义工具函数', { skip: !sdk }, async t => {
  const dir = setup(t); const require = createRequire(path.join(ROOT, 'harness-runtime/package.json'));
  const { Client } = require('@modelcontextprotocol/client'); const { StdioClientTransport } = require('@modelcontextprotocol/client/stdio');
  const client = new Client({ name: 'compatibility-test', version: '1.0.0' });
  try {
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, 'src/component-server.js'), dir], stderr: 'ignore' }));
    assert.ok((await client.listTools()).tools.some(t => t.name === 'calculate'));
    const result = await client.callTool({ name: 'calculate', arguments: { expression: '7*6' } }); assert.equal(JSON.parse(result.content[0].text).result, 42);
  } finally { await client.close(); }
});
