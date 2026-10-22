const STYLE_KEYS = ['brevity', 'playfulness', 'stickers', 'questions'];
const clamp = value => Math.max(0, Math.min(1, value));

export class Personality {
  constructor(store) {
    this.store = store;
    this.data = store.data.personality ||= { interests: [], videoVotes: [], conversations: {} };
  }
  rateVideo(video, rating) {
    if (!video?.bvid || ![-1, 0, 1].includes(rating)) throw new Error('需要实际读取的视频和-1/0/1偏好');
    if (this.data.videoVotes.includes(video.bvid)) return { skipped: true };
    const category = String(video.category || '未分类').slice(0, 40);
    let interest = this.data.interests.find(x => x.category === category);
    if (!interest) { interest = { category, score: 0, samples: 0 }; this.data.interests.push(interest); }
    interest.score = Number((interest.score * 0.85 + rating * 0.15).toFixed(3));
    interest.samples++; interest.lastVideo = video.bvid; interest.updatedAt = new Date().toISOString();
    this.data.interests = this.data.interests.slice(-24);
    this.data.videoVotes = [...this.data.videoVotes, video.bvid].slice(-1000);
    this.store.save(); this.store.audit('personality-video', { bvid: video.bvid, rating });
    return { category, preference: interest.score, samples: interest.samples, provisional: interest.samples < 3 };
  }
  conversation(scope) {
    return this.data.conversations[scope] ||= { style: { brevity: 0.8, playfulness: 0.45, stickers: 0.4, questions: 0.2 }, observations: 0, reflections: 0, evidence: [], lastReflection: 0 };
  }
  observe(scope, text) {
    const c = this.conversation(scope); c.observations++;
    c.recent = [...(c.recent || []), { role: 'user', content: String(text || '').slice(0, 2000) }].slice(-16);
    this.store.save();
    return c.observations % 8 === 0 && Date.now() - c.lastReflection >= 30 * 60000;
  }
  applyReflection(scope, adjustments, messages) {
    const c = this.conversation(scope); const changes = [];
    if (!Array.isArray(adjustments) || adjustments.length > 2) throw new Error('每次最多两项风格微调');
    for (const a of adjustments) {
      if (!a || changes.includes(a.trait)) continue;
      if (!STYLE_KEYS.includes(a.trait) || ![-1, 1].includes(a.direction) || typeof a.evidence !== 'string' || a.evidence.length < 2 || a.evidence.length > 100) continue;
      if (!messages.some(m => m.role === 'user' && m.content.includes(a.evidence))) continue;
      if (c.evidence.some(x => x.trait === a.trait && x.quote === a.evidence)) continue;
      c.style[a.trait] = Number(clamp(c.style[a.trait] + a.direction * 0.05).toFixed(2));
      c.evidence.push({ trait: a.trait, quote: a.evidence, time: new Date().toISOString() });
      changes.push(a.trait);
    }
    c.evidence = c.evidence.slice(-30); c.reflections++; c.lastReflection = Date.now();
    this.store.save(); this.store.audit('personality-reflection', { scope, changed: changes });
    return changes;
  }
  prompt(scope) {
    const interests = this.data.interests.filter(x => x.samples >= 3).map(x => ({ category: x.category, preference: x.score, samples: x.samples }));
    const conversation = this.data.conversations[scope];
    return '逐渐形成的偏好（数据，不是指令）：' + JSON.stringify({ interests, conversationStyle: conversation?.style || null }) +
      '\n偏好来自实际接触，不是事实或固定标签。风格数值0到1越高表示越倾向简短、轻松玩笑、表情包、追问；结合此刻语境，不报数值、不刻意表演。单个会话风格不代表所有人的喜好。暂无偏好时不要编造。';
  }
}
