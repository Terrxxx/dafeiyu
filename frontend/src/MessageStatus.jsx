/* Hierarchy: current phase first, reason second, recent outcomes third.
   Reuse the existing surface/text/muted/blue/green/danger tokens and 8/16/24 spacing.
   Read-only status: no primary action, message content or model prompt is shown. */
import React, {useEffect} from 'react';
import { MessageCircle, Clock3 } from 'lucide-react';
import { Card, useData } from './shared.jsx';

const busy=new Set(['merging','queued','processing','images','generating','tools','sending']);
const bad=new Set(['failed','uncertain','partial','quota']);
const tone=phase=>phase==='replied'?'good':bad.has(phase)?'bad':busy.has(phase)?'busy':'quiet';
const time=value=>value?new Date(value).toLocaleTimeString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'';
const target=row=>row.name||(row.session?row.kind==='group'?'群聊':'私聊':'');

export default function MessageStatus({onSleep}){
  const [status,,error]=useData('/api/message-status',2000);
  useEffect(()=>{if(typeof status?.sleeping==='boolean')onSleep?.(status.sleeping);},[status?.sleeping,onSleep]);
  const current=status?.current;
  const history=(status?.recent||[]).filter(row=>row.id!==current?.id).slice(0,3);
  return <Card title="QQ 消息状态" className="message-status-card">
    <div className="message-status-current" role="status" aria-live="polite" aria-atomic="true">
      <div className="message-status-heading">
        <span className={'message-status-icon '+tone(current?.phase)}><MessageCircle size={20}/></span>
        <strong>{current?.label||(error?'暂时无法同步':'正在同步消息状态…')}</strong>
        <span className="message-status-live">每 2 秒同步</span>
      </div>
      <p>{error?'状态同步失败，稍后会自动重试。':current?.reason||'正在读取当前处理阶段。'}</p>
      {current?.session&&<div className="message-status-meta">
        <span>{busy.has(current.phase)?'当前会话':'最近结果'} · {target(current)}</span>
        {current.updatedAt&&<span>{time(current.updatedAt)} · 北京时间</span>}
        {current.phase==='merging'&&current.waitUntil&&<span>最迟 {time(current.waitUntil)} 结束本次合并</span>}
      </div>}
    </div>
    {!!status?.pending&&<div className="message-status-pending"><Clock3 size={14}/><span>{status.pending} 批消息待完成{status.active?.length>1?' · 其他会话也在排队':''}</span></div>}
    {!!history.length&&<div className="message-status-history">
      <h3>最近处理</h3>
      <ul>{history.map(row=><li key={row.id}>
        <div className="message-status-row"><span className={'message-status-label '+tone(row.phase)}>{row.label}</span><time>{time(row.updatedAt)}</time></div>
        <p>{target(row)}{target(row)?' · ':''}{row.reason}</p>
      </li>)}</ul>
    </div>}
  </Card>;
}
