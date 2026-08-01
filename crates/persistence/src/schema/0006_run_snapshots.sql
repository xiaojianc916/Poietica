-- 终态轮次的压缩投影。
--
-- run_events 不受影响，它仍然是事实来源。这张表存的是同一批帧折叠之后的
-- 等价形式：相邻的、同一种、纯文本的流式片段合并成一帧，其余帧原样保留。
-- 整张表随时可以删掉，删了只是打开对话变慢，不会丢任何东西。
--
-- version 是折叠规则的版本。规则改了就加一，旧行不会被读到、会被重新建过，
-- 所以这里永远不需要一次数据迁移。
--
-- 补建那条查询会扫一遍 runs，这是刻意的：runs 是小表（一轮一行，不是一帧
-- 一行），而补建是一次运行只跑一趟的后台活。为它留一个永久索引，代价长期
-- 摊在每一次写入上，收益只在开库后的那几秒。
CREATE TABLE run_snapshots (
    run_id   TEXT    PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
    version  INTEGER NOT NULL,
    frames   TEXT    NOT NULL,
    built_at TEXT    NOT NULL
) STRICT;
