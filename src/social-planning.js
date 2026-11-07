import {chatAllowed} from './qq-policy.js';
import {memoryEpoch,assertMemoryEpoch,userBlocked} from './user-controls.js';
import {conversationPacket} from './context-packet.js';
import {executeActivityActions} from './activity-cycle.js';
import {withAICycleBudget} from './ai-cycle-budget.js';
import {dialogueView} from './proactive-dialogue.js';

export function eligibleSocialTargets(targets,tools,config){
  const policy=tools.qq?.policy?.()||config.qq;
  return targets.filter(t=>chatAllowed(policy,t.kind,t.id)&&!(t.kind==='private'&&userBlocked(tools.store||{},t.id)));
}
export function socialHints(agent,store,choices){
  const now=Date.now();
  return choices.map(t=>{
    const scope=`qq:${t.kind==='private'?'user':'group'}:${t.id}`,user=agent.feelings.data.users[t.id];
    const history=store.data.histories[scope]||[],latest=history.at(-1);
    // Third-party private conversations never enter the target chooser.
    return {...t,...(t.kind==='private'?{affinity:user?.affinity,familiarity:user?.familiarity}:{}),idleMinutes:latest?Math.max(0,Math.floor((now-Date.parse(latest.time))/60000)):null,latestRole:latest?.role};
  });
}
export function saveSocialTask({decision,target,tools,store,log}){
  if(decision.task==null)return null;
  const task=decision.task;
  if(!tools.tasks||tools.followupTarget)throw Error('本轮不允许创建定时任务');
  if(!task||typeof task.prompt!=='string'||!task.prompt.trim()||task.prompt.length>200||!Number.isFinite(task.delayMinutes)||task.delayMinutes<10||task.delayMinutes>10080)throw Error('自主定时任务须为10分钟至7天、1至200字的具体事项');
  const existing=(store.data.tasks||[]).filter(t=>t.status==='pending'&&t.autonomousTarget?.kind===target.kind&&t.autonomousTarget?.id===String(target.id));
  if(existing.length)throw Error('这个对象已有自主定时任务，等待完成后再安排');
  const result=tools.tasks.create('autonomous-social',task.prompt,task.delayMinutes,{kind:target.kind,id:String(target.id)});
  log?.('自主社交：已安排定时任务，到期再判断是否联系');return result;
}
export async function executeSocialTask(task,{agent,tools,store,config,log}){
  return withAICycleBudget(async()=>{
    tools.begin('autonomous-social');const epoch=memoryEpoch(store),target=task.autonomousTarget;
    const targets=eligibleSocialTargets(await tools.call('qq_list_targets',{}),tools,config);
    if(config.social.enabled===false||!targets.some(t=>t.kind===target.kind&&String(t.id)===target.id)||target.kind==='private'&&!agent.feelings.canContact(target.id,config.social.contactCooldownMinutes??180)){
      log('自主定时任务：当前不适合联系，本次不打扰');return '本次未联系：目标不可用或仍在冷却、未回复、暂停联系中';
    }
    const scope=`qq:${target.kind==='private'?'user':'group'}:${target.id}`;
    const context=conversationPacket(agent,{session:scope,kind:target.kind,target:target.id,sender:target.kind==='private'?target.id:'0',text:task.prompt},{recentLimit:4,retrievalLimit:1}).text;
    if(target.kind==='private')tools.proactiveTarget=target.id;
    const decision=await agent.taskJSON('执行你之前安排的联系事项，结合当前语境可不打扰。previousQuestions是今天问过的问题及对方后续发言，不一定完整回答；先承接回应，不再重问同一问题。仅返回 {"actions":[{"name":"qq_send_message","args":{"text":"最多80字","expectReply":false}}]}，最多1条；不再创建任务，不泄露私聊，不假装做了未执行的操作。',{task:task.prompt,target,context,previousQuestions:dialogueView(store,scope).slice(0,4)},{kind:'social',maxTokens:220});
    const actions=decision.actions;
    if(!Array.isArray(actions)||actions.length>1||actions.some(a=>a.name!=='qq_send_message'||typeof a.args?.text!=='string'||!a.args.text.trim()||a.args.text.length>80))throw Error('定时联系行动格式错误');
    for(const action of actions)action.args={kind:target.kind,target:target.id,text:action.args.text,expectReply:action.args.expectReply===true};
    assertMemoryEpoch(store,epoch);
    const results=await executeActivityActions({decision,allowed:['qq_send_message'],tools,store,epoch,targets:[target],log});
    return JSON.stringify({actions:results.map(r=>({name:r.name,ok:r.ok})),silent:!actions.length});
  },{maxCalls:1,label:'自主定时任务'});
}
