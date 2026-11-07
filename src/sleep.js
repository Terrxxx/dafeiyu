import { markdownData } from './markdown-input.js';
import path from 'node:path';
import { readLifeControls, defaultRates } from './life-controls.js';

const HOUR = 3600000;
const DAY = 24 * HOUR;
const clamp = n => Math.max(0, Math.min(100, n));

export class Sleep {
  constructor(store, feelings, now = Date.now, random = Math.random) {
    Object.assign(this, { store, feelings, now, random });
    if (store.data.sleep?.version !== 2) {
      store.data.sleep = { version: 2, mode: 'awake', lastTick: now(), nightDay: null, needsCompaction: false };
    }
    this.data = store.data.sleep;
    this.data.energyRateVersion = 1;
    this.data.chatEvents ||= [];
    this.data.chatTargets ||= {};
    if (this.data.dozeRuleVersion !== 2) { this.data.dozeAtEnergy = this.chooseDozeEnergy(); this.data.dozeRuleVersion = 2; }
    this.data.rates ||= { ...defaultRates };
    this.data.nightPlans ||= {};
    if (this.data.mode === 'sleep' && this.data.reason === 'exhausted' && this.data.minWakeAt && this.data.exhaustedWakeWindowVersion !== 1) {
      this.data.wakeDelayMinutes = this.chooseWakeDelay();
      this.data.minWakeAt += this.data.wakeDelayMinutes * 60000;
      this.data.exhaustedWakeWindowVersion = 1;
      this.store.save();
    }
  }
  chooseWakeDelay() { return Math.max(0, Math.min(30, Math.floor(this.random() * 31))); }
  chooseDozeEnergy() { return this.random() < 0.95 ? 10 : 0; }
  drainRate(at = this.now()) {
    const count = this.data.chatEvents.filter(event => event.at <= at && event.at + HOUR > at).length;
    const { baseDrainPerHour, maxDrainPerHour } = this.data.rates;
    return baseDrainPerHour + Math.min(maxDrainPerHour - baseDrainPerHour, count * (maxDrainPerHour - baseDrainPerHour) / 20);
  }
  noteChat(key, target = null) {
    this.tick();
    if (this.data.mode === 'sleep' || this.data.chatEvents.some(event => event.key === key)) return;
    this.data.chatEvents.push({ key, at: this.now() });
    this.data.chatEvents = this.data.chatEvents.slice(-500);
    if (target) this.trackTarget(target);
    this.store.save();
  }
  trackTarget({ kind, target, direction }) {
    if (!['private', 'group'].includes(kind) || !/^[1-9]\d*$/.test(String(target))) return;
    const key = `${kind}:${target}`;
    const chat = this.data.chatTargets[key] ||= { kind, target: String(target) };
    chat[direction === 'incoming' ? 'lastIncoming' : 'lastOutgoing'] = this.now();
    this.data.chatTargets = Object.fromEntries(Object.entries(this.data.chatTargets)
      .sort((a, b) => Math.max(b[1].lastIncoming || 0, b[1].lastOutgoing || 0) - Math.max(a[1].lastIncoming || 0, a[1].lastOutgoing || 0)).slice(0, 50));
  }
  observeIncoming(msg) {
    if (this.sleeping()) return;
    this.trackTarget({ ...msg, direction: 'incoming' }); this.store.save();
  }
  recordOutgoing(kind, target, receipt) {
    for (const item of receipt?.messages || [receipt]) if (item?.message_id !== undefined) {
      this.noteChat(`qq-outgoing:${item.message_id}`, { kind, target, direction: 'outgoing' });
    }
  }
  day(time = this.now()) { return Math.floor((time + 8 * HOUR) / DAY); }
  midnight(day) { return day * DAY - 8 * HOUR; }
  bedtime(day) {
    return this.data.nightPlans[day] ??= this.midnight(day) + Math.round(this.random() * 20 - 10) * 60000;
  }
  windDown(at = this.now()) {
    const day = this.day(at);
    const night = this.data.nightDay !== day && this.bedtime(day) >= at ? day : day + 1;
    const bedtimeAt = this.bedtime(night); const remaining = bedtimeAt - at;
    return { active: this.data.mode === 'awake' && remaining > 0 && remaining <= 10 * 60000,
      bedtimeAt, remainingMinutes: Math.max(0, Math.ceil(remaining / 60000)), progress: Math.max(0, Math.min(1, 1 - remaining / 600000)) };
  }
  activeChats(at = this.now()) {
    return Object.values(this.data.chatTargets).filter(chat => chat.lastReplyAt && chat.lastIncoming && chat.lastOutgoing &&
      at - chat.lastReplyAt <= 5 * 60000 && at - chat.lastIncoming <= 5 * 60000 && at - chat.lastOutgoing <= 5 * 60000)
      .sort((a, b) => b.lastReplyAt - a.lastReplyAt).slice(0, 2);
  }
  markReply(kind, target) {
    const chat = this.data.chatTargets[`${kind}:${target}`];
    if (chat?.lastIncoming && this.now() - chat.lastIncoming <= 5 * 60000) chat.lastReplyAt = this.now();
  }
  enter(reason, at, energy = this.feelings.data.mood.energy) {
    if (energy <= 0) reason = 'exhausted';
    const chats = this.activeChats(at);
    // The farewell transport is admitted synchronously before the sleep state becomes active.
    this.transitioning = true;
    try { this.onBeforeSleep?.({ reason, at, energy, chats }); }
    catch (error) { this.store.audit?.('sleep-farewell-error', { message: error.message }); }
    finally { this.transitioning = false; }
    this.data.mode = 'sleep'; this.data.startedAt = at; this.data.reason = reason;
    this.data.sleepChats = chats;
    this.data.minWakeAt = reason === 'exhausted' ? this.midnight(this.day(at)) + 8 * HOUR : 0;
    if (reason === 'exhausted' && this.data.minWakeAt <= at) this.data.minWakeAt += DAY;
    this.data.wakeDelayMinutes = reason === 'exhausted' ? this.chooseWakeDelay() : 0;
    this.data.minWakeAt += this.data.wakeDelayMinutes * 60000;
    this.data.exhaustedWakeWindowVersion = 1;
    this.data.startEnergy = energy; this.data.dreamChecked = false; this.data.dream = null;
    // Decide locally before resting; never query a model while asleep.
    this.data.wakeEnergy = this.data.nextWakeEnergy ?? [80, 90, 100][Math.min(2, Math.floor(this.random() * 3))];
    delete this.data.nextWakeEnergy;
    this.data.needsCompaction = true;
  }
  dreamUntil(at) {
    if (this.data.dreamChecked || at - this.data.startedAt < HOUR / 2) return;
    this.data.dreamChecked = true;
    if (this.random() >= 0.4) return;
    // Local imagination only; never put another person's private messages into a global dream.
    const scenes = ['梦见自己坐在云朵上，追一颗会发光的星星', '梦见尾巴变成了小船，漂进一片蓝色的海', '梦见一只小猫把月亮当毛线球追着跑', '梦见自己飞过一座软乎乎的糖果岛'];
    this.data.dream = { text: scenes[Math.min(scenes.length - 1, Math.floor(this.random() * scenes.length))],
      at: new Date(at).toISOString(), imaginary: true };
  }
  wake(at, energy) {
    this.dreamUntil(at);
    this.data.mode = 'awake'; this.data.wokeAt = at;
    this.data.lastSleep = { id: `${this.data.startedAt}:${at}`, startedAt: this.data.startedAt, wokeAt: at,
      durationMinutes: Math.round((at - this.data.startedAt) / 60000), reason: this.data.reason,
      startEnergy: this.data.startEnergy, endEnergy: energy, dream: this.data.dream, chats: this.data.sleepChats || [] };
    this.data.dozeAtEnergy = this.chooseDozeEnergy();
    this.data.recentSleeps = [...(this.data.recentSleeps || []), this.data.lastSleep].slice(-14);
  }
  tick(at = this.now(), syncControls = true) {
    if (this.transitioning) return;
    const now = Math.max(this.data.lastTick, at);
    if (syncControls && this.store.file) {
      const control = readLifeControls(path.dirname(this.store.file)); const applied = this.data.lifeApplied ||= {};
      const changes = Object.entries(control.mood || {}).filter(([key, change]) => applied[key] !== change.revision).map(([key, change]) => ({ key, ...change }));
      if (control.rateRevision && applied.rates !== control.rateRevision) changes.push({ key: 'rates', value: control.rates, at: control.rateAt, revision: control.rateRevision });
      for (const change of changes.sort((a, b) => a.at - b.at)) {
        this.tick(Math.min(now, Math.max(this.data.lastTick, change.at)), false);
        if (change.key === 'rates') this.data.rates = { ...defaultRates, ...change.value };
        else this.feelings.data.mood[change.key] = clamp(change.value);
        applied[change.key] = change.revision;
      }
    }
    let cursor = this.data.lastTick;
    let energy = clamp(this.feelings.data.mood.energy);
    this.feelings.settle();
    const firstDay = this.day(cursor);
    if (this.data.nightDay !== firstDay && cursor >= this.bedtime(firstDay) && cursor - this.midnight(firstDay) < 8 * HOUR) {
      this.data.nightDay = firstDay; if (this.data.mode !== 'sleep') this.enter('midnight', cursor, energy);
    }
    if (this.data.nightDay !== firstDay + 1 && cursor >= this.bedtime(firstDay + 1)) {
      this.data.nightDay = firstDay + 1; if (this.data.mode !== 'sleep') this.enter('midnight', cursor, energy);
    }
    if (this.data.mode === 'awake' && energy <= this.data.dozeAtEnergy) this.enter(energy <= 0 ? 'exhausted' : 'drowsy', cursor, energy);
    while (cursor < now || (this.data.mode === 'sleep' && energy >= this.data.wakeEnergy && cursor >= (this.data.minWakeAt || 0))) {
      if (this.data.mode === 'sleep' && energy >= this.data.wakeEnergy && cursor >= (this.data.minWakeAt || 0)) {
        this.wake(cursor, energy);
        if (cursor === now) break;
      }
      const nextMidnight = this.midnight(this.day(cursor) + 1);
      let night = this.day(cursor);
      while (this.data.nightDay === night || this.bedtime(night) <= cursor) night++;
      const nextBedtime = this.bedtime(night);
      const boundary = Math.min(now, nextMidnight, nextBedtime);
      if (this.data.mode === 'sleep') {
        const wakeAt = Math.max(cursor + Math.max(0, this.data.wakeEnergy - energy) / this.data.rates.recoveryPerHour * HOUR, this.data.minWakeAt || 0);
        const end = Math.min(boundary, wakeAt);
        energy = clamp(energy + (end - cursor) / HOUR * this.data.rates.recoveryPerHour); cursor = end;
        this.dreamUntil(cursor);
        if (cursor === wakeAt) energy = Math.max(energy, this.data.wakeEnergy);
      } else {
        const rate = this.drainRate(cursor);
        const restAt = cursor + Math.max(0, energy - this.data.dozeAtEnergy) / rate * HOUR;
        const expiry = this.data.chatEvents.reduce((next, event) => event.at + HOUR > cursor ? Math.min(next, event.at + HOUR) : next, Infinity);
        const end = Math.min(boundary, restAt, expiry);
        energy = clamp(energy - (end - cursor) / HOUR * rate); cursor = end;
        if (cursor === restAt) { energy = this.data.dozeAtEnergy; this.enter(energy <= 0 ? 'exhausted' : 'drowsy', cursor, energy); }
      }
      if (cursor === nextBedtime) {
        this.data.nightDay = night;
        if (this.data.mode !== 'sleep') this.enter('midnight', cursor, energy);
      }
    }
    this.feelings.data.mood.energy = energy;
    this.data.drainPerHour = this.drainRate(now);
    this.data.chatEvents = this.data.chatEvents.filter(event => event.at + HOUR > now);
    this.data.lastTick = now;
    for (const day of Object.keys(this.data.nightPlans)) if (Number(day) < this.day(now) - 14) delete this.data.nightPlans[day];
    this.store.save();
  }
  sleeping() { this.tick(); return this.data.mode === 'sleep'; }
  assertAwake() { if (this.sleeping()) throw new Error('大肥鱼正在睡觉，本次回复和查询已暂停'); }
  assertTemporalReply(text, proactive = false) {
    const rest = this.data.lastSleep; if (!rest) return;
    const age = this.now() - rest.wokeAt;
    if (age > 15 * 60000 && /(?:我|鱼鱼|大肥鱼).{0,4}刚.{0,3}(?:醒|起床)|^\s*刚.{0,3}(?:醒|起床)/.test(text)) throw new Error('醒来已超过15分钟，已阻止过时的刚起床说法');
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23' }).format(this.now()));
    if (proactive && /早安|早上好|早呀|早啊/.test(text) && (age > 30 * 60000 || hour < 5 || hour >= 11)) throw new Error('已过起床问候窗口，未发送主动早安');
  }
  setWakeEnergy(energy) {
    this.assertAwake();
    if (!Number.isInteger(energy) || energy < 80 || energy > 100) throw new Error('醒来精力须为80至100的整数');
    this.data.nextWakeEnergy = energy; this.store.save();
    return { wakeEnergy: energy, bedtime: '北京时间23:50至次日00:10内，每晚固定随机入睡时间' };
  }
  responseMode() {
    if (this.sleeping()) return 'sleep';
    const winding = this.windDown();
    if (winding.active && this.random() < winding.progress * 0.65) return 'silent';
    const energy = this.feelings.data.mood.energy;
    if (energy >= 25) return 'normal';
    const severity = (25 - energy) / 25;
    const chance = Math.min(0.9, 0.1 + severity * 0.8);
    const value = this.random();
    return value < chance * 0.55 ? 'silent' : value < chance ? 'fog' : 'normal';
  }
  prompt() {
    const asleep = this.sleeping();
    const rest = this.data.lastSleep;
    const { chats, ...visibleRest } = rest || {};
    const memory = rest ? `\n最近一次睡眠记录（历史事件，不代表刚醒）（时间为UTC，精确到秒，不是用户消息）：${markdownData(visibleRest)}。当前已醒${Math.max(0, Math.floor((this.now() - rest.wokeAt) / 60000))}分钟。只有醒后15分钟内可以自称刚醒，超过15分钟不要说刚起床/刚睡醒；超过30分钟不要主动补发起床问候。早上好仅限北京时间05:00–10:59并结合当前会话自然回应，不对每个人重复。若有梦，只当梦境和想象，不当现实见闻或别人说过的话；不必主动告诉每个人。` : '';
    const locked = asleep && this.data.minWakeAt > this.now() ? `本次耗尽锁定睡眠，最早北京时间${new Date(this.data.minWakeAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}才能醒，即使精力100%也继续睡。` : '';
    return `北京时间精力作息：${asleep ? '睡眠中' : '清醒'}；energy=${this.feelings.data.mood.energy.toFixed(1)}%，当前清醒消耗每小时${this.drainRate().toFixed(2)}%。每晚北京时间23:50–次日00:10随机入睡，临睡前10分钟逐渐减少回复；精力≤10%有95%概率入睡，0%立即睡并锁到下一个北京时间08:00–08:30随机时刻。${locked}睡眠每小时恢复${this.data.rates.recoveryPerHour}%；普通睡眠80%起可醒、100%必须醒。清醒时可用self_set_wake_energy选择下次普通醒来精力80至100，不能提前解除耗尽锁定。睡觉时不能回复或查询。${this.windDown().active ? `当前进入睡前收尾，约${this.windDown().remainingMinutes}分钟后睡觉。话少一点，先收尾当前话题，不开新话题、不主动社交、不安排群发晚安；程序负责一次短告别，不重复说晚安或我睡了。` : ''}${memory}`;
  }
}
