import fs from 'node:fs';
import assert from 'node:assert/strict';
const root = '/opt/dafeiyu'; const access = JSON.parse(fs.readFileSync(`${root}/deploy/server-access.json`, 'utf8'));
const base = 'http://127.0.0.1:3081';
const authorization = `Basic ${Buffer.from(`${access.username}:${access.password}`).toString('base64')}`;
assert.equal((await fetch(base)).status, 401);
assert.equal((await fetch(base, { headers: { Authorization: authorization } })).status, 200);
const session = await (await fetch(base + '/api/session', { headers: { Authorization: authorization } })).json();
const headers = { Authorization: authorization, 'X-Panel-Token': session.token };
const state = await (await fetch(base + '/api/status', { headers })).json();
assert.equal(state.service.phase, 'running');
const invalid = await fetch(base + '/api/life', { method: 'POST', headers: { ...headers, Origin: base, 'Content-Type': 'application/json' }, body: JSON.stringify({ revision: state.life.revision, health: { value: 101 } }) });
assert.equal(invalid.status, 400);
const blocked = await fetch(base + '/api/life', { method: 'POST', headers: { ...headers, Origin: 'https://example.org', 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(blocked.status, 403);
const before = JSON.parse(fs.readFileSync(`${root}/backups/migration-20261027/source-state.json`, 'utf8'));
const after = JSON.parse(fs.readFileSync(`${root}/data/state.json`, 'utf8'));
const oldUsers = Object.keys(before.feelings?.users || {}); const currentUsers = Object.keys(after.feelings?.users || {});
assert.ok(oldUsers.every(id => currentUsers.includes(id)));
const result = { panel: 'ok', authentication: 'ok', sameOriginWrites: 'ok', crossOriginBlocked: true,
  agent: state.service.phase, sleep: state.sleep?.mode, originalUsers: oldUsers.length, currentUsers: currentUsers.length,
  migrationVerification: JSON.parse(fs.readFileSync(`${root}/backups/migration-20261027/verification.json`, 'utf8')) };
fs.writeFileSync(`${root}/backups/migration-20261027/final-check.json`, JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
