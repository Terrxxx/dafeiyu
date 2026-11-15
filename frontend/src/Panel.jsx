import { inspectionTarget } from "./shared.jsx";
import {
  activityCatalog,
  activityFilters,
  matchesActivity,
  activityDetail,
} from "../../src/activity-catalog.js";
import { UsageCard, UsageCategoryCard, SettingCostHint } from "./Usage.jsx";
import MessageStatus from './MessageStatus.jsx';
import behaviorPresets from "./behavior-presets.json";
import { createPortal } from "react-dom";
import personaPresets from "./persona-presets.json";
import React, { useState, useEffect, useCallback } from "react";
import {
  Fish,
  LayoutDashboard,
  Plug,
  Users,
  Heart,
  SlidersHorizontal,
  NotebookPen,
  Blocks,
  ScrollText,
  Footprints,
  Shield,
  LogOut,
  ArrowUpRight,
  RefreshCw,
  Sun,
  Moon,
  Menu,
  Search,
  Check,
  Activity,
} from "lucide-react";
import {
  api,
  useData,
  time,
  fmt,
  Field,
  Card,
  Empty,
  ErrorBox,
  DailyLimitsNotice,
  Form,
  Ring,
  Metric,
  Risk,
  Theme,
  setCSRF,
  markClean,
} from "./shared.jsx";
import groups from "./settings.json";
const settingComponent = (key) => {
  if (key === "social.voiceName" || key === "qq.voiceEnabled") return "voice";
  if (
    key.startsWith("qq.qzone") ||
    [
      "social.qzoneVisibility",
      "social.qzonePollMinutes",
      "social.maxQzonePostsPerHour",
      "social.qzoneEnabled",
      "social.qzoneAutoReply",
    ].includes(key)
  ) return "qzone";
  if (key.startsWith("bilibili.") || key === "agent.maxBiliCommentsPerHour") return "bilibili";
  return null;
};
const moods = {
  energy: "精力",
  joy: "开心",
  sadness: "难过",
  irritation: "烦躁",
  curiosity: "好奇",
  calm: "平静",
  excitement: "兴奋",
  worry: "担心",
  tenderness: "温柔",
  confidence: "自信",
  boredom: "无聊",
  anticipation: "期待",
  loneliness: "孤单",
  shyness: "害羞",
  frustration: "挫败",
  security: "安心",
  inspiration: "灵感",
};
const labels = {
  affinity: "好感度",
  trust: "信任度",
  familiarity: "熟悉度",
  baseDrainPerHour: "基础消耗 / 小时",
  maxDrainPerHour: "最高消耗 / 小时",
  recoveryPerHour: "睡眠恢复 / 小时",
  affection: "亲近",
  concern: "关心",
  gratitude: "感激",
  ease: "自在",
  tension: "戒备",
  playfulness: "玩闹意愿",
  admiration: "欣赏",
};
function Panel({ page, notify }) {
  if (page === "overview") return <Overview />;
  if (page === "life") return <Life notify={notify} />;
  if (page === "memories") return <Memories notify={notify} />;
  if (page === "persona") return <Persona notify={notify} />;
  if (page === "settings") return <Settings notify={notify} />;
  if (page === "components") return <Components notify={notify} />;
  return <Records page={page} notify={notify} />;
}
const overviewHeadlines = [
  "今天，也在慢慢成长。",
  "今天想收集一点好消息。",
  "先看看今天会遇见谁。",
  "慢慢来，也会有新发现。",
  "今天也想认真生活。",
  "说不定会碰到有趣的事。",
  "今天也要好好照顾自己。",
];
function Overview() {
  const [s, , err] = useData("/api/status", 10000);
  const [liveSleep,setLiveSleep]=useState(null);
  const [expenseRange, setExpenseRange] = useState("today");
  const sleeping=liveSleep??s?.sleep?.mode==='sleep';
  const napping = sleeping && s?.sleep?.reason === 'nap';
  const [headline] = useState(
    () =>
      overviewHeadlines[Math.floor(Math.random() * overviewHeadlines.length)],
  );
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!s) return <Empty>正在读取她的生活…</Empty>;
  const expense = s.usage?.expenses?.[expenseRange];
  const napMinutes = napping ? Math.max(0, Math.ceil((s.sleep.napUntil - Date.now()) / 60000)) : 0;
  const energyStatus = napping ? `小睡 · 约 ${napMinutes} 分钟后醒` :
    sleeping ? "睡觉" : liveSleep !== null || s.sleep?.mode === "awake" ? "清醒" : "未同步";
  return (
    <>
      <div className="life-banner">
        <div>
          <span className="eyebrow">HER DAY, AT A GLANCE</span>
          <h2>{napping ? "她正在小睡。" : sleeping ? "她正在好好休息。" : headline}</h2>
          <p>
            {s.unread || 0} 条待查看消息 · {s.users || 0} 位记忆中的朋友
          </p>
        </div>
        <Fish size={78} strokeWidth={1} />
      </div>
      <div className="overview-status-grid">
      <div className="metric-grid energy-overview">
        <Metric
          label="精力"
          value={Number(s.life?.mood?.energy ?? 0).toFixed(2) + "%"}
          hint={`当前状态：${energyStatus}`}
        />
      </div>
      <MessageStatus onSleep={setLiveSleep}/>
      </div>
      <div className="usage-dashboard-grid">
        <div className="usage-dashboard-primary">
          <UsageCard value={s.usage} />
        </div>
        <div className="usage-dashboard-side">
          {s.daily && (
            <Card
              title="今日模型用量"
              subtitle="请求次数与 Tokens 按今日统计，费用按所选范围估算。"
            >
              <div className="usage-today-stats">
                <div>
                  <span>Tokens</span>
                  <strong>{s.daily.tokens.toLocaleString()}</strong>
                </div>
                <div>
                  <span>请求次数</span>
                  <strong>
                    {Number(s.daily.requests || 0).toLocaleString()}{" "}
                    <small>次</small>
                  </strong>
                </div>
                <div className="usage-expense">
                  <label className="daily-range">
                    <span>费用估算</span>
                    <select aria-label="费用估算时间范围" value={expenseRange}
                      onChange={(event) => setExpenseRange(event.target.value)}>
                      <option value="today">今天</option>
                      <option value="threeDays">最近 3 天</option>
                      <option value="sevenDays">最近 7 天</option>
                      <option value="month">最近 30 天</option>
                      <option value="all">全部</option>
                    </select>
                  </label>
                  <strong>
                    {Number.isFinite(expense?.cny)
                      ? "¥ " + expense.cny.toFixed(6)
                      : "暂无估算"}
                  </strong>
                </div>
              </div>
              <small className="muted usage-expense-note">
                {expenseRange === "all" ? "全部为已保留的估算记录。" :
                  expenseRange !== "today" && expense?.from ? expense.from + " 起。" : ""}
                {"仅统计有可用单价和用量的请求。"}
              </small>
              <p className="muted usage-today-date">{s.daily.day} · 北京时间</p>
              {s.daily.paused && (
                <ErrorBox>
                  {s.daily.reasons.join("；")} ·
                  次日00:00自动恢复，精力仍正常变化
                </ErrorBox>
              )}
            </Card>
          )}
          <UsageCategoryCard value={s.usage} />
        </div>
      </div>
      <div className="overview-daily-grid">
      {s.storage && (
        <Card title="图片存储" className="overview-storage">
          <div className="usage-overview">
            <strong>
              {(s.storage.bytes / 1024 ** 2).toFixed(2)} MB / 1 GB
            </strong>
            <span>{s.storage.count} 张图片</span>
          </div>
          <progress
            max={s.storage.maxBytes}
            value={s.storage.bytes}
            aria-label="图片空间使用量"
          />
          <p>
            {s.storage.full
              ? "已达到上限，暂停读取图片，请先清理。"
              : "图片库最多1GB；只保存需要的素材。"}
          </p>
          <a href="#settings?section=storage">前往设置清理图片 ↗</a>
        </Card>
      )}
      <Card title="她的小日程" subtitle="来自自主生活中的任务，计划时间为北京时间。" className="overview-tasks">
        <div className="overview-task-list">
        {s.tasks?.length ? (
          s.tasks.map((t, i) => (
            <div className="record" key={i}>
              <span className="record-dot" />
              <div>
                <strong title={t.prompt || undefined}>
                  {(t.prompt ? t.prompt.slice(0, 100) + (t.prompt.length > 100 ? "…" : "") : "") || t.text ||
                    t.title ||
                    t.description ||
                    t.instruction ||
                    "自主任务"}
                </strong>
                <small>{({ pending: "等待执行", running: "执行中", done: "已结束", failed: "执行失败", cancelled: "已取消", uncertain: "结果待确认" })[t.state || t.status] || t.state || t.status || "等待执行"}</small>
                {t.due && <small>计划时间：<time dateTime={new Date(t.due).toISOString()}>{new Date(t.due).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })}</time></small>}
              </div>
            </div>
          ))
        ) : (
          <Empty>暂时没有新的日程</Empty>
        )}
        </div>
      </Card>

      <Card title="本地天气" className="overview-weather">
        <p>
          {(s.weather?.city || "天气感知") +
            (s.weather?.district ? " · " + s.weather.district : "")}{" "}
          · {s.weather?.temperature ?? s.weather?.data?.temperature ?? "—"} °C
        </p>
        <p className="muted">天气会影响她的情绪和活动选择，睡眠期间不查询。</p>
      </Card>
      </div>
    </>
  );
}
function Life({ notify }) {
  const [s, load, err] = useData("/api/status"),
    [v, set] = useState(null);
  useEffect(() => {
    if (s) set(structuredClone(s.life));
  }, [s]);
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!v) return <Empty>正在载入生活状态…</Empty>;
  const slider = (section, key, label, min, max, step = 0.01) => (
    <label className="range-field" key={key}>
      <span>
        {label}
        <output>
          {Number(v[section][key]).toFixed(2)}
        </output>
      </span>
      <input
        aria-label={label}
        type="range"
        min={min}
        max={max}
        step={step}
        value={v[section][key]}
        onChange={(e) =>
          set({
            ...v,
            [section]: { ...v[section], [key]: Number(e.target.value) },
          })
        }
      />
      <small>
        {min} <span>{max}</span>
      </small>
    </label>
  );
  const canEdit = s.life.editable && !inspectionTarget();
  const cards = (
    <div className="life-three-column">
      <Card title="她的情绪" subtitle="日常的每一件小事，都可能改变她的心情。">
        <div className="emotion-grid">
          {Object.keys(v.mood)
            .filter((k) => k !== "energy")
            .map((k) => (
              <div className="emotion-control" key={k}>
                <Ring label={moods[k] || k} value={v.mood[k]} precision={2} />
                {canEdit && slider("mood", k, moods[k] || k, 0, 100)}
              </div>
            ))}
        </div>
      </Card>
      <Card title="精力">
        {canEdit ? slider("mood", "energy", "精力", 0, 100) : <Ring label="精力" value={v.mood.energy} precision={2} />}
        <p className="muted">{s.sleep?.mode === "sleep" ? s.sleep.reason === 'nap' ? "当前正在小睡，恢复精力。" : "当前正在睡觉，恢复精力。" : "当前清醒，精力随时间和聊天活动消耗。"}</p>
      </Card>
      <Card title="精力消耗与恢复">
        {canEdit ? (
          Object.keys(v.rates).map((k) =>
            slider("rates", k, labels[k], 0.1, 100, 0.1),
          )
        ) : (
          <div className="stack">
            {Object.entries(v.rates).map(([key, value]) => (
              <Metric
                key={key}
                label={labels[key] || key}
                value={Number(value).toFixed(2)}
              />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
  return (
    <>
      <p className="muted">
        {inspectionTarget()
          ? "当前为只读查看。"
          : canEdit
            ? "已允许编辑情绪与精力。"
            : "当前仅展示状态。如需调整，请在设置 → 情绪与精力中开启“允许编辑情绪与精力”。"}
      </p>
      {canEdit ? (
        <Form
          submit={async () => {
            const body = { revision: v.revision };
            for (const section of ["mood", "rates"]) {
              const changes = Object.fromEntries(
                Object.entries(v[section]).filter(
                  ([k, n]) => n !== s.life[section][k],
                ),
              );
              if (Object.keys(changes).length) body[section] = changes;
            }
            const result = await api("/api/life", body);
            notify(result.message);
            load();
          }}
        >
          {cards}
          <div className="save-bar">
            <button className="primary">保存生活状态</button>
            <span>后台下次检查时应用，只保存本次修改的值。</span>
          </div>
        </Form>
      ) : (
        <div className="stack">{cards}</div>
      )}
    </>
  );
}
function Persona({ notify }) {
  const [exampleTab, setExampleTab] = useState("persona");
  const examples = exampleTab === "persona" ? personaPresets : behaviorPresets;
  const [v, load, err, set] = useData("/api/persona"),
    [backups] = useData("/api/persona/backups"),
    [chosen, choose] = useState(""),
    [preset, select] = useState("");
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!v) return <Empty>正在载入提示词…</Empty>;
  const sample = examples.find((p) => p.name === preset);
  return (
    <div className="persona-layout">
      <div className="stack">
        <Card
          title="她会是什么样的大肥鱼"
          subtitle="保存会保留旧版备份，重启实例生效。"
        >
          <Form
            submit={async () => {
              const result = await api("/api/persona", v);
              set({ ...v, revision: result.revision });
              notify(result.message);
            }}
          >
            <label className="field">
              <span>角色提示词 · persona.md</span>
              <textarea
                className="editor"
                value={v.text}
                maxLength={30000}
                onChange={(e) => set({ ...v, text: e.target.value })}
              />
            </label>
            <div className="save-bar">
              <button className="primary">保存提示词</button>
              <span>{v.text.length} / 30000 字</span>
            </div>
          </Form>
        </Card>
        <Card title="历史版本">
          <div className="actions">
            <select
              aria-label="提示词备份版本"
              value={chosen}
              onChange={(e) => choose(e.target.value)}
            >
              <option value="">选择备份</option>
              {backups?.map((b) => (
                <option key={b.id} value={b.id}>
                  {time(b.time)}
                </option>
              ))}
            </select>
            <button
              disabled={!chosen || !!inspectionTarget()}
              onClick={async () => {
                try {
                  const b = await api("/api/persona/backups/" + chosen);
                  set({ ...v, text: b.text });
                  notify("已载入编辑器，保存后生效");
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              载入编辑器
            </button>
            <button onClick={load}>重新载入</button>
          </div>
        </Card>
      </div>
      <aside className="persona-preview">
        <Card
          title="提示词示例"
          subtitle="选择后只预览，不会覆盖你的提示词。"
        >
          <div className="tabs" role="tablist" aria-label="示例类型">
            {[
              ["persona", "性格示例"],
              ["behavior", "行为示例"],
            ].map(([id, name]) => (
              <button
                role="tab"
                aria-selected={exampleTab === id}
                key={id}
                onClick={() => {
                  setExampleTab(id);
                  select("");
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <label className="field">
            <span>
              {exampleTab === "persona" ? "选择性格" : "选择行为偏好"}
            </span>
            <select
              aria-label={
                exampleTab === "persona" ? "性格示例" : "行为示例"
              }
              value={preset}
              onChange={(e) => select(e.target.value)}
            >
              <option value="">选择一种性格</option>
              {examples.map((p) => (
                <option key={p.name}>{p.name}</option>
              ))}
            </select>
          </label>
          {sample ? (
            <>
              <h3>{sample.name}</h3>
              <div
                className="preset-text"
                aria-label={
                  exampleTab === "persona" ? "性格示例预览" : "行为示例预览"
                }
              >
                {sample.text}
              </div>
              <button
                disabled={!!inspectionTarget()}
                onClick={() => {
                  if (confirm("将此示例应用到编辑器？保存前不会生效。")) {
                    set({
                      ...v,
                      text:
                        exampleTab === "persona"
                          ? sample.text
                          : v.text.replace(/\n\n## 行为偏好\n[\s\S]*$/, "") +
                            "\n\n## 行为偏好\n" +
                            sample.text,
                    });
                    notify("已应用到编辑器，保存后生效");
                  }
                }}
              >
                {exampleTab === "persona" ? "应用到编辑器" : "追加行为示例"}
              </button>
            </>
          ) : (
            <Empty>选一个示例，在这里看看她的性格。</Empty>
          )}
        </Card>
      </aside>
    </div>
  );
}
const getPath = (o, k) => k.split(".").reduce((v, k) => v?.[k], o);
const putPath = (o, k, v) => {
  const a = k.split(".");
  let x = o;
  for (const k of a.slice(0, -1)) x = x[k] ||= {};
  x[a.at(-1)] = v;
};
function ContactPicker({ kind, config, onChange }) {
  const group = kind === "group";
  const [rows, refresh, err, setRows] = useData(
      group ? "/account/qq/groups" : "/api/memories",
    ),
    [query, setQuery] = useState(""),
    [pickerError, notifyPicker] = useState("");
  const allow = kind + "Allowlist",
    block = kind + "Blocklist";
  const candidates = new Map((rows || []).map((r) => [r.id, r]));
  for (const id of [...(config[allow] || []), ...(config[block] || [])])
    if (!candidates.has(id))
      candidates.set(id, { id, name: "已配置条目（不在当前列表）" });
  const selected = (key, id, value) => {
    const next = {
      ...config,
      [key]: value
        ? [...new Set([...(config[key] || []), id])]
        : (config[key] || []).filter((x) => x !== id),
    };
    if (value)
      next[key === allow ? block : allow] = (
        config[key === allow ? block : allow] || []
      ).filter((x) => x !== id);
    onChange(next);
  };
  return (
    <section className="contact-picker">
      <div className="toolbar">
        <div>
          <h3>{group ? "群聊黑白名单" : "私聊黑白名单"}</h3>
          <small>
            {group ? "来自当前登录QQ已加入的群；拉黑后整群消息直接拦截" : "来自用户记忆列表；拉黑后私聊和群内发言直接拦截"} ·
            白名单留空则不限，黑名单保存后立即生效
          </small>
        </div>
        <button
          type="button"
          onClick={async () => {
            try {
              if (group) setRows(await api("/account/qq/groups?refresh=1"));
              else await refresh();
            } catch (e) {
              notifyPicker(e.message);
            }
          }}
        >
          刷新列表
        </button>
      </div>
      <ErrorBox>{err || pickerError}</ErrorBox>
      <label className="field">
        <span>查找{group ? "群" : "用户"}</span>
        <input
          aria-label={group ? "查找群" : "查找用户"}
          value={query}
          onChange={(e) => {
            e.stopPropagation();
            setQuery(e.target.value);
          }}
          placeholder="名称或号码"
        />
      </label>
      <div className="contact-scroll">
        <table>
          <thead>
            <tr>
              <th>{group ? "群名称 / 群号" : "用户 / QQ号"}</th>
              <th>白名单</th>
              <th>黑名单</th>
            </tr>
          </thead>
          <tbody>
            {[...candidates.values()]
              .filter((r) =>
                (r.name + " " + (r.remark || "") + " " + r.id).includes(query),
              )
              .map((r) => (
                <tr key={r.id}>
                  <td>
                    <strong>{r.name || r.id}</strong>
                    <small>{r.id}</small>
                  </td>
                  {[allow, block].map((key, index) => (
                    <td key={key}>
                      <input
                        type="checkbox"
                        aria-label={
                          (index ? "黑名单 " : "白名单 ") + r.name + " " + r.id
                        }
                        checked={(config[key] || []).includes(r.id)}
                        onChange={(e) => selected(key, r.id, e.target.checked)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
          </tbody>
        </table>
        {rows && !candidates.size && (
          <Empty>{group ? "还没有可选的QQ群" : "还没有用户记忆"}</Empty>
        )}
      </div>
    </section>
  );
}
function WeatherPicker({ config, onChange }) {
  const [regionData, setRegions] = useState(null),
    [regionError, setRegionError] = useState("");
  useEffect(() => {
    import("./china-regions.json")
      .then((m) => setRegions(m.default))
      .catch(() => setRegionError("地区数据加载失败，请刷新页面重试"));
  }, []);
  if (regionError) return <ErrorBox>{regionError}</ErrorBox>;
  if (!regionData) return <Empty>正在载入省市区列表…</Empty>;
  const clean = (t) => String(t || "").replace(/省$|市$/, "");
  const provinces = regionData.provinces;
  const province = provinces.find(
    (p) => p.name === config.region || clean(p.name) === clean(config.region),
  );
  const taiwan = province?.code === "710000";
  const city = province?.cities.find(
    (c) => c.name === config.city || clean(c.name) === clean(config.city),
  );
  return (
    <div className="weather-picker">
      <p className="muted">
        国家：中国（CN） · 按所选地区中心点查询天气，不是街道实测。
      </p>
      <div className="form-grid">
        <label className="field">
          <span>省份</span>
          <select
            aria-label="天气省份"
            required={config.enabled}
            value={province?.code || ""}
            onChange={(e) => {
              const p = provinces.find((p) => p.code === e.target.value);
              onChange({
                ...config,
                region: p.name,
                city: p.code === "710000" ? p.name : "",
                district: "",
                districtCode: "",
                countryCode: "CN",
              });
            }}
          >
            <option value="" disabled>
              选择省份
            </option>
            {provinces.map((p) => (
              <option key={p.code} value={p.code} disabled={!p.cities.length && p.code !== "710000"}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>城市</span>
          <select
            aria-label="天气城市"
            required={config.enabled && !taiwan}
            value={city?.code || ""}
            disabled={!province || taiwan}
            onChange={(e) => {
              const c = province.cities.find((c) => c.code === e.target.value);
              onChange({
                ...config,
                city: c.name,
                district: "",
                districtCode: "",
                countryCode: "CN",
              });
            }}
          >
            <option value="" disabled>
              {taiwan ? "无需选择城市" : "选择城市"}
            </option>
            {province?.cities.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>区 / 县</span>
          <select
            aria-label="天气区县"
            required={config.enabled && !taiwan}
            value={config.districtCode || ""}
            disabled={!city || taiwan}
            onChange={(e) => {
              const d = city.districts.find((d) => d.code === e.target.value);
              onChange({
                ...config,
                district: d.name,
                districtCode: d.code,
                countryCode: "CN",
              });
            }}
          >
            <option value="" disabled>
              {taiwan ? "无需选择区县" : "选择区县"}
            </option>
            {city?.districts.map((d) => (
              <option key={d.code} value={d.code}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <small>
        行政区划来源：阿里云 DataV.GeoAtlas；台湾省按省级中心点查询天气。
      </small>
    </div>
  );
}
function StorageManager({ notify }) {
  const [data, load, err] = useData("/api/storage"),
    [selected, select] = useState([]),
    [busy, setBusy] = useState(false),
    [imageSort, setImageSort] = useState("default");
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!data) return <Empty>正在读取图片库…</Empty>;
  const clear = async (all) => {
    if (
      !confirm(
        all
          ? "清空全部缓存图片以释放空间？此操作无法撤销。"
          : "删除选中的图片？此操作无法撤销。",
      )
    )
      return;
    setBusy(true);
    try {
      const result = await api(
        "/api/storage/clear",
        all ? { all: true } : { ids: selected },
      );
      select([]);
      await load();
      notify(
        "已删除" +
          result.deleted +
          "张，释放" +
          (result.freedBytes / 1024 ** 2).toFixed(2) +
          " MB",
      );
    } catch (e) {
      notify(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="storage-manager">
      <div className="usage-overview">
        <strong>{(data.bytes / 1024 ** 2).toFixed(2)} MB / 1 GB</strong>
        <span>
          {data.count} / {data.maxCount} 张
        </span>
      </div>
      <progress
        max={data.maxBytes}
        value={data.bytes}
        aria-label="图片空间使用量"
      />
      <p>
        只展示文件名和她记录的图片摘要，不展示原图。满1GB后不能继续读取图片。
      </p>
      <div className="actions">
        <button
          type="button"
          disabled={busy || !!inspectionTarget() || !selected.length}
          onClick={() => clear(false)}
        >
          删除选中（{selected.length}）
        </button>
        <button
          type="button"
          className="danger"
          disabled={busy || !!inspectionTarget() || !data.count}
          onClick={() => clear(true)}
        >
          清空图片
        </button>
      </div>
      <label className="field storage-sort">
        <span>图片排序</span>
        <select
          aria-label="图片排序"
          value={imageSort}
          onChange={(e) => {
            e.stopPropagation();
            setImageSort(e.target.value);
          }}
        >
          <option value="default">默认顺序</option>
          <option value="sizeDesc">文件大小：大到小</option>
          <option value="sizeAsc">文件大小：小到大</option>
        </select>
      </label>
      <div className="storage-list">
        {data.items
          .slice()
          .sort((a, b) =>
            imageSort === "default"
              ? 0
              : (imageSort === "sizeDesc"
                  ? b.bytes - a.bytes
                  : a.bytes - b.bytes) || a.filename.localeCompare(b.filename),
          )
          .map((item) => (
            <label key={item.id} className="storage-item">
              <input
                type="checkbox"
                aria-label={"选择图片 " + item.filename}
                checked={selected.includes(item.id)}
                onChange={(e) => {
                  e.stopPropagation();
                  select(
                    e.target.checked
                      ? [...selected, item.id]
                      : selected.filter((x) => x !== item.id),
                  );
                }}
              />
              <div>
                <code>{item.filename}</code>
                <p>{item.description}</p>
                <small>{(item.bytes / 1024 ** 2).toFixed(2)} MB</small>
              </div>
            </label>
          ))}
      </div>
      {!data.count && <Empty>图片库已经空啦</Empty>}
    </div>
  );
}
function Settings({ notify }) {
  const [usage] = useData("/api/usage", 60000);
  const [components, , componentsError] = useData("/api/components");
  const [saving, setSaving] = useState(false);
  const [voices] = useData("/api/voices");
  const [v, load, err, set] = useData("/api/config"),
    [group, choose] = useState(() =>
      new URLSearchParams(location.hash.split("?")[1] || "").get("section") ===
      "storage"
        ? "存储"
        : groups[0][0],
    );
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!v || (!components && !componentsError)) return <Empty>正在载入配置与组件状态…</Empty>;
  return (
    <div className="settings-layout">
      <nav className="settings-nav" aria-label="设置分类">
        {groups.map(([n]) => (
          <button
            aria-label={n}
            key={n}
            className={n === group ? "selected" : ""}
            onClick={() => choose(n)}
          >
            {n}
            <span>›</span>
          </button>
        ))}
      </nav>
      <Card
        title={group}
        subtitle={
          inspectionTarget()
            ? "管理员只读查看，无法保存修改。"
            : "QQ黑名单和关闭所有对话保存后立即生效；其他设置需重启大肥鱼。未修改的字段会保留。"
        }
      >
        {componentsError && <ErrorBox>组件状态读取失败：{componentsError}</ErrorBox>}
        {group === "存储" && <StorageManager notify={notify} />}
        <Form
          id="settings-form"
          onBusy={setSaving}
          submit={async () => {
            const r = await api("/api/config", v);
            set({ ...v, revision: r.revision });
            notify(r.message);
          }}
        >
          {group === "发布与额度" && (v.limitsSuspended ? <DailyLimitsNotice /> : (
            <div className="notice">
              日额度按接口返回usage统计，达到任一上限后暂停所有活动，次日北京时间00:00恢复。精力继续按正常节奏变化。单次请求可能超过剩余额度；费用按2026-10-28核实的官方单价估算，不是平台最终账单。
            </div>
          ))}

          {group === "QQ" && (
            <div className="contact-pickers">
              <ContactPicker
                kind="private"
                config={v.config.qq}
                onChange={(qq) => set({ ...v, config: { ...v.config, qq } })}
              />
              <ContactPicker
                kind="group"
                config={v.config.qq}
                onChange={(qq) => set({ ...v, config: { ...v.config, qq } })}
              />
            </div>
          )}
          {group === "本地天气" && (
            <WeatherPicker
              config={v.config.weather}
              onChange={(weather) =>
                set({ ...v, config: { ...v.config, weather } })
              }
            />
          )}
          {groups
            .find((g) => g[0] === group)[1]
            .filter(
              ([key]) =>
                ![
                  "qq.privateAllowlist",
                  "qq.privateBlocklist",
                  "qq.groupAllowlist",
                  "qq.groupBlocklist",
                  "weather.city",
                  "weather.region",
                  "weather.countryCode",
                ].includes(key),
            )
            .filter(
              ([key]) =>
                !(
                  key === "limits.tokensPerDay" &&
                  (v.limitsSuspended || !v.config.limits?.tokenEnabled)
                ) &&
                !(key === "limits.cnyPerDay" && (v.limitsSuspended || !v.config.limits?.costEnabled)),
            )
            .map(([k, label, hint, type, min]) => {
              const componentId = settingComponent(k);
              const component = components?.components?.find((item) => item.id === componentId);
              const limitLocked = v.limitsSuspended && k.startsWith("limits.");
              const componentLocked = !!componentId && !component?.enabled;
              const locked = limitLocked || componentLocked;
              const lockHint = limitLocked ? "自定义供应商已停用此限额。" : componentLocked ? `组件「${component?.name || { voice: "中文语音", qzone: "QQ空间", bilibili: "B站工具" }[componentId]}」未开启，请先到能力组件开启。` : null;
              const value =
                  getPath(v.config, k) ??
                  {
                    "limits.tokensPerDay": 100000,
                    "limits.cnyPerDay": 5,
                    "life.editingEnabled": false,
                  }[k],
                update = (value) => {
                  const c = structuredClone(v.config);
                  putPath(c, k, value);
                  set({ ...v, config: c });
                };
              if (type === "voice")
                return (
                  <label className={locked ? "field setting-locked" : "field"} key={k}>
                    <span>{label}</span>
                    <select
                      aria-label={label}
                      value={value}
                      disabled={locked}
                      onChange={(e) => update(e.target.value)}
                    >
                      {voices?.map((v) => (
                        <option key={v.id} value={v.id} disabled={!v.installed}>
                          {v.name}
                          {v.installed ? "" : "（未安装）"}
                        </option>
                      ))}
                    </select>
                    <small>{lockHint || hint}</small>
                    <SettingCostHint
                      usage={usage}
                      config={v.config}
                      setting={k}
                    />
                  </label>
                );
              if (type === "checkbox")
                return (
                  <label className={locked ? "switch-row setting-locked" : "switch-row"} key={k}>
                    <div>
                      <strong>{label}</strong>
                      <small>{lockHint || hint}</small>
                      <SettingCostHint
                        usage={usage}
                        config={v.config}
                        setting={k}
                      />
                    </div>
                    <input
                      aria-label={label}
                      type="checkbox"
                      checked={!limitLocked && !!value}
                      disabled={locked}
                      onChange={(e) => update(e.target.checked)}
                    />
                  </label>
                );
              if (type === "visibility")
                return (
                  <label className={locked ? "field setting-locked" : "field"} key={k}>
                    <span>{label}</span>
                    <select
                      value={value}
                      disabled={locked}
                      onChange={(e) => update(Number(e.target.value))}
                    >
                      {[
                        [1, "所有人"],
                        [4, "好友"],
                        [64, "仅自己"],
                      ].map(([v, n]) => (
                        <option key={v} value={v}>
                          {n}
                        </option>
                      ))}
                    </select>
                    <small>{lockHint || hint}</small>
                  </label>
                );
              return (
                <Field
                  className={
                    (type === "number" ? "field compact-field" : "field") + (locked ? " setting-locked" : "")
                  }
                  key={k}
                  label={label}
                  hint={
                    <>
                      {lockHint || hint}
                      <SettingCostHint
                        usage={usage}
                        config={v.config}
                        setting={k}
                      />
                    </>
                  }
                  type={
                    ["number", "optionalNumber"].includes(type)
                      ? "number"
                      : "text"
                  }
                  step={k === "limits.cnyPerDay" ? 0.01 : undefined}
                  min={min}
                  max={type === "optionalNumber" ? 100 : undefined}
                  required={type === "number"}
                  disabled={locked}
                  value={
                    Array.isArray(value) ? value.join(", ") : (value ?? "")
                  }
                  onChange={(e) =>
                    update(
                      type === "optionalNumber"
                        ? e.target.value === ""
                          ? null
                          : Number(e.target.value)
                        : type === "number"
                          ? Number(e.target.value)
                          : ["admins", "ids"].includes(type)
                            ? e.target.value.split(/[\s,，]+/).filter(Boolean)
                            : e.target.value,
                    )
                  }
                />
              );
            })}
          {group !== "存储" &&
            !inspectionTarget() &&
            createPortal(
              <div className="floating-save">
                <button
                  type="submit"
                  form="settings-form"
                  className="primary"
                  disabled={saving}
                >
                  {saving ? "正在保存…" : "保存设置"}
                </button>
              </div>,
              document.body,
            )}
        </Form>
      </Card>
    </div>
  );
}
function Memories({ notify }) {
  const [rows, load, err] = useData("/api/memories"),
    [q, set] = useState(""),
    [grid, g] = useState(true),
    [filter, f] = useState("all"),
    [sort, sortBy] = useState("recent"),
    [id, select] = useState(null);
  if (id)
    return (
      <MemoryDetail
        id={id}
        back={() => {
          select(null);
          load();
        }}
        notify={notify}
      />
    );
  return (
    <>
      <div className="toolbar">
        <label className="search">
          <Search size={16} />
          <input
            aria-label="搜索用户"
            placeholder="搜索昵称或 QQ 号"
            value={q}
            onChange={(e) => set(e.target.value)}
          />
        </label>
        <div className="actions">
          <select
            aria-label="用户排序"
            value={sort}
            onChange={(e) => sortBy(e.target.value)}
          >
            <option value="recent">最近互动</option>
            <option value="affinity">好感度最高</option>
            <option value="affinityAsc">好感度最低</option>
            <option value="trust">信任度最高</option>
            <option value="familiarity">熟悉度最高</option>
            <option value="name">昵称顺序</option>
          </select>
          <select
            aria-label="用户筛选"
            value={filter}
            onChange={(e) => f(e.target.value)}
          >
            <option value="all">全部用户</option>
            <option value="active">未屏蔽</option>
            <option value="blocked">已屏蔽</option>
          </select>
          <button aria-pressed={grid} onClick={() => g(!grid)}>
            {grid ? "切换列表" : "切换网格"}
          </button>
          <button aria-label="刷新记忆" onClick={load}>
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <ErrorBox>{err}</ErrorBox>
      <div className={grid ? "user-grid" : "user-list"}>
        {rows
          ?.filter(
            (u) =>
              (u.name + " " + (u.remark || "") + " " + u.id).includes(q) &&
              (filter === "all" || (filter === "blocked") === !!u.blocked),
          )
          .slice()
          .sort((a, b) =>
            sort === "name"
              ? String(a.name).localeCompare(String(b.name), "zh-CN")
              : sort === "affinityAsc"
                ? a.affinity - b.affinity
                : sort === "recent"
                  ? (b.lastIncoming || 0) - (a.lastIncoming || 0)
                  : (b[sort] || 0) - (a[sort] || 0),
          )
          .map((u) => (
            <button
              className="user-card"
              key={u.id}
              onClick={() => select(u.id)}
            >
              <div className="user-identity">
                <div className="avatar">{(u.name || "?").slice(0, 1)}</div>
                <div>
                  <strong>{u.name || u.id}</strong>
                  {u.remark && <small>备注：{u.remark}</small>}
                  {!u.nicknameVerified && <small>QQ昵称待同步</small>}
                  <small>
                    QQ {u.id}
                    {u.blocked ? " · 已屏蔽" : ""}
                  </small>
                </div>
                <span>›</span>
              </div>
              <div className="rings">
                {["affinity", "trust", "familiarity"].map((k) => (
                  <Ring key={k} value={u[k]} label={labels[k]} />
                ))}
              </div>
              <small>最近互动 {time(u.lastIncoming)}</small>
            </button>
          ))}
      </div>
      {rows && !rows.length && <Empty>她还没有认识新的朋友</Empty>}
    </>
  );
}
function MemoryDetail({ id, back, notify }) {
  const [u, load, err, set] = useData("/api/memories/" + id),
    [scope, s] = useState("qq:user:" + id);
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!u) return <Empty>正在打开记忆…</Empty>;
  return (
    <>
      <div className="toolbar">
        <button onClick={back}>← 返回用户列表</button>
        <div className="actions">
          {[u.blocked ? "unblock" : "block", "delete"].map((action) => (
            <button
              className={action === "delete" ? "danger" : ""}
              disabled={!!inspectionTarget()}
              key={action}
              onClick={async () => {
                if (
                  !confirm(
                    action === "delete"
                      ? "确定删除该用户的AI可用记忆？"
                      : "确认" +
                          (u.blocked ? "解除屏蔽" : "在程序内屏蔽") +
                          "此用户？",
                  )
                )
                  return;
                try {
                  const r = await api("/api/memories/" + id, { action });
                  notify(r.message);
                  back();
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              {action === "delete"
                ? "删除记忆"
                : u.blocked
                  ? "解除屏蔽"
                  : "屏蔽用户"}
            </button>
          ))}
        </div>
      </div>
      <Card title={u.name + " · " + id}>
        <div className="rings large">
          {["affinity", "trust", "familiarity"].map((k) => (
            <Ring key={k} value={u[k]} label={labels[k]} />
          ))}
        </div>
        <Form
          submit={async () => {
            const r = await api("/api/memories/" + id, {
              action: "remark",
              remark: u.remark || "",
              revision: u.remarkRevision,
            });
            notify(r.message);
            load();
          }}
        >
          <Field
            label="用户备注"
            value={u.remark || ""}
            maxLength={80}
            onChange={(e) => set({ ...u, remark: e.target.value })}
            hint="仅保存在本账号，不修改QQ昵称、关系数值或其他用户的备注。"
          />
          <button>保存备注</button>
        </Form>
      </Card>
      <div className="two-col">
        <Card
          title="记忆清单"
          subtitle="来源独立保存，跨会话隐私边界保持不变。"
        >
          <label className="field">
            <span>记忆来源</span>
            <select value={scope} onChange={(e) => s(e.target.value)}>
              {[
                ...new Set([
                  "qq:user:" + id,
                  ...Object.keys(u.checklist.sections),
                ]),
              ].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>

          <Form
            submit={async () => {
              const r = await api("/api/memories/" + id, {
                action: "save",
                scope,
                text: u.checklist.sections[scope]?.text || "",
                revision: u.checklist.revision,
              });
              notify(r.message);
              load();
            }}
          >
            <label className="field">
              <span>压缩记忆</span>
              <textarea
                className="editor"
                maxLength={50000}
                value={u.checklist.sections[scope]?.text || ""}
                onChange={(e) =>
                  set({
                    ...u,
                    checklist: {
                      ...u.checklist,
                      sections: {
                        ...u.checklist.sections,
                        [scope]: { text: e.target.value },
                      },
                    },
                  })
                }
              />
            </label>

            <button className="primary">保存记忆</button>
          </Form>
        </Card>
        <div className="stack">
          <Card title="近期聊天">
            <div className="chat-history">
              {u.history?.length ? (
                u.history.map((h, i) => (
                  <div key={i} className={"chat " + h.role}>
                    <small>
                      {h.role === "assistant" ? "大肥鱼" : u.name} ·{" "}
                      {time(h.time)}
                    </small>
                    <p>{h.content}</p>
                  </div>
                ))
              ) : (
                <Empty>暂无聊天记录</Empty>
              )}
            </div>
          </Card>
          <Card title="长期印象">
            {u.memories?.map((m, i) => (
              <p key={i}>{m.quote || m.text}</p>
            ))}
            {u.summaries?.map((s, i) => (
              <div key={i}>
                <small>{s.day}</small>
                <p>{s.text}</p>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
function Components({ notify }) {
  const [v, load, err] = useData("/api/components"),
    [tab, setTab] = useState("installed");
  if (err) return <ErrorBox>{err}</ErrorBox>;
  const rows = v?.components || [];
  return (
    <>
      <div className="tabs" role="tablist" aria-label="组件分类">
        {[
          ["installed", "已安装"],
          ["available", "未安装"],
        ].map(([id, name]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            onClick={() => setTab(id)}
          >
            {name}{" "}
            <small>
              {
                rows.filter((c) =>
                  id === "installed" ? c.installed : !c.installed,
                ).length
              }
            </small>
          </button>
        ))}
      </div>
      <div className="component-grid">
        {rows
          .filter((c) => (tab === "installed" ? c.installed : !c.installed))
          .map((c) => (
            <Card
              className={c.unavailable ? "component-disabled" : ""}
              key={c.id}
              title={c.name}
              subtitle={c.description}
            >
              <fieldset disabled={c.unavailable || !!inspectionTarget()}>
                <div className="actions">
                  <span className="badge">
                    {c.unavailable
                      ? c.siteDisabled
                        ? "站点已停用"
                        : "暂未开放"
                      : c.kind === "builtin"
                        ? "内置能力"
                        : "MCP 组件"}
                  </span>
                  <span className={c.enabled ? "enabled-text" : "muted"}>
                    {c.enabled ? "已开启" : "已关闭"}
                  </span>
                </div>
                <button
                  onClick={async () => {
                    try {
                      const result = await api("/api/components", {
                        id: c.id,
                        revision: v.revision,
                        enabled: !c.enabled,
                        ...(!c.installed ? { installed: true } : {}),
                      });
                      notify(result.message);
                      load();
                    } catch (e) {
                      notify(e.message);
                    }
                  }}
                >
                  {c.unavailable
                    ? c.siteDisabled
                      ? "站点已停用"
                      : "暂时停用"
                    : !c.installed
                      ? "安装并开启"
                      : c.enabled
                        ? "关闭组件"
                        : "开启组件"}
                </button>
              </fieldset>
            </Card>
          ))}
      </div>
      {v &&
        !rows.some((c) =>
          tab === "installed" ? c.installed : !c.installed,
        ) && <Empty>这个分类暂时没有组件</Empty>}
    </>
  );
}
function activityText(row, qq) {
  return {
    title:
      activityCatalog[qq ? "qq" : "bilibili"][row.operation]?.title ||
      "进行了一次平台互动",
    detail: activityDetail(row),
    state:
      {
        started: "正在处理",
        succeeded: "已完成",
        failed: "未成功",
        uncertain: "结果待确认",
        skipped: "已略过",
      }[row.state] || "",
  };
}
function Records({ page, notify }) {
  const log = page === "logs",
    qq = page === "qqActivity";
  const [rows, load, err] = useData(
      log ? "/api/logs" : qq ? "/api/qq-activity" : "/api/activity",
      log ? 5000 : 15000,
    ),
    [q, set] = useState(""),
    [operation, setOperation] = useState(""),
    [paused, pause] = useState(false),
    [held, hold] = useState(null);
  useEffect(() => {
    if (!paused) hold(rows);
  }, [rows, paused]);
  const latest = new Map();
  for (const row of held || []) {
    const key = row.id || JSON.stringify(row);
    latest.set(key, { ...latest.get(key), ...row });
  }
  const visible = [...latest.values()].filter((r) => {
    const v = log
      ? r.text || r.message || ""
      : Object.values(activityText(r, qq)).join(" ") +
        " " +
        (r.input?.bvid || r.receipt?.bvid || "");
    return (
      matchesActivity(r, operation) && v.toLowerCase().includes(q.toLowerCase())
    );
  });
  return (
    <>
      <div className="toolbar records-toolbar">
        <div className="records-search-controls">
          <label className="search">
            <Search size={16} />
            <input
              aria-label="搜索记录"
              placeholder="搜索记录"
              value={q}
              onChange={(e) => set(e.target.value)}
            />
          </label>
          {!log && (
            <label className="activity-filter">
              <span className="visually-hidden">行为筛选</span>
              <select
                aria-label="行为筛选"
                value={operation}
                onChange={(e) => setOperation(e.target.value)}
              >
                <option value="">全部行为</option>
                {activityFilters(qq ? "qq" : "bilibili", held || []).map(
                  (option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ),
                )}
              </select>
            </label>
          )}
        </div>
        {log ? (
          <div className="actions">
            <button onClick={() => pause(!paused)}>
              {paused ? "继续更新" : "暂停更新"}
            </button>
            <button
              className="danger"
              disabled={!!inspectionTarget()}
              onClick={async () => {
                if (
                  !confirm("清空当前运行日志？QQ/B站足迹和业务审计不会删除。")
                )
                  return;
                try {
                  const result = await api("/api/logs/clear", {});
                  hold([]);
                  pause(false);
                  load();
                  notify(result.message);
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              清空日志
            </button>
          </div>
        ) : (
          <span className="muted">
            {qq ? "记录空间、资料等操作，不收录QQ聊天" : "观看视频不计入足迹"}
          </span>
        )}
      </div>
      <ErrorBox>{err}</ErrorBox>
      <Card>
        {visible.length ? (
          log ? (
            <pre className="terminal">
              {visible.map((r) => r.text || r.message || "").join("\n")}
            </pre>
          ) : (
            visible
              .slice()
              .reverse()
              .map((r, i) => {
                const text = activityText(r, qq);
                return (
                  <article className="record" key={i}>
                    <span className="record-dot" />
                    <div>
                      <strong>{text.title}</strong>
                      <p>{text.detail}</p>
                      {/^BV[0-9A-Za-z]{10}$/.test(
                        r.input?.bvid || r.receipt?.bvid || "",
                      ) && (
                        <a
                          className="video-ref"
                          href={
                            "https://www.bilibili.com/video/" +
                            (r.input?.bvid || r.receipt?.bvid)
                          }
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.input?.bvid || r.receipt?.bvid} ↗
                        </a>
                      )}
                      {!qq &&
                        r.operation === "comments" &&
                        (r.receipt?.comments?.length ? (
                          <div className="comment-samples">
                            {r.receipt.comments.map((c, index) => (
                              <blockquote key={index}>
                                <strong>{c.author || "观众"}</strong>
                                <p>{c.text}</p>
                              </blockquote>
                            ))}
                          </div>
                        ) : (
                          r.state === "succeeded" && (
                            <p className="muted">这条旧记录未留存评论正文。</p>
                          )
                        ))}
                      <small>
                        {text.state} · {time(r.time || r.at)}
                      </small>
                    </div>
                  </article>
                );
              })
          )
        ) : (
          <Empty>暂无符合条件的记录</Empty>
        )}
      </Card>
    </>
  );
}

export default Panel;
