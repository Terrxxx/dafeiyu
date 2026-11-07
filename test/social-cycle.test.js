import test from 'node:test';
import assert from 'node:assert/strict';
import { socialCycle } from '../src/social-cycle.js';
import { withAICycleBudget, reserveAICycle } from '../src/ai-cycle-budget.js';
function fixture(replies) {
  const calls=[],actions=[],user={affinity:10,trust:30,familiarity:40,memories:[]};
  const store={data:{histories:{},feelings:{users:{'123':user}}},audit(){},context:()=>[]};
  const agent={config:{},store,personality:{data:{interests:[],conversations:{}}},tools:{},feelings:{data:store.data.feelings,snapshot:()=>({users:[],mood:{}}),candidates:t=>t,canFollowup:()=>false,user:()=>user},taskJSON:async(p,d,o)=>{calls.push({p,d,o});return replies.shift();}};
  agent.feelings.data.mood={energy:65,joy:40};
  const tools={schemas:[{function:{name:'qq_send_message'}}],begin(){},components:{allowed:()=>true},call:async(n,a)=>{if(n==='qq_list_targets')return [{kind:'private',id:'123',name:'朋友'}];actions.push({n,a});return {};}};
  return {agent,tools,store,config:{qq:{enabled:true},social:{}},log(){},calls,actions};
}
test('自主聊天只调用两次模型，发送目标由程序固定，无工具回环',async()=>{
  const f=fixture([{activity:'chat',kind:'private',id:'123'},{actions:[{name:'qq_send_message',args:{target:'evil',text:'在干嘛呀'}}]}]);
  await socialCycle(f);assert.equal(f.calls.length,2);assert.ok(f.calls.every(c=>c.o.kind==='social'));assert.equal(f.actions[0].a.target,'123');
});
test('安静只请求一次，无效行动不执行、不重试',async()=>{
  const f=fixture([{activity:'quiet'}]);await socialCycle(f);assert.equal(f.calls.length,1);assert.equal(f.actions.length,0);
  const bad=fixture([{activity:'chat',kind:'private',id:'123'},{actions:[{name:'qq_set_avatar',args:{}}]}]);await assert.rejects(()=>socialCycle(bad),/越界/);assert.equal(bad.calls.length,2);assert.equal(bad.actions.length,0);
});
test('单轮预算跨嵌套请求生效，第三次和超大输入在发送前拒绝',()=>{
  withAICycleBudget(()=>{reserveAICycle({messages:[],max_tokens:100});reserveAICycle({messages:[],max_tokens:100});assert.throws(()=>reserveAICycle({}),/最多2次/);});
  withAICycleBudget(()=>assert.throws(()=>reserveAICycle({messages:[{role:'user',content:'中'.repeat(10000)}],max_tokens:100}),/10000/));
});
