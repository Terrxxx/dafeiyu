import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { atomicWriteFile } from './atomic-file.js';
import { mergeMessages } from './message-buffer.js';

export const userId = value => /^[1-9]\d{0,19}$/.test(String(value));
export function readUserControls(directory) {
  const file = path.join(directory, 'user-controls.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
}
export function writeUserControl(directory, id, change) {
  if (!userId(id)) throw new Error('用户ID无效');
  const controls = readUserControls(directory); controls[id] = { ...controls[id], ...change };
  atomicWriteFile(path.join(directory, 'user-controls.json'), JSON.stringify(controls)); return controls[id];
}
export function memoryEpoch(store) { return store?.file ? JSON.stringify(readUserControls(path.dirname(store.file))) : ''; }
export function assertMemoryEpoch(store, epoch) { if (memoryEpoch(store) !== epoch) throw new Error('用户记忆或屏蔽设置已变化，本轮旧回复已取消'); }
export function userBlocked(store, id) { return store.file ? readUserControls(path.dirname(store.file))[String(id)]?.blocked === true : false; }
export function acceptedSource(store, source, receivedAt) {
  if (!store.file) return true;
  const control = readUserControls(path.dirname(store.file))[String(source.sender)];
  return !control?.blocked && (!control?.forgottenAt || Number(source.receivedAt || receivedAt || Date.now()) > control.forgottenAt);
}
export function filterUserMessage(store, msg) {
  const sources = (msg.sources || [msg]).filter(source => acceptedSource(store, source, msg.receivedAt));
  if (!sources.length) return null;
  if (sources.length === (msg.sources || [msg]).length) return msg;
  return { ...mergeMessages(sources.map(source => ({ ...msg, ...source }))), unreadReview: msg.unreadReview, unreadCount: sources.length };
}
// Called by the running Store, never by the Web process: avoids concurrent state.json writers.
export function syncUserControls(store) {
  if (!store.file) return;
  const controls = readUserControls(path.dirname(store.file)); const applied = store.data.userControlsApplied ||= {};
  for (const [id, control] of Object.entries(controls)) {
    const old = applied[id] ||= {};
    if (control.blocked) store.data.sleepUnread = (store.data.sleepUnread || []).filter(item => String(item.sender) !== id);
    if (control.forgottenAt && old.forgottenAt !== control.forgottenAt) {
      const user = store.data.feelings?.users?.[id];
      const groups = new Set([...(user?.groups || []), ...(user?.memories || []).map(m => m.scope).filter(scope => scope?.startsWith('qq:group:'))]);
      if (store.data.feelings?.users) delete store.data.feelings.users[id];
      if (store.data.crossSendReceipts) delete store.data.crossSendReceipts['qq:user:'+id];
      if (store.data.publicationDrafts) delete store.data.publicationDrafts['qq:user:'+id];
      if (store.data.sleep?.chatTargets) delete store.data.sleep.chatTargets[`private:${id}`];
      if (store.data.sleep?.lastSleep?.chats) store.data.sleep.lastSleep.chats = store.data.sleep.lastSleep.chats.filter(chat => chat.kind !== 'private' || chat.target !== id);
      for (const [key, media] of Object.entries(store.data.media || {})) if (media.scopes?.includes(`qq:user:${id}`)) {
        delete store.data.media[key];
        const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[media.mime];
        if (/^[a-f0-9]{64}$/.test(key) && extension) { const file = path.join(path.dirname(store.file), 'media', `${key}.${extension}`); if (fs.existsSync(file)) fs.unlinkSync(file); }
      }
      for (const key of [`qq:user:${id}`, ...groups]) {
        if (store.data.proactiveDialogue) delete store.data.proactiveDialogue[key];
        if (store.data.histories) delete store.data.histories[key];
        if (store.data.sleepSummaries) delete store.data.sleepSummaries[key];
        if (store.data.personality?.conversations) delete store.data.personality.conversations[key];
      }
      store.data.sleepUnread = (store.data.sleepUnread || []).filter(item => String(item.sender) !== id);
      for (const [key, item] of Object.entries(store.data.sentMessages || {})) if (item.kind === 'private' && item.target === id) delete store.data.sentMessages[key];
      for (const [key, item] of Object.entries(store.data.friendRequests || {})) if (item.userId === id) delete store.data.friendRequests[key];
      for (const task of store.data.tasks || []) if (task.scope === `qq:user:${id}` && task.status === 'pending') task.status = 'cancelled';
      old.forgottenAt = control.forgottenAt;
    }
    const user = store.data.feelings?.users?.[id];
    if (user && control.scoreRevision && old.scoreRevision !== control.scoreRevision) {
      Object.assign(user, control.scores); old.scoreRevision = control.scoreRevision;
    }
    if (user) user.memories = (user.memories || []).filter(memory => !control.editedScopes?.[memory.scope] || (memory.time || 0) > control.editedScopes[memory.scope]);
  }
}
export function purgeUserArchives(directory, id, groups = []) {
  const scope = `qq:user:${id}`; const knownGroups = new Set(groups);
  const memory = path.join(directory, 'memory');
  if (fs.existsSync(memory)) for (const name of fs.readdirSync(memory)) {
    if (!/^(?:\d{4}-\d{2}-\d{2}\.jsonl(?:\.gz)?|state-\d{4}-\d{2}-\d{2}\.json\.gz)$/.test(name)) continue;
    const file = path.join(memory, name); const raw = fs.readFileSync(file); const gzip = name.endsWith('.gz');
    const decoded = (gzip ? gunzipSync(raw) : raw).toString('utf8'); let output;
    if (name.startsWith('state-')) {
      const snapshot = JSON.parse(decoded);
      if (snapshot.feelings?.users) delete snapshot.feelings.users[id];
      for (const key of [scope, ...knownGroups]) { if (snapshot.summaries) delete snapshot.summaries[key]; if (snapshot.personality?.conversations) delete snapshot.personality.conversations[key]; }
      output = JSON.stringify(snapshot);
    } else {
      const entries = decoded.split('\n').filter(Boolean).map(line => JSON.parse(line));
      output = entries.filter(entry => entry.scope !== scope && !(knownGroups.has(entry.scope) && (!entry.participants || entry.participants.includes(id)))).map(entry => JSON.stringify(entry)).join('\n');
      if (output) output += '\n';
    }
    atomicWriteFile(file, gzip ? gzipSync(output) : output);
  }
  const notes = path.join(directory, 'components', `notes-${createHash('sha256').update(scope).digest('hex')}.json`);
  if (fs.existsSync(notes)) fs.unlinkSync(notes);
  const activity = path.join(directory, 'user-memory', 'activity');
  if (fs.existsSync(activity)) for (const name of fs.readdirSync(activity).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl(?:\.gz)?$/.test(name))) {
    const file = path.join(activity, name); const raw = fs.readFileSync(file); const gzip = name.endsWith('.gz');
    const entries = (gzip ? gunzipSync(raw) : raw).toString('utf8').split('\n').filter(Boolean).map(JSON.parse);
    const output = entries.filter(entry => entry.owner !== id).map(entry => JSON.stringify(entry)).join('\n');
    atomicWriteFile(file, gzip ? gzipSync(output ? output + '\n' : '') : output ? output + '\n' : '');
  }
}
