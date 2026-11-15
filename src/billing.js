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

export function billingRequest(request, context) {
  const budget = context?.store?.file ? new DailyBudget(context.config, context.store) : null;
  return async (url, options = {}) => {
    if (process.env.DAFEIYU_MANAGED && blocked) throw Error('API余额不足，服务已停止');
    budget?.assert();
    const started = Date.now(), category = options.metricsCategory;
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
    catch (error) { finish(undefined, '请求失败'); throw error; }
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
      return response;
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
