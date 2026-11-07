import{emailAddress}from'./email-address.js';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scrypt as derive, createHash, timingSafeEqual, createCipheriv, createDecipheriv } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export const hash = value => createHash('sha256').update(value).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
export function username(value) {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{2,23}$/.test(value) || ['root','admin','system','platform'].includes(value)) throw Object.assign(new Error('用户名须为3–24位小写字母、数字或下划线，以字母开头'), { status: 400 });
  return value;
}
export async function passwordHash(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) throw Object.assign(new Error('密码长度须为12–128个字符'), { status: 400 });
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(value, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function passwordMatches(value, stored) {
  const [salt, expected] = (stored || '00000000000000000000000000000000:' + '00'.repeat(64)).split(':');
  const actual = await scrypt(typeof value === 'string' ? value.slice(0,128) : '', salt, 64);
  return timingSafeEqual(actual, Buffer.from(expected,'hex')) && !!stored;
}
export class Accounts {
  constructor(directory) {
    fs.mkdirSync(directory, { recursive:true, mode:0o700 });
    this.directory = directory;
    const keyFile = path.join(directory,'master.key');
    if (!fs.existsSync(keyFile)) fs.writeFileSync(keyFile,randomBytes(32),{mode:0o600,flag:'wx'});
    this.key = fs.readFileSync(keyFile);
    this.db = new DatabaseSync(path.join(directory,'accounts.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS users (username TEXT PRIMARY KEY, password TEXT, role TEXT NOT NULL DEFAULT 'user', disabled INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS invites (id TEXT PRIMARY KEY, digest TEXT UNIQUE NOT NULL, created_by TEXT NOT NULL, expires INTEGER NOT NULL, max_uses INTEGER NOT NULL, uses INTEGER NOT NULL DEFAULT 0, revoked INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS sessions (digest TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username), csrf TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS activations (digest TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS bots (username TEXT PRIMARY KEY REFERENCES users(username), qq TEXT UNIQUE, secrets TEXT NOT NULL, desired INTEGER NOT NULL DEFAULT 0, billing TEXT, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, subject TEXT);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
    this.migrateEmail();
  }
  migrateEmail(){const columns=new Set(this.db.prepare('PRAGMA table_info(users)').all().map(c=>c.name));this.transaction(()=>{for(const[name,type]of [['email','TEXT'],['email_verified','INTEGER NOT NULL DEFAULT 0'],['email_pending','INTEGER NOT NULL DEFAULT 0']])if(!columns.has(name))this.db.exec('ALTER TABLE users ADD COLUMN '+name+' '+type);this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS user_email_unique ON users(lower(email)) WHERE email IS NOT NULL; CREATE TABLE IF NOT EXISTS email_verifications(digest TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username),email TEXT NOT NULL,purpose TEXT NOT NULL,expires INTEGER NOT NULL);');});}
  encrypt(value, owner) {
    const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',this.key,iv); cipher.setAAD(Buffer.from(owner));
    const bytes=Buffer.concat([cipher.update(JSON.stringify(value)),cipher.final()]);
    return Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');
  }
  decrypt(value, owner) {
    const bytes=Buffer.from(value,'base64'), cipher=createDecipheriv('aes-256-gcm',this.key,bytes.subarray(0,12));
    cipher.setAAD(Buffer.from(owner)); cipher.setAuthTag(bytes.subarray(12,28));
    return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());
  }
  user(name) { return this.db.prepare('SELECT username,role,disabled,created,email,email_verified,email_pending FROM users WHERE username=?').get(name); }
  bot(name) { const row=this.db.prepare('SELECT * FROM bots WHERE username=?').get(name); return row ? {...row,secrets:this.decrypt(row.secrets,name)} : null; }
  saveSecrets(name,secrets) { this.db.prepare('UPDATE bots SET secrets=? WHERE username=?').run(this.encrypt(secrets,name),name); }
  audit(actor,action,subject='') { this.db.prepare('INSERT INTO audit(time,actor,action,subject) VALUES (?,?,?,?)').run(Date.now(),actor,action,subject); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const value=fn();this.db.exec('COMMIT');return value; } catch(e) {this.db.exec('ROLLBACK');throw e;} }
  async register(name,password,invite,options={}){
    if(options.mode==='closed')throw Object.assign(Error('站点暂不允许新用户注册'),{status:403});username(name);const email=emailAddress(options.email);if(this.user(name))throw Object.assign(Error('该用户名已被使用'),{status:409});const encoded=await passwordHash(password);
    this.transaction(()=>{let row;if((options.mode||'invite')==='invite'){row=this.db.prepare('SELECT * FROM invites WHERE digest=? AND revoked=0 AND expires>? AND uses<max_uses').get(hash(String(invite)),Date.now());if(!row)throw Object.assign(Error('邀请码无效、已过期或使用次数已满'),{status:400});}if(this.user(name))throw Object.assign(Error('该用户名已被使用'),{status:409});if(this.db.prepare('SELECT username FROM users WHERE lower(email)=?').get(email))throw Object.assign(Error('该邮箱已被使用'),{status:409});this.db.prepare('INSERT INTO users(username,password,created,email,email_verified,email_pending) VALUES(?,?,?,?,?,?)').run(name,encoded,Date.now(),email,options.emailVerified?1:0,options.emailVerified?0:1);if(row)this.db.prepare('UPDATE invites SET uses=uses+1 WHERE id=?').run(row.id);this.audit(name,'register');});return this.user(name);
  }
  emailToken(name,email,purpose){email=emailAddress(email);if(purpose==='bind'&&this.user(name)?.email_verified)throw Object.assign(Error('邮箱已绑定，无法更换'),{status:403});if(!['register','bind'].includes(purpose))throw Error('邮箱验证用途无效');const value=token();this.transaction(()=>{this.db.prepare('DELETE FROM email_verifications WHERE expires<?').run(Date.now());if(this.db.prepare('SELECT username FROM users WHERE lower(email)=? AND username<>?').get(email,name))throw Object.assign(Error('该邮箱已被使用'),{status:409});this.db.prepare('DELETE FROM email_verifications WHERE username=? AND purpose=?').run(name,purpose);this.db.prepare('INSERT INTO email_verifications VALUES(?,?,?,?,?)').run(hash(value),name,email,purpose,Date.now()+86400000);});return value;}
  verifyEmail(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(value))throw Object.assign(Error('邮箱验证链接无效或已过期'),{status:400});return this.transaction(()=>{const row=this.db.prepare('SELECT * FROM email_verifications WHERE digest=? AND expires>?').get(hash(value),Date.now());if(!row)throw Object.assign(Error('邮箱验证链接无效或已过期'),{status:400});const current=this.user(row.username);if(current.email_verified&&current.email!==row.email)throw Object.assign(Error('邮箱已绑定，无法更换'),{status:403});if(this.db.prepare('SELECT username FROM users WHERE lower(email)=? AND username<>?').get(row.email,row.username))throw Object.assign(Error('该邮箱已被使用，请重新申请验证'),{status:409});this.db.prepare('UPDATE users SET email=?,email_verified=1,email_pending=0 WHERE username=?').run(row.email,row.username);this.db.prepare('DELETE FROM email_verifications WHERE username=?').run(row.username);this.audit(row.username,'email-verified');return row.username;});}
  invite(actor,maxUses=1,days=7) {
    if(!Number.isInteger(maxUses)||maxUses<1||maxUses>100||!Number.isInteger(days)||days<1||days>30) throw new Error('邀请码使用次数须为1–100，到期天数须为1–30');
    const code=token(),id=randomBytes(8).toString('hex'),expires=Date.now()+days*86400000;
    this.db.prepare('INSERT INTO invites(id,digest,created_by,expires,max_uses) VALUES (?,?,?,?,?)').run(id,hash(code),actor,expires,maxUses);
    this.audit(actor,'invite-create',id); return {id,code,expires,maxUses};
  }
  session(name) {
    if(this.user(name)?.email_pending)throw Object.assign(Error("请先激活邮箱"),{status:403});
    const value=token(),csrf=token(),expires=Date.now()+7*86400000;
    this.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(hash(value),name,csrf,expires);
    return {value,csrf,expires};
  }
  authenticate(value) {
    if(typeof value!=='string'||value.length>100)return null;
    return this.db.prepare('SELECT users.username,users.role,users.email,users.email_verified,sessions.csrf FROM sessions JOIN users USING(username) WHERE digest=? AND expires>? AND disabled=0 AND email_pending=0').get(hash(value),Date.now())||null;
  }
  activation(name) {
    const value=token();this.db.prepare('DELETE FROM activations WHERE username=?').run(name);
    this.db.prepare('INSERT INTO activations VALUES (?,?,?)').run(hash(value),name,Date.now()+86400000);
    return value;
  }
  async activate(value,password) {
    const encoded=await passwordHash(password);
    return this.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM activations WHERE digest=? AND expires>?').get(hash(String(value)),Date.now());
      if(!row)throw Object.assign(new Error('激活链接无效或已过期'),{status:400});
      this.db.prepare('UPDATE users SET password=? WHERE username=?').run(encoded,row.username);
      this.db.prepare('DELETE FROM activations WHERE username=?').run(row.username);
      this.db.prepare('DELETE FROM sessions WHERE username=?').run(row.username);
      this.audit(row.username,'activate');return row.username;
    });
  }
  deleteUser(name, actor) {
    return this.transaction(() => {
      const row = this.user(name);
      if (!row) throw Object.assign(Error('用户不存在'), {status:404});
      if (row.role === 'admin' || name === actor) throw Object.assign(Error('不能删除管理员账号'), {status:403});
      for (const table of ['login_codes','registration_codes','registration_verified','password_codes','password_verified','email_verifications','sessions','activations','bots'])
        this.db.prepare(`DELETE FROM ${table} WHERE username=?`).run(name);
      this.db.prepare('DELETE FROM invites WHERE created_by=?').run(name);
      this.db.prepare('DELETE FROM audit WHERE actor=? OR subject=?').run(name,name);
      this.db.prepare('DELETE FROM users WHERE username=?').run(name);
      this.audit(actor,'user-delete',name);
    });
  }
  close(){this.db.close();}
}
