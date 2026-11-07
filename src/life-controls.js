import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { atomicWriteFile } from './atomic-file.js';
import { moodBase,normalizeEmotion } from './emotion-state.js';
export const defaultRates = { baseDrainPerHour: 5, maxDrainPerHour: 8, recoveryPerHour: 10 };
export function readLifeControls(directory) {
  const file = path.join(directory, 'life-controls.json');
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { revision: '', mood: {}, rates: { ...defaultRates } };
}
export function saveLifeControls(directory, body, now = Date.now()) {
  const previous = readLifeControls(directory);
  if (body.revision !== previous.revision) throw Object.assign(new Error('生活状态设置已改变，请刷新后再保存'), { status: 409 });
  const mood = body.mood || {};
  if (!mood || typeof mood !== 'object' || Array.isArray(mood) || Object.entries(mood).some(([key, value]) => !Object.hasOwn(moodBase, key) || !Number.isFinite(value) || value < 0 || value > 100)) throw new Error('精力和情绪须为0至100');
  if (body.health !== undefined) throw new Error('健康系统已移除，不再接受健康或心率设置');
  const rates = { ...defaultRates, ...previous.rates, ...body.rates };
  if (body.rates !== undefined && (!body.rates || typeof body.rates !== 'object' || Array.isArray(body.rates) || Object.keys(body.rates).some(key => !Object.hasOwn(defaultRates, key)))) throw new Error('消耗设置字段无效');
  if (Object.values(rates).some(value => !Number.isFinite(value) || value <= 0 || value > 100) || rates.maxDrainPerHour < rates.baseDrainPerHour) throw new Error('每小时消耗/恢复须大于0且不超过100，最高消耗不能小于基础消耗');
  const revision = randomUUID(); const next = { ...previous, revision, rates, mood: { ...previous.mood } };
  for (const [key, value] of Object.entries(mood)) next.mood[key] = { value:Number(value.toFixed(2)), revision, at: now };
  if (body.rates !== undefined) { next.rateRevision = revision; next.rateAt = now; }
  atomicWriteFile(path.join(directory, 'life-controls.json'), JSON.stringify(next)); return next;
}
export function lifeView(directory, state) {
  const control = readLifeControls(directory); const mood = { ...moodBase, ...state.feelings?.mood };
  for (const [key, change] of Object.entries(control.mood || {})) if (state.sleep?.lifeApplied?.[key] !== change.revision) mood[key] = Math.max(0,Math.min(100,change.value));
  return { revision: control.revision, mood:normalizeEmotion(mood,moodBase), rates: { ...defaultRates, ...control.rates } };
}
