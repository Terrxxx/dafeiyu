import UsagePie from "./UsagePie.jsx";
import UsageChart from "./UsageChart.jsx";
// Hierarchy: consumption totals first, measured causes second, estimates last. Existing cards, metric grid and muted text use the shared theme tokens.
import React from "react";
import { Card, Metric } from "./shared.jsx";
const num = (n) => Math.round(n || 0).toLocaleString();
export function UsageCard({ value: v }) {
  if (!v) return null;
  return (
    <Card
      title="Token 消耗分析"
      subtitle={
        "累计统计始于 " +
        v.since +
        "；小时为当前整点起，日与周按北京时间，周一开始。"
      }
    >
      <div className="metric-grid usage-metrics">
        {[
          ["累计", v.total],
          ["本小时", v.hour],
          ["今日", v.day],
          ["本周", v.week],
        ].map(([name, x]) => (
          <Metric key={name} label={name} value={num(x.tokens)} hint="tokens" />
        ))}
      </div>
      <UsageChart usage={v} />
      <div className="usage-overview">
        <span>
          已统计输入缓存命中率{" "}
          <strong>
            {v.cacheHitRate == null
              ? "暂无样本"
              : (v.cacheHitRate * 100).toFixed(1) + "%"}
          </strong>
        </span>
        <span>
          已统计未命中输入 <strong>{num(v.total.uncached)}</strong>
        </span>
        <span>
          当前设置预计{" "}
          <strong>
            {v.forecast.tokensPerHour == null
              ? "样本不足"
              : num(v.forecast.tokensPerHour) + " tokens / 小时"}
          </strong>
          {v.forecast.partial && v.forecast.tokensPerHour != null
            ? "（部分项目尚无样本）"
            : ""}
        </span>
      </div>
      <p className="muted">
        {v.forecast.note} 详细分类与缓存统计从本次更新开始，不反推旧记录。
      </p>
    </Card>
  );
}
export function UsageCategoryCard({ value }) {
  return (
    <Card
      title="Token 用途占比"
      subtitle="最近7天内已记录的分类用量，不包含更早或未分类的历史用量。"
    >
      <UsagePie categories={value?.categories || []} />
    </Card>
  );
}
export function SettingCostHint({ usage, config, setting }) {
  const f = usage?.forecast;
  if (!f) return null;
  const map = {
    "social.enabled": ["social", "social.intervalMinutes"],
    "social.intervalMinutes": ["social", "social.intervalMinutes"],
    "bilibili.enabled": ["browse", "bilibili.browseMinutes"],
    "bilibili.browseMinutes": ["browse", "bilibili.browseMinutes"],
    "social.qzoneAutoReply": ["qzone", "social.qzonePollMinutes"],
    "social.qzonePollMinutes": ["qzone", "social.qzonePollMinutes"],
  };
  const item = map[setting];
  if (!item) return null;
  const get = (k) => k.split(".").reduce((v, p) => v?.[p], config);
  const [c, interval] = item,
    avg = f.averages[c],
    rate = 60 / Number(get(interval) || 10);
  if (!Number.isFinite(avg))
    return (
      <small className="cost-hint">
        Token 影响：需至少3轮实际活动样本后估算
      </small>
    );
  const count = Math.round(avg * rate);
  return (
    <small className="cost-hint">
      {setting.endsWith("Minutes")
        ? "按当前间隔预计 " + num(count) + " tokens / 小时"
        : get(setting)
          ? "关闭预计减少约 " + num(count) + " tokens / 小时"
          : "开启预计增加约 " + num(count) + " tokens / 小时"}
      {setting === "bilibili.enabled" ? "（仅浏览部分，另有站内消息）" : ""}
    </small>
  );
}
