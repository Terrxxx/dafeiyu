import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT } from '../src/config.js';
import { startWebPanel } from '../src/web-panel.js';
import { Store } from '../src/store.js';
import { Feelings } from '../src/feelings.js';
import { Sleep } from '../src/sleep.js';
import { compactMemories } from '../src/memory-maintenance.js';
import { readUserMemory } from '../src/user-memory.js';
import { gunzipSync } from 'node:zlib';

test('小日程最多显示最新10条，按创建顺序倒序且保留全部历史',async t=>{
 const f=await setup(t),file=path.join(f.root,'data/state.json'),state=JSON.parse(fs.readFileSync(file));
 state.tasks=Array.from({length:14},(_,i)=>({id:String(i),status:i%2?'pending':'done',due:99999-i}));
 const raw=JSON.stringify(state);fs.writeFileSync(file,raw);const response=await(await f.get('/api/status')).json();assert.deepEqual(response.tasks.map(t=>t.id),['13','12','11','10','9','8','7','6','5','4']);assert.equal(fs.readFileSync(file,'utf8'),raw);
});

async function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-web-')); fs.mkdirSync(path.join(root, 'data'));
  fs.copyFileSync(path.join(ROOT, 'config.example.json'), path.join(root, 'config.json'));
  {const cfg=JSON.parse(fs.readFileSync(path.join(root,'config.json')));cfg.life={editingEnabled:true};fs.writeFileSync(path.join(root,'config.json'),JSON.stringify(cfg));}
  fs.writeFileSync(path.join(root, 'persona.md'), '最初的角色提示词');
  fs.writeFileSync(path.join(root, 'data/state.json'), JSON.stringify({ histories: {}, actions: {}, counters: [], meta: {}, feelings: { events: [], updatedAt: Date.now(), mood: { energy: 42, joy: 45, sadness: 10, irritation: 5, curiosity: 50 }, users: { '123': { name: '测试用户',qqNickname:'测试用户', affinity: 2, trust: 30, familiarity: 0, memories: [{ scope: 'qq:user:123', quote: '<script>不要执行</script>' }] } } } }));
  const actions = [];
  const server = await startWebPanel({ root, port: 0, controller: {
    status: () => ({ phase: 'stopped' }), logs: () => [{ id: 1, text: '验证日志' }], control: async action => { actions.push(action); return { phase: 'starting' }; },
  } });
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const token = (await (await fetch(base + '/api/session')).json()).token;
  const get = path => fetch(base + path, { headers: { 'X-Panel-Token': token } });
  const post = (path, body, headers = {}) => fetch(base + path, { method: 'POST', headers: { 'X-Panel-Token': token, Origin: base, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { root, base, get, post, actions };
}
test('Web面板展示本机状态、日志和记忆，不暴露任意文件路径', async t => {
  const f = await setup(t);
  assert.equal((await (await f.get('/api/status')).json()).mood.energy, 42);
  assert.equal((await (await f.get('/api/logs')).json())[0].text, '验证日志');
  assert.equal((await (await f.get('/api/memories')).json())[0].name, '测试用户');
  assert.equal((await f.get('/.env')).status, 404);
  assert.equal((await f.get('/src/config.js')).status, 404);
  assert.equal((await f.get('/')).status, 200);
  assert.match((await f.get('/')).headers.get('content-security-policy'), /frame-ancestors 'none'/);
});
test('配置保存验证数值、检查版本冲突并保留未改字段，非法修改不落盘', async t => {
  const f = await setup(t); const old = await (await f.get('/api/config')).json();
  const config = structuredClone(old.config); config.social.maxQzonePostsPerHour = 7;
  const response = await f.post('/api/config', { config, revision: old.revision }); assert.equal(response.status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'config.json')));
  assert.equal(saved.social.maxQzonePostsPerHour, 7); assert.equal(saved.qq.cooldownSeconds, old.config.qq.cooldownSeconds);
  assert.equal((await f.post('/api/config', { config, revision: old.revision })).status, 409);
  const latest = await (await f.get('/api/config')).json(); config.bilibili.maxDynamicsPerHour = -1;
  assert.equal((await f.post('/api/config', { config, revision: latest.revision })).status, 400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'config.json'))).bilibili.maxDynamicsPerHour, old.config.bilibili.maxDynamicsPerHour);
});
test('控制接口仅接收认证的本机JSON请求，拒绝跨站、未知操作和密钥写入', async t => {
  const f = await setup(t);
  assert.equal((await fetch(f.base + '/api/status')).status, 403);
  assert.equal((await f.post('/api/control', { action: 'start' }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.post('/api/control', { action: 'start' }, { 'X-Panel-Token': 'invalid' })).status, 403);
  assert.equal((await f.post('/api/control', { action: 'shell' })).status, 404);
  for (const action of ['start', 'stop', 'restart']) assert.equal((await f.post('/api/control', { action })).status, 202);
  assert.deepEqual(f.actions, ['start', 'stop', 'restart']);
  const old = await (await f.get('/api/config')).json();
  assert.equal((await f.post('/api/config', { config: { ...old.config, apiKey: 'secret' }, revision: old.revision })).status, 400);
});

test('用户目录不返回聊天或记忆，详情按真实用户隔离并返回保存记录和摘要', async t => {
  const f = await setup(t); const file = path.join(f.root, 'data/state.json'); const s = JSON.parse(fs.readFileSync(file));
  s.feelings.users['123'].familiarity = 42;
  s.feelings.users['456'] = { name: '另一位', memories: [{ quote: '另一位的秘密' }] };
  s.histories = { 'qq:user:123': [{ role: 'user', content: '自己的聊天', time: '2026-10-26' }], 'qq:user:456': [{ role: 'user', content: '另一位的秘密聊天' }], 'qq:group:9': [{ role: 'user', content: '群里其他人的聊天' }] };
  s.sleepSummaries = { 'qq:user:123': [{ day: '2026-10-25', text: '自己的旧摘录', count: 10 }] };
  fs.writeFileSync(file, JSON.stringify(s));
  const list = await (await f.get('/api/memories')).json();
  assert.equal(list[0].familiarity, 42); assert.equal(list[0].memoryCount, 1);
  assert.ok(!JSON.stringify(list).includes('自己的聊天')); assert.ok(!JSON.stringify(list).includes('另一位的秘密'));
  assert.equal(list[0].memories, undefined);
  const detail = await (await f.get('/api/memories/123')).json();
  assert.equal(detail.memories[0].quote, '<script>不要执行</script>');
  assert.equal(detail.history[0].content, '自己的聊天'); assert.equal(detail.summaries[0].text, '自己的旧摘录');
  assert.ok(!JSON.stringify(detail).includes('另一位的秘密')); assert.ok(!JSON.stringify(detail).includes('群里其他人'));
  assert.equal((await f.get('/api/memories/999')).status, 404);
  assert.equal((await fetch(f.base + '/api/memories/123')).status, 403);
});

test('QQ足迹仅从独立空间日志读取，不读取聊天审计与历史', async t => {
  const f = await setup(t);
  fs.writeFileSync(path.join(f.root, 'data/qq-activity.jsonl'), [
    { id: '1', operation: 'publish', state: 'started', input: { text: '公开动态' } },
    { id: '1', operation: 'publish', state: 'succeeded', receipt: { tid: 'abc' } },
    { id: '2', operation: 'chat', input: { text: '不应该显示的聊天' } },
  ].map(x => JSON.stringify(x)).join('\n'));
  fs.writeFileSync(path.join(f.root, 'data/actions.jsonl'), JSON.stringify({ type: 'chat', text: '其他聊天内容' }));
  const rows = await (await f.get('/api/qq-activity')).json();
  assert.equal(rows.length, 2); assert.equal(rows[0].input.text, '公开动态');
  assert.ok(!JSON.stringify(rows).includes('聊天'));
  assert.equal((await fetch(f.base + '/api/qq-activity')).status, 403);
});

test('提示词保存原文件并备份，可恢复，拒绝冲突/空内容/越权路径', async t => {
  const f = await setup(t); const original = await (await f.get('/api/persona')).json();
  assert.equal((await fetch(f.base + '/api/persona')).status, 403);
  assert.equal((await f.post('/api/persona', { text: '新的角色提示词', revision: original.revision })).status, 200);
  assert.equal(fs.readFileSync(path.join(f.root, 'persona.md'), 'utf8'), '新的角色提示词');
  const backups = await (await f.get('/api/persona/backups')).json(); assert.equal(backups.length, 1);
  assert.equal((await (await f.get('/api/persona/backups/' + backups[0].id)).json()).text, original.text);
  assert.equal((await f.post('/api/persona', { text: '覆盖冲突', revision: original.revision })).status, 409);
  const current = await (await f.get('/api/persona')).json();
  assert.equal((await f.post('/api/persona', { text: ' ', revision: current.revision })).status, 400);
  assert.equal((await f.get('/api/persona/backups/not-a-backup')).status, 404);
});

test('组件目录只安装已知组件，启停原子保存并保留其他配置，RSS配置校验', async t => {
  const f = await setup(t); let data = await (await f.get('/api/components')).json();
  const utility = data.components.find(c => c.id === 'utilities'); assert.equal(utility.installed, false); assert.equal(utility.enabled, false);
  const before = JSON.parse(fs.readFileSync(path.join(f.root, 'config.json')));
  assert.equal((await f.post('/api/components', { id: 'utilities', installed: true, enabled: true, revision: data.revision })).status, 200);
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, 'config.json'))); assert.equal(saved.components.utilities.enabled, true); assert.deepEqual(saved.agent, before.agent);
  assert.equal((await f.post('/api/components', { id: 'notes', installed: true, enabled: true, revision: data.revision })).status, 409);
  data = await (await f.get('/api/components')).json();
  assert.equal((await f.post('/api/components', { id: 'shell', installed: true, enabled: true, revision: data.revision, command: 'anything' })).status, 400);
  assert.equal((await f.post('/api/components', { id: 'rss', installed: true, enabled: true, feeds: [{ id: 'x', name: 'x', url: 'file:///etc/passwd' }], revision: data.revision })).status, 403);
  assert.equal((await f.post('/api/components', { id: 'utilities', enabled: false, revision: data.revision })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.root, 'config.json'))).components.utilities.enabled, false);
});

