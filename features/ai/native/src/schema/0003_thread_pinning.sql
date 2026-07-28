-- 固定：会话在列表里的位置由它决定，与最近活动无关。
-- STRICT 表允许追加带默认值的 INTEGER 列，已有会话默认不固定。
ALTER TABLE threads ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
