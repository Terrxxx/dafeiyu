import { randomInt, createHmac, timingSafeEqual } from "node:crypto";
import { hash, token } from "./accounts.js";
import { emailAddress } from "./email-address.js";
const invalid = () =>
  Object.assign(Error("验证码错误、已失效或尝试次数过多，请重新获取"), {
    status: 400,
  });
export class LoginCodes {
  constructor(accounts, { now = Date.now } = {}) {
    this.accounts = accounts;
    this.now = now;
    accounts.db.exec(
      "CREATE TABLE IF NOT EXISTS login_codes(digest TEXT PRIMARY KEY,email TEXT NOT NULL,username TEXT REFERENCES users(username),code_hash TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS login_codes_email_created ON login_codes(email,created);",
    );
  }
  signature(digest, code) {
    return createHmac("sha256", this.accounts.key)
      .update("email-login:" + digest + ":" + code)
      .digest("hex");
  }
  issue(address) {
    const email = emailAddress(address),
      now = this.now(),
      id = token(),
      digest = hash(id),
      code = String(randomInt(1000000)).padStart(6, "0");
    const row = this.accounts.db
      .prepare(
        "SELECT username,disabled,email_pending FROM users WHERE lower(email)=?",
      )
      .get(email);
    this.accounts.transaction(() => {
      this.accounts.db
        .prepare("DELETE FROM login_codes WHERE created<?")
        .run(now - 86400000);
      const recent = this.accounts.db
          .prepare(
            "SELECT created FROM login_codes WHERE email=? ORDER BY created DESC LIMIT 1",
          )
          .get(email),
        count = this.accounts.db
          .prepare(
            "SELECT count(*) AS n FROM login_codes WHERE email=? AND created>?",
          )
          .get(email, now - 3600000).n;
      if ((recent && now - recent.created < 60000) || count >= 5)
        throw Object.assign(Error("验证码发送过于频繁，请稍后再试"), {
          status: 429,
        });
      this.accounts.db
        .prepare("UPDATE login_codes SET expires=0 WHERE email=?")
        .run(email);
      this.accounts.db
        .prepare("INSERT INTO login_codes VALUES(?,?,?,?,?,?,0)")
        .run(
          digest,
          email,
          row && !row.disabled && !row.email_pending ? row.username : null,
          this.signature(digest, code),
          now,
          now + 600000,
        );
    });
    return {
      challenge: id,
      code,
      username:
        row && !row.disabled && !row.email_pending ? row.username : null,
      email,
    };
  }
  invalidate(challenge) {
    this.accounts.db
      .prepare("UPDATE login_codes SET expires=0 WHERE digest=?")
      .run(hash(challenge));
  }
  verify(address, challenge, code) {
    const email = emailAddress(address);
    if (
      typeof challenge !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      typeof code !== "string" ||
      !/^\d{6}$/.test(code)
    )
      throw invalid();
    const name = this.accounts.transaction(() => {
      const row = this.accounts.db
        .prepare("SELECT * FROM login_codes WHERE digest=? AND email=?")
        .get(hash(challenge), email);
      if (!row || row.expires <= this.now() || row.attempts >= 5) return null;
      this.accounts.db
        .prepare("UPDATE login_codes SET attempts=attempts+1 WHERE digest=?")
        .run(row.digest);
      const matches = timingSafeEqual(
          Buffer.from(row.code_hash, "hex"),
          Buffer.from(this.signature(row.digest, code), "hex"),
        ),
        user = row.username && this.accounts.user(row.username);
      if (
        !matches ||
        !user ||
        user.disabled ||
        user.email_pending ||
        user.email?.toLowerCase() !== email
      )
        return null;
      this.accounts.db
        .prepare("UPDATE login_codes SET expires=0 WHERE email=?")
        .run(email);
      this.accounts.db
        .prepare("UPDATE users SET email_verified=1 WHERE username=?")
        .run(user.username);
      this.accounts.audit(user.username, "email-code-login");
      return user.username;
    });
    if (!name) throw invalid();
    return name;
  }
}
