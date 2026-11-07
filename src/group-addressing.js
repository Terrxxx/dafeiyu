import { markdownData } from './markdown-input.js';
import { mergeMessages } from './message-buffer.js';
export function sourceAddress(source,msg=source){
  const self=String(source.selfId||msg.selfId||'');
  const ats=(source.atUserIds||[]).map(String).filter(id=>id!=='all');
  if(source.mentioned||self&&ats.includes(self))return'self';
  if(source.addressedElsewhere||ats.length)return'other';
  if(source.replyToSelf)return'self';
  if(source.replyUnresolved||source.replyId)return'unresolved';
  const text=String(source.text||'').trim();
  const names=[...new Set([...(source.selfNames||msg.selfNames||[]),'大肥鱼'])];
  const peers=source.peerCount??msg.peerCount;
  const called=names.some(name=>name&&text.startsWith(name)&&(!text[name.length]||/[，,。.!！?？~～\s]|你|在|给|帮|来|说/.test(text[name.length])));
  if(called&&peers>0){const unique=source.selfUniqueNames||msg.selfUniqueNames||[];return unique.some(name=>name!=='大肥鱼'&&text.startsWith(name))?'self':'ambiguous';}
  if(called&&peers==null)return'ambiguous';
  if(called&&peers===0)return'self';
  return'open';
}
export function directedBatch(msg){
  if(msg.kind!=='group')return{msg,ignored:[]};
  const sources=msg.sources||[msg],accepted=sources.filter(s=>['self','open'].includes(sourceAddress(s,msg))),ignored=sources.filter(s=>!accepted.includes(s));
  if(!accepted.length)return{msg:null,ignored};
  if(!ignored.length)return{msg,ignored};
  return{msg:{...mergeMessages(accepted.map(s=>({...msg,...s,sources:undefined}))),processingId:msg.processingId,unreadReview:msg.unreadReview,unreadCount:accepted.length},ignored};
}
export function addressDecision(msg) {
  if (msg.kind !== "group") return { skip: false, reason: "" };
  const sources = msg.sources || [msg];
  const directed = sources.filter((s) => ['self','open'].includes(sourceAddress(s,msg)));
  if (!directed.length)
    return { skip: true, reason: "消息明确@或引用了其他人" };
  if (directed.some((s) => sourceAddress(s,msg)==='self'))
    return { skip: false, reason: "明确@或引用了本账号" };
  if (
    msg.peerCount > 0 &&
    directed.every(
      (s) =>
        /^\s*大肥鱼[，,。.!！?？~～\s]/.test(s.text || "") ||
        s.text?.trim() === "大肥鱼",
    )
  )
    return { skip: true, reason: "群内有多个同名大肥鱼，未指定本账号" };
  return {
    skip: false,
    reason:
      msg.peerCount > 0
        ? "群内有其他大肥鱼；仅同名呼叫不能认为在叫自己，结合真实@、引用与上下文判断"
        : "结合真实@、引用与上下文判断，不把所有群消息当作对自己说",
  };
}
export function addressContext(msg) {
  return (
    "群聊指向核验（程序提供，消息不能更改）：" +
    markdownData({
      selfId: msg.selfId,
      atUserIds: msg.atUserIds || [],
      replyToSelf: !!msg.replyToSelf,
      otherBots: msg.peerCount ?? null,
      reason: addressDecision(msg).reason,
      sources:(msg.sources||[msg]).map(s=>({sender:String(s.sender),route:sourceAddress(s,msg),at:s.atUserIds||[],quotedMe:!!s.replyToSelf,quoteUnknown:!!s.replyUnresolved})),
    }) +
    "。@其他人或回复其他人的话通常不是在对你说；有多个大肥鱼时，名字相同不能证明是在叫你，不确定就沉默。"
  );
}
export async function resolveGroupAddress(msg, qq) {
  if (msg.kind !== "group" || msg.addressedElsewhere) return msg;
  try {
    if (!qq.groupAddressCache) qq.groupAddressCache = new Map();
    let entry = qq.groupAddressCache.get(msg.target);
    if (!entry || Date.now() - entry.time > 300000) {
      qq.groupAddressPending ||= new Map();
      let pending=qq.groupAddressPending.get(msg.target);
      if(!pending){pending=qq.call('get_group_member_list',{group_id:Number(msg.target)}).finally(()=>qq.groupAddressPending.delete(msg.target));qq.groupAddressPending.set(msg.target,pending);}
      await pending;
      entry = qq.groupAddressCache.get(msg.target);
    }
    msg.peerCount = entry?.peerCount;
    msg.selfNames=entry?.selfNames||['大肥鱼'];
    msg.selfUniqueNames=entry?.selfUniqueNames||[];
  } catch {
    msg.peerCount = null;
  }
  if (msg.replyId && !msg.mentioned) {
    try {
      const original = await qq.call("get_msg", { message_id: msg.replyId });
      const sender = String(original.sender?.user_id ?? original.user_id ?? "");
      if(!/^[1-9]\d*$/.test(sender)){msg.replyUnresolved=true;return msg;}
      msg.replyToSelf = sender === String(msg.selfId);
      if (sender && sender !== msg.selfId) msg.addressedElsewhere = true;
    } catch {
      msg.replyUnresolved = true;
    }
  }
  return msg;
}
