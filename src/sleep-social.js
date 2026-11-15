import { withoutRepeatedQuestions, recordQuestion } from './proactive-dialogue.js';
import { confirmedMessage } from './qq-processing.js';

export function installSleepFarewell({ tools, store, qq, log, now = Date.now }) {
  const send = (chats, cycle, text) => {
    const targets = tools.sleep.data.farewellTargets ||= {};
    targets[cycle] ||= [];
    for (const chat of chats) {
      const target = `${chat.kind}:${chat.target}`;
      if (targets[cycle].includes(target) || targets[cycle].length >= 2) continue;
      targets[cycle].push(target); store.save();
      const key = `sleep-farewell:${cycle}:${target}`;
      void store.once(key, async () => {
        tools.outgoing(false, text);
        const receipt = await qq.send(chat.kind, chat.target, text);
        store.recordSent(chat.kind, chat.target, receipt, text);
        store.appendHistory(chat.kind === 'group' ? `qq:group:${chat.target}` : `qq:user:${chat.target}`, 'assistant', text);
        return receipt;
      }).catch(error => log(`睡前告别未确认发送：${error.message}`));
    }
    for (const key of Object.keys(targets)) if (Number(key) < now() - 2 * 86400000) delete targets[key];
  };
  tools.sleep.onWindDown = () => {
    if (tools.sleep.sleeping()) return;
    const winding = tools.sleep.windDown();
    if (winding.active) send(tools.sleep.activeChats(), winding.bedtimeAt, '有点困，准备睡啦');
  };
  tools.sleep.onBeforeSleep = ({ at, energy, chats, reason }) => {
    if (energy >= 100 || Math.abs(now() - at) > 60000) return;
    const planned = reason === 'midnight' ? tools.sleep.bedtime(tools.sleep.data.nightDay) : at;
    send(chats, Math.abs(at - planned) <= 60000 ? planned : at, '我先睡啦，醒了聊');
  };
}

export async function considerWakeGreeting({ tools, store, qq, agent, log, now = Date.now }) {
  if (tools.sleep.sleeping()) return;
  const rest = tools.sleep.data.lastSleep;
  if (!rest || tools.sleep.data.greetingConsidered === rest.id) return;
  tools.sleep.data.greetingConsidered = rest.id; store.save();
  if (rest.reason === 'nap' || now() - rest.wokeAt > 30 * 60000 || now() < rest.wokeAt || rest.durationMinutes < 30) return;
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
    const raw = await agent.run(session, `你已醒${Math.floor((now() - rest.wokeAt) / 60000)}分钟。北京时间${clock}。这是睡醒后的一次可选问候决定，不是用户新发消息。这里只考虑睡前曾实际互相聊天的当前会话。结合此会话历史、亲疏、是否打扰和当下时间，决定是否发一条短问候，也可不发。早安/早上好仅05:00–10:59可说；刚醒/刚起床仅醒后15分钟内可说。不要透露其他会话的事情，不催人回复。内部决定，不调用工具，严格只返回JSON {"send":false,"text":""}；若想发，send=true，text最多30字，只一条。`, false, { remember: false });
    const choice = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    if (typeof choice.send !== 'boolean') throw new Error('醒后问候判断格式错误');
    if (!choice.send) return;
    if (typeof choice.text !== 'string' || !choice.text.trim() || choice.text.length > 30 || /[\r\n]/.test(choice.text)) throw new Error('醒后问候须为30字内单条消息');
    tools.sleep.assertAwake();
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(now()));
    if (now() - rest.wokeAt > 30 * 60000 || (/早安|早上好|早呀|早啊/.test(choice.text) && (hour < 5 || hour >= 11)) || (/刚.{0,3}(醒|起床)/.test(choice.text) && now() - rest.wokeAt > 15 * 60000)) return;
    const text = withoutRepeatedQuestions(store, session, choice.text, { proactive: true, now: now() });
    if (!text) return;
    await store.once(`wake-greeting:${rest.id}`, async () => {
      tools.outgoing(false, text);
      const receipt = await qq.send(candidate.kind, candidate.target, text);
      if (confirmedMessage(receipt)) recordQuestion(store, session, text, now());
      store.recordSent(candidate.kind, candidate.target, receipt, text);
      store.appendHistory(session, 'assistant', text, agent.config.agent.historyMessages);
      return receipt;
    });
  } catch (error) { log(`醒后问候未发送或结果不明：${error.message}`); }
}
