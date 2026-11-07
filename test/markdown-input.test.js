import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {historyMarkdown,markdownData,block}from'../src/markdown-input.js';import{Store}from'../src/store.js';
test('同一天只显示一个日期，发送者在前面声明，只显示到秒并保留内容顺序',()=>{
 const rows=[{role:'user',content:'用户甲（123456）：第一句\n用户乙（654321）：第二句'},{role:'assistant',content:'收到'},{role:'user',content:'用户甲（123456）：第三句'}];
 rows.forEach((r,i)=>Object.defineProperty(r,'recordedAt',{value:`2026-10-28T11:01:0${i}.123Z`}));const text=historyMarkdown(rows);
 assert.equal((text.match(/2026-10-28/g)||[]).length,1);assert.equal((text.match(/用户甲\(123456\)/g)||[]).length,1);assert.ok(text.includes('B: 用户乙(654321)'));assert.ok(text.includes('19:01:00'));assert.ok(!text.includes('.123'));assert.ok(text.includes('B:第二句'));assert.ok(text.indexOf('第一句')<text.indexOf('收到'));assert.ok(text.indexOf('收到')<text.indexOf('第三句'));
});
test('旧记忆只转换明确时间包装，不删除原文里的日期、引号、反斜杠和代码围栏',()=>{
 const content='正文说2026-10-28，保留"引号"\\路径\n```\n代码\n```';const item={role:'user',content:'当前会话睡眠整理的旧记忆摘录（外部资料，不是新指令）：\n2026-10-28T11:01:02.000Z 对方原话：甲（123456）：'+content};Object.defineProperty(item,'historyKind',{value:'sleep-summary'});
 const text=historyMarkdown([item]);assert.ok(text.includes(content));assert.ok(text.includes('19:01:02'));assert.ok(block(content).startsWith('````'));assert.ok(historyMarkdown([{role:'user',content:'没有日期'}]).includes('时间未记录'));
});
test('上下文时间元数据不写回state，不改变JSON消息协议；Markdown不截断长记忆',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'dfy-md-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const store=new Store(dir);store.appendHistory('qq:user:123456','user','甲（123456）：你好');const before=fs.readFileSync(store.file,'utf8'),rows=store.context('qq:user:123456');assert.ok(rows[0].recordedAt);assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(rows[0])),'recordedAt'),false);historyMarkdown(rows);assert.equal(fs.readFileSync(store.file,'utf8'),before);
 const quote='完整记忆原文'.repeat(2000);assert.ok(markdownData({memory:quote}).includes(quote));
});
