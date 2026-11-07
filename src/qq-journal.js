import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// QQ account/profile and Qzone operations only. Chat content never goes through this journal.
export async function recordQzoneAction(store, operation, input, action) {
  if (!['publish', 'like', 'comment', 'reply','read','read_comments','profile'].includes(operation)) throw new Error('不支持的QQ足迹操作');
  const id = randomUUID();
  const file = path.join(path.dirname(store.file), 'qq-activity.jsonl');
  const append = entry => fs.appendFileSync(file, JSON.stringify({ id, operation, time: new Date().toISOString(), ...entry }) + '\n');
  const fields = ['owner', 'tid', 'commentId', 'text'];
  const detail = Object.fromEntries(fields.filter(key => input[key] !== undefined).map(key => [key, String(input[key]).slice(0, key === 'text' ? 1000 : 160)]));
  append({ state: 'started', input: detail });
  try {
    const result = await action();
    const count=Array.isArray(result?.posts)?result.posts.length:Array.isArray(result?.comments)?result.comments.length:undefined;
    const receipt = Object.fromEntries(['accepted', 'tid', 'owner', 'commentId', 'alreadyLiked', 'skipped'].filter(key => result?.[key] !== undefined).map(key => [key, result[key]]));
    if(count!==undefined)receipt.count=count;
    append({ state: result?.skipped ? 'skipped' : 'succeeded',input:detail, receipt });
    return result;
  } catch (error) {
    // A timeout or a process crash must not look like a confirmed rejection.
    append({ state: ['read','read_comments','profile'].includes(operation)||error.confirmedFailure?'failed':'uncertain',input:detail });
    throw error;
  }
}
