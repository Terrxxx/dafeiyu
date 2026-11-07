import { AsyncLocalStorage } from 'node:async_hooks';
import { requestShape } from './ai-request-log.js';
const cycles = new AsyncLocalStorage();
export const currentAICycle = () => cycles.getStore();
// An absent run budget must clear a server callback's inherited startup context.
export const withExistingAICycle = (cycle, task) => cycles.run(cycle, task);
export const withoutAICycleBudget = task => cycles.run(undefined,task);
export function withAICycleBudget(task, options = {}) { return cycles.run({ calls: 0, reserved: 0, maxCalls: 2, limit: 10000, margin: 512, label: '自主社交', ...options }, task); }
export function reserveAICycle(body) {
  const cycle = cycles.getStore();
  if (!cycle) return;
  // This is a conservative local text estimate; the provider's reported usage is authoritative.
  const shape=requestShape(body),charge = Math.ceil(shape.total*1.25) + shape.images*1024 + (body?.max_tokens || 600) + cycle.margin;
  if (cycle.calls >= cycle.maxCalls || cycle.reserved + charge > cycle.limit) throw Error(`${cycle.label}本轮估算预算不足：最多${cycle.maxCalls}次请求、估算预算${cycle.limit} tokens，已停止继续请求`);
  cycle.calls++; cycle.reserved += charge;
}
