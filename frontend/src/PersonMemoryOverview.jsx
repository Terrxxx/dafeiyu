/* Current person's overview first, origin and age as metadata. Reuse Card,
   chat records and toolbar spacing from the console. */
import React, { useState } from 'react';
import { Card, Empty, ErrorBox, useData } from './shared.jsx';

const roles = { user: '对方', assistant: '大肥鱼', fact: '长期记忆', activity: '互动', note: '备注记忆' };

export default function PersonMemoryOverview({ id }) {
  const [page, setPage] = useState(1);
  const [data, , error] = useData(`/api/memories/${id}?view=overview&page=${page}`, 10000);
  const overview = data && data.page === Math.min(page, data.pages) ? data : null;
  return (
    <Card title="记忆概述" subtitle="只读 · 睡眠整理时更新，合并这位用户的私聊、群聊和长期记忆。">
      {error ? <ErrorBox>{error}</ErrorBox> : !overview ? <Empty>正在读取记忆概述…</Empty> :
        !overview.records.length ? <Empty>暂未整理出概述。已记录的聊天将在睡眠期间汇总。</Empty> :
          <>
            <div className="chat-history">
              {overview.records.map((record, index) => (
                <article className={`chat memory-record ${record.role}`} key={index}>
                  <small>
                    {[record.day, record.time, roles[record.role], record.origins.join(' / '),
                      record.important && '重要',
                      record.count > 1 && `合并 ${record.count} 条`].filter(Boolean).join(' · ')}
                  </small>
                  <p>{record.content}</p>
                </article>
              ))}
            </div>
            <div className="toolbar">
              <small className="muted">{overview.total} 条概述 · 第 {overview.page} / {overview.pages} 页</small>
              {overview.pages > 1 && <div className="actions">
                <button type="button" disabled={overview.page <= 1} onClick={() => setPage(overview.page - 1)}>上一页</button>
                <button type="button" disabled={overview.page >= overview.pages} onClick={() => setPage(overview.page + 1)}>更早的记忆</button>
              </div>}
            </div>
          </>
      }
    </Card>
  );
}
