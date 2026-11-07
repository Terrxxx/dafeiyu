export function lifeActivities(config,tools){return ['reflect',...(config.bilibili?.enabled&&tools.components.allowed('bili_popular')?['browse']:[]),...(tools.components.allowed('mcp__dafeiyu__shopping_search')?['shopping']:[])];}
export function saveSelfTask(task,{tools,store,config,log}){
 if(!tools.tasks||!task||!lifeActivities(config,tools).includes(task.kind)||typeof task.prompt!=='string'||!task.prompt.trim()||task.prompt.length>200||!Number.isFinite(task.delayMinutes)||task.delayMinutes<10||task.delayMinutes>10080)throw Error('自己的日程需要可用活动、具体内容及10分钟至7天的时间');
 if((store.data.tasks||[]).some(t=>t.status==='pending'&&t.autonomousActivity===task.kind))throw Error('同类自主日程还在等待执行');
 const result=tools.tasks.create('autonomous-social',task.prompt,task.delayMinutes,null,task.kind);log('自主日程：已安排「'+task.prompt.slice(0,60)+'」');return result;
}
export async function executeSelfTask(task,{agent,tools,store,config,log,browse,shopping}){
 if(!lifeActivities(config,tools).includes(task.autonomousActivity))return'当前对应能力已关闭，本次未执行';
 if(task.autonomousActivity==='browse'){await browse();return'已按当前设置执行自主视频浏览，实际行为见B站足迹';}
 if(task.autonomousActivity==='shopping'){await shopping();return'已按当前设置执行自主逛店，实际行为见活动记录';}
 const result=await agent.taskJSON('完成自己安排的整理事项。只返回 {"note":"最多100字有依据的简短结论"}；不是给用户的回复，不调用工具，不编造经历，不保存推理过程。',{task:task.prompt,interests:agent.personality.data.interests.filter(x=>x.samples>=3).slice(-4),mood:agent.feelings.snapshot('autonomous-social').mood},{kind:'social',persona:false,maxTokens:160});
 if(typeof result.note!=='string'||result.note.length>100)throw Error('日程整理结果格式无效');
 store.data.lifeNotes=[...(store.data.lifeNotes||[]),{taskId:task.id,note:result.note,time:Date.now()}].slice(-50);store.save();log('自主日程：已整理自己的近期想法');return result.note;
}
