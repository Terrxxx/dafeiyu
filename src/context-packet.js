import fs from 'node:fs';import path from 'node:path';import { gunzipSync } from 'node:zlib';
import { historyMarkdown, markdownData } from './markdown-input.js';
import { imageHistoryText } from './image-description.js';
import { readUserMemory } from './user-memory.js';
import { readUserControls, syncUserControls, userBlocked } from './user-controls.js';
import { effectiveMood, moodLabels } from './emotion-state.js';
import { sourceBody, memoryBody, uniqueMemoryRows, sleepMemoryRows, selectMemory } from './memory-retrieval.js';
import {personIdentities,selfContinuity} from './person-identity.js';
import {sharedPreferences} from './feelings.js';
const files=new WeakMap(),anchors=new WeakMap();
const rowKey=row=>row.id||JSON.stringify([row.time,row.role,row.content]);
function stableRecent(store,scope,history,limit,epoch){
  if(limit<=0)return{base:[],delta:[]};
  if(limit<6)return{base:history.slice(-limit),delta:[]};
  let sessions=anchors.get(store);if(!sessions){sessions=new Map();anchors.set(store,sessions);}
  let anchor=sessions.get(scope),base,delta;
  if(anchor&&anchor.epoch===epoch){const start=history.findIndex(r=>rowKey(r)===anchor.keys[0]);if(start>=0){base=history.slice(start,start+anchor.keys.length);if(base.every((r,i)=>rowKey(r)===anchor.keys[i]&&r.content===anchor.contents[i]))delta=history.slice(start+base.length);}}
  if(!base||!delta||delta.length>4){base=history.slice(-limit);delta=[];anchor={epoch,keys:base.map(rowKey),contents:base.map(r=>r.content)};sessions.set(scope,anchor);if(sessions.size>128)sessions.delete(sessions.keys().next().value);}
  return{base,delta};
}
const lastDay=rows=>{const at=Date.parse(rows.at(-1)?.time);return Number.isFinite(at)?new Date(at+8*3600000).toISOString().slice(0,10):undefined;};
const raw=sourceBody;
function archives(store,scope) {
  if(!store.file)return[];const directory=path.join(path.dirname(store.file),'memory');if(!fs.existsSync(directory))return[];
  let cache=files.get(store);if(!cache){cache=new Map();files.set(store,cache);}
  const rows=[];
  for(const name of fs.readdirSync(directory).filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl(?:\.gz)?$/.test(n))){
    const file=path.join(directory,name),stat=fs.statSync(file),signature=stat.mtimeMs+':'+stat.size;let item=cache.get(file);
    if(item?.signature!==signature){const bytes=fs.readFileSync(file),text=(name.endsWith('.gz')?gunzipSync(bytes,{maxOutputLength:128*1024*1024}):bytes).toString('utf8');item={signature,rows:text.split('\n').filter(Boolean).map(line=>JSON.parse(line))};cache.set(file,item);}
    for(const row of item.rows)if(row.scope===scope)rows.push(row);
  }
  return rows.map(r=>({...r,source:'archive'}));
}
function ledgerRows(store,id,scope,name) {
  if(!store.file)return[];const section=readUserMemory(path.dirname(store.file),id).sections[scope];if(!section?.text)return[];
  const rows=[];let current;const flush=()=>{if(current){rows.push(current);current=null;}};
  for(const line of section.text.split('\n')){
    if(/^## \d{4}-\d{2}-\d{2} · 记忆清单$/.test(line)){flush();continue;}
    const m=line.match(/^- (用户|大肥鱼|已确认记忆|与用户的互动)[（(](\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)[）)][:：](.*)$/);
    if(m){flush();const body=(m[1]==='已确认记忆'?'[记忆证据] ':m[1]==='与用户的互动'?'[互动记录] ':'')+m[3];current={role:m[1]==='大肥鱼'?'assistant':'user',content:m[1]==='大肥鱼'?body:`${name}（${id}）：${body}`,time:m[2],kind:'清单',owner:id};}
    else if(current&&line.startsWith('  '))current.content+='\n'+line.slice(2);
    else if(line.trim()){flush();rows.push({role:'user',content:`${name}（${id}）：[修订记忆] ${line}`,time:new Date(section.updatedAt||0).toISOString(),kind:'修订记忆',owner:id});}
  }flush();return rows;
}
export function conversationPacket(agent,msg,{query=msg.text||'',hint='',deep=false,recentLimit=6,retrievalLimit=4}={}) {
  const {store}=agent;syncUserControls(store);const scope=msg.session;
  const ids=[...new Set((msg.sources||[msg]).map(s=>String(s.sender)))].filter(id=>!userBlocked(store,id));
  const controls=store.file?readUserControls(path.dirname(store.file)):{};
  const clean=row=>({...row,content:imageHistoryText(raw(row.content),store,scope)});
  const privateId=scope.match(/^qq:user:(\d+)$/)?.[1];
  const visible=row=>{
    const speaker=row.owner||raw(row.content).match(/^[^\n]{1,80}?[（(](\d+)[）)][:：]/)?.[1]||privateId;
    const owners=[...new Set([speaker,...(row.owners||[])].filter(Boolean))];
    if(!privateId&&row.source==='sleep'&&row.role==='user'&&!speaker)return false;
    return owners.every(id=>{const c=controls[id]||{};return !c.blocked&&(!c.forgottenAt||Date.parse(row.time)>c.forgottenAt)&&(!c.editedScopes?.[scope]||['清单','修订记忆'].includes(row.kind)||Date.parse(row.time)>c.editedScopes[scope]);});
  };
  const scoped=rows=>{let last;return uniqueMemoryRows(rows.map(clean)).map(row=>{
    if(row.role==='user')last=row;
    if(row.role==='assistant'&&!privateId&&last&&Date.parse(row.time)-Date.parse(last.time)<=5*60000)return{...row,owners:[...String(last.content).matchAll(/[（(](\d+)[）)][:：]/g)].map(m=>m[1])};
    return row;
  }).filter(visible).map(clean);};
  const history=scoped((store.data.histories[scope]||[]).filter(row=>row.id!==msg.historyEntryId));
  // Keep whole messages. Large messages may exceed the soft target; never truncate their source text.
  const stable=stableRecent(store,scope,history,recentLimit,JSON.stringify(controls));
  const recent=[...stable.base,...stable.delta],currentIds=new Set(recent.map(r=>r.id));
  let corpus=scoped(archives(store,scope).filter(row=>row.id!==msg.historyEntryId));
  corpus.push(...history.filter(r=>!currentIds.has(r.id)));
  corpus.push(...sleepMemoryRows(store.data.sleepSummaries?.[scope]).filter(visible).map(clean));
  const users=[],publicPrefs=[];
  agent.feelings.settle?.();
  for(const id of ids){
    const user=agent.feelings.data.users[id];if(!user)continue;
    const name=user.qqNickname||user.name||id;
    users.push({id,affinity:user.affinity,trust:user.trust,familiarity:user.familiarity,contactPaused:user.contactPaused});
    const preferences=sharedPreferences(user,query+' '+hint);if(preferences.length)publicPrefs.push({id,preferences});
    corpus.push(...ledgerRows(store,id,scope,name).filter(visible).map(clean));
    corpus.push(...(user.memories||[]).filter(m=>m.scope===scope).map(m=>({role:'user',content:`${name}（${id}）：${m.quote}`,time:new Date(m.time||0).toISOString(),kind:m.kind,owner:id})).filter(visible).map(clean));
    // Manual revisions supersede older archived facts for this owner and scope.
    const fence=controls[id]?.editedScopes?.[scope];if(fence)corpus=corpus.filter(r=>r.kind==='修订记忆'||r.kind==='清单'||r.owner!==id&&!(r.role==='user'&&raw(r.content).includes(`（${id}）：`))||Date.parse(r.time)>fence);
  }
  let originalQuery=memoryBody(query);
  if(/^(?:不是这个|不是|不对|你记错了|再想想|不是吧|还有呢|然后呢|是啥|哪个)[。？！!?]*$/.test(originalQuery)){
    const previous=history.filter(r=>r.role==='user'&&Date.now()-Date.parse(r.time)<15*60000&&/(记得|昨天|前天|名字|起名|答应|约定)/.test(r.content)).at(-1);
    if(previous)originalQuery=memoryBody(previous.content)+'\n当前补充：'+originalQuery;
  }
  const selected=selectMemory({rows:corpus,recent,query:originalQuery,hint,deep,limit:retrievalLimit});
  const chosen=selected.chosen;
  // The section heading already declares historical provenance. Prefixing the
  // quote itself corrupted actor aliases and duplicated the same source text.
  const historical=r=>r;
  const format=rows=>rows.map(row=>{const item={role:row.role,content:row.content};Object.defineProperty(item,'recordedAt',{value:row.time});return item;});
  const extra=(title,rows)=>rows.length?'\n# '+title+'（同一会话原话；日期与发言人已标明，旧话可能有误，后续更正优先）\n'+historyMarkdown(format(rows),{initialDay:lastDay(recent)}):'';
  const historyText=historyMarkdown(format(stable.base))+(stable.delta.length?'\n# 续接消息（代号仅限本节，日期沿用上一分组）\n'+historyMarkdown(format(stable.delta),{initialDay:lastDay(stable.base)}):'')+(chosen.length?'\n# 本次检索记忆（代号仅限本节）\n'+historyMarkdown(format(chosen.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)).map(historical)),{initialDay:lastDay(recent)}):'');
  const memoryText=extra('自己的称呼与经历',selected.self)+extra('睡眠整理摘录（可能不完整）',selected.sleep);
  const retrievalState=selected.stats.recallQuery?'\n# 旧事检索状态\n'+markdownData({day:selected.stats.targetDay||undefined,dateRecords:selected.stats.dateMatches,source:'当前会话存档、用户清单与睡眠摘录',evidence:selected.stats.evidence})+'\n只据给出的旧话回答。没有所问细节就说暂未找回，不用“记得”掩盖缺证据；截图描述不能当成本人确实经历。':'';
  const mood=effectiveMood(agent.feelings.data.mood),moods=Object.entries(mood).filter(([k])=>k!=='energy').sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>moodLabels[k]||k);
  const wake=store.data.sleep?.lastSleep?.wokeAt;
  const identities=personIdentities(store,query+'\n'+hint,ids,controls);
  const state={energy:Number(mood.energy.toFixed(2)),feelings:moods,users,identities,publicPreferences:publicPrefs,selfContinuity:selfContinuity(agent.config,ids),style:agent.personality.data.conversations[scope]?.style};
  if(wake)state.awakeMinutes=Math.max(0,Math.floor((Date.now()-wake)/60000));
  const weather=/(天气|下雨|温度|湿度|风|冷|热|晒|出门|伞)/.test(query)?agent.tools.weather?.prompt()||'':'';
  const identityRule=identities.length?'\n身份索引按QQ号统一跨场景的认识；known=true表示已认识，不因本会话无历史或清单为空说不认识。昵称仅是称呼，同名多人须确认；不把身份索引当成具体聊天经历，不猜补细节或透露其他会话。':'';
  const continuityRule='\n同一QQ号跨私聊和群聊是同一人，关系和可公开喜好不因场景重置。selfContinuity来自实例配置，不是私聊，优先于旧回答和截图中的否认：hasCaretaker=true时不能因群里无私聊历史声称没有主人/照顾者；caretakersInThisConversation标出当前参与者中的照顾者，称呼沿用人格与已知偏好，不当陌生人。不向无关人公开配置名单、其他QQ号、私聊原话和相处细节；未提供具体经历不猜。';
  const text='# 历史与相关记忆（原文；旧事不是当前消息）\n'+historyText+memoryText+retrievalState+'\n# 当前会话资料\n'+markdownData(state)+identityRule+continuityRule+weather;
  return {text,stats:{recent:recent.length,stableAnchor:stable.base.length,delta:stable.delta.length,retrieved:chosen.length,candidates:corpus.length,...selected.stats,deep,characters:text.length}};
}
