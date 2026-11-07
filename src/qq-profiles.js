import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile } from "./atomic-file.js";
import { recordQzoneAction } from "./qq-journal.js";
import { userBlocked } from "./user-controls.js";
export function readQQProfiles(directory) {
  const file = path.join(directory, "qq-profiles.json");
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
}
export function saveQQProfile(directory, id, nickname) {
  if (
    !/^[1-9]\d{0,19}$/.test(String(id)) ||
    typeof nickname !== "string" ||
    !nickname.trim()
  )
    return;
  const profiles = readQQProfiles(directory);
  profiles[id] = {
    nickname: nickname
      .replace(/[\x00-\x1f]/g, " ")
      .trim()
      .slice(0, 100),
    checkedAt: Date.now(),
  };
  atomicWriteFile(
    path.join(directory, "qq-profiles.json"),
    JSON.stringify(profiles),
  );
}
export async function refreshQQProfiles({ store, tools, qq }) {
  if (
    tools.config.qq?.enabled === false ||
    tools.config.qq?.profileReadEnabled === false ||
    qq.socket?.readyState !== 1 ||
    tools.sleep?.sleeping()
  )
    return;
  const directory = path.dirname(store.file),
    profiles = readQQProfiles(directory),
    now = Date.now();
  for (const id of Object.keys(store.data.feelings?.users || {})
    .filter(
      (id) =>
        !userBlocked(store, id) &&
        now - (profiles[id]?.checkedAt || 0) >= 86400000 &&
        now >= (profiles[id]?.retryAt || 0),
    )
    .slice(0, 10)) {
    tools.sleep?.assertAwake();
    try {
      store.reserve("qq-profile-sync", 30);
      const value = await recordQzoneAction(
        store,
        "profile",
        { owner: id },
        () => qq.call("get_stranger_info", { user_id: Number(id) }),
      );
      tools.sleep?.assertAwake();
      saveQQProfile(directory, id, value.nickname);
    } catch {
      const latest = readQQProfiles(directory);
      latest[id] = { ...latest[id], retryAt: now + 3600000 };
      atomicWriteFile(
        path.join(directory, "qq-profiles.json"),
        JSON.stringify(latest),
      );
    }
  }
}
