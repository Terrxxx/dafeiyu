export const imageDescription = value => Array.from(String(value ?? '').trim()).slice(0,100).join('');
export const mediaReceipt = Symbol('mediaReceipt');
export function imageSendResult(imageId,receipt){return Object.defineProperty({imageId},mediaReceipt,{value:receipt});}
export function imageHistoryText(value, store, scope) {
  const text=String(value??''),items=Object.values(store.data.media||{}).filter(x=>x.publicAsset||x.savedSticker||x.scopes?.includes(scope));
  const known=new Map(items.filter(x=>x.shortId).map(x=>[x.id,x.shortId]));
  const ids=text.replace(/((?:可用)?图片ID=)([a-f0-9]{64})/g,(_m,p,id)=>p+(known.get(id)||id));
  const sent=ids.match(/^\[已发送(?:图片|表情包)：([\s\S]*)\]$/);
  if(sent){const matches=items.filter(x=>x.shortId&&x.description===sent[1]);if(matches.length===1)return `[图片 ${matches[0].shortId}]`;}
  return ids;
}
