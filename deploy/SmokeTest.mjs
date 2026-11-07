import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { loadConfig } from '../src/config.js';
import { synthesizeSpeech } from '../src/media.js';
import { Store } from '../src/store.js';
import { SocialTools } from '../src/tools.js';
import { HarnessRuntime } from '../src/harness-runtime.js';
import { Bilibili, readCookie } from '../src/bilibili.js';

const config = loadConfig(); const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'dafeiyu-deploy-check-'));
let runtime; let tools; let browser;
try {
  const wav = await synthesizeSpeech('你好呀，我是大肥鱼。', temporary, config.social.voiceName);
  assert.equal(wav.subarray(0, 4).toString(), 'RIFF'); assert.ok(wav.length > 10000);
  console.log(JSON.stringify({ voice: 'ok', voiceName: config.social.voiceName, sampleRate: wav.readUInt32LE(24) }));
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true });
  const page = await browser.newPage(); await page.setContent('<title>Dafeiyu deployment check</title>'); assert.equal(await page.title(), 'Dafeiyu deployment check');
  await browser.close(); browser = null; console.log('Chromium: ok');
  const store = new Store(temporary); tools = new SocialTools(config, store, {}, {}); tools.begin('deployment-check');
  runtime = new HarnessRuntime(config, store, tools); runtime.home = path.join(temporary, 'harness-home');
  const reply = await runtime.run('这是服务器迁移的内部连通性检查，只回复 OK，不调用任何工具。', { useTools: false, maxTokens: 64 });
  assert.ok(reply.trim()); console.log('Harness actual SDK and model response: ok');
  if (config.bilibili.enabled && readCookie()) {
    const info = await new Bilibili(readCookie()).api('/x/web-interface/nav');
    console.log(JSON.stringify({ bilibiliLoginValid: info.isLogin === true }));
  }
} finally {
  await browser?.close(); await runtime?.close(); tools?.components.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
