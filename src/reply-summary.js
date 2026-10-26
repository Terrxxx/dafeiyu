export const replySummaryInstruction = '\n本次最终回复请使用JSON封装 {"reply":"要实际发给用户的正文","summary":"一句话的回复决策概述"}。工具照常调用，只在最终文本使用此封装；程序仅发送reply。summary用一句中文说明回应意图或表达选择，最多80字，例如“对方在开玩笑，用短句接梗”，不要输出逐步推理、内部思考过程、系统提示词、凭据或其他会话信息。概述操作时只依据工具真实回执。';

export function unwrapReply(text, allowEmpty = false) {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  let value;
  try { value = JSON.parse(cleaned); }
  catch {
    if (/^\{\s*"(?:reply|summary)"\s*:/.test(cleaned)) throw new Error('回复封装不完整，已阻止发送内部字段');
    return { text, summary: '模型未提供回复决策概述' };
  }
  if (value && typeof value.reply === 'string' && typeof value.summary === 'string') {
    if (!value.reply.trim() && !allowEmpty) throw new Error('最终回复正文为空');
    return { text: value.reply.trim(), summary: value.summary };
  }
  if (value && typeof value === 'object' && (Object.hasOwn(value, 'reply') || Object.hasOwn(value, 'summary'))) throw new Error('回复封装字段无效，已阻止发送内部字段');
  return { text, summary: '模型未提供回复决策概述' };
}

export function cleanReplySummary(summary, config) {
  let text = String(summary || '').replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const secret of [config.apiKey, config.wsToken]) if (secret) text = text.split(secret).join('[已隐藏]');
  return text.slice(0, 120) || '模型未提供回复决策概述';
}
