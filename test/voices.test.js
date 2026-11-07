import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { synthesizeSpeech } from '../src/media.js';
import localVoices from '../src/voices.cjs';

let installed = false;
try { localVoices.voiceConfig('kokoro-zf_017'); installed = true; } catch {}
test('Kokoro 在中文项目路径内合成真实非静音 WAV，并清除临时文件', { skip: !installed }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const wav = await synthesizeSpeech('你好呀，我是大肥鱼。', directory, 'kokoro-zf_017');
  assert.equal(wav.subarray(8, 12).toString(), 'WAVE');
  assert.equal(wav.readUInt32LE(24), 24000);
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  let peak = 0;
  for (let offset = 44; offset < wav.length; offset += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(offset)));
  assert.ok(peak > 100, 'speech must contain audible samples');
  assert.deepEqual(fs.readdirSync(directory), []);
});
