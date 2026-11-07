import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { Agent } from '../src/agent.js';
import { componentCatalog, componentEnabled } from '../src/component-catalog.js';
import { componentAction } from '../src/component-actions.js';
import { ShoppingBrowser } from '../src/shopping.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-context-budget-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const config = { qq: { enabled: false }, bilibili: { enabled: true, maxVideosPerRound: 3 },
    agent: { historyMessages: 64, contextMaxChars: 24000, maxOutgoingPerHour: 100, maxModelCallsPerHour: 0 },
    components: {} };
  const store = new Store(dir), tools = new SocialTools(config, store, {}, {});
  t.after(() => tools.components.close());
  return { dir, config, store, tools };
}

test('匿名逛店是默认关闭的MCP组件，未安装时不向模型暴露工具', async t => {
  const { dir, config, tools } = fixture(t);
  const shopping = componentCatalog.find(item => item.id === 'shopping');
  assert.equal(shopping.builtin, undefined);
  assert.equal(componentEnabled(shopping, config.components), false);
  tools.begin('autonomous-shopping');
  assert.equal(tools.schemas.some(schema => schema.function.name.includes('shopping')), false);
  await assert.rejects(() => tools.call('mcp__dafeiyu__shopping_search', { platform: 'jd', keyword: '抱枕' }), /关闭|安装/);
  config.components.shopping = { installed: true, enabled: true };
  assert.equal(tools.schemas.filter(schema => schema.function.name.includes('shopping')).length, 3);
  await assert.rejects(() => componentAction('shopping_save_image', { productRef: 'unknown' }, { scope: 'autonomous-shopping' }, dir), /实际读取/);
});

test('MCP逛店返回可核验的商品引用，图片经主进程入库且不把原始图片送给模型', async t => {
  const { dir, config, tools } = fixture(t);
  const read = ShoppingBrowser.prototype.read;
  ShoppingBrowser.prototype.read = async (platform, keyword) => ({ platform, keyword, status: 'ok', products: [{ title: '小鱼抱枕', url: 'https://item.jd.com/123.html', imageUrl: 'https://img.360buyimg.com/a.png', priceText: '¥39' }] });
  t.after(() => { ShoppingBrowser.prototype.read = read; });
  const result = await componentAction('shopping_search', { platform: 'jd', keyword: '抱枕' }, { scope: 'autonomous-shopping' }, dir);
  assert.equal(result.products.length, 1);
  assert.ok(result.products[0].productRef);
  assert.equal(result.products[0].imageAvailable, true);
  assert.equal(result.products[0].imageUrl, undefined);
  config.components.shopping = { installed: true, enabled: true };
  tools.begin('autonomous-shopping');
  tools.inspectImage = async () => '蓝色小鱼图案';
  tools.components.call = async () => ({ dataUrl: 'data:image/png;base64,aGVsbG8=', title: '小鱼抱枕', productUrl: 'https://item.jd.com/123.html' });
  const saved = await tools.call('mcp__dafeiyu__shopping_save_image', { productRef: result.products[0].productRef });
  assert.ok(saved.id);
  assert.equal(saved.dataUrl, undefined);
  assert.equal(tools.media.get(saved.id, tools.scope).source, 'shopping');
});

test('每轮逛店使用不同MCP作用域，旧商品引用不能跨轮复用', async t => {
  const { config, tools } = fixture(t);
  config.components.shopping = { installed: true, enabled: true };
  const scopes = [];
  tools.components.call = async (_name, _args, scope) => { scopes.push(scope); return { products: [] }; };
  tools.begin('autonomous-shopping');
  await tools.call('mcp__dafeiyu__shopping_search', { platform: 'jd', keyword: '鱼' });
  tools.begin('autonomous-shopping');
  await tools.call('mcp__dafeiyu__shopping_search', { platform: 'jd', keyword: '鱼' });
  assert.notEqual(scopes[0], scopes[1]);
  assert.match(scopes[0], /^autonomous-shopping:shop:/);
});

test('后台浏览只加载相关工具，长字幕和候选列表在送模型前有界', async t => {
  const { config, store, tools } = fixture(t);
  tools.begin('autonomous-browse');
  const names = tools.schemas.map(schema => schema.function.name);
  assert.ok(names.includes('bili_read_video'));
  assert.ok(!names.includes('qq_set_avatar'));
  assert.ok(!names.includes('mcp__dafeiyu__shopping_search'));
  assert.ok(names.length <= 18);
  const candidate = index => ({ bvid: `BV${String(index).padStart(10, '0')}`, title: `视频${index}`, description: '很长的简介'.repeat(1000), stats: { views: 1, likes: 2 } });
  tools.bili.popular = async () => Array.from({ length: 20 }, (_, index) => candidate(index));
  const popular = await tools.call('bili_popular', {});
  assert.equal(popular.length, 12);
  assert.ok(popular.every(video => video.description.length <= 180));
  tools.bili.video = async () => ({ ...candidate(1), subtitle: '字幕内容'.repeat(5000), evidence: '实际字幕', historyRecorded: true });
  const video = await tools.call('bili_read_video', { bvid: candidate(1).bvid });
  assert.ok(video.subtitle.length <= 4000);
  assert.ok(tools.videos.get(candidate(1).bvid).subtitle.length > video.subtitle.length);
  const agent = new Agent(config, store, tools);
  store.appendHistory('autonomous-browse', 'user', '过去的浏览报告'.repeat(1000));
  assert.deepEqual(agent.context('autonomous-browse'), []);
});

test('QQ模型上下文限制长度且群聊只带本批发送者关系', t => {
  const { config, store, tools } = fixture(t);
  for (let i = 0; i < 20; i++) store.appendHistory('qq:group:9', 'user', `旧记录${i}`.repeat(200));
  for (const id of ['2', '3']) {
    const user = tools.feelings.user(id);
    user.groups = ['qq:group:9']; user.affinity = Number(id);
  }
  tools.begin('qq:group:9', { kind: 'group', target: '9', sender: '2', sources: [{ sender: '2' }] });
  const agent = new Agent(config, store, tools);
  assert.ok(JSON.stringify(agent.context('qq:group:9')).length <= 8500);
  const state = agent.timeContext('qq:group:9');
  assert.match(state, /^id: 2$/m);
  assert.doesNotMatch(state, /^id: 3$/m);
});
