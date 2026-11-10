import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';

const available = process.platform === 'linux' && typeof process.execve === 'function' && fs.existsSync('/usr/bin/flock');
const code = `
  import { acquireAgentLock } from ${JSON.stringify(new URL('../src/agent-lock.js', import.meta.url).href)};
  acquireAgentLock(process.argv[1]);
  console.log('ready');
  if (process.argv[2] === 'hold') setInterval(() => {}, 1000);
`;
const options = { env: { ...process.env, DAFEIYU_MANAGED: '1' }, encoding: 'utf8' };
const args = (directory, ...rest) => ['--input-type=module', '--eval', code, directory, ...rest];
function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-agent-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('managed lock rejects a concurrent process and is released after SIGKILL', { skip: !available, timeout: 15000 }, async t => {
  const directory = workspace(t);
  const lock = path.join(directory, 'agent.lock');
  fs.writeFileSync(lock, '2147483647');
  const owner = spawn(process.execPath, args(directory, 'hold'), options);
  const exited = once(owner, 'exit');
  t.after(() => owner.kill('SIGKILL'));
  const first = await Promise.race([once(owner.stdout, 'data'), exited]);
  assert.equal(String(first[0]).trim(), 'ready');
  assert.equal(fs.existsSync(lock), false);

  const contender = spawnSync(process.execPath, args(directory), { ...options, timeout: 5000 });
  assert.equal(contender.status, 1);
  assert.match(contender.stderr, /已有实例在运行/);
  owner.kill('SIGKILL');
  await exited;
  const next = spawnSync(process.execPath, args(directory), { ...options, timeout: 5000 });
  assert.equal(next.status, 0, next.stderr);
  assert.equal(next.stdout.trim(), 'ready');
});

test('managed startup preserves a live legacy PID lock', { skip: !available }, t => {
  const directory = workspace(t);
  const lock = path.join(directory, 'agent.lock');
  fs.writeFileSync(lock, String(process.pid));
  const result = spawnSync(process.execPath, args(directory), { ...options, timeout: 5000 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /已有实例在运行/);
  assert.equal(fs.readFileSync(lock, 'utf8'), String(process.pid));
});
