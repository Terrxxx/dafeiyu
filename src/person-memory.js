import { memoryDateLabel, notableMemory } from './memory-age.js';
import { memoryBody, memoryTimeRange, beijingDay, selfIdentity } from './memory-retrieval.js';

const labels = { 用户: 'user', 大肥鱼: 'assistant', 已确认记忆: 'fact', 重要记忆: 'fact', 与用户的互动: 'activity' };
const entryPattern = /^- (用户|大肥鱼|已确认记忆|重要记忆|与用户的互动)[（(](\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)[）)][:：](.*)$/;

export function personMemoryRows(ledger) {
  const rows = [];
  for (const [scope, section] of Object.entries(ledger.sections || {})) {
    let current;
    for (const line of String(section.text || '').split('\n')) {
      if (/^## \d{4}-\d{2}-\d{2} · 记忆清单$/.test(line)) {
        current = undefined;
        continue;
      }
      const match = line.match(entryPattern);
      if (match) {
        current = { scope, role: labels[match[1]], time: match[2], content: match[3], important: match[1] === '重要记忆', editedAt: section.editedAt };
        rows.push(current);
      } else if (current && line.startsWith('  ')) {
        current.content += '\n' + line.slice(2);
      } else if (line.trim()) {
        current = undefined;
        rows.push({ scope, role: 'note', time: section.editedAt || section.updatedAt, content: line, editedAt: section.editedAt });
      }
    }
  }
  return rows;
}

export function personMemoryOverview(ledger, page, now = Date.now()) {
  const combined = new Map();
  for (const row of personMemoryRows(ledger)) {
    const content = memoryBody(row.content);
    if (!content) continue;
    const important = row.important || notableMemory(content) || selfIdentity(row);
    const { day, time } = memoryDateLabel(row.time, now, important);
    const key = JSON.stringify([day, row.role, content]);
    const previous = combined.get(key);
    const stamp = new Date(row.time).getTime() || 0;
    if (!previous) {
      combined.set(key, { day, time, stamp, role: row.role, content, important, count: 1,
        origins: new Set([row.scope.startsWith('qq:group:') ? '群聊' : '私聊']) });
    } else {
      previous.count++;
      previous.origins.add(row.scope.startsWith('qq:group:') ? '群聊' : '私聊');
      if (stamp > previous.stamp) Object.assign(previous, { stamp, time });
    }
  }
  const sorted = [...combined.values()].sort((a, b) => b.stamp - a.stamp);
  const size = 16;
  const pages = Math.max(1, Math.ceil(sorted.length / size));
  page = Math.max(1, Math.min(pages, Number.isSafeInteger(page) ? page : 1));
  const records = sorted.slice((page - 1) * size, page * size)
    .map(({ stamp, origins, ...row }) => ({ ...row, origins: [...origins] }));
  return { page, pages, total: sorted.length, updatedAt: ledger.updatedAt, records };
}

const filler = new Set(['什么', '记得', '记忆', '之前', '以前', '说过', '聊天', '私聊', '群聊', '知道', '今天', '昨天', '前天', '那个', '这个', '我们', '咱们', '你说', '说的', '的事', '怎么', '怎样', '现在', '一下', '就是', '可以', '好的', '你好']);
export function memoryTerms(query) {
  const text = memoryBody(query).toLowerCase();
  if (/^(?:你好|早安|晚安|早上好|晚上好|在吗|收到|谢谢|哈哈+|嗯+|好的?)[呀啊哦～~\s，。！？!?]*$/.test(text)) return [];
  const terms = text.match(/[a-z0-9_]{2,}/g) || [];
  for (const match of text.matchAll(/(?=([\p{Script=Han}]{2}))/gu)) terms.push(match[1]);
  return [...new Set(terms)].filter(term => !filler.has(term)).slice(0, 40);
}

export function rankPersonMemory(rows, query, terms, now, control) {
  const targetDay = memoryTimeRange(query, now);
  const dateOnly = targetDay && !memoryTerms(query.replace(/20\d{2}[-/年]\d{1,2}[-/月]\d{1,2}日?|大前天|昨晚|昨夜|今早|今晚|还记得|记得|聊了|聊过|说了|说过|做了|哪些事|发生了|什么/g, ' ')).length;
  const seen = new Set();
  const ranked = [];
  for (const row of rows) {
    const stamp = new Date(row.time).getTime();
    if (!Number.isFinite(stamp) || stamp <= (control.forgottenAt || 0)) continue;
    const edited = control.editedScopes?.[row.scope] || 0;
    if (stamp <= edited && !row.editedAt) continue;
    if (targetDay && beijingDay(stamp) !== targetDay) continue;
    const body = memoryBody(row.content).replace(/\n图片\d+[：:][\s\S]*$/, '').trim();
    if (!body || /密码|密钥|验证码|身份证|cookie|sessdata|bearer|https?:\/\/|秘密|保密|暗号|别告诉|不要告诉|别在群|不要在群/i.test(body)) continue;
    const normalized = body.toLowerCase();
    const matches = terms.filter(term => normalized.includes(term));
    const exact = terms.length === 1 && memoryBody(query).trim() === terms[0];
    if (!dateOnly && matches.length < 2 && !(matches.length === 1 && (exact || matches[0].length >= 4))) continue;
    const position = matches.length ? normalized.indexOf(matches.sort((a, b) => b.length - a.length)[0]) : 0;
    const start = Math.max(0, position - 36);
    const content = (start ? '…' : '') + body.slice(start, start + 145) + (body.length > start + 145 ? '…' : '');
    const important = row.important || notableMemory(body) || selfIdentity(row);
    const date = memoryDateLabel(stamp, now, important);
    ranked.push({ content, ...date, role: row.role, stamp, score: matches.length });
  }
  return ranked.sort((a, b) => b.score - a.score || b.stamp - a.stamp).filter(row => {
    if (seen.has(row.content)) return false;
    seen.add(row.content);
    return true;
  }).slice(0, 2);
}
