import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { ROOT, loadConfig } from './config.js';
import { startWebPanel } from './web-panel.js';
import { AgentProcess } from './agent-process.js';

const config = loadConfig();
let closing = false;
const lines = []; let sequence = 0;
function record(text, level = 'info') {
  let safe = String(text);
  for (const secret of [config.apiKey, config.wsToken, process.env.BILIBILI_COOKIE]) if (secret) safe = safe.split(secret).join('[已隐藏]');
  const row = { id: ++sequence, time: new Date().toISOString(), level, text: safe.slice(0, 4000) };
  lines.push(row); if (lines.length > 600) lines.shift(); console.log(row.text);
}
const agent = new AgentProcess({ root: ROOT, log: record });
const directory = path.join(ROOT, 'data'); fs.mkdirSync(directory, { recursive: true });
const lock = path.join(directory, 'panel.lock');
if (fs.existsSync(lock)) {
  const pid = Number(fs.readFileSync(lock, 'utf8')); let alive = false;
  if (Number.isSafeInteger(pid) && pid > 0) { try { process.kill(pid, 0); alive = true; } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  if (alive) throw new Error('Web管理面板已经运行，请使用已打开的面板');
  fs.unlinkSync(lock);
}
fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
process.on('exit', () => { try { fs.unlinkSync(lock); } catch {} });
let server;
try {
  if (config.web.enabled) {
    server = await startWebPanel({ port: config.web.port, controller: {
      status: () => agent.status(), logs: () => lines,
      control: async action => agent.control(action),
    } });
    const url = `http://127.0.0.1:${server.address().port}/`;
    record(`Web管理面板：${url}`);
    if (config.web.openBrowser && process.platform === 'win32') spawn('cmd.exe', ['/c', 'start', '', url], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  }
  agent.start();
} catch (error) { record(`启动失败：${error.message}`, 'error'); process.exitCode = 1; }
async function close() {
  if (closing) return; closing = true;
  server?.closeAllConnections();
  if (server?.listening) await new Promise(resolve => server.close(resolve));
  await agent.close(); process.exit(0);
}
process.on("SIGINT", () => void close()); process.on("SIGTERM", () => void close());
