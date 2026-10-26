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
      entry = { start: this.now(), messages: [] }; this.sessions.set(message.session, entry);
    }
    entry.messages.push(message); this.clear(entry.timer);
    const wait = Math.max(0, Math.min(this.quietMs, entry.start + this.maxMs - this.now()));
    entry.timer = this.set(() => this.deliver(message.session), entry.messages.length >= 30 ? 0 : wait);
  }
  deliver(session) {
    const entry = this.sessions.get(session); if (!entry) return;
    this.clear(entry.timer); this.sessions.delete(session);
    Promise.resolve().then(() => this.flush(entry.messages)).catch(this.onError);
  }
  close() { for (const entry of this.sessions.values()) this.clear(entry.timer); this.sessions.clear(); }
}

export function mergeMessages(messages) {
  const last = messages.at(-1);
  return { ...last, mentioned: messages.some(m => m.mentioned),
    sources: messages.map(m => ({ sender: m.sender, name: m.name, text: m.text, id: m.id, images: m.images })),
    text: messages.map(m => `${m.name || m.sender}（${m.sender}）：${m.text || '[图片]'}${m.images?.length ? ' [附图]' : ''}`).join('\n').slice(-16000),
    images: messages.flatMap(m => m.images || []).slice(0, 3),
  };
}
