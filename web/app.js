const $ = id => document.getElementById(id);
let token = ''; let config = null; let configRevision = ''; let page = 'overview'; let rawDirty = false; let logs = []; let memories = []; let followLogs = true; let syncing = false;
const titles = { overview: '状态总览', config: '配置设置', logs: '运行日志', activity: 'B站足迹', memories: '用户记忆' };
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
  if (s.summary.length) $('decisions').replaceChildren(...s.summary.slice().reverse().map(item => row(item.summary, `${item.stage} · ${date(item.time)}`))); else empty($('decisions'), '还没有回应概述，等她聊起来吧');
  const tasks = s.tasks.filter(item => ['pending', 'running'].includes(item.status));
  if (tasks.length) $('tasks').replaceChildren(...tasks.map(item => row(item.prompt, `${item.status === 'running' ? '执行中' : '计划中'} · ${date(item.due)}`))); else empty($('tasks'), '暂时没有安排，今天可以慢慢来');
  $('memoryTime').textContent = s.lastMemoryCompression ? `最近记忆整理 · ${date(s.lastMemoryCompression)}` : '睡眠时会自动整理当天记忆';
  $('syncState').textContent = `最近更新 ${date(Date.now()).split(' ').at(-1)}`;
}
const groups = [
  ['发布与额度', [ ['social.maxQzonePostsPerHour','QQ空间发布','最近一小时上限，0表示禁发','number',0], ['bilibili.maxDynamicsPerHour','B站动态发布','最近一小时上限，0表示禁发','number',0], ['agent.maxOutgoingPerHour','全部发送额度','每小时总量，分条消息逐条计数','number',1], ['agent.maxModelCallsPerHour','模型请求额度','每小时上限，0表示不限次数','number',0] ]],
  ['自主生活', [ ['social.enabled','自主社交','让她自己找话题与合适的人','checkbox'], ['social.intervalMinutes','社交间隔','分钟，保存后重启生效','number',1], ['bilibili.browseMinutes','B站浏览间隔','分钟，保存后重启生效','number',1], ['social.followupEnabled','未回复时轻轻跟进','最多一次，不连续催促','checkbox'], ['social.followupWaitMinutes','跟进等待','分钟，至少10分钟','number',10] ]],
  ['QQ与声音', [ ['qq.enabled','QQ连接','使用本机NapCat连接','checkbox'], ['qq.adminUsers','管理员QQ号','多个号码用逗号分隔','admins'], ['qq.requireMentionInGroup','群聊需要@','关闭时由她自主判断是否参与','checkbox'], ['social.voiceName','语音音色','选择本机已安装的音色','voice'], ['social.qzoneVisibility','QQ空间可见范围','新发布动态使用此设置','visibility'] ]],
  ['平台与日志', [ ['bilibili.enabled','B站活动','关闭后暂停B站查询和互动','checkbox'], ['social.qzoneEnabled','QQ空间发布','控制空间说说发布功能','checkbox'], ['social.qzoneAutoReply','空间评论自主回复','按语境判断，不每条都回','checkbox'], ['logging.replySummary','回复决策概述','在后台记录简短回应意图','checkbox'] ]],
];
const getPath = (object, key) => key.split('.').reduce((value, part) => value?.[part], object);
function setPath(object, key, value) { const parts = key.split('.'); let base = object; for (const part of parts.slice(0, -1)) base = base[part] ||= {}; base[parts.at(-1)] = value; }
function formConfig() {
  const next = structuredClone(config);
  for (const input of document.querySelectorAll('[data-setting]')) {
    const value = input.type === 'checkbox' ? input.checked : input.dataset.kind === 'admins' ? [...new Set(input.value.split(/[\s,，]+/).filter(Boolean))] : input.type === 'number' || input.dataset.kind === 'visibility' ? Number(input.value) : input.value;
    setPath(next, input.dataset.setting, value);
  }
  return next;
}
function renderConfig() {
  $('configFields').replaceChildren();
  for (const [title, fields] of groups) {
    const fieldset = element('fieldset'); fieldset.append(element('legend', title));
    for (const [key, label, help, kind, min] of fields) {
      const wrap = element('label', undefined, 'field'); const labelNode = element('span', undefined, 'field-label'); labelNode.append(element('span', label), element('small', help));
      const input = element(['voice','visibility'].includes(kind) ? 'select' : 'input');
      input.dataset.setting = key; input.dataset.kind = kind;
      if (input.tagName === 'SELECT') {
        const options = kind === 'voice' ? [['Microsoft Huihui Desktop','慧慧 · 中文女声'], ['chaowen','chaowen · 本地中文']] : [['1','所有人'],['4','好友'],['64','仅自己']];
        const current = String(getPath(config, key) ?? ''); if (!options.some(item => item[0] === current) && current) options.push([current,current]);
        for (const [value, text] of options) { const option = element('option', text); option.value = value; input.append(option); }
        input.value = current;
      } else { input.type = kind === 'checkbox' ? 'checkbox' : kind === 'number' ? 'number' : 'text'; if (kind === 'checkbox') input.checked = !!getPath(config,key); else input.value = kind === 'admins' ? (getPath(config,key) || []).join(', ') : getPath(config,key) ?? ''; if (kind === 'number') { input.min = min; input.step = 1; input.required = true; } }
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
  const users = memories.filter(user => `${user.name} ${user.id}`.toLowerCase().includes(term));
  if (!users.length) return empty($('memoryList'), '暂时没有匹配的用户记忆。聊过以后，她会慢慢记住。');
  $('memoryList').replaceChildren(...users.map(user => {
    const card = element('article', undefined, 'panel'); const title = element('h3', user.name); title.append(element('span', `好感 ${user.affinity}`, 'badge')); card.append(title, element('small', `QQ ${user.id} · 信任 ${user.trust}${user.contactPaused ? ' · 暂停主动联系' : ''}`));
    const list = element('div', undefined, 'list');
    for (const memory of user.memories.slice(-8)) list.append(row(memory.quote, `${memory.scope} · ${date(memory.time)}`));
    if (!user.memories.length) empty(list, '还没有保存具体的小事'); card.append(list); return card;
  }));
}
async function sync() {
  if (syncing) return; syncing = true;
  try { updateStatus(await api('/api/status')); logs = await api('/api/logs'); renderLogs(); $('clock').textContent = `北京时间 ${date(Date.now())}`; }
  catch (error) { $('syncState').textContent = '本地服务未连接'; notice(error.message, true); }
  finally { syncing = false; }
}
for (const nav of document.querySelectorAll('[data-page]')) nav.addEventListener('click', async () => {
  page = nav.dataset.page; for (const section of document.querySelectorAll('.page')) section.hidden = section.id !== page;
  for (const button of document.querySelectorAll('.nav')) button.classList.toggle('active', button === nav);
  $('pageTitle').textContent = titles[page]; $('startBtn').classList.toggle('primary', false);
  try { if (page === 'config' && !config) await loadConfig(); if (page === 'activity') await activity(); if (page === 'memories') { memories = await api('/api/memories'); renderMemories(); } } catch (error) { notice(error.message, true); }
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
$('refreshMemories').addEventListener('click', async () => { try { memories = await api('/api/memories'); renderMemories(); } catch (error) { notice(error.message,true); } });
(async () => { try { const response = await fetch('/api/session'); const session = await response.json(); token = session.token; $('address').textContent = location.host; await sync(); setInterval(sync, 2500); } catch (error) { notice(error.message,true); } })();
