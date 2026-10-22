import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, loadConfig, allowed } from './config.js';
import { Store, Queue } from './store.js';
import { QQ, parseMessage, ReplyThrottle } from './qq.js';
import { Bilibili, readCookie, parseMention } from './bilibili.js';
import { SocialTools } from './tools.js';
import { Agent } from './agent.js';
import { handleQQMessage } from './qq-handler.js';
import { Tasks } from './tasks.js';
import { MessageBuffer, mergeMessages } from './message-buffer.js';

const config = loadConfig();
const command = process.argv[2] || 'start';
const log = text => console.log(`[${new Date().toLocaleString('zh-CN')}] ${text}`);
const cookie = readCookie();
const bili = new Bilibili(cookie);

async function doctor() {
  const checks = [
    ['Node.js >= 24', Number(process.versions.node.split('.')[0]) >= 24],
    ['DeepSeek API Key', Boolean(config.apiKey)],
    ['NapCat Token', !config.qq.enabled || Boolean(config.wsToken)],
    ['B站登录Cookie', !config.bilibili.enabled || /(?:^|;\s*)SESSDATA=/.test(cookie)],
  ];
  for (const [name, ok] of checks) console.log(`${ok ? 'OK' : '待配置'}  ${name}`);
  console.log(`模型：${config.model}；QQ群聊：${config.qq.requireMentionInGroup ? '@后由AI判断' : '无需@，AI自主判断是否回复'}；B站：每${config.bilibili.browseMinutes}分钟浏览热门`);
  console.log('本地检查不会发送消息。使用 npm run doctor -- --online 可额外检查登录和连接。');
  let failures = checks.some(([, ok]) => !ok);
  if (process.argv.includes('--online')) {
    if (cookie && config.bilibili.enabled) {
      try {
        const nav = await bili.api('/x/web-interface/nav');
        if (!nav.isLogin) throw new Error('登录已失效');
        console.log('OK  B站登录状态');
      } catch (error) { failures = true; console.log(`失败  B站：${error.message}`); }
    }
    if (config.qq.enabled) {
      const qq = new QQ(config, () => {}, log); qq.connect();
      try {
        for (let i = 0; i < 30 && qq.socket?.readyState !== WebSocket.OPEN; i++) await delay(300);
        await qq.call('get_login_info'); console.log('OK  NapCat登录信息可读取');
      } catch (error) { failures = true; console.log(`失败  QQ：${error.message}`); }
      finally { qq.close(); }
    }
  }
  process.exitCode = failures ? 1 : 0;
}

