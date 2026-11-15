import { modelSettings, normalizeCustomUrl } from './model-provider.js';

export const mediaKinds = ['image', 'speech', 'music', 'effect'];

const defaults = {
  openai: { image: '/images/generations', speech: '/audio/speech' },
  elevenlabs: { speech: '/text-to-speech/{voice}', music: '/music', effect: '/sound-generation' },
};

function invalid(message) {
  throw Object.assign(Error(message), { status: 400 });
}

export function normalizeMediaModel(kind, input, previous) {
  if (!mediaKinds.includes(kind) || typeof input?.enabled !== 'boolean') invalid('媒体模型配置无效');
  if (!input.enabled) return { ...previous, enabled: false };
  const { protocol, source, model, voice, route = '' } = input;
  if (typeof protocol !== 'string' || !Object.hasOwn(defaults, protocol) ||
      (kind === 'image' && protocol !== 'openai')) invalid('媒体协议无效');
  if (!['chat', 'custom'].includes(source)) invalid('API 来源无效');
  if (typeof model !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(model)) invalid('请输入有效的模型 ID');
  if (kind === 'speech' && (typeof voice !== 'string' || !/^[\w-]{1,128}$/.test(voice))) invalid('请输入音色名称或 ID');
  if (typeof route !== 'string' || (route && !/^\/(?:[\w-]+\/)*[\w-]+$/.test(route))) invalid('请输入有效的接口路径，例如 /audio/music');
  if (route.length > 150 || (!route && !defaults[protocol][kind])) invalid('音乐或音效的兼容网关需要填写接口路径');
  const value = { enabled: true, protocol, source, model, route, ...(kind === 'speech' ? { voice } : {}) };
  if (source === 'custom') {
    value.baseUrl = normalizeCustomUrl(input.baseUrl);
    const sameProvider = previous?.source === 'custom' && previous.protocol === protocol &&
      new URL(previous.baseUrl).origin === new URL(value.baseUrl).origin;
    value.apiKey = input.apiKey || (sameProvider ? previous.apiKey : '');
    if (typeof value.apiKey !== 'string' || !/^[\x21-\x7e]{8,300}$/.test(value.apiKey)) invalid('请填写此供应商的 API Key');
  }
  return value;
}

export function publicMediaModels(secrets) {
  return Object.fromEntries(mediaKinds.map(kind => {
    const { apiKey, ...safe } = secrets.mediaModels?.[kind] || { enabled: false };
    return [kind, { ...safe, keySet: !!apiKey }];
  }));
}

export function runtimeMediaModels(secrets) {
  const chat = modelSettings(secrets);
  return Object.fromEntries(mediaKinds.flatMap(kind => {
    const profile = secrets.mediaModels?.[kind];
    if (!profile?.enabled) return [];
    const base = normalizeCustomUrl(profile.source === 'chat' ? chat.baseUrl : profile.baseUrl);
    const route = (profile.route || defaults[profile.protocol][kind]).replace('{voice}', profile.voice || '');
    const rootCompletion = /\/chat\/completions$/.test(base);
    const prefix = rootCompletion ? base.replace(/\/chat\/completions$/, '') : base;
    const endpoint = prefix.endsWith(route) ? prefix : prefix + route;
    return [[kind, {
      endpoint, protocol: profile.protocol, model: profile.model, voice: profile.voice,
      apiKey: profile.source === 'chat' ? secrets.apiKey : profile.apiKey,
    }]];
  }));
}
