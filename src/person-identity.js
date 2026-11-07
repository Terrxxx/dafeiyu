import path from 'node:path';
import {readQQProfiles} from './qq-profiles.js';

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
  const owners=(config.qq?.adminUsers||[]).map(String),present=participants.map(String).filter(id=>owners.includes(id));
  return{hasCaretaker:owners.length>0,...(present.length?{caretakersInThisConversation:present}:{})};
}
