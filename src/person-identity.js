import path from 'node:path';
import {readQQProfiles} from './qq-profiles.js';
import { isQQAdmin, isPrivateSender } from './qq-policy.js';
import { sourceAddress } from './group-addressing.js';

export function qqSenderRoles(msg, policy) {
  return [...new Set((msg.sources || [msg]).map(source => String(source.sender)))]
    .filter(id => /^[1-9]\d*$/.test(id))
    .map(id => ({ id, role: isQQAdmin(policy, id) ? '我的管理员' : '普通用户' }));
}

export function qqIdentityReply(msg, policy) {
  if (msg.unreadReview || msg.kind === 'private' && !isPrivateSender(msg)) return '';
  const source = (msg.sources || [msg]).at(-1);
  if (!source || msg.kind === 'group' && sourceAddress(source, msg) !== 'self') return '';
  const question = String(source.text || '').trim().replace(/[。！!？?~～\s]+$/, '')
    .replace(/^(?:大肥鱼|鱼鱼)[，,、\s]*/, '');
  const admin = isQQAdmin(policy, source.sender);
  if (/^我(?:是不是|是)(?:你(?:的)?)?(?:管理员|主人|爸(?:爸)?)(?:吗|呀|啊)?$/.test(question)) {
    return admin ? '对呀，你就是我的管理员。' : '你不是我的管理员哦。';
  }
  if (/^(?:谁是(?:你(?:的)?)?(?:管理员|主人|爸(?:爸)?)|你(?:的)?(?:管理员|主人|爸(?:爸)?)是谁)$/.test(question)) {
    return admin ? '是你呀。' : (policy.adminUsers || []).length ? '我有自己的管理员哦。' : '我还没有设置管理员。';
  }
  return '';
}

// Only account identity travels here. No transcripts, group IDs, private
// remarks, relationship scores or inferred biographies belong in this view.
export function personIdentities(store,query,participants,controls={}){
  const profiles=store.file?readQQProfiles(path.dirname(store.file)):{};
  const active=new Set(participants.map(String)),text=String(query||'').normalize('NFKC').toLocaleLowerCase();
  const matches=[];
  for(const[id,user]of Object.entries(store.data.feelings?.users||{})){
    const control=controls[id]||{};
    if(control.blocked||control.forgottenAt&&!(user.lastIncoming>control.forgottenAt))continue;
    const nickname=String(profiles[id]?.nickname||user.qqNickname||user.name||'').trim();
    if(!nickname||nickname===id)continue;
    const publicEncounter=(user.groups||[]).some(scope=>/^qq:group:[1-9]\d*$/.test(scope));
    // Someone known solely through another private conversation stays out.
    if(!active.has(id)&&!publicEncounter)continue;
    const normalized=nickname.normalize('NFKC').toLocaleLowerCase();
    const aliases=(user.publicAliases||[]).filter(n=>typeof n==='string'&&n.length>=2&&n.length<=80);
    const mentioned=normalized.length>=2&&text.includes(normalized)||aliases.some(n=>text.includes(n.normalize('NFKC').toLocaleLowerCase()))||new RegExp(`(^|[^0-9])${id}([^0-9]|$)`).test(text);
    if(!active.has(id)&&!mentioned)continue;
    matches.push({id,nickname,...(aliases.length?{publicAliases:aliases}:{}),known:publicEncounter||user.familiarity>0,currentParticipant:active.has(id)});
  }
  return matches.sort((a,b)=>Number(b.currentParticipant)-Number(a.currentParticipant)||a.id.localeCompare(b.id)).slice(0,8);
}

export function selfContinuity(config={},participants){
  const owners=config.qq?.adminUsers||[],present=participants.map(String).filter(id=>isQQAdmin(config.qq,id));
  return{hasCaretaker:owners.length>0,...(present.length?{caretakersInThisConversation:present}:{})};
}
