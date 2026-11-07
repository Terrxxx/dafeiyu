import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from './atomic-file.js';

const descriptions={
  merging:['等待合并','正在等待连续消息，最迟到合并截止时间开始排队。'],
  queued:['等待处理','消息已合并，等待当前任务结束后处理。'],
  processing:['正在处理','正在检查会话权限、精力和消息内容。'],
  images:['正在读取图片','正在理解本批消息中的图片。'],
  generating:['正在生成回复','正在判断是否接话，并生成本轮表达。'],
  tools:['正在执行操作','正在读取资料或执行本轮需要的工具。'],
  sending:['正在发送回复','回复正在提交给 QQ，等待发送回执。'],
  replied:['已回复','QQ 已返回发送回执。'],
  silent:['本轮未回复','她判断本轮适合保持安静，原话已保留。'],
  low_energy:['低精力，未回复','本轮触发低精力静默，消息已保存。'],
  wind_down:['睡前收尾，未回复','正在逐渐减少聊天，本轮没有接话，消息已保存。'],
  sleeping:['睡眠中，不回复','睡眠期间不回复或查询；收到的消息会保存为未读，醒来后择要查看。'],
  skipped:['已跳过','消息因会话权限或用户状态变化而跳过。'],
  other_addressee:['未接话','群聊消息指向其他用户，并没有在叫她。'],
  address_uncertain:['聊天对象待确认，未接话','引用内容未核验，或群内同名对象不明确，本轮保持安静。'],
  peer:['已跳过同类消息','发送者被识别为同类账号，避免彼此循环对话。'],
  completed:['本轮已处理','本轮处理已结束，没有新的发送回执。'],
  failed:['处理失败','本轮未完成，请查看后台日志了解详情。'],
  uncertain:['发送结果待确认','发送未取得完整回执，不能确认是否送达；不会自动重发。'],
  quota:['额度限制，未完成','本轮达到模型或本地额度限制，未完成回复。'],
  partial:['部分回复已送达','已有回复送达，但后续处理未全部完成，请查看日志。'],
  interrupted:['上次处理已中断','后台已重启，上一轮未完成的状态已清除，不能据此认为已回复。'],
  idle:['等待新消息','当前没有待处理的 QQ 消息。'],
  stopped:['后台未运行','启动大肥鱼后才会接收并处理 QQ 消息。'],
  paused:['额度暂停','已达到每日用量上限，暂停处理；北京时间次日零点恢复。'],
};
const activePhases=new Set(['merging','queued','processing','images','generating','tools','sending']);
const priority={sending:0,tools:1,generating:2,images:3,processing:4,queued:5,merging:6};
const filename=directory=>path.join(directory,'qq-processing.json');
const load=directory=>{try{const file=filename(directory);if(fs.statSync(file).size>256*1024)return{};return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return{};}};
export const processingId=msg=>msg.processingId||`message:${msg.session}:${msg.id}`;
const view=entry=>{
  const phase=Object.hasOwn(descriptions,entry.phase)?entry.phase:'completed';
  const [label,reason]=descriptions[phase];
  const energy=Number.isFinite(entry.energy)?Math.max(0,Math.min(100,entry.energy)):null;
  return {id:String(entry.id||''),phase,label,reason:energy!==null&&phase==='low_energy'?`当时精力 ${energy.toFixed(2)}%，本轮触发低精力静默，消息已保存。`:reason,
    session:/^qq:(?:user|group):\d+$/.test(entry.session||'')?entry.session:'',
    name:String(entry.name||'').slice(0,80),kind:entry.kind==='group'?'group':'private',
    count:Number.isFinite(entry.count)?Math.max(1,Math.min(99,entry.count)):1,
    updatedAt:Number.isFinite(entry.updatedAt)?entry.updatedAt:null,
    waitUntil:Number.isFinite(entry.waitUntil)?entry.waitUntil:null};
};

