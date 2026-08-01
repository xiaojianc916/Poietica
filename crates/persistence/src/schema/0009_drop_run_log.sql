-- 本地不再留第二份对话记录。
--
-- 这五张表存的是「这台机器自己记的那份历史」：run_events 是逐帧流水，
-- run_snapshots 是它折叠后的等价形式，tool_calls 与 permissions 是它的
-- 投影，runs 把它们串成轮次。写它们、读它们的代码都已经删干净了，表再
-- 留着，留下的就只是一份没人维护、注定和 agent 那边漂移的真相。
--
-- 历史从此只有一份，在 agent 那边，由 session/load 交还。
--
-- 删表之前先对齐一件事：列表此前用「有没有 runs 行」判断一条对话有没有
-- 被说过话，之后用「名字是不是还挂着占位」。绝大多数行两个判据一致，但
-- 0007 那第二条 UPDATE 会造出「有轮次、却退回 fallback」的行。先把它们
-- 标成 message，列表成员就一行不差。
UPDATE threads
   SET title_source = 'message'
 WHERE title_source = 'fallback'
   AND EXISTS (SELECT 1 FROM runs WHERE runs.thread_id = threads.id);

-- 先子后父。表上的索引随表一起消失，不需要单独 DROP INDEX。
DROP TABLE IF EXISTS run_snapshots;
DROP TABLE IF EXISTS run_events;
DROP TABLE IF EXISTS tool_calls;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS runs;