test('Web用户清单可编辑，关系保持自然变化，版本冲突不会覆盖睡眠更新', async t => {
  const f = await setup(t); const original = await (await f.get('/api/memories/123')).json();
  const payload = { action: 'save', scope: 'qq:user:123', text: '- 喜欢草莓\n- 聊天简短一点', revision: original.checklist.revision };
  assert.equal((await f.post('/api/memories/123', payload)).status, 200);
  const updated = await (await f.get('/api/memories/123')).json();
  assert.equal(updated.affinity, 2); assert.equal(updated.checklist.sections['qq:user:123'].text, payload.text);
  assert.equal((await f.post('/api/memories/123', payload)).status, 409);
  assert.equal((await f.post('/api/memories/123', { ...payload, revision: updated.checklist.revision, scope: 'qq:user:456' })).status, 400);
  assert.equal((await f.post('/api/memories/123', { ...payload, revision: updated.checklist.revision, scores: { ...payload.scores, affinity: 101 } })).status, 400);
  const store = new Store(path.join(f.root, 'data')); const feelings = new Feelings(store);
  store.save(); assert.equal(feelings.user('123').affinity, 2);
  const msg = { sender: '123', session: 'qq:user:123', text: '你好呀' };
  feelings.receive(msg); feelings.applyChat(msg, { users: [{ id: '123', reaction: 'friendly', evidence: '你好呀' }] }, 'new-friendliness');
  assert.equal((await (await f.get('/api/memories/123')).json()).affinity, 4);
});

