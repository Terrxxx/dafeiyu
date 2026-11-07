const fs = require('node:fs');
const path = require('node:path');
const sharedRoot = path.resolve(__dirname, '../assets/tts');
const root = process.env.DAFEIYU_TTS_DIR || (fs.existsSync(sharedRoot) ? sharedRoot : path.resolve(__dirname, '../data/tts'));
const voices = {
  chaowen: { type: 'vits', sid: 0, speed: 1 },
  'kokoro-zf_001': { type: 'kokoro', sid: 3, speed: 1.04 },
  'kokoro-zf_017': { type: 'kokoro', sid: 11, speed: 1.04 },
  'kokoro-zf_036': { type: 'kokoro', sid: 22, speed: 1.04 },
};
function voiceConfig(name) {
  const voice = voices[name]; if (!voice) throw new Error('Unknown local voice');
  const directory = path.join(root, voice.type === 'kokoro' ? 'kokoro-int8-multi-lang-v1_1' : 'vits-piper-zh_CN-chaowen-medium-int8');
  const modelFile = path.join(directory, voice.type === 'kokoro' ? 'model.int8.onnx' : 'zh_CN-chaowen-medium.onnx');
  if (!fs.existsSync(modelFile)) throw new Error(`本地${name}模型未安装，请运行${voice.type === 'kokoro' ? 'setup-kokoro.ps1' : 'setup-voice.ps1'}`);
  const model = voice.type === 'kokoro' ? { kokoro: { model: modelFile, voices: path.join(directory, 'voices.bin'), tokens: path.join(directory, 'tokens.txt'), dataDir: path.join(directory, 'espeak-ng-data'), lexicon: [path.join(directory, 'lexicon-us-en.txt'), path.join(directory, 'lexicon-zh.txt')].join(','), lang: 'zh' } } : { vits: { model: modelFile, tokens: path.join(directory, 'tokens.txt'), lexicon: path.join(directory, 'lexicon.txt'), ruleFsts: ['date.fst', 'number.fst', 'phone.fst'].map(name => path.join(directory, name)).join(',') } };
  // eSpeak on Windows cannot open a Unicode absolute path. Only the isolated
  // synthesis child changes directory; all output and other model paths stay absolute.
  if (voice.type === 'kokoro') model.kokoro.dataDir = './espeak-ng-data';
  return { ...voice, directory, config: { model: { ...model, numThreads: 2, provider: 'cpu' }, maxNumSentences: 1 } };
}
module.exports = { voices, voiceConfig };

