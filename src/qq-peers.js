import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { DATA_ROOT } from './config.js';
export const peerDigest = id => createHash('sha256').update('dafeiyu-qq-peer-v1:'+String(id)).digest('hex');
// The manager publishes only hashed QQ identities, never tenant names or credentials.
// Read on every boundary so newly registered peers are recognized without restarting agents.
export class QQPeers {
  constructor({file=path.join(DATA_ROOT,'.qq-peers.json'),managed=!!process.env.DAFEIYU_MANAGED}={}) { Object.assign(this,{file,managed}); }
  snapshot() {
    try { const value=JSON.parse(fs.readFileSync(this.file,'utf8')); if(value.version!==1||!Array.isArray(value.peers)||value.peers.some(x=>!/^[a-f0-9]{64}$/.test(x)))throw Error('Invalid peer registry');return new Set(value.peers); }
    catch { return this.managed ? null : new Set(); }
  }
  isPeer(id) {const peers=this.snapshot();return peers===null||peers.has(peerDigest(id));}
  isBiliPeer(id){try{const value=JSON.parse(fs.readFileSync(this.file,'utf8'));return (value.biliPeers||[]).includes(peerDigest('bili:'+String(id)));}catch{return this.managed;}}
  accepts(event) {return !this.isPeer(event.user_id);}
  assertSend(action,params) {
    if(action==='send_private_msg'&&this.isPeer(params.user_id))throw Error('已阻止向同类大肥鱼发送私聊');
    if(action==='send_group_msg')for(const part of Array.isArray(params.message)?params.message:[]){
      if(part.type==='at'&&(part.data?.qq==='all'||this.isPeer(part.data?.qq)))throw Error('已阻止群发@全体或@同类大肥鱼');
      if(part.type==='text'&&/\[CQ:at,/i.test(part.data?.text||''))throw Error('请使用结构化@消息');
    }
    if(['send_private_msg','send_group_msg'].includes(action)&&!Array.isArray(params.message))throw Error('发送消息必须使用结构化消息');
  }
}
