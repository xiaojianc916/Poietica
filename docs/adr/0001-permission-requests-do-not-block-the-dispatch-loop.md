# ADR 0001 · 权限请求不占用 ACP 派发循环

状态：已采纳

## 背景

`crates/agent-runtime/src/driver.rs` 注册的 `RequestPermissionRequest` 处理器
曾在处理器体内 `await` 一个 `oneshot`，等待用户在界面上作答。

官方 Rust SDK 对处理器的语义是原子的（`docs/rfds/rust-sdk-v1.mdx`，
"Atomic handlers"）：一个 `on_*` 处理器返回之前，这条连接上不再处理任何一条
消息。因此那次等待冻结的不是一次提问，而是整条连接：本轮的 `session/update`、
其他会话的请求、以及 `session/cancel` 的回执全部停在门外。

## 子代理为什么必现

kimi-code 的 ACP 适配把子代理设计成**对客户端不透明**：
`packages/acp-adapter/src/session.ts` 的 `onEvent` 首行即
`if (event.agentId !== undefined && event.agentId !== MAIN_AGENT_ID) return;`，
子代理的全部事件都不进 ACP；`test/session-prompt.test.ts` 的
`'ignores a subagent turn.ended and resolves on the main agent turn.ended'`
用例固定了这一语义。子代理的可见性只通过父代理那一次 `Agent` 工具调用体现：
`events-map.ts` 的 `toolProgressToSessionUpdate` 刷卡片标题，
`toolResultToSessionUpdate` 收尾。

而审批不在过滤范围内 —— `packages/acp-adapter/src/approval.ts` 全文没有
`agentId` 判断。于是子代理回合在 ACP 上的形状就是"长时间静默 + 必来一次
`session/request_permission`"，一问即死。

`docs/en/reference/tools.md` 的 `AgentSwarm` 进一步放大这一路：最多 128 个
子代理，"5 subagents start immediately, then 1 more every 700 ms"。

## 决定

等待搬进 `connection.spawn`，`responder` 随之移入（SDK 明写 `request_cx` 是
`Send`，并推荐 spawn）。处理器只做两件同步的事：把问题记进它所属会话，把等待
挂出去，然后立刻返回。

客户端不为子代理新增任何渲染路径 —— 按官方范式，子代理就是一张长时间运行的
工具卡，现有的工具卡渲染已经覆盖。

## 后果

- 一条会话在等人回答时，其他会话照常收发；swarm 的并发审批自然排队而非雪崩。
- 记录顺序不变：提问在处理器内同步记录，回答在 spawn 内记录，仍属同一会话。
- 回合结束时 `PermissionDesk::abandon` 丢掉发送端，spawn 内的等待观察到通道
  关闭，按协议答以 `cancelled`，语义与此前一致。
- 子代理运行期间界面近乎静默是**上游的设计**，不是缺陷；修复后的正确表现是
  工具卡持续 `in_progress`、可随时取消，而不是整个应用冻结。
