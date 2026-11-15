export function normalizeQQPolicy(qq){
 for(const key of ['profileReadEnabled','qzoneReadEnabled','groupTalkEnabled','privateEnabled','qzoneLikeEnabled','qzoneCommentEnabled','qzoneReplyEnabled','voiceEnabled']){qq[key]??=true;if(typeof qq[key]!=='boolean')throw Error(key+'须为开关');}
 qq.adminOnlyDialogue??=false;if(typeof qq.adminOnlyDialogue!=='boolean')throw Error('仅管理员对话须为开关');
 qq.friendRequestsEnabled??=false;if(typeof qq.friendRequestsEnabled!=='boolean')throw Error('好友申请开关无效');
 for(const key of ['groupAllowlist','groupBlocklist','privateAllowlist','privateBlocklist']){qq[key]??=[];if(!Array.isArray(qq[key])||qq[key].length>500||qq[key].some(id=>typeof id!=='string'||! /^[1-9]\d*$/.test(id)))throw Error(key+'须为QQ号码列表');}
 qq.minFriendAffinity??=null;if(qq.minFriendAffinity!==null&&(!Number.isFinite(qq.minFriendAffinity)||qq.minFriendAffinity< -100||qq.minFriendAffinity>100))throw Error('好友好感门槛须为-100至100，留空拒绝');return qq;
}
export function isQQAdmin(policy, id) { return (policy?.adminUsers || []).includes(String(id)); }
export function isPrivateSender(msg) {
  if (msg?.kind !== 'private' || !/^[1-9]\d*$/.test(String(msg.sender))) return false;
  const id = String(msg.sender);
  return String(msg.target) === id && (!msg.session || msg.session === `qq:user:${id}`) &&
    (msg.sources || [msg]).every(source => String(source.sender) === id);
}
export function canOperateQQ(msg, policy) {
  return isPrivateSender(msg) && !msg.unreadReview && isQQAdmin(policy, msg.sender);
}
export function chatAllowed(config,kind,id){const prefix=kind==='group'?'group':'private';const blocked=config[prefix+'Blocklist']||[],allowed=config[prefix+'Allowlist']||[];if(blocked.includes(String(id)))return false;if(kind==='private'&&isQQAdmin(config,id))return true;if(config.adminOnlyDialogue===true)return false;if(config[prefix==='group'?'groupTalkEnabled':'privateEnabled']===false)return false;return !allowed.length||allowed.includes(String(id));}
export function incomingAllowed(config,kind,target,sender){return chatAllowed(config,kind,target)&&!(kind==='group'&&(config.privateBlocklist||[]).includes(String(sender)));}
export function assertQQTool(config,name){const key={qq_get_profile:'profileReadEnabled',qzone_inspect_image:'qzoneReadEnabled',qzone_read:'qzoneReadEnabled',qzone_read_comments:'qzoneReadEnabled',qzone_like_post:'qzoneLikeEnabled',qzone_comment_post:'qzoneCommentEnabled',qzone_reply_comment:'qzoneReplyEnabled',qq_send_voice:'voiceEnabled'}[name];if(key&&config[key]===false)throw Error('此QQ能力已由用户关闭');}
