import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadConfig() {
  const local = path.join(ROOT, 'config.json');
  if (!fs.existsSync(local)) fs.copyFileSync(path.join(ROOT, 'config.example.json'), local);
  const config = JSON.parse(fs.readFileSync(local, 'utf8').replace(/^\uFEFF/, ''));
  return normalizeConfig(config);
}
export function normalizeConfig(config) {
  config.qq.mergeSeconds ??= 8;
  config.qq.maxWaitSeconds ??= 25;
  config.qq.adminUsers ??= [];
  if (!Array.isArray(config.qq.adminUsers) || config.qq.adminUsers.some(id => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))) throw new Error('qq.adminUsers 须为管理员QQ号字符串数组，不支持通配符');
  config.agent.contextMaxChars ??= 24000;
  config.runtime ??= 'harness';
  if (!['harness', 'direct'].includes(config.runtime)) throw new Error('runtime 必须为 harness 或 direct');
  config.social = { enabled: true, intervalMinutes: 10, qzoneEnabled: true, qzoneVisibility: 1, ...config.social };
  config.social.contactCooldownMinutes ??= 180;
  config.social.followupEnabled ??= true;
  config.social.followupWaitMinutes ??= 30;
  if (typeof config.social.followupEnabled !== 'boolean' || !Number.isInteger(config.social.followupWaitMinutes) || config.social.followupWaitMinutes < 10) throw new Error('未回复跟进等待时间至少10分钟');
  config.social.qzoneAutoReply ??= true;
  config.social.qzonePollMinutes ??= 10;
  config.social.voiceName ??= 'chaowen';
  config.social.maxQzonePostsPerHour ??= 1;
  config.bilibili.maxDynamicsPerHour ??= 1;
  for (const [name, value] of Object.entries({ 'social.maxQzonePostsPerHour': config.social.maxQzonePostsPerHour, 'bilibili.maxDynamicsPerHour': config.bilibili.maxDynamicsPerHour })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} 须为非负整数，0表示禁止发布`);
  }
  config.logging = { replySummary: true, ...config.logging };
  config.web = { enabled: true, port: 3081, openBrowser: true, ...config.web };
  if (typeof config.web.enabled !== 'boolean' || typeof config.web.openBrowser !== 'boolean' || !Number.isInteger(config.web.port) || config.web.port < 1024 || config.web.port > 65535) throw new Error('Web面板端口须为1024至65535，开关须为布尔值');
  if (typeof config.logging.replySummary !== 'boolean') throw new Error('logging.replySummary 须为布尔值');
  if (typeof config.social.qzoneAutoReply !== 'boolean' || !Number.isInteger(config.social.qzonePollMinutes) || config.social.qzonePollMinutes < 5) throw new Error('空间自动回复配置无效，检查间隔至少5分钟');
  if (!Number.isInteger(config.social.contactCooldownMinutes) || config.social.contactCooldownMinutes < 10) throw new Error('主动联系同一用户的间隔至少10分钟');
  if (!(config.qq.mergeSeconds >= 1 && config.qq.maxWaitSeconds >= config.qq.mergeSeconds && config.qq.maxWaitSeconds <= 120)) throw new Error('消息等待时间须为1至120秒，最大等待须不小于合并等待');
  if (!Number.isInteger(config.social.intervalMinutes) || config.social.intervalMinutes < 1) throw new Error('自主社交间隔至少1分钟');
  if (![1, 4, 64].includes(config.social.qzoneVisibility)) throw new Error('空间可见范围须为1所有人、4好友或64自己');
  for (const [name, value] of Object.entries({
    pollSeconds: config.bilibili.pollSeconds, browseMinutes: config.bilibili.browseMinutes,
    maxVideosPerRound: config.bilibili.maxVideosPerRound, ...config.agent,
  })) {
    if (name === 'maxModelCallsPerHour' && value === 0) continue;
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`配置 ${name} 必须为正整数`);
  }
  if (config.bilibili.pollSeconds < 30) throw new Error('B站轮询间隔至少 30 秒');
  if (!Number.isFinite(config.qq.cooldownSeconds) || config.qq.cooldownSeconds < 0) throw new Error('QQ冷却时间必须为非负数');
  for (const list of [config.bilibili.allowMentionUsers]) {
    if (!Array.isArray(list) || list.some(x => typeof x !== 'string')) throw new Error('允许列表必须是字符串数组');
  }
  config.apiKey = process.env.DEEPSEEK_API_KEY || '';
  config.baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com';
  config.model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  config.wsUrl = process.env.NAPCAT_WS_URL || 'ws://127.0.0.1:3001';
  config.wsToken = process.env.NAPCAT_TOKEN || '';
  config.persona = fs.readFileSync(path.join(ROOT, 'persona.md'), 'utf8');
  return config;
}
export const allowed = (list, id) => list.includes('*') || list.includes(String(id));
