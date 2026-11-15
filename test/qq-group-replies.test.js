import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Agent } from '../src/agent.js';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { handleQQMessage } from '../src/qq-handler.js';
import { mergeMessages } from '../src/message-buffer.js';

test('one group batch addresses older and newer askers with the correct QQ quote targets', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-qq-multi-'));
  const store = new Store(dir);
  const config = {
    qq: { enabled: true, adminUsers: [] },
    agent: { historyMessages: 64, maxModelCallsPerHour: 0, maxOutgoingPerHour: 30 },
  };
  const sends = [], logs = [];
  const qq = {
    async send(kind, target, text, options) {
      sends.push({ kind, target, text, quote: options.replyTo });
      return { message_id: sends.length };
    },
  };
  const tools = new SocialTools(config, store, qq, {});
  t.after(() => { tools.components.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  const agent = new Agent(config, store, tools);
  const group = '9912345';
  const row = (id, sender, text, mentioned = true) =>
    ({ kind: 'group', session: 'qq:group:' + group, target: group, id, sender, name: sender,
      selfId: '501234', text, receivedAt: Date.now(), mentioned });
  const first = row('101', '123456', '你喜欢什么颜色？');
  const ignored = { ...row('102', '234567', '你今天吃什么？', false), atUserIds: ['678901'] };
  const recent = row('103', '345678', '你喜欢什么花？');
  const bulkContext = [
    row('104', '456789', '说说别的。'.repeat(1400), false),
    row('105', '456789', '继续说点别的。'.repeat(1400), false),
  ];
  let passes = 0;
  agent.taskJSON = async (protocol, material) => {
    passes++;
    if (passes === 1) {
      assert.match(protocol, /使用 replies 数组逐人回答/);
      assert.match(material, /required=true\nref: 1\nsender: 123456/);
      assert.match(material, /required=true\nref: 2\nsender: 345678/);
      assert.match(material, /earlierQuestions: 你喜欢什么颜色？/);
      return { engage: true, replies: [{ ref: '2', reply: '小雏菊～' }, { ref: '3', reply: '误回' }] };
    }
    assert.deepEqual(material.questions, [{ ref: '1', text: first.text }]);
    return { replies: [{ ref: '1', reply: '浅蓝色！' }] };
  };
  await handleQQMessage(mergeMessages([first, ...bulkContext, ignored, recent]), 'batch', {
    agent, store, tools, qq, throttle: { wait: async () => {} }, log: line => logs.push(line),
  });
  assert.equal(passes, 2);
  assert.deepEqual(sends.map(send => [send.quote, send.text]), [['101', '浅蓝色！'], ['103', '小雏菊～']]);
  assert.ok(sends.every(send => send.kind === 'group' && send.target === group));
  assert.ok(logs.includes('QQ 群聊逐人回复 · 已确认 2/2 位'));
});
