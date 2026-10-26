import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const operations = {
  popular: [], search: ['keyword'], stats: ['bvid'], related: ['bvid'], comments: ['bvid'],
  ownHistory: [], ownFollowing: ['page'], ownFolders: [], ownFavorites: ['folderId', 'page'],
  mentions: [], verifyThread: ['mention', 'aid'], comment: ['aid', 'text', 'root', 'parent'],
  like: ['bvid'], follow: ['uid'], favorite: ['bvid', 'folderId'], publishDynamic: ['text'],
};
const writes = new Set(['comment', 'like', 'follow', 'favorite', 'publishDynamic']);

// Persist intent before performing an action. An interrupted intent is never evidence of success.
export function installBiliJournal(bili, store) {
  if (bili.journalInstalled) return;
  const file = path.join(path.dirname(store.file), 'bilibili-activity.jsonl');
  const append = entry => fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
  for (const [operation, fields] of Object.entries(operations)) {
    const original = bili[operation];
    if (typeof original !== 'function') continue;
    bili[operation] = async function (...args) {
      const id = randomUUID();
      const input = Object.fromEntries(fields.map((field, index) => [field, args[index]]).filter(([, value]) => value !== undefined));
      append({ id, operation, scope: bili.activityScope || 'background', state: 'started', input });
      try {
        const result = await original.apply(this, args);
        const receipt = writes.has(operation) ? result : { count: Array.isArray(result) ? result.length : result?.items?.length ?? result?.videos?.length ?? result?.comments?.length, read: true };
        append({ id, operation, state: 'succeeded', receipt });
        return result;
      } catch (error) {
        append({ id, operation, state: writes.has(operation) && !error.confirmedFailure ? 'uncertain' : 'failed', error: error.message });
        throw error;
      }
    };
  }
  bili.journalInstalled = true;
}
