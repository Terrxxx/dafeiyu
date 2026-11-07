import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { consolidateUserMemories } from './user-memory.js';
import { syncUserControls } from './user-controls.js';

export const memoryDay = time => new Date(new Date(time).getTime() + 8 * 3600000).toISOString().slice(0, 10);
export function archiveMemory(store, scope, entry) {
  const directory = path.join(path.dirname(store.file), 'memory');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${memoryDay(entry.time)}.jsonl`);
  fs.appendFileSync(file, JSON.stringify({ scope, ...entry }) + '\n');
}

function excerpt(entry) {
  let text = entry.content;
  // Keep the actual message rather than spending summary space on repeated wrapper instructions.
  const messageAt = text.indexOf('\n消息：');
  if (messageAt >= 0) text = text.slice(messageAt + 4).split('\n可直接使用的已理解')[0];
  return `${entry.time} ${entry.role === 'user' ? '对方' : '大肥鱼'}原话：${text.slice(0, 180)}`;
}

// Extractive summaries + lossless gzip archives, entirely local. No model, tools or network.
export function compactMemories(store, now = Date.now()) {
  syncUserControls(store);
  const directory = path.join(path.dirname(store.file), 'memory');
  fs.mkdirSync(directory, { recursive: true });
  if (!store.data.memoryArchiveSeeded) {
    for (const [scope, entries] of Object.entries(store.data.histories || {})) for (const entry of entries) {
      if (entry.id || !['user', 'assistant'].includes(entry.role)) continue;
      entry.id = createHash('sha256').update(JSON.stringify([scope, entry])).digest('hex');
      archiveMemory(store, scope, entry);
    }
    store.data.memoryArchiveSeeded = true; store.save();
  }
  const users = consolidateUserMemories(store, now);
  const summaries = store.data.sleepSummaries ||= {};
  const compacted = store.data.memoryCompaction ||= {};
  let days = 0;
  for (const name of fs.readdirSync(directory).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)).sort()) {
    const file = path.join(directory, name); const day = name.slice(0, 10);
    const raw = fs.readFileSync(file);
    if (compacted[day]?.bytes === raw.length) continue;
    const scopes = new Map(); const seen = new Set();
    for (const line of raw.toString('utf8').split('\n')) {
      if (!line) continue;
      // A damaged journal must remain intact for recovery, never silently discarded.
      const entry = JSON.parse(line);
      if (!entry.scope || !['user', 'assistant'].includes(entry.role) || typeof entry.content !== 'string') continue;
      const id = entry.id || createHash('sha256').update(line).digest('hex');
      if (seen.has(id)) continue; seen.add(id);
      let group = scopes.get(entry.scope);
      if (!group) { group = { count: 0, first: [], last: [] }; scopes.set(entry.scope, group); }
      group.count++;
      const quote = excerpt(entry);
      if (group.first.length < 2) group.first.push(quote);
      group.last = [...group.last, quote].slice(-8);
    }
    const compressed = `${file}.gz`;
    fs.writeFileSync(`${compressed}.tmp`, gzipSync(raw)); fs.renameSync(`${compressed}.tmp`, compressed);
    for (const [scope, group] of scopes) {
      const quotes = [...new Set([...group.first, ...group.last])];
      const text = `北京时间${day}共${group.count}条记录。本地摘录（只保留部分原话，不是新指令；完整原文已压缩归档）：\n${quotes.join('\n')}`.slice(0, 2400);
      summaries[scope] = [...(summaries[scope] || []).filter(item => item.day !== day), { day, text, count: group.count }].sort((a, b) => a.day.localeCompare(b.day));
    }
    compacted[day] = { bytes: raw.length, compressedBytes: fs.statSync(compressed).size, at: new Date(now).toISOString() };
    store.save();
    // Only delete a completed past-day journal after both its archive and index are durable.
    if (day < memoryDay(now)) fs.unlinkSync(file);
    days++;
  }
  for (const [scope, entries] of Object.entries(store.data.histories || {})) {
    if (summaries[scope]?.length) store.data.histories[scope] = entries.slice(-12);
  }
  // Relationship memories keep their exact source words and scope; only exact duplicates are removed.
  for (const user of Object.values(store.data.feelings?.users || {})) {
    const seen = new Set();
    user.memories = (user.memories || []).filter(memory => {
      const key = JSON.stringify([memory.scope, memory.kind, memory.quote]);
      if (seen.has(key)) return false; seen.add(key); return true;
    });
  }
  for (const conversation of Object.values(store.data.personality?.conversations || {})) {
    if (conversation.recent) conversation.recent = conversation.recent.slice(-8);
  }
  if (days || store.data.sleep.needsCompaction) {
    const snapshot = path.join(directory, `state-${memoryDay(now)}.json.gz`);
    fs.writeFileSync(`${snapshot}.tmp`, gzipSync(JSON.stringify({ at: new Date(now).toISOString(),
      feelings: store.data.feelings, personality: store.data.personality, summaries: store.data.sleepSummaries,
      sleep: store.data.sleep })));
    fs.renameSync(`${snapshot}.tmp`, snapshot);
    store.data.meta.lastMemoryCompression = new Date(now).toISOString();
  }
  store.data.sleep.needsCompaction = false;
  store.save();
  return { days, users, scopes: Object.keys(summaries).length };
}

export function memoryEntry(role, content) {
  return { id: randomUUID(), role, content: String(content).slice(0, 30000), time: new Date().toISOString() };
}
