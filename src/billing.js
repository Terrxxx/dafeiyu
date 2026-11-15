import fs from 'node:fs';
import path from 'node:path';
import { DATA_ROOT } from './config.js';
import { atomicWriteFile } from './atomic-file.js';
import { DailyBudget } from './daily-budget.js';
import { requestLog } from './ai-request-log.js';
import { requestShape } from './ai-request-log.js';
import { startTurnRequest } from './turn-meter.js';
import { reserveAICycle } from './ai-cycle-budget.js';
import { modelRequest } from './model-provider.js';
let blocked = false;
const providerBackoffs = new WeakMap();

function retryDelay(header, at) {
  if (!header) return 0;
  const delay = /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header) - at;
  return Number.isFinite(delay) ? Math.max(0, Math.min(delay, 300_000)) : 0;
}

function providerPause(state, at, reason, retryAfter, status = 429) {
  state.reason = reason;
  if (retryAfter !== undefined) {
    state.failures = Math.min(state.failures + 1, 5);
    const delay = Math.min(60_000, 5000 * 2 ** (state.failures - 1));
    state.until = Math.max(state.until, at + Math.max(delay, retryDelay(retryAfter, at)));
  }
  const seconds = Math.max(1, Math.ceil((state.until - at) / 1000));
  return Response.json({ error: { message: `${state.reason}，约 ${seconds} 秒后可再试` } }, {
    status, headers: { 'Retry-After': String(seconds) },
  });
}

export function billingRequest(request, context) {
  const now = context?.now || Date.now;
  const budget = context?.store?.file ? new DailyBudget(context.config, context.store, now) : null;
  const store = context?.store;
  let backoff = null;
  if (context?.config?.provider === 'custom') {
    backoff = (store && providerBackoffs.get(store)) || { failures: 0, until: 0 };
    if (store) providerBackoffs.set(store, backoff);
  }
  return async (url, options = {}) => {
    if (process.env.DAFEIYU_MANAGED && blocked) throw Error('API余额不足，服务已停止');
    budget?.assert();
    const started = now(), category = options.metricsCategory;
    if (backoff && started < backoff.until) return providerPause(backoff, started, backoff.reason);
    options = { ...options };
    delete options.metricsCategory;
    let body;
    try { body = JSON.parse(options.body); } catch {}
    if (body?.stream) {
      body.stream_options = { ...body.stream_options, include_usage: true };
      options.body = JSON.stringify(body);
    }
    reserveAICycle(body);
    const requestId = budget?.begin(started, category);
    const report = requestLog(body || {}, category, context?.log);
    const reportTurn=startTurnRequest(requestShape(body||{}));
    let finished = false;
    const finish = (usage, status) => {
      if (finished) return;
      finished = true;
      report(usage, status);
      reportTurn(usage);
      budget?.record(usage, started, requestId);
    };
    let response;
    try { response = await modelRequest(request, context?.config, url, options); }
    catch (error) {
      const timeout = error?.name === 'TimeoutError' || options.signal?.reason?.name === 'TimeoutError';
      finish(undefined, timeout ? '供应商请求超时' : '请求失败');
      if (backoff && timeout) return providerPause(backoff, now(), '自定义供应商请求超时', null, 504);
      throw error;
    }
    if (process.env.DAFEIYU_MANAGED && response.status === 402) {
      blocked = true;
      fs.mkdirSync(DATA_ROOT, { recursive: true });
      atomicWriteFile(path.join(DATA_ROOT, 'billing-status.json'), JSON.stringify({ code: 'insufficient_balance', time: Date.now() }));
      process.emit('billing-empty');
    }
    if (!response.ok) {
      report(undefined, `失败 HTTP ${response.status}`);
      reportTurn();
      budget?.cancel(requestId);
      if (backoff && response.status === 429) {
        await response.body?.cancel();
        return providerPause(backoff, now(), '自定义供应商繁忙或限流', response.headers.get('retry-after'));
      }
      return response;
    }
    if (backoff && started >= backoff.until) {
      backoff.failures = 0;
      backoff.until = 0;
    }
    if (typeof response.clone !== 'function') {
      const original = response.json.bind(response);
      return { ...response, json: async () => {
        try { const value = await original(); finish(value?.usage); return value; }
        catch (error) { finish(undefined, '响应读取失败'); throw error; }
      } };
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      let value;
      try { value = await response.clone().json(); } catch {}
      finish(value?.usage);
      return response;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let pending = '', usage;
    const parse = line => {
      if (line.startsWith('data:')) try { const obj = JSON.parse(line.slice(5)); if (obj.usage) usage = obj.usage; } catch {}
    };
    const scan = chunk => {
      pending += decoder.decode(chunk, { stream: true });
      let index;
      while ((index = pending.indexOf('\n')) >= 0) { parse(pending.slice(0, index).trim()); pending = pending.slice(index + 1); }
      if (pending.length > 1024 * 1024) pending = '';
    };
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const result = await reader.read();
          if (result.done) { parse(pending.trim()); finish(usage); controller.close(); }
          else { scan(result.value); controller.enqueue(result.value); }
        } catch (error) { finish(usage, '响应中断'); controller.error(error); }
      },
      async cancel(reason) { try { await reader.cancel(reason); } finally { finish(usage, '已取消'); } },
    });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}
