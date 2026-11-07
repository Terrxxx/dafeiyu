import {
  randomBytes,
  randomInt,
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import { deflateSync } from "node:zlib";
import { hash, token, username } from "./accounts.js";
import { emailAddress } from "./email-address.js";

const glyphs = [
  ["11111", "10001", "10011", "10101", "11001", "10001", "11111"],
  ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  ["11111", "00001", "00001", "11111", "10000", "10000", "11111"],
  ["11111", "00001", "00001", "01111", "00001", "00001", "11111"],
  ["10001", "10001", "10001", "11111", "00001", "00001", "00001"],
  ["11111", "10000", "10000", "11111", "00001", "00001", "11111"],
  ["11111", "10000", "10000", "11111", "10001", "10001", "11111"],
  ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  ["11111", "10001", "10001", "11111", "10001", "10001", "11111"],
  ["11111", "10001", "10001", "11111", "00001", "00001", "11111"],
];
const letters = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};
const glyph = (character) =>
  /^[0-9]$/.test(character) ? glyphs[Number(character)] : letters[character];
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let j = 0; j < 8; j++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type),
    size = Buffer.alloc(4),
    crc = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  let value = 0xffffffff;
  for (const byte of Buffer.concat([name, data]))
    value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  crc.writeUInt32BE((value ^ 0xffffffff) >>> 0);
  return Buffer.concat([size, name, data, crc]);
}
function picture(code, settings = {}) {
  const width = 174,
    height = 58,
    pixels = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    pixels[y * (1 + width * 4)] = 0;
    for (let x = 0; x < width; x++) {
      const p = y * (1 + width * 4) + 1 + x * 4;
      pixels[p] = 244;
      pixels[p + 1] = 248;
      pixels[p + 2] = 252;
      pixels[p + 3] = 255;
    }
  }
  const dot = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * (1 + width * 4) + 1 + x * 4;
    pixels[p] = r;
    pixels[p + 1] = g;
    pixels[p + 2] = b;
  };
  for (
    let n = 0;
    n < (settings.strongDots ? 520 : settings.noiseDots ? 210 : 0);
    n++
  )
    dot(
      randomInt(width),
      randomInt(height),
      randomInt(130, 220),
      randomInt(160, 225),
      randomInt(190, 240),
    );
  const line = (x0, y0, x1, y1, r = 155, g = 182, b = 210) => {
    const steps = Math.max(1,Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++)
      dot(
        Math.round(x0 + ((x1 - x0) * i) / steps),
        Math.round(y0 + ((y1 - y0) * i) / steps),
        r,
        g,
        b,
      );
  };
  if (settings.interferenceText)
    for (let n = 0; n < 4; n++) {
      const character = String(randomInt(10)),
        pattern = glyph(character),
        x0 = randomInt(width - 18),
        y0 = randomInt(height - 21);
      for (let row = 0; row < 7; row++)
        for (let col = 0; col < 5; col++)
          if (pattern[row][col] === "1")
            for (let dy = 0; dy < 3; dy++)
              for (let dx = 0; dx < 3; dx++)
                dot(x0 + col * 3 + dx, y0 + row * 3 + dy, 209, 220, 231);
    }
  for (let i = 0; i < code.length; i++) {
    const scale = code.length > 6 ? 3 : code.length > 5 ? 4 : 5,
      x0 = 8 + i * Math.floor((width - 16) / code.length) + randomInt(-2, 3),
      y0 = 7 + randomInt(-3, 4),
      pattern = glyph(code[i]);
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < 5; col++)
        if (pattern[row][col] === "1")
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++)
              dot(
                x0 + col * scale + dx,
                y0 + row * scale + dy,
                30 + i * 8,
                75 + i * 4,
                127 + i * 7,
              );
  }
  if (settings.interferenceLines)
    for (let n = 0; n < 3; n++)
      line(
        randomInt(width),
        randomInt(height),
        randomInt(width),
        randomInt(height),
      );
  if (settings.waveLines)
    for (let n = 0; n < 2; n++) {
      const phase = randomInt(628) / 100;
      for (let x = 1; x < width; x++)
        dot(
          x,
          Math.round(22 + n * 13 + 6 * Math.sin(x / 14 + phase)),
          125,
          169,
          204,
        );
    }
  if (settings.hollowLines)
    for (let n = 0; n < 3; n++) {
      const cx = randomInt(width),
        cy = randomInt(height),
        radius = randomInt(8, 22);
      for (let angle = 0; angle < 360; angle += 3)
        dot(
          Math.round(cx + radius * Math.cos((angle * Math.PI) / 180)),
          Math.round(cy + radius * Math.sin((angle * Math.PI) / 180)),
          178,
          198,
          220,
        );
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return (
    "data:image/png;base64," +
    Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(pixels)),
      chunk("IEND", Buffer.alloc(0)),
    ]).toString("base64")
  );
}
const invalid = () =>
  Object.assign(Error("验证码错误、已过期或尝试次数过多，请重新获取"), {
    status: 400,
  });
