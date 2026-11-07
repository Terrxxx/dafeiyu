import React from "react";
import { api, useData, Card, Field, Form, Empty, ErrorBox } from "./shared.jsx";
export default function EmailSettings({ notify }) {
  const [v, load, error] = useData("/account/email");
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!v) return <Empty>正在读取邮箱…</Empty>;
  if (v.locked)
    return (
      <Card title="账户邮箱">
        <p>
          {v.email} <span className="enabled-text">已验证</span>
        </p>
        <p className="muted">邮箱已绑定，无法更换。</p>
      </Card>
    );
  return (
    <Card
      className="email-settings"
      title="账户邮箱"
      subtitle="请填写邮箱并完成邮件验证。验证绑定成功后不可更换。"
    >
      <p>
        {v.email || "尚未填写邮箱"}{" "}
        <span className={v.verified ? "enabled-text" : "muted"}>
          {v.email ? (v.verified ? "已验证" : "未验证") : ""}
        </span>
      </p>
      {v.pendingEmail && <p className="muted">待验证邮箱：{v.pendingEmail}</p>}
      {!v.mailConfigured && (
        <p className="notice">
          站点尚未配置邮箱发信，请联系管理员；完成绑定前，各项功能将保持锁定。
        </p>
      )}
      <Form
        submit={async (body) => {
          const r = await api("/account/email", body);
          notify(r.message);
          load();
        }}
      >
        <div className="form-grid">
          <Field
            label="邮箱地址"
            name="email"
            type="email"
            required
            defaultValue={v.pendingEmail || v.email}
          />
          <Field
            label="当前密码（验证邮箱）"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <button disabled={!v.mailConfigured}>发送邮箱验证邮件</button>
      </Form>
    </Card>
  );
}
