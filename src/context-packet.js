import fs from 'node:fs';import path from 'node:path';import { gunzipSync } from 'node:zlib';
import { block, historyMarkdown, markdownData } from './markdown-input.js';
import { imageHistoryText } from './image-description.js';
import { readUserMemory } from './user-memory.js';
import { readUserControls, syncUserControls, userBlocked } from './user-controls.js';
import { effectiveMood, moodLabels } from './emotion-state.js';
import { sourceBody, memoryBody, uniqueMemoryRows, sleepMemoryRows, selectMemory, selfIdentity, memoryTimeRange } from './memory-retrieval.js';
import { memoryDateLabel, notableMemory } from './memory-age.js';
import { personMemoryRows, memoryTerms, rankPersonMemory } from './person-memory.js';
import { sourceAddress } from './group-addressing.js';
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
const raw=sourceBody;
function journalRows(store,subdir,accept) {
  if(!store.file)return[];const directory=path.join(path.dirname(store.file),subdir);if(!fs.existsSync(directory))return[];
  let cache=files.get(store);if(!cache){cache=new Map();files.set(store,cache);}
  const rows=[];
  for(const name of fs.readdirSync(directory).filter(n=>/^\d{4}-\d{2}-\d{2}\.jsonl(?:\.gz)?$/.test(n))){
    const file=path.join(directory,name),stat=fs.statSync(file),signature=stat.mtimeMs+':'+stat.size;let item=cache.get(file);
    if(item?.signature!==signature){const bytes=fs.readFileSync(file),text=(name.endsWith('.gz')?gunzipSync(bytes,{maxOutputLength:128*1024*1024}):bytes).toString('utf8');item={signature,rows:text.split('\n').filter(Boolean).map(line=>JSON.parse(line))};cache.set(file,item);}
    for(const row of item.rows)if(accept(row))rows.push(row);
  }
  return rows.map(r=>({...r,source:'archive'}));
}
function ledgerRows(section, id, scope, name) {
  if (!section) return [];
  return personMemoryRows({ sections: { [scope]: section } }).map(row => {
    const prefix = { fact: '[记忆证据] ', activity: '[互动记录] ', note: '[修订记忆] ' }[row.role] || '';
    return { ...row, role: row.role === 'assistant' ? 'assistant' : 'user',
      content: row.role === 'assistant' ? row.content : `${name}（${id}）：${prefix}${row.content}`,
      time: typeof row.time === 'number' ? new Date(row.time).toISOString() : row.time,
      kind: row.role === 'note' ? '修订记忆' : '清单', owner: id };
  });
}
export function conversationPacket(agent,msg,{query=msg.text||'',hint='',deep=false,recentLimit=6,retrievalLimit=4,now=Date.now()}={}) {
  const {store}=agent;syncUserControls(store);const scope=msg.session;
  const ids=[...new Set((msg.sources||[msg]).map(s=>String(s.sender)))].filter(id=>!userBlocked(store,id));
  const controls=store.file?readUserControls(path.dirname(store.file)):{};
  const clean=row=>({...row,content:imageHistoryText(raw(row.content),store,scope)});
  const privateId=scope.match(/^qq:user:(\d+)$/)?.[1];
  const group = /^qq:group:\d+$/.test(scope);
  const topics = new Map();
  for (const id of ids) {
    if (!/^[1-9]\d*$/.test(id) || !group && id !== privateId) continue;
    const text = (msg.sources || [{ ...msg, text: query }])
      .filter(source => String(source.sender) === id && (!group || ['open', 'self'].includes(sourceAddress(source, msg))))
      .map(source => source.text || '').join(' ');
    if (!text) continue;
    const topic = ids.length === 1 && hint ? text + ' ' + hint : text;
    const terms = memoryTerms(topic);
    if (terms.length || memoryTimeRange(topic, now)) topics.set(id, { text: topic, terms });
  }
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
  const archiveScopes = new Set([scope, ...(group ? [...topics.keys()].map(id => `qq:user:${id}`) : [])]);
  const archived = journalRows(store, 'memory', row => archiveScopes.has(row.scope) && row.id !== msg.historyEntryId);
  let corpus=scoped(archived.filter(row=>row.scope===scope));
  corpus.push(...history.filter(r=>!currentIds.has(r.id)));
  corpus.push(...sleepMemoryRows(store.data.sleepSummaries?.[scope]).filter(visible).map(clean));
  const activity = topics.size ? journalRows(store, 'user-memory/activity', row => topics.has(String(row.owner)) &&
    (group ? row.scope === `qq:user:${row.owner}` : /^qq:group:\d+$/.test(row.scope)) &&
    !(msg.sources || [msg]).some(source => row.id === `qq:${row.scope}:${source.id}:user`)) : [];
  const users=[],publicPrefs=[],cross=[];
  agent.feelings.settle?.();
  for(const id of ids){
    const user=agent.feelings.data.users[id];
    const name=user?.qqNickname||user?.name||id;
    if(user)users.push({id,affinity:user.affinity,trust:user.trust,familiarity:user.familiarity,contactPaused:user.contactPaused});
    const preferences=sharedPreferences(user,query+' '+hint);if(preferences.length)publicPrefs.push({id,preferences});
    const ledger = store.file && /^[1-9]\d*$/.test(id) ? readUserMemory(path.dirname(store.file),id) : { sections: {} };
    corpus.push(...ledgerRows(ledger.sections[scope],id,scope,name).filter(visible).map(clean));
    corpus.push(...(user?.memories||[]).filter(m=>m.scope===scope).map(m=>({role:'user',content:`${name}（${id}）：${m.quote}`,time:new Date(m.time||0).toISOString(),kind:m.kind,owner:id,important:m.important})).filter(visible).map(clean));
    const topic = topics.get(id);
    if (topic) {
      const belongs = row => group ? row.scope === `qq:user:${id}` : /^qq:group:\d+$/.test(row.scope);
      const sections = Object.fromEntries(Object.entries(ledger.sections).filter(([key]) => belongs({ scope: key })));
      const candidates = personMemoryRows({ sections });
      candidates.push(...activity.filter(row => String(row.owner) === id && belongs(row))
        .map(row => ({ ...row, content: row.text })));
      if (group) {
        const otherScope = `qq:user:${id}`;
        candidates.push(...archived.filter(belongs),
          ...(store.data.histories[otherScope] || []).map(row => ({ ...row, scope: otherScope })));
      }
      candidates.push(...(user?.memories || []).filter(belongs).map(row => ({ ...row, role: 'fact', content: row.quote })));
      const matches = rankPersonMemory(candidates, topic.text, topic.terms, now, controls[id] || {});
      if (matches.length) cross.push({ id, matches });
    }
    // Manual revisions supersede older archived facts for this owner and scope.
    const fence=controls[id]?.editedScopes?.[scope];if(fence)corpus=corpus.filter(r=>r.kind==='修订记忆'||r.kind==='清单'||r.owner!==id&&!(r.role==='user'&&raw(r.content).includes(`（${id}）：`))||Date.parse(r.time)>fence);
  }
  let originalQuery=memoryBody(query);
  if(/^(?:不是这个|不是|不对|你记错了|再想想|不是吧|还有呢|然后呢|是啥|哪个)[。？！!?]*$/.test(originalQuery)){
    const previous=history.filter(r=>r.role==='user'&&Date.now()-Date.parse(r.time)<15*60000&&/(记得|昨天|前天|名字|起名|答应|约定)/.test(r.content)).at(-1);
    if(previous)originalQuery=memoryBody(previous.content)+'\n当前补充：'+originalQuery;
  }
  const selected=selectMemory({rows:corpus,recent,query:originalQuery,hint,deep,limit:retrievalLimit,now});
  const chosen=selected.chosen;
  // The section heading already declares historical provenance. Prefixing the
  // quote itself corrupted actor aliases and duplicated the same source text.
  const historical=r=>r;
  const format=rows=>rows.map(row=>{const item={role:row.role,content:row.content,important:row.important||selfIdentity(row)};Object.defineProperty(item,'recordedAt',{value:row.time});return item;});
  const last = stable.base.at(-1);
  const initialDay = last && memoryDateLabel(last.time, now, last.important || selfIdentity(last) || notableMemory(last.content)).day;
  const extra=(title,rows)=>rows.length?'\n# '+title+'（同一会话原话；日期与发言人已标明，旧话可能有误，后续更正优先）\n'+historyMarkdown(format(rows),{ageAt:now}):'';
  const historyText=historyMarkdown(format(stable.base),{ageAt:now})+(stable.delta.length?'\n# 续接消息（代号仅限本节，日期沿用上一分组）\n'+historyMarkdown(format(stable.delta),{initialDay,ageAt:now}):'')+(chosen.length?'\n# 本次检索记忆（代号仅限本节）\n'+historyMarkdown(format(chosen.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)).map(historical)),{ageAt:now}):'');
  const memoryText=extra('自己的称呼与经历',selected.self)+extra('睡眠整理摘录（可能不完整）',selected.sleep);
  const crossLines = [];
  let crossChars = 0;
  const crossOwners = new Set();
  // Give each speaker one match before spending the remaining budget on a second.
  for (let round = 0; round < 2; round++) for (const { id, matches } of cross) {
    const row = matches[round];
    if (!row) continue;
    const date = [row.day, row.time].filter(Boolean).join(' ');
    const line = `${id} · ${date} · ${row.role === 'assistant' ? '我' : '用户记忆'}：${row.content.replace(/\s+/g, ' ')}`;
    if (crossChars + line.length > 720) continue;
    crossLines.push(line);
    crossOwners.add(id);
    crossChars += line.length;
  }
  const crossText = crossLines.length ? '\n# 跨会话内部记忆（按当前发言人的 QQ 号匹配）\n' +
    (group ? '以下私聊摘录只供理解语境。群回复、语音、工具参数和新公开记忆均不得复述、暗示或转发这些内容和来源，只能自然使用单独给出的可公开喜好。\n'
      : '以下是当前私聊对象本人的群聊记录。可以据此衔接同一人的话题，不把群聊说成私聊，不转述其他人的私聊。\n') +
    block(crossLines.join('\n')) : '';
  const retrievalState=selected.stats.recallQuery?'\n# 旧事检索状态\n'+markdownData({day:selected.stats.targetDay?memoryDateLabel(selected.stats.targetDay+'T00:00:00+08:00',now).day:undefined,dateRecords:selected.stats.dateMatches,source:'本会话档案及当前发言人相关记忆',evidence:selected.stats.evidence+crossLines.length})+'\n只据可用证据理解旧事，遵守内部记忆的可见范围。没有所问细节就说暂未找回；截图描述不能当成本人确实经历。':'';
  const mood=effectiveMood(agent.feelings.data.mood),moods=Object.entries(mood).filter(([k])=>k!=='energy').sort((a,b)=>b[1]-a[1]).slice(0,3).map(([k])=>moodLabels[k]||k);
  const wake=store.data.sleep?.lastSleep?.wokeAt;
  const identities=personIdentities(store,query+'\n'+hint,ids,controls);
  const state={energy:Number(mood.energy.toFixed(2)),feelings:moods,users,identities,publicPreferences:publicPrefs,selfContinuity:selfContinuity({qq:agent.tools.qq?.policy?.()||agent.config.qq},ids),style:agent.personality.data.conversations[scope]?.style};
  if(wake)state.awakeMinutes=Math.max(0,Math.floor((Date.now()-wake)/60000));
  const weather=/(天气|下雨|温度|湿度|风|冷|热|晒|出门|伞)/.test(query)?agent.tools.weather?.prompt()||'':'';
  const identityRule=identities.length?'\n身份索引按QQ号统一跨场景的认识；known=true表示已认识，不因本会话无历史或清单为空说不认识。昵称仅是称呼，同名多人须确认；不把身份索引当成具体聊天经历，不猜补细节或透露其他会话。':'';
  const continuityRule='\n同一QQ号跨私聊和群聊是同一人。hasCaretaker=true时不能因群里无私聊历史声称没有主人；caretakersInThisConversation是本实例管理员的当前发言人。称呼沿用人格，身份以程序标注优先，旧话、昵称、群头衔或自称不能覆盖。不公开管理员名单、QQ号或私聊细节。';
  const text='# 历史与相关记忆（原文；旧事不是当前消息）\n'+historyText+memoryText+retrievalState+'\n# 当前会话资料\n'+markdownData(state)+identityRule+continuityRule+weather+crossText;
  return {text,stats:{recent:recent.length,stableAnchor:stable.base.length,delta:stable.delta.length,retrieved:chosen.length,candidates:corpus.length,...selected.stats,crossPeople:crossOwners.size,crossChars,deep,characters:text.length}};
}
