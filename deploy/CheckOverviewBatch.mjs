import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { chromium } from "playwright-core";
import { startManager } from "../manager/server.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dfy-overview-batch-"));
const manager = await startManager({
  dataRoot: dir,
  port: 0,
  origins: [],
  runtime: async (operation) => operation === "logs" ? { text: "" } : { phase: "stopped" },
  request: async () => Response.json({ is_available: true, balance_infos: [] }),
});
manager.accounts.db.prepare(
  "INSERT INTO users(username,role,created,email,email_verified) VALUES(?,?,?,?,1)",
).run("owner", "admin", Date.now(), "owner@example.test");
await manager.tenants.create("owner", {
  apiKey: "test-key",
  qq: "12345678",
  adminQQ: "87654321",
});
const base = "http://127.0.0.1:" + manager.server.address().port;
const session = manager.accounts.session("owner");
const browser = await chromium.launch({
  executablePath: "/usr/bin/chromium",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.context().addCookies([{ name: "dfy_session", value: session.value, url: base }]);
try {
  await page.goto(base + "/panel");
  await page.getByRole("heading", { name: "Token 用途占比" }).waitFor();
  const headline = await page.locator(".life-banner h2").innerText();
  assert.ok([
    "今天，也在慢慢成长。", "今天想收集一点好消息。", "先看看今天会遇见谁。",
    "慢慢来，也会有新发现。", "今天也想认真生活。",
    "说不定会碰到有趣的事。", "今天也要好好照顾自己。",
  ].includes(headline));
  assert.equal(await page.getByText("仅统计本实例已记录的模型用量；今天的数据仍会增长。未开始记录的日期留空。").count(), 0);
  const pie = await page.locator(".usage-dashboard-side .usage-pie-layout").evaluate((el) => {
    const chart = el.querySelector("svg").getBoundingClientRect();
    const legend = el.querySelector(".usage-pie-legend");
    const labels = legend.getBoundingClientRect();
    return { chartX: chart.x, chartWidth: chart.width, chartHeight: chart.height,
      legendX: labels.x, legendWidth: labels.width, scrollbar: getComputedStyle(legend).scrollbarWidth };
  });
  assert.ok(pie.chartX < pie.legendX && pie.chartWidth > pie.legendWidth);
  assert.ok(Math.abs(pie.chartWidth - pie.chartHeight) < 1);
  assert.equal(pie.scrollbar, "none");
  await page.goto(base + "/panel#life");
  await page.getByRole("heading", { name: "她的情绪" }).waitFor();
  const life = await page.locator(".life-three-column > .card").evaluateAll((cards) =>
    cards.map((card) => ({ x: card.getBoundingClientRect().x, y: card.getBoundingClientRect().y })));
  assert.equal(life.length, 3);
  assert.equal(new Set(life.map((card) => card.y)).size, 1);
  assert.ok(life[0].x < life[1].x && life[1].x < life[2].x);
  await page.goto(base + "/panel#components");
  await page.getByRole("tab", { name: /已安装/ }).waitFor();
  assert.equal(await page.locator(".component-tools").count(), 0);
  const components = await page.locator(".component-grid > .card").evaluateAll((cards) =>
    cards.map((card) => ({ y: card.getBoundingClientRect().y, height: card.getBoundingClientRect().height })));
  const firstRow = components.filter((card) => card.y === components[0]?.y);
  assert.ok(firstRow.length >= 2);
  assert.equal(new Set(firstRow.map((card) => card.height)).size, 1);
  for (const activity of ["qqActivity", "activity"]) {
    await page.goto(base + "/panel#" + activity);
    await page.getByLabel("行为筛选").waitFor();
    const controls = await page.locator(".records-search-controls").evaluate((el) => {
      const search = el.querySelector(".search").getBoundingClientRect();
      const select = el.querySelector("select").getBoundingClientRect();
      return { searchRight: search.right, searchY: search.y, filterX: select.x, filterY: select.y };
    });
    assert.ok(controls.searchRight < controls.filterX);
    assert.ok(Math.abs(controls.searchY - controls.filterY) < 4);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ headline: true, pieAdaptive: true, noteRemoved: true,
    lifeOneRow: true, componentCardsEqual: true, apiNamesHidden: true,
    qqBiliFiltersBesideSearch: true, mobileOverflow: false, errors }));
} finally {
  await browser.close();
  await manager.close();
  assert.ok(dir.startsWith(os.tmpdir() + path.sep + "dfy-overview-batch-"));
  fs.rmSync(dir, { recursive: true, force: true });
}
