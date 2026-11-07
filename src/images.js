import { memoryEpoch, assertMemoryEpoch } from './user-controls.js';
import { imageDescription } from './image-description.js';
export function imageUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      !(url.hostname === 'multimedia.nt.qq.com.cn' || url.hostname === 'q1.qlogo.cn' ||
        ['qq.com', 'qpic.cn', 'gtimg.cn'].some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain)))) {
    throw new Error(`图片不是受支持的QQ图片地址（协议=${url.protocol}，域名=${url.hostname}）`);
  }
  return url;
}
export async function downloadImage(value, request = fetch) {
  const response = await request(imageUrl(value), { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error('QQ图片下载失败');
  const type = response.headers.get('content-type')?.split(';')[0];
  if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(type)) throw new Error('图片格式不支持');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 8 * 1024 * 1024) throw new Error('图片超过8MB');
    chunks.push(chunk);
  }
  return `data:${type};base64,${Buffer.concat(chunks).toString('base64')}`;
}
export async function describeMessageImages(msg, qq, agent, log) {
  const epoch = memoryEpoch(agent.store);
  const summaries = [];
  for (const image of msg.images || []) {
    try {
      agent.tools?.media?.assertReadable();
      let data;
      if (image.url) {
        try { data = await downloadImage(image.url); } catch { /* Retry expired URLs through OneBot. */ }
      }
      if (!data && image.file) {
        const info = await qq.call('get_image', { file: image.file });
        data = await downloadImage(info.url);
      }
      if (!data) throw new Error('未取得图片地址');
      assertMemoryEpoch(agent.store, epoch);
      agent.tools?.media?.assertReadable(data);
      const description = imageDescription(await agent.describeImage(data));
      assertMemoryEpoch(agent.store, epoch);
      let reference = '';
      try {
        const asset = agent.tools?.media?.ingest(data, description, msg.session);
        if (asset) reference = `图片ID=${asset.id}；`;
      } catch (error) { log(`图片素材未缓存：${error.message}`); }
      summaries.push(reference + description);
    } catch (error) {
      log(`图片读取失败：${error.message}`);
      summaries.push('图片读取失败，不能猜测画面；需要时请对方重发或说明。');
    }
  }
  return summaries.map((text, i) => imageDescription(`图片${i+1}：${text}`)).join('\n');
}
