-- 会话号只在开出它的那个 agent 那里认得。
--
-- threads 记下了一条对话握着哪个会话，却没记下那是谁的会话。装上第二个
-- agent 之后，点开一条旧对话会把 A 开的号发给 B —— B 不认识它，回来的是
-- UnknownSession，屏幕上是「这条对话的会话已经失效，请重新打开它」。那句
-- 话本来是给 agent 掉线准备的，在这里它遮住的是一列没有建的列。
--
-- 空值是「不知道」，留给这一列存在之前写下的行：那时候装得下的 agent 只有
-- 一个，所以第一次寻址按当前这个算，装载成功就把它记实，之后不再是空的。
-- Zed 的 sidebar_threads 把内置 agent 也存成空值，是同一个约定。

ALTER TABLE threads ADD COLUMN agent_id TEXT;
