import { browseCycle, shoppingCycle } from './activity-cycle.js';
import { markdownData } from './markdown-input.js';
import{refreshQQProfiles}from'./qq-profiles.js';
import{measureActivity}from'./usage-analytics.js';
import{resolveGroupAddress}from'./group-addressing.js';
import{notifyLowBalance}from'./low-balance.js';
import{pollBiliInbox}from'./bili-inbox.js';
import{DailyBudget}from'./daily-budget.js';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT, DATA_ROOT, CONFIG_FILE, loadConfig, allowed } from './config.js';
import { Store, Queue } from './store.js';
import { QQ, parseMessage, ReplyThrottle } from './qq.js';
import { incomingAllowed } from './qq-policy.js';
import { Bilibili, readCookie, parseMention } from './bilibili.js';
import { SocialTools } from './tools.js';
import { Agent } from './agent.js';
import { HarnessAgent } from './harness-agent.js';
import { handleQQMessage } from './qq-handler.js';
import { Tasks } from './tasks.js';
import { MessageBuffer, mergeMessages } from './message-buffer.js';
import { QQProcessing,messageStage,confirmedMessage } from './qq-processing.js';
import { scheduleRecurring, resumeDelay } from './scheduler.js';
import { socialCycle } from './social-cycle.js';
import {executeSocialTask} from './social-planning.js';
import {executeSelfTask} from './life-schedule.js';
import { checkQzoneComments } from './qzone-monitor.js';
import { Sleep } from './sleep.js';
import { FriendRequests } from './friend-requests.js';
import { installBiliJournal } from './bili-journal.js';
import { compactMemories } from './memory-maintenance.js';
import { rememberSleepUnread, reviewSleepUnread } from './sleep-inbox.js';
import { installSleepFarewell, considerWakeGreeting } from './sleep-social.js';
import { userBlocked, filterUserMessage, acceptedSource, assertMemoryEpoch } from './user-controls.js';
import { recordUserActivity } from './user-memory.js';
import { acquireAgentLock } from './agent-lock.js';

const config = loadConfig();
const command = process.argv[2] || 'start';
if (process.platform === 'linux' && !process.env.DAFEIYU_MANAGED && command !== 'doctor' && fs.existsSync(path.join(ROOT, 'data/.platform/migration-complete.json'))) throw new Error('服务器已启用多用户模式，请在网页中启动自己的大肥鱼，避免重复运行原实例');
const log = text => console.log(`[${new Date().toLocaleString('zh-CN')}] ${text}`);
const cookie = readCookie();
const bili = new Bilibili(cookie);
let shutdownRequested = false;
let shutdownHandler;
process.on('SIGTERM', () => { shutdownRequested = true; void shutdownHandler?.(); });
process.on('SIGINT', () => { shutdownRequested = true; void shutdownHandler?.(); });
process.on('billing-empty', () => { shutdownRequested = true; void shutdownHandler?.(); });
process.on('message', message => {
  if (message?.type === 'shutdown') { shutdownRequested = true; void shutdownHandler?.(); }
});

