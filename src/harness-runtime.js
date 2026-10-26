import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID, randomBytes } from 'node:crypto';
import { ROOT } from './config.js';

export async function readJson(request, maxBytes = 24 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error('Harness 请求过大');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function runIdFromMessages(messages) {
  const message = messages?.find(m => m.role === 'user');
  const text = typeof message?.content === 'string' ? message.content : message?.content?.find(b => b.type === 'text')?.text;
  return text?.match(/\[DAFEIYU_RUN:([a-zA-Z0-9-]+)\]/)?.[1];
}

export class HarnessRuntime {
  constructor(config, store, tools, request = fetch) {
    Object.assign(this, { config, store, tools, request });
    this.pending = new Map(); this.runs = new Map(); this.nextId = 0; this.completed = 0;
    this.token = randomBytes(32).toString('hex');
    this.directory = path.join(ROOT, 'harness-runtime');
    this.home = path.join(this.directory, 'home');
  }
  async start() {
    if (this.child && (this.child.exitCode !== null || this.child.killed)) await this.close();
    if (this.ready) return this.ready;
    this.ready = this.boot().catch(async error => { await this.close(); this.ready = null; throw error; });
    return this.ready;
  }
  async boot() {
    const bin = path.join(this.directory, 'node_modules/@deepseek-ai/dsh/lib/bin.js');
    if (!fs.existsSync(bin)) throw new Error('Harness 未安装，请先安装 @deepseek-ai/dsh');
    this.server = http.createServer((req, res) => { this.serve(req, res).catch(error => {
      if (!res.headersSent) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); }
      else res.destroy();
    }); });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
    const endpoint = `http://127.0.0.1:${this.server.address().port}`;
    const profile = path.join(this.home, 'profiles/dafeiyu');
    fs.mkdirSync(profile, { recursive: true });
    fs.writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-dafeiyu', private: true,
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-sdk-minimal'] } } }, null, 2));
    const disabled = ['llm-deepseek', 'tool-fs', 'tool-working-directory', 'persistent-bash', 'persistent-pwsh', 'terminal-bash', 'terminal-pwsh'];
    const patch = [
      ...disabled.map(id => ({ id, disabled: true })),
      { id: 'agent-loop', config: { maxParallelToolCalls: 1 } },
      { insert: [
        { id: 'dafeiyu-model', name: '@deepseek-ai/dsh-llm-pi-ai', config: { providers: { 'dafeiyu-model': {
          api: 'openai-completions', apiKeyEnv: 'DAFEIYU_BRIDGE_TOKEN', baseURL: `${endpoint}/v1`,
          retryPolicy: { mode: 'normal', maxRetries: 0 },
          compat: { supportsDeveloperRole: false, maxTokensField: 'max_tokens', supportsStore: false },
          models: [{ id: this.config.model, input: ['text', 'image'], reasoningEfforts: false, contextWindow: 65536, maxTokens: 8192 }],
        } } } },
        { id: 'dafeiyu-social-tools', name: path.join(ROOT, 'src/harness-plugin.mjs').replaceAll('\\', '/') },
      ] },
    ];
    // JSON is valid YAML; no secrets are written to the profile.
    fs.writeFileSync(path.join(profile, 'cordis.patch.yml'), JSON.stringify(patch, null, 2));
    this.child = spawn(process.execPath, [bin, '--profile', 'dafeiyu'], {
      cwd: this.directory, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, DSH_HOME: this.home,
        DSH_SYSTEM_PROMPT: this.config.persona, DAFEIYU_BRIDGE_URL: endpoint, DAFEIYU_BRIDGE_TOKEN: this.token },
    });
    this.diagnostics = '';
    this.child.stderr.on('data', chunk => { this.diagnostics = (this.diagnostics + chunk.toString()).slice(-8000); });
    this.child.stdin.on('error', error => this.fail(error));
    this.child.on('error', error => this.fail(error));
    this.child.on('exit', code => this.fail(new Error(`Harness 进程退出（${code}）：${this.diagnostics.replaceAll(this.token, '[redacted]').slice(-2000)}`)));
    this.lines = createInterface({ input: this.child.stdout });
    this.lines.on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id); if (!pending) return;
        this.pending.delete(message.id); clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`Harness：${message.error.message}`)); else pending.resolve(message.result);
      } else if (message.method === 'session.event') {
        const run = this.runs.get(message.params?.sessionId); if (!run) return;
        const event = message.params.event;
        if (event.type === 'assistant/message') {
          run.text = (event.data.message.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        }
        if (event.type === 'turn/end') { run.reason = event.data.reason.kind; run.error = event.data.reason.error?.message; }
      }
    });
    const result = await this.rpc('initialize', { cwd: ROOT, provider: 'dafeiyu-model', model: this.config.model, maxTokens: this.config.agent.maxOutputTokens });
    if (result?.serverInfo?.name !== 'deepseek-harness-sdk-runtime') throw new Error('Harness 握手身份不匹配');
    return result;
  }
  fail(error) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(error); }
    this.pending.clear();
  }
  rpc(method, params, timeout = 120000) {
    return new Promise((resolve, reject) => {
      if (!this.child || this.child.exitCode !== null || this.child.killed) return reject(new Error('Harness 进程未运行'));
      const id = ++this.nextId;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`Harness ${method} 超时`)); this.child.kill(); }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async serve(req, res) {
    if (req.headers.authorization !== `Bearer ${this.token}`) { res.writeHead(401); res.end(); return; }
    const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (req.method === 'GET' && req.url === '/schemas') return json(200, this.tools.schemas);
    if (req.method !== 'POST') return json(404, { error: 'Not found' });
    const body = await readJson(req);
    if (req.url === '/tool') {
      const run = this.runs.get(body.sessionId);
      if (!run?.useTools) return json(403, { error: '此会话不允许工具调用' });
      if (!this.tools.schemas.some(s => s.function.name === body.name)) return json(403, { error: '工具不在允许列表' });
      try {
        const result = (await this.tools.call(body.name, body.args)) ?? null;
        this.store.audit('harness-tool', { sessionId: body.sessionId, name: body.name, ok: true });
        return json(200, result);
      }
      catch (error) {
        this.store.audit('harness-tool', { sessionId: body.sessionId, name: body.name, ok: false, error: error.message });
        return json(200, { error: error.message });
      }
    }
    if (req.url !== '/v1/chat/completions') return json(404, { error: 'Not found' });
    try { this.tools.sleep?.assertAwake(); }
    catch (error) { return json(423, { error: { message: error.message } }); }
    const run = this.runs.get(runIdFromMessages(body.messages));
    if (!run) return json(403, { error: { message: '无效的 Harness 会话' } });
    if (run.useTools && this.tools.schemas.some(s => !body.tools?.some(t => t.function?.name === s.function.name))) {
      this.store.audit('harness-tools-missing', { sessionId: runIdFromMessages(body.messages) });
      return json(503, { error: { message: 'Harness工具未完整加载，已阻止无工具执行，请检查插件参数适配' } });
    }
    if (++run.calls > run.maxCalls) return json(429, { error: { message: '本轮模型请求次数已达上限' } });
    try { this.store.reserve('model', this.config.agent.maxModelCallsPerHour); }
    catch (error) { return json(429, { error: { message: error.message } }); }
    body.model = this.config.model; body.thinking = { type: 'disabled' };
    body.max_tokens = run.maxTokens;
    if (!run.useTools) { delete body.tools; delete body.tool_choice; }
    if (run.json) body.response_format = { type: 'json_object' };
    const response = await this.request(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify(body), signal: AbortSignal.timeout(90000), redirect: 'error',
    });
    res.writeHead(response.status, { 'Content-Type': response.headers.get('content-type') || 'application/json' });
    if (!response.body) return res.end();
    await new Promise((resolve, reject) => {
      const stream = Readable.fromWeb(response.body); stream.on('error', reject); res.on('finish', resolve); res.on('close', resolve); stream.pipe(res);
    });
  }
  async run(input, { useTools = false, maxTokens = this.config.agent.maxOutputTokens, json = false, image } = {}) {
    this.tools.sleep?.assertAwake();
    await this.start();
    this.tools.sleep?.assertAwake();
    const sessionId = `dafeiyu-${randomUUID()}`;
    const run = { useTools, maxTokens, json, calls: 0, maxCalls: useTools ? this.config.agent.maxToolRounds + 1 : 1, text: '', reason: null };
    this.runs.set(sessionId, run);
    this.store.audit('harness-run', { sessionId, useTools });
    try {
      // Marker goes last: a run-unique string at the start would break prompt caching for everything after it.
      const contentBlocks = [{ type: 'text', text: `${input}\n\n[DAFEIYU_RUN:${sessionId}]` }];
      if (image) contentBlocks.push(image);
      await this.rpc('session/prompt', { sessionId, contentBlocks });
      await this.rpc('session/wait', { sessionId }, 600000);
      if (run.reason !== 'completed') throw new Error(`Harness 未正常完成：${run.reason || '缺少完成事件'}${run.error ? '，' + run.error : ''}`);
      if (!run.text) throw new Error('Harness 返回空内容');
      return run.text;
    } finally {
      this.runs.delete(sessionId);
      // SDK agents stay resident until shutdown. Retire batches without discarding durable traces.
      if (++this.completed >= 40 && this.runs.size === 0) { await this.close(); this.completed = 0; }
    }
  }
  async close() {
    const child = this.child;
    if (child && child.exitCode === null && !child.killed) {
      try { await this.rpc('shutdown', undefined, 5000); } catch { this.child.kill(); }
    }
    if (child && child.exitCode === null) await new Promise(resolve => {
      const timer = setTimeout(() => { child.kill(); resolve(); }, 5000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
    });
    this.lines?.close();
    this.server?.closeAllConnections();
    if (this.server?.listening) await new Promise(resolve => this.server.close(resolve));
    this.ready = null;
  }
}
