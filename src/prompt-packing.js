import { estimateTokens } from './ai-request-log.js';
// Request-only representation. Never writes histories, profiles or memories.
const COLS = '__cols', ROWS = '__rows', OBJECT = '__object';
const reserved = new Set([COLS, ROWS, OBJECT]);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function pack(value) {
  if (Array.isArray(value)) {
    const mapped = value.map(pack);
    if (value.length >= 2 && value.every(plain)) {
      const keys = Object.keys(value[0]);
      if (keys.length && keys.every(k => !reserved.has(k)) && value.every(row => JSON.stringify(Object.keys(row)) === JSON.stringify(keys))) {
        const table = { [COLS]: keys, [ROWS]: value.map(row => keys.map(k => pack(row[k]))) };
        if (JSON.stringify(table).length < JSON.stringify(mapped).length) return table;
      }
    }
    return mapped;
  }
  if (plain(value)) {
    const entries = Object.entries(value).map(([k, v]) => [k, pack(v)]);
    return Object.keys(value).some(k => reserved.has(k)) ? { [OBJECT]: entries } : Object.fromEntries(entries);
  }
  return value;
}
export function unpack(value) {
  if (Array.isArray(value)) return value.map(unpack);
  if (plain(value)) {
    if (Object.hasOwn(value, OBJECT)) return Object.fromEntries(value[OBJECT].map(([k,v]) => [k,unpack(v)]));
    if (Object.hasOwn(value, COLS) && Object.hasOwn(value, ROWS)) return value[ROWS].map(row => Object.fromEntries(value[COLS].map((k,i) => [k,unpack(row[i])])));
    return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,unpack(v)]));
  }
  return value;
}
const legend = '表格数据：__cols为字段顺序，__rows每行按此顺序读取；原文、顺序与数值均未改。\n';
export function promptData(value, { legend: includeLegend = true } = {}) {
  const original = JSON.stringify(value);
  // Normalize exactly as JSON would, including omitted undefined properties.
  const packed = JSON.stringify(pack(JSON.parse(original)));
  const candidate = (includeLegend ? legend : '') + packed;
  return estimateTokens(candidate) + 16 < estimateTokens(original) ? candidate : original;
}
