import { sourceAddress } from './group-addressing.js';
import { qqIdentityReply } from './person-identity.js';
import { tryQQIllustration } from './qq-features.js';
import { confirmedMessage } from './qq-processing.js';

const question = /[?？]|[吗嘛呢][。！!~～\s]*$|怎么|为什么|为啥|什么|哪[个里儿些种]|多少|几点|多久|能不能|可不可以|有没有|是不是|要不要|会不会/;

export function groupReplyTargets(msg) {
  if (msg.kind !== 'group' || msg.unreadReview) return [];
  const bySender = new Map();
  for (const source of msg.sources || [msg]) {
    const text = String(source.text || '').trim();
    const address = sourceAddress(source, msg);
    if (!['self', 'open'].includes(address) || !question.test(text)) continue;
    const sender = String(source.sender);
    let item = bySender.get(sender);
    if (!item) {
      item = { ref: String(bySender.size + 1), source, required: false, questions: [] };
      bySender.set(sender, item);
    }
    item.questions.push(text);
    if (address === 'self' || !item.required) item.source = source;
    item.required ||= address === 'self';
  }
  return bySender.size > 1 ? [...bySender.values()] : [];
}

function collectReplies(proposed, targets, result) {
  if (!Array.isArray(proposed)) return;
  const allowed = new Set(targets.map(item => item.ref));
  for (const item of proposed) {
    const ref = String(item?.ref);
    if (!allowed.has(ref) || result.has(ref) || typeof item?.reply !== 'string' || !item.reply.trim()) continue;
    result.set(ref, { text: item.reply.trim(), illustration: item.illustration });
  }
}

export async function replyToGroupBatch(targets, result, msg, {
  agent, tools, throttle, policy, energyMode, epoch, validate, log, mayIllustrate,
}) {
  const replies = new Map();
  for (const item of targets) {
    if (!item.required) continue;
    const text = qqIdentityReply({ ...msg, ...item.source, sources: [item.source] }, policy);
    if (text) replies.set(item.ref, { text });
  }
  const relevant = targets.filter(item => item.required || result.engage === true);
  collectReplies(result.replies, relevant, replies);
  const missing = relevant.filter(item => item.required && !replies.has(item.ref));
  if (missing.length) {
    validate();
    try {
      const supplement = await agent.taskJSON(
        '本轮群聊漏答了以下已确认对你提问的人。只回答他们，每个 ref 都要有简短独立的答复。依次回应同一人的多个问题；无法确认的如实说明。只返回 {"replies":[{"ref":"1","reply":"短回答"}]}。不透露私聊。',
        { questions: missing.map(item => ({ ref: item.ref, text: item.questions.join('\n').slice(0, 1600) })) },
        { kind: 'qq', maxTokens: Math.max(180, missing.length * 55 + 100) },
      );
      collectReplies(supplement.replies, missing, replies);
    } catch (error) {
      log('QQ 群聊补答生成未完成：' + error.message);
    }
    validate();
    for (const item of missing) {
      if (!replies.has(item.ref)) replies.set(item.ref, { text: '我看到啦，这个我还没想好。' });
    }
  }
  if (!replies.size) return false;

  await throttle.wait(msg.session);
  const original = tools.current;
  let sent = 0;
  let attemptedImage = false;
  try {
    for (const item of targets) {
      const reply = replies.get(item.ref);
      if (!reply) continue;
      validate();
      const source = item.source;
      const quote = !!source.id;
      tools.begin(msg.session, {
        ...msg, ...source, sources: [source], key: `qq-reply:${msg.session}:${source.id || item.ref}`, memoryEpoch: epoch,
      });
      try {
        if (!attemptedImage && energyMode !== 'fog' && reply.illustration && mayIllustrate(source)) {
          attemptedImage = true;
          const imageStatus = await tryQQIllustration(tools, { prompt: reply.illustration, text: reply.text, quote, log });
          if (imageStatus) {
            if (imageStatus === 'sent') sent++;
            continue;
          }
        }
        const receipt = await tools.call('qq_reply_current', { text: reply.text, quote, mentionSender: !quote });
        if (confirmedMessage(receipt)) sent++;
      } catch (error) {
        log('QQ 群聊逐人回复未完成：' + error.message);
      }
    }
  } finally {
    tools.current = original;
  }
  log(`QQ 群聊逐人回复 · 已确认 ${sent}/${replies.size} 位`);
  return true;
}
