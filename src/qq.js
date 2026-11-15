import { chatAllowed, incomingAllowed, normalizeQQPolicy } from './qq-policy.js';
import fs from 'node:fs';
import { QQPeers } from './qq-peers.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { messageParts } from './message-parts.js';

export function parseMessage(event, config, skipped = () => {}) {
  if (event.post_type !== 'message' || String(event.user_id) === String(event.self_id)) return null;
  if (!['private', 'group'].includes(event.message_type)) return null;
  const group = event.message_type === 'group';
  if(!incomingAllowed(config,group?'group':'private',group?event.group_id:event.user_id,event.user_id))return null;
  if (!Array.isArray(event.message)) { skipped('消息格式不是 array，请检查 NapCat 配置'); return null; }
  const mentioned = event.message.some(x => x.type === 'at' && String(x.data?.qq) === String(event.self_id));
  if (group && config.requireMentionInGroup && !mentioned) { skipped('群消息未 @ 机器人'); return null; }
  const memoryText = event.message.filter(x => x.type === 'text').map(x => x.data.text).join('');
  const text = memoryText.trim().slice(0, 6000);
  const images = event.message.filter(x => x.type === 'image').map(x => ({ file: x.data.file, url: x.data.url })).slice(0, 3);
  if (!text && !images.length) { skipped('消息没有可处理的文本或图片'); return null; }
  const atUserIds=event.message.filter(x=>x.type==='at').map(x=>String(x.data?.qq));const replyId=event.message.find(x=>x.type==='reply')?.data?.id;
  return { selfId:String(event.self_id),atUserIds,replyId,addressedElsewhere:group&&atUserIds.some(id=>id!=='all')&&!mentioned,kind: group ? 'group' : 'private', target: String(group ? event.group_id : event.user_id),
    session: group ? `qq:group:${event.group_id}` : `qq:user:${event.user_id}`, text, memoryText,
    sender: String(event.user_id), groupCard:group?String(event.sender?.card||'').slice(0,80):undefined, qqNickname:typeof event.sender?.nickname==='string'?event.sender.nickname.slice(0,100):undefined, name: String(event.sender?.nickname || event.user_id), id: String(event.message_id), mentioned, images, receivedAt: Date.now() };
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
  constructor(config, onMessage, log = console.log, createSocket = url => new WebSocket(url)) {
    Object.assign(this, { config, onMessage, log, createSocket });
    this.peers = new QQPeers(); this.pending = new Map(); this.stopped = false; this.socket = null; this.reconnect = null;
  }
  policy() {
    const initial = this.config.qq || this.config;
    if (!this.policyFile) return initial;
    try {
      const stat = fs.statSync(this.policyFile, { bigint: true });
      const stamp = `${stat.mtimeNs}:${stat.size}`;
      if (stamp !== this.policyStamp) {
        const saved = JSON.parse(fs.readFileSync(this.policyFile, 'utf8').replace(/^\uFEFF/, ''));
        this.policyCache = normalizeQQPolicy({ ...initial,
          groupBlocklist: saved.qq?.groupBlocklist ?? initial.groupBlocklist,
          privateBlocklist: saved.qq?.privateBlocklist ?? initial.privateBlocklist,
          adminOnlyDialogue: saved.qq?.adminOnlyDialogue ?? initial.adminOnlyDialogue });
        this.policyStamp = stamp;
      }
    } catch (error) {
      if (error.message !== this.policyError) this.log(`QQ 黑名单读取失败，继续使用最近一次有效配置：${error.message}`);
      this.policyError = error.message;
    }
    return this.policyCache || initial;
  }
  connect() {
    if (this.stopped) return;
    const url = new URL(this.config.wsUrl);
    if (this.config.wsToken) url.searchParams.set('access_token', this.config.wsToken);
    this.socket = this.createSocket(url);
    const socket = this.socket;
    socket.addEventListener('open', () => this.log('QQ OneBot 已连接'));
    socket.addEventListener('message', event => {
      let data;
      try { data = JSON.parse(String(event.data)); } catch { return; }
      if (data.echo && this.pending.has(data.echo)) {
        const pending = this.pending.get(data.echo); this.pending.delete(data.echo); clearTimeout(pending.timer);
        if (data.status === 'ok' && data.retcode === 0) pending.resolve(data.data);
        else pending.reject(new Error(`OneBot 动作失败 (${data.retcode})`));
      } else if (data.post_type === 'message' || (data.post_type === 'request' && data.request_type === 'friend')) {
        this.selfId=String(data.self_id||this.selfId||'');
        Promise.resolve().then(() => { if (this.peers.accepts(data)&& (data.post_type!=='message'||incomingAllowed(this.policy(),data.message_type==='group'?'group':'private',data.message_type==='group'?data.group_id:data.user_id,data.user_id))) return this.onMessage(data); }).catch(error => this.log(`QQ 处理失败：${error.message}`));
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
    const policy=this.policy();
    if(['send_private_msg','send_group_msg'].includes(action)&&!chatAllowed(policy,action==='send_group_msg'?'group':'private',params.group_id||params.user_id))throw Error('此QQ会话已被权限设置禁止');
    if(['send_private_msg','send_group_msg'].includes(action)&&policy.voiceEnabled===false&&params.message?.some?.(p=>p.type==='record'))throw Error('发送语音已关闭');
    this.peers.assertSend(action, params);
    this.beforeRequest?.();
    if (['send_private_msg', 'send_group_msg', 'set_friend_add_request'].includes(action)) this.beforeSend?.(action, params);
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('NapCat 尚未连接'));
    return new Promise((resolve, reject) => {
      const echo = randomUUID();
      const timeout=action==='send_qzone_msg'&&params.images?.length?Math.min(180000,20000+params.images.length*20000):20000;
      const timer = setTimeout(() => { this.pending.delete(echo); reject(new Error('QQ 请求超时，发送状态可能不明')); }, timeout);
      this.pending.set(echo, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ action, params, echo }));
    }).then(result => {
      if (['send_private_msg', 'send_group_msg'].includes(action)) {
        if(result?.message_id===undefined||! /^-?\d+$/.test(String(result.message_id)))throw new Error('QQ发送未返回消息ID，送达状态不明');
        const kind = action === 'send_group_msg' ? 'group' : 'private';
        const text = Array.isArray(params.message) ? params.message.map(m => m.type === 'text' ? m.data.text : `[${m.type}]`).join('') : '';
        this.onSent?.(kind, params[kind === 'group' ? 'group_id' : 'user_id'], result, text);
      }
      if(action==='get_group_member_list'&&Array.isArray(result)){this.groupAddressCache||=new Map();this.groupAddressCache.set(String(params.group_id),{time:Date.now(),selfNames:result.filter(u=>String(u.user_id)===String(this.selfId)).flatMap(u=>[u.card,u.nickname]).filter(Boolean),selfUniqueNames:result.filter(u=>String(u.user_id)===String(this.selfId)).flatMap(u=>[u.card,u.nickname]).filter(name=>name&&!result.some(u=>String(u.user_id)!==String(this.selfId)&&(u.card===name||u.nickname===name))),peerCount:result.filter(u=>String(u.user_id)!==String(u.self_id||this.selfId)&&(this.peers.isPeer(u.user_id)||String(u.card||u.nickname||'').includes('大肥鱼'))).length});}
      if (['get_friend_list', 'get_group_member_list'].includes(action) && Array.isArray(result)) return result.filter(user => !this.peers.isPeer(user.user_id) && (action!=='get_friend_list'||chatAllowed(policy,'private',user.user_id)));
      if(action==='get_group_list'&&Array.isArray(result))return result.filter(group=>chatAllowed(policy,'group',group.group_id));
      return result;
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
