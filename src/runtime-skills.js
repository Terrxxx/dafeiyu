import fs from 'node:fs';
export const defaultRuntimeSkills = fs.readFileSync(new URL('./runtime-skills.md', import.meta.url), 'utf8').trim();
export const replySkillActivation = '\n启用聊天回复封装。';
export function buildSystemPrompt(persona = '') { return defaultRuntimeSkills + '\n\n# 用户人格设定\n' + persona; }
