import test from 'node:test';
import assert from 'node:assert/strict';
import { Bilibili } from '../src/bilibili.js';
import { SocialTools } from '../src/tools.js';

test('账号读取只接受后台固定scope，禁用B站时也拒绝', async () => {
  let calls = 0;
  const tools = new SocialTools({ bilibili: { enabled: true } }, { data: {}, save() {} }, {}, { ownHistory: async () => { calls++; return []; } });
  for (const scope of ['private:1', 'group:1', 'autonomous-browse-fake', 'bili:1']) {
    tools.begin(scope);
    await assert.rejects(() => tools.call('bili_my_history', {}));
  }
  assert.equal(calls, 0);
  tools.begin('autonomous-browse'); await tools.call('bili_my_history', {});
  assert.equal(calls, 1);
  tools.config.bilibili.enabled = false;
  await assert.rejects(() => tools.call('bili_my_history', {}));
});
test('只读取登录账号收藏，拒绝他人收藏夹和无效分页，所有请求只读', async () => {
  const bili = new Bilibili(''); const requests = [];
  bili.api = async (endpoint, args, post) => {
    assert.ok(!post); requests.push(endpoint);
    if (endpoint.endsWith('/nav')) return { isLogin: true, mid: 42 };
    if (endpoint.endsWith('/list-all')) { assert.equal(args.up_mid, '42'); return { list: [{ id: 10, title: '收藏' }] }; }
    if (endpoint.endsWith('/resource/list')) return { medias: null, has_more: false };
    if (endpoint.endsWith('/followings')) { assert.equal(args.vmid, '42'); return { list: [], total: 0 }; }
  };
  await assert.rejects(() => bili.ownFavorites('99'));
  assert.ok(!requests.some(x => x.endsWith('/resource/list')));
  assert.deepEqual((await bili.ownFavorites('10')).items, []);
  await assert.rejects(() => bili.ownFollowing(0));
  assert.deepEqual((await bili.ownFollowing()).items, []);
  bili.api = async () => ({ isLogin: false });
  await assert.rejects(() => bili.ownHistory(), /登录已失效/);
});