test('Web删除清空压缩资料和私聊归档，屏蔽状态保留并可解除，不写并发运行的state.json', async t => {
  const f = await setup(t); const directory = path.join(f.root, 'data'); const store = new Store(directory);
  const feelings = new Feelings(store); feelings.user('123').lastIncoming = Date.now() - 1000;
  feelings.user('456').memories.push({ scope: 'qq:user:456', quote: '保留另一个用户的记忆', time: Date.now() });
  store.data.sleep = { needsCompaction: true };
  store.appendHistory('qq:user:123', 'user', '需要被删除的旧聊天'); store.appendHistory('qq:user:456', 'user', '另一个用户的聊天'); compactMemories(store);
  const stateBefore = fs.readFileSync(store.file, 'utf8');
  assert.equal((await f.post('/api/memories/123', { action: 'block' })).status, 200);
  assert.equal((await (await f.get('/api/memories/123')).json()).blocked, true);
  assert.equal((await f.post('/api/memories/123', { action: 'delete' })).status, 200);
  assert.equal(fs.readFileSync(store.file, 'utf8'), stateBefore);
  const deleted = await (await f.get('/api/memories/123')).json();
  assert.equal(deleted.blocked, true); assert.equal(deleted.affinity, 0); assert.deepEqual(deleted.checklist.sections, {}); assert.deepEqual(deleted.history, []);
  for (const file of fs.readdirSync(path.join(directory, 'memory')).filter(name => name.endsWith('.gz'))) assert.ok(!gunzipSync(fs.readFileSync(path.join(directory, 'memory', file))).toString().includes('需要被删除的旧聊天'));
  store.save(); assert.equal(feelings.data.users['123'], undefined); assert.ok(feelings.data.users['456']);
  compactMemories(store); assert.deepEqual(readUserMemory(directory, '123').sections, {});
  assert.equal((await f.post('/api/memories/123', { action: 'unblock' })).status, 200);
  assert.equal((await f.get('/api/memories/123')).status, 404);
  assert.ok(!(await (await f.get('/api/memories')).json()).some(user => user.id === '123'));
});

