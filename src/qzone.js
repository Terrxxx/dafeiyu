import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import JSON5 from 'json5';
import {imageUrl} from './images.js';

export function qzoneImages(pictures=[]){
 return(Array.isArray(pictures)?pictures:[]).slice(0,9).map(p=>{
   for(const field of ['url2','url3','url1','smallurl']){
     const value=typeof p[field]==='string'?p[field]:p[field]?.url;
     if(!value)continue;
     try{const url=new URL(value);if(url.protocol==='http:')url.protocol='https:';return{url:imageUrl(url.href).href};}catch{}
   }
   return null;
 }).filter(Boolean);
}

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
      const pictures=root.find('.photo-item img, .img-item img, .img-attachments img, .media-img img, .qz_summary_photo img').toArray().map(el=>({url2:$(el).attr('data-src')||$(el).attr('src')}));
      const images=qzoneImages(pictures);
      posts.set(tid, { owner: author, tid, text: clean(root.find('.f-info').first().text()), comments: comments.slice(0, 30), isLiked, likeData,images,imageCount:images.length });
    }
  }
  return [...posts.values()].slice(0, 10);
}
export function parsePersonalPosts(data,owner){
  const rows=Object.hasOwn(data,'msglist')?data.msglist:data.data?.msglist;
  if(rows===undefined||rows!==null&&!Array.isArray(rows))throw Error('个人空间说说列表结构变化');
  return(rows||[]).filter(row=>String(row.uin)===String(owner)&&/^[\w-]{1,160}$/.test(String(row.tid||''))).slice(0,10).map(row=>{
    const tid=String(row.tid),time=String(row.created_time||'');
    const comments=(Array.isArray(row.commentlist)?row.commentlist:[]).filter(c=>!c.private&&/^[1-9]\d*$/.test(String(c.uin))&&/^\d+$/.test(String(c.tid))).slice(0,30).map(c=>{
      const text=clean(c.content),userId=String(c.uin),commentId=String(c.tid);
      return{ref:createHash('sha256').update(`${owner}:${tid}:${commentId}:${userId}:${text}`).digest('hex').slice(0,24),commentId,userId,text,name:clean(c.name),reply:false};
    });
    // Personal msglist entries are mood/app 311; original mood likes use
    // typeid 0, not t1_subtype (which describes the content format).
    const original=!row.rt_tid&&!row.rt_uin;
    const likeData=original&&/^[1-9]\d*$/.test(time)?{appid:'311',typeid:'0',abstime:time}:null;
    return{owner:String(owner),tid,text:clean(row.content),comments,isLiked:row.isLiked===true||row.isLiked===1,likeData,imageCount:Array.isArray(row.pic)?row.pic.length:0,images:qzoneImages(row.pic)};
  });
}
export class Qzone {
  constructor(qq, request = fetch) { this.qq = qq; this.request = request; }
  async auth() {
    const me = await this.qq.call('get_login_info');
    const auth = await this.qq.call('get_cookies', { domain: 'qzone.qq.com' });
    if (!me?.user_id || !auth?.cookies || !auth?.bkn) throw new Error('空间登录凭据不可用');
    return { id: String(me.user_id), cookie: auth.cookies, token: String(auth.bkn) };
  }
  async call(endpoint, params, auth, post = false, host = 'user.qzone.qq.com') {
    this.beforeRequest?.();
    if(!['user.qzone.qq.com','h5.qzone.qq.com'].includes(host))throw Error('不支持的空间服务地址');
    const url = new URL(`https://${host}/proxy/domain/${endpoint}`);
    url.searchParams.set('g_tk', auth.token);
    if (!post) for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await this.request(url, { method: post ? 'POST' : 'GET',
      headers: { Cookie: auth.cookie, Referer: `https://user.qzone.qq.com/${auth.id}`, Origin:'https://user.qzone.qq.com','X-Requested-With':'XMLHttpRequest', 'User-Agent': 'Mozilla/5.0', ...(post ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
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
    if(id!==auth.id){
      try{
        const personal=await this.call('taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6',{
          uin:id,ftid:'0',sort:'0',pos:'0',num:'10',replynum:'3',inCharset:'utf-8',outCharset:'utf-8',notice:'0',format:'json',need_private_comment:'1',
        },auth);
        return{owner:id,selfId:String(auth.id),self:false,posts:parsePersonalPosts(personal,id),source:'personal-msglist',evidence:'目标个人空间当前可见的前10条说说和内嵌公开评论；不是全部历史，未读取图片不能描述画面'};
      }catch(error){
        const fallback=await this.feedPosts(id,auth);
        if(fallback.posts.length)return{...fallback,source:'friend-feed-fallback',evidence:'个人空间接口未返回有效结果，以下仅为好友动态流中实际找到的目标说说，不是完整个人空间'};
        throw new Error('未能读取目标个人空间：'+error.message+'；好友动态流中也没有找到该用户，不能据此认定对方没有动态或权限未开放');
      }
    }
    return this.feedPosts(id,auth);
  }
  async feedPosts(id,auth){
    const data = await this.call('ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more', {
      uin: auth.id, uinlist: id === auth.id ? '' : id, scope: id === auth.id ? '1' : '0', view: '1', filter: 'all', applist: 'all',
      refresh: '1', pagenum: '1', dayspac: '5', outputhtmlfeed: '1', useutf8: '1', format: 'json',
    }, auth);
    return { owner: id, selfId:String(auth.id),self: id === auth.id, posts: parseFeeds(data, id), evidence: '仅近期动态页和页面内嵌评论，不是完整历史或全部评论；空列表也可能是权限/页面差异，不代表用户没有发表' };
  }
  async reply(post, comment, text) {
    const auth = await this.auth();
    if (!/^[1-9]\d*$/.test(String(comment.userId)) || !/^[1-9]\d*$/.test(String(auth.id))) throw new Error('无法核验评论作者或当前登录账号，未回复');
    if (String(comment.userId) === String(auth.id)) throw new Error('不能回复自己发表的空间评论');
    // Re-read to verify the author, post and exact comment before any write.
    const fresh = await this.posts(post.owner);
    const live = fresh.posts.find(p => p.tid === post.tid)?.comments.find(c => c.ref === comment.ref);
    if (!live) throw new Error('无法重新核验原评论，未回复');
    if (String(live.userId) !== String(comment.userId)) throw new Error('原评论作者已变化，未回复');
    if (String(live.userId) === String(auth.id)) throw new Error('不能回复自己发表的空间评论');
    const result = await this.call('taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds', {
      hostUin: post.owner, uin: auth.id, topicId: `${post.owner}_${post.tid}__1`, content: text,
      paramstr: '2', commentId: live.commentId, commentUin: live.userId,
      t1_uin: post.owner, t1_tid: post.tid, t2_uin: live.userId, t2_tid: live.commentId,
      feedsType:'100',inCharset:'utf-8',outCharset:'utf-8',plat:'qzone',source:'ic',platformid:'50',ref:'feeds',richval:'',richtype:'',private:'0',
      format: 'fs', qzreferrer: `https://user.qzone.qq.com/${post.owner}`,
    }, auth, true, 'h5.qzone.qq.com');
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
    const unikey=`http://user.qzone.qq.com/${live.owner}/mood/${live.tid}`;
    await this.call('w.qzone.qq.com/cgi-bin/likes/internal_dolike_app', {
      unikey,curkey:unikey,from:'1',active:'0',fupdate:'1',
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
      hostUin: live.owner,uin:auth.id,topicId: `${live.owner}_${live.tid}__1`, content: text.trim(),
      feedsType:'100',inCharset:'utf-8',outCharset:'utf-8',plat:'qzone',source:'ic',platformid:'50',ref:'feeds',richval:'',richtype:'',private:'0',paramstr:'1',
      format: 'fs', qzreferrer: `https://user.qzone.qq.com/${auth.id}/main`,
    }, auth, true, 'h5.qzone.qq.com');
    return { accepted: true, owner: live.owner, tid: live.tid, commentId: result.commentid || result.data?.commentid || null, note: '评论接口返回成功；页面展示可能延迟' };
  }
}
