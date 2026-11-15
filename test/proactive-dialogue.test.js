import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { withoutRepeatedQuestions, recordQuestion, recentQuestionContext } from '../src/proactive-dialogue.js';
import { writeUserControl } from '../src/user-controls.js';

const scope = 'qq:user:123456';
const config = { qq: { enabled: true, adminUsers: ['123456'] },
  agent: { historyMessages: 64, maxOutgoingPerHour: 100 }, social: {} };

function setup(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-qq-repeat-'));
  const store = new Store(dir), sends = [];
  const qq = { send: async (...args) => { sends.push(args); return { message_id: sends.length }; } };
  const tools = new SocialTools(config, store, qq, {});
  t.after(() => {
    tools.components.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { dir, store, qq, tools, sends };
}

test('识别改写后的日常和进度问题，保留有用回答与不同话题', t => {
  const { store } = setup(t);
  const now = Date.now();
  recordQuestion(store, scope, '爸，最近都在忙什么呀？', now - 86400000);
  recordQuestion(store, scope, '你的报名表填得怎么样啦？', now - 10000);
  recordQuestion(store, scope, '吃过饭了没', now - 10000);
  assert.equal(withoutRepeatedQuestions(store, scope, '这几天你都在干嘛', { proactive: true, now }), '');
  assert.equal(withoutRepeatedQuestions(store, scope, '收到啦，你吃饭了吗', { now }), '收到啦。');
  assert.equal(withoutRepeatedQuestions(store, scope, '报名表有进展吗？', { now }), '');
  assert.equal(withoutRepeatedQuestions(store, scope, '面试准备得怎么样啦？', { now }), '面试准备得怎么样啦？');
  assert.equal(withoutRepeatedQuestions(store, scope, '收到啦！报名表进度怎样？\n我先记一下。', { now }), '收到啦！\n我先记一下。');
  assert.equal(withoutRepeatedQuestions(store, 'qq:user:654321', '报名表有进展吗？', { now }), '报名表有进展吗？');
  assert.equal(withoutRepeatedQuestions(store, scope, '我知道接下来该做什么。', { now }), '我知道接下来该做什么。');
  assert.equal(withoutRepeatedQuestions(store, scope, '吃了没呀？吃饭了吗？', { now }), '');
});

test('发送前去重、被拦截不占配额，私聊回复和语音共用已送达问题', async t => {
  const { dir, store, tools, sends } = setup(t);
  tools.begin(scope, { kind: 'private', sender: '123456', target: '123456', session: scope, key: 'first' });
  await tools.call('qq_reply_current', { text: '你最近在忙什么呀' });
  assert.equal(sends.length, 1);
  assert.equal(new Store(dir).data.proactiveDialogue[scope].length, 1);

  tools.begin('autonomous-social');
  const group = 'qq:group:88888';
  tools.targets.add('group:88888');
  await tools.call('qq_send_message', { kind: 'group', target: '88888', text: '你最近在忙什么呀' });
  const repeat = await tools.call('qq_send_message', { kind: 'group', target: '88888', text: '这几天你都在干嘛呀' });
  assert.equal(repeat.repeatedQuestion, true);
  assert.equal(store.data.proactiveDialogue[group].length, 1);
  assert.equal(store.data.counters.filter(row => row.kind === 'outgoing').length, 2);

  tools.begin(scope, { kind: 'private', sender: '123456', target: '123456', session: scope, key: 'voice' });
  tools.synthesizeSpeech = () => assert.fail('重复语音不应调用合成');
  const voice = await tools.call('qq_send_voice', { kind: 'private', target: '123456', text: '今天在忙啥' });
  assert.equal(voice.repeatedQuestion, true);
  assert.equal(sends.length, 2);
});

test('旧聊天中没有问号的提问也会参与去重，记忆删除后不复用', t => {
  const { dir, store } = setup(t);
  store.appendHistory(scope, 'assistant', '你吃饭了吗');
  store.appendHistory(scope, 'user', '吃过啦');
  assert.deepEqual(recentQuestionContext(store, scope), [{ question: '你吃饭了吗', daysAgo: 0, nextMessage: '吃过啦' }]);
  assert.equal(withoutRepeatedQuestions(store, scope, '吃了没呀'), '');
  writeUserControl(dir, '123456', { forgottenAt: Date.now() });
  assert.equal(withoutRepeatedQuestions(store, scope, '吃了没呀'), '吃了没呀');
});

test('普通 QQ 回复移除重复问句后只发送正常回应', async t => {
  const { store, tools, qq, sends } = setup(t);
  store.appendHistory(scope, 'assistant', '饭吃了没呀？');
  const agent = { config, feelings: tools.feelings, personality: tools.personality,
    planQQTurn: async () => ({ reply: '知道啦！你吃饭了吗' }), reportDecision() {} };
  await handleQQMessage({ kind: 'private', session: scope, sender: '123456', target: '123456',
    id: 'incoming', text: '我吃过了', receivedAt: Date.now() }, 'current', {
    agent, store, tools, qq, throttle: { wait: async () => {} }, log() {},
  });
  assert.equal(sends[0][2], '知道啦！');
  assert.equal(store.data.histories[scope].at(-1).content, '知道啦！');
});
