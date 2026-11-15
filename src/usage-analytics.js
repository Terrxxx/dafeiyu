import fs from "node:fs";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { atomicWriteFile } from "./atomic-file.js";
const beijingDay = (at) =>
  new Date(at + 8 * 3600000).toISOString().slice(0, 10);
const context = new AsyncLocalStorage();
export const usageCategory = () => context.getStore() || "other";
export function usageProvider({ provider, baseUrl }) {
  if (provider !== "custom") return "deepseek";
  return URL.canParse(baseUrl) ? "custom:" + new URL(baseUrl).host : "custom";
}

export function expenseSamples(day) {
  return day.costSamples ?? (day.estimatedCny > 0 ? 1 : 0);
}

function expenseRanges(ledger, today, dayStart) {
  const days = Object.entries(ledger.days || {}).filter(([date]) => date <= today);
  return Object.fromEntries(Object.entries({ today: 1, threeDays: 3, sevenDays: 7, month: 30, all: null })
    .map(([key, length]) => {
      const from = length ? beijingDay(dayStart - (length - 1) * 86400000) : null;
      const archived = length === null ? ledger.analytics.archivedExpenses : null;
      let cny = archived?.cny || 0;
      let samples = archived?.samples || 0;
      for (const [date, day] of days) {
        if (from && date < from) continue;
        cny += Number(day.estimatedCny) || 0;
        samples += expenseSamples(day);
      }
      return [key, { cny: samples ? Number(cny.toFixed(12)) : null, from, to: today }];
    }));
}

