import{initializeAnalytics,recordAnalytics,usageCategory}from'./usage-analytics.js';
import{randomUUID}from'node:crypto';const BOOT=randomUUID();
import fs from 'node:fs';import path from 'node:path';import{atomicWriteFile}from'./atomic-file.js';
export const pricingSource='https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
export function normalizeLimits(value={}){const v={tokenEnabled:false,tokensPerDay:100000,costEnabled:false,cnyPerDay:5,...value};for(const k of ['tokenEnabled','costEnabled'])if(typeof v[k]!=='boolean')throw Error('每日额度开关须为布尔值');if(!Number.isSafeInteger(v.tokensPerDay)||v.tokensPerDay<1)throw Error('每日token额度须为正整数');if(!Number.isFinite(v.cnyPerDay)||v.cnyPerDay<=0||v.cnyPerDay>1000000)throw Error('每日费用上限须大于0且不超过100万元');return v;}
export const beijingDay=at=>new Date(at+8*3600000).toISOString().slice(0,10);
const holidays=new Set();for(const [start,end]of [['2026-01-01','2026-01-03'],['2026-02-15','2026-02-23'],['2026-04-04','2026-04-06'],['2026-05-01','2026-05-05'],['2026-06-19','2026-06-21'],['2026-09-25','2026-09-27'],['2026-10-01','2026-10-07']])for(let n=Date.parse(start);n<=Date.parse(end);n+=86400000)holidays.add(new Date(n).toISOString().slice(0,10));
export function estimateCost(model,usage,at=Date.now()){const pro=model==='deepseek-v4-pro';if(!pro&&!['deepseek-flash','deepseek-v4-flash','deepseek-v4-flash-vision-exp'].includes(model))return null;const date=new Date(at+8*3600000),hour=date.getUTCHours()+date.getUTCMinutes()/60,weekday=date.getUTCDay();const peak=weekday>0&&weekday<6&&!holidays.has(beijingDay(at))&&(hour>=9&&hour<12||hour>=14&&hour<18);const prompt=Number(usage.prompt_tokens??usage.input_tokens),output=Number(usage.completion_tokens??usage.output_tokens),cached=Math.min(prompt,Number(usage.prompt_cache_hit_tokens??usage.prompt_tokens_details?.cached_tokens??0));if(![prompt,output,cached].every(n=>Number.isFinite(n)&&n>=0))return null;return (cached*(pro?.15:.02)+(prompt-cached)*(pro?4.5:1)+output*(pro?13.5:4))*(peak?2:1)/1e6;}
function configuration(config,directory){const file=path.join(directory,'config.json');return normalizeLimits(fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'')).limits:config?.limits);}
export function dailyStatus(directory, config = {}, at = Date.now()) {
 const configuredLimits = configuration(config, directory);
 const limitsSuspended = config.provider === 'custom';
 const limits = limitsSuspended ? { ...configuredLimits, tokenEnabled: false, costEnabled: false } : configuredLimits;
 const file = path.join(directory, 'daily-usage.json');
 const ledger = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { days: {} };
 const day = beijingDay(at);
 const usage = ledger.days[day] || { tokens: 0, estimatedCny: 0, requests: 0, missingUsage: false };
 const reasons = [];
 if (limits.tokenEnabled && usage.tokens >= limits.tokensPerDay) reasons.push('每日token上限');
 if (limits.costEnabled && usage.estimatedCny >= limits.cnyPerDay) reasons.push('每日费用上限');
 if ((limits.tokenEnabled || limits.costEnabled) && usage.missingUsage) reasons.push('模型未返回完整用量，已暂停以保护日额度');
 if (limits.costEnabled && estimateCost(config.model || 'deepseek-flash', { prompt_tokens: 0, completion_tokens: 0 }, at) === null) {
  reasons.push('此模型没有已核实的人民币单价');
 }
 return {
  day, ...usage, missingUsage: !!(usage.missingUsage || usage.missingCustomUsage),
  pendingRequests: Object.values(ledger.pending || {}).filter(item => beijingDay(item.at) === day).length,
  limits, limitsSuspended, paused: reasons.length > 0, reasons,
  resumesAt: new Date(Date.parse(day + 'T00:00:00+08:00') + 86400000).toISOString(),
  pricingSource, priceCheckedAt: '2026-10-28', holidayCalendarThrough: 2026,
 };
}
export class DailyBudget{
 constructor(config,store,now=Date.now,boot=BOOT){Object.assign(this,{config,store,now,boot});this.directory=path.dirname(store.file);this.file=path.join(this.directory,'daily-usage.json');const ledger=this.read();for(const[id,pending]of Object.entries(ledger.pending||{}))if(pending.boot!==boot)this.record(undefined,pending.at,id);}
 read(){return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):{days:{},pending:{}};}
 write(ledger){atomicWriteFile(this.file,JSON.stringify(ledger));}
 status(){return dailyStatus(this.directory,this.config,this.now());}
 assert(){const s=this.status();if(s.paused)throw Object.assign(Error(s.reasons.join('；')+'，北京时间次日00:00恢复'),{code:'DAILY_LIMIT'});}
 begin(at=this.now(),category=usageCategory()){this.assert();const ledger=this.read(),id=randomUUID();ledger.pending||={};ledger.pending[id]={at,boot:this.boot,category,provider:this.config.provider||'deepseek'};this.write(ledger);return id;}
 cancel(id){const ledger=this.read();if(ledger.pending)delete ledger.pending[id];this.write(ledger);}
 record(usage,at=this.now(),requestId){const ledger=this.read(),day=beijingDay(at);initializeAnalytics(ledger,at);const pending=ledger.pending?.[requestId];const category=pending?.category||usageCategory();const custom=(pending?.provider??this.config.provider)==='custom';recordAnalytics(ledger,usage,at,category);const u=ledger.days[day]||{tokens:0,estimatedCny:0,requests:0,missingUsage:false};const input=usage?.prompt_tokens??usage?.input_tokens,output=usage?.completion_tokens??usage?.output_tokens;const total=usage?.total_tokens??(Number(input)+Number(output));const valid=Number.isFinite(total)&&total>=0&&Number.isFinite(input)&&Number.isFinite(output);const cost=usage&&!custom?estimateCost(this.config.model||'deepseek-flash',usage,at):null;u.requests++;if(valid)u.tokens+=total;else if(custom)u.missingCustomUsage=true;else u.missingUsage=true;if(cost!==null)u.estimatedCny=Number((u.estimatedCny+cost).toFixed(12));else if(!custom&&this.status().limits.costEnabled)u.missingUsage=true;ledger.days[day]=u;if(requestId&&ledger.pending)delete ledger.pending[requestId];for(const key of Object.keys(ledger.days).sort().slice(0,-32))delete ledger.days[key];this.write(ledger);}
}
