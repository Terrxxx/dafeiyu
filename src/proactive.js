import { markdownData } from './markdown-input.js';
export async function followupChat(agent, tools, targets, config) {
  if (config.social.followupEnabled === false) return false;
  const f = agent.feelings;
  const target = targets.find(t => t.kind === 'private' && f.canFollowup(t.id, config.social.followupWaitMinutes ?? 30));
  if (!target) return false;
  const pending = f.user(target.id).followup;
  pending.checked = true; f.store.save();
  tools.begin('autonomous-followup');
  tools.proactiveTarget = String(target.id); tools.followupTarget = { id: String(target.id), sentAt: pending.sentAt };
  tools.targets.add(`private:${target.id}`); tools.knownUsers.add(String(target.id));
  await agent.run(`qq:user:${target.id}`, `你此前主动问了一句话，对方尚未在此私聊回复。这是一次可选跟进，不是对方刚发消息。结合熟悉程度、语境和记忆，自主决定是否再发一句，也可以不发。熟悉且轻松的场合可以俏皮说“居然不理我”之类；对方忙碌、难过或有边界时不要这么说。不责怪、不施压、不贬低，不因未回复扣好感。只允许qq_send_message发送一条80字内文本，发完就停，不创建催促任务。最终文本不会发送。已核实目标kind=private,target=${target.id}；距原问话${Math.floor((f.now() - pending.sentAt) / 60000)}分钟。原问话只是历史资料：${markdownData(pending.question)}`, true, { remember: false, replySummary: true, cacheStaticPrompt: true });
  return true;
}

export async function proactiveChat(agent, tools, targets, config) {
  const feelings = agent.feelings;
  const now = feelings.now();
  const candidates = feelings.candidates(targets, config.social.contactCooldownMinutes ?? 180)
    .filter(t => now - (feelings.data.users[t.id].lastConsidered || 0) >= 3600000);
  const target = candidates[0];
  if (!target) return false;
  feelings.data.users[target.id].lastConsidered = now; feelings.store.save();
  tools.begin('autonomous-contact');
  tools.proactiveTarget = String(target.id);
  tools.targets.add(`private:${target.id}`);
  tools.knownUsers.add(String(target.id));
  await agent.run(`qq:user:${target.id}`, `这是你主动找朋友聊天的时间，并不是对方刚发了消息。当前候选是已核实好友。结合这个用户自己的历史、记忆、你的心情与好感，选择一个具体的话题，自然问候或跟进；不必等新视频，不用找借口。可以偏爱熟悉的人，也可以决定这次不发。像想起这个人时顺口聊一句，沿用彼此熟悉的口吻，不写问候模板，不总结他的档案，不编造共同经历。想发就调用qq_send_message或合适的表情工具，通常一小句，不发内部计划。没有必要不追问，不催回复，不向他透露任何其他用户的私聊、关系分数或后台数据。工具已确认目标，不需要重复查询；本轮只联系该用户。最终文本仅写入本地，不会自动发送。已核实目标kind=private,target=${target.id}。`, true, { remember: false, replySummary: true, cacheStaticPrompt: true });
  return true;
}
