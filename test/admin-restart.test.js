import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { startManager } from '../manager/server.js';

test('site admins can schedule the manager and restart only running instances', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'dfy-admin-restart-'));
  const operations = [];
  const manager = await startManager({
    dataRoot: root, port: 0, origins: [],
    runtime: async (operation, username) => {
      operations.push({ operation, username });
      if (operation === 'restart-site') return { scheduled: true };
      if (operation === 'status') return { phase: username === 'alice' ? 'running' : 'stopped', port: '6000' };
      return { phase: 'running' };
    },
    request: async (url) => {
      const endpoint = new URL(url);
      if (endpoint.hostname === 'api.deepseek.com') return Response.json({ is_available: true, balance_infos: [] });
      const data = endpoint.pathname.endsWith('/auth/login') ? { Credential: 'napcat-test' } :
        endpoint.pathname.endsWith('/CheckLoginStatus') ? { isLogin: true } : { uin: '1234567' };
      return Response.json({ code: 0, data });
    },
  });
  t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }); });
  for (const name of ['operator', 'alice', 'bob']) {
    manager.accounts.db.prepare('INSERT INTO users(username,created,email,role) VALUES(?,?,?,?)')
      .run(name, Date.now(), name + '@example.com', name === 'operator' ? 'admin' : 'user');
  }
  for (const [name, qq] of [['alice', '1234567'], ['bob', '2345678']]) {
    await manager.tenants.create(name, { qq, adminQQ: '3456789', apiKey: 'test-key-123' });
    manager.accounts.db.prepare('UPDATE bots SET desired=1 WHERE username=?').run(name);
  }
  operations.length = 0;
  const base = 'http://127.0.0.1:' + manager.server.address().port;
  const call = async (session, body, csrf = session.csrf) => {
    const headers = { Cookie: 'dfy_session=' + session.value, Origin: base,
      'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
    const res = await fetch(base + '/admin/restart', {
      headers, ...(body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) }),
    });
    return { status: res.status, data: await res.json() };
  };
  const admin = manager.accounts.session('operator');
  const user = manager.accounts.session('alice');
  assert.equal((await call(user, { scope: 'all' })).status, 403);
  assert.equal((await call(admin, { scope: 'all' }, 'bad-csrf')).status, 403);
  assert.deepEqual(operations, []);
  async function waitForJob() {
    for (let i = 0; i < 50; i++) {
      const { data } = await call(admin);
      if (data.job?.finishedAt) return data.job.instances;
      await delay(10);
    }
    assert.fail('restart job did not finish');
  }
  assert.equal((await call(admin, { scope: 'user', username: 'bob' })).status, 202);
  assert.deepEqual(await waitForJob(), [{ username: 'bob', state: 'skipped' }]);
  assert.equal((await call(admin, { scope: 'all' })).status, 202);
  assert.deepEqual(await waitForJob(), [{ username: 'alice', state: 'restarted' }, { username: 'bob', state: 'skipped' }]);
  assert.deepEqual(operations.filter(r => ['stop', 'start', 'restart-site', 'restart-qq'].includes(r.operation)), [
    { username: 'alice', operation: 'stop' }, { username: 'alice', operation: 'start' },
  ]);
  assert.equal((await call(admin, { scope: 'site' })).status, 202);
  assert.equal(operations.at(-1).operation, 'restart-site');
  assert.equal(operations.at(-1).username, 'operator');
  assert.equal((await call(admin, { scope: 'site' })).status, 409);
});
