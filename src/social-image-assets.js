export function publicationImages(tools,ids=[]){
 if(!Array.isArray(ids)||ids.length>9||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||!/^(?:[a-f0-9]{6}|[a-f0-9]{64})$/.test(id)))throw Error('发布图片须为最多9个已缓存图片ID');
 let total=0;
 return ids.map(id=>{const item=tools.media.get(id,tools.scope),bytes=tools.media.bytes(item);total+=bytes.length;if(total>24*1024*1024)throw Error('本次发布图片合计不能超过24MB');return{id:item.id,storageId:item.storageId,mime:item.mime,bytes};});
}
