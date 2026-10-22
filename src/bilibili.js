import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './config.js';

export const HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36', Referer: 'https://www.bilibili.com/' };
const MIXIN = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52];
export function signWbi(params, key, time = Math.floor(Date.now() / 1000)) {
  const mixed = MIXIN.map(i => key[i]).join('').slice(0, 32);
  const data = { ...params, wts: time };
  const query = Object.keys(data).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(String(data[k]).replace(/[!'()*]/g, ''))}`).join('&');
  return `${query}&w_rid=${createHash('md5').update(query + mixed).digest('hex')}`;
}
export function readCookie() {
  if (process.env.BILIBILI_COOKIE) return process.env.BILIBILI_COOKIE;
  const file = path.join(ROOT, 'data', 'bilibili-auth.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).cookie : '';
}
export function parseMention(event) {
  const item = event.item;
  if (!item || Number(item.business_id) !== 1) return null;
  let uri;
  try { uri = new URL(item.uri); } catch { return null; }
  if (uri.hostname !== 'www.bilibili.com' && uri.hostname !== 'bilibili.com') return null;
  const bvid = uri.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})(?:\/|$)/)?.[1];
  if (!bvid) return null;
  const native = (() => { try { return new URL(item.native_uri); } catch { return null; } })();
  const positive = (...values) => values.map(String).find(x => /^[1-9]\d*$/.test(x));
  const parent = positive(native?.searchParams.get('comment_secondary_id'), uri.hash.match(/reply(\d+)/)?.[1], item.id);
  const root = positive(native?.searchParams.get('comment_root_id'), item.root_id, parent);
  const sender = String(event.user?.mid || '');
  if (![parent, root, sender].every(x => /^[1-9]\d*$/.test(x))) return null;
  return { id: String(event.id), bvid, parent, root, sender, text: String(item.source_content || item.title || '').slice(0, 4000) };
}

export class Bilibili {
  constructor(cookie, request = fetch) { this.cookie = cookie; this.request = request; this.key = ''; this.keyTime = 0; }
  async api(endpoint, params = {}, post = false, signed = false) {
    if (signed && Date.now() - this.keyTime > 3600000) {
      const nav = await this.api('/x/web-interface/nav');
      const extract = value => new URL(value).pathname.split('/').pop().split('.')[0];
      this.key = extract(nav.wbi_img.img_url) + extract(nav.wbi_img.sub_url); this.keyTime = Date.now();
    }
    let body;
    if (post) {
      const csrf = this.cookie.split(';').map(x => x.trim()).find(x => x.startsWith('bili_jct='))?.slice(9);
      if (!csrf) throw new Error('B站 Cookie 缺少 bili_jct，请重新扫码登录');
      body = new URLSearchParams({ ...params, csrf });
    }
    const query = signed ? signWbi(params, this.key) : new URLSearchParams(params).toString();
    const response = await this.request(`https://api.bilibili.com${endpoint}${post ? '' : '?' + query}`, {
      method: post ? 'POST' : 'GET', headers: { ...HEADERS, Cookie: this.cookie }, body, signal: AbortSignal.timeout(20000), redirect: 'error',
    });
    if (!response.ok) throw new Error(`B站请求失败 HTTP ${response.status}`);
    const result = await response.json();
    if (result.code !== 0) throw new Error(`B站接口返回错误码 ${result.code}`);
    return result.data;
  }
  async popular() {
    const data = await this.api('/x/web-interface/popular', { ps: 20, pn: 1 });
    return (data.list || []).map(x => ({ bvid: x.bvid, title: x.title, author: x.owner?.name, description: x.desc?.slice(0, 500) }));
  }
  async video(bvid) {
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('无效 BV 号');
    const info = await this.api('/x/web-interface/view', { bvid });
    const result = { bvid, aid: info.aid, title: info.title, description: String(info.desc || '').slice(0, 3000), author: info.owner?.name, subtitle: '', evidence: '仅标题和简介；未看到画面。字幕仅取第1分P。' };
    try {
      const player = await this.api('/x/player/wbi/v2', { bvid, cid: info.cid }, false, true);
      const subs = player.subtitle?.subtitles || [];
      const selected = subs.find(x => x.lan?.startsWith('zh')) || subs[0];
      if (selected?.subtitle_url) {
        const url = new URL(selected.subtitle_url.startsWith('//') ? `https:${selected.subtitle_url}` : selected.subtitle_url);
        if (url.protocol !== 'https:' || !(url.hostname.endsWith('.hdslb.com') || url.hostname.endsWith('.bilibili.com'))) throw new Error('字幕地址不受支持');
        const response = await this.request(url, { headers: HEADERS, signal: AbortSignal.timeout(20000), redirect: 'error' });
        if (!response.ok) throw new Error('字幕下载失败');
        const subtitle = await response.json();
        result.subtitle = (subtitle.body || []).map(x => `[${Math.floor(x.from / 60)}:${String(Math.floor(x.from % 60)).padStart(2, '0')}] ${x.content}`).join('\n').slice(0, 16000);
        result.evidence = '第1分P字幕文本，未看到画面；最多16000字符。';
      }
    } catch { result.evidence = '字幕获取失败；仅标题和简介，不能声称看完视频。'; }
    try {
      await this.api('/x/v2/history/report', { aid: info.aid, cid: info.cid, progress: 0, platform: 'android' }, true);
      result.historyRecorded = true;
    } catch (error) { result.historyRecorded = false; result.historyError = error.message; }
    return result;
  }
  async mentions() {
    const items = []; let params = { platform: 'web' };
    for (let page = 0; page < 5; page++) {
      const data = await this.api('/x/msgfeed/at', params);
      if (!Array.isArray(data.items)) throw new Error('B站 @ 通知结构变化，需适配');
      items.push(...data.items);
      if (!data.items.length || data.cursor?.is_end || !data.cursor?.id) break;
      params = { platform: 'web', id: data.cursor.id, at_time: data.cursor.time };
    }
    return items;
  }
  async verifyThread(mention, aid) {
    for (let pn = 1; pn <= 5; pn++) {
      const data = await this.api('/x/v2/reply/reply', { type: 1, oid: aid, root: mention.root, pn, ps: 20 });
      const replies = [data.root, ...(data.replies || [])].filter(Boolean);
      const target = replies.find(x => String(x.rpid_str || x.rpid) === mention.parent);
      if (target) {
        if (String(target.mid ?? target.member?.mid) !== mention.sender || String(target.oid) !== String(aid)) throw new Error('通知与评论身份不一致');
        const root = String(target.root_str || target.root || '0');
        return { root: root === '0' ? mention.parent : root, parent: mention.parent, text: target.content?.message || mention.text };
      }
      if ((data.replies || []).length < 20) break;
    }
    throw new Error('无法核验评论楼层，已跳过，避免回复错人');
  }
  async comment(aid, message, root = '0', parent = '0') {
    const data = await this.api('/x/v2/reply/add', { type: 1, oid: aid, message: message.slice(0, 900), root, parent, plat: 1 }, true);
    if (data?.need_captcha || !(data?.rpid_str || data?.rpid)) throw new Error('评论未确认成功，可能需要验证码');
    return { rpid: String(data.rpid_str || data.rpid) };
  }
  async like(bvid) {
    if (!/^BV[0-9A-Za-z]{10}$/.test(bvid)) throw new Error('无效BV号');
    const existing = await this.api('/x/web-interface/archive/has/like', { bvid });
    if (Number(existing) === 1) return { liked: true, alreadyLiked: true };
    if (!/(?:^|;\s*)buvid3=/.test(this.cookie)) {
      const device = await this.api('/x/frontend/finger/spi');
      if (!device?.b_3) throw new Error('未取得B站设备标识');
      this.cookie += `; buvid3=${device.b_3}`;
    }
    await this.api('/x/web-interface/archive/like', { bvid, like: 1 }, true);
    return { liked: true };
  }
}
