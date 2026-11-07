import MailTemplateEditor from "./MailTemplateEditor.jsx";
// Primary action: save registration and SMTP configuration. Secondary: explicitly send one test mail. Reuse existing cards, switches, two-column forms and theme tokens.
import React, { useState } from "react";
import { api, useData, Card, Field, Form, Empty, ErrorBox } from "./shared.jsx";
export default function SiteSettings({
  notify,
  mailOnly = false,
  section = "general",
}) {
  const [templateKind, setTemplateKind] = useState("verification");
  const [v, load, error, set] = useData("/admin/settings");
  if (error) return <ErrorBox>{error}</ErrorBox>;
  if (!v) return <Empty>正在读取站点设置…</Empty>;
  const update = (key, value) => set({ ...v, [key]: value }),
    smtp = (key, value) => set({ ...v, smtp: { ...v.smtp, [key]: value } }),
    captcha = (key, value) =>
      set({ ...v, captcha: { ...v.captcha, [key]: value } });
  return (
    <div className="stack">
      {section === "general" && (
        <Card title="注册设置">
          <Form
            submit={async () => {
              set(await api("/admin/settings", v));
              notify("站点设置已保存，新注册立即使用新规则");
            }}
          >
            <label className="field">
              <span>新用户注册方式</span>
              <select
                aria-label="新用户注册方式"
                disabled={mailOnly}
                value={v.registrationMode}
                onChange={(e) => update("registrationMode", e.target.value)}
              >
                <option value="closed">不允许注册</option>
                <option value="open">正常注册</option>
                <option value="invite">邀请码注册</option>
              </select>
            </label>
            <p className="muted">
              所有新账号先通过邮箱验证码，再设置密码完成注册。未绑定邮箱的旧账号须先完成绑定才能使用功能。
            </p>
            <label className="switch-row">
              <div>
                <strong>邮件激活</strong>
                <small>
                  注册必经步骤。新用户需先输入邮箱验证码才能设置密码，请先配置并测试邮箱发信。
                </small>
              </div>
              <input
                type="checkbox"
                aria-label="邮件激活"
                disabled
                checked
                readOnly
              />
            </label>
            <Field
              label="站点公开地址"
              type="url"
              required
              value={v.publicUrl}
              onChange={(e) => update("publicUrl", e.target.value)}
              hint="用于生成邮件链接，须为HTTPS域名。"
            />
            <button className="primary" disabled={mailOnly}>
              保存站点设置
            </button>
          </Form>
        </Card>
      )}
      {section === "email" && (
        <Card title="邮箱发信设置" subtitle="管理 SMTP 发信与邮件正文模板。">
          <Form
            submit={async () => {
              set(await api("/admin/settings", v));
              notify("邮箱设置已保存");
            }}
          >
            <div className="form-grid">
              <Field
                label="SMTP主机"
                value={v.smtp.host}
                onChange={(e) => smtp("host", e.target.value)}
              />
              <Field
                label="SMTP端口"
                type="number"
                min={1}
                max={65535}
                value={v.smtp.port}
                onChange={(e) => smtp("port", Number(e.target.value))}
              />
            </div>
            <label className="field">
              <span>连接加密</span>
              <select
                aria-label="连接加密"
                value={v.smtp.encryption}
                onChange={(e) => smtp("encryption", e.target.value)}
              >
                <option value="tls">SSL/TLS（通常465）</option>
                <option value="starttls">STARTTLS（通常587）</option>
              </select>
            </label>
            <div className="form-grid">
              <Field
                label="SMTP账号"
                autoComplete="off"
                value={v.smtp.user}
                onChange={(e) => smtp("user", e.target.value)}
              />
              <Field
                label="SMTP密码或授权码"
                type="password"
                autoComplete="new-password"
                value={v.smtp.password || ""}
                placeholder={v.smtp.passwordSet ? "已保存，留空保留" : "未设置"}
                onChange={(e) => smtp("password", e.target.value)}
              />
              <Field
                label="发件邮箱"
                type="email"
                value={v.smtp.from}
                onChange={(e) => smtp("from", e.target.value)}
              />
              <Field
                label="发件人名称"
                value={v.smtp.senderName}
                onChange={(e) => smtp("senderName", e.target.value)}
              />
            </div>
            <div className="template-kind">
              <h3>邮件内容设置</h3>
              <div className="tabs" role="tablist" aria-label="邮件模板类型">
                {[
                  ["verification", "激活与绑定邮件"],
                  ["login", "登录验证码邮件"],
                  ["registration", "注册验证码邮件"],
                  ["password", "改密验证码邮件"],
                ].map(([key, label]) => (
                  <button
                    type="button"
                    role="tab"
                    aria-selected={templateKind === key}
                    key={key}
                    onClick={() => setTemplateKind(key)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <MailTemplateEditor
              key={templateKind}
              kind={templateKind}
              value={
                templateKind === "login"
                  ? v.loginMailTemplate
                  : templateKind === "registration"
                    ? v.registrationMailTemplate
                    : templateKind === "password"
                      ? v.passwordMailTemplate
                      : v.mailTemplate
              }
              onChange={(template) =>
                update(
                  templateKind === "login"
                    ? "loginMailTemplate"
                    : templateKind === "registration"
                      ? "registrationMailTemplate"
                      : templateKind === "password"
                        ? "passwordMailTemplate"
                        : "mailTemplate",
                  template,
                )
              }
            />
            <button className="primary">保存邮箱设置</button>
          </Form>
        </Card>
      )}
      {section === "captcha" && (
        <Card
          title="验证码设置"
          subtitle="站内图形验证；邮箱验证码仍由邮件发送。保存后立即生效。"
        >
          <Form
            submit={async () => {
              set(await api("/admin/settings", v));
              notify("验证码设置已保存");
            }}
          >
            <div className="form-grid">
              {[
                [
                  "loginEnabled",
                  "登录图形验证",
                  "密码登录和发送登录邮件验证码前进行验证",
                ],
                [
                  "registrationEnabled",
                  "注册图形验证",
                  "发送注册邮件验证码前进行验证",
                ],
                [
                  "passwordEnabled",
                  "改密图形验证",
                  "发送修改密码邮件验证码前进行验证",
                ],
              ].map(([key, label, description]) => (
                <label className="switch-row" key={key}>
                  <div>
                    <strong>{label}</strong>
                    <small>{description}</small>
                  </div>
                  <input
                    type="checkbox"
                    disabled={mailOnly}
                    checked={v.captcha[key]}
                    onChange={(e) => captcha(key, e.target.checked)}
                  />
                </label>
              ))}
            </div>
            <h3>图形验证码</h3>
            <div className="form-grid">
              <label className="field">
                <span>验证码类型</span>
                <select disabled>
                  <option>站内图片</option>
                </select>
              </label>
              <label className="field">
                <span>模式</span>
                <select
                  value={v.captcha.mode}
                  disabled={mailOnly}
                  onChange={(e) => captcha("mode", e.target.value)}
                >
                  <option value="digits">数字</option>
                  <option value="alphanumeric">数字＋字母</option>
                </select>
              </label>
              <Field
                label="长度"
                type="number"
                min={4}
                max={8}
                value={v.captcha.length}
                disabled={mailOnly}
                onChange={(e) => captcha("length", Number(e.target.value))}
                hint="4–8 位"
              />
            </div>
            <div className="form-grid">
              {[
                ["noiseDots", "使用噪点"],
                ["strongDots", "加强干扰点"],
                ["interferenceLines", "加强干扰线"],
                ["hollowLines", "使用空心线"],
                ["interferenceText", "使用干扰文字"],
                ["waveLines", "使用波浪线"],
              ].map(([key, label]) => (
                <label className="switch-row" key={key}>
                  <strong>{label}</strong>
                  <input
                    type="checkbox"
                    disabled={mailOnly}
                    checked={v.captcha[key]}
                    onChange={(e) => captcha(key, e.target.checked)}
                  />
                </label>
              ))}
            </div>
            <button className="primary" disabled={mailOnly}>
              保存验证码设置
            </button>
          </Form>
        </Card>
      )}
      {section === "email" && (
        <Card
          title="测试发信"
          subtitle="先保存发信设置，再向你填写的邮箱发送一封测试邮件。"
        >
          <Form
            submit={async (values) => {
              const r = await api("/admin/settings/test-email", values);
              notify(r.message);
            }}
          >
            <label className="field">
              <span>测试邮件类型</span>
              <select name="kind" aria-label="测试邮件类型">
                <option value="verification">激活与绑定邮件</option>
                <option value="login">登录验证码邮件</option>
                <option value="registration">注册验证码邮件</option>
                <option value="password">改密验证码邮件</option>
              </select>
            </label>
            <Field label="测试收件邮箱" name="email" type="email" required />
            <button>发送测试邮件</button>
          </Form>
        </Card>
      )}
    </div>
  );
}
