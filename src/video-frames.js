import { createRequire } from 'node:module';import path from 'node:path';import { ROOT } from './config.js';
const require=createRequire(path.join(ROOT,'harness-runtime/package.json'));
export function videoFrameUrl(value){const url=new URL(value.startsWith('//')?'https:'+value:value);if(url.protocol==='http:')url.protocol='https:';if(url.protocol!=='https:'||url.username||url.password||url.port||!['hdslb.com','bilibili.com'].some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))throw Error('视频帧地址不受支持');return url;}
export function frameSamples(meta,count=4){
 const {img_x_len:cols,img_y_len:rows,img_x_size:width,img_y_size:height}=meta||{};
 if(![cols,rows,width,height].every(Number.isSafeInteger)||cols<1||cols>20||rows<1||rows>20||width<16||width>2048||height<16||height>2048||!Array.isArray(meta.image)||!meta.image.length||!Array.isArray(meta.index)||!meta.index.length)throw Error('视频快照结构不可用');
 if(!Number.isSafeInteger(count)||count<1||count>4)throw Error('每个视频最多采样4帧');
 const total=Math.min(meta.index.length,meta.image.length*cols*rows),indices=[...new Set(Array.from({length:Math.min(total,count)},(_,i)=>Math.min(total-1,Math.floor((i+.5)*total/Math.min(total,count)))))];
 return indices.map(index=>{const time=Number(meta.index[index]);if(!Number.isFinite(time)||time<0)throw Error('视频帧时间无效');const local=index%(cols*rows);return{url:videoFrameUrl(meta.image[Math.floor(index/(cols*rows))]).href,time:Math.floor(time),left:(local%cols)*width,top:Math.floor(local/cols)*height,width,height};});
}
async function readSheet(url,request,before){before?.();const response=await request(url,{headers:{'User-Agent':'Mozilla/5.0',Referer:'https://www.bilibili.com/'},redirect:'error',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('视频帧图片下载失败');const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>12*1024*1024)throw Error('视频帧拼图超过12MB');chunks.push(chunk);}return Buffer.concat(chunks);}
export async function decodeVideoFrames(meta,count,request=fetch,before){
 const sharp=require('sharp'),samples=frameSamples(meta,count),sheets=new Map(),images=[];
 for(const sample of samples){before?.();let bytes=sheets.get(sample.url);if(!bytes){bytes=await readSheet(sample.url,request,before);sheets.set(sample.url,bytes);}const source=sharp(bytes,{limitInputPixels:40_000_000}),info=await source.metadata();if(!['jpeg','png','webp'].includes(info.format)||sample.left+sample.width>info.width||sample.top+sample.height>info.height)throw Error('视频帧裁剪范围无效');const image=await source.extract({left:sample.left,top:sample.top,width:sample.width,height:sample.height}).resize({width:640,withoutEnlargement:true}).jpeg({quality:75}).toBuffer();if(image.length>1024*1024)throw Error('视频帧过大');images.push({mimeType:'image/jpeg',data:image.toString('base64'),time:sample.time});}
 return images;
}
export async function videoVisuals(tools,bvid,count=4){
 try{
   tools.sleep?.assertAwake();tools.media?.assertReadable?.();
   if(typeof tools.bili.videoFrames!=='function')return{images:[],times:[],evidence:'当前适配器没有提供画面，仅能使用文字资料'};
   const video=tools.videos.get(bvid);if(!video)throw Error('必须先实际读取视频');
   const frames=await tools.bili.videoFrames(bvid,video,count);tools.sleep?.assertAwake();if(!frames?.length)throw Error('没有可用画面');
   tools.store.audit('video-frames',{bvid,count:frames.length});
   return{images:frames.map(f=>({type:'image',mimeType:f.mimeType,data:f.data})),times:frames.map(f=>`${Math.floor(f.time/60)}:${String(f.time%60).padStart(2,'0')}`),evidence:`已提供${frames.length}张实际视频预览关键帧，不是连续视频或封面；只能描述采样可见内容`};
 }catch(error){tools.store.audit('video-frames-unavailable',{bvid,error:error.message});return{images:[],times:[],evidence:'关键帧暂不可用；当前只能根据简介和字幕，不能声称看到了画面'};}
}
export function attachVideoFrames(messages,visuals){
 if(!visuals?.size)return messages;const calls=new Map(),out=[];let pending=[];
 for(let i=0;i<messages.length;i++){
   const m=messages[i];out.push(m);
   if(m.role==='assistant')for(const c of m.tool_calls||[])if(c.function?.name==='bili_read_video')try{calls.set(c.id,JSON.parse(c.function.arguments).bvid);}catch{}
   if(m.role==='tool'){const bvid=calls.get(m.tool_call_id),visual=visuals.get(bvid);if(visual?.images.length)pending.push({bvid,visual});}
   if(pending.length&&messages[i+1]?.role!=='tool'){
     const content=[];for(const{bvid,visual}of pending){content.push({type:'text',text:`已读视频${bvid}的实际采样关键帧，按顺序时间${visual.times.join('、')}；抽帧不是连续播放。`},...visual.images.map(f=>({type:'image_url',image_url:{url:`data:${f.mimeType};base64,${f.data}`,detail:'low'}})));}out.push({role:'user',content});pending=[];
   }
 }return out;
}
export function applyMergedVideoResults(agent,text){
 if(!agent.tools.videos?.size)return;let value;try{value=JSON.parse(text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,''));}catch{return;}
 const valid=new Set(['amusing','sad','interesting','relaxing','inspiring','tense','neutral']),seen=new Set();
 for(const row of Array.isArray(value.videos)?value.videos.slice(0,8):[]){if(seen.has(row.bvid)||!agent.tools.videos.has(row.bvid))continue;if([-1,0,1].includes(row.rating))agent.personality.rateVideo(agent.tools.videos.get(row.bvid),row.rating);if(valid.has(row.feeling)){agent.applyVideoFeeling(row.bvid,row.feeling,`video:${row.bvid}:task:${agent.tools.current?.key||agent.tools.componentScopeId}`);seen.add(row.bvid);}}
 for(const bvid of agent.tools.videos.keys())if(!seen.has(bvid))agent.store.audit('video-feeling-missing',{bvid,reason:'同次工具回复未返回视频情绪'});
}
