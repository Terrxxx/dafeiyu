import { addressContext } from './group-addressing.js';
import { markdownData } from './markdown-input.js';
import { qqSenderRoles } from './person-identity.js';
import { canOperateQQ } from './qq-policy.js';
export function qqReplyInput(msg, config, stickers, pictures = '', energyMode = 'normal') {
  return 'QQ当前资料\n' + markdownData({
    kind: msg.kind, target: String(msg.target), sender: String(msg.sender), name: msg.name || String(msg.sender),
    mentioned: !!msg.mentioned, identities: qqSenderRoles(msg, config.qq), mayOperate: canOperateQQ(msg, config.qq),
    address: addressContext(msg), message: msg.text, imageDescriptions: pictures,
    unreadReview: !!msg.unreadReview, unreadCount: msg.unreadCount ?? 0, fog: energyMode === 'fog', stickers,
  });
}
