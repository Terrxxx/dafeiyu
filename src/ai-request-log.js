import { usageCategory } from './usage-analytics.js';
let sequence = 0;
const names = { qq: 'QQ聊天', social: '自主社交', browse: 'B站浏览', shopping: '匿名逛店', inbox: 'B站消息', qzone: 'QQ空间', compaction: '上下文压缩', other: '其他任务' };
// A text heuristic, not a model tokenizer. Image payloads are counted separately.
export function estimateTokens(text) {
  const value = String(text || '');
  const cjk = (value.match(/[\u3000-\u9fff\uf900-\ufaff]/g) || []).length;
  return Math.ceil(cjk + (value.length - cjk) / 3.5);
}
export function requestShape(body = {}) {
  const parts = { system: 0, user: 0, assistant: 0, tool: 0, tools: estimateTokens(body.tools ? JSON.stringify(body.tools) : '') };
  let images = 0;
  for (const message of body.messages || []) {
    const role = message.role === 'developer' ? 'system' : message.role;
    let text = '';
    if (typeof message.content === 'string') text = message.content;
    else if (Array.isArray(message.content)) for (const block of message.content) {
      if (block.type === 'text') text += block.text || '';
      else if (['image_url', 'image'].includes(block.type)) images++;
    }
    if (Object.hasOwn(parts, role)) parts[role] += estimateTokens(text) + 4;
    if (message.tool_calls) parts.assistant += estimateTokens(JSON.stringify(message.tool_calls));
  }
  return { parts, images, total: Object.values(parts).reduce((a, b) => a + b, 0) };
}
export function requestLog(body, category = usageCategory(), write = console.log) {
  const id = `${process.pid}-${++sequence}`, started = Date.now(), shape = requestShape(body);
  const emit = text => { try { write(`[AI #${id}] ${text}`); } catch {} };
  emit(`发出 · ${names[category] || names.other} · 输入≈${shape.total.toLocaleString('en-US')} tokens${shape.images ? `＋${shape.images}张图片（图片用量未估算）` : ''} · 系统≈${shape.parts.system} / 用户≈${shape.parts.user} / 助手≈${shape.parts.assistant} / 工具结果≈${shape.parts.tool} / 工具定义≈${shape.parts.tools} · 输出上限${body?.max_tokens ?? '默认'}`);
  let ended = false;
  return (usage, status = '完成') => {
    if (ended) return;
    ended = true;
    const input = usage?.prompt_tokens ?? usage?.input_tokens, output = usage?.completion_tokens ?? usage?.output_tokens;
    const cached = usage?.prompt_cache_hit_tokens ?? usage?.prompt_tokens_details?.cached_tokens;
    const actual = Number.isFinite(input) && Number.isFinite(output);
    emit(`${status} · ${((Date.now() - started) / 1000).toFixed(1)}秒 · ${actual ? `实际输入${input} / 输出${output} / 合计${usage.total_tokens ?? input + output} tokens · 缓存命中${Number.isFinite(cached) ? cached : '未返回'}${Number.isFinite(cached)?` / 未命中${Math.max(0,input-cached)} · 命中率${input?(cached/input*100).toFixed(1):'0.0'}%`:''}` : '接口未返回完整用量；发出行仅为文本估算'}`);
  };
}
