import { createHash } from 'node:crypto';
import { synthesizeSpeech } from './media.js';

const str = description => ({ type: 'string', description });
const target = { kind: { type: 'string', enum: ['private', 'group'] }, target: str('当前会话或已核实的目标ID') };
const schema = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
export const qqFeatureSchemas = [
  schema('qq_list_sent', '查看当前会话/本轮核实目标中本程序已确认发送的消息ID，用于撤回；不包含别人消息'),
  schema('qq_recall_message', '撤回本程序已确认发出的消息，先查询真实消息ID；平台可能因超时拒绝', { messageId: str('qq_list_sent返回的消息ID') }, ['messageId']),
  schema('qq_get_profile', '读取自己或已知用户的QQ资料；不能用年龄性别推断性格', { userId: str('self或已知QQ号') }, ['userId']),
  schema('qzone_read', '读取自己或已知用户近期空间及内嵌评论，不代表全部内容', { userId: str('self或已知QQ号') }, ['userId']),
  schema('qzone_read_comments', '读取本轮已查说说的内嵌评论样本', { postRef: str('qzone_read返回的postRef') }, ['postRef']),
  schema('qzone_like_post', '给本轮实际读过且喜欢的QQ空间说说点赞，已赞不取消；可选择不点赞', { postRef: str('qzone_read返回的postRef') }, ['postRef']),
  schema('qzone_comment_post', '给本轮实际读过的QQ空间说说发表评论，独立判断是否评论，不泄露私聊；每条动态最多评论一次', { postRef: str('qzone_read返回的postRef'), text: str('1至300字') }, ['postRef', 'text']),
  schema('qzone_reply_comment', '回复本轮实际读到并重新核验的空间评论，不能跨楼层猜ID', { commentRef: str('实际评论ref'), text: str('最多300字，不泄露私聊') }, ['commentRef', 'text']),
  schema('qq_list_images', '列出当前会话已识别图片及AI主动收藏的表情素材；只能使用返回的ID'),
  schema('qq_save_sticker', '自主把已看懂且适合复用的表情图存入QQ收藏；不要把私人照片或聊天截图作为通用表情', { imageId: str('可用图片ID') }, ['imageId']),
  schema('qq_send_image', '发送已识别的可用图片，当前会话发送后不重复文本回复', { ...target, imageId: str('可用图片ID'), quote: { type: 'boolean' } }, ['kind', 'target', 'imageId']),
  schema('qq_send_voice', '使用本机中文音色把短句合成为语音并发送，当前会话发后不再追加文字', { ...target, text: str('1至200字'), quote: { type: 'boolean' }, expectReply: { type: 'boolean', description: '主动向好友提问希望回应时为true' } }, ['kind', 'target', 'text']),
  schema('qq_set_avatar', '在后台自主活动时把已看懂、已收藏的非动图设为自己的头像，最多24小时一次', { imageId: str('已收藏的图片ID') }, ['imageId']),
  schema('web_search', '使用独立浏览器搜索公开互联网，返回标题、摘要和来源链接；不搜索私聊敏感内容', { query: str('公开搜索词，最多120字') }, ['query']),
  schema('web_read', '只读本轮搜索结果的公开网页文字，无用户登录态', { url: str('本轮搜索返回的网址') }, ['url']),
];
const digest = value => createHash('sha256').update(value).digest('hex').slice(0, 24);
function knownUser(tools, id) {
  if (!/^[1-9]\d*$/.test(String(id)) || !tools.knownUsers.has(String(id))) throw new Error('请先核实用户：当前发送者、目标列表或群成员列表');
}
export function rememberPosts(tools, result) {
  return { ...result, posts: result.posts.map(post => {
    const postRef = digest(`${post.owner}:${post.tid}`);
    tools.spacePosts.set(postRef, post);
    for (const comment of post.comments) tools.spaceComments.set(comment.ref, { post, comment });
    return { ...post, postRef };
  }) };
}
export async function executeQQFeature(tools, name, args) {
  if (name === 'web_search') {
    tools.store.reserve('web-search', 20);
    const result = await tools.browser.search(args.query);
    for (const item of result.results) tools.webUrls.add(item.url);
    return result;
  }
  if (name === 'web_read') {
    if (!tools.webUrls.has(args.url)) throw new Error('只能读取本轮实际搜索到的网页');
    tools.store.reserve('web-read', 30); return tools.browser.read(args.url);
  }
  if (!tools.config.qq.enabled) throw new Error('QQ已禁用');
  const canRecall = item => !item.recalled && (tools.current
    ? item.kind === tools.current.kind && item.target === tools.current.target
    : tools.targets.has(`${item.kind}:${item.target}`)) && (!tools.proactiveTarget || (item.kind === 'private' && item.target === tools.proactiveTarget));
  if (name === 'qq_list_sent') return Object.values(tools.store.data.sentMessages || {}).filter(canRecall).sort((a, b) => b.time - a.time).slice(0, 20);
  if (name === 'qq_recall_message') {
    const item = tools.store.data.sentMessages?.[args.messageId];
    if (!item || !canRecall(item)) throw new Error('只能撤回当前允许会话中本程序已确认发出的消息');
    return tools.store.once(`recall:${item.id}`, async () => {
      tools.store.reserve('recall', 10);
      await tools.qq.call('delete_msg', { message_id: item.id });
      item.recalled = true;
      const f = tools.feelings.data.users[item.target]?.followup;
      if (item.kind === 'private' && f?.messageIds.includes(item.id)) { f.checked = true; f.used = true; }
      tools.store.appendHistory(`qq:${item.kind === 'group' ? 'group' : 'user'}:${item.target}`, 'assistant', `[已撤回自己消息 ${item.id}：${item.text}]`, tools.config.agent.historyMessages);
      tools.store.save(); return { recalled: true, messageId: item.id };
    });
  }
  if (name === 'qq_get_profile') {
    const id = args.userId === 'self' ? String((await tools.qq.call('get_login_info')).user_id) : args.userId;
    if (args.userId !== 'self') knownUser(tools, id);
    const p = await tools.qq.call('get_stranger_info', { user_id: Number(id) });
    return { id, nickname: p.nickname, signature: p.long_nick, sex: p.sex, age: p.age, level: p.qqLevel, evidence: '用户当前公开/账号可见资料，不是身份或性格证明' };
  }
  if (name === 'qzone_read') {
    if (args.userId !== 'self') knownUser(tools, args.userId);
    tools.store.reserve('qzone-read', 20);
    return rememberPosts(tools, await tools.qzone.posts(args.userId));
  }
  if (name === 'qzone_read_comments') {
    const post = tools.spacePosts.get(args.postRef);
    if (!post) throw new Error('请先读取说说');
    return { comments: post.comments, evidence: '动态页内嵌评论，可能不完整' };
  }
  if (name === 'qzone_reply_comment') {
    if (!tools.config.social?.qzoneEnabled) throw new Error('空间写入未启用');
    const source = tools.spaceComments.get(args.commentRef);
    if (!source || typeof args.text !== 'string' || !args.text.trim() || args.text.length > 300) throw new Error('原评论未读取或回复长度不合适');
    return tools.store.once(`qzone-comment:${args.commentRef}`, async () => {
      tools.store.reserve('qzone-comments', 3); tools.outgoing();
      return tools.qzone.reply(source.post, source.comment, args.text.trim());
    });
  }
  if (['qzone_like_post', 'qzone_comment_post'].includes(name)) {
    if (!tools.config.social?.qzoneEnabled) throw new Error('空间写入未启用');
    const post = tools.spacePosts.get(args.postRef);
    if (!post) throw new Error('请先读取目标用户的空间，使用真实postRef');
    const like = name === 'qzone_like_post';
    if (!like && (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 300)) throw new Error('空间评论须为1至300字');
    const key = `qzone-${like ? 'like' : 'post-comment'}:${post.owner}:${post.tid}`;
    if (tools.store.data.actions[key]) return tools.store.once(key, async () => null);
    if (like && post.isLiked) return { skipped: true, alreadyLiked: true };
    tools.store.reserve(like ? 'qzone-likes' : 'qzone-comments', like ? 10 : 3);
    tools.outgoing();
    return tools.store.once(key, async () => {
      const detail = { owner: post.owner, tid: post.tid, ...(like ? {} : { text: args.text.trim() }) };
      tools.store.audit(name, { ...detail, status: 'pending' });
      try {
        const receipt = like ? await tools.qzone.like(post) : await tools.qzone.comment(post, args.text.trim());
        tools.store.audit(name, { ...detail, status: receipt.skipped ? 'skipped' : 'accepted', receipt });
        return receipt;
      } catch (error) {
        tools.store.audit(name, { ...detail, status: 'unconfirmed', message: error.message });
        throw error;
      }
    });
  }
  if (name === 'qq_list_images') return tools.media.list(tools.scope);
  if (name === 'qq_save_sticker') {
    const item = tools.media.get(args.imageId, tools.scope); tools.media.bytes(item);
    if (item.savedSticker) return { skipped: true, saved: true };
    return tools.store.once(`sticker-save:${item.id}`, async () => {
      tools.store.reserve('sticker-save', 10);
      const result = await tools.qq.call('add_custom_face', { file: item.file, is_origin: true });
      if (result?.result !== undefined && Number(result.result) !== 0) throw new Error('QQ表情收藏未确认成功');
      tools.media.markSticker(item.id); return { saved: true, imageId: item.id };
    });
  }
  if (name === 'qq_set_avatar') {
    if (tools.current || !['autonomous-social', 'autonomous-browse'].includes(tools.scope)) throw new Error('换头像仅在后台自主活动中执行');
    const item = tools.media.get(args.imageId, tools.scope);
    if (!item.savedSticker || item.mime === 'image/gif') throw new Error('头像需要已收藏并看懂的静态图片');
    if (Date.now() - (tools.store.data.meta.lastAvatarChange || 0) < 86400000) throw new Error('头像24小时内最多更换一次');
    const bytes = tools.media.bytes(item);
    return tools.store.once(`avatar:${item.id}:${Math.floor(Date.now() / 86400000)}`, async () => {
      await tools.qq.call('set_qq_avatar', { file: `base64://${bytes.toString('base64')}` });
      tools.store.data.meta.lastAvatarChange = Date.now(); tools.store.save(); return { changed: true };
    });
  }
  if (['qq_send_image', 'qq_send_voice'].includes(name)) {
    if (!['private', 'group'].includes(args.kind) || !tools.targets.has(`${args.kind}:${args.target}`)) throw new Error('请先核实发送目标');
    const isCurrent = tools.current && args.kind === tools.current.kind && String(args.target) === tools.current.target;
    if (isCurrent && tools.currentAttempted) return { skipped: true, reason: '本轮已经回复' };
    let data; let summary;
    if (name === 'qq_send_image') {
      const item = tools.media.get(args.imageId, tools.scope);
      if (!isCurrent && !item.savedSticker) throw new Error('未收藏图片只可回发原会话，不能转发私密素材');
      data = { type: 'image', data: { file: 'base64://' + tools.media.bytes(item).toString('base64') } };
      summary = `[已发送图片：${item.description}]`;
    } else {
      const audio = await (tools.synthesizeSpeech || synthesizeSpeech)(args.text, tools.media.directory, tools.config.social?.voiceName);
      data = { type: 'record', data: { file: 'base64://' + audio.toString('base64') } };
      summary = `[语音] ${args.text}`;
    }
    if (isCurrent) tools.currentAttempted = true;
    const key = isCurrent ? tools.current.key : `qq-media:${args.kind}:${args.target}:${digest(summary)}:${Math.floor(Date.now() / 3600000)}`;
    return tools.store.once(key, async () => {
      tools.outgoing();
      const message = [...(isCurrent && args.quote ? [{ type: 'reply', data: { id: tools.current.id } }] : []), data];
      const receipt = await tools.qq.call(args.kind === 'group' ? 'send_group_msg' : 'send_private_msg', { [`${args.kind === 'group' ? 'group' : 'user'}_id`]: Number(args.target), message });
      if (receipt?.message_id === undefined) throw new Error('媒体发送未收到消息ID，状态不明');
      if (name === 'qq_send_image') tools.media.markSent(args.imageId);
      tools.store.appendHistory(`qq:${args.kind === 'group' ? 'group' : 'user'}:${args.target}`, 'assistant', summary, tools.config.agent.historyMessages);
      return receipt;
    });
  }
  throw new Error('未实现的QQ扩展工具');
}
