import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { ROOT } from './config.js';
const file = path.join(ROOT, 'data/bilibili-activity.jsonl');
if (!fs.existsSync(file)) console.log('暂无B站操作记录；启动新版本后开始留存。');
else {
  const recent = new Map();
  for await (const line of readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })) {
    let row; try { row = JSON.parse(line); } catch { continue; }
    recent.set(row.id, { ...recent.get(row.id), ...row });
    if (recent.size > 50) recent.delete(recent.keys().next().value);
  }
  for (const row of recent.values()) {
    const state = row.state === 'started' ? '尚无完成记录，不能确认成功' : row.state;
    console.log(JSON.stringify({ time: row.time, operation: row.operation, state, input: row.input, receipt: row.receipt, error: row.error }));
  }
  console.log(`完整记录：${file}`);
}
