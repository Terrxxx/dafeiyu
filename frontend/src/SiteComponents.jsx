// Primary action is a per-component availability switch; status text supplements color. Shared cards and switches preserve the existing theme and spacing.
import React, { useState } from "react";
import { api, useData, Card, ErrorBox } from "./shared.jsx";
export default function SiteComponents({ notify }) {
  const [v, load, err, setValue] = useData("/admin/components", 10000),
    [busy, setBusy] = useState(false);
  if (err) return <ErrorBox>{err}</ErrorBox>;
  if (!v) return null;
  return (
    <Card
      title="站点组件管理"
      subtitle="停用后所有用户立即失去安装和开启权限，已开启的自动关闭；重新开放后由用户自行开启。正在执行的请求可能已完成部分操作。"
    >
      <div className="site-component-list">
        {v.components.map((c) => (
          <label className="switch-row" key={c.id}>
            <div>
              <strong>{c.name}</strong>
              <small>{c.description}</small>
              <span className={c.enabled ? "enabled-text" : "muted"}>
                {c.unavailable
                  ? "暂未开放"
                  : c.enabled
                    ? "站点已开放"
                    : "站点已停用"}
              </span>
            </div>
            <input
              aria-label={"站点组件 " + c.name}
              type="checkbox"
              disabled={busy || c.unavailable}
              checked={c.enabled}
              onChange={async (e) => {
                const enabled = e.target.checked;
                setValue({
                  ...v,
                  components: v.components.map((x) =>
                    x.id === c.id ? { ...x, enabled } : x,
                  ),
                });
                setBusy(true);
                try {
                  await api("/admin/components", {
                    id: c.id,
                    enabled,
                    revision: v.revision,
                  });
                  await load();
                  notify("站点组件策略已更新");
                } catch (e) {
                  await load();
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
        ))}
      </div>
    </Card>
  );
}
