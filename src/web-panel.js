import{readQQProfiles}from'./qq-profiles.js';
import{usageStatistics}from'./usage-analytics.js';
import{siteComponentAllowed,enforceComponentPolicy}from'./component-policy.js';
import{storageSnapshot,clearImages}from'./storage.js';
import{dailyStatus}from'./daily-budget.js';
import { normalizeQQPolicy } from './qq-policy.js';
import localVoices from './voices.cjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { ROOT, normalizeConfig } from './config.js';
import { atomicWriteFile } from './atomic-file.js';
import { componentCatalog, componentEnabled, normalizeComponents } from './component-catalog.js';
import { readUserControls, writeUserControl, purgeUserArchives } from './user-controls.js';
import { readUserMemory, saveUserMemory, deleteUserMemory, userMemoryRevision, withUserLock } from './user-memory.js';
import { personMemoryOverview } from './person-memory.js';
import { memoryDateLabel, notableMemory } from './memory-age.js';
import { relationBase, normalizeEmotion, effectiveMood } from './emotion-state.js';
import { LocalWeather } from './weather.js';
import { lifeView, saveLifeControls } from './life-controls.js';
import {messageStatusView} from './qq-processing.js';


export function tailJson(file, count = 100) {
  if (!fs.existsSync(file)) return [];
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size; const start = Math.max(0, size - 256 * 1024);
    const buffer = Buffer.alloc(size - start); fs.readSync(fd, buffer, 0, buffer.length, start);
    const lines = buffer.toString('utf8').split('\n'); if (start) lines.shift();
    return lines.filter(Boolean).slice(-count).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } finally { fs.closeSync(fd); }
}
const revision = text => createHash('sha256').update(text).digest('hex');
export async function startWebPanel({ root = ROOT, port = 3081, controller, dataRoot = path.join(root, 'data') }) {
  const token = randomBytes(32).toString('hex');
  const configFile = path.join(root, 'config.json');
  const dataFile = path.join(dataRoot, 'state.json');
  const runtimeConfig = () => ({ ...JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, '')), ...controller.model?.() });
  const personaFile = path.join(root, 'persona.md');
  const personaBackups = path.join(dataRoot, 'persona-history');
  const backupIds = () => fs.existsSync(personaBackups) ? fs.readdirSync(personaBackups).filter(id => /^\d{13}-[a-f0-9]{12}\.md$/.test(id)).sort().reverse() : [];
  const state = () => {const value=fs.existsSync(dataFile)?JSON.parse(fs.readFileSync(dataFile,'utf8')):{};Object.defineProperty(value,'profileNames',{value:readQQProfiles(dataRoot),enumerable:false});return value;};
  const dataDirectory = dataRoot;
  const visibleUser = (s, controls, id) => {
    const control = controls[id] || {}; let user = s.feelings?.users?.[id];
    if (control.forgottenAt && (!user?.lastIncoming || user.lastIncoming <= control.forgottenAt)) user = null;
    if (!user && !control.blocked) return null;
    const scores = control.scoreRevision && s.userControlsApplied?.[id]?.scoreRevision !== control.scoreRevision ? control.scores : {};
    return { affinity: 0, trust: 30, familiarity: 0, ...user, ...scores, emotions: normalizeEmotion(scores?.emotions || user?.emotions, relationBase), id, name: s.profileNames[id]?.nickname || user?.qqNickname || id,remark:control.remark||'',nicknameVerified:!!(s.profileNames[id]?.nickname||user?.qqNickname),remarkRevision:revision(control.remark||''),
      blocked: control.blocked === true, memories: (user?.memories || []).filter(m => !control.editedScopes?.[m.scope] || (m.time || 0) > control.editedScopes[m.scope]) };
  };
  const server = http.createServer(async (req, res) => {
    const send = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(value)); };
    try {
      const actualPort = server.address().port;
      const hosts = [`127.0.0.1:${actualPort}`, `localhost:${actualPort}`];
      if (!hosts.includes(req.headers.host)) return send(403, { error: '仅允许本机面板地址' });
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === 'GET' && url.pathname === '/api/session') return send(200, { token });
      if (req.headers['x-panel-token'] !== token) {
        if (url.pathname.startsWith('/api/')) return send(403, { error: '面板会话失效，请刷新页面' });
      }
      if(req.method==='GET'&&url.pathname==='/api/voices')return send(200,Object.keys(localVoices.voices).map(id=>{let installed=false;try{localVoices.voiceConfig(id);installed=true;}catch{}return {id,name:({'chaowen':'朝雯 · 中文','kokoro-zf_001':'中文女声 001','kokoro-zf_017':'清亮女声 017','kokoro-zf_036':'中文女声 036'})[id]||id,installed};}));
      if(req.method==='GET'&&url.pathname==='/api/message-status'){
        const s=state(),config=runtimeConfig();
        return send(200,messageStatusView(dataRoot,{service:controller.status(),sleep:s.sleep,daily:dailyStatus(dataRoot,config),energy:s.feelings?.mood?.energy}));
      }
      if (req.method === 'GET' && url.pathname === '/api/status') {
        const s = state();
        const config = runtimeConfig();
        const weather = new LocalWeather(config.weather, { data: s }).snapshot();
        const life = lifeView(dataDirectory, s);life.editable=config.life?.editingEnabled===true;
        return send(200, { usage:usageStatistics(dataRoot,config),storage:(()=>{const{items,...summary}=storageSnapshot(dataRoot,s);return summary;})(),daily:dailyStatus(dataRoot,config), service: controller.status(), mood: s.feelings?.mood || life.revision ? effectiveMood(life.mood) : null, life, weather, sleep: s.sleep || null,
          unread: s.sleepUnread?.length || 0, users: Object.keys(s.feelings?.users || {}).filter(id => visibleUser(s, readUserControls(dataDirectory), id)).length,
          messageStatus:messageStatusView(dataRoot,{service:controller.status(),sleep:s.sleep,daily:dailyStatus(dataRoot,config),energy:s.feelings?.mood?.energy}),
          tasks: (s.tasks || []).slice(-10).reverse(), lastMemoryCompression: s.meta?.lastMemoryCompression,
          summary: tailJson(path.join(dataRoot, 'actions.jsonl')).filter(row => row.type === 'reply-summary').slice(-8) });
      }
      if(req.method==='GET'&&url.pathname==='/api/usage')return send(200,usageStatistics(dataRoot,JSON.parse(fs.readFileSync(configFile,'utf8'))));
      if(req.method==='GET'&&url.pathname==='/api/storage')return send(200,storageSnapshot(dataRoot,state()));
      if (req.method === 'GET' && url.pathname === '/api/config') {
        const text = fs.readFileSync(configFile, 'utf8'); const config=JSON.parse(text.replace(/^\uFEFF/, ''));normalizeQQPolicy(config.qq);for(const key of ['readFansEnabled','readFollowingEnabled','readInboxEnabled','replyInboxEnabled'])config.bilibili[key]??=true; if(config.social)delete config.social.browserPath; return send(200, { config, revision: revision(text), limitsSuspended: controller.model?.()?.provider === 'custom' });
      }
      if (req.method === 'GET' && url.pathname === '/api/persona') {
        const text = fs.readFileSync(personaFile, 'utf8'); return send(200, { text, revision: revision(text) });
      }
      if (req.method === 'GET' && url.pathname === '/api/persona/backups') return send(200, backupIds().slice(0, 10).map(id => ({ id, time: Number(id.slice(0, 13)) })));
      const backupId = url.pathname.match(/^\/api\/persona\/backups\/(\d{13}-[a-f0-9]{12}\.md)$/)?.[1];
      if (req.method === 'GET' && backupId) {
        if (!backupIds().includes(backupId)) return send(404, { error: '备份不存在' });
        return send(200, { text: fs.readFileSync(path.join(personaBackups, backupId), 'utf8') });
      }
      if (req.method === 'GET' && url.pathname === '/api/components') {
        const text = fs.readFileSync(configFile, 'utf8'); const config = JSON.parse(text.replace(/^\uFEFF/, '')); const settings = normalizeComponents(config.components || {});
        return send(200, { revision: revision(text), components: componentCatalog.map(item => ({ id: item.id, name: item.name, description: item.description,
          kind: item.builtin ? 'builtin' : 'mcp', siteDisabled:!siteComponentAllowed(item.id,dataRoot), unavailable:!!item.unavailable||!siteComponentAllowed(item.id,dataRoot), installed: item.builtin || settings[item.id]?.installed === true,
          enabled: siteComponentAllowed(item.id,dataRoot)&&componentEnabled(item, settings), feeds: item.id === 'rss' ? settings.rss?.feeds || [] : undefined,
          tools: item.schemas?.map(s => s.function.name) || item.tools || [item.prefix + '*'] })) });
      }
      if (req.method === 'GET' && url.pathname === '/api/logs') {const marker=path.join(dataRoot,'log-clear.json');const after=fs.existsSync(marker)?JSON.parse(fs.readFileSync(marker,'utf8')).after:0;return send(200,controller.logs().filter(row=>!after||new Date(row.time).getTime()>after));}
      if (req.method === 'GET' && url.pathname === '/api/activity') return send(200, tailJson(path.join(dataRoot, 'bilibili-activity.jsonl'), 150));
      if (req.method === 'GET' && url.pathname === '/api/qq-activity') return send(200, tailJson(path.join(dataRoot, 'qq-activity.jsonl'), 300)
        .filter(entry => ['publish', 'like', 'comment', 'reply','read','read_comments','profile'].includes(entry.operation)));
      if (req.method === 'GET' && url.pathname === '/api/memories') {
        const s = state(); const controls = readUserControls(dataDirectory);
        return send(200, [...new Set([...Object.keys(s.feelings?.users || {}), ...Object.keys(controls)])].flatMap(id => {
          const user = visibleUser(s, controls, id); if (!user) return [];
          return [{ id, name: user.name || id,remark:user.remark,nicknameVerified:user.nicknameVerified,
          affinity: user.affinity, trust: user.trust, familiarity: user.familiarity, contactPaused: user.contactPaused,
          lastIncoming: user.lastIncoming, blocked: user.blocked, memoryCount: user.memories?.length || 0 }];
        }));
      }
      const memoryId = url.pathname.match(/^\/api\/memories\/([1-9]\d*)$/)?.[1];
      if (req.method === 'GET' && memoryId) {
        const s = state(); const controls = readUserControls(dataDirectory); const user = visibleUser(s, controls, memoryId);
        if (!user) return send(404, { error: '没有找到该用户' });
        const scope = `qq:user:${memoryId}`;
        // Details are for the local administrator, never fed back into the agent.
        // Do not attach whole group transcripts containing unrelated participants.
        const ledger = readUserMemory(dataDirectory, memoryId); const forgottenAt = controls[memoryId]?.forgottenAt || 0;
        if (url.searchParams.get('view') === 'overview') {
          return send(200, personMemoryOverview(ledger, Number(url.searchParams.get('page') || 1)));
        }
        return send(200, { id: memoryId, name: user.name || memoryId,remark:user.remark,remarkRevision:user.remarkRevision,nicknameVerified:user.nicknameVerified, affinity: user.affinity, trust: user.trust,
          familiarity: user.familiarity, emotions: user.emotions, contactPaused: user.contactPaused, lastIncoming: user.lastIncoming,
          memories: user.memories || [], blocked: user.blocked,
          checklist: { sections: ledger.sections, updatedAt: ledger.updatedAt, revision: userMemoryRevision(ledger) },
          history: (s.histories?.[scope] || []).filter(item => ['user', 'assistant'].includes(item.role))
            .filter(item => !forgottenAt || new Date(item.time).getTime() > forgottenAt)
            .slice(-100).map(({ role, content, time }) => ({ role, content, time, displayTime: memoryDateLabel(time, Date.now(), notableMemory(content)) })),
          summaries: (!forgottenAt || s.userControlsApplied?.[memoryId]?.forgottenAt === forgottenAt ? s.sleepSummaries?.[scope] || [] : []).slice(-12).map(({ day, text, count }) => ({ day, text, count })),
        });
      }
      if (req.method === 'POST') {
        if (!hosts.some(host => req.headers.origin === `http://${host}`) || req.headers['content-type']?.split(';')[0] !== 'application/json') return send(403, { error: '请求来源无效' });
        let text = ''; for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 512 * 1024) return send(413, { error: '请求内容过大' }); }
        const body = JSON.parse(text || '{}');
        if (url.pathname === '/api/logs/clear') {atomicWriteFile(path.join(dataRoot,'log-clear.json'),JSON.stringify({after:Date.now()}));return send(200,{message:'运行日志已清空；业务足迹和审计记录保留'});}
        if(url.pathname==='/api/storage/clear')return send(200,clearImages(dataRoot,body));
        if (url.pathname === '/api/life') {
          if(JSON.parse(fs.readFileSync(configFile,'utf8')).life?.editingEnabled!==true)return send(403,{error:'情绪与精力默认只读，请先在设置中允许编辑'});
          const control = saveLifeControls(dataDirectory, body);
          return send(200, { revision: control.revision, message: '已保存，运行中后台下次检查即生效；停止时将在启动后应用。精力0会立刻入睡，耗尽睡眠仍保留08:00–08:30随机锁定。' });
        }
        if (memoryId) {
          const s = state(); const controls = readUserControls(dataDirectory); const user = visibleUser(s, controls, memoryId);
          if (!user) return send(404, { error: '没有找到该用户' });
          if (body.action === 'block' || body.action === 'unblock') {
            writeUserControl(dataDirectory, memoryId, { blocked: body.action === 'block', name: user.name });
            return send(200, { message: body.action === 'block' ? '已在程序内屏蔽：私聊、群聊发言和待处理消息将被过滤，保留QQ好友关系' : '已解除程序屏蔽，之后的新消息可以正常接收' });
          }
          if (body.action === 'delete') {
            withUserLock(dataDirectory, memoryId, () => {
              writeUserControl(dataDirectory, memoryId, { forgottenAt: Date.now(), name: user.name, scores: undefined, scoreRevision: undefined, editedScopes: {} });
              deleteUserMemory(dataDirectory, memoryId);
              const groups = [...new Set([...(user.groups || []), ...user.memories.map(m => m.scope).filter(key => key?.startsWith('qq:group:'))])];
              purgeUserArchives(dataDirectory, memoryId, groups);
            });
            return send(200, { message: '已删除该用户的AI可用记忆、压缩清单、私聊归档和便签；运行中旧回复会取消，新消息将重新认识。涉及该用户的群短期上下文也会清空' });
          }
          if(body.action==='remark'){if(typeof body.remark!=='string'||body.remark.length>80||/[\r\n\0]/.test(body.remark))return send(400,{error:'备注最多80字，不支持换行'});if(body.revision!==user.remarkRevision)return send(409,{error:'备注已变化，请刷新后重试'});writeUserControl(dataDirectory,memoryId,{remark:body.remark.trim()});return send(200,{message:'备注已保存，不会修改QQ昵称或关系数值'});}
          if (body.action === 'save') {
            if(['scores','affinity','trust','familiarity','emotions'].some(key=>Object.hasOwn(body,key)))return send(400,{error:'好感度、信任度、熟悉度和用户情绪由互动自然形成，不允许手动修改'});
            const ledger = withUserLock(dataDirectory, memoryId, () => {
              const value = readUserMemory(dataDirectory, memoryId);
              if (body.revision !== userMemoryRevision(value)) throw Object.assign(new Error('记忆已被睡眠整理或其他窗口修改，请刷新后再保存'), { status: 409 });
              const allowed = new Set([`qq:user:${memoryId}`, ...(user.groups || []), ...user.memories.map(m => m.scope), ...Object.keys(value.sections)]);
              if (!allowed.has(body.scope) || typeof body.text !== 'string' || body.text.length > 50000) throw new Error('记忆来源无效或清单超过50000字');
              value.sections[body.scope] = { text: body.text, updatedAt: Date.now(), editedAt: Date.now() }; value.updatedAt = Date.now();
              saveUserMemory(dataDirectory, memoryId, value);
              const previous = controls[memoryId] || {};
              writeUserControl(dataDirectory, memoryId, { editedScopes: { ...previous.editedScopes, [body.scope]: Date.now() } });
              return value;
            });
            return send(200, { revision: userMemoryRevision(ledger), message: '用户记忆清单已保存，新回复使用最新资料；群聊不会获得私聊清单' });
          }
          return send(400, { error: '不支持的用户记忆操作' });
        }
        if (url.pathname === '/api/persona') {
          const old = fs.readFileSync(personaFile, 'utf8');
          if (revision(old) !== body.revision) return send(409, { error: '提示词已被其他窗口或编辑器修改，请重新载入再保存' });
          if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 30000 || body.text.includes('\0')) return send(400, { error: '提示词须为1至30000字，不包含空字符' });
          if (old !== body.text) {
            fs.mkdirSync(personaBackups, { recursive: true });
            atomicWriteFile(path.join(personaBackups, `${Date.now()}-${revision(old).slice(0, 12)}.md`), old);
            atomicWriteFile(personaFile, body.text);
            for (const id of backupIds().slice(10)) fs.unlinkSync(path.join(personaBackups, id));
          }
          return send(200, { revision: revision(body.text), message: '提示词已保存并保留旧版备份，重启大肥鱼后生效' });
        }
        if (url.pathname === '/api/components') {
          const old = fs.readFileSync(configFile, 'utf8');
          if (revision(old) !== body.revision) return send(409, { error: '配置已变化，请刷新组件列表后重试' });
          const item = componentCatalog.find(c => c.id === body.id);
          if(item&&!siteComponentAllowed(item.id,dataRoot))return send(403,{error:'站点管理员已停用此组件'});
          if(item?.unavailable)return send(403,{error:'该组件暂时停用'});
          if (!item || typeof body.enabled !== 'boolean' || body.installed !== undefined && typeof body.installed !== 'boolean') return send(400, { error: '组件ID或开关无效' });
          const config = JSON.parse(old.replace(/^\uFEFF/, '')); config.components ||= {};
          config.components[item.id] = { ...config.components[item.id], installed: item.builtin || body.installed === true || config.components[item.id]?.installed === true, enabled: body.enabled,
            ...(body.feeds !== undefined ? { feeds: body.feeds } : {}) };
          normalizeComponents(config.components);
          if (!item.builtin && body.enabled && !config.components[item.id].installed) return send(400, { error: '请先安装组件' });
          const output = JSON.stringify(config, null, 2) + '\n'; atomicWriteFile(configFile, output);
          return send(200, { revision: revision(output), message: '组件设置已保存，新请求立即使用新的开关；已在执行的请求可能完成' });
        }
        if (url.pathname === '/api/config') {
          const old = fs.readFileSync(configFile, 'utf8');
          if (revision(old) !== body.revision) return send(409, { error: '配置已被其他窗口修改，请重新载入后再保存' });
          const config = body.config;
          if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => !['qq', 'bilibili', 'agent', 'social', 'logging', 'runtime', 'web', 'components', 'weather', 'limits', 'life'].includes(key))) return send(400, { error: '仅支持程序配置，密钥请保留在.env中' });
          if (config.social && Object.hasOwn(config.social, 'browserPath')) return send(400, { error: '浏览器由系统自动选择，不允许设置程序路径' });
          normalizeConfig(structuredClone(config));
          enforceComponentPolicy(config,dataRoot);
          const output = JSON.stringify(config, null, 2) + '\n';
          atomicWriteFile(configFile, output);
          return send(200, { revision: revision(output), message: '配置已保存；重启大肥鱼后生效' });
        }
        if (url.pathname === '/api/control' && ['start', 'stop', 'restart'].includes(body.action)) return send(202, await controller.control(body.action));
      }
      const assets = { '/': ['index.html', 'text/html'], '/app.js': ['app.js', 'text/javascript'], '/theme.js': ['theme.js', 'text/javascript'], '/style.css': ['style.css', 'text/css'] };
      const asset = req.method === 'GET' && assets[url.pathname];
      if (!asset) return send(404, { error: '页面不存在' });
      res.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'" });
      res.end(fs.readFileSync(path.join(ROOT, 'web', asset[0])));
    } catch (error) { if (!res.headersSent) send(error.status || 400, { error: error.message }); else res.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return server;
}

