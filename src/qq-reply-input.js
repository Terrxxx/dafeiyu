import { addressContext } from './group-addressing.js';
import { markdownData } from './markdown-input.js';
export function qqReplyInput(msg, config, stickers, pictures = '', energyMode = 'normal') {
  const ids = [...new Set((msg.sources || [msg]).map(s => String(s.sender)))];
  return 'QQ当前资料\n' + markdownData({
    kind: msg.kind, target: String(msg.target), sender: String(msg.sender), name: msg.name || String(msg.sender),
    mentioned: !!msg.mentioned, identities: ids.map(id => ({ id, admin: (config.qq?.adminUsers || []).includes(id) })),
    address: addressContext(msg), message: msg.text, imageDescriptions: pictures,
    unreadReview: !!msg.unreadReview, unreadCount: msg.unreadCount ?? 0, fog: energyMode === 'fog', stickers,
  });
}
