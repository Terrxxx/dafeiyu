import { randomUUID } from 'node:crypto';
export class MessageBuffer {
  constructor(quietMs, maxMs, flush, onError = console.error, clock = {}) {
    Object.assign(this, { quietMs, maxMs, flush, onError });
    this.now = clock.now || Date.now; this.set = clock.set || setTimeout; this.clear = clock.clear || clearTimeout;
    this.sessions = new Map();
  }
  add(message) {
    let entry = this.sessions.get(message.session);
    if (!entry) {
      if (this.sessions.size >= 50) throw new Error('等待合并的会话过多');
      entry = { id:randomUUID(), start: this.now(), messages: [] }; this.sessions.set(message.session, entry);
      // Never reset the hard deadline when another message arrives. Both timer
      // callbacks bind this batch so an old callback cannot flush the next one.
      entry.deadline = this.set(() => this.deliver(message.session, entry), this.maxMs);
    }
    entry.messages.push(message); this.clear(entry.timer);
    const wait = Math.max(0, Math.min(this.quietMs, entry.start + this.maxMs - this.now()));
    const waitMs=entry.messages.length>=30?0:wait;
    entry.timer = this.set(() => this.deliver(message.session, entry), waitMs);
    return { count: entry.messages.length, waitMs, batchId:entry.id };
  }
  deliver(session, expected) {
    const entry = this.sessions.get(session); if (!entry) return;
    if(expected&&entry!==expected)return;
    this.clear(entry.timer); this.clear(entry.deadline); this.sessions.delete(session);
    Promise.resolve().then(() => this.flush(entry.messages)).catch(this.onError);
  }
  close() { for (const entry of this.sessions.values()){this.clear(entry.timer);this.clear(entry.deadline);} this.sessions.clear(); }
}

export function mergeMessages(messages) {
  const last = messages.at(-1);
  return { ...last, mentioned: messages.some(m => m.mentioned),replyToSelf:messages.some(m=>m.replyToSelf),peerCount:messages.some(m=>Number.isFinite(m.peerCount))?Math.max(...messages.map(m=>Number.isFinite(m.peerCount)?m.peerCount:0)):last.peerCount,
    sources: messages.map(m => ({ mentioned:m.mentioned,addressedElsewhere:m.addressedElsewhere,replyToSelf:m.replyToSelf,replyId:m.replyId,replyUnresolved:m.replyUnresolved,atUserIds:m.atUserIds,selfId:m.selfId,selfNames:m.selfNames,selfUniqueNames:m.selfUniqueNames,peerCount:m.peerCount, sender: m.sender, qqNickname:m.qqNickname,groupCard:m.groupCard, name: m.name, text: m.text, id: m.id, images: m.images, receivedAt: m.receivedAt })),
    text: messages.map(m => `${m.name || m.sender}（${m.sender}）：${m.text || '[图片]'}${m.images?.length ? ' [附图]' : ''}`).join('\n').slice(-16000),
    images: messages.flatMap(m => m.images || []).slice(0, 3),
  };
}
