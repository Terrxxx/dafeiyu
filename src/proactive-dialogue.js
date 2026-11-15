import path from 'node:path';
import { readUserControls } from './user-controls.js';

const day = 86400000;
const retention = 7 * day;
const stripUrl = text => text.replace(/https?:\/\/[^\s，。！？、]+/gi, '');
const plain = text => String(text || '').normalize('NFKC')
  .replace(/^\[语音\]\s*/, '').replace(/^[^\n]{1,80}?\(\d+\)[:：]/, '').trim();

function clauses(text) {
  return String(text || '').match(/(?:https?:\/\/[^\s，。！？、]+|[^\r\n。！？!?；;])+[。！？!?；;]*|[\r\n。！？!?；;]+/g) || [];
}

function question(text) {
  const value = stripUrl(plain(text));
  if (/[?？]/.test(value)) return true;
  if (/^(?:我(?:也)?(?:不知道|不确定|忘了|知道)|[他她]问|你刚(?:才)?问)/.test(value)) return false;
  return /(?:吗|么|没|不|什么|哪天|多少)(?:呀|啊|啦|呢)?[。！!~～…\s\p{Extended_Pictographic}]*$|(?:怎[么样]|咋样|如何|何时|什么时候|几点|几[天个次岁]|多少|啥|哪[里儿个家]|为什么|在干嘛|做什么|忙什么|忙啥|有没[有]?|能不能|可不可以|想不想|是不是|要不要|好不好)|^(?:跟我|给我|快)?(?:说说|讲讲|告诉我|分享一下)/u.test(value);
}

const startsQuestion = /^(?:你(?:呢|最近|现在|今天|有没|是[不否]|能不能|想不想|要不要)|(?:那|所以|对了|不过)[，、, ]*你|那(?:件事|边|个)|有没有|最近|现在|今天|什么时候|怎么|为啥|想不想)/;
const stripPrefix = /^(?:(?:爸爸|爸|老爸|主人|哥|姐姐|朋友)[，、,\s]+|(?:对了|话说|所以|那|不过)[，、,\s]+)+/;
const filler = /(?:你这两天|你这几天|这两天|这几天|这阵子|这段时间|最近|现在|今天|到底|其实|一下子|一下|可不可以|能不能|想不想|有没有|是不是|要不要|你那边|你最近)/g;
function descriptor(text) {
  const value = stripUrl(plain(text)).replace(stripPrefix, '');
  const compact = value.toLowerCase().replace(/[\p{P}\p{S}\s]/gu, '').replace(filler, '')
    .replace(/^(?:你|咱们|我们)+/, '').replace(/(?:吗|么|呢|呀|啊|嘛|啦|呐|不|没|了)+$/, '');
  let topic = '', subject = '';
  const body = value.replace(/^(?:今天|现在|最近|这几天|这两天|你|都){0,4}/, '');
  if (/^(?:吃饭|吃过饭|吃了饭|开饭|用餐|吃饱|吃了吗|吃了没|吃没吃|饭吃了|晚饭吃了|午饭吃了|早餐吃了)/.test(body)) topic = 'meal';
  else if (/^(?:在忙|忙[啥么]|忙什么|忙不忙|做[啥么]|做什么|干[嘛啥]|在干|过得|过的|有?什么新鲜事|有?啥新鲜事|有什么开心|有啥开心)/.test(body)) topic = 'daily-update';
  else if (/^(?:你)?(?:心情|情绪|感觉)(?:还|如何|怎么|咋|好|差|有点|一点)|^(?:你)?(?:开心|高兴|难过|伤心)(?:吗|么|不|没|呀|呢|吧|了吗)/.test(value)) topic = 'mood';
  else if (/进[展度]|后续|后来|然后呢|接下来|结果|结局|弄完|搞定|完成|怎么样|咋样|如何|顺利|还好吗|好了吗|怎样|做得怎么样/.test(value)) {
    topic = 'progress';
    subject = compact.replace(/(?:进[展度]|后续|后来|然后|接下来|结果|结局|弄完|搞定|完成|怎么样|咋样|如何|顺利|还好|怎样|做得|弄得|进行得|还在|一点|什么|有啥|有新|有没有|现在|这事|这件事|那件事|那事|那边|的|目前|到哪一步|到哪|了吗|还|有|了)/g, '');
  }
  return { compact, topic, subject };
}

function questions(text) {
  return clauses(text).flatMap(chunk => {
    if (!question(chunk)) return [];
    const pieces = chunk.split(/[，,、]/);
    const last = pieces.at(-1);
    const prefix = pieces.slice(0, -1).join('，').trim();
    const keepPrefix = prefix && !question(prefix) &&
      !/^(?:爸(?:爸)?|老爸|主人|朋友|对了|话说|所以|那|不过)$/.test(prefix) &&
      (startsQuestion.test(last.trim()) || /(?:了|呀|啦|哈|好|可以|不错|耶)$/.test(prefix) && question(last));
    const at = keepPrefix ? chunk.lastIndexOf(last) : 0;
    const value = chunk.slice(at).trim();
    const result = descriptor(value);
    return result.compact.length >= 2 || result.topic ? [{ ...result, at, value }] : [];
  });
}

