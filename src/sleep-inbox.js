import { createHash } from 'node:crypto';
import { mergeMessages } from './message-buffer.js';

export function rememberSleepUnread(store, msg, historyLimit = 64) {
  const inbox = store.data.sleepUnread ||= [];
  for (const source of msg.sources || [msg]) {
    const id = String(source.id ?? msg.id);
    const key = `qq-reply:${msg.session}:${id}`;
    if (inbox.some(item => item.session === msg.session && item.id === id)) continue;
    const item = { kind: msg.kind, target: msg.target, session: msg.session, sender: source.sender,
      name: source.name, id, text: String(source.text || '').slice(0, 6000), mentioned: msg.mentioned,
      images: (source.images || (id === String(msg.id) ? msg.images : []) || []).slice(0, 3), receivedAt: Date.now() };
    inbox.push(item);
    store.appendHistory(msg.session, 'user', `[睡眠期间收到，待醒后查看] ${item.name || item.sender}：${item.text || '[图片]'}`, historyLimit);
    store.data.actions[key] = { state: 'sleeping', time: Date.now() };
  }
  if (inbox.length > 99) {
    store.data.meta ||= {};
    store.data.meta.sleepUnreadDropped = (store.data.meta.sleepUnreadDropped || 0) + inbox.length - 99;
    inbox.splice(0, inbox.length - 99);
  }
  store.save();
}

// Called only on the serialized queue after waking. Each context contains a single QQ conversation.
export async function reviewSleepUnread(services, handleMessage) {
  const { store, tools, log } = services;
  if (tools.sleep?.sleeping() || !store.data.sleepUnread?.length) return;
  let reviewed = 0;
  while (reviewed < 99 && store.data.sleepUnread.length && !tools.sleep?.sleeping()) {
    const first = store.data.sleepUnread[0]; const batch = []; let chars = 0;
    for (const item of store.data.sleepUnread) {
      if (item.session !== first.session) continue;
      const size = item.text.length + (item.name?.length || 0) + String(item.sender).length + 100;
      if (batch.length && chars + size > 10000) break;
      if (batch.length + reviewed >= 99) break;
      batch.push(item); chars += size;
    }
    const ids = new Set(batch.map(item => `${item.session}:${item.id}`));
    const key = `wake-review:${createHash('sha256').update([...ids].join('|')).digest('hex')}`;
    const claimKey = `${key}:claim`;
    // Persist the claim before model/tool execution; uncertain sends are never replayed after a restart.
    store.data.sleepUnread = store.data.sleepUnread.filter(item => !ids.has(`${item.session}:${item.id}`));
    store.data.actions[claimKey] = { state: 'reviewing', time: Date.now() }; store.save();
    const msg = { ...mergeMessages(batch), unreadReview: true, unreadCount: batch.length };
    try {
      await handleMessage(msg, key, services);
      if (store.data.actions[key]?.state === 'sleeping') {
        store.data.actions[claimKey].state = 'requeued';
        delete store.data.actions[key];
      } else store.data.actions[claimKey].state = 'reviewed';
    } catch (error) {
      if (tools.sleep?.sleeping() && !store.data.actions[key] && !(tools.current?.key === key && tools.currentAttempted)) {
        rememberSleepUnread(store, msg, services.agent?.config?.agent.historyMessages);
        store.data.actions[claimKey].state = 'requeued';
      } else {
        store.data.actions[claimKey].state = 'review-failed';
        store.audit('wake-review-error', { key, message: error.message });
        log(`醒后未读消息处理失败：${error.message}`);
      }
    }
    store.save(); reviewed += batch.length;
  }
  if (reviewed) log(`醒后已查看${reviewed}条QQ未读消息，由AI择要回应`);
}