test('用户情绪和关系分数不允许手工修改，记忆仍可编辑',async t=>{const f=await setup(t),user=await(await f.get('/api/memories/123')).json();const body={action:'save',scope:'qq:user:123',text:'喜欢音乐',revision:user.checklist.revision,scores:{affinity:5,trust:40,familiarity:8,emotions:{affection:72}}};assert.equal((await f.post('/api/memories/123',body)).status,400);delete body.scores;assert.equal((await f.post('/api/memories/123',body)).status,200);assert.equal((await(await f.get('/api/memories/123')).json()).emotions.affection,user.emotions.affection);});

test('Web动态修改精力消耗与全部自身情绪，不覆盖state，校验范围并检查版本冲突', async t => {
  const f = await setup(t); const directory = path.join(f.root, 'data'); const store = new Store(directory);
  const feelings = new Feelings(store); const sleep = new Sleep(store, feelings); sleep.tick();
  const before = fs.readFileSync(store.file, 'utf8'); const status = await (await f.get('/api/status')).json();
  const body = { revision: status.life.revision, mood: { energy: 57, inspiration: 81, security: 64 }, rates: { baseDrainPerHour: 6, maxDrainPerHour: 9, recoveryPerHour: 12 } };
  assert.equal((await f.post('/api/life', body)).status, 200);
  assert.equal(fs.readFileSync(store.file, 'utf8'), before);
  const pending = await (await f.get('/api/status')).json(); assert.equal(pending.mood.energy, 57); assert.equal(pending.life.rates.recoveryPerHour, 12);
  sleep.tick(); assert.ok(Math.abs(feelings.data.mood.energy - 57) < 0.01); assert.equal(feelings.data.mood.inspiration, 81); assert.equal(sleep.drainRate(), 6);
  assert.equal((await f.post('/api/life', body)).status, 409);
  for (const change of [{ mood: { energy: -1 } }, { mood: { fake: 1 } }, { mood: { security: 101 } }, { rates: { baseDrainPerHour: 10, maxDrainPerHour: 8 } }, { rates: { recoveryPerHour: 0 } }]) {
    assert.equal((await f.post('/api/life', { revision: pending.life.revision, ...change })).status, 400);
  }
});

