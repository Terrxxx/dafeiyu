import { describeMessageImages } from './images.js';

export async function handleQQMessage(msg, key, { agent, store, tools, qq, throttle, log }) {
  const pictures = await describeMessageImages(msg, qq, agent, log);
  const input = `当前QQ${msg.kind === 'group' ? '群' : '私聊'}，会话ID=${msg.target}，发送者=${msg.name || msg.sender}（ID=${msg.sender}），${msg.mentioned ? '本条真实 @ 了你' : '本条未 @ 你'}。\n消息：${msg.text}\n${pictures}`;
  {
    log('QQ：AI 正在判断是否回复这一组消息');
    if (!await agent.shouldReply(msg.session, input)) {
      store.data.actions[key] = { state: 'silent', time: Date.now() };
      store.save(); store.audit('qq-silent', { key });
      log('QQ：AI 选择保持安静');
      return;
    }
  }
  await throttle.wait(msg.session);
  log('QQ 开始生成回复');
  tools.begin(msg.session, { ...msg, key });
  const text = await agent.run(msg.session, `${input}\n若想引用本条或真实@发送者，使用qq_reply_current。若直接输出普通文本，程序会自动发送；工具已回复后不要再次发送。可以按需要给自己安排后续任务。`);
  if (!tools.currentAttempted) await store.once(key, async () => { tools.outgoing(false, text); return qq.send(msg.kind, msg.target, text); });
  log('QQ 回复已处理');
}
