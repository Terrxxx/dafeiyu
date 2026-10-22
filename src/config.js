import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function loadConfig() {
  const local = path.join(ROOT, 'config.json');
  if (!fs.existsSync(local)) fs.copyFileSync(path.join(ROOT, 'config.example.json'), local);
  const config = JSON.parse(fs.readFileSync(local, 'utf8').replace(/^\uFEFF/, ''));
  config.qq.mergeSeconds ??= 8;
  config.qq.maxWaitSeconds ??= 25;
  config.social = { enabled: true, intervalMinutes: 60, qzoneEnabled: true, qzoneVisibility: 4, ...config.social };
  if (!(config.qq.mergeSeconds >= 1 && config.qq.maxWaitSeconds >= config.qq.mergeSeconds && config.qq.maxWaitSeconds <= 120)) throw new Error('消息等待时间须为1至120秒，最大等待须不小于合并等待');
  if (!Number.isInteger(config.social.intervalMinutes) || config.social.intervalMinutes < 1) throw new Error('自主社交间隔至少1分钟');
  if (![1, 4, 64].includes(config.social.qzoneVisibility)) throw new Error('空间可见范围须为1所有人、4好友或64自己');
  for (const [name, value] of Object.entries({
    pollSeconds: config.bilibili.pollSeconds, browseMinutes: config.bilibili.browseMinutes,
    maxVideosPerRound: config.bilibili.maxVideosPerRound, ...config.agent,
  })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`配置 ${name} 必须为正整数`);
  }
  if (config.bilibili.pollSeconds < 30) throw new Error('B站轮询间隔至少 30 秒');
  if (!Number.isFinite(config.qq.cooldownSeconds) || config.qq.cooldownSeconds < 0) throw new Error('QQ冷却时间必须为非负数');
  for (const list of [config.qq.allowUsers, config.qq.allowGroups, config.bilibili.allowMentionUsers]) {
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
