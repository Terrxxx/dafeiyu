import { validNapMinutes } from './sleep.js';
import { assertMemoryEpoch } from './user-controls.js';
import { incomingAllowed } from './qq-policy.js';

const digit = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function duration(value, unit) {
  if (value === '半') return unit.endsWith('小时') ? 30 : NaN;
  let number = Number(value);
  if (Number.isNaN(number)) {
    const [tens, ones] = value.split('十');
    number = ones === undefined ? digit[tens] : (tens ? digit[tens] : 1) * 10 + (ones ? digit[ones] : 0);
  }
  return unit.endsWith('小时') ? number * 60 : number;
}

export function adminRestCommand(msg, policy) {
  const id = String(msg.sender);
  if (msg.kind !== 'private' || msg.unreadReview || String(msg.target) !== id ||
      !(policy.adminUsers || []).includes(id)) return null;
  const sources = msg.sources || [msg];
  if (sources.some(source => String(source.sender) !== id)) return null;
  const text = sources.map(source => String(source.text || '').trim())
    .filter(value => value && !/^晚安[呀啦哦。！!~～]*$/.test(value)).at(-1);
  if (!text) return null;
  const command = text.replace(/[。！!？?~～\s]+$/, '')
    .replace(/[，,]\s*晚安[呀啦哦]?$/, '')
    .replace(/^(?:(?:大肥鱼|鱼鱼|你)[，,、\s]*){0,2}/, '')
    .replace(/^(?:(?:给我|现在|先|快点|快|马上|赶紧|乖乖|早点|可以|该)\s*){0,4}/, '')
    .replace(/(?:好不好|可以吗|吧|啦|哦|了)$/, '').trim();
  const timed = command.match(/^(?:去)?(?:小睡|午睡|睡觉?|眯(?:觉)?|打个盹)(?:上|个)?\s*(\d+(?:\.\d+)?|[零一二两三四五六七八九十]{1,3}|半)\s*(分钟|分|个小时|小时)$/);
  if (timed) return { minutes: duration(timed[1], timed[2]) };
  if (/^(?:去)?(?:小睡|午睡|打个盹|眯一?(?:小)?会儿?|睡一?(?:小)?会儿?)$/.test(command)) return { minutes: 15 };
  if (/^(?:(?:去)?睡(?:觉)?(?:去)?|去休息)$/.test(command)) return {};
  return null;
}

export async function handleAdminRest(msg, key, epoch, { agent, store, tools, qq, log }) {
  if (!tools.sleep?.requestRest) return false;
  const policy = qq.policy?.() || agent.config?.qq || {};
  const command = adminRestCommand(msg, policy);
  if (!command) return false;
  if (store.data.actions[key]) return true;
  assertMemoryEpoch(store, epoch);
  if (!incomingAllowed(policy, msg.kind, msg.target, msg.sender)) return true;
  store.appendHistory(msg.session, 'user', `${msg.name || msg.sender}（${msg.sender}）：${msg.text}`, agent.config?.agent?.historyMessages);
  tools.begin(msg.session, { ...msg, key, memoryEpoch: epoch });
  if (command.minutes !== undefined && !validNapMinutes(command.minutes)) {
    await tools.call('qq_reply_current', { text: '小睡选5到30分钟哦' });
    return true;
  }
  let confirmation;
  const result = tools.sleep.requestRest({
    ...command, reason: 'admin',
    beforeSleep: ({ reason, minutes }) => {
      confirmation = tools.call('qq_reply_current', { text: reason === 'nap' ? `我先眯${minutes}分钟` : '我先去睡啦' })
        .catch(error => log('睡前回复未确认，仍按指令休息：' + error.message));
    },
  });
  if (result) {
    log(result.reason === 'nap' ? 'QQ：已按指令进入小睡' : 'QQ：已按指令进入睡眠');
    await confirmation;
    store.data.actions[key] ||= { state: 'sleep-started', time: Date.now() };
    store.save();
  }
  return true;
}
