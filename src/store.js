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
  reserve(kind, limit, count = 1) {
    // Zero disables only the model budget; message and action limits still apply.
    if (kind === 'model' && limit === 0) return;
    const now = Date.now();
    this.data.counters = this.data.counters.filter(x => now - x.time < 3600000);
    const used = this.data.counters.filter(x => x.kind === kind);
    if (used.length + count > limit) {
      if (count > limit) throw new Error(`${kind} 本次需要 ${count} 个名额，超过每小时上限 ${limit}`);
      const release = used.map(x => x.time).sort((a, b) => a - b)[used.length + count - limit - 1];
      const seconds = Math.max(1, Math.ceil((release + 3600000 - now) / 1000));
      const label = kind === 'model' ? '本地模型请求限额' : `${kind} 本地限额`;
      throw new Error(`${label}已用完（最近一小时 ${used.length}/${limit} 次，约 ${seconds} 秒后释放一个名额${kind === 'model' ? '；不是模型账户余额不足，可调整 config.json 的 agent.maxModelCallsPerHour' : ''}）`);
    }
    for (let i = 0; i < count; i++) this.data.counters.push({ kind, time: now });
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
    this.appendHistory(key, 'user', user, limit);
    this.appendHistory(key, 'assistant', assistant, limit);
  }
  appendHistory(key, role, content, limit = 64) {
    const history = this.data.histories[key] || [];
    this.data.histories[key] = [...history, { role, content: String(content).slice(0, 30000), time: new Date().toISOString() }].slice(-limit);
    this.save();
  }
  context(key, limit = 64, maxChars = 24000, skipLast = false) {
    const history = this.data.histories[key] || [];
    const selected = (skipLast ? history.slice(0, -1) : history).slice(-limit);
    const result = []; let remaining = maxChars;
    for (let i = selected.length - 1; i >= 0 && remaining > 0; i--) {
      const item = selected[i];
      if (!['user', 'assistant'].includes(item.role) || typeof item.content !== 'string') continue;
      const content = item.content.slice(-remaining);
      result.unshift({ role: item.role, content }); remaining -= content.length;
    }
    return result;
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
