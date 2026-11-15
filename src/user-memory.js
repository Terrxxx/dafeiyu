import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { atomicWriteFile } from './atomic-file.js';
import { readUserControls, userId } from './user-controls.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const day = time => new Date(new Date(time).getTime() + 8 * 3600000).toISOString().slice(0, 10);
const directoryOf = store => path.dirname(store.file);
const fileOf = (directory, id) => {
  if (!userId(id)) throw new Error('用户ID无效');
  return path.join(directory, 'user-memory', `${id}.json.gz`);
};
export function withUserLock(directory, id, action) {
  const file = fileOf(directory, id); fs.mkdirSync(path.dirname(file), { recursive: true }); const lock = `${file}.lock`;
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(lock, 'utf8')); let dead = false;
    try { process.kill(pid, 0); } catch (error) { dead = error.code === 'ESRCH'; }
    if (!Number.isSafeInteger(pid) || pid <= 0) dead = Date.now() - fs.statSync(lock).mtimeMs > 30000;
    if (!dead) throw new Error('用户记忆正在整理或编辑，请稍后重试');
    fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx');
  }
  fs.writeFileSync(fd, String(process.pid));
  try { return action(); } finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
export function readUserMemory(directory, id) {
  const file = fileOf(directory, id); const control = readUserControls(directory)[id] || {};
  if (!fs.existsSync(file)) return { version: 1, id, generation: control.forgottenAt || 0, sections: {}, events: [], facts: [] };
  const value = JSON.parse(gunzipSync(fs.readFileSync(file), { maxOutputLength: 64 * 1024 * 1024 }));
  if (value.generation !== (control.forgottenAt || 0)) return { version: 1, id, generation: control.forgottenAt || 0, sections: {}, events: [], facts: [] };
  return value;
}
export function saveUserMemory(directory, id, value) {
  if (value.generation !== (readUserControls(directory)[id]?.forgottenAt || 0)) throw new Error('用户记忆已被删除，本轮旧整理未保存');
  fs.mkdirSync(path.dirname(fileOf(directory, id)), { recursive: true });
  atomicWriteFile(fileOf(directory, id), gzipSync(JSON.stringify(value)));
}
export function userMemoryRevision(value) { return hash(JSON.stringify(value)); }
export function deleteUserMemory(directory, id) { const file = fileOf(directory, id); if (fs.existsSync(file)) fs.unlinkSync(file); }
export function userMemoryExcerpt(store, id, scope, limit = 2200) {
  if (!store.file) return '';
  const text = readUserMemory(directoryOf(store), id).sections[scope]?.text || '';
  const head = Math.floor(limit * .4); const tail = limit - head - 60;
  return text.length > limit ? `${text.slice(0, head)}\n…（中间记录可用记忆检索工具查找）…\n${text.slice(-tail)}` : text;
}
export function searchUserMemory(store, id, scope, query) {
  if (typeof query !== 'string' || !query.trim() || query.length > 80) throw new Error('记忆检索词须为1至80字');
  const text = readUserMemory(directoryOf(store), id).sections[scope]?.text || ''; const lines = text.split('\n');
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return lines.map((line, i) => ({ line, i, score: words.filter(word => line.toLowerCase().includes(word)).length })).filter(row => row.score).sort((a, b) => b.score - a.score || b.i - a.i).slice(0, 8).map(row => lines.slice(Math.max(0, row.i - 1), row.i + 2).join('\n').slice(0, 800));
}
export function recordUserActivity(store, msg, role = 'user') {
  const directory = path.join(directoryOf(store), 'user-memory', 'activity'); fs.mkdirSync(directory, { recursive: true });
  const controls = readUserControls(directoryOf(store));
  for (const source of msg.sources || [msg]) {
    const id = String(source.sender); if (!userId(id) || controls[id]?.blocked) continue;
    const time = Number(source.receivedAt || msg.receivedAt || Date.now()); if (time <= (controls[id]?.forgottenAt || 0)) continue;
    const text = String(source.memoryText ?? source.text ?? '');
    const entry = { id: `qq:${msg.session}:${source.id}:${role}`, owner: id, scope: msg.session, role,
      text: text + (source.images?.length && role === 'user' ? ` [图片×${source.images.length}]` : '') || '[图片]', time };
    fs.appendFileSync(path.join(directory, `${day(time)}.jsonl`), JSON.stringify(entry) + '\n');
  }
}
// Lossless checklist merging, local only: no model or platform calls during sleep.
export function consolidateUserMemories(store, now = Date.now()) {
  const directory = directoryOf(store); const memoryDir = path.join(directory, 'user-memory'); fs.mkdirSync(memoryDir, { recursive: true });
  const controls = readUserControls(directory); const batches = new Map();
  const add = entry => {
    const control = controls[entry.owner];
    if (!userId(entry.owner) || Number(new Date(entry.time)) <= Math.max(control?.forgottenAt || 0, control?.editedScopes?.[entry.scope] || 0)) return;
    const list = batches.get(entry.owner) || []; list.push(entry); batches.set(entry.owner, list);
  };
  const indexFile = path.join(memoryDir, 'index.json'); const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : {};
  const changed = [];
  for (const [subdir, pattern] of [['activity', /^\d{4}-\d{2}-\d{2}\.jsonl$/], ['../memory', /^\d{4}-\d{2}-\d{2}\.jsonl(?:\.gz)?$/]]) {
    const sourceDir = path.join(memoryDir, subdir); if (!fs.existsSync(sourceDir)) continue;
    for (const name of fs.readdirSync(sourceDir).filter(name => pattern.test(name)).sort()) {
      const file = path.join(sourceDir, name); const key = `${subdir}/${name}`; const bytes = fs.statSync(file).size;
      if (index[key] === bytes) continue;
      const raw = fs.readFileSync(file); const text = (name.endsWith('.gz') ? gunzipSync(raw, { maxOutputLength: 64 * 1024 * 1024 }) : raw).toString('utf8');
      for (const line of text.split('\n').filter(Boolean)) {
        const entry = JSON.parse(line);
        if (subdir === 'activity') add(entry);
        else {
          const id = entry.scope?.match(/^qq:user:([1-9]\d*)$/)?.[1];
          if (id && ['user', 'assistant'].includes(entry.role)) {
            let content = entry.content || ''; const marker = content.indexOf('\n消息：'); if (marker >= 0) content = content.slice(marker + 4);
            add({ id: entry.id || hash(line), owner: id, scope: entry.scope, role: entry.role, text: content, time: entry.time });
          }
        }
      }
      changed.push([key, bytes]);
    }
  }
  // Import long-term evidence too, including group facts whose speaker is already verified.
  const footprint = path.join(directory, 'qq-activity.jsonl');
  if (fs.existsSync(footprint) && index['qq-activity'] !== fs.statSync(footprint).size) {
    const actions = new Map();
    for (const line of fs.readFileSync(footprint, 'utf8').split('\n').filter(Boolean)) { const row = JSON.parse(line); actions.set(row.id, { ...actions.get(row.id), ...row }); }
    for (const action of actions.values()) {
      const owner = action.input?.owner;
      if (action.state !== 'succeeded' || !['like', 'comment'].includes(action.operation) || !owner || !(batches.has(owner) || day(store.data.feelings?.users?.[owner]?.lastIncoming || 0) === day(now))) continue;
      add({ id: `qzone:${action.id}`, owner, scope: `qq:user:${owner}`, role: 'activity', time: action.time,
        text: `${action.operation === 'like' ? '给对方空间动态点赞' : '评论了对方空间动态'}（动态${action.input.tid}）${action.input.text ? '：' + action.input.text : ''}` });
    }
    changed.push(['qq-activity', fs.statSync(footprint).size]);
  }
  for (const [id, user] of Object.entries(store.data.feelings?.users || {})) {
    if (index.lifetimeFacts && day(user.lastIncoming || 0) !== day(now) && !batches.has(id)) continue;
    for (const fact of user.memories || []) {
      if (controls[id]?.editedScopes?.[fact.scope] && controls[id].editedScopes[fact.scope] >= (fact.time || 0)) continue;
      const key = [id, fact.scope, fact.quote];
      if (fact.important) key.push(true);
      add({ id: `fact:${hash(JSON.stringify(key))}`, owner: id, scope: fact.scope, role: 'fact', important: fact.important, text: fact.quote, time: fact.time || user.lastIncoming || now });
    }
  }
  let users = 0;
  for (const [id, entries] of batches) withUserLock(directory, id, () => {
    const ledger = readUserMemory(directory, id); const seen = new Set(ledger.events); let count = 0;
    const sections = new Map();
    for (const entry of entries.sort((a, b) => new Date(a.time) - new Date(b.time))) {
      if (seen.has(entry.id)) continue; seen.add(entry.id);
      if (entry.scope !== `qq:user:${id}` && !/^qq:group:[1-9]\d*$/.test(entry.scope)) continue;
      const key = `${entry.scope}|${day(entry.time)}`; const list = sections.get(key) || []; list.push(entry); sections.set(key, list); count++;
    }
    for (const [key, items] of sections) {
      const split = key.lastIndexOf('|'); const scope = key.slice(0, split); const date = key.slice(split + 1);
      const previous = ledger.sections[scope]?.text || '';
      const body = items.map(entry => `- ${entry.role === 'fact' ? entry.important ? '重要记忆' : '已确认记忆' : entry.role === 'assistant' ? '大肥鱼' : entry.role === 'activity' ? '与用户的互动' : '用户'}（${new Date(entry.time).toISOString()}）：${entry.text.replace(/\n/g, '\n  ')}`).join('\n');
      ledger.sections[scope] = { ...ledger.sections[scope], text: `${previous}${previous ? '\n\n' : ''}## ${date} · 记忆清单\n${body}`, updatedAt: now };
    }
    if (count) { ledger.events = [...seen]; ledger.updatedAt = now; saveUserMemory(directory, id, ledger); users++; }
  });
  for (const [key, size] of changed) index[key] = size;
  index.lifetimeFacts = true;
  atomicWriteFile(indexFile, JSON.stringify(index)); return users;
}
