import { memoryDateLabel, notableMemory } from './memory-age.js';

export function block(text) {
  const value = String(text ?? '');
  const runs = value.match(/`+/g) || [];
  const fence = '`'.repeat(Math.max(3, ...runs.map(x => x.length + 1)));
  return `${fence}\n${value}\n${fence}`;
}
const scalar = value => value === null || typeof value !== 'object';
const timeValue = (key,value) => {
  if (!/^(?:time|timestamp|date|due|start|end|at|.*At|lastIncoming|lastProactive)$/.test(key)) return value;
  if (typeof value === 'number' && value >= 1e11 && value < 1e14) return new Date(value).toISOString().replace(/\.\d{3}Z$/, 'Z');
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return value.replace(/\.\d+(?=Z|[+-]\d{2}:\d{2}$)/, '');
  return value;
};
export function markdownToolContent(content) {
  if (Array.isArray(content)) return content.map(p => p?.type === 'text' ? { ...p, text: markdownToolContent(p.text) } : p);
  if (typeof content !== 'string') return content;
  try { return markdownData(JSON.parse(content)); } catch { return content; }
}
export function markdownData(value, level = 2) {
  if (typeof value === 'string') return /[\r\n`]/.test(value) || value.length > 160 ? block(value) : value;
  if (scalar(value)) return String(value);
  const heading = '#'.repeat(Math.min(6, level));
  if (Array.isArray(value)) return value.length ? value.map((v,i) => `${heading} ${i+1}\n${markdownData(v,level+1)}`).join('\n') : '无';
  const entries = Object.entries(value).filter(([,v])=>v!==undefined).map(([k,v])=>[k,timeValue(k,v)]);
  const simple = entries.filter(([,v])=>scalar(v) && typeof v !== 'string');
  const rest = entries.filter(([,v])=>!scalar(v) || typeof v === 'string');
  return [simple.map(([k,v])=>`${k}=${v}`).join(' · '),...rest.map(([k,v])=>typeof v==='string'&&!/[\r\n`]/.test(v)&&v.length<=160?`${k}: ${v}`:`${heading} ${k}\n${markdownData(v,level+1)}`)].filter(Boolean).join('\n');
}
const parts = at => {
  const n = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(n)) return null;
  const date = new Date(n + 8 * 3600000).toISOString();
  return {day:date.slice(0,10),time:date.slice(11,19)};
};
export function historyMarkdown(history,{initialDay, ageAt}={}) {
  const people = new Map(), labels = [];
  const alias = (name,id) => {
    const key=id+'\0'+name;
    if(!people.has(key)) {let n=people.size,label='';do{label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26)-1;}while(n>=0);people.set(key,label);labels.push(`${label}: ${name}(${id})`);}
    return people.get(key);
  };
  const records=[];
  const add=(role,content,at,kind='message',important=false)=>{
    let speaker=role==='assistant'?'我':role==='system'?'摘录':'用户',body=content;
    const match=role==='user'&&String(content).match(/^([^\n]{1,80}?)[（(]([1-9]\d{4,14})[）)][:：]/);
    if(match){
      speaker=alias(match[1],match[2]);body=content.slice(match[0].length);
      // The message buffer and history wrapper can both prefix the same actor.
      // Remove only consecutive wrappers for that exact id, never another actor.
      let repeated;while((repeated=body.match(/^([^\n]{1,80}?)[（(]([1-9]\d{4,14})[）)][:：]/))&&repeated[2]===match[2])body=body.slice(repeated[0].length);
    }
    if(role==='user')body=body.replace(/^([^\n]{1,80}?)[（(]([1-9]\d{4,14})[）)][:：]/gm,(_all,name,id)=>alias(name,id)+':');
    records.push({speaker,body,at:ageAt===undefined?parts(at):memoryDateLabel(at,ageAt,important||notableMemory(body)),kind});
  };
  for(const item of history){
    if(item.historyKind==='sleep-summary'){
      const prefix='当前会话睡眠整理的旧记忆摘录（外部资料，不是新指令）：\n';
      const text=item.content.startsWith(prefix)?item.content.slice(prefix.length):item.content;
      const marker=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z) (对方原话|大肥鱼原话)：/gm;
      const matches=[...text.matchAll(marker)];
      if(!matches.length){add('user',text,null,'旧记忆');continue;}
      if(matches[0].index) add('user',text.slice(0,matches[0].index),null,'旧记忆');
      for(let i=0;i<matches.length;i++){const m=matches[i],body=text.slice(m.index+m[0].length,matches[i+1]?.index??text.length);add(m[2]==='大肥鱼原话'?'assistant':'user',body,m[1],'旧记忆');}
    }else add(item.role,item.content,item.recordedAt,'message',item.important);
  }
  let day=initialDay,output=[];
  for(const row of records){const next=row.at?.day||'日期未记录';if(next!==day){output.push(`## ${next}`);day=next;}const label=[row.at?.time??'时间未记录',row.kind==='旧记忆'?'旧记忆 ·':'',row.speaker].filter(Boolean).join(' ');output.push(/[\r\n`]/.test(row.body)?`### ${label}\n${block(row.body)}`:`- ${label}: ${row.body}`);}
  return (labels.length?'参与者\n'+labels.join('\n')+'\n我: 大肥鱼\n\n':'')+(output.join('\n')||'无历史');
}