async function doctor() {
  const checks = [
    ['Node.js >= 24', Number(process.versions.node.split('.')[0]) >= 24],
    ['DeepSeek API Key', Boolean(config.apiKey)],
    ['NapCat Token', !config.qq.enabled || Boolean(config.wsToken)],
    ['B站登录Cookie', !config.bilibili.enabled || /(?:^|;\s*)SESSDATA=/.test(cookie)],
    ['Harness运行时', config.runtime !== 'harness' || fs.existsSync(path.join(ROOT, 'harness-runtime/node_modules/@deepseek-ai/dsh/lib/bin.js'))],
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
  const directory = DATA_ROOT;
  acquireAgentLock(directory);
  const store = new Store(directory);const dailyBudget=new DailyBudget(config,store);
  store.qqProcessing=new QQProcessing(directory,{onError:error=>log(`QQ消息状态暂未保存：${error.code||'写入失败'}`)});
  installBiliJournal(bili, store);
  const queue = new Queue(); const throttle = new ReplyThrottle(config.qq.cooldownSeconds); const incoming = new Set();
  let stopping = false; const timers = new Set();
  const reportError = error => log(error.message);
  const buffer = new MessageBuffer(config.qq.mergeSeconds * 1000, config.qq.maxWaitSeconds * 1000, async messages => {
    const eligible = messages.filter(message => incomingAllowed(qq.policy(), message.kind, message.target, message.sender));
    if (!eligible.length) { for (const original of messages){incoming.delete(`qq-reply:${original.session}:${original.id}`);messageStage(store,original,'skipped');}log(`QQ：合并结束，${messages.length}条消息因当前权限跳过`); return; }
    const msg = mergeMessages(eligible);
    const key = `qq-reply:${msg.session}:${msg.id}`;
    messageStage(store,msg,'queued');
    log(`QQ：合并完成（${eligible.length}条，${msg.session}），已进入处理队列`);
    try {
      await queue.add(async () => {
        log(`QQ：开始处理本批消息（${msg.session}）`);
        messageStage(store,msg,'processing');
        await reviewUnread();
        try { await measureActivity(directory,'qq',()=>handleQQMessage(msg, key, { agent, store, tools, qq, throttle, log })); }
        catch (error) {
          if (tools.sleep.sleeping() && !store.data.actions[key] && !(tools.current?.key === key && tools.currentAttempted)) {
            rememberSleepUnread(store, msg, config.agent.historyMessages);
            messageStage(store,msg,'sleeping');
          } else throw error;
        } finally { if (tools.current?.key === key) tools.current = null;log(`QQ：本批消息处理结束（${msg.session}）`); }
        for (const original of eligible) {
          const originalKey = `qq-reply:${original.session}:${original.id}`;
          if (!store.data.actions[originalKey]) store.data.actions[originalKey] = { state: 'batched', time: Date.now() };
        }
        store.save();
      });
    } catch (error) { store.qqProcessing.fail(msg,error);store.audit('qq-processing-error', { message: error.message });log(`QQ：本批处理失败（${msg.session}）· ${error.message}`); throw error; }
    finally { for (const original of messages) incoming.delete(`qq-reply:${original.session}:${original.id}`); }
  }, reportError);
  const qq = new QQ(config, async event => {
    if (stopping) return;
    const paused = dailyBudget.status().paused;
    if (event.post_type === 'request') {
      if (!paused && friendRequests.receive(event)) log('好友申请已保存，清醒时根据好感度处理');
      return;
    }
    let msg = parseMessage(event, qq.policy(), reason => log(`QQ 消息未触发：${reason}`));
    if (!msg || stopping) return;
    msg = filterUserMessage(store, msg); if (!msg) return;
    const key = `qq-reply:${msg.session}:${msg.id}`;
    if (incoming.has(key) || store.data.actions[key]) { log('QQ 重复消息已忽略'); return; }
    recordUserActivity(store, msg);
    delete msg.memoryText;
    tools.feelings.receive(msg);
    if (paused) return;
    if(msg.kind==='group'&&!tools.sleep.sleeping()){msg=await resolveGroupAddress(msg,qq);if(stopping)return;}
    if (incoming.has(key) || store.data.actions[key]) return;
    if (tools.sleep.sleeping()) {
      rememberSleepUnread(store, msg, config.agent.historyMessages);
      messageStage(store,msg,'sleeping');
      return;
    }
    tools.sleep.observeIncoming(msg);
    incoming.add(key);
    try { const pending=buffer.add(msg);msg.processingId=pending.batchId;messageStage(store,msg,'merging',{count:pending.count,waitUntil:Date.now()+pending.waitMs});log(`QQ：消息已接收（${msg.session}），合并等待最多${Math.ceil(pending.waitMs/1000)}秒，当前${pending.count}条`); } catch (error) { incoming.delete(key);store.qqProcessing.fail(msg,error);throw error; }
  }, log);
  qq.policyFile = CONFIG_FILE;
  const tasks = new Tasks(store);
  qq.onSent = (kind, target, receipt, text) => {
    if(tools.current?.kind===kind&&String(tools.current.target)===String(target)&&confirmedMessage(receipt))messageStage(store,tools.current,'replied');
    store.recordSent(kind, target, receipt, text);
    tools.sleep.recordOutgoing(kind, target, receipt);
    if (tools.current?.kind === kind && tools.current.target === String(target) && !tools.current.unreadReview && Date.now() - (tools.current.receivedAt || 0) <= 5 * 60000) tools.sleep.markReply(kind, target);
    if (kind === 'group' && tools.current?.kind === 'group' && tools.current.target === String(target)) {
      recordUserActivity(store, { ...tools.current, sources: (tools.current.sources || [tools.current]).map(source => ({ ...source, id: `${receipt?.message_id}:${source.sender}`, text, receivedAt: Date.now() })) }, 'assistant');
    }
  };
  const tools = new SocialTools(config, store, qq, bili, tasks);
  tools.mediaLog = log;
  tools.sleep = new Sleep(store, tools.feelings);
  const assertAwake = tools.sleep.assertAwake.bind(tools.sleep);
  tools.sleep.assertAwake = (...args) => { if (process.env.DAFEIYU_MANAGED && shutdownRequested) throw new Error('服务正在停止，已阻止新操作'); dailyBudget.assert();return assertAwake(...args); };
  tools.sleep.tick();
  qq.beforeSend = (action, params) => {
    tools.sleep.assertAwake();
    for (const part of params?.message || []) if (part.type === 'text') tools.sleep.assertTemporalReply(part.data?.text || '', !tools.current);
    if (tools.operationEpoch !== undefined && tools.operationEpoch !== null) assertMemoryEpoch(store, tools.operationEpoch);
    if (tools.current?.memoryEpoch !== undefined) assertMemoryEpoch(store, tools.current.memoryEpoch);
    if (params?.user_id && userBlocked(store, params.user_id)) throw new Error('该用户已被屏蔽，未发送');
    if (tools.current && (tools.current.sources || [tools.current]).some(source => !incomingAllowed(qq.policy(), tools.current.kind, tools.current.target, source.sender))) throw new Error('QQ黑名单已更新，本轮回复已取消');
    if (action?.startsWith('send_') && tools.current && (tools.current.sources || [tools.current]).some(source => !acceptedSource(store, source, tools.current.receivedAt))) throw new Error('本轮用户记忆已删除或用户已屏蔽，旧回复未发送');
  };
  qq.beforeRequest = () => tools.sleep.assertAwake();
  tools.browser.beforeRequest = () => tools.sleep.assertAwake();
  tools.avatarIdentity.beforeRequest = () => tools.sleep.assertAwake();
  bili.beforeRequest = () => tools.sleep.assertAwake();
  tools.qzone.beforeRequest = () => tools.sleep.assertAwake();
  const agent = config.runtime === 'harness' ? new HarnessAgent(config, store, tools) : new Agent(config, store, tools);
  tools.components.settingsFile = CONFIG_FILE;
  agent.onDecisionSummary = ({ session, stage, summary }) => log(`AI回应概述（${stage}，${session}）：${summary}`);
  tools.feelings.onEnergyChange = agent.feelings.onEnergyChange = () => tools.sleep.tick();
  installSleepFarewell({ tools, store, qq, log });
  const friendRequests = new FriendRequests(store, agent, tools, qq);
  tools.inspectImage = data => agent.describeImage(data);
  tools.compareAvatar = (reference, candidate) => agent.compareAvatar(reference, candidate);
  async function reviewUnread() {
    if (!config.qq.enabled || qq.socket?.readyState !== WebSocket.OPEN) return;
    await reviewSleepUnread({ agent, store, tools, qq, throttle, log }, handleQQMessage);
    await considerWakeGreeting({ agent, store, tools, qq, log });
  }
  tools.experienceVideo = video => agent.experienceVideo(video);
  if (config.runtime === 'harness') {
    await agent.runtime.start();
    log('DeepSeek Harness 已接管模型与社交工具执行');
  }
  shutdownHandler = stop;
  if (shutdownRequested) { await stop(); return; }
  if (config.qq.enabled) qq.connect();
  const biliReady = config.bilibili.enabled && Boolean(cookie);
  if (!biliReady && config.bilibili.enabled) log('B站尚未登录，先运行 npm run login:bili，登录后重启');

  async function mentions() {
    if (tools.sleep.sleeping() || !tools.components.allowed('bili_my_notices') || config.bilibili.readInboxEnabled===false || config.bilibili.replyInboxEnabled===false) return;
    const events = await bili.mentions();
    if (!store.data.meta.mentionsSince) {
      store.data.meta.mentionsSince = Math.floor(Date.now() / 1000);
      store.save(); log('B站 @ 基线已建立，只处理之后的新通知'); return;
    }
    const ordered = [...events].sort((a, b) => Number(a.at_time) - Number(b.at_time));
    for (const event of ordered) {
      if (stopping || tools.sleep.sleeping()) break;
      const time = Number(event.at_time);
      if (!Number.isFinite(time) || time <= store.data.meta.mentionsSince) continue;
      const key = `bili-at:${event.id}`;
      if (store.data.actions[key]||store.data.actions[`bili-notice:at:${event.id}`]) continue;
      const mention = parseMention(event);
      if (!mention || !allowed(config.bilibili.allowMentionUsers, mention.sender)) {
        store.data.actions[key] = { state: 'skipped', time: Date.now() }; store.save();
        store.audit('mention-skipped', { id: String(event.id), reason: '非视频评论、字段不完整或不在允许范围' }); continue;
      }
      const energyMode = tools.sleep.responseMode();
      if (energyMode === 'sleep') break;
      if (energyMode === 'silent') {
        store.data.actions[key] = { state: 'low-energy-silent', time: Date.now() }; store.save(); continue;
      }
      try {
        const video = await bili.video(mention.bvid);
        const thread = await bili.verifyThread(mention, video.aid);
        tools.begin(`bili:${mention.sender}:${mention.bvid}`);
        const text = await agent.run(`bili:${mention.sender}:${mention.bvid}`, `请回复这条B站@评论，回复将自动发到原楼层，不调用发送工具。${energyMode === 'fog' ? '低精力时简短回应，不编造事实。' : ''}评论：${thread.text.slice(0, 1200)}\n视频资料（未看到画面）：${markdownData({ bvid: video.bvid, title: video.title, description: video.description?.slice(0, 800), subtitle: video.subtitle?.slice(0, 2500), evidence: video.evidence })}`, false, { replySummary: true, maxTokens: 400 });
        await store.once(key, async () => { tools.outgoing(true); return bili.comment(video.aid, text, thread.root, thread.parent); });
        tools.sleep.noteChat(`bili-reply:${key}`);
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
    if (tools.sleep.sleeping()) return;
    store.data.meta.lastBrowseAttempt=Date.now();store.save();
    log('后台自主浏览开始（无需用户消息）');
    const result = await browseCycle({agent,tools,store,config,log});
    const reports = path.join(DATA_ROOT, 'reports'); fs.mkdirSync(reports, {recursive:true});
    fs.writeFileSync(path.join(reports, String(Date.now())+'.md'), markdownData(result));
    store.data.meta.lastBrowse = Date.now(); store.save(); log('自主浏览结束，日报已保存到 reports');
  }
  async function stop() {
    if (stopping) return; stopping = true;
    buffer.close();
    timers.forEach(clearTimeout); log('正在等待当前任务结束…');
    await queue.tail; await agent.close?.(); tools.components.close(); qq.close(); process.exit(0);
  }
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  function schedule(task, ms, firstMs = ms, category='other') {
    scheduleRecurring(() => dailyBudget.status().paused||tools.sleep.sleeping() ? undefined : measureActivity(directory,category,task), ms, { queue, timers, stopped: () => stopping, onError: reportError, firstMs });
  }
  let sleepTimer;
  function sleepClock() {
    if (stopping) return;
    clearTimeout(sleepTimer);
    timers.delete(sleepTimer);
    try {
      tools.sleep.tick();
      if (!dailyBudget.status().paused && !tools.sleep.sleeping() && tools.sleep.windDown().active) void queue.add(() => tools.sleep.onWindDown?.()).catch(reportError);
      if (tools.sleep.shouldCompact()) {
        const result = compactMemories(store);
        if (result.days || result.users) log(`睡眠期间的本地记忆整理与压缩已完成（用户清单${result.users}份）`);
      }
    } catch (error) { reportError(error); }
    const now = Date.now();
    const untilMidnight = tools.sleep.midnight(tools.sleep.day() + 1) - now;
    const untilNapEnds = tools.sleep.isNap() ? tools.sleep.data.napUntil - now : Infinity;
    sleepTimer = setTimeout(sleepClock, Math.max(1, Math.min(60000, untilMidnight, untilNapEnds)));
    timers.add(sleepTimer);
  }
  tools.sleep.onRestScheduled = sleepClock;
  sleepClock();
  if (config.weather.enabled) schedule(async () => {
    try { await tools.weather.refresh(); } catch (error) { log(`本地天气暂未更新：${error.message}`); }
  }, 60000, 5000);
  if (config.qq.enabled) schedule(reviewUnread, 15000, 1500);
  if (command === 'once') {
    try {
      if (!biliReady) throw new Error('单轮浏览需要先登录B站');
      if (config.qq.enabled) for (let i = 0; i < 30 && qq.socket?.readyState !== WebSocket.OPEN; i++) await delay(300);
      await queue.add(browse);
    } finally { buffer.close(); timers.forEach(clearTimeout); await agent.close?.(); tools.components.close(); qq.close(); }
    return;
  }
  if (config.social.enabled) schedule(async () => {
    if (tools.sleep.windDown().active) return;
    log('后台自主社交开始（无需用户消息）');
    store.data.meta.lastSocialAttempt=Date.now();store.save();
    await socialCycle({ agent, tools, store, config, log });
  }, config.social.intervalMinutes * 60000, resumeDelay(store.data.meta.lastSocialAttempt,config.social.intervalMinutes*60000,60000),'social');
  schedule(async()=>{
    if(!tools.components.allowed('mcp__dafeiyu__shopping_search'))return;
    store.data.meta.lastShoppingAttempt=Date.now();store.save();
    await shoppingCycle({agent,tools,store,config,log});
  },Math.max(30,config.social.intervalMinutes*3)*60000,resumeDelay(store.data.meta.lastShoppingAttempt,Math.max(30,config.social.intervalMinutes*3)*60000,90000),'shopping');
  if(config.qq.enabled)schedule(()=>refreshQQProfiles({store,tools,qq}),300000,20000);
  if(config.qq.enabled)schedule(()=>notifyLowBalance({directory,config,store,tools,qq,log}),60000,15000);
  if (config.qq.enabled) schedule(() => friendRequests.tick(), 60000, 10000);
  if (config.qq.enabled && config.social.qzoneEnabled && config.social.qzoneAutoReply) {
    schedule(() => tools.components.allowed('qzone_read') ? checkQzoneComments({ tools, agent, store, log }) : undefined, config.social.qzonePollMinutes * 60000, 45000,'qzone');
  }
  schedule(() => tasks.tick(async task => {
    tools.begin(task.scope);
    const result = task.autonomousActivity ? await executeSelfTask(task,{agent,tools,store,config,log,browse,shopping:()=>shoppingCycle({agent,tools,store,config,log})}) : task.autonomousTarget ? await executeSocialTask(task,{agent,tools,store,config,log}) : await agent.run(task.scope, `现在是${new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')}，执行你安排的任务：${task.prompt}\n按需调用工具，只有发送工具成功才算通知了用户；最终文本只写入本地。可以决定不打扰用户。`);
    const reports = path.join(DATA_ROOT, 'reports'); fs.mkdirSync(reports, { recursive: true });
    fs.writeFileSync(path.join(reports, `task-${task.id}.md`), result);
    log('AI 自主任务执行结束');
  }), 30000);
  if (biliReady) {
    schedule(() => !tools.sleep.windDown().active && tools.components.allowed('bili_popular') ? browse() : undefined, config.bilibili.browseMinutes * 60000, resumeDelay(store.data.meta.lastBrowseAttempt||store.data.meta.lastBrowse,config.bilibili.browseMinutes*60000,30000),'browse');
    await queue.add(mentions).catch(reportError);
    schedule(mentions, config.bilibili.pollSeconds * 1000,undefined,'inbox');
    schedule(()=>pollBiliInbox({bili,tools,agent,store,log}),Math.max(300000,config.bilibili.pollSeconds*1000),120000,'inbox');
  }
  log(`大肥鱼已启动。自主社交：${config.social.enabled ? `每${config.social.intervalMinutes}分钟` : '关闭'}；自主浏览：${biliReady ? `每${config.bilibili.browseMinutes}分钟` : '未启用或未登录'}。启动沿用上次执行时间，实际执行可能等待队列。`);
}

if (!['start', 'doctor', 'once'].includes(command)) { console.error('命令：start / doctor / once'); process.exitCode = 1; }
else (command === 'doctor' ? doctor() : start()).catch(error => { log(`启动失败：${error.message}`); process.exitCode = 1; });

