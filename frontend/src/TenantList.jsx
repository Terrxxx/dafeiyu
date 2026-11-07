// Primary: choose a tenant to inspect; secondary: account state. Shared card, field and list tokens keep this consistent. Read-only links are the only actions.
import React, { useState } from "react";
import { Card, Empty } from "./shared.jsx";
export default function TenantList({ users }) {
  const [q, setQuery] = useState("");
  const rows = users.filter(
    (u) => u.qq && (u.username + " " + u.qq).includes(q),
  );
  return (
    <Card
      title="大肥鱼列表"
      subtitle="站点管理员可只读查看各用户的大肥鱼面板，不能通过查看入口修改数据或控制服务。"
    >
      <label className="field">
        <span>查找大肥鱼</span>
        <input
          aria-label="查找大肥鱼"
          placeholder="用户名或QQ号"
          value={q}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="tenant-grid">
        {rows.map((u) => (
          <article className="tenant-card" key={u.username}>
            <div className="user-identity">
              <div className="avatar">{u.username[0]}</div>
              <div>
                <strong>{u.username} 的大肥鱼</strong>
                <small>QQ {u.qq}</small>
              </div>
            </div>
            <p className="muted">
              {u.disabled
                ? "账号已停用"
                : u.billing
                  ? "余额不足"
                  : u.desired
                    ? "期望运行"
                    : "已停止"}
            </p>
            <a href={"/panel?tenant=" + encodeURIComponent(u.username)}>
              只读查看面板 ↗
            </a>
          </article>
        ))}
      </div>
      {!rows.length && <Empty>没有符合条件的大肥鱼</Empty>}
    </Card>
  );
}
