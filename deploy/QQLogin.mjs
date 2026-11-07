import fs from 'node:fs';
import { createHash } from 'node:crypto';
import QRCode from 'qrcode';
const root = '/opt/dafeiyu';
const access = JSON.parse(fs.readFileSync(`${root}/deploy/server-access.json`, 'utf8'));
const expected = String(JSON.parse(fs.readFileSync(`${root}/data/avatar-reference.json`, 'utf8')).owner);
const base = 'http://127.0.0.1:16099/api';
async function post(route, body = {}, credential = '') {
  const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(credential ? { Authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`NapCat HTTP ${response.status}`);
  const data = await response.json(); if (data.code !== 0) throw new Error(`NapCat API code ${data.code}: ${String(data.message || '').slice(0, 120)}`); return data.data;
}
const auth = await post('/auth/login', { hash: createHash('sha256').update(access.napcatToken + '.napcat').digest('hex') });
const status = await post('/QQLogin/CheckLoginStatus', {}, auth.Credential);
if (status.isLogin) {
  const info = await post('/QQLogin/GetQQLoginInfo', {}, auth.Credential);
  const id = String(info.uin || info.user_id || info.account?.uin || '');
  if (id === expected && process.argv.includes('--enable-auto-login')) await post('/QQLogin/SetQuickLoginQQ', { uin: expected }, auth.Credential);
  console.log(JSON.stringify({ loggedIn: true, expectedAccount: id === expected, infoKeys: Object.keys(info) }));
  if (id !== expected) process.exitCode = 2;
} else if (process.argv.includes('--status')) {
  const quick = await post('/QQLogin/GetQuickLoginList', {}, auth.Credential);
  const configured = await post('/QQLogin/GetQuickLoginQQ', {}, auth.Credential);
  const accounts = Array.isArray(quick) ? quick : quick?.accounts || quick?.list || [];
  if (process.argv.includes('--quick') && accounts.some(item => String(item.uin) === expected)) await post('/QQLogin/SetQuickLogin', { uin: expected }, auth.Credential);
  console.log(JSON.stringify({ loggedIn: false, phase: status.loginPhase, coreReady: status.coreReady, rememberedAccounts: accounts.length, expectedRemembered: accounts.some(item => String(item.uin) === expected), autoLoginConfigured: String(configured) === expected }));
} else {
  if (process.argv.includes('--refresh')) await post('/QQLogin/RefreshQRcode', {}, auth.Credential);
  const result = await post('/QQLogin/GetQQLoginQrcode', {}, auth.Credential);
  if (result.qrcode.startsWith('data:image/')) fs.writeFileSync(`${root}/deploy/qq-login.png`, Buffer.from(result.qrcode.split(',')[1], 'base64'));
  else await QRCode.toFile(`${root}/deploy/qq-login.png`, result.qrcode, { width: 420, margin: 3 });
  console.log('QQ login QR saved. Use the original Dafeiyu QQ account.');
}