function grams(text) {
  return new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2)));
}
function overlap(a, b) {
  const x = grams(a), y = grams(b);
  return x.size && y.size ? 2 * [...x].filter(value => y.has(value)).length / (x.size + y.size) : 0;
}
function sameQuestion(a, b) {
  if (!a.compact || !b.compact) return false;
  if (a.compact === b.compact) return true;
  if (a.topic && a.topic === b.topic) {
    if (a.topic !== 'progress') return true;
    if (!a.subject && !b.subject) return true;
    if (a.subject && b.subject && (a.subject === b.subject || Math.min(a.subject.length, b.subject.length) >= 2 &&
        (a.subject.includes(b.subject) || b.subject.includes(a.subject) || overlap(a.subject, b.subject) >= 0.6))) return true;
  }
  return Math.min(a.compact.length, b.compact.length) >= 4 && overlap(a.compact, b.compact) >= 0.64;
}

const genericTopic = topic => ['meal', 'daily-update', 'mood'].includes(topic);

function scopeControl(store, scope) {
  const owner = scope.match(/^qq:user:(\d+)$/)?.[1];
  return owner && store.file ? readUserControls(path.dirname(store.file))[owner] || {} : {};
}

export function dialogueView(store, scope, now = Date.now()) {
  const control = scopeControl(store, scope);
  if (control.blocked) return [];
  const cutoff = Math.max(now - retention, control.forgottenAt || 0, control.editedScopes?.[scope] || 0);
  const history = (store.data.histories?.[scope] || []).filter(row => Date.parse(row.time) > cutoff);
  const result = (store.data.proactiveDialogue?.[scope] || []).filter(row => row.askedAt > cutoff && row.askedAt <= now);
  for (let index = 0; index < history.length; index++) {
    const row = history[index], askedAt = Date.parse(row.time);
    if (row.role !== 'assistant' || askedAt > now || /^\[已撤回自己消息/.test(row.content) || !questions(row.content).length ||
        result.some(item => plain(item.text) === plain(row.content) && Math.abs(item.askedAt - askedAt) < 5000)) continue;
    const next = scope.startsWith('qq:user:') ? history.slice(index + 1).find(item => item.role === 'user') : null;
    result.push({ text: row.content.slice(0, 500), askedAt,
      ...(next ? { response: plain(next.content).slice(0, 120), respondedAt: Date.parse(next.time) } : {}) });
  }
  return result.sort((a, b) => b.askedAt - a.askedAt).slice(0, 96);
}

export function recentQuestionContext(store, scope, limit = 5) {
  const entries = [];
  const now = Date.now();
  for (const row of dialogueView(store, scope, now)) {
    for (const item of questions(row.text)) {
      if (entries.some(entry => sameQuestion(entry.item, item))) continue;
      entries.push({ item, question: item.value.slice(0, 64), daysAgo: Math.floor((now - row.askedAt) / day),
        ...(row.response ? { nextMessage: row.response.slice(0, 60) } : {}) });
      if (entries.length >= limit) return entries.map(({ item: _item, ...entry }) => entry);
    }
  }
  return entries.map(({ item: _item, ...entry }) => entry);
}

export function withoutRepeatedQuestions(store, scope, text, { proactive = false, now = Date.now() } = {}) {
  const chunks = clauses(text);
  if (!chunks.some(question)) return text;
  const previous = dialogueView(store, scope, now).flatMap(row =>
    questions(row.text).map(item => ({ ...item, askedAt: row.askedAt })));
  const seen = [];
  const filtered = chunks.map(chunk => {
    const [candidate] = questions(chunk);
    if (!candidate) return chunk;
    const repeated = seen.some(item => sameQuestion(candidate, item)) || previous.some(item => {
      const window = proactive || !genericTopic(candidate.topic) ? retention : day;
      return now - item.askedAt < window && sameQuestion(candidate, item);
    });
    if (repeated) return chunk.slice(0, candidate.at).replace(/[，,、]\s*$/, '。');
    seen.push(candidate);
    return chunk;
  }).join('');
  return filtered === text ? text : filtered.trim();
}

export function recordQuestion(store, scope, text, now = Date.now()) {
  if (!questions(text).length) return;
  const all = store.data.proactiveDialogue ||= {};
  const rows = (all[scope] || []).filter(row => now - row.askedAt < retention);
  all[scope] = [...rows, { text: String(text).slice(0, 500), askedAt: now }].slice(-64);
}

export function noteDialogueResponse(store, msg, source) {
  const scope = msg.session, rows = store.data.proactiveDialogue?.[scope];
  if (scope !== `qq:user:${source.sender}` || !rows?.length) return;
  const now = Date.now(), receivedAt = source.receivedAt || msg.receivedAt || now;
  const row = rows.findLast(item => !item.respondedAt && receivedAt >= item.askedAt && receivedAt - item.askedAt < retention);
  if (row) {
    row.respondedAt = receivedAt;
    row.response = String(source.text || '').slice(0, 120);
  }
}
