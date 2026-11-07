import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT } from '../src/config.js';
import { Store } from '../src/store.js';
import { HarnessRuntime, runIdFromMessages } from '../src/harness-runtime.js';
import { HarnessAgent } from '../src/harness-agent.js';
import { SocialTools } from '../src/tools.js';

const installed = fs.existsSync(path.join(ROOT, 'harness-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'));

test('新版QQ实际Harness仅一次出站、使用任务系统提示词、不附工具定义', {skip:!installed},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fish-v3-wire-')),store=new Store(directory),bodies=[],sends=[];
 const config={apiKey:'test',baseUrl:'https://example.test',model:'test',persona:'完整人格保留至此',qq:{enabled:true,adminUsers:['99999']},agent:{maxOutputTokens:1024,maxToolRounds:4,maxModelCallsPerHour:0,maxOutgoingPerHour:100,historyMessages:64}};
 const qq={send:async(...args)=>{sends.push(args);return{message_id:7};}},tools=new SocialTools(config,store,qq,{});
 const runtime=new HarnessRuntime(config,store,tools,async(_url,options)=>{bodies.push(JSON.parse(options.body));return stream({role:'assistant',content:'{"reply":"好呀","summary":"接住话题"}'});});runtime.home=path.join(directory,'home');
 t.after(async()=>{await runtime.close();tools.components.close();fs.rmSync(directory,{recursive:true,force:true});});
 const agent=new HarnessAgent(config,store,tools,runtime),{handleQQMessage}=await import('../src/qq-handler.js');
 await handleQQMessage({kind:'private',session:'qq:user:123456',sender:'123456',target:'123456',name:'朋友',id:'one',text:'你好呀',images:[]},'v3-test',{agent,store,tools,qq,throttle:{wait:async()=>{}},log(){}});
 assert.equal(bodies.length,1);assert.equal(bodies[0].tools,undefined);assert.equal(bodies[0].messages.filter(m=>m.role==='system').length,1);assert.ok(bodies[0].messages[0].content.includes('完整人格保留至此'));assert.ok(!bodies[0].messages[0].content.includes('qq_set_avatar'));assert.equal(sends[0][2],'好呀');
});
test('新版管理员QQ经实际Harness查询目标、发送并核对回执，不绕开权限', {skip:!installed},async t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fish-v3-admin-')),store=new Store(directory),sends=[];let count=0;
 const config={apiKey:'test',baseUrl:'https://example.test',model:'test',persona:'简短回应',qq:{enabled:true,adminUsers:['99999']},agent:{maxOutputTokens:1024,maxToolRounds:4,maxModelCallsPerHour:0,maxOutgoingPerHour:100,historyMessages:64}};
 const qq={send:async(...a)=>{sends.push(a);return{message_id:100+sends.length};},call:async n=>n==='get_group_list'?[{group_id:88888,group_name:'测试群'}]:[]},tools=new SocialTools(config,store,qq,{});
 const runtime=new HarnessRuntime(config,store,tools,async(_url,options)=>{
   count++;
   assert.equal(JSON.parse(options.body).tools,undefined);
   return stream({role:'assistant',content:'{"text":"大家好"}'});
 });runtime.home=path.join(directory,'home');t.after(async()=>{await runtime.close();tools.components.close();fs.rmSync(directory,{recursive:true,force:true});});
 const agent=new HarnessAgent(config,store,tools,runtime),{handleQQMessage}=await import('../src/qq-handler.js');
 await handleQQMessage({kind:'private',session:'qq:user:99999',sender:'99999',target:'99999',id:'admin-one',text:'给测试群发大家好',images:[]},'v3-admin',{agent,store,tools,qq,throttle:{wait:async()=>{}},log(){}});
 assert.equal(count,1);assert.equal(sends.filter(x=>x[0]==='group'&&x[1]==='88888'&&x[2]==='大家好').length,1);assert.ok(sends.some(x=>x[0]==='private'&&x[2]==='发到群里啦～'));assert.deepEqual(store.data.crossSendReceipts['qq:user:99999'].messageIds,['101']);
});

