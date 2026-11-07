import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { FriendRequests } from '../src/friend-requests.js';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-friend-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const calls = []; const prompts = [];
  const tools = { config:{qq:{friendRequestsEnabled:true,minFriendAffinity:0}}, sleep: { sleeping: () => false }, feelings: { data: { users: { '2': { affinity: 40, trust: 50, familiarity: 30 } } } } };
  const agent = { run: async (...args) => { prompts.push(args); return '{"approve":true}'; } };
  const qq = { call: async (...args) => { calls.push(args); return {}; } };
  const requests = new FriendRequests(store, agent, tools, qq);
  const event = { post_type: 'request', request_type: 'friend', user_id: 2, self_id: 1, flag: 'real-flag', comment: '群里聊过，加一下' };
  return { dir, store, calls, prompts, tools, agent, qq, requests, event };
}
test('好友申请审核携带真实好感，只处理已收到的flag，去重跨重启', async t => {
  const f = fixture(t);
  assert.equal(f.requests.receive({ ...f.event, request_type: 'group' }), false);
  assert.equal(f.requests.receive({ ...f.event, flag: '' }), false);
  assert.equal(f.requests.receive(f.event), true);
  assert.equal(f.requests.receive(f.event), false);
  await f.requests.tick();
  assert.deepEqual(f.calls, [['set_friend_add_request', { flag: 'real-flag', approve: true, remark: '' }]]);
  assert.match(f.prompts[0][1], /affinity=40/);
  assert.equal(f.prompts[0][2], false);
  assert.equal(f.prompts[0][3].remember, false);
  assert.ok(!f.prompts[0][1].includes('real-flag'));
  const restart = new FriendRequests(new Store(f.dir), f.agent, f.tools, f.qq);
  assert.equal(restart.receive(f.event), false);
  await restart.tick(); assert.equal(f.calls.length, 1);
});
test('陌生人按中性好感，模型可以拒绝且不会发出加好友或聊天操作', async t => {
  const f = fixture(t); delete f.tools.feelings.data.users['2'];
  f.agent.run = async (session, prompt) => { assert.match(prompt, /affinity=0/); return '{"approve":false}'; };
  f.requests.receive(f.event); await f.requests.tick();
  assert.equal(f.calls[0][1].approve, false);
  assert.equal(Object.values(f.requests.items)[0].status, 'rejected');
});
test('睡眠期间持久化等待，判断时入睡也不执行；格式错误不默认同意', async t => {
  const f = fixture(t); f.tools.sleep.sleeping = () => true;
  f.requests.receive(f.event); await f.requests.tick(); assert.equal(f.prompts.length, 0);
  f.tools.sleep.sleeping = () => false;
  f.agent.run = async () => { f.tools.sleep.sleeping = () => true; return '{"approve":true}'; };
  await f.requests.tick(); assert.equal(f.calls.length, 0);
  f.tools.sleep.sleeping = () => false; f.agent.run = async () => '{"approve":"false"}';
  await f.requests.tick(); await f.requests.tick(); await f.requests.tick();
  assert.equal(f.calls.length, 0); assert.equal(Object.values(f.requests.items)[0].status, 'failed');
});
test('审批超时标记不确定，不重复同意或拒绝', async t => {
  const f = fixture(t); let count = 0;
  f.qq.call = async () => { count++; throw new Error('timeout'); };
  f.requests.receive(f.event); await f.requests.tick(); await f.requests.tick();
  assert.equal(count, 1); assert.equal(Object.values(f.requests.items)[0].status, 'uncertain');
});
