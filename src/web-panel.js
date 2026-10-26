import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ROOT, normalizeConfig } from './config.js';
import { atomicWriteFile } from './atomic-file.js';

export function tailJson(file, count = 100) {
  if (!fs.existsSync(file)) return [];
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size; const start = Math.max(0, size - 256 * 1024);
    const buffer = Buffer.alloc(size - start); fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n'); if (start) lines.shift();
    return lines.filter(Boolean).slice(-count).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } finally { fs.closeSync(fd); }
}
const revision = text => createHash('sha256').update(text).digest('hex');
export async function startWebPanel({ root = ROOT, port = 3081, controller }) {
  const token = randomBytes(32).toString('hex');
  const configFile = path.join(root, 'config.json');
  const dataFile = path.join(root, 'data/state.json');
  const state = () => fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, 'utf8')) : {};
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const actualPort = server.address().port;
      const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (!hosts.includes(req.headers.host)) return send(403, { error: '仅允许本机面板地址' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/api/session') return send(200, { token });
      if (req.headers['x-panel-token'] !== token) {
        if (url.pathname.startsWith('/api/')) return send(403, { error: '面板会话失效，请刷新页面' });
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const s = state();
        return send(200, { service: controller.status(), mood: s.feelings?.mood || null, sleep: s.sleep || null,
          unread: s.sleepUnread?.length || 0, users: Object.keys(s.feelings?.users || {}).length,
          tasks: (s.tasks || []).slice(-12), lastMemoryCompression: s.meta?.lastMemoryCompression,
          summary: tailJson(path.join(root, 'data/actions.jsonl')).filter(row => row.type === 'reply-summary').slice(-8) });
      }
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const text = fs.readFileSync(configFile, 'utf8'); return send(200, { config: JSON.parse(text.replace(/^\uFEFF/, '')), revision: revision(text) });
      }
      if (req.method === 'GET' && url.pathname === '/api/logs') return send(200, controller.logs());
      if (req.method === 'GET' && url.pathname === '/api/activity') return send(200, tailJson(path.join(root, 'data/bilibili-activity.jsonl'), 150));
      if (req.method === 'GET' && url.pathname === '/api/memories') {
        return send(200, Object.entries(state().feelings?.users || {}).map(([id, user]) => ({ id, name: user.name || id,
          affinity: user.affinity, trust: user.trust, contactPaused: user.contactPaused, memories: user.memories || [] })));
      }
      if (req.method === 'POST') {
        if (!hosts.some(host => req.headers.origin === `http://${host}`) || req.headers['content-type']?.split(';')[0] !== 'application/json') return send(403, { error: '请求来源无效' });
        let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 128 * 1024) return send(413, { error: '配置内容过大' }); }
        const body = JSON.parse(text || '{}');
        if (url.pathname === '/api/config') {
          const old = fs.readFileSync(configFile, 'utf8');
          if (revision(old) !== body.revision) return send(409, { error: '配置已被其他窗口修改，请重新载入后再保存' });
          const config = body.config;
          if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !['qq', 'bilibili', 'agent', 'social', 'logging', 'runtime', 'web'].includes(key))) return send(400, { error: '仅支持程序配置，密钥请保留在.env中' });
          normalizeConfig(structuredClone(config));
          const output = JSON.stringify(config, null, 2) + '\n';
          atomicWriteFile(configFile, output);
          return send(200, { revision: revision(output), message: '配置已保存，重启大肥鱼后生效；面板端口变更需重新打开start.cmd' });
        }
        if (url.pathname === '/api/control' && ['start', 'stop', 'restart'].includes(body.action)) return send(202, await controller.control(body.action));
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const asset = req.method === 'GET' && assets[url.pathname];
      if (!asset) return send(404, { error: '页面不存在' });
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'" });
      res.end(fs.readFileSync(path.join(ROOT, 'web', asset[0])));
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}
