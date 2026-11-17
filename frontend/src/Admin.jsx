import SiteSettings from "./SiteSettings.jsx";
import TenantList from "./TenantList.jsx";
import SiteComponents from "./SiteComponents.jsx";
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
  setCSRF,
  markClean,
} from "./shared.jsx";
function AdminTabs() {
  return (
    <nav className="tabs admin-tabs" aria-label="站点管理页面">
      <a href="/admin" className={!location.hash ? "selected" : ""}>
        站点概况
      </a>
      <a
        href="/admin#settings"
        className={location.hash === "#settings" ? "selected" : ""}
      >
        站点设置
      </a>
      <a
        href="/admin#captcha"
        className={location.hash === "#captcha" ? "selected" : ""}
      >
        验证码设置
      </a>
      <a
        href="/admin#email"
        className={location.hash === "#email" ? "selected" : ""}
      >
        邮箱设置
      </a>
    </nav>
  );
}
const restartLabels = { queued: "等待重启", restarting: "正在重启", restarted: "已重启", skipped: "已跳过", failed: "重启失败" };

function RestartControls({ users, notify }) {
  const [state, , error, setState] = useData("/admin/restart", 3000);
  const [username, select] = useState("");
  const [working, setWorking] = useState(false);
  const [restartFrom, setRestartFrom] = useState(null);
  const job = state?.job;
  const disabled = working || !state || state.siteRestartPending || !!(job && !job.finishedAt) || restartFrom !== null;
  useEffect(() => {
    if (restartFrom !== null && state?.siteStartedAt && state.siteStartedAt !== restartFrom) {
      setRestartFrom(null);
      notify("站点管理服务已恢复");
    }
  }, [restartFrom, state?.siteStartedAt, notify]);
  useEffect(() => {
    if (restartFrom === null) return;
    const timeout = setTimeout(() => {
      setRestartFrom(null);
      notify("尚未确认站点恢复，请刷新面板检查。");
    }, 65000);
    return () => clearTimeout(timeout);
  }, [restartFrom, notify]);
  const restart = async (scope, message) => {
    if (!confirm(message)) return;
    setWorking(true);
    try {
      const result = await api("/admin/restart", { scope, ...(scope === "user" ? { username } : {}) });
      if (scope === "site") setRestartFrom(result.siteStartedAt);
      else setState({ ...state, job: result.job });
    } catch (e) {
      notify(e.message);
    } finally {
      setWorking(false);
    }
  };
  return (
    <Card title="服务重启" subtitle="站点操作只重启管理服务。实例操作会跳过已停止的大肥鱼。">
      <div className="actions">
        <button disabled={disabled} onClick={() => restart("site", "重启站点管理服务？面板会短暂断开。")}>重启站点</button>
        <button disabled={disabled} onClick={() => restart("all", "逐个重启所有正在运行的大肥鱼？")}>重启全部实例</button>
      </div>
      <label className="field">
        <span>选择实例</span>
        <select value={username} onChange={(e) => select(e.target.value)} disabled={disabled}>
          <option value="">请选择用户</option>
          {users.filter((user) => user.qq && !user.disabled).map((user) => (
            <option key={user.username} value={user.username}>{user.username}</option>
          ))}
        </select>
      </label>
      <button disabled={disabled || !username} onClick={() => restart("user", "重启 " + username + " 的大肥鱼？")}>重启选中实例</button>
      {(restartFrom !== null || state?.siteRestartPending) && <p role="status">正在等待站点管理服务恢复…</p>}
      {error && restartFrom === null && <ErrorBox>{error}</ErrorBox>}
      {job && <ul aria-label="实例重启结果">
        {job.instances.length === 0 && <li>暂无实例可重启</li>}
        {job.instances.map((row) => <li key={row.username}>{row.username} · {restartLabels[row.state]}{row.error && " · " + row.error}</li>)}
      </ul>}
    </Card>
  );
}

