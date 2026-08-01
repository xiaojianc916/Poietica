-- 两条读路径此前都没有可用的索引。
--
-- 会话列表按 (pinned, updated_at) 取序，会话回放按 (thread_id, started_at, id)
-- 归并 run；两者都只能全表扫再建临时 B-tree 排序，而 updated_at 与 id 都是
-- TEXT，比较本身也贵。索引把排序换成顺序读。
--
-- run_events(run_id, seq) 不在此列：它已有 UNIQUE 约束，SQLite 自带索引。

CREATE INDEX IF NOT EXISTS threads_shelf_order
    ON threads (pinned DESC, updated_at DESC, id);

CREATE INDEX IF NOT EXISTS runs_thread_order
    ON runs (thread_id, started_at, id);
