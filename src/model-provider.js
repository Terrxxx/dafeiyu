import { lookup } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import { Agent } from 'undici';

export const deepSeekUrl = 'https://api.deepseek.com';
export const defaultModel = 'deepseek-flash';

const blocked = new BlockList();
for (const [network, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 3],
]) blocked.addSubnet(network, bits);
for (const [network, bits] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]]) {
  blocked.addSubnet(network, bits, 'ipv6');
}
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');

function publicAddress(address, family = isIP(address)) {
  if (family === 4) return !blocked.check(address);
  return family === 6 && globalV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');
}

export function publicHttpsUrl(value, { allowQuery = false } = {}) {
  if (typeof value !== 'string' || value.length > (allowQuery ? 4096 : 1024) ||
      !/^https:\/\/[^/]/i.test(value) || /[#\\\u0000-\u0020\u007f]/.test(value) || (!allowQuery && value.includes('?'))) {
    throw Object.assign(Error('请输入公开的 HTTPS API URL，不含查询参数'), { status: 400 });
  }
  let url;
  try { url = new URL(value); } catch {}
  if (!url || url.protocol !== 'https:' || url.username || url.password) {
    throw Object.assign(Error('请输入公开的 HTTPS API URL，不含账号或密码'), { status: 400 });
  }
  const host = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (isIP(host) ? !publicAddress(host) :
    !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|localdomain|lan|home|test|invalid|onion|arpa)$/.test(host)) {
    throw Object.assign(Error('API URL 必须指向公网地址'), { status: 400 });
  }
  return url;
}

export function normalizeCustomUrl(value) {
  const url = publicHttpsUrl(value);
  const pathname = url.pathname.replace(/\/+$/, '');
  // Bare domains use the OpenAI-compatible default. An explicit root
  // /chat/completions route remains valid for gateways that use that layout.
  const basePath = pathname && pathname !== '/chat/completions'
    ? pathname.replace(/\/chat\/completions$/, '') : pathname || '/v1';
  return url.origin + basePath;
}

export function modelSettings(secrets = {}) {
  return secrets.provider === 'custom' ? {
    provider: 'custom', baseUrl: normalizeCustomUrl(secrets.baseUrl), model: secrets.customModel || defaultModel,
  } : { provider: 'deepseek', baseUrl: secrets.baseUrl || deepSeekUrl, model: secrets.model || defaultModel };
}

export function modelCompletionUrl(config) {
  if (config.provider !== 'custom') return config.baseUrl.replace(/\/$/, '') + '/chat/completions';
  const baseUrl = normalizeCustomUrl(config.baseUrl);
  return baseUrl.endsWith('/chat/completions') ? baseUrl : baseUrl + '/chat/completions';
}

// Resolve at connect time. Reject private answers before the socket can use them,
// even if a domain resolves to a different address after the settings were saved.
export function publicLookup(hostname, options, callback, resolve = lookup) {
  resolve(hostname, { family: options.family, all: true }, (error, addresses) => {
    if (error) return callback(error);
    if (!addresses?.length || addresses.some(({ address, family }) => !publicAddress(address, family))) {
      return callback(Error('API URL 必须解析到公网地址'));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

let dispatcher;
export function publicModelFetch(request, url, options) {
  dispatcher ||= new Agent({ connect: { lookup: publicLookup } });
  return request(url, { ...options, redirect: 'error', dispatcher });
}

export function modelRequest(request, config, url, options) {
  if (config?.provider !== 'custom') return request(url, options);
  const safeUrl = modelCompletionUrl(config);
  if (String(url) !== safeUrl) throw Error('自定义模型请求地址与配置不符');
  const body = JSON.parse(options.body);
  delete body.thinking;
  return publicModelFetch(request, safeUrl, { ...options, body: JSON.stringify(body) });
}
