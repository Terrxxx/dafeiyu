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
    this.data.dozeAtEnergy ??= this.chooseDozeEnergy();
  }
  chooseDozeEnergy() { return this.random() < 0.85 ? 3 + Math.min(0.999, this.random()) * 1.999 : 0; }
  drainRate(at = this.now()) {
    const count = this.data.chatEvents.filter(event => event.at <= at && event.at + HOUR > at).length;
    return 5 + Math.min(3, count * 0.15);
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
  enter(reason, at, energy = this.feelings.data.mood.energy) {
    if (energy <= 0) reason = 'exhausted';
    const chats = Object.values(this.data.chatTargets).filter(chat =>
      chat.lastIncoming && chat.lastOutgoing && at - chat.lastIncoming <= 5 * 60000 && at - chat.lastOutgoing <= 5 * 60000);
    // The farewell transport is admitted synchronously before the sleep state becomes active.
    this.transitioning = true;
    try { this.onBeforeSleep?.({ reason, at, energy, chats }); }
    catch (error) { this.store.audit?.('sleep-farewell-error', { message: error.message }); }
    finally { this.transitioning = false; }
    this.data.mode = 'sleep'; this.data.startedAt = at; this.data.reason = reason;
    this.data.sleepChats = chats;
    this.data.minWakeAt = reason === 'exhausted' ? this.midnight(this.day(at)) + 8 * HOUR : 0;
    if (reason === 'exhausted' && this.data.minWakeAt <= at) this.data.minWakeAt += DAY;
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
  tick() {
    if (this.transitioning) return;
    const now = Math.max(this.data.lastTick, this.now());
    let cursor = this.data.lastTick;
    let energy = clamp(this.feelings.data.mood.energy);
    this.feelings.settle();
    const firstDay = this.day(cursor);
    if (this.data.nightDay !== firstDay && cursor - this.midnight(firstDay) < 8 * HOUR) {
      this.data.nightDay = firstDay; this.enter('midnight', cursor, energy);
    }
    if (this.data.mode === 'awake' && energy <= this.data.dozeAtEnergy) this.enter(energy <= 0 ? 'exhausted' : 'drowsy', cursor, energy);
    while (cursor < now || (this.data.mode === 'sleep' && energy >= this.data.wakeEnergy && cursor >= (this.data.minWakeAt || 0))) {
      if (this.data.mode === 'sleep' && energy >= this.data.wakeEnergy && cursor >= (this.data.minWakeAt || 0)) {
        this.wake(cursor, energy);
        if (cursor === now) break;
      }
      const nextMidnight = this.midnight(this.day(cursor) + 1);
      const boundary = Math.min(now, nextMidnight);
      if (this.data.mode === 'sleep') {
        const wakeAt = Math.max(cursor + Math.max(0, this.data.wakeEnergy - energy) / 10 * HOUR, this.data.minWakeAt || 0);
        const end = Math.min(boundary, wakeAt);
        energy = clamp(energy + (end - cursor) / HOUR * 10); cursor = end;
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
      if (cursor === nextMidnight) {
        this.data.nightDay = this.day(cursor);
        if (this.data.mode !== 'sleep') this.enter('midnight', cursor, energy);
      }
    }
    this.feelings.data.mood.energy = energy;
    this.data.drainPerHour = this.drainRate(now);
    this.data.chatEvents = this.data.chatEvents.filter(event => event.at + HOUR > now);
    this.data.lastTick = now;
    this.store.save();
  }
  sleeping() { this.tick(); return this.data.mode === 'sleep'; }
  assertAwake() { if (this.sleeping()) throw new Error('大肥鱼正在睡觉，本次回复和查询已暂停'); }
  setWakeEnergy(energy) {
    this.assertAwake();
    if (!Number.isInteger(energy) || energy < 80 || energy > 100) throw new Error('醒来精力须为80至100的整数');
    this.data.nextWakeEnergy = energy; this.store.save();
    return { wakeEnergy: energy, bedtime: '北京时间00:00，不允许熬夜' };
  }
  responseMode() {
    if (this.sleeping()) return 'sleep';
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
    const memory = rest ? `\n你确实刚经历过的最近一次睡眠（时间为UTC毫秒，不是用户消息）：${JSON.stringify(visibleRest)}。知道自己此前在睡觉，结合醒来时间判断是“刚醒”还是“之前睡过”，不每轮打招呼。若有梦，只当梦境和想象，不当现实见闻或别人说过的话；不必主动告诉每个人。` : '';
    const locked = asleep && this.data.minWakeAt > this.now() ? `本次耗尽锁定睡眠，最早北京时间${new Date(this.data.minWakeAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}才能醒，即使精力100%也继续睡。` : '';
    return `北京时间精力作息：${asleep ? '睡眠中' : '清醒'}；energy=${this.feelings.data.mood.energy.toFixed(1)}%，当前清醒消耗每小时${this.drainRate().toFixed(2)}%。零点强制睡，不允许熬夜；低于5%大幅提高入睡概率，0%立即睡并锁到下一个北京时间8点。${locked}睡眠每小时恢复10%；普通睡眠80%起可醒、100%必须醒。清醒时可用self_set_wake_energy选择下次普通醒来精力80至100，不能提前解除耗尽锁定。睡觉时不能回复或查询。${memory}`;
  }
}