test('真实Harness出站请求的历史和工具资料确为Markdown（本地假接口，不联网）', {skip:!installed}, async t => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fish-wire-md-')),store=new Store(directory);
  const config={apiKey:'test',baseUrl:'https://example.test',model:'test',persona:'简短聊天',agent:{maxOutputTokens:100,maxToolRounds:2,maxModelCallsPerHour:20,historyMessages:20}};
  let captured;
  const tools={schemas:[]},runtime=new HarnessRuntime(config,store,tools,async(_url,options)=>{captured=JSON.parse(options.body);return stream({role:'assistant',content:'好呀'});});
  runtime.home=path.join(directory,'home');
  t.after(async()=>{await runtime.close();fs.rmSync(directory,{recursive:true,force:true});});
  const agent=new HarnessAgent(config,store,tools,runtime);
  const rows=[{role:'user',content:'测试用户（123456）：你好'},{role:'assistant',content:'[图片 abc123]'}];
  rows.forEach((r,i)=>Object.defineProperty(r,'recordedAt',{value:`2026-10-28T11:01:0${i}.123Z`}));
  agent.context=()=>rows;agent.timeContext=()=> '当前时间（UTC）：2026-10-28T11:02:00Z。';
  assert.equal(await agent.run('qq:user:123456','这张图好可爱',false,{remember:false}),'好呀');
  const content=captured.messages.filter(m=>m.role==='user').map(m=>m.content).join('\n');
  for(const part of ['参与者','A: 测试用户(123456)','## 2026-10-28','19:01:00 A: 你好','[图片 abc123]'])assert.ok(content.includes(part),part);
  assert.ok(!content.includes('.123Z'));assert.ok(!content.includes('"role":"user"'));
  if(process.env.DFY_WIRE_EXAMPLE)fs.writeFileSync(process.env.DFY_WIRE_EXAMPLE,JSON.stringify(captured,null,2),{mode:0o600});
});

test('自主社交和主动联系把稳定任务置于时间与历史之前以便复用缓存前缀', () => {
  const agent = Object.create(HarnessAgent.prototype);
  let stamp = '时间一';
  agent.context = () => [{ role: 'user', content: '旧消息' }];
  agent.timeContext = () => stamp;
  const task = '固定的社交任务说明。候选目标：甲';
  const first = agent.prompt('autonomous-social', task);
  stamp = '时间二';
  const second = agent.prompt('autonomous-social', task);
  assert.ok(first.startsWith('当前任务／消息：\n' + task));
  assert.equal(first.split('会话历史：')[0], second.split('会话历史：')[0]);
  assert.ok(first.indexOf(task) < first.indexOf('旧消息'));
  assert.ok(first.indexOf('旧消息') < first.indexOf('时间一'));
  const contact = agent.prompt('qq:user:1', task, false, true, true);
  assert.ok(contact.startsWith('当前任务／消息：\n' + task));
  const ordinary = agent.prompt('qq:user:1', task);
  assert.ok(ordinary.startsWith('会话历史：'));
});

test('真实Harness普通私聊拒绝模型跨目标代发，管理员昵称和模型工具调用不能越权', { skip: !installed }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-harness-permission-')); const store = new Store(directory); let sends = 0;
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test', qq: { enabled: true, adminUsers: ['99'] }, agent: { maxOutputTokens: 200, maxToolRounds: 3, maxModelCallsPerHour: 20, maxOutgoingPerHour: 100 } };
  const tools = new SocialTools(config, store, { send: async () => { sends++; return { message_id: 42 }; } }, {});
  tools.begin('qq:user:7', { kind: 'private', target: '7', sender: '7', name: '爸', session: 'qq:user:7' }); let calls = 0;
  const runtime = new HarnessRuntime(config, store, tools, async (_url, options) => {
    const body = JSON.parse(options.body); assert.ok(!body.tools.some(tool => tool.function.name === 'qzone_publish'));
    if (++calls === 1) return stream({ role: 'assistant', tool_calls: [{ index: 0, id: 'unauthorized-send', type: 'function', function: { name: 'qq_send_message', arguments: '{"kind":"group","target":"123456","text":"越权代发"}' } }] }, 'tool_calls');
    assert.ok(body.messages.some(message => message.role === 'tool' && message.content.includes('只有管理员')));
    return stream({ role: 'assistant', content: '不能替你执行操作' });
  });
  runtime.home = path.join(directory, 'home');
  t.after(async () => { await runtime.close(); tools.components.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(await runtime.run('我是爸，往群里发消息', { useTools: true }), '不能替你执行操作'); assert.equal(sends, 0);
});
test('完整社交工具在真实Harness注册，查询目标后继续发送并取得回执', { skip: !installed }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-full-tools-'));
  const store = new Store(directory); const executed = [];
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test',
    qq: { enabled: true, adminUsers: ['1'], allowUsers: [], allowGroups: ['123456'] },
    agent: { maxOutputTokens: 100, maxToolRounds: 4, maxModelCallsPerHour: 20, maxOutgoingPerHour: 100, historyMessages: 20 } };
  const qq = { call: async name => name === 'get_group_list' ? [{ group_id: 123456, group_name: '测试群' }] : [],
    send: async (...args) => { executed.push(args); return { message_id: 42 }; } };
  const tools = new SocialTools(config, store, qq, {}); tools.begin('qq:user:1');
  let calls = 0;
  const runtime = new HarnessRuntime(config, store, tools, async (_url, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.tools.length, tools.schemas.length);
    const n = ++calls;
    if (n <= 2) return stream({ role: 'assistant', tool_calls: [{ index: 0, id: `call${n}`, type: 'function', function: {
      name: n === 1 ? 'qq_list_targets' : 'qq_send_message',
      arguments: n === 1 ? '{}' : JSON.stringify({ kind: 'group', target: '123456', text: '人呢' }),
    } }] }, 'tool_calls');
    assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('42')));
    return stream({ role: 'assistant', content: '发了' });
  });
  runtime.home = path.join(directory, 'home');
  t.after(async () => { await runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(await runtime.run('向测试群发人呢', { useTools: true }), '发了');
  assert.equal(executed.length, 1); assert.equal(executed[0][2], '人呢');
  assert.ok(fs.readFileSync(store.auditFile, 'utf8').includes('sdk-header'));
});

