import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { Feelings } from '../src/feelings.js';
import { followupChat } from '../src/proactive.js';

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-followup-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new Store(dir); const sent = [];
  const config = { qq: { enabled: true, adminUsers: ['1'] }, social: { followupWaitMinutes: 30 }, agent: { maxOutgoingPerHour: 20 } };
  const qq = { send: async (...args) => { sent.push(args); return { message_id: sent.length }; }, call: async () => null };
  const tools = new SocialTools(config, store, qq, {});
  return { store, tools, qq, config, sent };
}
test('撤回限于当前会话自己的真实发送回执，成功取消该问话跟进', async t => {
  const { store, tools, qq } = setup(t); let deletes = 0;
  store.recordSent('private', '1', { messages: [{ message_id: 11 }, { message_id: 12 }] }, '还好吗？');
  store.recordSent('group', '2', { message_id: 13 }, 'other');
  tools.feelings.contacted('1', '还好吗？', { message_id: 11 });
  tools.begin('qq:user:1', { kind: 'private', target: '1', sender: '1' });
  assert.equal((await tools.call('qq_list_sent', {})).length, 2);
  await assert.rejects(() => tools.call('qq_recall_message', { messageId: '13' }));
  await assert.rejects(() => tools.call('qq_recall_message', { messageId: '999' }));
  qq.call = async (name, args) => { assert.equal(name, 'delete_msg'); assert.equal(args.message_id, '11'); deletes++; };
  assert.equal((await tools.call('qq_recall_message', { messageId: '11' })).recalled, true);
  assert.equal(store.data.sentMessages['11'].recalled, true);
  assert.equal(tools.feelings.user('1').followup.checked, true);
  await assert.rejects(() => tools.call('qq_recall_message', { messageId: '11' }));
  assert.equal(deletes, 1); assert.match(store.context('qq:user:1').at(-1).content, /已撤回/);
});
test('撤回失败不会假记成功，也不会自动重试状态不明的撤回', async t => {
  const { store, tools, qq } = setup(t);
  store.recordSent('private', '1', { message_id: 1 }, 'hello');
  tools.begin('qq:user:1', { kind: 'private', target: '1', sender: '1' });
  let calls = 0; qq.call = async () => { calls++; throw new Error('超时'); };
  await assert.rejects(() => tools.call('qq_recall_message', { messageId: '1' }));
  assert.equal(store.data.sentMessages['1'].recalled, false);
  assert.equal((await tools.call('qq_recall_message', { messageId: '1' })).skipped, true);
  assert.equal(calls, 1);
});
test('问话30分钟后仅一次跟进，重启不重发，对应用户之外的消息不算回复', async t => {
  const { store, tools, config, sent } = setup(t); let now = Date.now(); tools.feelings.now = () => now;
  const f = tools.feelings; f.contacted('1', '今天怎么样？', { message_id: 10 });
  now += 29 * 60000; assert.equal(f.canFollowup('1'), false);
  f.receive({ session: 'qq:user:2', sender: '2' });
  now += 60001;
  const agent = { feelings: f, run: async () => {
    await tools.call('qq_send_message', { kind: 'private', target: '1', text: '居然不理我', expectReply: true });
    await assert.rejects(() => tools.call('qq_send_message', { kind: 'private', target: '1', text: '又催一次' }));
  } };
  assert.equal(await followupChat(agent, tools, [{ kind: 'private', id: '1' }], config), true);
  assert.equal(sent.length, 1);
  const restored = new Feelings(new Store(path.dirname(store.file)), () => now + 3600000);
  assert.equal(restored.canFollowup('1'), false);
  assert.equal(f.user('1').affinity, 0);
});
test('模型判断期间收到对应私聊、暂停联系或主动选择不发，均不补催', async t => {
  const { tools, config, sent } = setup(t); let now = Date.now(); const f = tools.feelings; f.now = () => now;
  f.contacted('1', '还好吗？', { message_id: 1 }); now += 31 * 60000;
  const agent = { feelings: f, run: async () => {
    f.receive({ session: 'qq:user:1', sender: '1' });
    await assert.rejects(() => tools.call('qq_send_message', { kind: 'private', target: '1', text: '居然不理我' }));
  } };
  await followupChat(agent, tools, [{ kind: 'private', id: '1' }], config); assert.equal(sent.length, 0);
  now++; f.contacted('1', '好了吗？', { message_id: 2 }); now += 31 * 60000;
  f.user('1').contactPaused = true; assert.equal(f.canFollowup('1'), false);
  f.user('1').contactPaused = false; agent.run = async () => '选择不发';
  assert.equal(await followupChat(agent, tools, [{ kind: 'private', id: '1' }], config), true);
  assert.equal(f.canFollowup('1'), false); assert.equal(sent.length, 0);
});