function Admin({ notify }) {
  const [v, load, err] = useData("/admin/overview"),
    [code, set] = useState("");
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!v) return <Empty>正在载入站点管理…</Empty>;
  if (["#settings", "#captcha", "#email"].includes(location.hash))
    return (
      <>
        <AdminTabs />
        <SiteSettings
          notify={notify}
          section={
            location.hash.slice(1) === "settings"
              ? "general"
              : location.hash.slice(1)
          }
        />
      </>
    );
  return (
    <>
      <AdminTabs />
      <RestartControls users={v.users} notify={notify} />
      <div className="two-col">
        <Card
          title="发放邀请码"
          subtitle="邀请码仅在生成时显示，在邀请码注册模式下使用。"
        >
          <Form
            submit={async (values) => {
              const r = await api("/admin/invites", {
                maxUses: Number(values.maxUses),
                days: Number(values.days),
              });
              set(r.code);
              load();
              notify("邀请码已生成");
            }}
          >
            <div className="form-grid">
              <Field
                label="使用次数"
                name="maxUses"
                type="number"
                min={1}
                max={100}
                defaultValue={1}
              />
              <Field
                label="有效天数"
                name="days"
                type="number"
                min={1}
                max={30}
                defaultValue={7}
              />
            </div>
            <button className="primary">生成邀请码</button>
          </Form>
          {code && (
            <div className="code-box">
              <code>{code}</code>
              <button
                onClick={() =>
                  navigator.clipboard
                    .writeText(code)
                    .then(() => notify("已复制"))
                    .catch(() => notify("请手动复制"))
                }
              >
                复制
              </button>
            </div>
          )}
        </Card>
        <Card title="站点概况">
          <div className="balance-value">
            {v.users.length} <small>位用户</small>
          </div>
          <p>
            {v.users.filter((u) => u.qq).length} 只大肥鱼 ·{" "}
            {v.users.filter((u) => u.desired).length} 个实例期望运行
          </p>
          <p className="muted">
            停用账号会停止其服务并保留数据；删除会清除当前账号、记忆、配置和 QQ
            登录数据。历史运维备份可能仍保留副本。
          </p>
        </Card>
      </div>
      <TenantList users={v.users} />
      <SiteComponents notify={notify} />
      <Card title="用户管理">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {["用户", "邮箱", "角色", "QQ", "状态", "管理"].map((t) => (
                  <th key={t}>{t}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {v.users.map((u) => (
                <tr key={u.username}>
                  <td>{u.username}</td>
                  <td>
                    {u.email || "未填写"}
                    {u.email && (
                      <small className="muted">
                        {u.email_verified ? " · 已验证" : " · 未验证"}
                      </small>
                    )}
                  </td>
                  <td>{u.role === "admin" ? "管理员" : "用户"}</td>
                  <td>{u.qq || "未创建"}</td>
                  <td>
                    {u.disabled
                      ? "已停用"
                      : u.email_pending
                        ? "待邮箱激活"
                        : u.billing
                          ? "余额不足"
                          : "正常"}
                  </td>
                  <td>
                    <div className="actions">
                      {[u.disabled ? "enable" : "disable", "reset"].map(
                        (action) => (
                          <button
                            key={action}
                            onClick={async () => {
                              if (
                                !confirm(
                                  "确认对 " + u.username + " 执行此操作？",
                                )
                              )
                                return;
                              try {
                                const r = await api("/admin/user", {
                                  username: u.username,
                                  action,
                                });
                                if (r.activation) {
                                  set(
                                    location.origin +
                                      "/activate#" +
                                      r.activation,
                                  );
                                  notify(
                                    "一次性密码设置链接已显示在邀请码区域",
                                  );
                                }
                                load();
                              } catch (e) {
                                notify(e.message);
                              }
                            }}
                          >
                            {action === "reset"
                              ? "重设密码"
                              : u.disabled
                                ? "启用"
                                : "停用"}
                          </button>
                        ),
                      )}
                      {u.role !== "admin" && (
                        <button
                          className="danger"
                          onClick={async () => {
                            const confirmed = prompt(
                              `即将删除 ${u.username} 的账号、记忆、配置和 QQ 登录数据。历史运维备份可能仍保留副本。请输入用户名确认：`,
                            );
                            if (confirmed !== u.username) {
                              if (confirmed !== null)
                                notify("用户名不一致，已取消删除");
                              return;
                            }
                            try {
                              await api("/admin/user", {
                                username: u.username,
                                action: "delete",
                                confirmUsername: confirmed,
                              });
                              notify(`已删除 ${u.username} 及其数据`);
                              load();
                            } catch (e) {
                              notify(e.message);
                            }
                          }}
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="已发放的邀请">
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>标识</th>
                <th>使用</th>
                <th>到期时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {v.invites.map((i) => (
                <tr key={i.id}>
                  <td>{i.id}</td>
                  <td>
                    {i.uses} / {i.max_uses}
                  </td>
                  <td>{time(i.expires)}</td>
                  <td>
                    {i.revoked ? (
                      "已撤销"
                    ) : (
                      <button
                        onClick={async () => {
                          try {
                            await api("/admin/revoke", { id: i.id });
                            load();
                          } catch (e) {
                            notify(e.message);
                          }
                        }}
                      >
                        撤销
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="管理审计">
        {v.audit.slice(0, 30).map((a, i) => (
          <div className="record" key={i}>
            <small>{time(a.time)}</small>
            <strong>
              {a.actor} · {a.action}
            </strong>
            <span>{a.subject}</span>
          </div>
        ))}
      </Card>
    </>
  );
}

export default Admin;
