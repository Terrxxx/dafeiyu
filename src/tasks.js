import { randomUUID } from 'node:crypto';
export const TASK_LIMIT = 10;

export class Tasks {
  constructor(store) {
    this.store = store;
    store.data.tasks ||= [];
    for (const task of store.data.tasks) if (task.status === 'running') task.status = 'uncertain';
    store.save();
  }
  create(scope, prompt, delayMinutes, autonomousTarget = null, autonomousActivity = null) {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 2000) throw new Error('任务内容需要1至2000字符');
    if (!Number.isFinite(delayMinutes) || delayMinutes < 1 || delayMinutes > 10080) throw new Error('任务延迟须为1分钟至7天');
    if(autonomousTarget&&(scope!=='autonomous-social'||!['private','group'].includes(autonomousTarget.kind)||!/^[1-9]\d{0,19}$/.test(autonomousTarget.id)))throw Error('自主任务目标无效');
    if(autonomousActivity&&(scope!=='autonomous-social'||autonomousTarget||!['browse','shopping','reflect'].includes(autonomousActivity)))throw Error('自主日程类型无效');
    const pending = this.store.data.tasks.filter(t => ['pending','running'].includes(t.status));
    if (pending.length >= TASK_LIMIT) throw new Error('未完成待办已达10个，请等待完成或取消后再安排');
    if (pending.some(t => t.scope === scope && t.prompt === prompt.trim())) throw new Error('已有相同待办任务');
    const task = { id: randomUUID(), scope, prompt: prompt.trim(), due: Date.now() + delayMinutes * 60000, status: 'pending',...(autonomousTarget?{autonomousTarget:{...autonomousTarget}}:{}) };
    task.createdAt=Date.now();if(autonomousActivity)task.autonomousActivity=autonomousActivity;
    this.store.data.tasks.push(task); this.store.save();
    this.store.audit('task-created', { id: task.id, due: task.due });
    return { id: task.id, due: new Date(task.due).toISOString() };
  }
  list(scope) { return this.store.data.tasks.filter(t => t.scope === scope).slice(-10).reverse().map(t => ({ id: t.id, prompt: t.prompt, due: new Date(t.due).toISOString(), status: t.status })); }
  cancel(scope, id) {
    const task = this.store.data.tasks.find(t => t.id === id && t.scope === scope && t.status === 'pending');
    if (!task) throw new Error('当前会话没有这项待办任务');
    task.status = 'cancelled'; this.store.save(); return { cancelled: true };
  }
  async tick(execute) {
    const task = this.store.data.tasks.find(t => t.status === 'pending' && t.due <= Date.now());
    if (!task) return;
    this.store.reserve('autonomous-tasks', 6);
    task.status = 'running'; this.store.save();
    try { await execute(task); task.status = 'done'; }
    catch (error) { task.status = 'failed'; throw error; }
    finally { this.store.save(); this.store.audit('task-finished', { id: task.id, status: task.status }); }
  }
}
