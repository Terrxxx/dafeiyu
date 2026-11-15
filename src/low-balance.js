import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "./atomic-file.js";
export function cnyBalance(value) {
  const row = value?.balances?.find((x) => x.currency === "CNY");
  const amount = Number(row?.total);
  return row && Number.isFinite(amount) && amount >= 0 ? amount : null;
}
export function publishBalance(directory, value) {
  const file = path.join(directory, "balance-notice.json"),
    amount = cnyBalance(value);
  if (amount === null) return;
  let previous = {};
  try {
    previous = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {}
  const low = amount < 5;
  const episode = low
    ? previous.low
      ? previous.episode
      : crypto.randomUUID()
    : null;
  atomicWriteFile(
    file,
    JSON.stringify({ low, amount, episode, checkedAt: value.checkedAt }),
  );
}
export async function notifyLowBalance({
  directory,
  config,
  store,
  tools,
  qq,
  log = () => {},
}) {
  if (config.provider === "custom" || !config.qq.enabled || tools.sleep?.sleeping()) return;
  let notice;
  try {
    notice = JSON.parse(
      fs.readFileSync(path.join(directory, "balance-notice.json"), "utf8"),
    );
  } catch {
    return;
  }
  if (!notice.low || !notice.episode || Date.now() - notice.checkedAt > 600000)
    return;
  store.data.meta.balanceAlerts ||= {};
  for (const id of config.qq.adminUsers || []) {
    if (store.data.meta.balanceAlerts[id] === notice.episode) continue;
    tools.sleep?.assertAwake();
    store.data.meta.balanceAlerts[id] = notice.episode;
    store.save();
    try {
      await qq.send(
        "private",
        id,
        "余额快不够啦，API余额仅剩 ¥" +
          notice.amount.toFixed(2) +
          "，低于5元。记得看看充值～",
      );
      log("已向管理员发送低余额提醒");
    } catch (e) {
      log("余额提醒未确认送达，本轮不重复发送：" + e.message);
    }
  }
}
