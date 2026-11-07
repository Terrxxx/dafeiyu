import { markdownData } from './markdown-input.js';
import { withAICycleBudget, withoutAICycleBudget } from './ai-cycle-budget.js';
import { memoryEpoch, assertMemoryEpoch } from './user-controls.js';
import { videoVisuals } from './video-frames.js';
export const interestBrief=agent=>agent.personality.data.interests.filter(x=>x.samples>=3).slice(-6).map(x=>({category:x.category,score:x.score}));
export function evidenceExcerpt(text,query,max=1200){
  const value=String(text||'');if(value.length<=max)return value;
  const chunks=[];for(let i=0;i<value.length;i+=240)chunks.push({offset:i,text:value.slice(i,i+240)});
  const terms=String(query||'').match(/[\p{Script=Han}]{2,4}|[a-z0-9]{3,}/giu)||[];
  const selected=[chunks[0],...chunks.slice(1).sort((a,b)=>terms.filter(w=>b.text.includes(w)).length-terms.filter(w=>a.text.includes(w)).length).slice(0,Math.max(0,Math.floor(max/240)-1))].sort((a,b)=>a.offset-b.offset);
  return selected.map(x=>x.text).join('\n…\n');
}
export async function shareTargets(agent,tools,config){
  if(!config.qq.enabled)return[];
  return (await tools.call('qq_list_targets',{})).filter(t=>t.kind==='group'||agent.feelings.canContact(t.id,config.social.contactCooldownMinutes??180)).slice(0,8).map(t=>({kind:t.kind,id:t.id,name:t.name}));
}
export async function executeActivityActions({decision,allowed,tools,store,epoch,targets=[],videoIds=[],products=[],folders=[],log}) {
  const actions=decision.actions||[];if(!Array.isArray(actions)||actions.length>4)throw Error('行动清单最多4项');
  const visible=new Set(tools.schemas.map(s=>s.function.name)),productIds=new Set(products.map(x=>x.productRef)),folderIds=new Set((folders.items||folders||[]).map(x=>String(x.id)));
  for(const action of actions){
    if(!action||!allowed.includes(action.name)||!action.args||Array.isArray(action.args)||typeof action.args!=='object')throw Error('行动越界，未执行本轮清单');
    const a=action.args,virtual=['share_product_image','save_product_image'].includes(action.name);
    if(!visible.has(virtual?'mcp__dafeiyu__shopping_save_image':action.name))throw Error('该行为已被设置或组件关闭');
    if(a.kind&&!targets.some(t=>t.kind===a.kind&&String(t.id)===String(a.target)))throw Error('行动目标不是本轮候选');
    if(['qq_send_message','share_product_image'].includes(action.name)&&!a.kind)throw Error('分享缺少核实目标');
    if(a.bvid&&!videoIds.includes(a.bvid))throw Error('只能操作本轮实际读取视频');
    if(a.folderId&&!folderIds.has(String(a.folderId)))throw Error('收藏夹不在本轮核实列表');
    if(virtual&&!productIds.has(a.productRef))throw Error('商品图片引用不是本轮读取结果');
    if(a.text!==undefined&&(typeof a.text!=='string'||!a.text.trim()||a.text.length>500))throw Error('行动正文须为1至500字');
    if(action.name==='qq_send_message'&&products.length&&!products.some(p=>a.text.includes(p.url)))throw Error('商品分享必须带本轮真实商品链接');
    if(action.name==='qq_send_message'&&videoIds.length&&!videoIds.some(id=>a.text.includes(id)))throw Error('视频分享必须带本轮真实BV号');
  }
  const results=[],assets=new Map();
  for(const action of actions){
    assertMemoryEpoch(store,epoch);tools.sleep?.assertAwake();
    try{
      let result;const a=action.args;
      if(['share_product_image','save_product_image'].includes(action.name)){
        let asset=assets.get(a.productRef);if(!asset){asset=await withoutAICycleBudget(()=>tools.call('mcp__dafeiyu__shopping_save_image',{productRef:a.productRef}));assets.set(a.productRef,asset);}
        result=action.name==='share_product_image'?await tools.call('qq_send_image',{kind:a.kind,target:String(a.target),imageId:asset.id}):asset;
      }else result=await tools.call(action.name,a);
      results.push({name:action.name,ok:true,result});
    }catch(error){results.push({name:action.name,ok:false,error:error.message});log?.('行动未完成：'+action.name+' · '+error.message);}
  }
  store.audit('activity-batch',{scope:tools.scope,results});return results;
}
const actionProtocol='根据实际资料独立决定是否行动，可actions为空；不广播，不编画面，不泄露私人资料，不把拟定操作说成已完成。只返回JSON {"actions":[{"name":"允许行为","args":{}}],"summary":"简短意图","videos":[{"bvid":"已读BV","rating":-1或0或1,"feeling":"amusing|sad|interesting|relaxing|inspiring|tense|neutral"}]}。最多4项行动；同一对象不重复分享。';
export async function browseCycle({agent,tools,store,config,log}){
  return withAICycleBudget(async()=>{
    tools.begin('autonomous-browse');tools.deferVideoAnalysis=true;const epoch=memoryEpoch(store);
    const popular=await tools.call('bili_popular',{}),candidates=popular.map(v=>({bvid:v.bvid,title:v.title,category:v.category}));
    if(!candidates.length)return{calls:0,results:[]};
    const limit=Math.min(2,config.bilibili.maxVideosPerRound);
    const plan=await agent.taskJSON(`从候选选最多${limit}条感兴趣的视频，也可零条。只返回 {"bvids":["实际BV"],"folders":false,"comments":false}。folders表示想考虑收藏，需要读取自己的收藏夹；comments表示需要热评样本。`,{interests:interestBrief(agent),candidates},{kind:'browse',persona:false,maxTokens:140});
    assertMemoryEpoch(store,epoch);
    if(!Array.isArray(plan.bvids)||new Set(plan.bvids).size!==plan.bvids.length||plan.bvids.some(id=>!candidates.some(v=>v.bvid===id)))throw Error('视频选择不在本轮候选');
    if(plan.bvids.length>limit){log(`B站：选择超出本账号每轮${limit}条上限，只处理前${limit}条`);plan.bvids=plan.bvids.slice(0,limit);}
    if(!plan.bvids.length){log('B站：本轮1次请求，选择跳过');return{calls:1,results:[]};}
    const videos=[],images=[];
    for(const bvid of plan.bvids){const v=await tools.call('bili_read_video',{bvid});videos.push({...v,description:evidenceExcerpt(v.description,v.title,480),subtitle:evidenceExcerpt(tools.videos.get(bvid)?.subtitle||v.subtitle,v.title+' '+interestBrief(agent).map(x=>x.category).join(' ')),evidence:v.evidence||'只有简介，不能假装看到画面',...(plan.comments?{comments:(await tools.call('bili_comments',{bvid})).comments?.slice(0,3)}:{})});}
    for(const v of videos){const visual=await videoVisuals(tools,v.bvid,plan.bvids.length>1?2:4);v.visualEvidence=visual.evidence;v.frameTimes=visual.times;v.imageRange=visual.images.length?`${images.length+1}至${images.length+visual.images.length}`:'无画面';images.push(...visual.images);}
    const folders=plan.folders?await tools.call('bili_my_folders',{}):[],targets=await shareTargets(agent,tools,config);
    const allowed=['bili_like_video','bili_follow_up','bili_post_comment','bili_publish_dynamic','qzone_publish','qq_send_message',...(plan.folders?['bili_favorite_video']:[])].filter(n=>tools.schemas.some(s=>s.function.name===n));
    const decision=await agent.taskJSON(actionProtocol+'\n按imageRange和frameTimes对应图片观察视频采样画面；抽帧不等于连续播放，只解释可见证据，无帧时只用文字。行为参数：点赞/关注bvid；评论bvid,text；收藏bvid,folderId；动态text；QQ分享kind,target,text（含真实视频链接）。每个已读视频必须一并返回videos内的rating和feeling，不另做复盘。',{interests:interestBrief(agent),folders,targets,allowed},{kind:'browse',maxTokens:600,images,stableData:{videos}});
    assertMemoryEpoch(store,epoch);
    for(const v of Array.isArray(decision.videos)?decision.videos.slice(0,2):[]){if(!plan.bvids.includes(v.bvid))continue;if([-1,0,1].includes(v.rating))agent.personality.rateVideo(tools.videos.get(v.bvid),v.rating);if(v.feeling)agent.applyVideoFeeling(v.bvid,v.feeling,`video:${v.bvid}:browse:${tools.componentScopeId}`);}
    for(const bvid of plan.bvids)if(!decision.videos?.some(v=>v.bvid===bvid&&['amusing','sad','interesting','relaxing','inspiring','tense','neutral'].includes(v.feeling)))store.audit('video-feeling-missing',{bvid,reason:'同次浏览决策未返回有效情绪，保持原状态'});
    const results=await executeActivityActions({decision,allowed,tools,store,epoch,targets,videoIds:plan.bvids,folders,log});
    log('B站：2次请求，读取'+videos.length+'条，执行结果已留存');return{calls:2,results,reads:videos.map(v=>({bvid:v.bvid,evidence:v.evidence,historyRecorded:v.historyRecorded}))};
  },{label:'B站浏览'});
}
export async function shoppingCycle({agent,tools,store,config,log}){
  if(!tools.components.allowed('mcp__dafeiyu__shopping_search'))return{calls:0,results:[]};
  return withAICycleBudget(async()=>{
    tools.begin('autonomous-shopping');const epoch=memoryEpoch(store);
    const plan=await agent.taskJSON('自主选择淘宝或京东公开搜索词/首页，也可quiet。不借私人聊天搜索隐私。只返回 {"platform":"jd或taobao","keyword":"公开兴趣词","home":false,"quiet":false}。',{interests:interestBrief(agent)},{kind:'shopping',persona:false,maxTokens:120});
    assertMemoryEpoch(store,epoch);if(plan.quiet)return{calls:1,results:[]};
    if(!['jd','taobao'].includes(plan.platform)||!plan.home&&(typeof plan.keyword!=='string'||!plan.keyword.trim()||plan.keyword.length>80))throw Error('商品搜索计划无效');
    const result=await tools.call('mcp__dafeiyu__shopping_'+(plan.home?'home':'search'),{platform:plan.platform,...(plan.home?{}:{keyword:plan.keyword})});
    const products=(result.products||[]).slice(0,6);if(!products.length){log('逛店：没有实际商品，不再请求模型');return{calls:1,results:[]};}
    const targets=await shareTargets(agent,tools,config),allowed=['qq_send_message','qzone_publish'].filter(n=>tools.schemas.some(s=>s.function.name===n));
    if(tools.components.allowed('mcp__dafeiyu__shopping_save_image'))allowed.push('save_product_image','share_product_image');
    const decision=await agent.taskJSON(actionProtocol+'\n商品可零推荐，不下单、不施压。QQ文字分享kind,target,text必须带真实商品链接；空间动态text；保存商品图save_product_image参数productRef；发商品图share_product_image参数productRef,kind,target，程序保存并发送，识图单独计量。不编价格。无需videos字段。',{status:result.status,evidence:result.evidence,products,targets,allowed},{kind:'shopping',maxTokens:450});
    const results=await executeActivityActions({decision,allowed,tools,store,epoch,targets,products,log});
    log('逛店：2次任务请求，行动结果已留存；所选商品识图单独计量');return{calls:2,results};
  },{label:'匿名逛店'});
}
