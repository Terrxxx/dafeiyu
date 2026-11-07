import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AvatarIdentity, avatarVerdict } from '../src/avatar-identity.js';
import { ShoppingBrowser, productUrl, shoppingRequestAllowed } from '../src/shopping.js';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { Agent } from '../src/agent.js';
import { HarnessAgent } from '../src/harness-agent.js';
import { chromium } from 'playwright-core';
import { collectProductCards } from '../src/shopping.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-avatar-shopping-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return { dir, store: new Store(dir) };
}
const reference = 'data:image/png;base64,cmVm';
const candidate = 'data:image/png;base64,Y2FuZGlkYXRl';
const good = JSON.stringify({ sameCharacter: true, singleCharacter: true, suitableAvatar: true, confidence: 0.99 });

test('头像身份以首次当前QQ头像固定，重启或换头像后不漂移，错账号或不确定不通过', async t => {
  const { dir } = setup(t); let downloads = 0; let owner = 123;
  const qq = { call: async () => ({ user_id: owner }) }; let verdict = good;
  const guard = new AvatarIdentity(qq, dir, async (a, b) => { assert.equal(a, reference); assert.equal(b, candidate); return verdict; }, async url => { downloads++; assert.equal(new URL(url).searchParams.get('nk'), '123'); return reference; });
  await guard.verify(candidate); await guard.verify(candidate); assert.equal(downloads, 1);
  const other = new AvatarIdentity(qq, dir, async () => good, async () => { throw new Error('不能重新取参考'); });
  await other.verify(candidate);
  for (verdict of ['{}', good.replace('0.99', '0.8'), good.replace('"singleCharacter":true', '"singleCharacter":false'), good.replace('"sameCharacter":true', '"sameCharacter":false'), '无法识别']) await assert.rejects(() => guard.verify(candidate));
  owner = 456; await assert.rejects(() => guard.verify(candidate), /账号已改变/);
  assert.equal(avatarVerdict(good.replace('0.99', '1.5')), false);
});

test('头像核验失败不会调用更换接口，成功才执行且仍受24小时限制', async t => {
  const { store } = setup(t); const calls = [];
  const tools = new SocialTools({ qq: { enabled: true }, agent: {} }, store, { call: async name => { calls.push(name); return {}; } }, {});
  const image = tools.media.ingest(candidate, '角色头像', 'autonomous-social'); tools.media.markSticker(image.id); tools.begin('autonomous-social');
  tools.avatarIdentity.verify = async () => { throw new Error('不是本人'); };
  await assert.rejects(() => tools.call('qq_set_avatar', { imageId: image.id }), /不是本人/); assert.deepEqual(calls, []);
  tools.avatarIdentity.verify = async data => assert.equal(data, candidate);
  assert.equal((await tools.call('qq_set_avatar', { imageId: image.id })).changed, true);
  await assert.rejects(() => tools.call('qq_set_avatar', { imageId: image.id }), /24小时/);
  assert.deepEqual(calls, ['set_qq_avatar']);
});

test('普通模型和Harness头像识别均传两张实际图片，不用文字描述冒充身份核验', async t => {
  const { store } = setup(t); const config = { apiKey: 'test', baseUrl: 'https://example.test', agent: { maxModelCallsPerHour: 0 } }; let body;
  const direct = new Agent(config, store, {}, async (_url, options) => { body = JSON.parse(options.body); return new Response(JSON.stringify({ choices: [{ message: { content: good } }] })); });
  await direct.compareAvatar(reference, candidate);
  assert.deepEqual(body.messages[0].content.filter(x => x.type === 'image_url').map(x => x.image_url.url), [reference, candidate]);
  const harness = new HarnessAgent(config, store, {}, { run: async (_prompt, options) => { assert.equal(options.images.length, 2); assert.equal(options.images[1].data, 'Y2FuZGlkYXRl'); assert.equal(options.useTools, undefined); return good; } });
  assert.equal(await harness.compareAvatar(reference, candidate), good);
});

