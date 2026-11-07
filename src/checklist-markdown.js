import { historyMarkdown } from './markdown-input.js';
import { imageHistoryText } from './image-description.js';
export function checklistMarkdown(text, person, store, scope) {
  if(!text)return '';
  const rows=[];let current,recognized=0;
  const flush=()=>{if(current){rows.push(current);current=null;}};
  for(const line of String(text).split('\n')){
    if(/^## \d{4}-\d{2}-\d{2} · 记忆清单$/.test(line)){flush();continue;}
    const match=line.match(/^- (用户|大肥鱼|已确认记忆|与用户的互动)[（(](\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)[）)][:：](.*)$/);
    if(match){flush();recognized++;const role=match[1]==='大肥鱼'?'assistant':'user';let body=imageHistoryText(match[3],store,scope);if(match[1]==='已确认记忆')body='已确认记忆：'+body;if(match[1]==='与用户的互动')body='互动：'+body;
      current={role,content:role==='user'?`${person.name}（${person.id}）：${body}`:body};Object.defineProperty(current,'recordedAt',{value:match[2]});continue;}
    if(current&&line.startsWith('  ')){current.content+='\n'+line.slice(2);continue;}
    if(line.trim()){flush();rows.push({role:'system',content:line});}
  }
  flush();
  // Free-form notes remain verbatim; partial excerpts keep unmatched lines as notes.
  return recognized?historyMarkdown(rows):String(text);
}