test('Web不再返回健康和心率，健康编辑被拒绝且原状态不变', async t => {
  const f = await setup(t); const stateFile = path.join(f.root, 'data/state.json'); const before = fs.readFileSync(stateFile, 'utf8');
  const status = await (await f.get('/api/status')).json(); assert.equal(Object.hasOwn(status,'health'), false); assert.equal(Object.hasOwn(status.life,'health'),false);
  const result = await f.post('/api/life', { revision: status.life.revision, health: { value: 34, restingHeartRate: 72 } }); assert.equal(result.status, 400);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
});

test('浏览器程序路径不再展示，伪造配置请求也不能设置可执行程序',async t=>{const f=await setup(t),current=await(await f.get('/api/config')).json();assert.equal(Object.hasOwn(current.config.social,'browserPath'),false);current.config.social.browserPath='/tmp/untrusted-program';const response=await f.post('/api/config',current);assert.equal(response.status,400);assert.match((await response.json()).error,/浏览器/);assert.ok(!fs.readFileSync(path.join(f.root,'config.json'),'utf8').includes('/tmp/untrusted-program'));});

test('清空运行日志有持久标记，不删除空间足迹或业务记录',async t=>{const f=await setup(t);const journal=path.join(f.root,'data/qq-activity.jsonl');fs.writeFileSync(journal,'业务记录保留');assert.equal((await f.post('/api/logs/clear',{})).status,200);assert.ok(JSON.parse(fs.readFileSync(path.join(f.root,'data/log-clear.json'))).after>0);assert.deepEqual(await(await f.get('/api/logs')).json(),[]);assert.equal(fs.readFileSync(journal,'utf8'),'业务记录保留');});

test('情绪健康默认只读，未开启设置时接口也拒绝编辑',async t=>{const f=await setup(t),file=path.join(f.root,'config.json'),config=JSON.parse(fs.readFileSync(file));delete config.life;fs.writeFileSync(file,JSON.stringify(config));const state=await(await f.get('/api/status')).json();assert.equal(state.life.editable,false);assert.equal((await f.post('/api/life',{revision:state.life.revision,mood:{energy:55}})).status,403);});

test('伪造合法分数或顶层关系字段也不能修改，拒绝后记忆和关系均不变',async t=>{const f=await setup(t),before=await(await f.get('/api/memories/123')).json();for(const fields of [{scores:{affinity:20,trust:80,familiarity:60}},{scores:{}},{affinity:20},{trust:80},{familiarity:60},{emotions:{affection:80}}]){const response=await f.post('/api/memories/123',{action:'save',scope:'qq:user:123',text:'不能通过伪造写入',revision:before.checklist.revision,...fields});assert.equal(response.status,400);}const after=await(await f.get('/api/memories/123')).json();for(const key of ['affinity','trust','familiarity'])assert.equal(after[key],before[key]);assert.deepEqual(after.checklist,before.checklist);});

test('情绪健康开关立即控制API写入，关闭后不改变已保存值',async t=>{const f=await setup(t),file=path.join(f.root,'config.json'),config=JSON.parse(fs.readFileSync(file));config.life={editingEnabled:false};fs.writeFileSync(file,JSON.stringify(config));let state=await(await f.get('/api/status')).json();assert.equal((await f.post('/api/life',{revision:state.life.revision,mood:{joy:60}})).status,403);config.life.editingEnabled=true;fs.writeFileSync(file,JSON.stringify(config));state=await(await f.get('/api/status')).json();assert.equal(state.life.editable,true);assert.equal((await f.post('/api/life',{revision:state.life.revision,mood:{joy:60}})).status,200);const control=path.join(f.root,'data/life-controls.json'),before=fs.readFileSync(control,'utf8');config.life.editingEnabled=false;fs.writeFileSync(file,JSON.stringify(config));state=await(await f.get('/api/status')).json();assert.equal(state.life.editable,false);assert.equal((await f.post('/api/life',{revision:state.life.revision,mood:{joy:90}})).status,403);assert.equal(fs.readFileSync(control,'utf8'),before);});
