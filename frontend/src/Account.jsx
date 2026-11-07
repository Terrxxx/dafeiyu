import EmailSettings from "./EmailSettings.jsx";
import PasswordChange from "./PasswordChange.jsx";
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
  Form,
  Ring,
  Metric,
  Risk,
  Theme,
  markClean,
} from "./shared.jsx";
function Account({ me, tab, notify }) {
  const [d, load, error] = useData("/account/status");
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!d) return <Empty>正在读取实例…</Empty>;
  const b = d.bot;
  const command = async (action) => {
    try {
      await api("/account/control", { action });
      notify("操作完成");
      load();
    } catch (e) {
      notify(e.message);
    }
  };
  if (!b && tab === "security") return <><EmailSettings notify={notify}/><Card title="登录密码"><PasswordChange notify={notify}/></Card></>;
  if (!b)
    return (
      <div className="two-col">
        <Card
          title="和她见面的第一步"
          subtitle="每个账号一只大肥鱼，记忆与数据独立保存。"
        >
          <Form
            submit={async (v) => {
              await api("/account/create", v);
              notify("已创建，请扫码登录 QQ");
              location.hash = "connections";
              load();
            }}
          >
            <Field
              label="大肥鱼的 QQ 号"
              name="qq"
              pattern="[0-9]{5,15}"
              required
            />
            <Field
              label="管理员 QQ 号"
              name="adminQQ"
              pattern="[0-9]{5,15}"
              required
            />
            <Field
              label="DeepSeek API Key"
              name="apiKey"
              type="password"
              autoComplete="off"
              required
            />
            <Risk />
            <button className="primary">创建我的大肥鱼</button>
          </Form>
        </Card>
        <Card title="一个属于她的小世界">
          <div className="onboarding-art">
            <Fish size={90} />
          </div>
          <p>先连接 QQ 和模型，就可以开始相处。</p>
          <p>B站可以稍后连接。她会记住熟悉的人，也会有自己的情绪和生活节奏。</p>
        </Card>
      </div>
    );
  return (
    <>
      <div className="tabs" role="tablist" aria-label="实例设置">
        {[
          ["overview", "实例概览"],
          ["connections", "账号连接"],
          ["security", "密钥与安全"],
        ].map(([id, n]) => (
          <a
            role="tab"
            aria-selected={tab === id}
            key={id}
            href={id === "overview" ? "/account" : "#" + id}
          >
            {n}
          </a>
        ))}
      </div>
      {tab === "security" && <EmailSettings notify={notify} />}
      {d.daily?.paused && (
        <ErrorBox>
          日额度暂停：{d.daily.reasons.join("；")}
          。北京时间次日00:00恢复；后台保留运行以继续计算精力。
        </ErrorBox>
      )}
      {b.billing && (
        <ErrorBox>API 余额不足，服务已停止。充值后检查余额再启动。</ErrorBox>
      )}
      {tab === "connections" ? (
        <div className="two-col">
          <div className="stack">
            <Connection type="qq" bot={b} notify={notify} />
            <Connection type="bili" bot={b} notify={notify} />
          </div>
          <Card title="连接之前，了解这些">
            <h3>QQ 是必要连接</h3>
            <p>请使用填写的账号扫码，并在手机上确认。</p>
            <h3>凭据独立保存</h3>
            <p>凭据仅用于你的实例，不在页面回显。</p>
            <Risk />
          </Card>
        </div>
      ) : tab === "security" ? (
        <div className="two-col">
          <Card
            title="模型凭据"
            subtitle="更换密钥会暂停服务，保存后重新启动。"
          >
            <Form
              submit={async (v) => {
                await api("/account/key", v);
                notify("密钥已更新");
                load();
              }}
            >
              <Field
                label="新的 API Key"
                name="apiKey"
                type="password"
                required
                autoComplete="off"
              />
              <button className="primary">保存密钥</button>
            </Form>
          </Card>
          <Card title="登录密码">
            <PasswordChange notify={notify} />
          </Card>
        </div>
      ) : (
        <>
          <div className="metric-grid">
            <Metric
              label="运行状态"
              value={b.phase === "running" ? "运行中" : "已停止"}
              hint={b.desired ? "保持自主生活" : "随时可以重新启动"}
            />
            <Metric
              label="QQ 连接"
              value={b.qqRunning ? "已启动" : "未连接"}
              hint={b.qq}
            />
            <Metric
              label="B站账号"
              value={b.biliConfigured ? "已连接" : "未连接"}
              hint="可选连接"
            />
          </div>
          <div className="two-col">
            <Card title="她的独立空间" subtitle={"所属账号 / " + me.username}>
              <div className="instance-body">
                <div className="fish-avatar">
                  <Fish size={60} />
                </div>
                <div>
                  <span className="badge">
                    {b.phase === "running" ? "正在生活" : "等待开启"}
                  </span>
                  <h3>大肥鱼</h3>
                  <p>QQ {b.qq}</p>
                </div>
              </div>
              <div className="actions">
                <button
                  className="primary"
                  onClick={() =>
                    command(b.phase === "running" ? "stop" : "start")
                  }
                >
                  {b.phase === "running" ? "停止实例" : "启动大肥鱼"}
                </button>
                <button onClick={() => command("restart")}>
                  <RefreshCw size={15} />
                  重启
                </button>
                <a className="button" href="/panel">
                  进入她的生活 <ArrowUpRight size={15} />
                </a>
              </div>
              <div className="card-foot">
                暂停活动，所有记忆与数据都会保留。
              </div>
            </Card>
            <Balance notify={notify} />
          </div>
          <div className="callout">
            <Heart />
            <div>
              <strong>性格，来自每一次相处。</strong>
              <p>在控制室中看看她的情绪、记忆和最近的决定。</p>
            </div>
            <a href="/panel#memories">看看她记得谁 ↗</a>
          </div>
        </>
      )}
    </>
  );
}
function Balance() {
  const [v, , err] = useData("/account/credits", 60000);
  return (
    <Card title="API 余额" subtitle="自动更新 · 使用自己的 DeepSeek 账户余额。">
      {v ? (
        <>
          <div
            className={
              "balance-value " + (v.available ? "enabled-text" : "danger")
            }
          >
            {v.balances?.length
              ? v.balances.map((x) => (
                  <div key={x.currency}>
                    {x.total} <small>{x.currency}</small>
                  </div>
                ))
              : v.available
                ? "余额可用"
                : "余额不足"}
          </div>
          <span className={"badge " + (v.available ? "good" : "bad")}>
            {v.available ? "余额可用" : "余额不足，服务已停止"}
          </span>
          <p className="muted">更新于 {time(v.checkedAt)} · 每分钟自动检查</p>
        </>
      ) : (
        !err && <p>正在读取余额…</p>
      )}
      <ErrorBox>{err}</ErrorBox>
      <p>余额不足会自动停止，记忆会保留。金额不是剩余 token 数。</p>
    </Card>
  );
}
function Connection({ type, bot, notify }) {
  const [image, set] = useState(""),
    [status, s] = useState(""),
    [busy, b] = useState(false),
    [poll, p] = useState(false);
  const qq = type === "qq";
  const check = useCallback(async () => {
    const v = await api(
      qq ? "/account/qq/status" : "/account/bili/poll",
      qq ? undefined : {},
    );
    s(v.loggedIn ? "已登录" : v.message || "等待扫码");
    if (v.loggedIn) {
      set("");
      p(false);
      notify("登录成功，启动实例即可生效");
    }
  }, [qq]);
  useEffect(() => {
    if (!poll) return;
    let n = 0;
    const t = setInterval(() => {
      if (++n > 80) {
        p(false);
        s("二维码可能已过期，请重新获取");
        return;
      }
      check().catch((e) => {
        s(e.message);
        p(false);
      });
    }, 3000);
    return () => clearInterval(t);
  }, [poll, check]);
  return (
    <Card
      title={qq ? "QQ 账号" : "B站账号 · 可选"}
      subtitle={
        qq
          ? "使用 QQ " + bot.qq + " 扫码并确认。"
          : "浏览、分享与互动，由她自主选择。"
      }
    >
      <span
        className={
          "badge " +
          (status === "已登录" ||
          (!status && (qq ? bot.qqRunning : bot.biliConfigured))
            ? "good"
            : "bad")
        }
      >
        {status ||
          (qq
            ? bot.qqRunning
              ? "连接服务已启动"
              : "尚未连接"
            : bot.biliConfigured
              ? "已配置"
              : "尚未连接")}
      </span>
      <div className="actions">
        <button
          disabled={busy}
          onClick={async () => {
            b(true);
            try {
              if (qq) await api("/account/qq/start", {});
              const v = await api(
                qq ? "/account/qq/qr" : "/account/bili/qr",
                qq ? { refresh: !!image } : {},
              );
              set(v.image);
              p(true);
              s("等待扫码");
            } catch (e) {
              s(e.message);
            } finally {
              b(false);
            }
          }}
        >
          {busy ? "正在准备…" : image ? "刷新二维码" : "扫码登录"}
        </button>
        {qq ? (
          <button onClick={() => check().catch((e) => notify(e.message))}>
            检查登录
          </button>
        ) : (
          bot.biliConfigured && (
            <button
              onClick={async () => {
                try {
                  await api("/account/bili/logout", {});
                  s("已断开");
                  p(false);
                  set("");
                } catch (e) {
                  notify(e.message);
                }
              }}
            >
              断开连接
            </button>
          )
        )}
      </div>
      {image && (
        <div className="qr">
          <img src={image} alt={(qq ? "QQ" : "B站") + "登录二维码"} />
          <p>请在手机上确认登录</p>
        </div>
      )}
    </Card>
  );
}

export default Account;