test('购物网址只保留实际淘宝/天猫/京东商品ID，不接受伪域名或购买请求', () => {
  assert.equal(productUrl('https://item.jd.com/123.html?affiliate=1', 'jd'), 'https://item.jd.com/123.html');
  assert.equal(productUrl('https://item.taobao.com/item.htm?id=123&spm=abc', 'taobao'), 'https://item.taobao.com/item.htm?id=123');
  for (const url of ['https://item.jd.com.evil.test/123.html', 'https://user:pass@item.jd.com/123.html', 'http://127.0.0.1/item.htm?id=1', 'https://item.taobao.com/item.htm?id=xxx']) assert.equal(productUrl(url, 'taobao'), null);
  assert.equal(shoppingRequestAllowed('https://search.jd.com/Search?keyword=abc', 'GET', 'document', 'jd'), true);
  for (const [url, method, type] of [['https://api.jd.com/x', 'POST', 'xhr'], ['https://cart.jd.com/addcart', 'GET', 'xhr'], ['https://passport.jd.com/login', 'GET', 'document'], ['https://jd.com.evil.test/', 'GET', 'document'], ['https://www.jd.com/a', 'GET', 'websocket']]) assert.equal(shoppingRequestAllowed(url, method, type, 'jd'), false);
});

test('匿名商品读取明确区分实时页面、受限首页及公开索引，不编造价格', async () => {
  const shop = new ShoppingBrowser('', { search: async () => ({ results: [{ title: '毛绒玩具', url: 'https://item.jd.com/123.html', snippet: '公开摘要' }, { title: '伪商品', url: 'https://evil.test/123' }] }) });
  shop.readPage = async () => [{ title: '真实卡片', url: 'https://item.jd.com/123.html', priceText: '¥39' }];
  assert.equal((await shop.read('jd', '玩具')).source, 'platform-search'); assert.equal((await shop.read('jd')).source, 'homepage');
  shop.readPage = async () => { throw new Error('login'); };
  const limited = await shop.read('jd', '玩具'); assert.equal(limited.status, 'limited'); assert.equal(limited.products.length, 1); assert.equal(limited.products[0].priceText, null);
  const home = await shop.read('jd'); assert.equal(home.status, 'blocked'); assert.equal(home.products.length, 0);
  await assert.rejects(() => shop.read('unknown')); await assert.rejects(() => shop.read('jd', ''));
  shop.beforeRequest = () => { throw new Error('睡觉'); }; await assert.rejects(() => shop.read('jd'), /睡觉/);
});

const browserPath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
test('商品提取只读取实际可见卡片，标题和标价绑定同一张卡片', { skip: !browserPath }, async () => {
  const browser = await chromium.launch({ executablePath: browserPath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div class="gl-item"><a href="https://item.jd.com/123.html"><div class="p-name">小鱼抱枕</div></a><span class="p-price">¥39.90</span></div><div class="gl-item"><a href="https://item.jd.com/456.html"><div class="p-name">蓝色杯子</div></a></div><a style="display:none" href="https://item.jd.com/789.html">隐藏商品</a>');
    const products = await page.evaluate(collectProductCards);
    assert.deepEqual(products.map(p => [p.title, p.priceText]), [['小鱼抱枕', '¥39.90'], ['蓝色杯子', null]]);
  } finally { await browser.close(); }
});

test('购物工具在QQ禁用时仍可读取，睡眠时不发出查询', async t => {
  const { store } = setup(t); const tools = new SocialTools({ qq: { enabled: false }, agent: {}, components: { shopping: { installed: true, enabled: true } } }, store, {}, {});
  let reads = 0; tools.components.call = async (_name, args) => { reads++; return args; };
  tools.begin('autonomous-social');
  assert.equal((await tools.call('mcp__dafeiyu__shopping_search', { platform: 'jd', keyword: '杯子' })).keyword, '杯子');
  tools.sleep = { assertAwake() { throw new Error('正在睡觉'); } };
  await assert.rejects(() => tools.call('mcp__dafeiyu__shopping_home', { platform: 'jd' }), /睡觉/); assert.equal(reads, 1);
});