export class RegistrationCodes {
  constructor(
    accounts,
    {
      now = Date.now,
      captchaCode = (settings) => {
        const alphabet =
          settings.mode === "alphanumeric"
            ? "23456789ABCDEFGHJKLMNPQRSTUVWXYZ"
            : "0123456789";
        return Array.from(
          { length: settings.length },
          () => alphabet[randomInt(alphabet.length)],
        ).join("");
      },
    } = {},
  ) {
    Object.assign(this, { accounts, now, captchaCode, captchas: new Map() });
    accounts.db.exec(
      "CREATE TABLE IF NOT EXISTS registration_codes(digest TEXT PRIMARY KEY,username TEXT NOT NULL,email TEXT NOT NULL,code_hash TEXT NOT NULL,created INTEGER NOT NULL,expires INTEGER NOT NULL,attempts INTEGER NOT NULL DEFAULT 0); CREATE INDEX IF NOT EXISTS registration_codes_email_created ON registration_codes(email,created); CREATE TABLE IF NOT EXISTS registration_verified(digest TEXT PRIMARY KEY,username TEXT NOT NULL,email TEXT NOT NULL,expires INTEGER NOT NULL);",
    );
  }
  signature(digest, code) {
    return createHmac("sha256", this.accounts.key)
      .update("register:" + digest + ":" + code)
      .digest("hex");
  }
  available(name, address) {
    name = username(name);
    const email = emailAddress(address);
    if (this.accounts.user(name))
      throw Object.assign(Error("该用户名已被使用"), { status: 409 });
    if (
      this.accounts.db
        .prepare("SELECT username FROM users WHERE lower(email)=?")
        .get(email)
    )
      throw Object.assign(Error("该邮箱已被使用"), { status: 409 });
    return { name, email };
  }
  captchaFor(
    purpose,
    subject,
    settings = { mode: "digits", length: 5, noiseDots: true },
  ) {
    const code = this.captchaCode(settings).toUpperCase(),
      id = token();
    for (const [key, value] of this.captchas)
      if (value.expires < this.now()) this.captchas.delete(key);
    if (this.captchas.size > 2000)
      this.captchas.delete(this.captchas.keys().next().value);
    this.captchas.set(hash(id), {
      purpose,
      subject,
      answer: hash(code),
      length: code.length,
      expires: this.now() + 300000,
      attempts: 0,
    });
    return {
      challenge: id,
      image: picture(code, settings),
      expiresIn: 300,
      length: code.length,
      mode: settings.mode,
    };
  }
  solveFor(purpose, subject, id, answer) {
    const key = hash(String(id)),
      row = this.captchas.get(key);
    if (
      !row ||
      row.purpose !== purpose ||
      row.subject !== subject ||
      row.expires < this.now() ||
      row.attempts >= 5
    )
      throw invalid();
    row.attempts++;
    if (
      typeof answer !== "string" ||
      !/^[A-Za-z0-9]{4,8}$/.test(answer) ||
      answer.length !== row.length ||
      !timingSafeEqual(
        Buffer.from(row.answer, "hex"),
        Buffer.from(hash(answer.toUpperCase()), "hex"),
      )
    )
      throw invalid();
    this.captchas.delete(key);
    return true;
  }
  captcha(name, address, settings) {
    const { name: validName, email } = this.available(name, address);
    return this.captchaFor("registration", validName + "|" + email, settings);
  }
  solve(name, address, id, answer) {
    const { name: validName, email } = this.available(name, address);
    this.solveFor("registration", validName + "|" + email, id, answer);
    return { name: validName, email };
  }
  issue(name, email) {
    const now = this.now(),
      code = String(randomInt(1000000)).padStart(6, "0"),
      id = token(),
      digest = hash(id);
    this.accounts.transaction(() => {
      this.accounts.db
        .prepare("DELETE FROM registration_codes WHERE expires<?")
        .run(now);
      const recent = this.accounts.db
          .prepare(
            "SELECT created FROM registration_codes WHERE email=? ORDER BY created DESC LIMIT 1",
          )
          .get(email),
        count = this.accounts.db
          .prepare(
            "SELECT count(*) AS n FROM registration_codes WHERE email=? AND created>?",
          )
          .get(email, now - 3600000).n;
      if ((recent && now - recent.created < 60000) || count >= 5)
        throw Object.assign(Error("验证码发送过于频繁，请稍后再试"), {
          status: 429,
        });
      this.accounts.db
        .prepare(
          "UPDATE registration_codes SET expires=0 WHERE email=? OR username=?",
        )
        .run(email, name);
      this.accounts.db
        .prepare("INSERT INTO registration_codes VALUES(?,?,?,?,?,?,0)")
        .run(
          digest,
          name,
          email,
          this.signature(digest, code),
          now,
          now + 600000,
        );
    });
    return { challenge: id, code, expiresIn: 600, retryAfter: 60 };
  }
  invalidate(id) {
    this.accounts.db
      .prepare("UPDATE registration_codes SET expires=0 WHERE digest=?")
      .run(hash(id));
  }
  verify(name, address, id, code) {
    const { name: validName, email } = this.available(name, address);
    if (
      typeof id !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(id) ||
      typeof code !== "string" ||
      !/^\d{6}$/.test(code)
    )
      throw invalid();
    const result = this.accounts.transaction(() => {
      const row = this.accounts.db
        .prepare(
          "SELECT * FROM registration_codes WHERE digest=? AND username=? AND email=?",
        )
        .get(hash(id), validName, email);
      if (!row || row.expires <= this.now() || row.attempts >= 5) return null;
      this.accounts.db
        .prepare(
          "UPDATE registration_codes SET attempts=attempts+1 WHERE digest=?",
        )
        .run(row.digest);
      if (
        !timingSafeEqual(
          Buffer.from(row.code_hash, "hex"),
          Buffer.from(this.signature(row.digest, code), "hex"),
        )
      )
        return null;
      this.accounts.db
        .prepare("DELETE FROM registration_codes WHERE digest=?")
        .run(row.digest);
      const proof = token();
      this.accounts.db
        .prepare("INSERT INTO registration_verified VALUES(?,?,?,?)")
        .run(hash(proof), validName, email, this.now() + 1800000);
      return { proof, expiresIn: 1800 };
    });
    if (!result) throw invalid();
    return result;
  }
  assertVerified(name, address, proof) {
    const { name: validName, email } = this.available(name, address);
    if (typeof proof !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(proof))
      throw invalid();
    const row = this.accounts.db
      .prepare(
        "SELECT * FROM registration_verified WHERE digest=? AND username=? AND email=? AND expires>?",
      )
      .get(hash(proof), validName, email, this.now());
    if (!row) throw invalid();
    return { name: validName, email };
  }
  consume(proof) {
    this.accounts.db
      .prepare("DELETE FROM registration_verified WHERE digest=?")
      .run(hash(proof));
  }
}
