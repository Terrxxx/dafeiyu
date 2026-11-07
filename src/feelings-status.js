import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './config.js';
import { Feelings } from './feelings.js';
import { moodLabels, effectiveMood } from './emotion-state.js';

const file = path.join(ROOT, 'data/state.json');
const data = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--user' || !/^[1-9]\d*$/.test(args[1]))) {
  console.error('用法：npm run feelings 或 npm run feelings -- --user QQ号'); process.exitCode = 1;
} else {
  const feelings = new Feelings({ data });
  feelings.settle();
  console.log(JSON.stringify({
    note: '只读查看；情绪已按当前时间估算平复，不写回文件',
    mood: effectiveMood(feelings.data.mood),
    baseMood: feelings.data.mood,
    sleep: data.sleep?.version === 2 ? { state: data.sleep.mode, reason: data.sleep.reason,
      wakeEnergy: data.sleep.wakeEnergy, updatedAt: new Date(data.sleep.lastTick).toISOString(),
      drainPerHour: data.sleep.drainPerHour, minWakeAt: data.sleep.minWakeAt ? new Date(data.sleep.minWakeAt).toISOString() : null,
      lastSleep: data.sleep.lastSleep || null } : null,
    sleepUnread: data.sleepUnread?.length || 0,
    lastMemoryCompression: data.meta?.lastMemoryCompression || null,
    labels: moodLabels,
    rememberedUsers: Object.keys(feelings.data.users).length,
    ...(args.length ? { user: feelings.data.users[args[1]] || null } : {}),
  }, null, 2));
}