function dailyUsage(ledger, dayStart) {
  const providers = new Map();
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = beijingDay(dayStart - (29 - index) * 86400000);
    const entry = ledger.days?.[date];
    const tokens = Number(entry?.tokens) || 0;
    const requests = Number(entry?.requests) || 0;
    const breakdown = { ...entry?.providers };
    const missingUsage = !!(entry?.missingUsage || entry?.missingCustomUsage);
    let unassignedTokens = tokens;
    let unassignedRequests = requests;
    for (const value of Object.values(breakdown)) {
      unassignedTokens -= value.tokens;
      unassignedRequests -= value.requests;
    }
    if (unassignedRequests > 0 || unassignedTokens > 0) {
      const unknown = breakdown.unknown;
      breakdown.unknown = {
        tokens: (unknown?.tokens || 0) + Math.max(0, unassignedTokens),
        requests: (unknown?.requests || 0) + Math.max(0, unassignedRequests),
        missingUsage: !!(unknown?.missingUsage || (entry?.providers ? entry.legacyMissingUsage : missingUsage)),
      };
    }
    for (const id of Object.keys(breakdown)) {
      if (providers.has(id)) continue;
      const name = id === "deepseek" ? "DeepSeek" :
        id === "unknown" ? "未标记供应商" :
        id === "custom" ? "自定义供应商" : id.slice("custom:".length);
      providers.set(id, { id, name, since: date });
    }
    return { date, tokens, requests, missingUsage, recorded: date >= ledger.analytics.since, providers: breakdown };
  });
  return { daily: days, providers: [...providers.values()] };
}
const empty = () => ({
  tokens: 0,
  input: 0,
  output: 0,
  cached: 0,
  uncached: 0,
  requests: 0,
  measuredRequests: 0,
});
const add = (a, b) => {
  for (const k of Object.keys(empty())) a[k] += Number(b?.[k]) || 0;
  return a;
};
export function initializeAnalytics(ledger, at) {
  if (ledger.analytics) return;
  const total = empty();
  for (const d of Object.values(ledger.days || {})) {
    total.tokens += d.tokens || 0;
    total.requests += d.requests || 0;
  }
  ledger.analytics = {
    since: Object.keys(ledger.days || {}).sort()[0] || beijingDay(at),
    detailSince: at,
    total,
    hours: {},
  };
}
export function recordAnalytics(ledger, usage, at, category = "other") {
  initializeAnalytics(ledger, at);
  const input = Number(usage?.prompt_tokens ?? usage?.input_tokens),
    output = Number(usage?.completion_tokens ?? usage?.output_tokens),
    valid =
      Number.isFinite(input) &&
      input >= 0 &&
      Number.isFinite(output) &&
      output >= 0;
  const cached = valid
    ? Math.min(
        input,
        Math.max(
          0,
          Number(
            usage?.prompt_cache_hit_tokens ??
              usage?.prompt_tokens_details?.cached_tokens ??
              0,
          ),
        ),
      )
    : 0;
  const value = {
    tokens: valid ? Number(usage.total_tokens ?? input + output) : 0,
    input: valid ? input : 0,
    output: valid ? output : 0,
    cached,
    uncached: valid ? input - cached : 0,
    requests: 1,
    measuredRequests: valid ? 1 : 0,
  };
  const a = ledger.analytics,
    key = String(Math.floor(at / 3600000) * 3600000);
  a.hours[key] ||= { ...empty(), categories: {}, activities: {} };
  const h = a.hours[key];
  add(a.total, value);
  add(h, value);
  h.categories[category] ||= empty();
  add(h.categories[category], value);
  for (const k of Object.keys(a.hours))
    if (Number(k) < at - 90 * 86400000) delete a.hours[k];
}
export async function measureActivity(directory, category, task) {
  const file = path.join(directory, "daily-usage.json");
  let ledger = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : { days: {}, pending: {} };
  const now = Date.now();
  initializeAnalytics(ledger, now);
  const key = String(Math.floor(now / 3600000) * 3600000);
  ledger.analytics.hours[key] ||= {
    ...empty(),
    categories: {},
    activities: {},
  };
  const h = ledger.analytics.hours[key];
  h.activities ||= {};
  h.activities[category] = (h.activities[category] || 0) + 1;
  atomicWriteFile(file, JSON.stringify(ledger));
  return context.run(category, task);
}
const categoryNames = {
  qq: "QQ聊天",
  social: "自主社交",
  browse: "B站浏览",
  inbox: "B站站内消息",
  shopping: "匿名逛店",
  qzone: "空间评论",
  decision: "情绪与接话判断",
  vision: "图片理解",
  compaction: "上下文压缩",
  other: "其他任务",
};
export function usageStatistics(directory, config = {}, at = Date.now()) {
  const file = path.join(directory, "daily-usage.json"),
    ledger = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : { days: {} };
  initializeAnalytics(ledger, at);
  const a = ledger.analytics,
    hourStart = Math.floor(at / 3600000) * 3600000,
    dayStart = Date.parse(beijingDay(at) + "T00:00:00+08:00");
  const weekday = new Date(at + 8 * 3600000).getUTCDay();
  const weekStart = dayStart - ((weekday + 6) % 7) * 86400000;
  const periods = { hour: empty(), day: empty(), week: empty() };
  const categories = {},
    activities = {};
  const sampleStart = Math.max(a.detailSince, at - 7 * 86400000);
  for (const [key, h] of Object.entries(a.hours)) {
    const time = Number(key);
    for (const [n, start] of Object.entries({
      hour: hourStart,
      day: dayStart,
      week: weekStart,
    }))
      if (time >= start && time <= at) add(periods[n], h);
    if (time < Math.floor(sampleStart / 3600000) * 3600000 || time > at)
      continue;
    for (const [c, v] of Object.entries(h.categories || {})) {
      categories[c] ||= empty();
      add(categories[c], v);
    }
    for (const [c, n] of Object.entries(h.activities || {}))
      activities[c] = (activities[c] || 0) + n;
  }
  // Daily ledgers preserve pre-upgrade usage; detailed cache fields only cover known samples.
  periods.day.tokens = ledger.days?.[beijingDay(at)]?.tokens || 0;
  periods.day.requests = ledger.days?.[beijingDay(at)]?.requests || 0;
  periods.week.tokens = 0;
  periods.week.requests = 0;
  for (const [day, d] of Object.entries(ledger.days || {})) {
    const start = Date.parse(day + "T00:00:00+08:00");
    if (start >= weekStart && start <= at) {
      periods.week.tokens += d.tokens || 0;
      periods.week.requests += d.requests || 0;
    }
  }
  const elapsedHours = (at - sampleStart) / 3600000,
    ready = elapsedHours >= 1;
  const averages = Object.fromEntries(
    Object.entries(categories).map(([c, v]) => [
      c,
      activities[c] >= 3 ? v.tokens / activities[c] : null,
    ]),
  );
  const active = (id) => id === 'shopping'
    ? config.components?.shopping?.installed === true && config.components.shopping.enabled === true
    : !config.components?.[id] || config.components[id].enabled !== false;
  const rates = {
    social: config.social?.enabled
      ? 60 / (config.social.intervalMinutes || 10)
      : 0,
    browse:
      config.bilibili?.enabled && active("bilibili")
        ? 60 / (config.bilibili.browseMinutes || 30)
        : 0,
    shopping: active("shopping")
      ? 60 / Math.max(30, (config.social?.intervalMinutes || 10) * 3)
      : 0,
    qzone:
      config.social?.qzoneEnabled &&
      config.social?.qzoneAutoReply &&
      active("qzone")
        ? 60 / (config.social.qzonePollMinutes || 5)
        : 0,
    inbox:
      config.bilibili?.enabled && active("bilibili")
        ? 60 / Math.max(5, (config.bilibili.pollSeconds || 60) / 60)
        : 0,
  };
  const contributions = {};
  for (const [c, v] of Object.entries(categories)) {
    if (Object.hasOwn(rates, c))
      contributions[c] = averages[c] === null ? null : averages[c] * rates[c];
    else contributions[c] = ready ? v.tokens / elapsedHours : null;
  }
  const known = Object.values(contributions).filter(Number.isFinite);
  const forecast =
    ready && known.length ? Math.round(known.reduce((a, b) => a + b, 0)) : null;
  const settings = {};
  for (const [key, category] of Object.entries({
    "social.enabled": "social",
    "social.intervalMinutes": "social",
    "bilibili.enabled": "browse",
    "bilibili.browseMinutes": "browse",
    "social.qzoneAutoReply": "qzone",
    "social.qzonePollMinutes": "qzone",
  }))
    settings[key] = {
      category,
      average: averages[category] ?? null,
      current: contributions[category] ?? null,
      rate: rates[category] || 0,
    };
  return {
    today: beijingDay(at),
    ...dailyUsage(ledger, dayStart),
    expenses: expenseRanges(ledger, beijingDay(at), dayStart),
    total: a.total,
    ...periods,
    since: a.since,
    detailSince: a.detailSince,
    cacheHitRate: a.total.input ? a.total.cached / a.total.input : null,
    categories: Object.entries(categories)
      .map(([id, value]) => ({
        id,
        name: categoryNames[id] || "其他任务",
        ...value,
        activities: activities[id] || 0,
      }))
      .sort((a, b) => b.tokens - a.tokens),
    forecast: {
      tokensPerHour: forecast,
      partial: Object.entries(rates).some(
        ([c, r]) => r > 0 && averages[c] == null,
      ),
      elapsedHours: Number(elapsedHours.toFixed(2)),
      settings,
      averages,
      rates,
      note: "根据最近7天真实用量、触发次数和当前间隔推算清醒运行时的小时消耗；流量、工具轮次、图片及缓存命中会影响结果，样本不足时不猜数值。",
    },
  };
}
