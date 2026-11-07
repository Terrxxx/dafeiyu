// Isolate native inference from the social process so slow synthesis never blocks QQ.
const fs = require('node:fs');
const path = require('node:path');
const { OfflineTts } = require('sherpa-onnx-node/non-streaming-tts.js');
const { voiceConfig } = require('./voices.cjs');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', part => { input += part; if (input.length > 16000) process.exit(1); });
process.stdin.on('end', () => {
  try {
    const { text, file, voice = 'chaowen' } = JSON.parse(input);
    if (typeof text !== 'string' || !text.trim() || text.length > 200) throw new Error('Invalid speech text');
    const selected = voiceConfig(voice);
    const outputFile = path.resolve(file);
    if (selected.type === 'kokoro') process.chdir(selected.directory);
    const tts = new OfflineTts(selected.config);
    const { samples, sampleRate } = tts.generate({ text, sid: selected.sid, speed: selected.speed, enableExternalBuffer: false });
    if (!samples.length || samples.length * 2 + 44 > 8 * 1024 * 1024 || !Number.isInteger(sampleRate)) throw new Error('Invalid audio');
    const wav = Buffer.alloc(44 + samples.length * 2);
    wav.write('RIFF', 0); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
    wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
    wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28);
    wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i++) {
      if (!Number.isFinite(samples[i])) throw new Error('Invalid sample');
      wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
    }
    fs.writeFileSync(outputFile, wav);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
});
