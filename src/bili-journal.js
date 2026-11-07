import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const operations = {
  uploadDynamicImage:[],
  ownFans:['page'],notices:['type'],dmSessions:[],dmMessages:['peer'],replyDM:['peer','text','messageId'],replyNotice:['ref','text'],
  popular: [], search: ['keyword'], stats: ['bvid'], related: ['bvid'], comments: ['bvid'],
  ownHistory: [], ownFollowing: ['page'], ownFolders: [], ownFavorites: ['folderId', 'page'],
  mentions: [], verifyThread: ['mention', 'aid'], comment: ['aid', 'text', 'root', 'parent'],
  like: ['bvid'], follow: ['uid'], favorite: ['bvid', 'folderId'], publishDynamic: ['text'],
};
const writes = new Set(['comment', 'like', 'follow', 'favorite', 'publishDynamic','uploadDynamicImage','replyDM','replyNotice']);

// Persist intent before performing an action. An interrupted intent is never evidence of success.
export function installBiliJournal(bili, store) {
  if (bili.journalInstalled) return;
  const videoIds=new Map();
  const originalVideo=bili.video;
  if(typeof originalVideo==='function')bili.video=async function(...args){const result=await originalVideo.apply(this,args);if(result?.aid&&result?.bvid){videoIds.set(String(result.aid),result.bvid);if(videoIds.size>500)videoIds.delete(videoIds.keys().next().value);}return result;};
  const file = path.join(path.dirname(store.file), 'bilibili-activity.jsonl');
  const append = entry => fs.appendFileSync(file, JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
  for (const [operation, fields] of Object.entries(operations)) {
    const original = bili[operation];
    if (typeof original !== 'function') continue;
    bili[operation] = async function (...args) {
      const id = randomUUID();
      const input = Object.fromEntries(fields.map((field, index) => [field, args[index]]).filter(([, value]) => value !== undefined));
      if(input.aid&&videoIds.has(String(input.aid)))input.bvid=videoIds.get(String(input.aid));
      append({ id, operation, scope: bili.activityScope || 'background', state: 'started', input });
      try {
        const result = await original.apply(this, args);
        const receipt = writes.has(operation) ? result : { count: Array.isArray(result) ? result.length : result?.items?.length ?? result?.videos?.length ?? result?.comments?.length, read: true };
        if(!writes.has(operation)&&result?.aid&&result?.bvid)videoIds.set(String(result.aid),result.bvid);
        if(operation==='comments'){receipt.bvid=result?.bvid||input.bvid;receipt.comments=(result?.comments||[]).slice(0,20).map(c=>({author:String(c.author||'').slice(0,100),text:String(c.text||'').slice(0,2000)}));}
        append({ id, operation, state: 'succeeded', input,receipt });
        return result;
      } catch (error) {
        append({ id, operation,input, state: writes.has(operation) && !error.confirmedFailure ? 'uncertain' : 'failed', error: error.message });
        throw error;
      }
    };
  }
  bili.journalInstalled = true;
}
