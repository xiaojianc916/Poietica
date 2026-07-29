-- 会话标题不再有 official 这一级。
--
-- 它曾经是最高的一级，内容是 agent 在自己磁盘上给会话起的名字。Kimi 起完
-- 就不再改，于是每刷新一次侧边栏，用户首句换来的标题就被覆盖成 New Session
-- 一次，并且 title_source 被钉在 official 上，让首句标题再也写不进去。
--
-- 存量的补救来自日志本身：run_started 那一帧记着用户当时输入的原话，这正是
-- 当初本该成为标题的东西。挖得到就用它，挖不到就退回占位符，让这条对话下一
-- 次有人说话时能被重新命名。
--
-- 60 是命令层 TITLE_CHARS 的值，两边必须是同一个数。

UPDATE threads
   SET title = (
         SELECT substr(trim(json_extract(run_events.payload, '$.prompt')), 1, 60)
           FROM run_events
           JOIN runs ON runs.id = run_events.run_id
          WHERE runs.thread_id = threads.id
            AND run_events.kind = 'run_started'
            AND trim(coalesce(json_extract(run_events.payload, '$.prompt'), '')) <> ''
          ORDER BY runs.started_at, run_events.seq
          LIMIT 1
       ),
       title_source = 'message'
 WHERE title_source = 'official'
   AND EXISTS (
         SELECT 1
           FROM run_events
           JOIN runs ON runs.id = run_events.run_id
          WHERE runs.thread_id = threads.id
            AND run_events.kind = 'run_started'
            AND trim(coalesce(json_extract(run_events.payload, '$.prompt'), '')) <> ''
       );

-- 剩下的是从没人说过话的对话，没有首句可挖。
UPDATE threads
   SET title_source = 'fallback'
 WHERE title_source = 'official';
