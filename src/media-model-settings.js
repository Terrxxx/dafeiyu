import { modelSettings, normalizeCustomUrl, publicHttpsUrl } from './model-provider.js';

const maxSpeechInstructions = 4096;

export const mediaKinds = ['image', 'speech', 'music', 'effect'];

const defaults = {
  openai: { image: '/images/generations', speech: '/audio/speech' },
  elevenlabs: { speech: '/text-to-speech/{voice}', music: '/music', effect: '/sound-generation' },
};

function invalid(message) {
  throw Object.assign(Error(message), { status: 400 });
}

export function normalizeMediaModel(kind, input, previous, chatBaseUrl) {
  if (!mediaKinds.includes(kind) || typeof input?.enabled !== 'boolean') invalid('媒体模型配置无效');
  if (!input.enabled) return { ...previous, enabled: false };
  const { protocol, source, model, voice, route = '' } = input;
  const custom = protocol === 'custom';
  if (!custom && (typeof protocol !== 'string' || !Object.hasOwn(defaults, protocol) ||
      (kind === 'image' && protocol !== 'openai'))) invalid('媒体协议无效');
  if (!['chat', 'custom'].includes(source)) invalid('API 来源无效');
  if (typeof model !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(model)) invalid('请输入有效的模型 ID');
  if (kind === 'speech' && (typeof voice !== 'string' || !/^[\w-]{1,128}$/.test(voice))) invalid('请输入音色名称或 ID');
  const value = { enabled: true, protocol, source, model, ...(kind === 'speech' ? { voice } : {}) };
  if (custom) {
    const endpoint = publicHttpsUrl(input.endpoint);
    if (source === 'chat' && (!chatBaseUrl || endpoint.origin !== new URL(chatBaseUrl).origin)) {
      invalid('复用聊天密钥时，自定义端点必须与聊天 API 同源。其他供应商请选择独立密钥。');
    }
    value.endpoint = endpoint.href;
  } else {
    if (typeof route !== 'string' || (route && !/^\/(?:[\w-]+\/)*[\w-]+$/.test(route))) invalid('请输入有效的接口路径，例如 /audio/music');
    if (route.length > 150 || (!route && !defaults[protocol][kind])) invalid('音乐或音效的兼容网关需要填写接口路径');
    value.route = route;
  }
  if (kind === 'speech' && protocol !== 'elevenlabs') {
    const instructions = input.instructions === undefined ? previous?.instructions ?? '' : input.instructions;
    if (typeof instructions !== 'string' || instructions.length > maxSpeechInstructions ||
        /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(instructions)) {
      invalid('语音风格提示词须为不超过 4096 字符的文本');
    }
    if (instructions.trim()) value.instructions = instructions.trim();
  }
  if (source === 'custom') {
    if (!custom) value.baseUrl = normalizeCustomUrl(input.baseUrl);
    const previousUrl = previous?.endpoint || previous?.baseUrl;
    const sameProvider = previous?.source === 'custom' && previous.protocol === protocol && previousUrl &&
      new URL(previousUrl).origin === new URL(value.endpoint || value.baseUrl).origin;
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
    let endpoint;
    if (profile.protocol === 'custom') {
      const url = publicHttpsUrl(profile.endpoint);
      if (profile.source === 'chat' && url.origin !== new URL(chat.baseUrl).origin) return [];
      endpoint = url.href;
    } else {
      const base = normalizeCustomUrl(profile.source === 'chat' ? chat.baseUrl : profile.baseUrl);
      const route = (profile.route || defaults[profile.protocol][kind]).replace('{voice}', profile.voice || '');
      const prefix = base.replace(/\/chat\/completions$/, '');
      endpoint = prefix.endsWith(route) ? prefix : prefix + route;
    }
    return [[kind, {
      endpoint, protocol: profile.protocol, model: profile.model, voice: profile.voice,
      apiKey: profile.source === 'chat' ? secrets.apiKey : profile.apiKey,
      ...(kind === 'speech' && profile.protocol !== 'elevenlabs' && profile.instructions ? { instructions: profile.instructions } : {}),
    }]];
  }));
}
