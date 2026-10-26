export function installSleepFarewell({ tools, store, qq, log, now = Date.now }) {
  tools.sleep.onBeforeSleep = ({ at, energy, chats }) => {
    if (energy >= 100 || Math.abs(now() - at) > 60000) return;
    for (const chat of chats) {
      const key = `sleep-farewell:${at}:${chat.kind}:${chat.target}`;
      // once() invokes its action synchronously up to the first await; the first send is
      // admitted before Sleep.enter flips the state. No model call or sleeping exception.
      void store.once(key, async () => {
        const text = '我先睡啦，醒了聊';
        tools.outgoing(false, text);
        const receipt = await qq.send(chat.kind, chat.target, text);
        store.recordSent(chat.kind, chat.target, receipt, text);
        store.appendHistory(chat.kind === 'group' ? `qq:group:${chat.target}` : `qq:user:${chat.target}`, 'assistant', text);
        return receipt;
      }).catch(error => log(`睡前告别未确认发送：${error.message}`));
    }
  };
}

export async function considerWakeGreeting({ tools, store, qq, agent, log, now = Date.now }) {
  if (tools.sleep.sleeping()) return;
  const rest = tools.sleep.data.lastSleep;
  if (!rest || tools.sleep.data.greetingConsidered === rest.id) return;
  tools.sleep.data.greetingConsidered = rest.id; store.save();
  if (now() - rest.wokeAt > 2 * 3600000 || rest.durationMinutes < 30) return;
  const candidate = [...(rest.chats || [])].sort((a, b) => b.lastOutgoing - a.lastOutgoing).find(chat => {
    if (!['private', 'group'].includes(chat.kind) || !/^[1-9]\d*$/.test(chat.target)) return false;
    if (chat.kind === 'private' && tools.feelings?.data.users[chat.target]?.contactPaused) return false;
    if ((tools.sleep.data.chatTargets[`${chat.kind}:${chat.target}`]?.lastIncoming || 0) >= rest.wokeAt) return false;
    const session = chat.kind === 'group' ? `qq:group:${chat.target}` : `qq:user:${chat.target}`;
    return !store.data.histories[session]?.some(item => item.role === 'assistant' && Date.parse(item.time) >= rest.wokeAt);
  });
  if (!candidate) return;
  const session = candidate.kind === 'group' ? `qq:group:${candidate.target}` : `qq:user:${candidate.target}`;
  try {
    const clock = new Date(now()).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
    const raw = await agent.run(session, `你刚睡醒。北京时间${clock}。这是睡醒后的一次可选问候决定，不是用户新发消息。这里只考虑睡前曾实际互相聊天的当前会话。结合此会话历史、亲疏、是否打扰和当下时间，决定是否发一条短问候，也可不发。早晨可以说早上好，其他时段不要乱说早安。不要透露其他会话的事情，不催人回复。内部决定，不调用工具，严格只返回JSON {"send":false,"text":""}；若想发，send=true，text最多30字，只一条。`, false, { remember: false });
    const choice = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (typeof choice.send !== 'boolean') throw new Error('醒后问候判断格式错误');
    if (!choice.send) return;
    if (typeof choice.text !== 'string' || !choice.text.trim() || choice.text.length > 30 || /[\r\n]/.test(choice.text)) throw new Error('醒后问候须为30字内单条消息');
    tools.sleep.assertAwake();
    await store.once(`wake-greeting:${rest.id}`, async () => {
      tools.outgoing(false, choice.text);
      const receipt = await qq.send(candidate.kind, candidate.target, choice.text);
      store.recordSent(candidate.kind, candidate.target, receipt, choice.text);
      store.appendHistory(session, 'assistant', choice.text, agent.config.agent.historyMessages);
      return receipt;
    });
  } catch (error) { log(`醒后问候未发送或结果不明：${error.message}`); }
}
