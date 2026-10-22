import { createHash } from 'node:crypto';
import { allowed } from './config.js';

const schema = (name, description, properties = {}, required = []) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const str = description => ({ type: 'string', description });
export class SocialTools {
  constructor(config, store, qq, bili, tasks = null) {
    Object.assign(this, { config, store, qq, bili, tasks });
    this.videos = new Map(); this.targets = new Set(); this.scope = '';
    this.schemas = [
      schema('bili_popular', '获取B站当前热门视频，不限定主题'),
      schema('bili_like_video', '给本轮已读且喜欢的视频点赞，不取消已有赞', { bvid: str('BV号') }, ['bvid']),
      schema('qzone_publish', '在自己的QQ空间发表文字说说（可含视频链接），不要泄露他人聊天', { text: str('说说正文') }, ['text']),
      schema('bili_read_video', '读取视频简介和第1分P字幕；不含画面', { bvid: str('BV号') }, ['bvid']),
      schema('qq_list_targets', '列出允许互动的QQ好友和群，作为分享候选目标'),
      schema('qq_send_message', '向已查询的QQ好友或群分享视频等内容；不广播；发送成功有回执', { kind: { type: 'string', enum: ['private', 'group'] }, target: str('好友QQ或群号'), text: str('消息正文'), atUserIds: { type: 'array', items: str('群成员QQ号'), maxItems: 3 } }, ['kind', 'target', 'text']),
      schema('qq_group_members', '查看已查询群的成员，用于选择真实@对象', { groupId: str('群号') }, ['groupId']),
      schema('qq_reply_current', '回复当前消息，可引用原消息或@发送者；调用后不再自动发送最终文本', { text: str('回复正文'), mentionSender: { type: 'boolean' }, quote: { type: 'boolean' } }, ['text']),
      schema('task_create', '给自己安排一次未来任务，例如稍后找有趣视频分享或跟进话题；到时才执行，程序需要保持运行', { prompt: str('具体任务，包括需要的目标ID；不要转存其他会话隐私'), delayMinutes: { type: 'number', minimum: 1, maximum: 10080 } }, ['prompt', 'delayMinutes']),
      schema('task_list', '查看当前会话内自己安排的任务'),
      schema('task_cancel', '取消当前会话的待办任务', { id: str('任务ID') }, ['id']),
      schema('bili_post_comment', '对本轮已经读取的视频发表一条公开评论，适合分享看法；不重复发言', { bvid: str('BV号'), text: str('评论内容') }, ['bvid', 'text']),
    ];
  }
  begin(scope, current = null) {
    this.scope = scope; this.current = current; this.currentAttempted = false;
    this.videos.clear(); this.targets.clear();
    if (current) this.targets.add(`${current.kind}:${current.target}`);
  }
  outgoing(bili = false) {
    if (bili) this.store.reserve('bili-comments', this.config.agent.maxBiliCommentsPerHour);
    this.store.reserve('outgoing', this.config.agent.maxOutgoingPerHour);
  }
  async call(name, args) {
    if (name === 'qzone_publish') {
      if (!this.config.qq.enabled || !this.config.social?.qzoneEnabled) throw new Error('空间发布未启用');
      if (typeof args.text !== 'string' || !args.text.trim() || args.text.length > 1000) throw new Error('说说长度须为1至1000字符');
      const hash = createHash('sha256').update(args.text.trim()).digest('hex');
      return this.store.once(`qzone:${hash}`, async () => {
        this.store.reserve('qzone', 1); this.outgoing();
        const result = await this.qq.call('send_qzone_msg', { content: args.text, images: [], ugc_right: this.config.social.qzoneVisibility, target_uins: [] });
        if (!result?.tid) throw new Error('空间发布未返回tid，状态不明');
        return { tid: result.tid };
      });
    }
    if (name === 'bili_like_video') {
      if (!this.config.bilibili.enabled || !this.videos.has(args.bvid)) throw new Error('请先读取视频');
      return this.store.once(`bili-like:${args.bvid}`, async () => {
        this.store.reserve('bili-likes', 10); return this.bili.like(args.bvid);
      });
    }
    if (name.startsWith('task_')) {
      if (!this.tasks) throw new Error('任务系统未启用');
      if (name === 'task_create') return this.tasks.create(this.scope, args.prompt, args.delayMinutes);
      if (name === 'task_list') return this.tasks.list(this.scope);
      if (name === 'task_cancel') return this.tasks.cancel(this.scope, args.id);
    }
    if (name === 'qq_reply_current') {
      if (!this.current || !args.text?.trim()) throw new Error('没有当前消息或回复为空');
      this.currentAttempted = true;
      const msg = this.current;
      return this.store.once(msg.key, async () => {
        this.outgoing();
        return this.qq.send(msg.kind, msg.target, args.text, {
          atUserIds: args.mentionSender && msg.kind === 'group' ? [msg.sender] : [],
          ...(args.quote ? { replyTo: msg.id } : {}),
        });
      });
    }
    if (name === 'qq_group_members') {
      if (!this.targets.has(`group:${args.groupId}`)) throw new Error('请先查询可用QQ群');
      const members = await this.qq.call('get_group_member_list', { group_id: Number(args.groupId) });
      return members.slice(0, 200).map(x => ({ id: String(x.user_id), name: x.card || x.nickname }));
    }
    if (name === 'bili_popular') {
      if (!this.config.bilibili.enabled) throw new Error('B站已禁用');
      return this.bili.popular();
    }
    if (name === 'bili_read_video') {
      if (!this.config.bilibili.enabled) throw new Error('B站已禁用');
      if (this.videos.size >= this.config.bilibili.maxVideosPerRound && !this.videos.has(args.bvid)) throw new Error('本轮视频读取额度已用完');
      const video = await this.bili.video(args.bvid); this.videos.set(args.bvid, video); return video;
    }
    if (name === 'qq_list_targets') {
      if (!this.config.qq.enabled) throw new Error('QQ已禁用');
      const friends = await this.qq.call('get_friend_list');
      const groups = await this.qq.call('get_group_list');
      const targets = [
        ...friends.filter(x => allowed(this.config.qq.allowUsers, x.user_id)).map(x => ({ kind: 'private', id: String(x.user_id), name: x.remark || x.nickname })),
        ...groups.filter(x => allowed(this.config.qq.allowGroups, x.group_id)).map(x => ({ kind: 'group', id: String(x.group_id), name: x.group_name })),
      ];
      for (const t of targets) this.targets.add(`${t.kind}:${t.id}`);
      return targets.slice(0, 150);
    }
    if (name === 'qq_send_message') {
      if (!this.config.qq.enabled) throw new Error('QQ已禁用');
      if (!this.targets.has(`${args.kind}:${args.target}`)) throw new Error('请先查询可用QQ目标');
      if (!args.text?.trim()) throw new Error('消息不能为空');
      if (this.current && args.kind === this.current.kind && args.target === this.current.target) throw new Error('向当前会话回复请使用qq_reply_current');
      const atUserIds = args.atUserIds || [];
      if (!Array.isArray(atUserIds) || atUserIds.length > 3 || atUserIds.some(x => !/^[1-9]\d*$/.test(String(x)))) throw new Error('@对象必须是最多3个QQ号');
      if (atUserIds.length) {
        if (args.kind !== 'group') throw new Error('私聊不支持@');
        const members = await this.qq.call('get_group_member_list', { group_id: Number(args.target) });
        if (atUserIds.some(id => !members.some(x => String(x.user_id) === String(id)))) throw new Error('@对象不是目标群成员');
      }
      const videos = [...new Set(args.text.match(/BV[0-9A-Za-z]{10}/g) || [])].sort();
      const hash = createHash('sha256').update(videos.length ? videos.join(',') : args.text.trim()).digest('hex').slice(0, 20);
      return this.store.once(`qq-share:${args.kind}:${args.target}:${hash}`, async () => {
        this.outgoing();
        return this.qq.send(args.kind, args.target, args.text, { atUserIds });
      });
    }
    if (name === 'bili_post_comment') {
      if (!this.config.bilibili.enabled) throw new Error('B站已禁用');
      const video = this.videos.get(args.bvid);
      if (!video) throw new Error('先读取此视频，再决定是否评论');
      if (!args.text?.trim()) throw new Error('评论不能为空');
      return this.store.once(`bili-share:${args.bvid}`, async () => {
        this.outgoing(true);
        return this.bili.comment(video.aid, args.text);
      });
    }
    throw new Error('未知工具');
  }
}
