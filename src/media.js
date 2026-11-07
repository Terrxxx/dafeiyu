import{assertStorageReadable,withMediaLock,syncMediaControls,removedAt}from'./storage.js';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { ROOT } from './config.js';
import localVoices from './voices.cjs';
import { imageDescription } from './image-description.js';

const extensions = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
export class MediaLibrary {
  constructor(store, makeId = () => randomUUID().replaceAll('-', '').slice(0,6)) {
    this.store = store; this.items = store.data.media ||= {};
    this.directory = path.join(path.dirname(store.file || path.join(ROOT, 'data/state.json')), 'media');
    this.makeId = makeId;
    const registry = (store.data.meta ||= {}).imageRefs ||= {};
    let changed = false;
    for (const item of Object.values(this.items)) {
      if (!/^[a-f0-9]{64}$/.test(item.id)) continue;
      const old = item.shortId;
      let ref = /^[a-f0-9]{6}$/.test(old || '') && (!registry[old] || registry[old] === item.id) ? old : Object.keys(registry).find(k => registry[k] === item.id);
      if (!ref) { let attempts=0; do { if(++attempts>10000)throw Error('图片短ID分配失败');ref=this.makeId(); } while(!/^[a-f0-9]{6}$/.test(ref)||registry[ref]); }
      if (old !== ref || registry[ref] !== item.id) changed = true;
      item.shortId = ref; registry[ref] = item.id;
    }
    if (changed) store.save?.();
  }
  item(id) { return this.items[id] || (/^[a-f0-9]{6}$/.test(id||'') ? this.items[this.store.data.meta?.imageRefs?.[id]] : undefined); }
  ref(item) {
    if(item.shortId)return item.shortId;
    const registry=(this.store.data.meta ||= {}).imageRefs ||= {};let ref=Object.keys(registry).find(k=>registry[k]===item.id),attempts=0;
    if(!ref)do {if(++attempts>10000)throw Error('图片短ID分配失败');ref=this.makeId();}while(!/^[a-f0-9]{6}$/.test(ref)||registry[ref]);
    item.shortId=ref;registry[ref]=item.id;this.store.save?.();return ref;
  }
  assertReadable(data){let bytes=0;if(data){const match=data.match(/^data:image\/[^;]+;base64,(.+)$/s);if(match)bytes=Buffer.from(match[1],'base64').length;}return assertStorageReadable(path.dirname(this.directory),bytes);}
  ingest(data, description, scope) {return withMediaLock(path.dirname(this.directory),()=>this.ingestLocked(data,description,scope));}
  ingestLocked(data, description, scope) {
    syncMediaControls(this.store);
    const match = data.match(/^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!match || !description) throw new Error('只能保存已识别的图片');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('图片大小不合适');
    const id = createHash('sha256').update(bytes).digest('hex');
    if (!this.items[id]) {
      assertStorageReadable(path.dirname(this.directory),bytes.length);
      if (Object.keys(this.items).length >= 2000 || Object.values(this.items).reduce((n, x) => n + x.bytes, 0) + bytes.length > 1024 * 1024 * 1024) throw new Error('图片库已达2000张或1GB上限');
      fs.mkdirSync(this.directory, { recursive: true });
      fs.writeFileSync(path.join(this.directory, `${id}.${extensions[match[1]]}`), bytes);
      this.items[id] = { id, mime: match[1], bytes: bytes.length, description: imageDescription(description), scopes: [], savedSticker: false, createdAt: Math.max(Date.now(),removedAt(path.dirname(this.directory),id)+1) };
    }
    const item = this.items[id]; if (!item.scopes.includes(scope)) item.scopes.push(scope);
    const shortId=this.ref(item);this.store.save(); return { id:shortId, description:imageDescription(item.description) };
  }
  list(scope) { return Object.values(this.items).filter(x => x.publicAsset || x.savedSticker || x.scopes.includes(scope)).slice(-30).map(item => ({ id:this.ref(item), ...(item.lastSentAt?{}:{description:imageDescription(item.description)}), savedSticker:item.savedSticker })); }
  stickers(limit = 12) {
    return Object.values(this.items).filter(item => item.savedSticker)
      .sort((a, b) => (a.lastSentAt || 0) - (b.lastSentAt || 0) || b.createdAt - a.createdAt)
      .slice(0, limit).map(item => ({ id:this.ref(item), ...(item.lastSentAt?{}:{description:imageDescription(item.description)}), savedSticker:item.savedSticker }));
  }
  get(id, scope) {
    syncMediaControls(this.store);
    const item = this.item(id);
    if (!item || (!item.publicAsset && !item.savedSticker && !item.scopes.includes(scope))) throw new Error('图片不在当前会话可用素材中');
    if (!/^[a-f0-9]{64}$/.test(item.id) || !extensions[item.mime]) throw new Error('图片记录无效');
    return { ...item, id:this.ref(item), storageId:item.id, description:imageDescription(item.description), file: path.join(this.directory, `${item.id}.${extensions[item.mime]}`) };
  }
  bytes(item) {
    assertStorageReadable(path.dirname(this.directory));
    const data = fs.readFileSync(item.file);
    if (data.length > 8 * 1024 * 1024 || createHash('sha256').update(data).digest('hex') !== (item.storageId||item.id)) throw new Error('图片文件内容已变化');
    return data;
  }
  markSticker(id) { const item=this.item(id);if(!item)throw Error('图片不存在');item.savedSticker = true; this.store.save(); }
  markSent(id) { const item=this.item(id);if(item){item.lastSentAt = Date.now();this.store.save();} }
  markPublic(id,source) { const item=this.item(id);if(!item)throw Error('图片不存在');item.publicAsset=true;item.source=source;this.store.save(); }
}

export async function synthesizeSpeech(text, directory, voice = 'chaowen') {
  if (typeof text !== 'string' || !text.trim() || text.length > 200) throw new Error('语音正文须为1至200字');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `speech-${randomUUID()}.wav`);
  const local = Object.hasOwn(localVoices.voices, voice);
  if (local) localVoices.voiceConfig(voice);
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
