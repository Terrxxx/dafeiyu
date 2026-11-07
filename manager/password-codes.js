import { randomInt, createHmac, timingSafeEqual } from "node:crypto";
import { hash, token } from "./accounts.js";
const invalid = () =>
  Object.assign(Error("邮箱验证码错误、已过期或尝试次数过多，请重新获取"), {
    status: 400,
  });
export class PasswordCodes {
  constructor(accounts, { now = Date.now } = {}) {
    this.accounts = accounts;
    this.now = now;
    accounts.db.exec(
      "CREATE TABLE IF NOT EXISTS password_codes(digest TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES users(username),code_hash TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS password_verified(digest TEXT PRIMARY KEY,username TEXT NOT NULL REFERENCES users(username),expires INTEGER NOT NULL);",
    );
  }
  signature(digest, code) {
    return createHmac("sha256", this.accounts.key)
      .update("change-password:" + digest + ":" + code)
      .digest("hex");
  }
  issue(name) {
    const now = this.now(),
      id = token(),
      digest = hash(id),
      code = String(randomInt(1000000)).padStart(6, "0");
    this.accounts.transaction(() => {
      this.accounts.db
        .prepare("DELETE FROM password_codes WHERE expires<?")
        .run(now);
      const recent = this.accounts.db
          .prepare(
            "SELECT created FROM password_codes WHERE username=? ORDER BY created DESC LIMIT 1",
          )
          .get(name),
        count = this.accounts.db
          .prepare(
            "SELECT count(*) AS n FROM password_codes WHERE username=? AND created>?",
          )
          .get(name, now - 3600000).n;
      if ((recent && now - recent.created < 60000) || count >= 5)
        throw Object.assign(Error("验证码发送过于频繁，请稍后再试"), {
          status: 429,
        });
      this.accounts.db
        .prepare("UPDATE password_codes SET expires=0 WHERE username=?")
        .run(name);
      this.accounts.db
        .prepare("INSERT INTO password_codes VALUES(?,?,?,?,?,0)")
        .run(digest, name, this.signature(digest, code), now, now + 600000);
    });
    return { challenge: id, code, retryAfter: 60, expiresIn: 600 };
  }
  invalidate(challenge) {
    this.accounts.db
      .prepare("UPDATE password_codes SET expires=0 WHERE digest=?")
      .run(hash(challenge));
  }
  verify(name, challenge, code) {
    if (
      typeof challenge !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(challenge) ||
      typeof code !== "string" ||
      !/^\d{6}$/.test(code)
    )
      throw invalid();
    const proof = this.accounts.transaction(() => {
      const row = this.accounts.db
        .prepare("SELECT * FROM password_codes WHERE digest=? AND username=?")
        .get(hash(challenge), name);
      if (!row || row.expires <= this.now() || row.attempts >= 5) return null;
      this.accounts.db
        .prepare("UPDATE password_codes SET attempts=attempts+1 WHERE digest=?")
        .run(row.digest);
      if (
        !timingSafeEqual(
          Buffer.from(row.code_hash, "hex"),
          Buffer.from(this.signature(row.digest, code), "hex"),
        )
      )
        return null;
      this.accounts.db
        .prepare("DELETE FROM password_codes WHERE digest=?")
        .run(row.digest);
      const value = token();
      this.accounts.db
        .prepare("INSERT INTO password_verified VALUES(?,?,?)")
        .run(hash(value), name, this.now() + 900000);
      return value;
    });
    if (!proof) throw invalid();
    return { proof, expiresIn: 900 };
  }
  assertVerified(name, proof) {
    if (
      typeof proof !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(proof) ||
      !this.accounts.db
        .prepare(
          "SELECT digest FROM password_verified WHERE digest=? AND username=? AND expires>?",
        )
        .get(hash(proof), name, this.now())
    )
      throw invalid();
  }
  consume(proof) {
    this.accounts.db
      .prepare("DELETE FROM password_verified WHERE digest=?")
      .run(hash(proof));
  }
}
