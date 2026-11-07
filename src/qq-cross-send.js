import {confirmedMessage} from './qq-processing.js';
import {chatAllowed} from './qq-policy.js';

const raw=msg=>(msg.sources||[msg]).map(s=>String(s.text||'')).join('\n');
export function crossSendIntent(msg,store){
  const text=raw(msg),previous=store.data.crossSendReceipts?.[msg.session];
  if(/(?:发|发送)(?:出去|过去|出|过)?了(?:吗|没)|发没发|有没有发|(?:怎么|为什么).{0,8}(?:没发|没看到|看不到)/.test(text)&&(/群/.test(text)||previous&&Date.now()-previous.time<30*60000))return{mode:'status'};
  if(/不要|别发|别说|不用发|取消|假如|如果|他说|她说|举个例子|如何发|怎么发/.test(text))return null;
  if(msg.images?.length||/图片|照片|表情包|语音|视频文件|转发聊天记录/.test(text))return null;
  if(/^(?:你)?(?:为什么|为啥|怎么|是不是|有没有|记得)|^(?:我|你)(?:已经|刚才|昨天|之前)|你在群.{0,20}(?:说了什么|说没有)/.test(text))return null;
  const pending=['needs_target','needs_content'].includes(previous?.state)&&Date.now()-previous.time<15*60000;
  const followup=pending&&(/^[\s\d，,。!！这是个群群号\p{L}_-]{1,80}$/u.test(text)||previous.state==='needs_content'&&/^(?:就说|说[:：]|发[:：]|正文[:：]?|发这句|[“「『"])/.test(text));
  const command=/(?:^|[\n，。])\s*(?:那|好|现在|赶紧|快|你|请|麻烦你|帮我|替我|帮忙|能不能|可以|能否){0,5}(?:(?:去|到|在|给|向).{0,50}群.{0,20}(?:发|说|讲|通知|告诉)|(?:发|说|讲).{0,20}(?:群里|群聊|群内)|(?:通知|告诉).{0,25}群)/s.test(text);
  if(!command&&!followup)return null;
  if(/你(?:会不会|能不能).{0,15}(?:发(?:送)?消息|群发)/.test(text)&&!/帮我|替我|[:：“「『]/.test(text))return null;
  const useFollowup=followup&&!command;
  return{mode:'send',request:useFollowup?previous.request+'\n'+(previous.state==='needs_content'?'正文补充：':'目标补充：')+text:text,...(useFollowup&&previous.target?{target:previous.target}:{})};
}
export const crossSendPromise=text=>/(?:已经|刚刚|已|这就|马上|现在|立刻|稍后).{0,25}(?:发|说|传|通知).{0,15}群|(?:已经|刚刚|这就|马上|现在|立刻|稍后).{0,35}群.{0,15}(?:发|说|传|通知)|(?:群里|群内|群聊).{0,15}(?:发了|说了|发好|收到)/.test(text);
function targetGroup(groups,request){
  const ids=groups.filter(g=>new RegExp(`(^|[^0-9])${g.id}([^0-9]|$)`).test(request));
  if(ids.length===1)return ids[0];if(ids.length>1)return null;
  const names=groups.filter(g=>g.name.length>=2&&request.normalize('NFKC').includes(g.name.normalize('NFKC')));
  return names.length===1?names[0]:null;
}
export async function handleCrossSend(intent,msg,{agent,tools,store,log,validate}){
  store.data.crossSendReceipts||={};const receipts=store.data.crossSendReceipts;
  if(intent.mode==='status'){
    const previous=receipts[msg.session];
    if(previous?.state==='confirmed')return'已经发到那个群啦～';
    if(previous?.state==='previously_processed')return'这条内容之前处理过，本次没有重复发，也没有新的发送回执。';
    if(previous?.state==='uncertain')return'上次没有取得完整发送回执，暂时不能确认送达，我没有重复发。';
    if(previous?.state==='needs_target')return'还没发，要先确认发到哪个群呀。';
    if(previous?.state==='needs_content')return'还没发，要先确认发哪句话呀。';
    return'这边没有那条消息的发送成功回执，暂时不能说发好了。';
  }
  validate();
  if(!tools.schemas.some(s=>s.function.name==='qq_send_message'))return'当前账号没有开放跨会话发送功能。';
  let groups;
  try{
    groups=(await tools.qq.call('get_group_list')).map(g=>({id:String(g.group_id),name:String(g.group_name||g.group_id)})).filter(g=>/^[1-9]\d*$/.test(g.id)&&chatAllowed(tools.qq.policy?.()||tools.config.qq,'group',g.id));
  }catch(error){log('跨群发送：目标列表读取失败 · '+error.message);return'群列表暂时没读到，还没发送。';}
  validate();
  if(!groups.length)return'当前没有允许发言的群，还没发送；请检查群聊开关和黑白名单。';
  const target=targetGroup(groups,intent.request);
  if(!target){receipts[msg.session]={state:'needs_target',time:Date.now(),request:intent.request.slice(0,1500)};store.save();return /\d{5,12}/.test(intent.request)?'这个群目标还不能确认：可能群号不对、未入群或受黑白名单限制。我还没发送，请确认一个可发言的群。':'要发到哪个群呀？请给准确群名或群号，我还没发送。';}
  const history=(store.data.histories[msg.session]||[]).filter(r=>r.id!==msg.historyEntryId&&Date.now()-Date.parse(r.time)<15*60000).slice(-8).map(r=>({role:r.role,content:r.content.slice(0,500)}));
  const draft=await agent.taskJSON('根据当前发送者明确要求及本私聊中已确认要公开的内容，拟一条发往已核验QQ群的消息。只返回{"text":"拟发正文"}。只能使用本人授权公开的内容；不披露其他私聊，不把口头承诺当作已经发送。目标已由程序确定，不另选群、不编群号、不自行@任何人。用户已给正文则保持原意，缺少要说的具体内容就text留空。',{request:intent.request,target,speaker:msg.qqNickname||msg.name,history},{kind:'qq',maxTokens:400});
  if(typeof draft.text!=='string'||!draft.text.trim()||draft.text.length>1000){receipts[msg.session]={state:'needs_content',time:Date.now(),target:target.id,request:intent.request.slice(0,1500)};store.save();return'群找到了，具体要说哪句话呀？我还没发送。';}
  validate();tools.targets.add('group:'+target.id);
  receipts[msg.session]={state:'pending',time:Date.now(),target:target.id};store.save();
  try{
    const result=await tools.call('qq_send_message',{kind:'group',target:target.id,text:draft.text.trim()});
    if(result?.skipped){receipts[msg.session]={state:result.state==='sent'?'previously_processed':'uncertain',time:Date.now(),target:target.id};store.save();return result.state==='sent'?'这条内容之前处理过啦，这次没有重复发送。':'这条内容此前的发送状态不明，这次没有重复发。';}
    if(!confirmedMessage(result))throw Error('QQ未返回完整消息ID');
    receipts[msg.session]={state:'confirmed',time:Date.now(),target:target.id,messageIds:(result.messages||[result]).map(r=>String(r.message_id))};store.save();
    log('跨群发送：已核验群目标并取得发送消息ID');return'发到群里啦～';
  }catch(error){receipts[msg.session]={state:'uncertain',time:Date.now(),target:target.id};store.save();log('跨群发送：未确认送达 · '+error.message);return'这次没有确认发送成功，先别当作已经送达，我不会自动重发。';}
}
