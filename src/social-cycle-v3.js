import {TASK_LIMIT} from './tasks.js';
import {downloadImage} from './images.js';
import { withAICycleBudget } from './ai-cycle-budget.js';
import { memoryEpoch, assertMemoryEpoch, userBlocked } from './user-controls.js';
import { conversationPacket } from './context-packet.js';
import { executeActivityActions } from './activity-cycle.js';
import {eligibleSocialTargets,socialHints,saveSocialTask} from './social-planning.js';
import {recentQuestionContext} from './proactive-dialogue.js';
import {lifeActivities,saveSelfTask} from './life-schedule.js';
import { restEnergy } from './sleep.js';
import { publishQuota } from './publish-quota.js';
export async function socialCycle({agent,tools,store,config,log}) {
  return withAICycleBudget(async()=>{
    tools.begin('autonomous-social');const epoch=memoryEpoch(store);
    const allTargets=config.qq.enabled?await tools.call('qq_list_targets',{}):[],targets=eligibleSocialTargets(allTargets,tools,config),f=agent.feelings;
    const spaceEnabled=config.qq.qzoneReadEnabled!==false&&tools.components.allowed('qzone_read')&&tools.schemas.some(s=>s.function.name==='qzone_read');
    // Dialogue-only switches and unanswered private messages do not disable
    // separately enabled Qzone browsing. Explicit blocks still apply.
    const spaceFriends=spaceEnabled?allTargets.filter(t=>t.kind==='private'&&!userBlocked(store,t.id)&&!(config.qq.privateBlocklist||[]).includes(String(t.id))&&!tools.qq?.peers?.isPeer(t.id)):[];
    const following=config.social.followupEnabled===false?[]:targets.filter(t=>t.kind==='private'&&f.canFollowup(t.id,config.social.followupWaitMinutes??30));
    const contacts=f.candidates(targets,config.social.contactCooldownMinutes??180);
    const meta=store.data.meta||={},cursor=meta.socialChoiceCursor||0;
    const rotate=rows=>rows.length?[...rows.slice(cursor%rows.length),...rows.slice(0,cursor%rows.length)]:[];
    const people=rotate([...following,...contacts].filter((t,i,all)=>all.findIndex(x=>String(x.id)===String(t.id))===i)),groups=rotate(targets.filter(t=>t.kind==='group')),spaces=rotate(spaceFriends);
    const pool=[...people.slice(0,3),...groups.slice(0,2),...spaces.slice(0,3),...people,...groups,...spaces];
    const choices=pool.filter((t,i,all)=>all.findIndex(x=>x.kind===t.kind&&String(x.id)===String(t.id))===i).slice(0,8).map(t=>({kind:t.kind,id:String(t.id),name:t.name,followup:following.some(x=>x.kind===t.kind&&String(x.id)===String(t.id)),canChat:t.kind==='group'?groups.some(x=>String(x.id)===String(t.id)):people.some(x=>String(x.id)===String(t.id)),canSpace:t.kind==='private'&&spaceFriends.some(x=>String(x.id)===String(t.id))}));
    const quota = publishQuota(config, store, tools);
    const canPublish = config.qq.enabled && config.social.qzoneEnabled === true &&
      quota.qzone.remaining > 0 && quota.outgoing.remaining > 0 &&
      tools.schemas.some(schema => schema.function.name === 'qzone_publish');
    if(!choices.length&&!tools.tasks&&!canPublish){log('自主社交：无合适目标，0次请求');return{calls:0};}
    meta.socialChoiceCursor=cursor+1;store.save?.();
    const mood=f.snapshot('autonomous-social').mood;
    const interests=(agent.personality.data.interests||[]).filter(x=>x.samples>=3).slice(-3).map(x=>({category:x.category,score:x.score}));
    const pending=(store.data.tasks||[]).filter(t=>['pending','running'].includes(t.status)).length;
    const lastRest = tools.sleep?.data?.lastSleep;
    const rest = tools.sleep?.requestRest ? {
      canSleep: mood.energy <= restEnergy,
      lastRestMinutesAgo: lastRest ? Math.max(0, Math.floor((Date.now() - lastRest.wokeAt) / 60000)) : undefined,
    } : undefined;
    const plan=await agent.taskJSON('这是你主动生活的时间，不需要等用户命令。从真实候选选择一个对象聊天、逛空间或安排稍后联系；精神尚可且有合适对象时可以主动开话题，也可以去看朋友的新动态，不能因为对方没有回复私聊就认为不能看空间。根据情绪、精力、关系和兴趣自主选择，也可quiet。只返回 {"activity":"chat|space|task|selfTask|sleep|nap|publish|quiet","kind":"private|group","id":"候选ID","minutes":15}。rest存在时，canSleep为真可选择sleep马上正常睡，或nap自己选5至30分钟（即使精力高也可以，偶尔小睡，刚休息过别机械重复）；这两项无目标，只有nap填写minutes。chat和task仅选canChat=true；space仅选canSpace=true。canPublish为真且有想公开的想法时可选publish，发自己的QQ空间，无需目标，别重复近期动态。空间可只看不互动；selfTask给自己安排稍后的浏览、逛店或整理想法，无目标；已有日程别重复。这一步只选活动。',{choices:socialHints(agent,store,choices),mood,rest,interests,pending,canPublish,selfActivities:lifeActivities(config,tools),pendingPlans:(store.data.tasks||[]).filter(t=>t.status==='pending').slice(-4).map(t=>({kind:t.autonomousActivity,prompt:t.prompt.slice(0,60)})),canSchedule:!!tools.tasks&&pending<TASK_LIMIT},{kind:'social',persona:false,maxTokens:100});
    assertMemoryEpoch(store,epoch);if(plan.activity==='quiet'){log('自主社交：选择安静，1次请求');return{calls:1};}
    if (plan.activity === 'sleep' || plan.activity === 'nap') {
      if (!rest || (plan.activity === 'sleep' && !rest.canSleep)) return { calls: 1 };
      const minutes = plan.activity === 'nap' ? plan.minutes ?? NaN : undefined;
      const result = tools.sleep.requestRest({ minutes });
      if (result) log(result.reason === 'nap' ? `自主休息：小睡${minutes}分钟` : '自主休息：精力不足，已进入睡眠');
      return { calls: 1, resting: !!result };
    }
    if(plan.activity==='selfTask'){
      if(!tools.tasks||pending>=TASK_LIMIT)throw Error('暂无自主日程名额');
      const decision=await agent.taskJSON('为自己安排一个具体的未来活动，不需要找人聊天。只返回 {"task":{"kind":"允许的活动","prompt":"具体要做什么，最多200字","delayMinutes":120}}；也可task为null。不重复已有日程，不写泛泛自主任务，不因无人可聊天就机械安排。',{activities:lifeActivities(config,tools),pendingTasks:(store.data.tasks||[]).filter(t=>t.status==='pending').slice(-6).map(t=>({activity:t.autonomousActivity,prompt:t.prompt.slice(0,100),due:t.due})),mood,interests},{kind:'social',maxTokens:240});
      assertMemoryEpoch(store,epoch);if(decision.task)saveSelfTask(decision.task,{tools,store,config,log});return{calls:2,scheduled:!!decision.task};
    }
    if (plan.activity === 'publish') {
      if (!canPublish) return { calls: 1 };
      const previous = store.data.lastAutonomousQzonePost;
      const draft = await agent.taskJSON(
        '为自己的QQ空间想一条公开说说，只返回 {"text":"1至200字"}。根据此刻情绪、兴趣写一个简短自然的想法，不编造亲身经历，不公开他人信息，不复述私聊，不重复上条动态；没什么值得发就留空。',
        { mood, interests, previous: previous?.text }, { kind: 'social', maxTokens: 200 });
      if (typeof draft.text !== 'string' || draft.text.length > 200) throw Error('自主空间文案须为0至200字');
      const body = draft.text.trim();
      if (!body) return { calls: 2 };
      const results = await executeActivityActions({
        decision: { actions: [{ name: 'qzone_publish', args: { text: body } }] },
        allowed: ['qzone_publish'], tools, store, epoch, log,
      });
      if (results[0]?.result?.tid) {
        store.data.lastAutonomousQzonePost = { text: body, time: Date.now() };
        store.save();
        log('自主空间：动态已发布');
      } else if (results[0]?.result?.skipped) log('自主空间：本条内容此前已处理，未再次发布');
      return { calls: 2, results };
    }
    const target=choices.find(x=>x.kind===plan.kind&&x.id===String(plan.id));if(!target||!['chat','space','task'].includes(plan.activity))throw Error('社交计划无效');
    if(plan.activity==='space'?!target.canSpace:!target.canChat)throw Error('该目标不允许所选社交活动');
    let material,allowed;const spaceImages=[];
    if(plan.activity==='space'){
      log('自主空间：开始读取所选好友动态');
      let data;
      try{data=await tools.call('qzone_read',{userId:target.id});}
      catch(error){log('自主空间：读取失败 · '+String(error.message).slice(0,160));return{calls:1,spaceReadFailed:true};}
      const posts=data.posts.slice(0,3);
      log(`自主空间：读取到${posts.length}条近期动态`);
      if(!posts.length){log('自主空间：本页没有可见动态，可能无近期内容或受空间访问权限限制');return{calls:1,posts:0};}
      material={posts:posts.map(p=>({postRef:p.postRef,text:String(p.text||'').slice(0,500),isLiked:p.isLiked,commented:!!store.data.actions?.[`qzone-post-comment:${target.id}:${p.tid}`],comments:(p.comments||[]).filter(c=>!c.isSelf).slice(0,3).map(c=>({ref:c.ref,author:c.userId,name:c.name,text:String(c.text||'').slice(0,150)}))})),evidence:'实际可见的近期动态文字与内嵌评论样本；未读取的图片不能编造画面'};
      for(let i=0;i<posts.length&&spaceImages.length<2;i++){
        const actual=tools.spacePosts?.get(posts[i].postRef);
        for(const picture of actual?.images||[]){
          if(spaceImages.length>=2)break;
          try{
            tools.media.assertReadable();tools.sleep?.assertAwake();
            const data=await downloadImage(picture.url,(url,options)=>fetch(url,{...options,headers:{Referer:'https://user.qzone.qq.com/'}}));
            tools.media.assertReadable(data);const match=data.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/s);
            if(!match||match[2].length>2*1024*1024)continue;
            spaceImages.push({type:'image',mimeType:match[1],data:match[2]});
            (material.posts[i].imageNumbers||=[]).push(spaceImages.length);
          }catch(error){log('自主空间：本张图片未读取 · '+error.message);}
        }
      }
      allowed=config.social.qzoneEnabled===false?[]:['qzone_like_post','qzone_comment_post','qzone_reply_comment'].filter(n=>tools.schemas.some(s=>s.function.name===n));
    }else{
      const session=`qq:${target.kind==='private'?'user':'group'}:${target.id}`,latest=store.data.histories[session]?.at(-1)?.content||'';
      const sender=target.kind==='private'?target.id:latest.match(/[（(](\d+)[）)][:：]/)?.[1]||'0';
      const query=latest.replace(/^[^\n]{1,80}?[（(]\d+[）)][:：]/,'');
      material={context:conversationPacket(agent,{kind:target.kind,session,target:target.id,sender,text:query},{recentLimit:4,retrievalLimit:1}).text,previousQuestions:recentQuestionContext(store,session)};
      if(target.kind==='private'){
        if(target.followup){const u=f.user(target.id);u.followup.checked=true;f.store.save();tools.followupTarget={id:target.id,sentAt:u.followup.sentAt};material.pendingQuestion=u.followup.question;}
        tools.proactiveTarget=target.id;
      }
      allowed=plan.activity==='task'?[]:['qq_send_message'];
    }
    const canSchedule=!!tools.tasks&&target.canChat&&plan.activity!=='space'&&!target.followup&&pending<TASK_LIMIT;
    const decision=await agent.taskJSON('依据当前对象的资料决定是否行动，可actions为空。附图序号对应post.imageNumbers，只描述确实看见的画面，没读到的图片不能猜。可以随口分享一句，也可以开启具体的新话题，不靠提问维持聊天。previousQuestions是近7天问过的问题与后续消息；不论有没有回复，都不要换个说法再问。没有新内容可以不发。只返回 {"actions":[{"name":"允许行为","args":{}}],"task":{"prompt":"可选：稍后联系此对象的具体事项，最多200字","delayMinutes":30}}。task可省略；仅canSchedule为true时可安排10分钟至7天后的联系，不能安排泛泛自主任务、递归任务或机械催回复；不必每轮安排。最多2项即时行动，QQ最多1条80字短句；不泄露私聊、不催促施压、不编经历。QQ参数kind,target,text,expectReply；空间点赞postRef；评论postRef,text；回复commentRef,text。',{target,activity:plan.activity,allowed,canSchedule,...material},{kind:'social',maxTokens:450,images:spaceImages});
    if(!Array.isArray(decision.actions)||decision.actions.length>2||decision.actions.filter(a=>a.name==='qq_send_message').length>1||decision.actions.some(a=>a.name==='qq_send_message'&&(typeof a.args?.text!=='string'||a.args.text.length>80)))throw Error('社交行动格式无效');
    for(const action of decision.actions)if(action.name==='qq_send_message')action.args={kind:target.kind,target:target.id,text:action.args.text,expectReply:action.args.expectReply===true};
    const results=await executeActivityActions({decision,allowed,tools,store,epoch,targets:[target],log});
    if(plan.activity==='space')log(decision.actions.length?'自主空间：'+results.map(r=>`${({qzone_like_post:'点赞',qzone_comment_post:'评论',qzone_reply_comment:'回复'})[r.name]||r.name}${r.ok?(r.result?.skipped?'跳过（已处理）':'接口已确认'):'未完成'}`).join('、'):'自主空间：看完后选择不点赞、不评论');
    if(decision.task){assertMemoryEpoch(store,epoch);try{if(!canSchedule)throw Error('本轮不可安排任务');saveSocialTask({decision,target,tools,store,log});}catch(error){log('自主任务未安排：'+error.message);}}
    log('自主社交：2次请求，执行'+results.filter(x=>x.ok).length+'项，无额外复盘请求');return{calls:2,results};
  },{label:'自主社交'});
}
