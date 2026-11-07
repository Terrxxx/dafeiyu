import {
  defaultLoginMailTemplate,
  defaultRegistrationMailTemplate,
  defaultPasswordMailTemplate,
  defaultMailTemplate,
  normalizeMailTemplate,
  renderMailTemplate,
  mailVariables,
} from "./mail-template.js";
import nodemailer from "nodemailer";
import { hash } from "./accounts.js";
import { emailAddress } from "./email-address.js";
const defaults = {
  registrationMode: "invite",
  emailActivation: true,
  publicUrl: "https://dafeiyu.yrxs.net",
  mailTemplate: defaultMailTemplate,
  loginMailTemplate: defaultLoginMailTemplate,
  registrationMailTemplate: defaultRegistrationMailTemplate,
  passwordMailTemplate: defaultPasswordMailTemplate,
  captcha: {
    loginEnabled: false,
    registrationEnabled: true,
    passwordEnabled: false,
    mode: "alphanumeric",
    length: 6,
    noiseDots: true,
    strongDots: false,
    interferenceLines: false,
    interferenceText: false,
    hollowLines: false,
    waveLines: false,
  },
  smtp: {
    host: "",
    port: 465,
    encryption: "tls",
    user: "",
    password: "",
    from: "",
    senderName: "大肥鱼",
  },
};
export class SiteSettings {
  constructor(accounts, { createTransport = nodemailer.createTransport } = {}) {
    Object.assign(this, { accounts, createTransport });
  }
  read() {
    const row = this.accounts.db
      .prepare("SELECT value FROM settings WHERE key='site'")
      .get();
    if (!row) return structuredClone(defaults);
    const v = JSON.parse(row.value);
    return {
      ...defaults,
      ...v,
      emailActivation: true,
      mailTemplate: { ...defaultMailTemplate, ...v.mailTemplate },
      loginMailTemplate: {
        ...defaultLoginMailTemplate,
        ...v.loginMailTemplate,
      },
      registrationMailTemplate: {
        ...defaultRegistrationMailTemplate,
        ...v.registrationMailTemplate,
      },
      passwordMailTemplate: {
        ...defaultPasswordMailTemplate,
        ...v.passwordMailTemplate,
      },
      captcha: { ...defaults.captcha, ...v.captcha },
      smtp: {
        ...defaults.smtp,
        ...(v.smtp ? this.accounts.decrypt(v.smtp, "site-smtp") : {}),
      },
    };
  }
  revision() {
    return hash(
      this.accounts.db
        .prepare("SELECT value FROM settings WHERE key='site'")
        .get()?.value || "initial",
    );
  }
  public() {
    const v = this.read();
    return {
      registrationMode: v.registrationMode,
      emailActivation: v.emailActivation,
      captcha: {
        loginEnabled: v.captcha.loginEnabled,
        registrationEnabled: v.captcha.registrationEnabled,
        passwordEnabled: v.captcha.passwordEnabled,
      },
    };
  }
  safe() {
    const v = this.read();
    const { password, ...smtp } = v.smtp;
    return {
      ...v,
      revision: this.revision(),
      smtp: { ...smtp, passwordSet: !!password },
    };
  }
  configured(v = this.read()) {
    return !!(v.smtp.host && v.smtp.from && (!v.smtp.user || v.smtp.password));
  }
  save(body, actor) {
    if (body.revision !== this.revision())
      throw Object.assign(Error("站点设置已变化，请刷新后重试"), {
        status: 409,
      });
    const previous = this.read();
    const captcha = { ...previous.captcha, ...body.captcha };
    if (
      !["digits", "alphanumeric"].includes(captcha.mode) ||
      !Number.isInteger(captcha.length) ||
      captcha.length < 4 ||
      captcha.length > 8 ||
      [
        "loginEnabled",
        "registrationEnabled",
        "passwordEnabled",
        "noiseDots",
        "strongDots",
        "interferenceLines",
        "interferenceText",
        "hollowLines",
        "waveLines",
      ].some((key) => typeof captcha[key] !== "boolean")
    )
      throw Error("验证码设置无效：长度需为4–8位，开关须为布尔值");
    if (
      !["closed", "open", "invite"].includes(body.registrationMode) ||
      body.emailActivation !== true
    )
      throw Error("注册方式或邮件激活开关无效");
    const url = new URL(body.publicUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      throw Error("站点地址须为HTTPS域名，不包含路径、参数或凭据");
    const incoming = body.smtp || {},
      smtp = { ...previous.smtp };
    for (const k of ["host", "user", "from", "senderName", "encryption"])
      if (incoming[k] !== undefined) {
        if (
          typeof incoming[k] !== "string" ||
          incoming[k].length > 254 ||
          /[\r\n\0]/.test(incoming[k])
        )
          throw Error("发信设置格式无效");
        smtp[k] = incoming[k].trim();
      }
    if (incoming.port !== undefined) smtp.port = incoming.port;
    if (incoming.clearPassword === true) smtp.password = "";
    if (incoming.password) {
      if (
        typeof incoming.password !== "string" ||
        incoming.password.length > 1024 ||
        /[\r\n\0]/.test(incoming.password)
      )
        throw Error("SMTP密码格式无效");
      smtp.password = incoming.password;
    }
    if (
      !Number.isInteger(smtp.port) ||
      smtp.port < 1 ||
      smtp.port > 65535 ||
      !["tls", "starttls"].includes(smtp.encryption) ||
      /[\s/@\\]/.test(smtp.host)
    )
      throw Error("SMTP主机、端口或加密方式无效");
    if (smtp.from) smtp.from = emailAddress(smtp.from);
    const value = {
      registrationMode: body.registrationMode,
      emailActivation: true,
      publicUrl: url.origin,
      mailTemplate: normalizeMailTemplate(
        body.mailTemplate ?? previous.mailTemplate,
      ),
      loginMailTemplate: normalizeMailTemplate(
        body.loginMailTemplate ?? previous.loginMailTemplate,
        { kind: "login" },
      ),
      registrationMailTemplate: normalizeMailTemplate(
        body.registrationMailTemplate ?? previous.registrationMailTemplate,
        { kind: "registration" },
      ),
      passwordMailTemplate: normalizeMailTemplate(
        body.passwordMailTemplate ?? previous.passwordMailTemplate,
        { kind: "password" },
      ),
      captcha,
      smtp,
    };
    if (value.registrationMode !== "closed" && !this.configured(value))
      throw Error("请先填写完整邮箱发信设置，再开放注册");
    this.accounts.db
      .prepare(
        "INSERT INTO settings(key,value) VALUES('site',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(
        JSON.stringify({
          ...value,
          smtp: this.accounts.encrypt(smtp, "site-smtp"),
        }),
      );
    this.accounts.audit(actor, "site-settings-update");
    return this.safe();
  }
  transport() {
    const v = this.read();
    if (!this.configured(v))
      throw Object.assign(Error("站点尚未配置邮箱发信，请联系管理员"), {
        status: 503,
      });
    return this.createTransport({
      host: v.smtp.host,
      port: v.smtp.port,
      secure: v.smtp.encryption === "tls",
      requireTLS: v.smtp.encryption === "starttls",
      auth: v.smtp.user
        ? { user: v.smtp.user, pass: v.smtp.password }
        : undefined,
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 20000,
      logger: false,
      debug: false,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
  async send(to, subject, text, html) {
    to = emailAddress(to);
    const v = this.read(),
      transport = this.transport();
    try {
      await transport.verify();
      const info = await transport.sendMail({
        from: { name: v.smtp.senderName, address: v.smtp.from },
        to,
        subject,
        text,
        ...(html ? { html } : {}),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (
        info.rejected?.length ||
        (info.accepted && info.accepted.length === 0)
      )
        throw Error("SMTP_REJECTED");
      return { accepted: true };
    } catch (e) {
      throw Object.assign(
        Error(
          e.code === "EAUTH"
            ? "邮箱发信认证失败，请检查SMTP账号与授权码"
            : "邮件发送失败，请管理员检查SMTP连接、发件地址与发信权限",
        ),
        { status: 503 },
      );
    } finally {
      transport.close?.();
    }
  }
  preview(template, kind = "verification") {
    const settings = this.read();
    return renderMailTemplate(
      template ??
        (kind === "login"
          ? settings.loginMailTemplate
          : kind === "registration"
            ? settings.registrationMailTemplate
            : kind === "password"
              ? settings.passwordMailTemplate
              : settings.mailTemplate),
      {
        ...mailVariables(
          settings,
          "示例用户",
          settings.publicUrl + "/verify-email#preview-only",
          "test",
        ),
        login_code: "123456",
        expires_minutes: "10",
      },
      { requireLink: false, kind },
    );
  }
  async testMessage(email, kind = "verification") {
    const settings = this.read(),
      message = renderMailTemplate(
        kind === "login"
          ? settings.loginMailTemplate
          : kind === "registration"
            ? settings.registrationMailTemplate
            : kind === "password"
              ? settings.passwordMailTemplate
              : settings.mailTemplate,
        {
          ...mailVariables(
            settings,
            "测试用户",
            settings.publicUrl + "/verify-email#preview-only",
            "test",
          ),
          login_code: "123456",
          expires_minutes: "10",
        },
        { kind },
      );
    return this.send(
      email,
      "【测试】" + message.subject,
      message.text,
      message.html,
    );
  }
  async loginCode(name, email, code) {
    const settings = this.read(),
      message = renderMailTemplate(
        settings.loginMailTemplate,
        {
          site_name: settings.smtp.senderName || "大肥鱼",
          username: name,
          login_code: code,
          expires_minutes: "10",
        },
        { kind: "login" },
      );
    return this.send(email, message.subject, message.text, message.html);
  }
  async registrationCode(name, email, code) {
    const settings = this.read(),
      message = renderMailTemplate(
        settings.registrationMailTemplate,
        {
          site_name: settings.smtp.senderName || "大肥鱼",
          username: name,
          login_code: code,
          expires_minutes: "10",
        },
        { kind: "registration" },
      );
    return this.send(email, message.subject, message.text, message.html);
  }
  async passwordCode(name, email, code) {
    const settings = this.read(),
      message = renderMailTemplate(
        settings.passwordMailTemplate,
        {
          site_name: settings.smtp.senderName || "大肥鱼",
          username: name,
          login_code: code,
          expires_minutes: "10",
        },
        { kind: "password" },
      );
    return this.send(email, message.subject, message.text, message.html);
  }
  async verification(name, email, purpose) {
    const value = this.accounts.emailToken(name, email, purpose),
      settings = this.read(),
      link = settings.publicUrl + "/verify-email#" + value;
    const message = renderMailTemplate(
      settings.mailTemplate,
      mailVariables(settings, name, link, purpose),
    );
    return this.send(email, message.subject, message.text, message.html);
  }
}
