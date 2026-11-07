import AuthFlow from "./AuthFlow.jsx";
import EmailGate from "./EmailGate.jsx";
import {
  EmailVerify,
  PendingActivation,
  ResendActivation,
} from "./EmailActivation.jsx";
import { inspectionTarget, panelLink } from "./shared.jsx";
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
  BrandIcon,
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
import Account from "./Account.jsx";
import Panel from "./Panel.jsx";
import Admin from "./Admin.jsx";
function Auth() {
  const mode = ["/register", "/activate"].includes(location.pathname)
      ? location.pathname.slice(1)
      : "login",
    [pending, setPending] = useState(null);
  const [registration] = useData("/auth/options");
  if (location.pathname === "/verify-email") return <EmailVerify />;
  if (pending) return <PendingActivation value={pending} />;
  return (
    <div className="auth">
      <header>
        <a href="/login" className="brand">
          <BrandIcon />
          大肥鱼 <span>WORKSPACE</span>
        </a>
        <Theme />
      </header>
      <main className="auth-content">
        <section className="auth-story">
          <span className="eyebrow">A LITTLE LIFE, ALL YOUR OWN</span>
          <h1>
            不止是对话。
            <br />
            是慢慢熟悉的
            <br />
            <em>每一天。</em>
          </h1>
          <p>
            给她一个独立的空间，
            <br />
            让记忆、情绪和性格，随相处一点点生长。
          </p>
          <div className="ocean-art" aria-hidden="true">
            <Fish size={120} strokeWidth={0.8} />
            <span className="orbit one" />
            <span className="orbit two" />
            <span className="art-note">大肥鱼的生活，正在发生。</span>
          </div>
          <small>独立记忆 · 自主生活 · 由你掌握</small>
        </section>
        <section className="auth-box">
          <div className="auth-heading">
            <span className="eyebrow">YOUR WORKSPACE</span>
            <h2>
              {mode === "register"
                ? "创建你的账号"
                : mode === "activate"
                  ? "设置登录密码"
                  : "欢迎回来"}
            </h2>
            <p>
              {mode === "register"
                ? registration?.registrationMode === "closed"
                  ? "站点暂不允许新用户注册。"
                  : registration?.registrationMode === "open"
                    ? "一步一步，开启与大肥鱼的日常。"
                    : "使用邀请码，开启与大肥鱼的日常。"
                : "登录，看看她今天过得怎么样。"}
            </p>
          </div>
          <AuthFlow
            key={mode}
            mode={mode}
            registration={registration}
            onSuccess={async (result) => {
              if (result.activationRequired) {
                setPending(result);
                return;
              }
              const n = new URLSearchParams(location.search).get("next");
              markClean();
              location.href =
                n?.startsWith("/") &&
                !n.startsWith("//") &&
                !n.includes("\\") &&
                !/^\/(login|register|activate)/.test(n)
                  ? n
                  : "/account";
            }}
          />
          {mode === "login" && <ResendActivation />}
          <div className="auth-switch">
            {mode === "login" ? (
              <>
                还没有账号？{" "}
                {registration?.registrationMode === "closed" ? (
                  <span>暂不开放注册</span>
                ) : (
                  <a href="/register">
                    {registration?.registrationMode === "open"
                      ? "注册账号 ↗"
                      : "邀请码注册 ↗"}
                  </a>
                )}
              </>
            ) : (
              <a href="/login">返回登录</a>
            )}
          </div>
        </section>
      </main>
      <footer>大肥鱼 · 每一个相处，都有记忆。</footer>
    </div>
  );
}
const nav = [
  ["/account", "工作空间", LayoutDashboard],
  ["/account#connections", "账号连接", Plug],
  ["/panel", "生活概览", Activity],
  ["/panel#life", "情绪与精力", Heart],
  ["/panel#memories", "用户记忆", Users],
  ["/panel#persona", "性格提示词", NotebookPen],
  ["/panel#settings", "生活设置", SlidersHorizontal],
  ["/panel#components", "能力组件", Blocks],
  ["/panel#qqActivity", "QQ 足迹", Footprints],
  ["/panel#activity", "B站足迹", Footprints],
  ["/panel#logs", "运行日志", ScrollText],
  ["/account#security", "账号安全", Shield],
];
function App() {
  const [me, setMe] = useState(null),
    [error, err] = useState(""),
    [route, setRoute] = useState(
      location.pathname + location.search + location.hash,
    ),
    [toast, notify] = useState(""),
    [menu, setMenu] = useState(false);
  useEffect(() => {
    api("/auth/me")
      .then((v) => {
        setCSRF(v.csrf || "");
        setMe(v);
      })
      .catch((e) => err(e.message));
    const cb = () => {
      setRoute(location.pathname + location.search + location.hash);
      setMenu(false);
    };
    addEventListener("hashchange", cb);
    addEventListener("popstate", cb);
    return () => {
      removeEventListener("hashchange", cb);
      removeEventListener("popstate", cb);
    };
  }, []);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => notify(""), 6000);
      return () => clearTimeout(t);
    }
  }, [toast]);
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!me) return <div className="loading">正在打开工作空间…</div>;
  if (
    !me.authenticated ||
    ["/login", "/register", "/activate", "/verify-email"].includes(
      location.pathname,
    )
  )
    return <Auth />;
  if (me.emailRequired)
    return <EmailGate me={me} notify={notify} message={toast} />;
  const target = inspectionTarget();
  if (target && me.role !== "admin")
    return <ErrorBox>仅站点管理员可查看其他用户面板</ErrorBox>;
  const navRoute = location.pathname + location.hash.split("?")[0];
  const title =
    nav.find((n) => n[0] === navRoute)?.[1] ||
    (location.pathname === "/admin" ? "站点管理" : "工作空间");
  return (
    <div className={"shell " + (menu ? "menu-open" : "")}>
      <aside className="sidebar">
        <a className="brand" href="/account">
          <BrandIcon size={30} />
          大肥鱼<span className="version">2.0</span>
        </a>
        <div className="workspace">
          <div className="avatar">
            {(target || me.username).slice(0, 1).toUpperCase()}
          </div>
          <div>
            <strong>{target || me.username}</strong>
            <small>{target ? "管理员只读查看" : "独立工作空间"}</small>
          </div>
          <Check size={15} />
        </div>
        <nav aria-label="主导航">
          <small className="nav-label">工作空间</small>
          {nav.map(([href, label, Icon], i) => (
            <React.Fragment key={href}>
              {i === 2 && <small className="nav-label">她的生活</small>}
              {i === 11 && <small className="nav-label">账户</small>}
              <a
                href={panelLink(href)}
                className={navRoute === href ? "active" : ""}
              >
                <Icon size={17} />
                {label}
                {navRoute === href && <span className="nav-dot" />}
              </a>
            </React.Fragment>
          ))}
          {me.role === "admin" && (
            <a href="/admin" className={route === "/admin" ? "active" : ""}>
              <Shield size={17} />
              站点管理
            </a>
          )}
        </nav>
        <div className="sidebar-bottom">
          <Theme />
          <button
            onClick={async () => {
              try {
                await api("/auth/logout", {});
                location.href = "/login";
              } catch (e) {
                notify(e.message);
              }
            }}
          >
            <LogOut size={16} />
            退出登录
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="mobile-menu"
            aria-label="打开导航"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={20} />
          </button>
          <div className="breadcrumb">
            工作空间 <span>/</span>
            <strong>{title}</strong>
          </div>
          <span className="top-user">
            <span className="status-dot" />
            {me.username}
          </span>
        </header>
        <main
          className={"content" + (target ? " inspection-view" : "")}
          key={route}
        >
          {target && (
            <aside className="notice inspection-banner">
              <strong>只读查看：{target} 的大肥鱼</strong>
              <p>可查看状态、记忆、足迹和配置，不能修改、删除或控制运行。</p>
              <a href="/admin">← 返回站点管理</a>
            </aside>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">DAFEIYU / WORKSPACE</span>
              <h1>{title}</h1>
              <p>
                {location.pathname === "/account"
                  ? "你的大肥鱼，她的每一天都从这里开始。"
                  : "在这里了解她，也给她一点成长的方向。"}
              </p>
            </div>
            <span className="date">
              {new Date().toLocaleDateString("zh-CN", {
                month: "long",
                day: "numeric",
                weekday: "long",
              })}
            </span>
          </div>
          {location.pathname === "/admin" ? (
            <Admin notify={notify} />
          ) : location.pathname === "/panel" ? (
            <Panel
              page={location.hash.slice(1).split("?")[0] || "overview"}
              notify={notify}
            />
          ) : (
            <Account
              me={me}
              tab={location.hash.slice(1) || "overview"}
              notify={notify}
            />
          )}
        </main>
        <footer>
          大肥鱼工作空间 <span>属于你们的日常。</span>
        </footer>
      </div>
      {toast && (
        <div className="toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
    </div>
  );
}

export default App;
