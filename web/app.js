const $ = id => document.getElementById(id);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let heartbeat = null; let heartbeatRate = null;
function updateHeartbeat(rate) {
  heartbeatRate = rate; const heart = $('heartBeat');
  const valid = Number.isFinite(rate) && rate > 0; heart.hidden = !valid;
  if (!valid || reducedMotion.matches) { heartbeat?.cancel(); heartbeat = null; return; }
  const duration = 60000 / rate;
  if (!heartbeat) heartbeat = heart.animate([
    { transform: 'scale(1)', opacity: 0.75, offset: 0 },
    { transform: 'scale(1.22)', opacity: 1, offset: 0.18 },
    { transform: 'scale(1)', opacity: 0.75, offset: 0.4 },
    { transform: 'scale(1)', opacity: 0.75, offset: 1 },
  ], { duration, iterations: Infinity, easing: 'ease-in-out' });
  else {
    const previous = heartbeat.effect.getTiming().duration;
    if (previous !== duration) { const phase = (heartbeat.currentTime || 0) / previous; heartbeat.effect.updateTiming({ duration }); heartbeat.currentTime = phase * duration; }
  }
}
reducedMotion.addEventListener('change', () => updateHeartbeat(heartbeatRate));
const moodLabels = { joy: '开心', sadness: '难过', irritation: '烦躁', curiosity: '好奇', calm: '平静', excitement: '兴奋', worry: '担心', tenderness: '温柔', confidence: '自信', boredom: '无聊', anticipation: '期待', loneliness: '孤单', shyness: '害羞', frustration: '挫败', security: '安心', inspiration: '灵感' };
let lifeRevision = ''; let lifeDirty = false; const lifeChanged = new Set(); const lifeInputs = {};
function updateLife(life) {
  if (!life) return;
  if (!Object.keys(lifeInputs).length) {
    for (const [key, label, min, max] of [['value', '虚拟健康值', 0, 100], ['restingHeartRate', '心率基准 bpm', 40, 120]]) {
      const wrap = element('label', label); const input = element('input'); input.type = 'number'; input.min = min; input.max = max; input.step = 'any'; input.required = true; input.dataset.life = `health.${key}`; input.setAttribute('aria-label', label); wrap.append(input); $('lifeHealthFields').append(wrap); lifeInputs[`health.${key}`] = input;
    }
    for (const [key, label] of Object.entries({ energy: '精力', ...moodLabels })) {
      const wrap = element('label', label); const input = element('input'); input.type = 'number'; input.min = 0; input.max = 100; input.step = 'any'; input.required = true; input.dataset.life = key; input.setAttribute('aria-label', `自身${label}`); wrap.append(input); $('lifeMoodFields').append(wrap); lifeInputs[key] = input;
    }
    for (const [key, label] of Object.entries({ baseDrainPerHour: '基础消耗 %/小时', maxDrainPerHour: '聊天最高消耗 %/小时', recoveryPerHour: '睡眠恢复 %/小时' })) {
      const wrap = element('label', label); const input = element('input'); input.type = 'number'; input.min = 0.01; input.max = 100; input.step = 'any'; input.required = true; input.dataset.life = key; input.setAttribute('aria-label', label); wrap.append(input); $('lifeRateFields').append(wrap); lifeInputs[key] = input;
    }
  }
  if (lifeDirty) return;
  lifeRevision = life.revision;
  for (const [key, input] of Object.entries(lifeInputs)) input.value = Math.round((key.startsWith('health.') ? life.health[key.slice(7)] : life.mood[key] ?? life.rates[key]) * 100) / 100;
}
const relationLabels = { affection: '亲近', concern: '关心', gratitude: '感激', ease: '自在', tension: '戒备', playfulness: '玩闹意愿', admiration: '欣赏' };
function emotionMeters(values, labels) {
  return Object.entries(labels).map(([key, label]) => {
    const item = element('div', undefined, 'emotion-meter'); const value = Number.isFinite(values?.[key]) ? values[key] : null;
    const caption = element('div'); caption.append(element('span', label), element('strong', value === null ? '—' : Math.round(value)));
    const meter = element('progress'); meter.max = 100; meter.value = value || 0; meter.setAttribute('aria-label', label); item.append(caption, meter); return item;
  });
}
let token = ''; let config = null; let configRevision = ''; let page = 'overview'; let rawDirty = false; let logs = []; let memories = []; let followLogs = true; let syncing = false;
const titles = { overview: '状态总览', config: '配置设置', logs: '运行日志', activity: 'B站足迹', qqActivity: 'QQ足迹', memories: '用户记忆' };
Object.assign(titles, { persona: '角色提示词', components: '组件中心' });
let personaRevision = ''; let personaLoaded = false; let personaDirty = false; let componentRevision = '';
let selectedUser = null; let memoryRequest = 0; let qqEntries = [];
let memoryLayout = 'list'; let memoryEditorDirty = false;
try { if (localStorage.getItem('memoryLayout') === 'grid') memoryLayout = 'grid'; } catch {}
const phases = { running: '运行中', starting: '启动中', stopping: '正在停止', stopped: '已停止', failed: '启动失败' };
const operations = { popular: '浏览热门候选', search: '搜索视频', stats: '读取视频数据', related: '查看相关推荐', comments: '读取评论', ownHistory: '查看观看历史', ownFollowing: '查看关注列表', ownFolders: '查看收藏夹', ownFavorites: '读取收藏内容', mentions: '检查@通知', verifyThread: '核验评论楼层', comment: '发表评论', like: '点赞视频', follow: '关注UP主', favorite: '收藏视频', publishDynamic: '发布动态' };
function date(value) { if (!value) return '暂无记录'; const d = new Date(value); return Number.isNaN(d.getTime()) ? '时间未知' : d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }); }
function element(tag, text, className = '') { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; e.className = className; return e; }
function notice(text, error = false) { $('notice').hidden = false; $('notice').textContent = text; $('notice').classList.toggle('error', error); }
async function api(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { 'X-Panel-Token': token, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || '请求失败'); return data;
}
function empty(node, text) { node.replaceChildren(element('p', text, 'empty')); }
function row(text, caption) { const node = element('div', undefined, 'row'); node.append(element('p', text), element('small', caption)); return node; }
function updateStatus(s) {
  const active = s.service.phase === 'running';
  $('serviceBadge').textContent = phases[s.service.phase] || s.service.phase;
  $('serviceBadge').className = `badge ${active ? 'good' : s.service.phase === 'failed' ? 'bad' : ''}`;
  $('startBtn').disabled = ['running', 'starting', 'stopping'].includes(s.service.phase);
  $('startBtn').classList.toggle('primary', page !== 'config' && !active);
  const asleep = s.sleep?.mode === 'sleep';
  $('heroTitle').textContent = !active ? (s.service.phase === 'starting' ? '正在和大肥鱼连接' : s.service.phase === 'stopping' ? '等她把手头的事收好' : '大肥鱼，准备好再出发') : asleep ? '嘘，她正在休息' : '大肥鱼醒着呢';
  $('heroNote').textContent = active ? asleep ? '睡眠期间不回复、不查询；她在安静地恢复精力。' : '她会按自己的心情与记忆，决定聊天、探索或安静待着。' : '这里可以查看最近保存的状态，也能调整配置后再启动。';
  $('sleepBadge').textContent = active ? (asleep ? '睡眠中' : '清醒中') : '状态来自上次保存';
  const energy = s.mood?.energy;
  $('energy').textContent = typeof energy === 'number' ? `${energy.toFixed(1)}%` : '—'; $('energyBar').value = energy || 0;
  $('energyHint').textContent = asleep && s.sleep?.minWakeAt > Date.now() ? `至少休息至 ${date(s.sleep.minWakeAt)}` : `清醒消耗约 ${s.sleep?.drainPerHour?.toFixed(1) || '5–8'}% / 小时`;
  $('mood').textContent = !s.mood ? '—' : s.mood.sadness > s.mood.joy ? '有点低落' : s.mood.irritation > 45 ? '有点烦躁' : s.mood.joy > 60 ? '心情不错' : '平平稳稳';
  $('moodHint').textContent = s.mood ? `开心 ${Math.round(s.mood.joy)} · 好奇 ${Math.round(s.mood.curiosity)}` : '情绪会随着经历变化';
  $('unread').textContent = s.unread; $('people').textContent = s.users;
  const health = s.health;
  $('healthValue').textContent = health ? `${health.value.toFixed(1)} / 100` : '—'; $('healthBar').value = health?.value ?? 0;
  $('healthHint').textContent = health?.status || '等待状态';
  $('heartRate').textContent = health ? `${health.heartRate} bpm` : '—';
  updateHeartbeat(health?.heartRate);
  $('heartHint').textContent = health ? `基准 ${health.restingHeartRate} bpm · ${health.sleeping ? '睡眠中' : '随精力、情绪与聊天变化'}` : '等待心率状态';
  updateLife(s.life);
  $('emotionMeters').replaceChildren(...emotionMeters(s.mood, moodLabels));
  const weather = s.weather;
  $('weatherTitle').textContent = weather?.enabled === false ? '天气感知已关闭' : weather?.available ? `${weather.city} · ${weather.description} · ${weather.temperature}°C` : `${weather?.city || '本地'} · 暂无有效天气`;
  $('weatherDetail').textContent = weather?.available ? `体感 ${weather.feelsLike}°C · 湿度 ${weather.humidity}% · 降水 ${weather.precipitation} mm · 风速 ${weather.windKmh} km/h` : '后台清醒时定时更新，睡眠期间不会查询。';
  $('weatherTime').textContent = weather?.observedAt ? `${weather.source} · 数据时间 ${date(weather.observedAt)}${weather.stale ? ' · 待更新' : ''}${weather.available ? '' : ' · 已过期'}` : '数据源 Open-Meteo · 配置城市天气，不代表所有用户所在地';
  if (s.summary.length) $('decisions').replaceChildren(...s.summary.slice().reverse().map(item => row(item.summary, `${item.stage} · ${date(item.time)}`))); else empty($('decisions'), '还没有回应概述，等她聊起来吧');
  const tasks = s.tasks.filter(item => ['pending', 'running'].includes(item.status));
  if (tasks.length) $('tasks').replaceChildren(...tasks.map(item => row(item.prompt, `${item.status === 'running' ? '执行中' : '计划中'} · ${date(item.due)}`))); else empty($('tasks'), '暂时没有安排，今天可以慢慢来');
  $('memoryTime').textContent = s.lastMemoryCompression ? `最近记忆整理 · ${date(s.lastMemoryCompression)}` : '睡眠时会自动整理当天记忆';
  $('syncState').textContent = `最近更新 ${date(Date.now()).split(' ').at(-1)}`;
}
const groups = [
  ['本地天气', [ ['weather.enabled','天气感知','清醒时自动获取，不影响睡眠规则','checkbox'], ['weather.city','天气城市','准确城市名，例如深圳；保存后重启生效','text'], ['weather.region','省份或地区','深圳为广东；用于区分重名城市，可留空','text'], ['weather.countryCode','国家代码','中国为CN，两位大写字母','text'], ['weather.refreshMinutes','天气刷新间隔','分钟，15至180','number',15] ]],
  ['发布与额度', [ ['social.maxQzonePostsPerHour','QQ空间发布','最近一小时上限，0表示禁发','number',0], ['bilibili.maxDynamicsPerHour','B站动态发布','最近一小时上限，0表示禁发','number',0], ['agent.maxOutgoingPerHour','全部发送额度','每小时总量，分条消息逐条计数','number',1], ['agent.maxModelCallsPerHour','模型请求额度','每小时上限，0表示不限次数','number',0] ]],
  ['自主生活', [ ['social.enabled','自主社交','让她自己找话题与合适的人','checkbox'], ['social.intervalMinutes','社交间隔','分钟，保存后重启生效','number',1], ['bilibili.browseMinutes','B站浏览间隔','分钟，保存后重启生效','number',1], ['social.followupEnabled','未回复时轻轻跟进','最多一次，不连续催促','checkbox'], ['social.followupWaitMinutes','跟进等待','分钟，至少10分钟','number',10] ]],
  ['QQ与声音', [ ['qq.enabled','QQ连接','使用本机NapCat连接','checkbox'], ['qq.adminUsers','管理员QQ号','多个号码用逗号分隔','admins'], ['qq.requireMentionInGroup','群聊需要@','关闭时由她自主判断是否参与','checkbox'], ['social.voiceName','语音音色','选择本机已安装的音色','voice'], ['social.qzoneVisibility','QQ空间可见范围','新发布动态使用此设置','visibility'] ]],
  ['平台与日志', [ ['bilibili.enabled','B站活动','关闭后暂停B站查询和互动','checkbox'], ['social.qzoneEnabled','QQ空间互动','控制说说发布、点赞和评论','checkbox'], ['social.qzoneAutoReply','空间评论自主回复','按语境判断，不每条都回','checkbox'], ['logging.replySummary','回复决策概述','在后台记录简短回应意图','checkbox'] ]],
  ['模型与上下文', [ ['runtime','执行引擎','Harness或直接模型调用','runtime'], ['agent.maxOutputTokens','回复输出上限','模型单次输出token上限','number',1], ['agent.maxToolRounds','工具调用轮数','每轮最多执行几轮模型工具链','number',1], ['agent.historyMessages','会话历史条数','每个会话提供给模型的近期条数','number',1], ['agent.contextMaxChars','上下文字符上限','控制历史输入长度','number',1] ]],
  ['QQ消息节奏', [ ['qq.cooldownSeconds','回复间隔','秒，避免短时间连续发送','number',0], ['qq.mergeSeconds','连续消息合并等待','秒，让对方把话说完','number',1], ['qq.maxWaitSeconds','最长合并等待','秒，至少等于合并等待','number',1], ['social.contactCooldownMinutes','主动联系间隔','分钟，同一个好友至少10分钟','number',10], ['social.qzonePollMinutes','空间评论检查间隔','分钟，至少5分钟','number',5] ]],
  ['B站', [ ['bilibili.pollSeconds','B站@检查间隔','秒，至少30秒','number',30], ['bilibili.maxVideosPerRound','每轮视频数','限制一轮探索量','number',1], ['agent.maxBiliCommentsPerHour','B站评论额度','最近一小时上限','number',1], ['bilibili.allowMentionUsers','B站@回复用户','UID用逗号分隔，*表示所有','ids'] ]],
  ['本地管理面板', [ ['web.enabled','启动管理面板','更改后需重新运行start.cmd','checkbox'], ['web.openBrowser','启动时打开网页','不影响后台运行','checkbox'], ['web.port','面板端口','1024–65535，重开start.cmd生效','number',1024] ]],
];
const getPath = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
function setPath(object, key, value) { const parts = key.split('.'); let base = object; for (const part of parts.slice(0, -1)) base = base[part] ||= {}; base[parts.at(-1)] = value; }
function formConfig() {
  const next = structuredClone(config);
  for (const input of document.querySelectorAll('[data-setting]')) {
    const value = input.type === 'checkbox' ? input.checked : ['admins', 'ids'].includes(input.dataset.kind) ? [...new Set(input.value.split(/[\s,，]+/).filter(Boolean))] : input.type === 'number' || input.dataset.kind === 'visibility' ? Number(input.value) : input.value;
    setPath(next, input.dataset.setting, value);
  }
  return next;
}
function renderConfig() {
  $('configFields').replaceChildren();
  for (const [title, fields] of groups) {
    if (window.DAFEIYU_MULTIUSER && title === '本地管理面板') continue;
    const fieldset = element('fieldset'); fieldset.append(element('legend', title));
    for (const [key, label, help, kind, min] of fields) {
      const wrap = element('label', undefined, 'field'); const labelNode = element('span', undefined, 'field-label'); labelNode.append(element('span', label), element('small', help));
      const input = element(['voice','visibility','runtime'].includes(kind) ? 'select' : 'input');
      input.dataset.setting = key; input.dataset.kind = kind;
      if (input.tagName === 'SELECT') {
        const options = kind === 'voice' ? [['kokoro-zf_017','Kokoro · 中文女声 017'], ['kokoro-zf_001','Kokoro · 中文女声 001'], ['kokoro-zf_036','Kokoro · 中文女声 036'], ['Microsoft Huihui Desktop','慧慧 · 中文女声'], ['chaowen','chaowen · 本地中文']] : kind === 'runtime' ? [['harness','DeepSeek Harness'],['direct','直接调用模型']] : [['1','所有人'],['4','好友'],['64','仅自己']];
        const current = String(getPath(config, key) ?? ''); if (!options.some(item => item[0] === current) && current) options.push([current,current]);
        for (const [value, text] of options) { const option = element('option', text); option.value = value; input.append(option); }
        input.value = current;
      } else { input.type = kind === 'checkbox' ? 'checkbox' : kind === 'number' ? 'number' : 'text'; if (kind === 'checkbox') input.checked = !!getPath(config,key); else input.value = ['admins','ids'].includes(kind) ? (getPath(config,key) || []).join(', ') : getPath(config,key) ?? ''; if (kind === 'number') { input.min = min; input.step = 1; input.required = true; } }
      wrap.append(labelNode, input); fieldset.append(wrap);
    }
    $('configFields').append(fieldset);
  }
  $('rawConfig').value = JSON.stringify(config, null, 2); rawDirty = false;
}
async function loadConfig() { const data = await api('/api/config'); config = data.config; configRevision = data.revision; renderConfig(); $('saveNote').textContent = '更改会保存到 config.json'; }
function renderLogs() {
  const term = $('logSearch').value.trim().toLowerCase();
  const previous = $('logOutput').scrollTop;
  $('logOutput').textContent = logs.filter(item => !term || item.text.toLowerCase().includes(term)).map(item => `${date(item.time)}  ${item.text}`).join('\n') || '没有匹配的日志';
  $('logOutput').scrollTop = followLogs ? $('logOutput').scrollHeight : previous;
}
async function activity() {
  const entries = await api('/api/activity'); const grouped = new Map();
  for (const entry of entries) grouped.set(entry.id, { ...grouped.get(entry.id), ...entry });
  const rows = [...grouped.values()].reverse();
  if (!rows.length) return empty($('activityList'), '还没有B站操作记录。启动后，她的互动会留在这里。');
  $('activityList').replaceChildren(...rows.map(item => {
    const state = { succeeded: '成功', failed: '失败', uncertain: '结果不确定', started: '处理中或结果未确认' }[item.state] || item.state;
    const detail = item.input?.text || item.input?.keyword || item.input?.bvid || item.input?.uid || item.input?.folderId || '读取平台数据';
    const node = row(`${operations[item.operation] || item.operation} · ${state}`, `${date(item.time)} · ${detail}`);
    if (item.error) node.append(element('small', item.error));
    if (item.receipt?.url) { const link = element('a','查看平台结果'); try { const url = new URL(item.receipt.url); if (url.protocol === 'https:' && /(^|\.)bilibili\.com$/.test(url.hostname)) { link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; node.append(link); } } catch {} }
    return node;
  }));
}
function renderMemories() {
  const term = $('memorySearch').value.toLowerCase();
  const users = memories.slice().sort((a, b) => (b.lastIncoming || 0) - (a.lastIncoming || 0)).filter(user => `${user.name} ${user.id}`.toLowerCase().includes(term) && ($('memoryFilter').value === 'all' || user.blocked === ($('memoryFilter').value === 'blocked')));
  $('memoryDirectoryPanel').classList.toggle('is-grid', memoryLayout === 'grid');
  $('memoryViewList').setAttribute('aria-pressed', String(memoryLayout === 'list')); $('memoryViewGrid').setAttribute('aria-pressed', String(memoryLayout === 'grid'));
  $('memoryCount').textContent = `${users.length} 位 / 共 ${memories.length} 位`;
  if (!users.length) return empty($('memoryList'), '暂时没有匹配的用户。聊过以后，她会慢慢记住。');
  $('memoryList').replaceChildren(...users.map(user => {
    const button = element('button', undefined, 'user-row'); button.type = 'button';
    button.setAttribute('aria-label', `查看${user.name}的记忆`);
    const identity = element('span', undefined, 'user-identity'); const avatar = element('span', user.name.slice(0, 1), 'user-avatar'); avatar.setAttribute('aria-hidden', 'true');
    const name = element('span'); name.append(element('strong', user.name), element('small', `QQ ${user.id}${user.blocked ? ' · 已屏蔽' : user.contactPaused ? ' · 暂停主动联系' : ''}`)); identity.append(avatar, name);
    button.append(identity);
    for (const [label, key] of [['好感度','affinity'],['信任度','trust'],['熟悉度','familiarity']]) {
      const value = element('span', undefined, 'user-metric'); value.append(element('small', label), affinityChart(user[key], false, label, key === 'affinity')); button.append(value);
    }
    button.append(element('span', date(user.lastIncoming), 'user-last'), element('span', '查看 →', 'user-open'));
    button.addEventListener('click', () => showMemory(user.id)); return button;
  }));
}
function memoryDirectory() {
  memoryEditorDirty = false;
  selectedUser = null; memoryRequest++; $('memoryDirectory').hidden = false; $('memoryDetail').hidden = true;
}
function affinityChart(value, large = false, label = '好感度', signed = true) {
  const score = Number.isFinite(value) ? Math.max(signed ? -100 : 0, Math.min(100, value)) : 0;
  const wrap = element('span', undefined, `affinity-chart${large ? ' large' : ''}${score < 0 ? ' negative' : ''}`);
  wrap.setAttribute('role', 'img'); wrap.setAttribute('aria-label', `${label} ${score}，范围${signed ? '负100' : '0'}至100`);
  wrap.title = `${label} ${signed ? '-100～100；扇形长度表示绝对值，负值以负号和红色表示' : '0～100'}`;
  const ns = 'http://www.w3.org/2000/svg'; const svg = document.createElementNS(ns, 'svg'); svg.setAttribute('viewBox', '0 0 64 64'); svg.setAttribute('aria-hidden', 'true');
  for (const active of [false, true]) {
    const circle = document.createElementNS(ns, 'circle');
    for (const [key, value] of Object.entries({ cx: '32', cy: '32', r: '25', fill: 'none', 'stroke-width': '6', stroke: active ? score < 0 ? 'var(--danger-fg)' : 'var(--blue)' : 'var(--line)' })) circle.setAttribute(key, value);
    if (active) { circle.setAttribute('stroke-dasharray', `${Math.abs(score) / 100 * 2 * Math.PI * 25} ${2 * Math.PI * 25}`); circle.setAttribute('transform', 'rotate(-90 32 32)'); }
    svg.append(circle);
  }
  wrap.append(svg, element('strong', String(Math.round(score * 10) / 10))); return wrap;
}
function historyText(text) {
  const marker = String(text || '').indexOf('\n消息：');
  return marker < 0 ? String(text || '') : text.slice(marker + 4).split('\n可直接使用的已理解')[0];
}
async function showMemory(id) {
  memoryEditorDirty = false;
  selectedUser = id; const request = ++memoryRequest;
  $('memoryDirectory').hidden = true; $('memoryDetail').hidden = false; empty($('memoryDetailContent'), '正在读取这位朋友的记忆…');
  try {
    const user = await api(`/api/memories/${encodeURIComponent(id)}`);
    if (request !== memoryRequest || selectedUser !== id) return;
    const header = element('article', undefined, 'panel memory-profile'); const identity = element('div');
    identity.append(element('h3', user.name), element('p', `QQ ${user.id} · 最近互动 ${date(user.lastIncoming)}`, 'label'));
    const metrics = element('div', undefined, 'profile-metrics');
    for (const [label, key] of [['好感度','affinity'],['信任度','trust'],['熟悉度','familiarity']]) { const metric = element('div'); metric.append(element('small', label), affinityChart(user[key], true, label, key === 'affinity')); metrics.append(metric); }
    header.append(identity, metrics); if (user.contactPaused) header.append(element('span', '已暂停主动联系', 'badge'));
    if (user.blocked) header.append(element('span', '已屏蔽消息', 'badge bad'));
    const userActions = element('div', undefined, 'user-actions');
    const blockButton = element('button', user.blocked ? '解除屏蔽' : '屏蔽此用户', 'button'); blockButton.type = 'button';
    const deleteButton = element('button', '删除用户记忆', 'button danger-link'); deleteButton.type = 'button';
    const mutate = async action => {
      if (action === 'delete' && !confirm(`确定删除${user.name}的记忆？将清除关系、私聊历史、压缩清单、私聊素材和便签，并清空涉及其发言的群短期上下文，无法撤销。保留QQ好友关系；之后的新消息从头认识。`)) return;
      if (action !== 'delete' && memoryEditorDirty && !confirm('此操作会重新载入资料，未保存的编辑将丢弃，继续吗？')) return;
      blockButton.disabled = true; deleteButton.disabled = true;
      try {
        const result = await api(`/api/memories/${encodeURIComponent(id)}`, { action }); notice(result.message); memoryEditorDirty = false;
        memories = await api('/api/memories'); renderMemories();
        if (action === 'delete' || !memories.some(user => user.id === id)) memoryDirectory(); else await showMemory(id);
      } catch (error) { notice(error.message, true); blockButton.disabled = false; deleteButton.disabled = false; }
    };
    blockButton.addEventListener('click', () => mutate(user.blocked ? 'unblock' : 'block')); deleteButton.addEventListener('click', () => mutate('delete')); userActions.append(blockButton, deleteButton);
    const editor = element('form', undefined, 'panel user-memory-editor'); const editorHeading = element('div', undefined, 'section-heading');
    editorHeading.append(element('div')); editorHeading.firstChild.append(element('h3', '睡前整合的记忆清单'), element('p', '历史记忆与当天记录按来源合并、压缩保存。可在这里修订；私聊清单不会进入群聊。'));
    const updateTime = element('small', user.checklist?.updatedAt ? `最近整理 / 编辑 · ${date(user.checklist.updatedAt)}` : '睡觉时会自动生成，也可先手动建立'); editorHeading.append(updateTime); editor.append(editorHeading);
    const scopeLabel = element('label', '记忆来源', 'memory-scope-label'); const scopeInput = element('select'); scopeInput.id = 'userMemoryScope';
    const scopes = [...new Set([`qq:user:${id}`, ...Object.keys(user.checklist?.sections || {}), ...user.memories.map(m => m.scope)])].filter(Boolean);
    for (const scope of scopes) { const option = element('option', scope.startsWith('qq:group:') ? `群聊 ${scope.slice(9)} · 仅该群可见` : '与该用户的私聊 · 仅此私聊可见'); option.value = scope; scopeInput.append(option); }
    scopeLabel.append(scopeInput); editor.append(scopeLabel);
    const text = element('textarea'); text.id = 'userMemoryChecklist'; text.maxLength = 50000; text.spellcheck = false; text.setAttribute('aria-label', '用户记忆清单');
    const fillScope = () => { text.value = user.checklist?.sections?.[scopeInput.value]?.text ?? user.memories.filter(m => m.scope === scopeInput.value).map(m => `- ${m.quote}`).join('\n'); };
    fillScope(); editor.append(text);
    const scoreControls = element('div', undefined, 'score-controls'); const scoreInputs = {};
    for (const [key, label] of [['affinity', '好感度'], ['trust', '信任度'], ['familiarity', '熟悉度']]) {
      const wrap = element('label', label); const input = element('input'); input.type = 'number'; input.min = key === 'affinity' ? -100 : 0; input.max = 100; input.step = 'any'; input.required = true; input.value = user[key] ?? (key === 'trust' ? 30 : 0); input.setAttribute('aria-label', label); scoreInputs[key] = input; wrap.append(input); scoreControls.append(wrap);
    }
    editor.append(scoreControls);
    const emotionInputs = {}; const emotionControls = element('div', undefined, 'score-controls relation-inputs');
    editor.append(element('h3', '她对这个人的相处感受'), element('p', '不是对方的心理测量。每个值 0–100，可手动修订。', 'detail-help'));
    for (const [key, label] of Object.entries(relationLabels)) {
      const wrap = element('label', label); const input = element('input'); input.type = 'number'; input.min = 0; input.max = 100; input.step = 'any'; input.required = true; input.value = user.emotions?.[key] ?? 0; input.setAttribute('aria-label', label); emotionInputs[key] = input; wrap.append(input); emotionControls.append(wrap);
    }
    editor.append(emotionControls); const saveRow = element('div', undefined, 'memory-save-row'); const save = element('button', '保存用户资料', 'button primary'); save.type = 'submit'; const saveHint = element('small', '新回复使用最新资料；全文压缩保存，不会全部塞入上下文'); saveRow.append(save, saveHint); editor.append(saveRow);
    scopeInput.addEventListener('change', () => { if (memoryEditorDirty && !confirm('切换来源会丢弃未保存的编辑，继续吗？')) { scopeInput.value = scopeInput.dataset.previous || scopes[0]; return; } fillScope(); scopeInput.dataset.previous = scopeInput.value; memoryEditorDirty = false; });
    editor.addEventListener('input', event => { if (event.target === scopeInput) return; memoryEditorDirty = true; saveHint.textContent = '有未保存的修改'; });
    editor.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      try { const result = await api(`/api/memories/${encodeURIComponent(id)}`, { action: 'save', scope: scopeInput.value, text: text.value, scores: { ...Object.fromEntries(Object.entries(scoreInputs).map(([key, input]) => [key, Number(input.value)])), emotions: Object.fromEntries(Object.entries(emotionInputs).map(([key, input]) => [key, Number(input.value)])) }, revision: user.checklist.revision }); notice(result.message); memoryEditorDirty = false; await showMemory(id); }
      catch (error) { notice(error.message, true); save.disabled = false; }
    });
    const columns = element('div', undefined, 'memory-detail-grid'); const facts = element('article', undefined, 'panel');
    facts.append(element('h3', '长期记忆'), element('p', '保留原始会话来源，普通喜好可跨会话衔接。', 'detail-help'));
    const factList = element('div', undefined, 'list');
    for (const memory of user.memories.slice().reverse()) {
      const node = row(memory.quote, `${memory.kind === 'boundary' ? '相处边界' : memory.kind === 'preference' ? '喜好' : '共同话题'} · ${memory.scope?.startsWith('qq:group:') ? '群聊 ' + memory.scope.slice(9) : '与该用户私聊'} · ${date(memory.time)}`);
      if (memory.sharedFact) node.append(element('small', `可共享喜好：${memory.sharedFact}`)); factList.append(node);
    }
    if (!user.memories.length) empty(factList, '还没有保存长期记忆'); facts.append(factList);
    const chats = element('article', undefined, 'panel'); chats.append(element('h3', '记忆中的聊天记录'), element('p', '仅显示该用户最近保存的私聊记录。群聊记忆见长期记忆区，不混入其他人的群聊发言。', 'detail-help'));
    const chatList = element('div', undefined, 'chat-history');
    for (const message of user.history) { const bubble = element('div', undefined, `chat-entry ${message.role === 'assistant' ? 'from-fish' : ''}`); bubble.append(element('small', `${message.role === 'assistant' ? '大肥鱼' : user.name} · ${date(message.time)}`), element('p', historyText(message.content))); chatList.append(bubble); }
    if (!user.history.length) empty(chatList, '没有近期私聊记录'); chats.append(chatList);
    if (user.summaries.length) { const details = element('details', undefined, 'memory-summaries'); details.append(element('summary', '查看睡眠整理的旧聊天摘录')); for (const summary of user.summaries.slice().reverse()) details.append(row(summary.text, `${summary.day} · ${summary.count || 0} 条原始记录`)); chats.append(details); }
    const relationPanel = element('article', undefined, 'panel relation-panel'); relationPanel.append(element('h3', '与这个人相处的心情'));
    const relationGrid = element('div', undefined, 'emotion-grid'); relationGrid.append(...emotionMeters(user.emotions, relationLabels)); relationPanel.append(relationGrid);
    columns.append(facts, chats); $('memoryDetailContent').replaceChildren(header, userActions, relationPanel, editor, columns);
  } catch (error) { if (request === memoryRequest) empty($('memoryDetailContent'), `读取失败：${error.message}`); }
}
function renderQQActivity() {
  const grouped = new Map(); for (const entry of qqEntries) grouped.set(entry.id, { ...grouped.get(entry.id), ...entry });
  const filter = $('qqActivityFilter').value; const rows = [...grouped.values()].reverse().filter(item => !filter || item.operation === filter);
  $('qqActivityCount').textContent = `${rows.length} 条操作`;
  if (!rows.length) return empty($('qqActivityList'), '暂无此类QQ空间足迹。新版运行后的空间操作会记录在这里。');
  const names = { publish: '发布动态', like: '点赞动态', comment: '评论动态', reply: '回复评论' };
  const states = { started: '处理中或未确认', succeeded: '接口确认成功', uncertain: '结果不确定', skipped: '已跳过' };
  $('qqActivityList').replaceChildren(...rows.map(item => {
    const node = element('div', undefined, 'row activity-row'); const heading = element('div', undefined, 'activity-heading');
    heading.append(element('strong', names[item.operation]), element('span', states[item.state] || '结果未知', `badge ${item.state === 'succeeded' ? 'good' : ''}`));
    node.append(heading, element('small', `${date(item.time)}${item.input?.owner ? ' · 空间主人 ' + item.input.owner : ' · 自己的空间'}${item.input?.tid || item.receipt?.tid ? ' · 动态 ' + (item.input?.tid || item.receipt.tid) : ''}`));
    if (item.input?.text) node.append(element('p', item.input.text)); return node;
  }));
}
async function qqActivity() { qqEntries = await api('/api/qq-activity'); renderQQActivity(); }
function personaCount() { $('personaCount').textContent = `${$('personaText').value.length} / 30000 字`; }
async function loadPersona() {
  const data = await api('/api/persona'); $('personaText').value = data.text; personaRevision = data.revision; personaLoaded = true; personaDirty = false;
  $('personaSaveNote').textContent = '已载入 persona.md'; personaCount();
  const backups = await api('/api/persona/backups');
  $('personaBackups').replaceChildren(...backups.map(backup => { const option = element('option', date(backup.time)); option.value = backup.id; return option; }));
  if (!backups.length) { const option = element('option', '保存修改后会自动生成备份'); $('personaBackups').append(option); }
  $('loadPersonaBackup').disabled = !backups.length;
}
async function loadComponents() {
  const data = await api('/api/components'); componentRevision = data.revision;
  $('componentList').replaceChildren(...data.components.map(item => {
    const card = element('article', undefined, 'panel component-card'); const heading = element('div', undefined, 'activity-heading');
    heading.append(element('h3', item.name), element('span', item.enabled ? '已启用' : item.installed ? '已关闭' : '未安装', `badge ${item.enabled ? 'good' : ''}`));
    card.append(heading, element('small', item.kind === 'mcp' ? 'MCP · 本地标准协议组件' : '内置能力'), element('p', item.description, 'component-description'));
    const tools = element('details', undefined, 'component-tools'); tools.append(element('summary', `提供的工具 · ${item.tools.length}`), element('p', item.tools.join('\n'))); card.append(tools);
    const button = element('button', item.installed ? item.enabled ? '关闭组件' : '开启组件' : '安装并启用', 'button'); button.type = 'button';
    button.setAttribute('aria-label', `${item.installed && item.enabled ? '关闭' : item.installed ? '开启' : '安装并启用'}${item.name}`);
    const save = async extra => {
      button.disabled = true;
      try { const result = await api('/api/components', { id: item.id, installed: true, enabled: item.enabled, revision: componentRevision, ...extra }); notice(result.message); await loadComponents(); }
      catch (error) { notice(error.message, true); button.disabled = false; }
    };
    button.addEventListener('click', () => save({ enabled: !item.enabled }));
    if (item.id === 'rss' && item.installed) {
      const settings = element('details', undefined, 'rss-settings'); settings.append(element('summary', '配置订阅源'));
      settings.append(element('p', '每项包含id、name、url，最多10个公开RSS/Atom源。', 'detail-help'));
      const input = element('textarea'); input.value = JSON.stringify(item.feeds, null, 2); input.setAttribute('aria-label', 'RSS订阅源JSON'); input.spellcheck = false; input.placeholder = '[{"id":"news","name":"订阅名称","url":"https://example.com/feed.xml"}]';
      const saveFeeds = element('button', '保存订阅源', 'button'); saveFeeds.type = 'button'; saveFeeds.addEventListener('click', () => { try { save({ feeds: JSON.parse(input.value) }); } catch (error) { notice(error.message, true); } });
      settings.append(input, saveFeeds); card.append(settings);
    }
    const footer = element('div', undefined, 'component-footer'); footer.append(element('span', item.kind === 'mcp' ? '首次调用时启动本地MCP进程' : '新工具调用即时生效', 'label'), button); card.append(footer); return card;
  }));
}
async function sync() {
  if (syncing) return; syncing = true;
  try { updateStatus(await api('/api/status')); logs = await api('/api/logs'); renderLogs(); $('clock').textContent = `北京时间 ${date(Date.now())}`; }
  catch (error) { $('syncState').textContent = '本地服务未连接'; notice(error.message, true); }
  finally { syncing = false; }
}
for (const nav of document.querySelectorAll('[data-page]')) nav.addEventListener('click', async () => {
  if (memoryEditorDirty && nav.dataset.page === 'memories') return;
  if (memoryEditorDirty && nav.dataset.page !== 'memories' && !confirm('离开会丢弃未保存的用户记忆编辑，继续吗？')) return;
  if (nav.dataset.page !== 'memories') memoryEditorDirty = false;
  page = nav.dataset.page; for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== page;
  window.scrollTo(0, 0); $('notice').hidden = true;
  for (const button of document.querySelectorAll('.nav')) button.classList.toggle('active', button === nav);
  $('pageTitle').textContent = titles[page]; $('startBtn').classList.toggle('primary', false);
  try { if (page === 'config' && !config) await loadConfig(); if (page === 'persona' && !personaLoaded) await loadPersona(); if (page === 'components') await loadComponents(); if (page === 'activity') await activity(); if (page === 'qqActivity') await qqActivity(); if (page === 'memories') { memoryDirectory(); memories = await api('/api/memories'); renderMemories(); } } catch (error) { notice(error.message, true); }
});
for (const button of document.querySelectorAll('[data-action]')) button.addEventListener('click', async () => {
  button.disabled = true; try { await api('/api/control', { action: button.dataset.action }); notice(button.dataset.action === 'stop' ? '已请求停止，正在等待当前任务安全结束。' : button.dataset.action === 'restart' ? '已请求重启，将先结束当前任务再重新启动。' : '已请求启动大肥鱼。'); await sync(); } catch (error) { notice(error.message, true); } finally { if (button.id !== 'startBtn') button.disabled = false; }
});
$('configForm').addEventListener('input', event => { if (event.target === $('rawConfig')) rawDirty = true; else { rawDirty = false; $('rawConfig').value = JSON.stringify(formConfig(), null, 2); } $('saveNote').textContent = '有未保存的更改'; });
$('configForm').addEventListener('submit', async event => { event.preventDefault(); $('saveConfig').disabled = true; try { const next = rawDirty ? JSON.parse($('rawConfig').value) : formConfig(); const result = await api('/api/config', { config: next, revision: configRevision }); config = next; configRevision = result.revision; renderConfig(); $('saveNote').textContent = '已保存 · 重启后生效'; notice(result.message); } catch (error) { notice(error.message, true); } finally { $('saveConfig').disabled = false; } });
$('reloadConfig').addEventListener('click', () => loadConfig().catch(error => notice(error.message, true)));
$('logSearch').addEventListener('input', renderLogs);
$('pauseLogs').addEventListener('click', () => { followLogs = !followLogs; $('pauseLogs').textContent = followLogs ? '暂停滚动' : '恢复滚动'; });
$('memorySearch').addEventListener('input', renderMemories);
$('refreshActivity').addEventListener('click', () => activity().catch(error => notice(error.message,true)));
$('refreshMemories').addEventListener('click', async () => { if (memoryEditorDirty && !confirm('刷新会丢弃未保存的用户资料编辑，继续吗？')) return; try { if (selectedUser) await showMemory(selectedUser); else { memories = await api('/api/memories'); renderMemories(); } } catch (error) { notice(error.message,true); } });
$('backToMemories').addEventListener('click', () => { if (!memoryEditorDirty || confirm('返回会丢弃未保存的编辑，继续吗？')) memoryDirectory(); });
$('memoryFilter').addEventListener('change', renderMemories);
for (const [id, layout] of [['memoryViewList', 'list'], ['memoryViewGrid', 'grid']]) $(id).addEventListener('click', () => { memoryLayout = layout; try { localStorage.setItem('memoryLayout', layout); } catch {} renderMemories(); });
$('qqActivityFilter').addEventListener('change', renderQQActivity);
$('refreshQQActivity').addEventListener('click', () => qqActivity().catch(error => notice(error.message, true)));
$('personaText').addEventListener('input', () => { personaDirty = true; personaCount(); $('personaSaveNote').textContent = '有未保存的更改'; });
$('reloadPersona').addEventListener('click', () => { if (personaDirty && !confirm('重新载入会丢弃编辑器里未保存的修改，继续吗？')) return; loadPersona().catch(error => notice(error.message, true)); });
$('personaForm').addEventListener('submit', async event => {
  event.preventDefault(); $('savePersona').disabled = true;
  try { const result = await api('/api/persona', { text: $('personaText').value, revision: personaRevision }); notice(result.message); await loadPersona(); }
  catch (error) { notice(error.message, true); } finally { $('savePersona').disabled = false; }
});
$('loadPersonaBackup').addEventListener('click', async () => {
  if (personaDirty && !confirm('载入备份会替换尚未保存的编辑内容，继续吗？')) return;
  try { const result = await api(`/api/persona/backups/${encodeURIComponent($('personaBackups').value)}`); $('personaText').value = result.text; personaDirty = true; personaCount(); $('personaSaveNote').textContent = '已载入旧版 · 点击保存才会覆盖文件'; }
  catch (error) { notice(error.message, true); }
});
$('refreshComponents').addEventListener('click', () => loadComponents().catch(error => notice(error.message, true)));
$('lifeForm').addEventListener('input', event => { if (event.target.dataset.life) { lifeDirty = true; lifeChanged.add(event.target.dataset.life); $('lifeSaveHint').textContent = '有未保存的修改'; } });
$('lifeForm').addEventListener('submit', async event => {
 event.preventDefault(); $('saveLife').disabled = true;
 try { const mood = {}; const rates = {}; const health = {}; for (const key of lifeChanged) { if (key.startsWith('health.')) health[key.slice(7)] = Number(lifeInputs[key].value); else if (Object.hasOwn(moodLabels,key) || key === 'energy') mood[key] = Number(lifeInputs[key].value); else rates[key] = Number(lifeInputs[key].value); }
  const result = await api('/api/life', { revision: lifeRevision, mood, health, ...(Object.keys(rates).length ? { rates } : {}) }); lifeDirty = false; lifeChanged.clear(); lifeRevision = result.revision; $('lifeSaveHint').textContent = '已保存，后台下次检查即生效（通常一分钟内）'; notice(result.message); await sync();
 } catch(error) { notice(error.message,true); } finally { $('saveLife').disabled = false; }
});
window.addEventListener('beforeunload', event => { if (personaDirty || memoryEditorDirty || lifeDirty) { event.preventDefault(); event.returnValue = ''; } });
(async () => { try { const response = await fetch('/api/session'); const session = await response.json(); token = session.token; $('address').textContent = location.host; await sync(); setInterval(sync, 2500); } catch (error) { notice(error.message,true); } })();
