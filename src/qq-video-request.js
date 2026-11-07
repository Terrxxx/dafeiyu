import { conversationPacket } from './context-packet.js';
import { evidenceExcerpt } from './activity-cycle.js';
import { videoVisuals } from './video-frames.js';
export function explicitVideoRequest(msg,store) {
  const texts=(msg.sources||[msg]).map(s=>String(s.text||''));
  const text=texts.join('\n');let ids=[...new Set(text.match(/\bBV[0-9A-Za-z]{10}\b/g)||[])];
  if(ids.length>1||/(不要|不用|不需要|别看|别读|取消|停止|转述|引用|他说|她说|点赞|收藏|关注|发表|转发|分享|发给|发到|并评论|再评论|评论一下|留个评论)/.test(text))return null;
  if(!/(?:^|[\s：:，,。])(?:请)?(?:你)?(?:能不能|可以|能)?(?:帮我|给我)?(?:去|再)?(?:B站|哔哩哔哩)?\s*(?:看看|看一下|看下|看一眼|读取|分析|总结|介绍|解读|看(?=\s*(?:BV|https?:|这个|这条|它|视频)))/.test(text))return null;
  if(!ids.length&&store&&/(视频|这条|这个|它|再看|看看|看一下|看下)/.test(text)){
    const previous=(store.data.histories[msg.session]||[]).filter(r=>r.id!==msg.historyEntryId&&r.role==='user'&&Date.now()-Date.parse(r.time)<15*60000).slice(-6);
    for(const row of previous.reverse()){const found=[...new Set(String(row.content).match(/\bBV[0-9A-Za-z]{10}\b/g)||[])];if(found.length>1)return null;if(found.length===1){ids=found;break;}}
  }
  if(ids.length!==1)return null;
  return {bvid:ids[0],comments:/(评论区|热评|看看评论|读(?:取)?评论|的评论)/.test(text)};
}
export async function replyToVideoRequest(request,msg,key,{agent,store,tools,throttle,log,validate}) {
  tools.deferVideoAnalysis=true;
  log('QQ视频：固定读取资料，再用1次请求生成回复；无工具回环');
  let video,comments;
  try {
    video=await tools.call('bili_read_video',{bvid:request.bvid});
    if(request.comments)comments=(await tools.call('bili_comments',{bvid:request.bvid})).comments?.slice(0,3);
  }catch(error){
    validate();store.audit('qq-video-read-error',{bvid:request.bvid,error:error.message});
    await throttle.wait(msg.session);validate();await tools.call('qq_reply_current',{text:'这条暂时没读到，稍后再试试'});log('QQ视频读取失败：'+error.message);return;
  }
  validate();
  const visual=await videoVisuals(tools,request.bvid,4);validate();
  const context=conversationPacket(agent,msg,{query:video.title,recentLimit:2,retrievalLimit:1});
  // Keep source evidence before changing conversation state so repeated reads can reuse its prefix.
  const result=await agent.taskJSON('依据已读视频的关键帧、字幕和简介回应当前要求。图片按frameTimes顺序对应实际采样画面，可以分析可见人物、动作姿态和场景；抽帧不是连续播放，不编造未采到的动作。没有提供帧时明确只能看文字。评论是样本。自然短句，可分行。必须在同一次返回JSON {"reply":"正文","summary":"简短意图","rating":-1或0或1,"feeling":"amusing|sad|interesting|relaxing|inspiring|tense|neutral"}。按可见证据判断感受和兴趣，不另请求情绪分析。',{context:context.text,message:msg.text},{kind:'qq',maxTokens:500,images:visual.images,stableData:{video:{bvid:video.bvid,title:video.title,description:evidenceExcerpt(video.description,video.title,360),subtitle:evidenceExcerpt(tools.videos.get(request.bvid)?.subtitle||video.subtitle,video.title,960),textEvidence:video.evidence,visualEvidence:visual.evidence,frameTimes:visual.times,comments}}});
  validate();
  if([-1,0,1].includes(result.rating))agent.personality.rateVideo(tools.videos.get(request.bvid),result.rating);
  if(['amusing','sad','interesting','relaxing','inspiring','tense','neutral'].includes(result.feeling))agent.applyVideoFeeling(request.bvid,result.feeling,`video:${request.bvid}:qq:${key}`);
  else store.audit('video-feeling-missing',{bvid:request.bvid,reason:'同次回复未返回有效情绪，保持原状态'});
  if(typeof result.reply!=='string')throw Error('视频回复格式无效，原始消息和已读取记录已保留');
  agent.reportDecision(msg.session,result.summary||'根据实际视频资料回应','视频回复');
  if(result.reply.trim()){await throttle.wait(msg.session);validate();await tools.call('qq_reply_current',{text:result.reply});}
  else{store.data.actions[key]={state:'silent',time:Date.now()};store.save();}
  log('QQ视频：处理完成，无额外情绪分析或发送后总结请求');
}
