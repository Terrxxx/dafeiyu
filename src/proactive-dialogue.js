import path from 'node:path';
import {readUserControls} from './user-controls.js';
const plain=text=>String(text||'').replace(/^[^\n]{1,80}?[（(]\d+[）)][:：]/,'').trim();
const key=text=>plain(text).toLowerCase().replace(/[\p{P}\p{S}\s]/gu,'').replace(/^(?:爸|爸爸|你|今天|最近)+/,'');
const topic=text=>/过得|忙啥|忙什么|忙些|开心.{0,4}小事|开心的事|在忙啥|今天.{0,12}(?:开心|忙|怎么样|咋样)|最近.{0,10}(?:忙|过得)/.test(text)?'daily-update':key(text);
const grams=s=>new Set(Array.from({length:Math.max(0,s.length-1)},(_,i)=>s.slice(i,i+2)));
function similar(a,b){const x=grams(key(a)),y=grams(key(b));return x.size&&y.size?2*[...x].filter(v=>y.has(v)).length/(x.size+y.size):0;}
export function dialogueView(store,scope,now=Date.now()){
 const owner=scope.match(/^qq:user:(\d+)$/)?.[1],control=owner&&store.file?readUserControls(path.dirname(store.file))[owner]||{}:{};
 if(control.blocked)return[];
 const cutoff=Math.max(control.forgottenAt||0,control.editedScopes?.[scope]||0);
 const history=(store.data.histories?.[scope]||[]).filter(r=>Date.parse(r.time)>cutoff),saved=(store.data.proactiveDialogue?.[scope]||[]).filter(r=>now-r.askedAt<86400000&&r.askedAt>cutoff);
 const result=[...saved];
 for(let i=0;i<history.length;i++){const row=history[i],at=Date.parse(row.time);if(row.role!=='assistant'||!/[？?]/.test(row.content)||now-at>=86400000||result.some(r=>key(r.text)===key(row.content)))continue;const next=owner?history.slice(i+1).find(r=>r.role==='user'):null;result.push({text:row.content.slice(0,160),topic:topic(row.content),askedAt:at,...(next?{response:plain(next.content).slice(0,120),respondedAt:Date.parse(next.time)}:{})});}
 return result.sort((a,b)=>b.askedAt-a.askedAt).slice(0,12);
}
export function assertFreshQuestion(store,scope,text,now=Date.now()){
 if(!/[？?]|(?:忙啥|忙什么|过得怎么样|进度怎样|进展如何)/.test(text))return;
 for(const row of dialogueView(store,scope,now))if(topic(text)===row.topic||similar(text,row.text)>.65)throw Error('今天已问过相近问题，先承接对方后续回应，不重复主动追问');
}
export function recordProactiveQuestion(store,scope,text){
 if(!/[？?]|忙啥|忙什么|过得怎么样/.test(text))return;
 const all=store.data.proactiveDialogue||={};all[scope]=[...(all[scope]||[]).filter(r=>Date.now()-r.askedAt<7*86400000),{text:text.slice(0,160),topic:topic(text),askedAt:Date.now()}].slice(-32);store.save();
}
export function noteDialogueResponse(store,msg,source){
 const scope=msg.session,rows=store.data.proactiveDialogue?.[scope];if(!scope?.startsWith('qq:user:')||!rows?.length)return;
 const row=[...rows].reverse().find(r=>!r.respondedAt);if(row){row.respondedAt=Date.now();row.response=String(source.text||'').slice(0,120);}
}
