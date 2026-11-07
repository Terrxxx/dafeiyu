import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startManager } from "../manager/server.js";
import { SiteSettings } from "../manager/site-settings.js";
import { passwordHash, hash } from "../manager/accounts.js";
async function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "dfy-email-")),
    sent = [],
    options = [];
  let fail = false;
  const manager = await startManager({
    dataRoot: directory,
    port: 0,
    origins: [],
    runtime: async () => ({ phase: "stopped" }),
    mailerFactory: (config) => {
      options.push(config);
      return {
        verify: async () => {
          if (fail)
            throw Object.assign(Error("secret SMTP failure"), {
              code: "EAUTH",
            });
        },
        sendMail: async (mail) => {
          sent.push(mail);
          return { accepted: [mail.to] };
        },
        close() {},
      };
    },
  });
  t.after(async () => {
    await manager.close();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  manager.accounts.db
    .prepare(
      "INSERT INTO users(username,password,role,created,email) VALUES(?,?,?,?,lower(hex(randomblob(8)))||char(64,101,120,97,109,112,108,101,46,116,101,115,116))",
    )
    .run(
      "owner",
      await passwordHash("owner-password-123"),
      "admin",
      Date.now(),
    );
  manager.accounts.db
    .prepare("UPDATE users SET email=? WHERE username=?")
    .run("owner@example.test", "owner");
  const session = manager.accounts.session("owner"),
    base = "http://127.0.0.1:" + manager.server.address().port;
  const post = (url, body, auth = false) =>
    fetch(base + url, {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(auth
          ? {
              Cookie: "dfy_session=" + session.value,
              "X-CSRF-Token": session.csrf,
            }
          : {}),
      },
      body: JSON.stringify(body),
    });
  const get = (url, auth = false) =>
    fetch(base + url, {
      headers: auth ? { Cookie: "dfy_session=" + session.value } : {},
    });
  const site = new SiteSettings(manager.accounts);
  const settings = ({ mode = "open", activation = true } = {}) =>
    site.save(
      {
        ...site.safe(),
        registrationMode: mode,
        emailActivation: activation,
        smtp: {
          host: "smtp.example.test",
          port: 465,
          encryption: "tls",
          user: "mailer@example.test",
          password: "smtp-secret-value",
          from: "mailer@example.test",
          senderName: "大肥鱼",
        },
      },
      "owner",
    );
  const body = (name = "alice") => ({
    username: name,
    email: name + "@example.test",
    password: "registration-password-123",
    passwordConfirm: "registration-password-123",
  });
  return {
    directory,
    manager,
    sent,
    options,
    post,
    get,
    site,
    settings,
    body,
    base,
    setFail: (v) => (fail = v),
  };
}
import { LoginCodes } from "../manager/login-codes.js";
import {
  defaultLoginMailTemplate,
  normalizeMailTemplate,
  renderMailTemplate,
} from "../manager/mail-template.js";
test("用户名和邮箱均可密码登录，邮箱忽略大小写，待激活与禁用不能登录", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.post("/auth/login", {
        username: "owner",
        password: "owner-password-123",
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await f.post("/auth/login", {
        username: "OWNER@EXAMPLE.TEST",
        password: "owner-password-123",
      })
    ).status,
    200,
  );
  f.manager.accounts.db
    .prepare("UPDATE users SET email_pending=1 WHERE username=?")
    .run("owner");
  assert.equal(
    (
      await f.post("/auth/login", {
        username: "owner@example.test",
        password: "owner-password-123",
      })
    ).status,
    403,
  );
  f.manager.accounts.db
    .prepare("UPDATE users SET email_pending=0,disabled=1 WHERE username=?")
    .run("owner");
  assert.equal(
    (
      await f.post("/auth/login", {
        username: "owner@example.test",
        password: "owner-password-123",
      })
    ).status,
    401,
  );
});
test("邮箱验证码通过模板发信，一次性登录并验证邮箱，数据库不存明文", async (t) => {
  const f = await fixture(t);
  f.settings();
  const requested = await f.post("/auth/login-code/request", {
    email: "OWNER@EXAMPLE.TEST",
  });
  assert.equal(requested.status, 200);
  const result = await requested.json();
  assert.equal(result.retryAfter, 60);
  assert.equal(result.code, undefined);
  assert.equal(f.sent.length, 1);
  const code = f.sent[0].text.match(/验证码为：(\d{6})/)[1];
  assert.ok(f.sent[0].html.includes(code));
  const stored = f.manager.accounts.db
    .prepare("SELECT * FROM login_codes")
    .get();
  assert.notEqual(stored.code_hash, code);
  assert.notEqual(stored.digest, result.challenge);
  const login = await f.post("/auth/login-code/verify", {
    email: "owner@example.test",
    challenge: result.challenge,
    code,
  });
  assert.equal(login.status, 200);
  assert.ok(login.headers.get("set-cookie").includes("HttpOnly"));
  assert.equal(f.manager.accounts.user("owner").email_verified, 1);
  assert.equal(
    (
      await f.post("/auth/login-code/verify", {
        email: "owner@example.test",
        challenge: result.challenge,
        code,
      })
    ).status,
    400,
  );
  assert.equal(
    (await f.post("/auth/login-code/request", { email: "owner@example.test" }))
      .status,
    429,
  );
});
test("验证码持久化冷却、错误计数、过期、换邮箱、重发以及禁用检查", async (t) => {
  const f = await fixture(t);
  let now = Date.now();
  let codes = new LoginCodes(f.manager.accounts, { now: () => now });
  const first = codes.issue("owner@example.test");
  assert.throws(
    () => codes.issue("owner@example.test"),
    (e) => e.status === 429,
  );
  codes = new LoginCodes(f.manager.accounts, { now: () => now });
  assert.throws(
    () => codes.issue("owner@example.test"),
    (e) => e.status === 429,
  );
  assert.throws(() =>
    codes.verify("other@example.test", first.challenge, first.code),
  );
  for (let i = 0; i < 5; i++)
    assert.throws(() =>
      codes.verify(
        "owner@example.test",
        first.challenge,
        first.code === "000000" ? "111111" : "000000",
      ),
    );
  assert.equal(
    f.manager.accounts.db
      .prepare("SELECT attempts FROM login_codes WHERE digest=?")
      .get(hash(first.challenge)).attempts,
    5,
  );
  assert.throws(() =>
    codes.verify("owner@example.test", first.challenge, first.code),
  );
  now += 61000;
  const second = codes.issue("owner@example.test");
  now += 61000;
  const third = codes.issue("owner@example.test");
  assert.throws(() =>
    codes.verify("owner@example.test", second.challenge, second.code),
  );
  f.manager.accounts.db
    .prepare("UPDATE users SET disabled=1 WHERE username=?")
    .run("owner");
  assert.throws(() =>
    codes.verify("owner@example.test", third.challenge, third.code),
  );
  f.manager.accounts.db
    .prepare("UPDATE users SET disabled=0 WHERE username=?")
    .run("owner");
  now += 600001;
  assert.throws(() =>
    codes.verify("owner@example.test", third.challenge, third.code),
  );
});
test("不存在、未激活和停用邮箱统一返回且不发信，来源校验仍有效", async (t) => {
  const f = await fixture(t);
  f.settings();
  const unknown = await f.post("/auth/login-code/request", {
    email: "missing@example.test",
  });
  assert.equal(unknown.status, 200);
  assert.equal(f.sent.length, 0);
  f.manager.accounts.db
    .prepare("UPDATE users SET email_pending=1 WHERE username=?")
    .run("owner");
  const pending = await f.post("/auth/login-code/request", {
    email: "owner@example.test",
  });
  assert.equal(pending.status, 200);
  assert.equal(f.sent.length, 0);
  assert.equal((await pending.json()).message, (await unknown.json()).message);
  const cross = await fetch(f.base + "/auth/login-code/request", {
    method: "POST",
    headers: {
      Origin: "https://evil.test",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email: "owner@example.test" }),
  });
  assert.equal(cross.status, 403);
});
test("登录邮件模板独立保存和预览，测试码不签发登录挑战", async (t) => {
  const f = await fixture(t);
  f.settings();
  const template = {
    ...defaultLoginMailTemplate,
    subject: "{{username}} 的验证码",
    html: "<p><strong>{{login_code}}</strong>，{{expires_minutes}}分钟有效</p>",
    text: "{{login_code}}",
  };
  f.site.save({ ...f.site.safe(), loginMailTemplate: template }, "owner");
  assert.throws(
    () =>
      normalizeMailTemplate(
        { ...template, html: "无验证码" },
        { kind: "login" },
      ),
    /保留/,
  );
  assert.equal(
    renderMailTemplate(
      template,
      { username: "owner", login_code: "012345", expires_minutes: 10 },
      { kind: "login" },
    ).text,
    "012345",
  );
  const preview = await f
    .post("/admin/settings/mail-preview", { kind: "login", template }, true)
    .then((r) => r.json());
  assert.ok(preview.html.includes("123456"));
  assert.equal(
    (
      await f.post(
        "/admin/settings/test-email",
        { kind: "login", email: "owner@example.test" },
        true,
      )
    ).status,
    200,
  );
  assert.equal(
    f.manager.accounts.db.prepare("SELECT count(*) AS n FROM login_codes").get()
      .n,
    0,
  );
  assert.ok(f.sent[0].text.includes("123456"));
  const requested = await f.post("/auth/login-code/request", {
    email: "owner@example.test",
  });
  assert.equal(requested.status, 200);
  assert.equal(f.sent[1].subject, "owner 的验证码");
  assert.equal(
    f.site.read().mailTemplate.subject,
    "{{site_name}} · {{action_label}}",
  );
});
