import{toolComponent}from'./component-catalog.js';
export const chatFamilies=['web','bilibili','qzone','shopping','avatar','tasks','profile','notes','utilities','account'];
export function operationToolNames(families,text='') {
  const allowed=new Set(['qq_reply_current','qq_search_user_memory']);
  const add=(...names)=>names.forEach(n=>allowed.add(n));
  for(const family of families){
    if(family==='bilibili'){
      add('bili_search','bili_read_video','bili_video_stats','bili_related');
      if(/评论|热评/.test(text))add('bili_comments');
      if(/评论|留言/.test(text))add('bili_post_comment');
      if(/赞/.test(text))add('bili_like_video');
      if(/收藏/.test(text))add('bili_my_folders','bili_favorite_video','bili_my_favorites');
      if(/关注/.test(text))add('bili_follow_up','bili_my_following');
      if(/粉丝/.test(text))add('bili_my_fans');
      if(/历史|看过/.test(text))add('bili_my_history');
      if(/动态/.test(text))add('bili_publish_dynamic');
      if(/通知|站内|私信|消息/.test(text))add('bili_my_notices','bili_my_messages','bili_read_messages','bili_reply_message','bili_reply_notice');
    }else if(family==='web')add('web_search','web_read');
    else if(family==='qzone')add('qzone_inspect_image','qzone_read','qzone_read_comments','qzone_like_post','qzone_comment_post','qzone_reply_comment','qzone_publish');
    else if(family==='avatar')add('qq_list_images','qq_read_image','qq_set_avatar');
    else if(family==='profile')add('qq_get_profile');
    else if(family==='tasks')add('task_create','task_list','task_cancel');
    else if(family==='account')add('self_api_balance');
    else if(family==='shopping')add('mcp__dafeiyu__shopping_search','mcp__dafeiyu__shopping_home','mcp__dafeiyu__shopping_save_image');
    else if(family==='notes')add('mcp__dafeiyu__notes_list','mcp__dafeiyu__notes_read','mcp__dafeiyu__notes_write');
    else if(family==='utilities')add('mcp__dafeiyu__calculate','mcp__dafeiyu__clock');
    else if(family==='qq')add('qq_list_targets','qq_group_members','qq_send_message','qq_list_sent','qq_recall_message','qq_list_images','qq_read_image','qq_save_sticker','qq_list_stickers','qq_inspect_sticker','qq_send_sticker','qq_send_image','qq_send_voice');
  }
  if(/分享|转发|发给|发到|通知.{0,15}(群|好友)|群.{0,15}发/.test(text))add('qq_list_targets','qq_group_members','qq_send_message');
  if(/天气|气温/.test(text))add('local_weather');
  if(/(?:醒|睡).{0,10}精力/.test(text))add('self_set_wake_energy');
  return allowed;
}
const core=new Set(['local_weather','self_set_wake_energy','qq_search_user_memory','qq_list_sent','qq_recall_message','qq_list_images','qq_read_image','qq_save_sticker','qq_send_image','qq_send_voice','qq_list_stickers','qq_inspect_sticker','qq_send_sticker','qq_list_targets','qq_group_members','qq_reply_current','qq_send_message']);
export function chatToolAllowed(name,families){if(!Array.isArray(families)||core.has(name))return true;const component=toolComponent(name);const family=component?.id||(name.startsWith('task_')?'tasks':name==='qq_get_profile'?'profile':name==='self_api_balance'?'account':name==='self_rate_video'?'bilibili':null);return family?families.includes(family):false;}
