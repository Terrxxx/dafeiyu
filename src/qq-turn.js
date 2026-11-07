import { incomingAllowed } from './qq-policy.js';
import { acceptedSource, assertMemoryEpoch } from './user-controls.js';
import { chatFamilies } from './tool-routing.js';
import { conversationPacket } from './context-packet.js';
import { explicitVideoRequest, replyToVideoRequest } from './qq-video-request.js';
import { operationToolNames } from './tool-routing.js';
import {publicationIntent,publicationPromise,handlePublication} from './publication-turn.js';
import { qzoneReadIntent, readRequestedSpace, qzoneReadMaterial } from './qzone-read-turn.js';
import {messageStage} from './qq-processing.js';
import {sourceAddress} from './group-addressing.js';
import {crossSendIntent,handleCrossSend,crossSendPromise} from './qq-cross-send.js';
export async function handlePlannedQQ(msg,key,{agent,store,tools,qq,throttle,log},pictures,energyMode,epoch) {
  // Save source text before any model call, including silent turns and provider failures.
  store.appendHistory(msg.session,'user',`${msg.name||msg.sender}（${msg.sender}）：${msg.text}${pictures?'\n'+pictures:''}`,agent.config.agent.historyMessages);
  msg={...msg,historyEntryId:store.data.histories[msg.session].at(-1).id};
  tools.begin(msg.session,{...msg,key,memoryEpoch:epoch});
  for(const source of msg.sources||[msg])tools.sleep?.noteChat?.(`qq-incoming:${msg.session}:${source.id}`,{kind:msg.kind,target:msg.target,direction:'incoming'});
  const validate=()=>{assertMemoryEpoch(store,epoch);tools.sleep?.assertAwake();if((msg.sources||[msg]).some(s=>!incomingAllowed(qq.policy?.()||agent.config.qq||{},msg.kind,msg.target,s.sender)||!acceptedSource(store,s,msg.receivedAt)))throw Error('会话权限已变化，本轮回复已取消');};
  const authority=tools.privateAuthority();
  const admin=authority?.live&&!authority.restricted;
  const crossSend=admin&&energyMode!=='fog'?crossSendIntent(msg,store):null;
  if(crossSend){
    messageStage(store,msg,'tools');
    const text=await handleCrossSend(crossSend,msg,{agent,store,tools,log,validate});
    await throttle.wait(msg.session);validate();await tools.call('qq_reply_current',{text});return;
  }
  const spaceIntent=admin&&energyMode!=='fog'?qzoneReadIntent(msg,store):null;
  const publication=admin?publicationIntent(msg,store):null;
  if(publication&&!spaceIntent&&['publish','status'].includes(publication.mode)&&energyMode!=='fog'){
    const text=await handlePublication(publication,msg,{agent,store,tools,log,validate});
    await throttle.wait(msg.session);validate();await tools.call('qq_reply_current',{text});return;
  }
  const video=admin&&energyMode!=='fog'&&!(msg.images||[]).length?explicitVideoRequest(msg,store):null;
  if(video)return replyToVideoRequest(video,msg,key,{agent,store,tools,throttle,log,validate});
  const qzoneRead=spaceIntent?await readRequestedSpace(spaceIntent,{tools,log,validate}):null;
  log('QQ：合并判断与回复生成');
  messageStage(store,msg,'generating');
  const result=await agent.planQQTurn(msg,{pictures,energyMode,qzoneRead});
  if(!admin&&crossSendIntent(msg,store)?.mode==='send')result.reply='跨群发消息这件事，要由我的管理员在私聊里发起。';
  if(admin&&crossSendPromise(result.reply||'')){result.reply='这轮还没有取得跨群发送回执，暂时不能说已经发出。';}
  if(msg.kind==='group'&&(result.engage===false||!(msg.sources||[msg]).some(s=>sourceAddress(s,msg)==='self')&&result.engage!==true)){
    result.reply='';result.image='';result.voice='';result.capabilities=[];result.summary='群聊未确认适合本账号参与，保持安静';
  }
  validate();
  try { agent.feelings.applyChat(msg,{users:Array.isArray(result.users)?result.users:[]},'chat:'+key); }
  catch(error){store.audit('chat-analysis-rejected',{reason:error.message});}
  if(Array.isArray(result.style)&&result.style.length){agent.personality.applyReflection(msg.session,result.style,(msg.sources||[msg]).map(s=>({role:'user',content:s.text||''})));}
  const families=Array.isArray(result.capabilities)?[...new Set(result.capabilities)].filter(x=>[...chatFamilies,'qq'].includes(x)):[];
  if(spaceIntent?.operations&&qzoneRead?.state==='read'&&qzoneRead.count>0&&!families.includes('qzone'))families.push('qzone');
  if(admin&&families.length&&energyMode!=='fog'){
    messageStage(store,msg,'tools');
    log('QQ：进入工具流程，将按需追加请求');
    tools.chatFamilies=families.filter(x=>x!=='qq');
    tools.chatToolNames=operationToolNames(families,msg.text);
    tools.deferVideoAnalysis=true;
    const packet=conversationPacket(agent,msg);
    const publicationsBefore=new Set(Object.keys(store.data.actions).filter(k=>k.startsWith('qzone:')||k.startsWith('bili-dynamic:')));
    const text=await agent.run(msg.session,'执行当前要求：'+msg.text+'\n仅使用本任务已开放的工具，资料已读取就复用；不为情绪和偏好单独调用工具。操作成功后仅给简短结果，不重复发送。',true,{remember:false,history:false,taskContext:packet.text+qzoneReadMaterial(qzoneRead),replySummary:true});
    validate();
    const confirmedPublication=Object.entries(store.data.actions).some(([k,a])=>(k.startsWith('qzone:')||k.startsWith('bili-dynamic:'))&&!publicationsBefore.has(k)&&a.state==='sent');
    const response=crossSendPromise(text)&&!tools.crossSendConfirmed?.some(r=>r.kind==='group')?'这轮还没有取得跨群发送回执，暂时不能说已经发出。':publication&&publicationPromise(text)&&!confirmedPublication?'这轮还没有取得发布成功回执。要提交发布，请明确说“发出去”。':text;
    if(response.trim()&&!tools.currentTextAttempted){await throttle.wait(msg.session);validate();await tools.call('qq_reply_current',{text:response});}
    log('QQ：工具流程已结束，以回执为准');return;
  }
  const reply=publication&&publicationPromise(result.reply||'')?'这轮还没有取得发布成功回执。要提交发布，请明确说“发出去”。':typeof result.reply==='string'?result.reply.trim():'';
  const image=energyMode!=='fog'&&typeof result.image==='string'?result.image:'';
  const voice=energyMode!=='fog'&&typeof result.voice==='string'?result.voice.trim():'';
  agent.reportDecision(msg.session,result.summary||((reply||image||voice)?'已生成当前会话表达':'选择安静'),'合并回复');
  if(!reply&&!image&&!voice){messageStage(store,msg,'silent');store.data.actions[key]={state:'silent',time:Date.now()};store.save();log('QQ：保持安静，原话已保存');return;}
  await throttle.wait(msg.session);validate();
  if(image){try{await tools.call('qq_send_image',{kind:msg.kind,target:String(msg.target),imageId:image,quote:result.quote===true});}catch(error){log('QQ 图片未发送：'+error.message);}}
  if(voice&&!reply){await tools.call('qq_send_voice',{kind:msg.kind,target:String(msg.target),text:voice,quote:result.quote===true});}
  else if(reply){await tools.call('qq_reply_current',{text:reply,quote:result.quote===true,mentionSender:result.mention===true});}
  log('QQ：本轮表达已处理');
}
