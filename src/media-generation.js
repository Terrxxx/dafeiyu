import { publicHttpsUrl, publicModelFetch } from './model-provider.js';

const maxMediaBytes = 8 * 1024 * 1024;
const maxJsonBytes = Math.ceil(maxMediaBytes * 4 / 3) + 16384;

async function requestMedia(request, url, options) {
  let response;
  try {
    response = await publicModelFetch(request, url, { ...options, signal: AbortSignal.timeout(90000) });
  } catch {
    throw Error('无法连接媒体供应商，请检查 API URL 和网络');
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw Error(`媒体供应商返回 HTTP ${response.status}，请检查模型和凭据`);
  }
  return response;
}

async function boundedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw Error('生成内容超过大小限制');
  }
  if (!response.body) throw Error('供应商没有返回生成内容');
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw Error('生成内容超过大小限制');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, size);
}

function mimeOf(bytes, kind) {
  if (kind === 'image') {
    if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
    if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  } else {
    if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WAVE') return 'audio/wav';
    if (bytes.toString('ascii', 0, 3) === 'ID3' ||
        (bytes.length > 3 && bytes[0] === 0xff && (bytes[1] & 0xe6) === 0xe2)) return 'audio/mpeg';
  }
  throw Error(kind === 'image' ? '供应商未返回 PNG、JPEG 或 WebP 图片' : '供应商未返回 WAV 或 MP3 音频');
}

function generationBody(kind, profile, prompt) {
  const { model, voice, protocol } = profile;
  if (kind === 'image') return { model, prompt, n: 1 };
  if (protocol === 'elevenlabs') {
    if (kind === 'speech') return { model_id: model, text: prompt };
    if (kind === 'music') return { model_id: model, prompt, music_length_ms: 12000 };
    return { model_id: model, text: prompt, duration_seconds: 5 };
  }
  if (kind === 'speech') return { model, input: prompt, voice, response_format: 'wav' };
  return { model, prompt, duration_seconds: kind === 'music' ? 12 : 5 };
}

export async function generateMedia(kind, profile, prompt, request = fetch) {
  if (!profile) throw Error('请先在密钥与安全中配置相应的媒体模型');
  const limit = kind === 'speech' ? 200 : 1000;
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > limit) {
    throw Error(`生成内容须为 1 至 ${limit} 字`);
  }
  const endpoint = publicHttpsUrl(profile.endpoint).href;
  const auth = profile.protocol === 'elevenlabs'
    ? { 'xi-api-key': profile.apiKey }
    : { Authorization: `Bearer ${profile.apiKey}` };
  const response = await requestMedia(request, endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify(generationBody(kind, profile, prompt.trim())),
  });
  let bytes;
  const type = response.headers.get('content-type') || '';
  if (/json/i.test(type)) {
    let value;
    try { value = JSON.parse(await boundedBody(response, maxJsonBytes)); }
    catch { throw Error('媒体供应商返回的 JSON 无法读取或过大'); }
    const item = (Array.isArray(value?.data) ? value.data[0] : value?.data) || value?.audio || value;
    const base64 = item?.b64_json ?? item?.base64;
    if (typeof base64 === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(base64)) {
      bytes = Buffer.from(base64, 'base64');
    } else if (typeof (item?.url ?? item?.audio_url) === 'string') {
      const url = publicHttpsUrl(item.url ?? item.audio_url, { allowQuery: true }).href;
      const asset = await requestMedia(request, url, { method: 'GET' });
      bytes = await boundedBody(asset, maxMediaBytes);
    } else {
      throw Error('媒体接口未返回成品。请配置同步返回二进制、Base64 或 HTTPS 媒体地址的接口');
    }
  } else {
    bytes = await boundedBody(response, maxMediaBytes);
  }
  if (!bytes.length || bytes.length > maxMediaBytes) throw Error('生成内容为空或超过大小限制');
  return { bytes, mime: mimeOf(bytes, kind) };
}
