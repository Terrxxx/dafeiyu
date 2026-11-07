import React, { useState } from "react";
import { api, Field, Form, Theme } from "./shared.jsx";
function Frame({ children }) {
  return (
    <div className="auth">
      <header>
        <a href="/login" className="brand">
          大肥鱼 · 账户验证
        </a>
        <Theme />
      </header>
      <main className="email-activation auth-box">{children}</main>
    </div>
  );
}
export function ResendActivation({ username = "" }) {
  const [message, set] = useState("");
  return (
    <details className="resend-email">
      <summary>没有收到激活邮件？</summary>
      <Form
        submit={async (body) => {
          const r = await api("/auth/resend-email", body);
          set(r.message);
        }}
      >
        <Field
          label="待激活用户名"
          name="username"
          required
          defaultValue={username}
        />
        <Field
          label="待激活账号密码"
          name="password"
          type="password"
          required
          autoComplete="current-password"
        />
        <button>重新发送激活邮件</button>
      </Form>
      {message && <p role="status">{message}</p>}
    </details>
  );
}
export function PendingActivation({ value }) {
  return (
    <Frame>
      <h1>请激活邮箱</h1>
      <p>{value.message}</p>
      <p>{value.email}</p>
      <p className="muted">
        请查看收件箱和垃圾邮件。验证链接24小时有效，验证后再登录。
      </p>
      <ResendActivation username={value.username} />
      <a href="/login">返回登录</a>
    </Frame>
  );
}
export function EmailVerify() {
  const [done, set] = useState(false);
  return (
    <Frame>
      <h1>{done ? "邮箱已验证" : "验证你的邮箱"}</h1>
      {done ? (
        <>
          <p>邮箱验证已完成，可以正常登录。</p>
          <a href="/login">前往登录</a>
        </>
      ) : (
        <>
          <p>确认后完成账号激活或邮箱绑定。</p>
          <Form
            submit={async () => {
              await api("/auth/verify-email", {
                token: location.hash.slice(1),
              });
              history.replaceState(null, "", location.pathname);
              set(true);
            }}
          >
            <button className="primary">确认验证邮箱</button>
          </Form>
        </>
      )}
    </Frame>
  );
}
