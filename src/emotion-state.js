// Role states, never diagnoses of the human on the other end.
export const moodBase = { joy: 45, sadness: 10, irritation: 5, curiosity: 50, energy: 65,
  calm: 55, excitement: 15, worry: 10, tenderness: 25, confidence: 45, boredom: 10,
  anticipation: 20, loneliness: 10, shyness: 5, frustration: 8, security: 50, inspiration: 20 };
export const relationBase = { affection: 10, concern: 10, gratitude: 0, ease: 30, tension: 0, playfulness: 20, admiration: 10 };
export const moodLabels = { joy: '开心', sadness: '难过', irritation: '烦躁', curiosity: '好奇', energy: '精力', calm: '平静', excitement: '兴奋', worry: '担心', tenderness: '温柔', confidence: '自信', boredom: '无聊', anticipation: '期待', loneliness: '孤单', shyness: '害羞', frustration: '挫败', security: '安心', inspiration: '灵感' };
export const relationLabels = { affection: '亲近', concern: '关心', gratitude: '感激', ease: '自在', tension: '戒备', playfulness: '玩闹意愿', admiration: '欣赏' };
export function normalizeEmotion(value, base) {
  return Object.fromEntries(Object.entries(base).map(([key, fallback]) => [key, Number.isFinite(value?.[key]) ? Math.max(0, Math.min(100, value[key])) : fallback]));
}
export function effectiveMood(mood) {
  const result = normalizeEmotion(mood, moodBase); const energy = result.energy;
  const factor = energy <= 65 ? 0.15 + energy / 65 * 0.85 : 1 + (energy - 65) / 35 * 0.25;
  for (const key of ['joy', 'curiosity', 'excitement', 'confidence', 'anticipation', 'inspiration', 'security', 'tenderness']) result[key] = Number(Math.max(0, Math.min(100, result[key] * factor)).toFixed(2));
  // Derive fatigue separately: recovery restores expression without inventing
  // happy events or changing relationships. Never persist this as a base value.
  const fatigue = Math.max(0, (25 - energy) / 25);
  result.irritation = Math.min(100, result.irritation + fatigue * 12);
  result.frustration = Math.min(100, result.frustration + fatigue * 10);
  return result;
}
