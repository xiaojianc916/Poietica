-- 列表的顺序是「固定的在前，其余按最近活动」。0003 给 threads 加上
-- pinned 之后，只按 updated_at 建的索引就不再匹配这个排序，SQLite 只
-- 能把行取出来在内存里再排一遍。索引跟着排序走。

DROP INDEX IF EXISTS threads_by_recency;

CREATE INDEX IF NOT EXISTS threads_by_shelf
    ON threads (pinned DESC, updated_at DESC);
