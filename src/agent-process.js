import path from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

export class AgentProcess {
  constructor({ root, entry = path.join(root, 'src/main.js'), log = () => {} }) {
    Object.assign(this, { root, entry, log });
    this.child = null; this.phase = 'stopped'; this.lastExit = null; this.restart = false; this.closing = false;
  }
  status() { return { phase: this.phase, pid: this.child?.pid || null, lastExit: this.lastExit }; }
  start() {
    if (this.child || this.closing) return;
    this.phase = 'starting'; this.lastExit = null;
    const child = spawn(process.execPath, ['--env-file-if-exists=.env', this.entry], { cwd: this.root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    this.child = child;
    for (const [stream, level] of [[child.stdout, 'info'], [child.stderr, 'error']]) {
      readline.createInterface({ input: stream }).on('line', line => { this.log(line, level); if (line.includes('大肥鱼已启动') && this.phase !== 'stopping') this.phase = 'running'; });
    }
    child.on('error', error => { this.log(error.message, 'error'); });
    child.on('close', code => {
      if (this.child !== child) return;
      this.child = null; this.lastExit = code; this.phase = code === 0 ? 'stopped' : 'failed';
      this.log(`大肥鱼已停止（退出码 ${code}）`);
      if (this.restart && !this.closing) { this.restart = false; this.start(); }
    });
  }
  stop() {
    if (!this.child || this.phase === 'stopping') return;
    this.phase = 'stopping';
    this.child.send({ type: 'shutdown' }, error => { if (error) this.log(`停止请求未送达：${error.message}`, 'error'); });
  }
  control(action) {
    if (action === 'start') this.start();
    else if (action === 'restart') { if (this.child) { this.restart = true; this.stop(); } else this.start(); }
    else if (action === 'stop') { this.restart = false; this.stop(); }
    return this.status();
  }
  async close() {
    this.closing = true; this.restart = false;
    const child = this.child; if (!child) return;
    const done = new Promise(resolve => child.once('close', resolve)); this.stop(); await done;
  }
}
