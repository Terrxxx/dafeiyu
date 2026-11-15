import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import os from'node:os';import path from'node:path';import{usageStatistics}from'../src/usage-analytics.js';
import { DailyBudget, beijingDay } from '../src/daily-budget.js';
test('每日用量按北京日期分组，连续补齐30天，保留旧账本且不回填未知用量',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-daily-chart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const file=path.join(dir,'daily-usage.json');const ledger={days:{'2026-10-27':{tokens:120,requests:2},'2026-10-28':{tokens:300,requests:3,missingUsage:true},'2026-10-29':{tokens:70,requests:1}}};fs.writeFileSync(file,JSON.stringify(ledger));const before=fs.readFileSync(file,'utf8'),a=usageStatistics(dir,{},Date.parse('2026-10-28T15:59:59Z'));assert.equal(a.today,'2026-10-28');assert.equal(a.daily.length,30);assert.equal(a.daily.at(-1).tokens,300);assert.equal(a.daily.at(-1).requests,3);assert.equal(a.daily.at(-1).missingUsage,true);assert.equal(a.daily[0].recorded,false);assert.equal(a.daily.at(-3).tokens,0);assert.equal(a.daily.at(-3).recorded,false);assert.ok(!a.daily.some(d=>d.date==='2026-10-29'));const b=usageStatistics(dir,{},Date.parse('2026-10-28T16:00:00Z'));assert.equal(b.today,'2026-10-29');assert.equal(b.daily.at(-1).tokens,70);assert.equal(fs.readFileSync(file,'utf8'),before);});
test('没有账本时每日图表返回零用量，不创建或改写用户数据',t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-empty-chart-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const v=usageStatistics(dir,{},Date.parse('2026-10-28T10:00:00Z'));assert.equal(v.daily.length,30);assert.equal(v.daily.reduce((s,d)=>s+d.tokens,0),0);assert.equal(v.daily.at(-1).recorded,true);assert.deepEqual(fs.readdirSync(dir),[]);});

test('provider filters distinguish switched gateways, separate legacy usage and preserve total counts', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-provider-chart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = Date.parse('2026-11-15T01:00:00Z');
  const store = { file: path.join(dir, 'state.json') };
  fs.writeFileSync(path.join(dir, 'daily-usage.json'), JSON.stringify({ days: {
    [beijingDay(at)]: { tokens: 120, requests: 2, estimatedCny: 0.15, missingUsage: true },
  } }));
  const deepseek = new DailyBudget({ model: 'deepseek-flash' }, store, () => at);
  const first = new DailyBudget({ provider: 'custom', baseUrl: 'https://one.example.com/v1' }, store, () => at);
  const second = new DailyBudget({ provider: 'custom', baseUrl: 'https://two.example.com/openai/v1' }, store, () => at);
  const used = tokens => ({ prompt_tokens: tokens, completion_tokens: 0, total_tokens: tokens });
  deepseek.record(used(10), at, deepseek.begin());
  first.record(used(20), at, first.begin());
  second.record(undefined, at, second.begin());
  const stats = usageStatistics(dir, {}, at);
  assert.equal(stats.day.tokens, 150);
  assert.equal(stats.daily.at(-1).requests, 5);
  assert.deepEqual(stats.daily.at(-1).providers, {
    deepseek: { tokens: 10, requests: 1, missingUsage: false },
    'custom:one.example.com': { tokens: 20, requests: 1, missingUsage: false },
    'custom:two.example.com': { tokens: 0, requests: 1, missingUsage: true },
    unknown: { tokens: 120, requests: 2, missingUsage: true },
  });
  assert.deepEqual(stats.providers.map(p => p.name), ['DeepSeek', 'one.example.com', 'two.example.com', '未标记供应商']);
  assert.equal(stats.expenses.today.cny, 0.15001);
});

test('fee ranges use Beijing dates and all expenses survive the daily ledger retention limit', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dfy-expense-ranges-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const at = Date.parse('2026-11-15T16:00:00Z'), day = 86400000;
  const history = Object.fromEntries(Array.from({ length: 35 }, (_, i) => [
    beijingDay(at - (i + 1) * day), { tokens: 1000, requests: 1, estimatedCny: 0.01 },
  ]));
  const file = path.join(dir, 'daily-usage.json');
  fs.writeFileSync(file, JSON.stringify({ days: history }));
  const budget = new DailyBudget({ provider: 'custom', baseUrl: 'https://other.example.com/v1' },
    { file: path.join(dir, 'state.json') }, () => at);
  budget.record({ prompt_tokens: 800, completion_tokens: 200 }, at, budget.begin());
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(file)).days).length, 32);
  const { expenses } = usageStatistics(dir, {}, at);
  assert.equal(expenses.today.cny, null);
  assert.deepEqual(expenses.threeDays, { from: '2026-11-14', to: '2026-11-16', cny: 0.02 });
  assert.equal(expenses.sevenDays.cny, 0.06);
  assert.equal(expenses.month.cny, 0.29);
  assert.equal(expenses.all.cny, 0.35);
});
