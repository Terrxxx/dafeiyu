import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT } from './config.js';

const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export class MediaLibrary {
  constructor(store) {
    this.store = store; this.items = store.data.media ||= {};
    this.directory = path.join(path.dirname(store.file || path.join(ROOT, 'data/state.json')), 'media');
  }
  ingest(data, description, scope) {
    const match = data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!match || !description) throw new Error('只能保存已识别的图片');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('图片大小不合适');
    const id = createHash('sha256').update(bytes).digest('hex');
    if (!this.items[id]) {
      if (Object.keys(this.items).length >= 2000 || Object.values(this.items).reduce((n, x) => n + x.bytes, 0) + bytes.length > 1024 * 1024 * 1024) throw new Error('图片库已达2000张或1GB上限');
      fs.mkdirSync(this.directory, { recursive: true });
      fs.writeFileSync(path.join(this.directory, `${id}.${extensions[match[1]]}`), bytes);
      this.items[id] = { id, mime: match[1], bytes: bytes.length, description: description.slice(0, 800), scopes: [], savedSticker: false, createdAt: Date.now() };
    }
    const item = this.items[id]; if (!item.scopes.includes(scope)) item.scopes.push(scope);
    this.store.save(); return { id, description: item.description };
  }
  list(scope) { return Object.values(this.items).filter(x => x.savedSticker || x.scopes.includes(scope)).slice(-30).map(({ id, description, savedSticker }) => ({ id, description, savedSticker })); }
  stickers(limit = 12) {
    return Object.values(this.items).filter(item => item.savedSticker)
      .sort((a, b) => (a.lastSentAt || 0) - (b.lastSentAt || 0) || b.createdAt - a.createdAt)
      .slice(0, limit).map(({ id, description, savedSticker }) => ({ id, description, savedSticker }));
  }
  get(id, scope) {
    const item = this.items[id];
    if (!item || (!item.savedSticker && !item.scopes.includes(scope))) throw new Error('图片不在当前会话可用素材中');
    if (!/^[a-f0-9]{64}$/.test(item.id) || !extensions[item.mime]) throw new Error('图片记录无效');
    return { ...item, file: path.join(this.directory, `${item.id}.${extensions[item.mime]}`) };
  }
  bytes(item) {
    const data = fs.readFileSync(item.file);
    if (data.length > 8 * 1024 * 1024 || createHash('sha256').update(data).digest('hex') !== item.id) throw new Error('图片文件内容已变化');
    return data;
  }
  markSticker(id) { this.items[id].savedSticker = true; this.store.save(); }
  markSent(id) { if (this.items[id]?.savedSticker) { this.items[id].lastSentAt = Date.now(); this.store.save(); } }
}

export async function synthesizeSpeech(text, directory, voice = 'chaowen') {
  if (typeof text !== 'string' || !text.trim() || text.length > 200) throw new Error('语音正文须为1至200字');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `speech-${randomUUID()}.wav`);
  const local = voice === 'chaowen';
  if (local && !fs.existsSync(path.join(ROOT, 'data/tts/vits-piper-zh_CN-chaowen-medium-int8/zh_CN-chaowen-medium.onnx'))) throw new Error('本地chaowen音色未安装，请运行setup-voice.ps1');
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(local ? process.execPath : 'powershell.exe', local ? [path.join(ROOT, 'src/speech-local.cjs')] : ['-NoProfile', '-NonInteractive', '-File', path.join(ROOT, 'src/speech.ps1')], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, 60000);
      child.stderr.on('data', () => {});
      child.on('error', () => { clearTimeout(timer); reject(new Error('无法启动本机语音合成')); });
      child.stdin.on('error', () => {});
      child.on('exit', code => { clearTimeout(timer); code === 0 && !timedOut ? resolve() : reject(new Error(timedOut ? '语音合成超时' : '本机语音合成失败，请检查已安装音色')); });
      child.stdin.end(JSON.stringify({ text, file, voice }));
    });
    const bytes = fs.readFileSync(file);
    if (bytes.length < 44 || bytes.length > 8 * 1024 * 1024 || bytes.subarray(0, 4).toString() !== 'RIFF') throw new Error('语音文件无效');
    return bytes;
  } finally { try { fs.unlinkSync(file); } catch {} }
}
