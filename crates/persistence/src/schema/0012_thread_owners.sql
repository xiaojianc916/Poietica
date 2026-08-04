-- 握着会话的对话，必须说得出那是谁的会话。
--
-- 0008 加出 agent_id 时把空值定义成「不知道」，留给那一列存在之前写下的行。
-- 但 create_thread 建出来的新行同样是空的，于是这一格有了两个意思：还没有
-- 握住会话，以及握着一个不知道主人的会话。命令层今天靠「空主人一律算成自己
-- 的」把两者合并处理（session_for 里的 is_none_or），装得下的 agent 只有一个
-- 时它总是对的；一旦两个 agent 同时常驻，它就是把 A 开的号发给 B。
--
-- 一个格子只留一个意思：空值 = 还没有握住会话。
--
-- 存量补实为 kimi，因为那就是当时的事实：这些行写下的时候，注册表里的
-- agent 只有一个（AGENTS 里只有 kimiCode，类型上还有个单 agent 的 AcpAgentId）。
-- 命令层今天对这些行的处理也正是「发给当下唯一那条连接」，所以补实之后用户
-- 看到的行为一字不差，历史照样加载。另一条路是把它们的 session_id 清空，那会
-- 让存量对话重开时丢掉全部历史 —— 不为了模型干净去动用户的东西。
UPDATE threads
   SET agent_id = 'kimi'
 WHERE session_id IS NOT NULL
   AND agent_id  IS NULL;

-- 从此由库拦着，而不是由写侧自觉。
--
-- 为什么不是 CHECK：给已有表加 CHECK 只能走官方那套 12 步重建表流程，而重建
-- 要求 PRAGMA foreign_keys=OFF，pragma 在事务里是空操作；migrations.rs 把每条
-- 迁移都包在一个事务里，connection.rs 又把外键打开了，而 0010 的
-- thread_attachments 还引用着这张表，DROP TABLE threads 会当场被外键拒。
-- 触发器同样是官方给的约束手段，留在事务内、不重建表、还能报出一句人话。
--
-- UPDATE OF 只列这两列：record_prompt、set_pinned、name_by_user 每一轮都在写
-- 这张表，它们与这条不变量无关，一次都不该被它拖累。
CREATE TRIGGER IF NOT EXISTS threads_session_needs_owner_on_insert
BEFORE INSERT ON threads
WHEN NEW.session_id IS NOT NULL AND NEW.agent_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'a thread holding a session must name the agent that opened it');
END;

CREATE TRIGGER IF NOT EXISTS threads_session_needs_owner_on_update
BEFORE UPDATE OF session_id, agent_id ON threads
WHEN NEW.session_id IS NOT NULL AND NEW.agent_id IS NULL
BEGIN
    SELECT RAISE(ABORT, 'a thread holding a session must name the agent that opened it');
END;
