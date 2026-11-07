// Derived views only. Original journals, user ledgers and summaries stay intact.
const DAY=86400000,ZONE=8*3600000;
export const beijingDay=at=>{const n=typeof at==='number'?at:Date.parse(at);return Number.isFinite(n)?new Date(n+ZONE).toISOString().slice(0,10):'';};
export function sourceBody(value){
  let s=String(value||'');if(s.includes('程序核验的本批发送者身份：')&&s.includes('\n消息：'))s=s.slice(s.indexOf('\n消息：')+4);
  return s;
}
export function memoryBody(value){
  return sourceBody(value).replace(/^(?:[^\n]{1,80}?[（(]\d+[）)][:：]\s*)+/gm,'').replace(/^\[(?:记忆证据|互动记录|修订记忆|历史检索)\]\s*/,'').trim();
}
const stamp=row=>{const n=Date.parse(row.time);return Number.isFinite(n)?Math.floor(n/1000):String(row.time);};
export function uniqueMemoryRows(rows){
  const seen=new Set(),out=[];
  for(const row of rows){if(!['user','assistant'].includes(row.role)||!row.content)continue;const key=[row.role,stamp(row),memoryBody(row.content)].join('\0');if(seen.has(key))continue;seen.add(key);out.push(row);}
  return out.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
}
export function sleepMemoryRows(summaries){
  const out=[],pattern=/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z) (对方|大肥鱼)原话：/gm;
  for(const summary of summaries||[]){const text=String(summary.text||''),matches=[...text.matchAll(pattern)];for(let i=0;i<matches.length;i++){const m=matches[i];out.push({role:m[2]==='大肥鱼'?'assistant':'user',content:text.slice(m.index+m[0].length,matches[i+1]?.index??text.length).trim(),time:m[1],kind:'睡眠摘录',source:'sleep'});}}
  return out;
}
const generic=new Set(['昨天','前天','今天','昨晚','昨夜','之前','以前','记得','记忆','还记','你说','说过','自己','我们','什么','怎么','那个','这个','不是','截图','大肥鱼']);
function words(value){const s=memoryBody(value).toLowerCase(),chunks=s.match(/[a-z0-9_]{2,}|[\p{Script=Han}]{2,}/gu)||[];return [...new Set(chunks.flatMap(x=>/\p{Script=Han}/u.test(x)?[...(x.length<=8?[x]:[]),...Array.from(x).slice(1).map((_,i)=>x.slice(i,i+2))]:[x]))].filter(x=>!generic.has(x));}
const score=(body,query)=>words(query).reduce((n,w)=>n+(body.toLowerCase().includes(w)?Math.min(w.length,5):0),0);
export function memoryTimeRange(text,now=Date.now()){
  const today=beijingDay(now),shift=n=>beijingDay(Date.parse(today+'T00:00:00+08:00')-n*DAY);
  const explicit=String(text).match(/\b(20\d{2})[-/年](\d{1,2})[-/月](\d{1,2})日?\b/);
  let day;if(explicit){day=`${explicit[1]}-${explicit[2].padStart(2,'0')}-${explicit[3].padStart(2,'0')}`;if(beijingDay(Date.parse(day+'T12:00:00+08:00'))!==day)day=undefined;}
  else if(/大前天/.test(text))day=shift(3);else if(/前天/.test(text))day=shift(2);else if(/昨天|昨晚|昨夜/.test(text))day=shift(1);else if(/今天|今早|今晚/.test(text))day=today;
  return day;
}
export function selfIdentity(row){return row.role==='assistant'&&row.source!=='sleep'&&!/^(?:记得|当然记得|我记得)/.test(memoryBody(row.content))&&/(?:名字(?:想好|定好).{0,10}叫|(?:我(?:就)?叫|叫我)(?!干嘛|什么|你|他|她).{1,16}(?:[，。！？~～\n]|$)|那.{1,12}以后.{0,12}(?:名字|称呼)|我的(?:名字|称呼)(?:就)?(?:叫|是)[“「"'‘]?[\p{L}\d]{1,12})/u.test(memoryBody(row.content));}
const personal=row=>row.role==='assistant'&&row.source!=='sleep'&&/(?:我喜欢|我不喜欢|我讨厌|我想要|我答应|我保证|说好了)/.test(memoryBody(row.content));
function dialogueBlock(rows,index){
  const row=rows[index],result=[row],near=other=>other&&other.source!=='sleep'&&Math.abs(Date.parse(other.time)-Date.parse(row.time))<=5*60000&&beijingDay(other.time)===beijingDay(row.time);
  if(row.role==='assistant'&&rows[index-1]?.role==='user'&&near(rows[index-1]))result.unshift(rows[index-1]);
  if(row.role==='user'&&rows[index+1]?.role==='assistant'&&near(rows[index+1]))result.push(rows[index+1]);
  return result;
}
export function selectMemory({rows,recent=[],query='',hint='',now=Date.now(),deep=false,limit=4}){
  const sleepRefs=rows.filter(r=>r.source==='sleep');
  rows=uniqueMemoryRows(rows);const targetDay=memoryTimeRange(query,now),nameQuery=/(?:名字|起名|取名|称呼|叫什么|怎么叫)/.test(query)&&/(?:你|自己|给|起|取)/.test(query),recallQuery=!!targetDay||nameQuery||/(?:记得|之前|以前|上次|说过|答应|约定|我们聊|我们说)/.test(query);
  const broadDate=!!targetDay&&!nameQuery&&!query.replace(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?|还记得|记得|大前天|前天|昨天|昨晚|昨夜|今天|我们|咱们|发生了|聊了|聊过|说了|说过|做了|什么|哪些事|啥|[你我都吗呢呀啊了的事\s，。？！!?：:]/g,'');
  const visible=rows.filter(r=>!targetDay||beijingDay(r.time)===targetDay),recentKeys=new Set(recent.map(r=>[r.role,memoryBody(r.content)].join('\0')));
  const chosen=[],self=[],sleep=[],seen=new Set(recentKeys);let remaining=deep?3200:1800;
  const add=(destination,block,budget=true)=>{const fresh=block.filter(r=>{const key=[r.role,memoryBody(r.content)].join('\0');return !seen.has(key)&&!recent.some(x=>x.role===r.role&&memoryBody(x.content).includes(memoryBody(r.content)));});if(!fresh.length)return false;const size=fresh.reduce((n,r)=>n+r.content.length,0);if(budget&&size>remaining&&chosen.length)return false;if(budget)remaining-=size;for(const r of fresh){destination.push(r);seen.add([r.role,memoryBody(r.content)].join('\0'));}return true;};
  // Self declarations stay scoped to this conversation, with their source dates.
  const identities=(nameQuery&&targetDay?visible:rows).filter(selfIdentity).filter(r=>r.content.length<=600);
  let selfBudget=1200;
  for(const row of identities.slice(-2).reverse()){
    const block=dialogueBlock(rows,rows.indexOf(row)).filter(r=>r.content.length<=600),size=block.reduce((n,r)=>n+r.content.length,0);
    if(size<=selfBudget){add(self,block,false);selfBudget-=size;}
  }
  self.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time));
  if(!nameQuery){const last=visible.filter(personal).filter(r=>r.content.length<=Math.min(300,selfBudget)).at(-1);if(last)add(self,[last],false);}
  const ranked=visible.map((row,index)=>{const text=memoryBody(row.content);return{row,index,score:(broadDate?0:score(text,query)+(hint?Math.min(3,score(text,hint)):0))+(nameQuery&&selfIdentity(row)?100:0)+(row.kind==='boundary'?15:0)+(row.kind==='修订记忆'?10:0),size:row.content.length};}).filter(x=>!seen.has([x.row.role,memoryBody(x.row.content)].join('\0'))).sort((a,b)=>b.score-a.score||a.size-b.size||Date.parse(b.row.time)-Date.parse(a.row.time));
  let seeds=0;
  for(const item of ranked){if(seeds>=(deep?6:limit))break;if(!item.score)continue;if(add(chosen,dialogueBlock(visible,item.index)))seeds++;}
  // A date-only question needs representative conversations, not literal "昨天" matches.
  if(targetDay&&seeds<(deep?6:limit)){
    const pool=visible.map((row,index)=>({row,index})).filter(x=>x.row.source!=='sleep'&&x.row.role==='assistant'&&x.row.content.length<700);
    const slots=Math.min(deep?6:limit,pool.length);for(let i=0;i<slots&&seeds<(deep?6:limit);i++){const item=pool[Math.min(pool.length-1,Math.floor((i+.5)*pool.length/slots))];if(add(chosen,dialogueBlock(visible,item.index)))seeds++;}
  }
  // Existing sleep excerpts are fallback evidence. Prefer full source messages.
  const summaries=sleepRefs.filter(r=>!targetDay||beijingDay(r.time)===targetDay).map(r=>rows.find(x=>x.source!=='sleep'&&x.role===r.role&&stamp(x)===stamp(r)&&memoryBody(x.content).startsWith(memoryBody(r.content)))||r);
  const meaningful=summaries.filter(r=>!/^\[睡眠期间收到|^请接着刚才的话题/.test(memoryBody(r.content))&&(!nameQuery||score(memoryBody(r.content),query)>0));
  for(const row of meaningful.slice(-2)){if(row.content.length<=400)add(sleep,[row],false);}
  return{chosen:chosen.sort((a,b)=>Date.parse(a.time)-Date.parse(b.time)),self,sleep,stats:{targetDay:targetDay||null,dateMatches:targetDay?visible.length:undefined,recallQuery,nameQuery,selectedMessages:chosen.length,selfRecords:self.length,sleepRecords:sleep.length,uniqueCandidates:rows.length,evidence:chosen.length+self.length+sleep.length}};
}
