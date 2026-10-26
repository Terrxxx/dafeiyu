import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { AgentProcess } from '../src/agent-process.js';

test('面板管理独立子进程：重复启动不创建副本，重启等待旧进程退出，停止走IPC', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-process-')); const entry = path.join(root, 'fake-agent.cjs');
  fs.writeFileSync(entry, `const fs=require('node:fs');fs.appendFileSync('events.txt','start:'+process.pid+'\\n');process.on('message',message=>{if(message.type==='shutdown'){fs.appendFileSync('events.txt','stop:'+process.pid+'\\n');setTimeout(()=>process.exit(0),20);}});console.log('大肥鱼已启动');`);
  const logs = []; const agent = new AgentProcess({ root, entry, log: value => logs.push(value) });
  t.after(async () => { await agent.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const waitFor = async condition => { for (let i = 0; i < 100; i++) { if (condition()) return; await delay(20); } assert.fail('进程未在时限内到达预期状态'); };
  agent.control('start'); const first = agent.status().pid; agent.control('start'); assert.equal(agent.status().pid, first);
  await waitFor(() => agent.status().phase === 'running');
  agent.control('restart'); assert.equal(agent.status().phase, 'stopping');
  await waitFor(() => agent.status().phase === 'running' && agent.status().pid !== first);
  agent.control('stop'); await waitFor(() => agent.status().phase === 'stopped');
  assert.equal(agent.status().pid, null);
  const events = fs.readFileSync(path.join(root, 'events.txt'), 'utf8').trim().split('\n');
  assert.equal(events.length, 4); assert.match(events[0], /^start:/); assert.match(events[1], /^stop:/); assert.match(events[2], /^start:/); assert.match(events[3], /^stop:/);
});
