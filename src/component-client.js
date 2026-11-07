import{siteComponentAllowed}from'./component-policy.js';
import { spawn } from 'node:child_process';
import readline from 'node:readline';
import path from 'node:path';
import fs from 'node:fs';
import { componentCatalog, componentEnabled, componentSchemas, normalizeComponents, toolComponent } from './component-catalog.js';

export class ComponentManager {
  constructor(config, directory) { Object.assign(this, { config, directory }); this.pending = new Map(); this.sequence = 0; }
  settings() {
    const value = this.settingsFile ? JSON.parse(fs.readFileSync(this.settingsFile, 'utf8').replace(/^\uFEFF/, '')).components || {} : this.config.components || {};
    return normalizeComponents(value);
  }
  allowed(name) { const item = toolComponent(name); return !item || siteComponentAllowed(item.id,path.dirname(this.directory))&&componentEnabled(item, this.settings()); }
  schemas() { return componentSchemas.filter(s => this.allowed(s.function.name)); }
  async start() {
    if (this.ready) return this.ready;
    this.ready = this.boot().catch(error => { this.close(); throw error; }); return this.ready;
  }
  async boot() {
    fs.mkdirSync(this.directory, { recursive: true });
    const env = Object.fromEntries(['SystemRoot', 'WINDIR', 'PATH', 'HOME', 'TEMP', 'TMP', 'LOCALAPPDATA'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
    const child = spawn(process.execPath, [path.join(import.meta.dirname, 'component-server.js'), this.directory], { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child = child;
    const fail = () => { if (this.child !== child) return; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('MCP组件进程已断开')); } this.pending.clear(); this.ready = null; };
    child.on('error', fail); child.on('exit', fail); child.stdin.on('error', fail); child.stderr.resume();
    readline.createInterface({ input: child.stdout }).on('line', line => {
      let reply; try { reply = JSON.parse(line); } catch { return; }
      const pending = this.pending.get(reply.id); if (!pending) return; clearTimeout(pending.timer); this.pending.delete(reply.id);
      reply.error ? pending.reject(new Error(reply.error.message)) : pending.resolve(reply.result);
    });
    const init = await this.rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'dafeiyu-components', version: '1.0.0' } });
    if (init.serverInfo?.name !== 'dafeiyu-components') throw new Error('MCP组件身份不匹配');
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listed = await this.rpc('tools/list', {});
    if (!componentSchemas.every(s => listed.tools?.some(t => t.name === s.function.name.replace('mcp__dafeiyu__', '')))) throw new Error('MCP组件工具不完整');
  }
  rpc(method, params, timeoutMs = 25000) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error('MCP组件请求超时')); this.close(); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }
  async call(name, args, scope) {
    if (!this.allowed(name)) throw new Error('组件未安装或已关闭');
    await this.start();
    if (!this.allowed(name)) throw new Error('组件已关闭');
    const result = await this.rpc('tools/call', { name: name.replace('mcp__dafeiyu__', ''), arguments: args, _meta: { scope, feeds: this.settings().rss?.feeds || [] } }, name.includes('__shopping_') ? 60000 : 25000);
    const text = result.content?.filter(x => x.type === 'text').map(x => x.text).join('\n');
    if (result.isError) throw new Error(text || 'MCP组件执行失败');
    return JSON.parse(text);
  }
  close() { this.child?.kill(); this.child = null; this.ready = null; for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(new Error('MCP组件连接已关闭')); } this.pending.clear(); }
}
