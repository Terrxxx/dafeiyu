import React, { useState } from "react";
const num = (n) => Math.round(n || 0).toLocaleString("zh-CN");
export default function UsagePie({ categories = [] }) {
  const [active, setActive] = useState(null),
    items = categories.filter((c) => Number.isFinite(c.tokens) && c.tokens > 0),
    total = items.reduce((sum, c) => sum + c.tokens, 0);
  let angle = -Math.PI / 2;
  const parts = items.map((c, index) => {
    const start = angle,
      amount = c.tokens / total;
    angle += amount * Math.PI * 2;
    const x = (a) => 80 + 66 * Math.cos(a),
      y = (a) => 80 + 66 * Math.sin(a),
      path =
        "M80 80 L" +
        x(start) +
        " " +
        y(start) +
        " A66 66 0 " +
        (amount > 0.5 ? 1 : 0) +
        " 1 " +
        x(angle) +
        " " +
        y(angle) +
        " Z";
    return { ...c, index, amount, path };
  });
  return (
    <div className="usage-pie-layout">
      <svg
        viewBox="0 0 160 160"
        className="usage-pie"
        role="group"
        aria-label="Token 用途扇形占比图"
      >
        {!total ? (
          <circle cx="80" cy="80" r="66" className="usage-pie-empty" />
        ) : (
          parts.map((c) => (
            <g
              key={c.id}
              style={{
                "--slice-color":
                  "var(--usage-pie-" + ((c.index % 10) + 1) + ")",
              }}
              className={
                "usage-pie-slice" +
                (active && active !== c.id ? " muted-slice" : "")
              }
              onPointerEnter={() => setActive(c.id)}
              onPointerLeave={() => setActive(null)}
            >
              <title>
                {c.name +
                  "：" +
                  num(c.tokens) +
                  " tokens，" +
                  (c.amount * 100).toFixed(1) +
                  "%"}
              </title>
              {parts.length === 1 ? (
                <circle cx="80" cy="80" r="66" />
              ) : (
                <path d={c.path} />
              )}
            </g>
          ))
        )}
      </svg>
      <div className="usage-pie-legend">
        {total ? (
          parts.map((c) => (
            <button
              key={c.id}
              type="button"
              aria-label={
                c.name +
                "，" +
                num(c.tokens) +
                " tokens，占" +
                (c.amount * 100).toFixed(1) +
                "%"
              }
              onPointerEnter={() => setActive(c.id)}
              onPointerLeave={() => setActive(null)}
              onFocus={() => setActive(c.id)}
              onBlur={() => setActive(null)}
            >
              <i
                aria-hidden="true"
                style={{
                  background: "var(--usage-pie-" + ((c.index % 10) + 1) + ")",
                }}
              />
              <span>
                {c.name}
                <small>{num(c.tokens)} tokens</small>
              </span>
              <strong>{(c.amount * 100).toFixed(1)}%</strong>
            </button>
          ))
        ) : (
          <p className="muted">暂无可计算占比的分类用量</p>
        )}
      </div>
    </div>
  );
}
