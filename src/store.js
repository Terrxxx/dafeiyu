import fs from 'node:fs';
import path from 'node:path';

export class Store {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive: true });
    this.file = path.join(directory, 'state.json');
    this.auditFile = path.join(directory, 'actions.jsonl');
    this.data = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { histories: {}, actions: {}, counters: [], meta: {} };
  }
  save() {
    fs.writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data, null, 2));
    fs.renameSync(`${this.file}.tmp`, this.file);
  }
  audit(type, detail) {
    fs.appendFileSync(this.auditFile, JSON.stringify({ time: new Date().toISOString(), type, ...detail }) + '\n');
  }
  reserve(kind, limit) {
    const now = Date.now();
    this.data.counters = this.data.counters.filter(x => now - x.time < 3600000);
    if (this.data.counters.filter(x => x.kind === kind).length >= limit) throw new Error(`${kind} 每小时额度已用完`);
    this.data.counters.push({ kind, time: now });
    this.save();
  }
  async once(key, action) {
    if (this.data.actions[key]) return { skipped: true, reason: '已处理或上次发送状态不明', state: this.data.actions[key].state };
    this.data.actions[key] = { state: 'pending', time: Date.now() };
    this.save();
    try {
      const result = await action();
      this.data.actions[key].state = 'sent';
      this.save();
      this.audit('sent', { key });
      return result;
    } catch (error) {
      this.data.actions[key].state = 'uncertain';
      this.save();
      this.audit('uncertain', { key });
      throw error;
    }
  }
  remember(key, user, assistant, limit) {
    const history = this.data.histories[key] || [];
    this.data.histories[key] = [...history, { role: 'user', content: user }, { role: 'assistant', content: assistant }].slice(-limit);
    this.save();
  }
}

export class Queue {
  constructor(max = 30) { this.tail = Promise.resolve(); this.pending = 0; this.max = max; }
  add(work) {
    if (this.pending >= this.max) return Promise.reject(new Error('任务队列已满'));
    this.pending++;
    const result = this.tail.then(work);
    this.tail = result.catch(() => {}).finally(() => { this.pending--; });
    return result;
  }
}
