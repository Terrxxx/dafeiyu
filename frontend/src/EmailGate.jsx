// The binding task is primary; logout is secondary. Unbound administrators only get mail configuration to avoid a bootstrap deadlock.
import React, { useEffect } from "react";
import { api, BrandIcon, Theme } from "./shared.jsx";
import EmailSettings from "./EmailSettings.jsx";
import SiteSettings from "./SiteSettings.jsx";
export default function EmailGate({ me, notify, message }) {
  useEffect(() => {
    const timer = setInterval(async () => {
      try {
        const value = await api("/auth/me");
        if (value.authenticated && !value.emailRequired)
          location.href = "/account";
      } catch {}
    }, 10000);
    return () => clearInterval(timer);
  }, []);
  const mailOnly = me.role === "admin" && location.hash === "#smtp";
  return (
    <div className="auth email-lock">
      <header>
        <a href="/bind-email" className="brand">
          <BrandIcon />
          大肥鱼 · 邮箱绑定
        </a>
        <div className="actions">
          <Theme />
          <button
            onClick={async () => {
              await api("/auth/logout", {});
              location.href = "/login";
            }}
          >
            退出登录
          </button>
        </div>
      </header>
      <main className="email-gate">
        <h1>请先绑定邮箱</h1>
        <p>
          完成邮箱验证后才能使用各项功能。大肥鱼后台已暂停，记忆和数据保留；绑定后可手动重新启动。
        </p>
        {me.role === "admin" && (
          <nav className="tabs">
            <a href="/bind-email">绑定邮箱</a>
            <a href="/bind-email#smtp">配置邮箱发信</a>
          </nav>
        )}
        {mailOnly ? (
          <SiteSettings notify={notify} mailOnly section="email" />
        ) : (
          <EmailSettings notify={notify} />
        )}
      </main>
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </div>
  );
}
