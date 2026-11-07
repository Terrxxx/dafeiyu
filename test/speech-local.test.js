import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import voiceLibrary from '../src/voices.cjs';
let voiceInstalled = true;
try { voiceLibrary.voiceConfig('chaowen'); } catch { voiceInstalled = false; }
import { synthesizeSpeech } from '../src/media.js';

test('本地音色真正合成非静音PCM，完成后清理临时音频', { skip: !voiceInstalled }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fish-voice-'));
  try {
    const wav = await synthesizeSpeech('你好，大肥鱼。', directory, 'chaowen');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
    assert.equal(wav.readUInt32LE(24), 22050);
    assert.equal(wav.readUInt16LE(34), 16);
    assert.equal(wav.readUInt32LE(40), wav.length - 44);
    assert.ok(wav.length > 22050);
    let peak = 0;
    for (let i = 44; i < wav.length; i += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(i)));
    assert.ok(peak > 100);
    assert.deepEqual(fs.readdirSync(directory), []);
  } finally { fs.rmdirSync(directory); }
});

