import {createHash} from 'node:crypto';
import {publicationImages} from './social-image-assets.js';
const names={qzone:'QQ空间',bilibili:'B站动态'};
const platforms = text => [
  ...(/(?:QQ\s*)?空间|QQ\s*动态|说说/i.test(text) ? ['qzone'] : []),
  ...(/B\s*站|哔哩哔哩/i.test(text) ? ['bilibili'] : []),
];
const requestText = msg => (msg.sources || [msg]).map(source => String(source.text || '').trim()).join('\n');
const cancelPublish = /^(?:那|先|暂时)?[，,\s]*(?:别发|不要发|不用发|取消发布|不发了)/;
const statusQuery = /(?:发|发布)(?:出去)?了(?:吗|没)|发没发|有没有发|(?:怎么|为什么).{0,8}(?:看不到|没看到|没有看到|没发|不发)/;
const publishCommand = /(?:发|发布)(?:一?条|一?个|一下|一?篇|出去|吧|呀|啊|了吧|到|在|个新的?|条新的?)|(?:现在|快|直接|去|赶紧|帮我|替我|给我|麻烦你)发|(?:发|发布)\s*(?:QQ\s*动态|QQ\s*空间|空间|说说|B\s*站|哔哩哔哩)|(?:空间|动态|说说).{0,6}(?:发|发布)(?:吧|出去|[:：]|$)/i;
export function publicationIntent(msg,store){
  const recent=(store.data.histories[msg.session]||[]).filter(r=>r.id!==msg.historyEntryId&&Date.now()-Date.parse(r.time)<30*60000).slice(-12);
  const request = requestText(msg);
  const header = request.split(/[:：“「『]/, 1)[0];
  const destination = header.match(/(?:发|发布)(?:到|在|去|至)\s*(.+)$/i)?.[1];
  const explicit = platforms(destination || header);
  if ((msg.sources || [msg]).some(source => cancelPublish.test(String(source.text || '').trim()))) {
    return { mode: 'cancel', platforms: explicit };
  }
  const pending = store.data.publicationDrafts?.[msg.session];
  if (pending && Date.now() - pending.time < 15 * 60000 && explicit.length === 1 &&
      /^(?:发(?:到|在)?|就发(?:到|在)?|发到我的)?(?:QQ\s*)?(?:空间|QQ\s*动态|说说|B\s*站(?:动态)?|哔哩哔哩)(?:吧|呀)?[。！!\s]*$/i.test(header)) {
    return { mode: 'publish', platforms: explicit, recent, request: pending.request, needsImages: pending.needsImages, explicit: true };
  }
  const previous = recent.slice().reverse().find(row => platforms(row.content).length &&
    !row.content.includes('想发到QQ空间，还是B站呀') &&
    /发|发布|文案|草稿|限额/.test(row.content));
  const targets = explicit.length ? explicit : platforms(previous?.content || '');
  if (targets.length && statusQuery.test(header)) return { mode: 'status', platforms: targets, explicit: explicit.length > 0 };
  const continuation = /^(?:(?:好|那|行|可以|确认)[，,、\s]*)?(?:你)?(?:就|直接|现在)?(?:发(?:布)?出去|发吧|发布吧|发了吧|发这条|发这句)[。！!\s]*$/.test(header);
  if (!explicit.length && !continuation && !/动态|说说/.test(header)) {
    return targets.length ? { mode: 'conversation', platforms: targets } : null;
  }
  const conversation = { mode: 'conversation', platforms: targets };
  if (/发(?:布)?(?:一?条|一?个|一下)?(?:评论|回复|留言|消息|私信)|(?:帖子|动态|说说).{0,8}(?:底下|下面|评论区)|发给|(?:空间|动态|说说)(?:的)?(?:链接|地址)/.test(header)) return conversation;
  if (/会不会|是否|怎么发|如何发|假如|如果|举个例子|引用|转述|不要|别发|先别|暂时不发|不准|没法|无法|不能发布|不用发|只写|先.{0,8}(?:看|预览|给我)|(?:要发的|打算发的).{0,8}(?:是什么|什么文案)|发什么|发过|(?:我|他|她)(?:刚|已经|昨天|以前).{0,6}发/.test(header)) return conversation;
  if (/^我(?:想|要|打算|准备)(?:自己)?发/.test(header)) return conversation;
  if (/能不能|可不可以|可以|能否|[?？]|吗$/.test(header) &&
      !/帮(?:我|忙)?|替我|给我|麻烦|请|发(?:布)?(?:一条|条|一个|个|一下)|发出去/.test(header)) return conversation;
  if (!publishCommand.test(header) && !continuation) return conversation;
  if (!targets.length) return continuation ? null : { mode: 'choose-platform', platforms: [] };
  if (!explicit.length && !continuation && targets.length > 1) return { mode: 'choose-platform', platforms: [] };
  return { mode: 'publish', platforms: targets, recent, request, explicit: explicit.length > 0 };
}
export function publicationPromise(text){return /(?:马上|这就|立刻|现在|稍后|待会|等会|准备).{0,12}(?:发|发布)|(?:已经|已|刚刚).{0,6}(?:发出|发布|发好)|发好啦|发完.{0,8}(?:给|告诉|链接)/.test(text);}
export async function handlePublication(intent,msg,{agent,store,tools,log,validate}){
  if (intent.mode === 'choose-platform') {
    store.data.publicationDrafts ||= {};
    store.data.publicationDrafts[msg.session] = {
      request: requestText(msg).slice(0, 16000), needsImages: !!msg.images?.length, time: Date.now(),
    };
    store.save();
    return '想发到QQ空间，还是B站呀？';
  }
  store.data.publicationReceipts||={};
  const receipts=store.data.publicationReceipts[msg.session]||={};
  if(intent.mode==='status')return intent.platforms.map(platform=>{
    const record=receipts[platform];
    return record?.state==='confirmed'?`${platform==="qzone"?"空间那条发好啦～":"B站动态发好啦～"}`:record?.state==='failed'?`${names[platform]}未确认发布成功：${record.error}`:record?.state==='pending'?`${names[platform]}上次提交结果尚不明确，不自动重发。`:`这轮${names[platform]}还没有发布成功回执，之前说“马上发”不算发出。`;
  }).join('\n');
  log('发布：生成文案后由程序提交，以平台回执确认');
  const request = intent.request ?? msg.text;
  if (store.data.publicationDrafts?.[msg.session]) {
    delete store.data.publicationDrafts[msg.session];
    store.save();
  }
  const draft=await agent.taskJSON('为当前明确发布要求生成公开文案。只返回 {"operations":[{"platform":"qzone或bilibili","text":"1至1000字","imageIds":["可选的已缓存图片ID"]}]}。每个指定平台一项，只能使用本轮指定平台；用户有原文就保留原文，无原文时可用本会话确认的公开草稿，也可按明确要求拟一条自然的公开动态。不要公开未获授权的私聊、个人资料或其他会话，不编造图片、视频或经历。可以选择availableImages中的图片ID上传。用户要求带图必须选择对应图片，拿不到有效图片则返回空清单。禁止自行填写URL或文件路径。没有合适文案可operations为空。',{request,platforms:intent.platforms,availableImages:tools.media?.list(msg.session).slice(-9)||[],recent:intent.recent.map(r=>({role:r.role,content:r.content.slice(0,500)}))},{kind:'qq',maxTokens:650});
  if(!Array.isArray(draft.operations)||draft.operations.length>intent.platforms.length||new Set(draft.operations.map(o=>o.platform)).size!==draft.operations.length||draft.operations.some(o=>!intent.platforms.includes(o.platform)||typeof o.text!=='string'||!o.text.trim()||o.text.length>1000))throw Error('发布文案格式无效，未提交');
  if(!draft.operations.length)return'还没提交发布。请确认要发的文案。';
  const results=[];
  const needsImages=intent.needsImages||(msg.images||[]).length>0||/配图|带图|附图|发(?:这|那|张).{0,3}(?:图|照片)/.test(request.split(/[:：]/, 1)[0]);
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