// The agent is the sole writer. This small sidecar never rewrites memories or
// stores message text, tool arguments, credentials or model prompts.
export class QQProcessing {
  constructor(directory,{now=Date.now,onError=()=>{}}={}){
    this.directory=directory;this.now=now;this.onError=onError;
    const previous=load(directory);
    this.data={version:1,runId:randomUUID(),startedAt:now(),active:[],recent:[
      ...(previous.active||[]).map(r=>({...r,phase:'interrupted',updatedAt:now()})),...(previous.recent||[]),
    ].slice(0,10)};
    this.write();
  }
  write(){try{atomicWriteFile(filename(this.directory),JSON.stringify(this.data));}catch(error){this.onError(error);}}
  get(msg){const id=processingId(msg);return this.data.active.find(r=>r.id===id)||this.data.recent.find(r=>r.id===id);}
  update(msg,phase,extra={}){
    if(!Object.hasOwn(descriptions,phase))throw Error('未知QQ消息处理状态');
    const id=processingId(msg),before=this.get(msg);
    const entry={id,session:msg.session,kind:msg.kind,name:msg.kind==='group'?`群聊 ${msg.target}`:String(msg.name||msg.sender||'私聊'),count:msg.sources?.length||1,
      ...before,phase,updatedAt:this.now()};
    for(const key of ['count','waitUntil','energy'])if(Number.isFinite(extra[key]))entry[key]=extra[key];
    entry.confirmed=before?.confirmed===true||phase==='replied';
    this.data.active=this.data.active.filter(r=>r.id!==id);
    this.data.recent=this.data.recent.filter(r=>r.id!==id);
    if(activePhases.has(phase))this.data.active.push(entry);
    else this.data.recent.unshift(entry);
    this.data.active=this.data.active.slice(-80);this.data.recent=this.data.recent.slice(0,10);
    this.write();return entry;
  }
  fail(msg,error){const entry=this.get(msg);return this.update(msg,entry?.confirmed?'partial':['sending','uncertain'].includes(entry?.phase)?'uncertain':/额度|限额|预算|余额/.test(error?.message||'')?'quota':'failed');}
  complete(msg){const entry=this.get(msg);if(!entry||activePhases.has(entry.phase))this.update(msg,entry?.confirmed?'replied':'completed');}
}
export const messageStage=(store,msg,phase,extra)=>store.qqProcessing?.update(msg,phase,extra);
export const confirmedMessage=receipt=>!!receipt&&(receipt.message_id!==undefined&&/^-?\d+$/.test(String(receipt.message_id))||Array.isArray(receipt.messages)&&receipt.messages.length>0&&receipt.messages.every(r=>r?.message_id!==undefined&&/^-?\d+$/.test(String(r.message_id)))&&(receipt.count===undefined||receipt.count===receipt.messages.length));

export function messageStatusView(directory,{service={},sleep={},daily={},energy}={}){
  const data=load(directory),stopped=!!service.phase&&!['running','starting'].includes(service.phase);
  const active=stopped?[]:(data.active||[]).filter(r=>activePhases.has(r.phase)).map(view).sort((a,b)=>(priority[a.phase]-priority[b.phase])||(a.updatedAt-b.updatedAt));
  const recent=(data.recent||[]).slice(0,10).map(view);
  let current=active[0]||recent[0]||view({phase:'idle'});
  if(stopped)current=view({phase:'stopped'});
  else if(sleep.mode==='sleep')current=view({phase:'sleeping'});
  else if(daily.paused)current=view({phase:'paused'});
  else if(current.phase==='idle'&&Number.isFinite(energy)&&energy<25)current={...current,reason:`当前精力 ${energy.toFixed(2)}%，收到消息时可能保持安静或出现脑雾。`};
  return{current,active,recent,pending:active.length,sleeping:sleep.mode==='sleep',updatedAt:Date.now(),live:['running','starting'].includes(service.phase)};
}
