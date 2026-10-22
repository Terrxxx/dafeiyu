import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';
import { setTimeout as delay } from 'node:timers/promises';
import { ROOT } from './config.js';
import { HEADERS } from './bilibili.js';

async function login() {
  const base = 'https://passport.bilibili.com/x/passport-login/web/qrcode/';
  const request = async endpoint => {
    const response = await fetch(base + endpoint, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`登录接口 HTTP ${response.status}`);
    const result = await response.json();
    if (result.code !== 0) throw new Error(`登录接口错误码 ${result.code}`);
    return { response, data: result.data };
  };
  const { data } = await request('generate');
  const directory = path.join(ROOT, 'data'); fs.mkdirSync(directory, { recursive: true });
  await QRCode.toFile(path.join(directory, 'bilibili-login.png'), data.url, { width: 360 });
  console.log(await QRCode.toString(data.url, { type: 'terminal', small: true }));
  console.log('请用哔哩哔哩手机App扫码并确认。二维码图片也保存在 data/bilibili-login.png，180秒内有效。');
  try {
    for (let i = 0; i < 60; i++) {
      await delay(3000);
      const result = await request(`poll?qrcode_key=${encodeURIComponent(data.qrcode_key)}`);
      if (result.data.code === 86038) throw new Error('二维码过期，请重新运行');
      if (result.data.code !== 0) continue;
      const cookies = new Map(result.response.headers.getSetCookie().map(x => x.split(';')[0]).map(x => [x.slice(0, x.indexOf('=')), x.slice(x.indexOf('=') + 1)]));
      if (result.data.url) {
        const url = new URL(result.data.url);
        for (const name of ['SESSDATA', 'bili_jct', 'DedeUserID', 'DedeUserID__ckMd5']) {
          if (!cookies.has(name) && url.searchParams.has(name)) cookies.set(name, url.searchParams.get(name));
        }
      }
      if (!cookies.get('SESSDATA') || !cookies.get('bili_jct')) throw new Error('扫码成功但未获取完整Cookie，请重新登录');
      fs.writeFileSync(path.join(directory, 'bilibili-auth.json'), JSON.stringify({ cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') }, null, 2));
      console.log('B站登录已保存到本机。运行 npm start 即可启动。'); return;
    }
    throw new Error('等待扫码超时，请重新运行');
  } finally { fs.rmSync(path.join(directory, 'bilibili-login.png'), { force: true }); }
}
login().catch(error => { console.error(error.message); process.exitCode = 1; });
