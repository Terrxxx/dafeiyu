import fs from "node:fs";
import path from "node:path";
import { componentCatalog } from "./component-catalog.js";
import { atomicWriteFile } from "./atomic-file.js";
export function readComponentPolicy(directory) {
  const file = path.join(directory, ".component-policy.json");
  if (!fs.existsSync(file)) return {};
  try {
    const v = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!v.disabled || !Array.isArray(v.disabled)) throw Error();
    return v;
  } catch {
    return { disabled: componentCatalog.map((x) => x.id), invalid: true };
  }
}
export function siteComponentAllowed(id, directory) {
  return !readComponentPolicy(directory).disabled?.includes(id);
}
export function enforceComponentPolicy(config, directory) {
  for (const id of readComponentPolicy(directory).disabled || []) {
    config.components ||= {};
    config.components[id] = { ...config.components[id], enabled: false };
  }
  return config;
}
export function publishComponentPolicy(dataRoot, policy, names) {
  for (const entry of names ? names.map(name=>({name,isDirectory:()=>true})) : fs.readdirSync(dataRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const directory = path.join(dataRoot, entry.name),
      file = path.join(directory, "config.json");
    if (!fs.existsSync(file)) continue;
    const text = JSON.stringify(policy);
    const p = path.join(directory, ".component-policy.json");
    if (!fs.existsSync(p) || fs.readFileSync(p, "utf8") !== text)
      atomicWriteFile(p, text);
    const old = fs.readFileSync(file, "utf8"),
      config = JSON.parse(old.replace(/^\uFEFF/, ""));
    let changed = false;
    for (const id of policy.disabled || []) {
      if (config.components?.[id]?.enabled !== false) {
        config.components ||= {};
        config.components[id] = { ...config.components[id], enabled: false };
        changed = true;
      }
    }
    if (changed) atomicWriteFile(file, JSON.stringify(config, null, 2) + "\n");
  }
}