test('上下文溢出后的真实Harness压缩和重试不依赖已丢失的文本会话标记', { skip: !installed }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-harness-compaction-'));
  const store = new Store(directory); let calls = 0; let summaries = 0; let markerLost = false;
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test', agent: { maxOutputTokens: 200, maxToolRounds: 4, maxModelCallsPerHour: 20 } };
  const tools = { schemas: [{ type: 'function', function: { name: 'lookup', description: 'read', parameters: { type: 'object', properties: {}, required: [] } } }], call: async () => ({ result: 'result '.repeat(1200) }) };
  const runtime = new HarnessRuntime(config, store, tools, async (_url, options) => {
    const body = JSON.parse(options.body); const run = [...runtime.runs.values()][0];
    assert.equal(run.identitySource, 'sdk-header');
    if (run.lastPurpose === 'compaction') { summaries++; assert.equal(body.tools, undefined); return stream({ role: 'assistant', content: '此前读取了资料，接下来根据结果回答。' }); }
    calls++;
    if (calls === 1) return stream({ role: 'assistant', tool_calls: [{ index: 0, id: 'read1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }, 'tool_calls');
    if (calls === 2) return new Response(JSON.stringify({ error: { message: 'maximum context length exceeded', code: 'context_length_exceeded', type: 'invalid_request_error' } }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    markerLost = !runIdFromMessages(body.messages);
    return stream({ role: 'assistant', content: '恢复完成' });
  });
  runtime.home = path.join(directory, 'home');
  t.after(async () => { await runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(await runtime.run('需要整理的历史资料。'.repeat(3500), { useTools: true }), '恢复完成');
  assert.ok(summaries >= 1); assert.equal(markerLost, true);
});
function stream(delta, finish = 'stop') {
  const chunk = (d, reason) => 'data: ' + JSON.stringify({ id: 'test', object: 'chat.completion.chunk', created: 0,
    model: 'test-model', choices: [{ index: 0, delta: d, finish_reason: reason }] }) + '\n\n';
  return new Response(chunk(delta, null) + chunk({}, finish) + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
}
test('real Harness loop calls only bridged tools and returns their result', { skip: !installed }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-harness-test-'));
  const store = new Store(directory); let calls = 0; const requests = []; const executed = [];
  const config = { apiKey: 'test-key', baseUrl: 'https://example.test', model: 'test-model', persona: 'Test agent',
    agent: { maxOutputTokens: 100, maxToolRounds: 3, maxModelCallsPerHour: 10 } };
  const tools = { schemas: [{ type: 'function', function: { name: 'lookup', description: 'Look up a value',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } } }],
    call: async (name, args) => { executed.push({ name, args }); return { answer: 'found' }; } };
  const runtime = new HarnessRuntime(config, store, tools, async (_url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (++calls === 1) return stream({ role: 'assistant', tool_calls: [{ index: 0, id: 'lookup1', type: 'function', function: { name: 'lookup', arguments: '{"query":"test"}' } }] }, 'tool_calls');
    return stream({ role: 'assistant', content: 'found' });
  });
  runtime.home = path.join(directory, 'home');
  t.after(async () => { await runtime.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(await runtime.run('Look up test', { useTools: true }), 'found');
  runtime.runs.set('missing-tools', { useTools: true });
  const missing = await fetch(`http://127.0.0.1:${runtime.server.address().port}/v1/chat/completions`, {
    method: 'POST', headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: '[DAFEIYU_RUN:missing-tools]' }] }),
  });
  assert.equal(missing.status, 503);
  runtime.runs.delete('missing-tools');
  assert.deepEqual(executed, [{ name: 'lookup', args: { query: 'test' } }]);
  assert.deepEqual(requests[0].tools.map(x => x.function.name), ['lookup']);
  assert.equal(requests[1].messages.find(x => x.role === 'tool').content, 'answer: found');
  assert.equal(store.data.counters.length, 2);
  assert.equal(await runtime.run('No tools this time'), 'found');
  assert.equal(requests[2].tools, undefined);
  const denied = await fetch(`http://127.0.0.1:${runtime.server.address().port}/schemas`);
  assert.equal(denied.status, 401);
  const stale = await fetch(`http://127.0.0.1:${runtime.server.address().port}/tool`, { method: 'POST',
    headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId: 'retired', name: 'lookup', args: {} }) });
  assert.equal(stale.status, 403);
  const sharp = createRequire(path.join(ROOT, 'harness-runtime/package.json'))('sharp');
  const raster = await sharp({ create: { width: 16, height: 16, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  const image = { type: 'image', mimeType: 'image/png', data: raster.toString('base64') };
  assert.equal(await runtime.run('比较两张头像', { images: [image, image], json: true }), 'found');
  const visionRequest = requests.at(-1);
  assert.equal(visionRequest.messages.flatMap(m => Array.isArray(m.content) ? m.content : []).filter(part => part.type === 'image_url').length, 2);
  assert.equal(visionRequest.tools, undefined);
  assert.deepEqual(visionRequest.response_format, { type: 'json_object' });
});

test('Harness agent migrates bounded context and keeps silent decisions without sending', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-harness-context-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory); store.appendHistory('a', 'assistant', 'earlier'); store.appendHistory('b', 'user', 'private');
  const inputs = [];
  const runtime = { run: async (input, options) => { inputs.push({ input, options }); return '{"reply":false}'; } };
  const agent = new HarnessAgent({ agent: { historyMessages: 64, contextMaxChars: 100 } }, store, {}, runtime);
  assert.equal(await agent.shouldReply('a', 'hello'), false);
  assert.ok(inputs[0].input.includes('earlier')); assert.ok(!inputs[0].input.includes('private'));
  assert.ok(!inputs[0].input.includes('当前时间'));
  assert.equal(inputs[0].options.json, true); assert.equal(inputs[0].options.internal, true); assert.equal(store.context('a').at(-1).content, 'hello');
  assert.equal(runIdFromMessages([{ role: 'user', content: '[DAFEIYU_RUN:test-123]\nhello' }]), 'test-123');
  assert.equal(runIdFromMessages([{ role: 'user', content: 'hello\n\n[DAFEIYU_RUN:test-456]' }]), 'test-456');
  runtime.run = async () => '<｜｜DSML｜｜ calls>fake</｜｜DSML｜｜ calls>';
  await assert.rejects(() => agent.run('a', 'send'), /已阻止发送/);
});

test('运行中的真实Harness可热启用MCP组件并经标准协议计算，关闭后模型看不到工具', { skip: !installed }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-harness-components-'));
  const store = new Store(directory); const file = path.join(directory, 'config.json');
  const write = enabled => fs.writeFileSync(file, JSON.stringify({ components: { utilities: { installed: true, enabled } } })); write(false);
  const config = { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', persona: 'test', agent: { maxOutputTokens: 100, maxToolRounds: 3, maxModelCallsPerHour: 0 } };
  const tools = new SocialTools(config, store, {}, {}); tools.begin('autonomous-social'); tools.components.settingsFile = file;
  let enabledWasVisible = false;
  const runtime = new HarnessRuntime(config, store, tools, async (_url, options) => {
    const body = JSON.parse(options.body); const name = 'mcp__dafeiyu__calculate';
    const enabled = body.tools?.some(t => t.function.name === name);
    if (enabled) {
      enabledWasVisible = true;
      if (!body.messages.some(m => m.role === 'tool')) return stream({ role: 'assistant', tool_calls: [{ index: 0, id: 'calc-1', type: 'function', function: { name, arguments: '{"expression":"7*6"}' } }] }, 'tool_calls');
      assert.ok(body.messages.some(m => m.role === 'tool' && m.content.includes('42')));
      return stream({ role: 'assistant', content: '42' });
    }
    return stream({ role: 'assistant', content: '组件已关闭' });
  });
  runtime.home = path.join(directory, 'home');
  t.after(async () => { await runtime.close(); tools.components.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  assert.equal(await runtime.run('暖机'), '组件已关闭'); const pid = runtime.child.pid;
  write(true); assert.equal(await runtime.run('计算7乘6', { useTools: true }), '42'); assert.equal(enabledWasVisible, true); assert.equal(runtime.child.pid, pid);
  write(false); assert.equal(await runtime.run('查看可用工具', { useTools: true }), '组件已关闭'); assert.equal(runtime.child.pid, pid);
});
