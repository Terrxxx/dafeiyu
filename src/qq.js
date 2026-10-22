import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { allowed } from './config.js';
import { messageParts } from './message-parts.js';

export function parseMessage(event, config, skipped = () => {}) {
  if (event.post_type !== 'message' || String(event.user_id) === String(event.self_id)) return null;
  if (!['private', 'group'].includes(event.message_type)) return null;
  const group = event.message_type === 'group';
  if (!allowed(group ? config.allowGroups : config.allowUsers, group ? event.group_id : event.user_id)) { skipped('不在允许的会话范围'); return null; }
  if (!Array.isArray(event.message)) { skipped('消息格式不是 array，请检查 NapCat 配置'); return null; }
  const mentioned = event.message.some(x => x.type === 'at' && String(x.data?.qq) === String(event.self_id));
  if (group && config.requireMentionInGroup && !mentioned) { skipped('群消息未 @ 机器人'); return null; }
  const text = event.message.filter(x => x.type === 'text').map(x => x.data.text).join('').trim().slice(0, 6000);
  const images = event.message.filter(x => x.type === 'image').map(x => ({ file: x.data.file, url: x.data.url })).slice(0, 3);
  if (!text && !images.length) { skipped('消息没有可处理的文本或图片'); return null; }
  return { kind: group ? 'group' : 'private', target: String(group ? event.group_id : event.user_id),
    session: group ? `qq:group:${event.group_id}` : `qq:user:${event.user_id}`, text,
    sender: String(event.user_id), name: String(event.sender?.card || event.sender?.nickname || event.user_id), id: String(event.message_id), mentioned, images };
}

// Called from the serialized task queue: cooldown delays a reply instead of dropping it.
export class ReplyThrottle {
  constructor(seconds, now = Date.now, sleep = delay) {
    this.interval = seconds * 1000; this.now = now; this.sleep = sleep; this.last = new Map();
  }
  async wait(session) {
    const last = this.last.get(session);
    const remaining = last === undefined ? 0 : Math.max(0, last + this.interval - this.now());
    if (remaining) await this.sleep(remaining);
    this.last.set(session, this.now());
  }
}

export class QQ {
  constructor(config, onMessage, log = console.log) {
    Object.assign(this, { config, onMessage, log });
    this.pending = new Map(); this.stopped = false; this.socket = null; this.reconnect = null;
  }
  connect() {
    if (this.stopped) return;
    const url = new URL(this.config.wsUrl);
    if (this.config.wsToken) url.searchParams.set('access_token', this.config.wsToken);
    this.socket = new WebSocket(url);
    const socket = this.socket;
    socket.addEventListener('open', () => this.log('QQ OneBot 已连接'));
    socket.addEventListener('message', event => {
      let data;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      if (data.echo && this.pending.has(data.echo)) {
        const pending = this.pending.get(data.echo); this.pending.delete(data.echo); clearTimeout(pending.timer);
        if (data.status === 'ok' && data.retcode === 0) pending.resolve(data.data);
        else pending.reject(new Error(`OneBot 动作失败 (${data.retcode})`));
      } else if (data.post_type === 'message') {
        Promise.resolve(this.onMessage(data)).catch(error => this.log(`QQ 处理失败：${error.message}`));
      }
    });
    socket.addEventListener('error', () => this.log('QQ 连接异常，请检查 NapCat 地址和 Token'));
    socket.addEventListener('close', () => {
      for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('QQ 连接已断开')); }
      this.pending.clear();
      if (!this.stopped) this.reconnect = setTimeout(() => this.connect(), 10000);
    });
  }
  call(action, params = {}) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('NapCat 尚未连接'));
    return new Promise((resolve, reject) => {
      const echo = randomUUID();
      const timer = setTimeout(() => { this.pending.delete(echo); reject(new Error('QQ 请求超时，发送状态可能不明')); }, 20000);
      this.pending.set(echo, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ action, params, echo }));
    });
  }
  send(kind, target, text, options = {}) {
    const parts = messageParts(text);
    const message = [];
    if (options.replyTo !== undefined) message.push({ type: 'reply', data: { id: String(options.replyTo) } });
    if (kind === 'group') for (const id of options.atUserIds || []) {
      if (!/^[1-9]\d*$/.test(String(id))) throw new Error('无效的@用户ID');
      message.push({ type: 'at', data: { qq: String(id) } }, { type: 'text', data: { text: ' ' } });
    }
    return this.sendParts(kind, target, parts, message);
  }
  async sendParts(kind, target, parts, prefix) {
    const receipts = [];
    for (let i = 0; i < parts.length; i++) {
      if (i) await delay(900);
      try {
        receipts.push(await this.call(kind === 'group' ? 'send_group_msg' : 'send_private_msg', {
          [kind === 'group' ? 'group_id' : 'user_id']: Number(target),
          message: [...(i === 0 ? prefix : []), { type: 'text', data: { text: parts[i] } }],
        }));
      } catch (error) {
        throw new Error(`QQ 分条发送中断（已确认 ${receipts.length}/${parts.length} 条）：${error.message}`);
      }
    }
    return parts.length === 1 ? receipts[0] : { messages: receipts, count: receipts.length };
  }
  close() { this.stopped = true; clearTimeout(this.reconnect); this.socket?.close(); }
}
