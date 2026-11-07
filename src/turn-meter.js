import { AsyncLocalStorage } from 'node:async_hooks';
const turns=new AsyncLocalStorage();
export const currentTurnMeter=()=>turns.getStore();
export const withTurnMeter=(meter,task)=>turns.run(meter,task);
export function startTurnRequest(shape){const meter=turns.getStore();if(meter){meter.requests++;meter.estimated+=shape.total;}let done=false;return usage=>{if(!meter||done)return;done=true;meter.completed++;const input=usage?.prompt_tokens??usage?.input_tokens,output=usage?.completion_tokens??usage?.output_tokens,cached=usage?.prompt_cache_hit_tokens??usage?.prompt_tokens_details?.cached_tokens;if(Number.isFinite(input)&&Number.isFinite(output)){meter.input+=input;meter.output+=output;if(Number.isFinite(cached))meter.cached+=cached;else meter.cacheMissing++;}else meter.missing++;meter.onComplete?.();};}
export async function measureModelTurn(label,write,task){
 const meter={requests:0,completed:0,estimated:0,input:0,output:0,cached:0,missing:0,cacheMissing:0};
 try{return await turns.run(meter,task);}finally{
   let timer,published=false;
   const publish=()=>{if(published||!meter.requests)return;published=true;clearTimeout(timer);const actual=meter.completed===meter.requests&&!meter.missing,rate=meter.input&&!meter.cacheMissing?(meter.cached/meter.input*100).toFixed(1)+'%':'未返回';try{write?.(`${label}用量汇总：${meter.requests}次AI请求 · ${actual?`实际输入${meter.input} / 输出${meter.output} / 合计${meter.input+meter.output} tokens`:`输入估算≈${meter.estimated} tokens（实际用量未完整返回）`}${actual?` · 缓存命中${meter.cacheMissing?'未完整返回':meter.cached} / 未命中${meter.cacheMissing?'未完整返回':Math.max(0,meter.input-meter.cached)} · 命中率${rate}`:''}`);}catch{}};
   if(meter.completed===meter.requests)publish();else{meter.onComplete=()=>{if(meter.completed===meter.requests)publish();};timer=setTimeout(publish,200);timer.unref?.();}
 }
}
