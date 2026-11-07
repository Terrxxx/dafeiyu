// Same rolling hour and one-entry-per-slot accounting as Store.reserve.
// This view is read-only; seeing an available slot does not reserve or publish.
export function publishQuota(config,store,tools,now=Date.now()){
  const counters=(store.data.counters||[]).filter(c=>now-c.time<3600000);
  const view=(kind,limit,enabled)=>{
    const entries=counters.filter(c=>c.kind===kind).sort((a,b)=>a.time-b.time);
    const remaining=Math.max(0,limit-entries.length);
    return{enabled,limitPerHour:limit,usedSlots:entries.length,remaining:enabled?remaining:0,...(enabled&&limit>0&&!remaining?{nextSlotSeconds:Math.max(1,Math.ceil((entries[entries.length-limit].time+3600000-now)/1000))}:{})};
  };
  const visible=name=>tools?.components?.allowed(name)!==false;
  return{
    qzone:view('qzone',config.social?.maxQzonePostsPerHour??1,config.qq?.enabled!==false&&config.social?.qzoneEnabled!==false&&visible('qzone_publish')),
    bilibili:view('bili-dynamics',config.bilibili?.maxDynamicsPerHour??1,config.bilibili?.enabled!==false&&visible('bili_publish_dynamic')),
    outgoing:view('outgoing',config.agent?.maxOutgoingPerHour??100,true),
  };
}
