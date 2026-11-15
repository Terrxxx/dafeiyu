const DAY = 86400000;
const ZONE = 8 * 3600000;

export function memoryDateLabel(at, now = Date.now(), important = false) {
  const stamp = typeof at === 'number' ? at : Date.parse(at);
  if (!Number.isFinite(stamp)) return { day: '日期未记录', time: '' };
  const date = new Date(stamp + ZONE).toISOString();
  const today = new Date(now + ZONE).toISOString();
  const age = Math.floor((Date.parse(today.slice(0, 10)) - Date.parse(date.slice(0, 10))) / DAY);
  if (important) return { day: date.slice(0, 10), time: '' };
  if (age > 30) return { day: '以前', time: '' };
  if (age > 7) {
    const months = (Number(today.slice(0, 4)) - Number(date.slice(0, 4))) * 12 +
      Number(today.slice(5, 7)) - Number(date.slice(5, 7));
    return { day: months === 0 ? '本月' : months === 1 ? '上个月' : '一个月内', time: '' };
  }
  return { day: date.slice(0, 10), time: date.slice(11, 19) };
}

export const notableMemory = text => /纪念日|生日|第一次见面|第一次认识|重要约定|特别值得记住/.test(text);
