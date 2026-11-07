/* React owns all views and state. Primary: current state/next action. Secondary: records.
 Existing navy/blue tokens; 4/8/12/16/24/32 spacing; restrained surfaces. */
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
let csrf = "",
  dirty = false;
addEventListener("beforeunload", (e) => {
  if (dirty) {
    e.preventDefault();
    e.returnValue = "";
  }
});
document.addEventListener("click", (e) => {
  const link = e.target.closest("a[href]");
  if (
    !link ||
    e.defaultPrevented ||
    e.button !== 0 ||
    e.metaKey ||
    e.ctrlKey ||
    e.shiftKey ||
    e.altKey ||
    link.target ||
    link.download
  )
    return;
  const url = new URL(link.href);
  if (
    url.origin !== location.origin ||
    ![
      "/account",
      "/panel",
      "/admin",
      "/login",
      "/register",
      "/activate",
      "/verify-email",
      "/bind-email",
    ].includes(url.pathname)
  )
    return;
  if (
    dirty &&
    url.href !== location.href &&
    !confirm("有未保存的修改，仍要离开吗？")
  ) {
    e.preventDefault();
    return;
  }
  e.preventDefault();
  dirty = false;
  history.pushState(null, "", url);
  dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo({ top: 0 });
});
const dataCache = new Map();
const panelTokens = new Map();
export function inspectionTarget() {
  return location.pathname === "/panel"
    ? new URLSearchParams(location.search).get("tenant") || ""
    : "";
}
export function panelLink(href) {
  const target = inspectionTarget();
  if (!target || !href.startsWith("/panel")) return href;
  const url = new URL(href, location.origin);
  url.searchParams.set("tenant", target);
  return url.pathname + url.search + url.hash;
}
function requestPath(url, target = inspectionTarget()) {
  if (!target) return url;
  const base = "/admin/tenants/" + encodeURIComponent(target);
  if (url.startsWith("/api/")) return base + url;
  if (url.startsWith("/account/qq/groups"))
    return (
      base + "/qq/groups" + (url.includes("?") ? "?" + url.split("?")[1] : "")
    );
  return url;
}
export async function api(url, body) {
  const target = inspectionTarget();
  if (target && body !== undefined && url.startsWith("/api/"))
    throw Error("管理员查看模式为只读，不能修改此大肥鱼");
  const path = requestPath(url, target),
    key = target || "own";
  if (url.startsWith("/api/") && !panelTokens.has(key)) {
    const response = await fetch(requestPath("/api/session", target)),
      value = await response.json();
    if (!response.ok) throw Error(value.error);
    panelTokens.set(key, value.token);
  }
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(body !== undefined
        ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
        : {}),
      ...(url.startsWith("/api/")
        ? { "X-Panel-Token": panelTokens.get(key) }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  if (!response.ok) {
    if (value.code === "EMAIL_REQUIRED" && location.pathname !== "/bind-email")
      location.href = "/bind-email";
    throw Error(value.error || "请求失败");
  }
  if (body === undefined) dataCache.set(path, value);
  return value;
}
export function useData(url, interval = 0) {
  const cacheKey = requestPath(url);
  const [data, set] = useState(() => dataCache.get(cacheKey) || null),
    [error, err] = useState("");
  const load = useCallback(async () => {
    try {
      set(await api(url));
      err("");
    } catch (e) {
      err(e.message);
    }
  }, [url, cacheKey]);
  useEffect(() => {
    if (dataCache.has(cacheKey)) set(dataCache.get(cacheKey));
    load();
    if (interval) {
      const t = setInterval(() => {
        if (!document.hidden) load();
      }, interval);
      return () => clearInterval(t);
    }
  }, [load, interval, cacheKey]);
  return [data, load, error, set];
}
export const time = (v) =>
  v ? new Date(v).toLocaleString("zh-CN") : "暂无记录";
export const fmt = (v) => (v == null ? "—" : Math.round(v));
export function Field({ label, hint, className, ...p }) {
  return (
    <label className={className || "field"}>
      <span>{label}</span>
      <input aria-label={label} {...p} />
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Card({ title, subtitle, children, className = "" }) {
  return (
    <section className={"card " + className}>
      {title && (
        <div className="card-heading">
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}
export function Empty({ children = "暂无记录" }) {
  return (
    <div className="empty">
      <Fish size={28} />
      <p>{children}</p>
    </div>
  );
}
export function ErrorBox({ children }) {
  return children ? (
    <div className="notice error" role="alert">
      {children}
    </div>
  ) : null;
}
export function Form({ submit, children, id, onBusy, disabled = false }) {
  const [busy, b] = useState(false),
    [error, err] = useState("");
  return (
    <form
      id={id}
      onChange={() => {
        if (!inspectionTarget()) dirty = true;
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (inspectionTarget()) {
          err("管理员查看模式为只读");
          return;
        }
        const v = Object.fromEntries(new FormData(e.currentTarget));
        b(true);
        onBusy?.(true);
        err("");
        try {
          await submit(v);
          dirty = false;
        } catch (e) {
          err(e.message);
        } finally {
          b(false);
          onBusy?.(false);
        }
      }}
    >
      <fieldset disabled={busy || disabled || !!inspectionTarget()}>
        {children}
      </fieldset>
      <ErrorBox>{error}</ErrorBox>
    </form>
  );
}
export function Ring({ value, label, precision = 0 }) {
  const n = Number(value) || 0,
    f = Math.min(1, Math.abs(n) / 100),
    angle = f * Math.PI * 2;
  const x = 40 + 33 * Math.sin(angle),
    y = 40 - 33 * Math.cos(angle);
  const path =
    f >= 1
      ? "M40 7a33 33 0 1 1 0 66a33 33 0 1 1 0-66"
      : `M40 40L40 7A33 33 0 ${f > 0.5 ? 1 : 0} 1 ${x} ${y}Z`;
  return (
    <div className="ring-wrap">
      <svg
        className="pie"
        viewBox="0 0 80 80"
        aria-label={label + " " + Number(value || 0).toFixed(precision)}
      >
        <circle cx="40" cy="40" r="33" className="pie-track" />
        {f > 0 && (
          <path
            d={path}
            className={n < 0 ? "pie-sector negative" : "pie-sector"}
          />
        )}
        <circle cx="40" cy="40" r="22" className="pie-center" />
        <text x="40" y="46" style={{ fontSize: precision ? 14 : 19 }}>
          {Number(value || 0).toFixed(precision)}
        </text>
      </svg>
      <small>{label}</small>
    </div>
  );
}
export function Risk() {
  return (
    <aside className="notice risk">
      <strong>QQ 账号风险提示</strong>
      <p>
        QQ
        账号可能因自动化操作被风控、限制功能或封禁。请自行评估并承担使用风险；由此造成的账号损失，我们概不负责。
      </p>
    </aside>
  );
}
export function Theme() {
  const [v, set] = useState(localStorage.getItem("dfy-theme") || "system");
  useEffect(() => {
    document.documentElement.dataset.theme = v;
    localStorage.setItem("dfy-theme", v);
  }, [v]);
  return (
    <label className="theme">
      {v === "dark" ? <Moon size={16} /> : <Sun size={16} />}
      <select
        aria-label="外观主题"
        value={v}
        onChange={(e) => set(e.target.value)}
      >
        <option value="system">跟随系统</option>
        <option value="light">浅色模式</option>
        <option value="dark">暗黑模式</option>
      </select>
    </label>
  );
}

export const setCSRF = (value) => {
  csrf = value;
};
export const markClean = () => {
  dirty = false;
};
export function Metric({ label, value, hint }) {
  return (
    <div
      className={
        "metric " +
        (typeof value === "string"
          ? /未|停止|不足/.test(value)
            ? "state-bad"
            : /已|运行/.test(value)
              ? "state-good"
              : ""
          : "")
      }
    >
      <div>
        <small>{label}</small>
        <Activity size={18} />
      </div>
      <strong>{value}</strong>
      <span>{hint}</span>
    </div>
  );
}

export function BrandIcon({ size = 24, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M10 15 3 11v18l7-4" fill="currentColor" opacity=".35" />
      <path
        d="M24 9c-8-1-15 4-15 12s7 12 15 11c7-1 12-6 13-11C36 15 31 10 24 9Z"
        fill="currentColor"
      />
      <path d="m19 10 4-5 5 6M19 31l4 4 5-5" fill="currentColor" opacity=".5" />
      <circle cx="29" cy="18" r="2" fill="var(--surface,#fff)" />
      <path
        d="M29 25q-4 3-7 0"
        stroke="var(--surface,#fff)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}

export const markDirty=()=>{dirty=true;};
