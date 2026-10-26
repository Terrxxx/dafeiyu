import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import JSON5 from 'json5';

const clean = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 3000);
export function parseQzoneJson(text) {
  let value = text.trim();
  if (!value.startsWith('{')) {
    const match = value.match(/^[\w.]+\s*\(\s*([\s\S]*)\s*\)\s*;?$/);
    if (!match) throw new Error('空间响应格式变化或需要登录');
    value = match[1];
  }
  // The service emits [undefined] in optional fields. Replace only bare tokens,
  // never words inside a quoted post/comment; do not evaluate JavaScript.
  value = value.replace(/("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\bundefined\b/gs, (token, quoted) => quoted || 'null');
  return JSON5.parse(value);
}
export function parseFeeds(data, owner) {
  const posts = new Map();
  const feeds = data?.data?.data;
  if (!Array.isArray(feeds)) throw new Error('空间动态结构变化');
  for (const feed of feeds) {
    if (typeof feed?.html !== 'string') continue;
    const $ = load(feed.html);
    const blocks = $('[name="feed_data"]').toArray();
    for (const node of blocks) {
      const meta = $(node); const author = String(meta.attr('data-uin') || '');
      const appid = meta.attr('data-appid');
      if (author !== String(owner) || (appid && appid !== '311')) continue;
      const root = meta.closest('[id^="feed_"]');
      if (!root.length) continue; // Never associate comments with a neighbouring post.
      const tid = meta.attr('data-fkey') || meta.attr('data-key') || root.attr('data-key') || meta.attr('data-tid');
      if (!tid || !/^[\w-]{1,160}$/.test(tid)) continue;
      const comments = [];
      root.find('.comments-item[data-tid][data-uin]').each((_i, el) => {
        const c = $(el); const commentId = c.attr('data-tid'); const userId = c.attr('data-uin');
        if (!/^\d+$/.test(commentId) || !/^[1-9]\d*$/.test(userId)) return;
        const own = c.clone(); own.find('.mod-comments-sub').remove();
        const text = clean(own.find('.comments-content').first().text());
        const ref = createHash('sha256').update(`${owner}:${tid}:${commentId}:${userId}:${text}`).digest('hex').slice(0, 24);
        comments.push({ ref, commentId, userId, text, name: clean(c.attr('data-nick')), reply: c.attr('data-type') === 'replyroot' });
      });
      const feedId = root.attr('id')?.match(/^feed_(\d+)_(\d+)_(\d+)_(\d+)_/);
      const ownId = feedId?.[1] === author && feedId[2] === '311' ? feedId : null;
      const abstime = meta.attr('data-abstime') || ownId?.[4];
      const typeid = meta.attr('data-typeid') || ownId?.[3];
      const button = root.find('.qz_like_btn, [data-islike]').first();
      const isLiked = button.attr('data-islike') === '1' || button.hasClass('item-on');
      const likeData = /^\d+$/.test(typeid || '') && /^[1-9]\d*$/.test(abstime || '')
        ? { appid: '311', typeid, abstime } : null;
      posts.set(tid, { owner: author, tid, text: clean(root.find('.f-info').first().text()), comments: comments.slice(0, 30), isLiked, likeData });
    }
  }
  return [...posts.values()].slice(0, 10);
}
export class Qzone {
  constructor(qq, request = fetch) { this.qq = qq; this.request = request; }
  async auth() {
    const me = await this.qq.call('get_login_info');
    const auth = await this.qq.call('get_cookies', { domain: 'qzone.qq.com' });
    if (!me?.user_id || !auth?.cookies || !auth?.bkn) throw new Error('空间登录凭据不可用');
    return { id: String(me.user_id), cookie: auth.cookies, token: String(auth.bkn) };
  }
  async call(endpoint, params, auth, post = false) {
    this.beforeRequest?.();
    const url = new URL(`https://user.qzone.qq.com/proxy/domain/${endpoint}`);
    url.searchParams.set('g_tk', auth.token);
    if (!post) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.request(url, { method: post ? 'POST' : 'GET',
      headers: { Cookie: auth.cookie, Referer: `https://user.qzone.qq.com/${auth.id}`, 'User-Agent': 'Mozilla/5.0', ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
      body: post ? new URLSearchParams(params) : undefined, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`空间请求失败 HTTP ${response.status}`);
    const chunks = []; let size = 0;
    for await (const part of response.body) { size += part.length; if (size > 3 * 1024 * 1024) throw new Error('空间响应过大'); chunks.push(part); }
    const result = parseQzoneJson(Buffer.concat(chunks).toString('utf8'));
    const code = result.code ?? result.ret;
    if (code === undefined || code === null || !['number', 'string'].includes(typeof code) || String(code).trim() === '' || Number(code) !== 0) throw new Error(`空间返回错误码 ${code ?? '缺失'}，可能无权限或登录失效`);
    return result;
  }
  async posts(owner = 'self') {
    const auth = await this.auth(); const id = owner === 'self' ? auth.id : String(owner);
    if (!/^[1-9]\d*$/.test(id)) throw new Error('QQ号无效');
    const data = await this.call('ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more', {
      uin: auth.id, uinlist: id === auth.id ? '' : id, scope: id === auth.id ? '1' : '0', view: '1', filter: 'all', applist: 'all',
      refresh: '1', pagenum: '1', dayspac: '5', outputhtmlfeed: '1', useutf8: '1', format: 'json',
    }, auth);
    return { owner: id, self: id === auth.id, posts: parseFeeds(data, id), evidence: '仅近期动态页和页面内嵌评论，不是完整历史或全部评论；空列表也可能是权限/页面差异，不代表用户没有发表' };
  }
  async reply(post, comment, text) {
    const auth = await this.auth();
    // Re-read to verify the author, post and exact comment before any write.
    const fresh = await this.posts(post.owner);
    const live = fresh.posts.find(p => p.tid === post.tid)?.comments.find(c => c.ref === comment.ref);
    if (!live) throw new Error('无法重新核验原评论，未回复');
    const result = await this.call('taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds', {
      hostUin: post.owner, uin: auth.id, topicId: `${post.owner}_${post.tid}__1`, content: text,
      paramstr: '2', commentId: live.commentId, commentUin: live.userId,
      t1_uin: post.owner, t1_tid: post.tid, t2_uin: live.userId, t2_tid: live.commentId,
      format: 'json', qzreferrer: `https://user.qzone.qq.com/${post.owner}`,
    }, auth, true);
    return { accepted: true, commentId: result.commentid || result.data?.commentid || null, note: '接口返回成功；页面展示可能延迟' };
  }
  async freshPost(post) {
    const fresh = await this.posts(post.owner);
    const live = fresh.posts.find(p => p.owner === post.owner && p.tid === post.tid);
    if (!live || live.text !== post.text) throw new Error('动态已变化或无法重新核验，请重新读取空间');
    return live;
  }
  async like(post) {
    const live = await this.freshPost(post);
    if (live.isLiked) return { skipped: true, alreadyLiked: true };
    if (!live.likeData) throw new Error('动态缺少可靠的点赞参数，未发送点赞');
    const auth = await this.auth();
    await this.call('taotao.qzone.qq.com/cgi-bin/like_cgi_likev6', {
      opuin: auth.id, ouin: live.owner, fid: live.tid, ...live.likeData,
      key: '', format: 'json', qzreferrer: `https://user.qzone.qq.com/${auth.id}/main`,
    }, auth, true);
    return { accepted: true, owner: live.owner, tid: live.tid, note: '点赞接口返回成功；页面展示可能延迟' };
  }
  async comment(post, text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 300) throw new Error('空间评论须为1至300字');
    const live = await this.freshPost(post);
    const auth = await this.auth();
    const result = await this.call('taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds', {
      hostUin: live.owner, topicId: `${live.owner}_${live.tid}`, content: text.trim(),
      format: 'json', qzreferrer: `https://user.qzone.qq.com/${auth.id}/main`,
    }, auth, true);
    return { accepted: true, owner: live.owner, tid: live.tid, commentId: result.commentid || result.data?.commentid || null, note: '评论接口返回成功；页面展示可能延迟' };
  }
}
