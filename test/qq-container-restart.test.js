import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startManager } from '../manager/server.js';

test('QQ container restart uses only the authenticated tenant and preserves agent desired state', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'dfy-qq-restart-'));
  const operations = [];
  let qqRunning = true;
  const manager = await startManager({
    dataRoot: root, port: 0, origins: [],
    runtime: async (operation, username) => {
      operations.push({ operation, username });
      return { restarted: qqRunning };
    },
    request: async () => Response.json({ is_available: true, balance_infos: [] }),
  });
  t.after(async () => { await manager.close(); rmSync(root, { recursive: true, force: true }); });
  manager.accounts.db.prepare('INSERT INTO users(username,created,email) VALUES(?,?,?)')
    .run('alice', Date.now(), 'alice@example.com');
  await manager.tenants.create('alice', { qq: '1234567', adminQQ: '7654321', apiKey: 'deepseek-key-first' });
  manager.accounts.db.prepare('UPDATE bots SET desired=1 WHERE username=?').run('alice');
  manager.tenants.loginKeys.set('alice', { credential: 'stale' });
  operations.length = 0;
  const session = manager.accounts.session('alice');
  const base = 'http://127.0.0.1:' + manager.server.address().port;
  const restart = csrf => fetch(base + '/account/qq/restart', {
    method: 'POST',
    headers: { Cookie: 'dfy_session=' + session.value, Origin: base,
      'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
    body: JSON.stringify({ username: 'bob' }),
  });
  assert.equal((await restart('wrong')).status, 403);
  assert.deepEqual(operations, []);
  const response = await restart(session.csrf);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { restarted: true });
  assert.deepEqual(operations, [{ operation: 'restart-qq', username: 'alice' }]);
  assert.equal(manager.tenants.loginKeys.has('alice'), false);
  assert.equal(manager.accounts.bot('alice').desired, 1);
  qqRunning = false;
  assert.equal((await restart(session.csrf)).status, 409);
});