async function start() {
  if (!config.apiKey) { await doctor(); throw new Error('请先在 .env 填写 API Key，再启动'); }
  if (config.qq.enabled && !config.wsToken) throw new Error('请先配置 NAPCAT_TOKEN，并在 NapCat 中设置相同Token');
  const directory = path.join(ROOT, 'data'); fs.mkdirSync(directory, { recursive: true });
  const lock = path.join(directory, 'agent.lock');
  if (fs.existsSync(lock)) {
    const pid = Number(fs.readFileSync(lock, 'utf8'));
    let alive = true;
    try { process.kill(pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
    if (alive) throw new Error('已有实例在运行，请先停止它');
    fs.unlinkSync(lock);
  }
  fs.writeFileSync(lock, String(process.pid), { flag: 'wx' });
  process.on('exit', () => { try { fs.unlinkSync(lock); } catch {} });
  const store = new Store(directory);
  const queue = new Queue(); const throttle = new ReplyThrottle(config.qq.cooldownSeconds); const incoming = new Set();
  let stopping = false; const timers = new Set();
  const reportError = error => log(error.message);
  const buffer = new MessageBuffer(config.qq.mergeSeconds * 1000, config.qq.maxWaitSeconds * 1000, async messages => {
    const msg = mergeMessages(messages);
    const key = `qq-reply:${msg.session}:${msg.id}`;
    try {
      await queue.add(async () => {
        await handleQQMessage(msg, key, { agent, store, tools, qq, throttle, log });
        for (const original of messages) {
          const originalKey = `qq-reply:${original.session}:${original.id}`;
          if (!store.data.actions[originalKey]) store.data.actions[originalKey] = { state: 'batched', time: Date.now() };
        }
        store.save();
      });
    } catch (error) { store.audit('qq-processing-error', { message: error.message }); throw error; }
    finally { for (const original of messages) incoming.delete(`qq-reply:${original.session}:${original.id}`); }
  }, reportError);
  const qq = new QQ(config, event => {
    const msg = parseMessage(event, config.qq, reason => log(`QQ 消息未触发：${reason}`));
    if (!msg || stopping) return;
    const key = `qq-reply:${msg.session}:${msg.id}`;
    if (incoming.has(key) || store.data.actions[key]) { log('QQ 重复消息已忽略'); return; }
    incoming.add(key);
    log('QQ 消息已接收，等待后续消息后一起判断');
    try { buffer.add(msg); } catch (error) { incoming.delete(key); throw error; }
  }, log);
  const tasks = new Tasks(store);
  const tools = new SocialTools(config, store, qq, bili, tasks);
  const agent = new Agent(config, store, tools);
  if (config.qq.enabled) qq.connect();
  const biliReady = config.bilibili.enabled && Boolean(cookie);
  if (!biliReady && config.bilibili.enabled) log('B站尚未登录，先运行 npm run login:bili，登录后重启');

  async function mentions() {
    const events = await bili.mentions();
    if (!store.data.meta.mentionsSince) {
      store.data.meta.mentionsSince = Math.floor(Date.now() / 1000);
      store.save(); log('B站 @ 基线已建立，只处理之后的新通知'); return;
    }
    const ordered = [...events].sort((a, b) => Number(a.at_time) - Number(b.at_time));
    for (const event of ordered) {
      if (stopping) break;
      const time = Number(event.at_time);
      if (!Number.isFinite(time) || time <= store.data.meta.mentionsSince) continue;
      const key = `bili-at:${event.id}`;
      if (store.data.actions[key]) continue;
      const mention = parseMention(event);
      if (!mention || !allowed(config.bilibili.allowMentionUsers, mention.sender)) {
        store.data.actions[key] = { state: 'skipped', time: Date.now() }; store.save();
        store.audit('mention-skipped', { id: String(event.id), reason: '非视频评论、字段不完整或不在允许范围' }); continue;
      }
      try {
        const video = await bili.video(mention.bvid);
        const thread = await bili.verifyThread(mention, video.aid);
        tools.begin(`bili:${mention.sender}:${mention.bvid}`);
        const text = await agent.run(`bili:${mention.sender}:${mention.bvid}`, `请回复这条B站@评论，回复将自动发到原楼层，不需要调用发送工具。只根据以下内容回答：\n评论：${thread.text}\n视频资料：${JSON.stringify(video)}`, false);
        await store.once(key, async () => { tools.outgoing(true); return bili.comment(video.aid, text, thread.root, thread.parent); });
        log('B站 @ 回复已处理');
      } catch (error) {
        const failures = store.data.meta.mentionFailures ||= {};
        failures[key] = (failures[key] || 0) + 1;
        if (failures[key] >= 3 && !store.data.actions[key]) store.data.actions[key] = { state: 'failed', time: Date.now() };
        store.save(); reportError(error);
      }
    }
  }
  async function browse() {
    tools.begin('autonomous-browse');
    const result = await agent.run('autonomous-browse', `现在是${new Date().toISOString()}。这是自主浏览任务：获取B站热门视频，最多读取${config.bilibili.maxVideosPerRound}条，寻找有趣、好笑或值得讨论的内容。读到实际内容后再判断笑点，不假装看见画面。发现合适内容时查询QQ好友/群，自主选择合适对象分享视频链接，配一两句自然的感想；也可以不发。可用task_create给自己安排后续探索，不要为了创建任务而创建。不要广播，不重复分享历史已发内容。最后简要写一份本轮日报，区分读过的内容与工具确认的发送结果。`);
    const reports = path.join(ROOT, 'reports'); fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, `${new Date().toISOString().replace(/[:.]/g, '-')}.md`), result);
    store.data.meta.lastBrowse = Date.now(); store.save(); log('自主浏览结束，日报已保存到 reports');
  }
  async function stop() {
    if (stopping) return; stopping = true;
    buffer.close();
    timers.forEach(clearTimeout); log('正在等待当前任务结束…');
    await queue.tail; qq.close(); process.exit(0);
  }
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  function schedule(task, ms) {
    const tick = async () => {
      if (stopping) return;
      await queue.add(task).catch(reportError);
      if (!stopping) arm();
    };
    const arm = () => {
      const timer = setTimeout(() => { timers.delete(timer); void tick(); }, ms);
      timers.add(timer);
    };
    arm();
  }
  if (command === 'once') {
    try {
      if (!biliReady) throw new Error('单轮浏览需要先登录B站');
      if (config.qq.enabled) for (let i = 0; i < 30 && qq.socket?.readyState !== WebSocket.OPEN; i++) await delay(300);
      await queue.add(browse);
    } finally { qq.close(); }
    return;
  }
  if (config.social.enabled) schedule(async () => {
    tools.begin('autonomous-social');
    const result = await agent.run('autonomous-social', `现在是${new Date().toISOString()}。自主社交时间：你可以看看热门视频，给实际读过且喜欢的视频点赞；可以查询已有好友和允许的群，选择合适的话题主动聊一两句；也可以把真实观察和感想发QQ空间。空间不是私人聊天备份，不公开别人说过的话。没有想说的就保持安静，禁止广播或为了完成任务而发言。需要时安排后续任务。最后简述实际执行结果。`);
    const reports = path.join(ROOT, 'reports'); fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, `social-${Date.now()}.md`), result);
    log('自主社交判断完成');
  }, config.social.intervalMinutes * 60000);
  schedule(() => tasks.tick(async task => {
    tools.begin(task.scope);
    const result = await agent.run(task.scope, `现在是${new Date().toISOString()}，执行你安排的任务：${task.prompt}\n按需调用工具，只有发送工具成功才算通知了用户；最终文本只写入本地。可以决定不打扰用户。`);
    const reports = path.join(ROOT, 'reports'); fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, `task-${task.id}.md`), result);
    log('AI 自主任务执行结束');
  }), 30000);
  if (biliReady) {
    await queue.add(mentions).catch(reportError);
    schedule(mentions, config.bilibili.pollSeconds * 1000);
    if (Date.now() - (store.data.meta.lastBrowse || 0) > config.bilibili.browseMinutes * 60000) await queue.add(browse).catch(reportError);
    schedule(browse, config.bilibili.browseMinutes * 60000);
  }
  log('大肥鱼已启动。Ctrl+C 停止；自主分享已启用。');
}

if (!['start', 'doctor', 'once'].includes(command)) { console.error('命令：start / doctor / once'); process.exitCode = 1; }
else (command === 'doctor' ? doctor() : start()).catch(error => { log(`启动失败：${error.message}`); process.exitCode = 1; });
