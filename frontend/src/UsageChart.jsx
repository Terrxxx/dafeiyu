import React, { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

const count = (n) => Math.round(n || 0).toLocaleString("zh-CN");
const compact = (n) =>
  new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
const short = (date) => Number(date.slice(5, 7)) + "/" + Number(date.slice(8));
function scale(max) {
  if (!max) return { top: 4, ticks: [0, 1, 2, 3, 4] };
  const rough = max / 4,
    power = 10 ** Math.floor(Math.log10(rough)),
    normalized = rough / power;
  const step =
    (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) *
    power;
  const top = Math.ceil(max / Math.max(1, step)) * Math.max(1, step);
  return {
    top,
    ticks: Array.from(
      { length: Math.round(top / Math.max(1, step)) + 1 },
      (_, i) => i * Math.max(1, step),
    ),
  };
}
function smoothLine(points) {
  return points.reduce((path, point, i) => {
    if (!i) return `M ${point.x} ${point.y}`;
    const previous = points[i - 1],
      third = (point.x - previous.x) / 3;
    return (
      path +
      ` C ${previous.x + third} ${previous.y} ${point.x - third} ${point.y} ${point.x} ${point.y}`
    );
  }, "");
}
function DailyChart({ days, metric, activeDate, onActiveChange }) {
  const [hover, setHover] = useState(null),
    [width, setWidth] = useState(420);
  const scroll = useRef(null),
    svg = useRef(null),
    tooltipId = useId();
  const isArea = metric === "tokens",
    title = isArea ? "每日 Tokens" : "每日请求次数",
    unit = isArea ? "tokens" : "次";
  const total = days.reduce((sum, day) => sum + day[metric], 0),
    max = Math.max(0, ...days.map((day) => day[metric]));
  const axis = scale(max),
    height = 176,
    left = 44,
    right = 4,
    top = 12,
    bottom = 28;
  const plotWidth = width - left - right,
    plotHeight = height - top - bottom,
    slot = plotWidth / days.length,
    baseline = top + plotHeight;
  const xAt = (i) => left + (i + 0.5) * slot;
  const recordedPoints = days.flatMap((day, i) =>
    day.recorded
      ? [{ x: xAt(i), y: baseline - (day[metric] / axis.top) * plotHeight }]
      : [],
  );
  const line = isArea && max > 0 ? smoothLine(recordedPoints) : "";
  const area = line
    ? `${line} L ${recordedPoints.at(-1).x} ${baseline} L ${recordedPoints[0].x} ${baseline} Z`
    : "";
  useEffect(() => {
    const element = scroll.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setWidth(Math.max(180, element.clientWidth)),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setHover(null), [days.length, days[0]?.date]);
  const exact = (day) =>
    day.date +
    "，" +
    (day.recorded
      ? count(day.tokens) +
        " tokens，" +
        count(day.requests) +
        " 次请求" +
        (day.missingUsage ? "，部分用量缺失" : "")
      : "尚未开始记录");
  function show(day, event) {
    onActiveChange(day.date);
    const box = event.currentTarget.getBoundingClientRect();
    setHover({
      day,
      x: event.clientX || box.left + box.width / 2,
      y: event.clientY || box.top + box.height / 2,
    });
  }
  function hide() {
    setHover(null);
    onActiveChange(null);
  }
  function keyboard(event, index) {
    if (event.key === "Escape") {
      hide();
      return;
    }
    if (["Enter", " "].includes(event.key)) {
      event.preventDefault();
      show(days[index], event);
    }
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? days.length - 1
            : Math.max(
                0,
                Math.min(
                  days.length - 1,
                  index + (event.key === "ArrowRight" ? 1 : -1),
                ),
              );
      svg.current.querySelectorAll("[data-usage-day]")[next]?.focus();
    }
  }
  const point = hover
    ? {
        left: Math.max(8, Math.min(hover.x + 14, innerWidth - 232)),
        top:
          hover.y + 128 > innerHeight
            ? Math.max(8, hover.y - 120)
            : hover.y + 14,
      }
    : null;
  return (
    <section
      className="usage-mini-chart"
      aria-label={title}
      onPointerLeave={hide}
    >
      <div className="usage-mini-heading">
        <h4>{title}</h4>
        <p>
          <strong>{count(total)}</strong>
          <span>{unit}</span>
        </p>
      </div>
      <div ref={scroll} className="usage-chart-scroll">
        <svg
          ref={svg}
          className={isArea ? "usage-area-chart" : "usage-bar-chart"}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={
            title + "，" + days.length + (isArea ? "天面积图" : "天柱状图")
          }
        >
          {axis.ticks.map((tick) => {
            const y = top + plotHeight * (1 - tick / axis.top);
            return (
              <g key={tick}>
                <line
                  x1={left}
                  x2={width - right}
                  y1={y}
                  y2={y}
                  className="usage-gridline"
                />
                <text
                  x={left - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="usage-axis"
                >
                  {compact(tick)}
                </text>
              </g>
            );
          })}
          {isArea && area && (
            <g aria-hidden="true">
              <path d={area} className="usage-area-fill" />
              <path d={line} className="usage-area-line" />
            </g>
          )}
          {days.map((day, i) => {
            const barWidth = Math.min(22, slot * 0.65);
            const barHeight =
              day[metric] > 0
                ? Math.max(2, (day[metric] / axis.top) * plotHeight)
                : 0;
            const active = activeDate === day.date;
            return (
              <g
                key={day.date}
                role="button"
                tabIndex={0}
                data-usage-day={day.date}
                aria-label={exact(day)}
                aria-describedby={
                  hover?.day.date === day.date ? tooltipId : undefined
                }
                className="usage-day"
                onPointerMove={(event) => show(day, event)}
                onFocus={(event) => show(day, event)}
                onBlur={hide}
                onClick={(event) => show(day, event)}
                onKeyDown={(event) => keyboard(event, i)}
              >
                <rect
                  x={left + i * slot}
                  y={top}
                  width={slot}
                  height={plotHeight}
                  className={"usage-hit" + (active ? " selected" : "")}
                />
                {!isArea && barHeight > 0 && (
                  <rect
                    x={xAt(i) - barWidth / 2}
                    y={baseline - barHeight}
                    width={barWidth}
                    height={barHeight}
                    rx={Math.min(3, barWidth / 3)}
                    className="usage-bar"
                  />
                )}
                {isArea && active && day.recorded && (
                  <circle
                    cx={xAt(i)}
                    cy={baseline - (day[metric] / axis.top) * plotHeight}
                    r="4"
                    className="usage-area-point"
                    aria-hidden="true"
                  />
                )}
              </g>
            );
          })}
          {[0, Math.round((days.length - 1) / 2), days.length - 1].map((i) => (
            <text
              key={i}
              x={xAt(i)}
              y={height - 8}
              textAnchor="middle"
              className="usage-axis"
            >
              {short(days[i].date)}
            </text>
          ))}
          {max === 0 && (
            <text
              x={left + plotWidth / 2}
              y={top + plotHeight / 2}
              textAnchor="middle"
              className="usage-axis"
            >
              暂无已记录用量
            </text>
          )}
        </svg>
      </div>
      {hover &&
        createPortal(
          <div
            id={tooltipId}
            role="tooltip"
            className="usage-floating-tooltip"
            style={point}
          >
            <strong>{hover.day.date}</strong>
            {hover.day.recorded ? (
              <>
                <span>
                  Tokens <b>{count(hover.day.tokens)}</b>
                </span>
                <span>
                  请求次数 <b>{count(hover.day.requests)}</b>
                </span>
                {hover.day.missingUsage && (
                  <small>部分请求未返回完整用量</small>
                )}
              </>
            ) : (
              <span>尚未开始记录</span>
            )}
          </div>,
          document.body,
        )}
    </section>
  );
}
export default function UsageChart({ usage }) {
  const [range, setRange] = useState(30),
    [activeDate, setActiveDate] = useState(null);
  const days = (usage.daily || []).slice(-range);
  if (!days.length)
    return <p className="muted">每日统计将在服务更新后显示。</p>;
  return (
    <section className="daily-usage" aria-label="每日用量统计">
      <div className="daily-usage-toolbar">
        <div>
          <h3>每日用量</h3>
          <p className="muted">
            {days[0].date} — {days.at(-1).date} · 北京时间
          </p>
        </div>
        <label className="daily-range">
          <span>时间范围</span>
          <select
            aria-label="用量时间范围"
            value={range}
            onChange={(event) => {
              setRange(Number(event.target.value));
              setActiveDate(null);
            }}
          >
            <option value={7}>近 7 天</option>
            <option value={30}>近 30 天</option>
          </select>
        </label>
      </div>
      <div className="usage-dual-charts">
        <DailyChart
          days={days}
          metric="tokens"
          activeDate={activeDate}
          onActiveChange={setActiveDate}
        />
        <DailyChart
          days={days}
          metric="requests"
          activeDate={activeDate}
          onActiveChange={setActiveDate}
        />
      </div>
      <p className="usage-mobile-hint muted">
        轻触图表查看当天明细，日期较多时可左右滑动。
      </p>
    </section>
  );
}
