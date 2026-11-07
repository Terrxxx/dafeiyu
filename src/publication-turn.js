import {createHash} from 'node:crypto';
import {publicationImages} from './social-image-assets.js';
const names={qzone:'QQ空间',bilibili:'B站动态'};
const platforms=text=>[...(/QQ空间|空间|说说/.test(text)?['qzone']:[]),...(/B站|哔哩哔哩/.test(text)?['bilibili']:[])];
export function publicationIntent(msg,store){
  const recent=(store.data.histories[msg.session]||[]).filter(r=>r.id!==msg.historyEntryId&&Date.now()-Date.parse(r.time)<30*60000).slice(-12);
  const current=String(msg.text||''),targets=platforms(current),contextTargets=targets.length?targets:platforms(recent.map(r=>r.content).join('\n'));
  if(!contextTargets.length)return null;
  if(/(?:发|发布)(?:出去)?了(?:吗|没)|发没发|有没有发|(?:怎么|为什么).{0,8}(?:看不到|没看到|没有看到|没发|不发)/.test(current))return{mode:'status',platforms:contextTargets};
  if(/会不会|能不能|可不可以|能否|是否|怎么发|如何发|假如|如果|举个例子|引用|转述/.test(current)||/[?？]/.test(current)&&!/帮我|替我|给我/.test(current))return{mode:'conversation',platforms:contextTargets};
  if(/不要|别发|暂时不发|不准|不能|没法|无法|先.{0,8}(?:看看|预览|说说看)|(?:要发的|打算发的).{0,8}(?:是什么|什么文案)|发什么/.test(current))return{mode:'conversation',platforms:contextTargets};
  const command=/(?:现在发|快发|直接发|去发|赶紧发|帮我发|替我发|给我发|发(?:布)?(?:一条|条|个|一下|出去|吧|呀|啊)|发(?:布)?(?:到)?(?:QQ空间|空间|说说|B站|哔哩哔哩))/.test(current);
  return{mode:command?'publish':'conversation',platforms:contextTargets,recent};
}
export function publicationPromise(text){return /(?:马上|这就|立刻|现在|稍后|待会|等会|准备).{0,12}(?:发|发布)|(?:已经|已|刚刚).{0,6}(?:发出|发布|发好)|发好啦|发完.{0,8}(?:给|告诉|链接)/.test(text);}
export async function handlePublication(intent,msg,{agent,store,tools,log,validate}){
  store.data.publicationReceipts||={};
  const receipts=store.data.publicationReceipts[msg.session]||={};
  if(intent.mode==='status')return intent.platforms.map(platform=>{
    const record=receipts[platform];
    return record?.state==='confirmed'?`${platform==="qzone"?"空间那条发好啦～":"B站动态发好啦～"}`:record?.state==='failed'?`${names[platform]}未确认发布成功：${record.error}`:record?.state==='pending'?`${names[platform]}上次提交结果尚不明确，不自动重发。`:`这轮${names[platform]}还没有发布成功回执，之前说“马上发”不算发出。`;
  }).join('\n');
  log('发布：生成文案后由程序提交，以平台回执确认');
  const draft=await agent.taskJSON('为当前明确发布要求生成公开文案。只返回 {"operations":[{"platform":"qzone或bilibili","text":"1至1000字","imageIds":["可选的已缓存图片ID"]}]}。每个指定平台一项，只能使用本轮指定平台；用户有原文就保留原文，无原文时参考本会话已经展示的公开草稿。不要公开私聊原话、私人信息或其他会话；不编造图片、视频或经历。可以选择availableImages中的图片ID上传。用户要求带图必须选择对应图片，拿不到有效图片不要偷偷改纯文字。禁止自行填写URL或文件路径，不公开其他会话私人图片。没有明确合适文案可operations为空，向用户确认，不声称发布。',{request:msg.text,platforms:intent.platforms,availableImages:tools.media?.list(msg.session).slice(-9)||[],recent:intent.recent.map(r=>({role:r.role,content:r.content.slice(0,800)}))},{kind:'qq',maxTokens:650});
  if(!Array.isArray(draft.operations)||draft.operations.length>intent.platforms.length||new Set(draft.operations.map(o=>o.platform)).size!==draft.operations.length||draft.operations.some(o=>!intent.platforms.includes(o.platform)||typeof o.text!=='string'||!o.text.trim()||o.text.length>1000))throw Error('发布文案格式无效，未提交');
  if(!draft.operations.length)return'还没提交发布。请确认要发的文案。';
  const results=[];
  const needsImages=(msg.images||[]).length>0||/配图|带图|附图|图片|照片/.test(msg.text||'');
  for(const op of draft.operations){publicationImages(tools,op.imageIds);if(needsImages&&!op.imageIds?.length)throw Error('本次要求带图，但没有选到可用图片，未提交发布');}
  for(const op of draft.operations){
    validate();
    const hash=createHash('sha256').update(op.imageIds?.length?JSON.stringify([op.text.trim(),op.imageIds]):op.text.trim()).digest('hex');
    const previous=receipts[op.platform];
    if(previous?.hash===hash&&previous.state==='confirmed'){results.push('那条已经发过啦～');continue;}
    receipts[op.platform]={state:'pending',hash,time:Date.now()};store.save();
    try{
      const receipt=await tools.call(op.platform==='qzone'?'qzone_publish':'bili_publish_dynamic',{text:op.text.trim(),...(op.imageIds?.length?{imageIds:op.imageIds}:{})});
      const id=receipt?.tid??receipt?.dynamicId;
      if(!id)throw Error(receipt?.skipped?'相同内容已处理或上次结果不明，请核对平台页面；没有再次发布':'没有取得发布ID，结果不明，请核对平台页面');
      receipts[op.platform]={state:'confirmed',hash,id:String(id),time:Date.now()};store.save();
      results.push(op.platform==='qzone'?'发好啦，去空间看看～':'发到B站啦～');log('发布：'+names[op.platform]+'已取得发布ID');
    }catch(error){
      const message=String(error.message).slice(0,200);
      receipts[op.platform]={state:'failed',hash,error:message,time:Date.now()};store.save();
      results.push(`${names[op.platform]}未确认发布成功：${message}`);log('发布：'+names[op.platform]+'未确认成功 · '+message);
    }
  }
  return results.join('\n');
}
