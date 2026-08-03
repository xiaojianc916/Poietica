# ADR 0001 · 权限请求不占用 ACP 派发循环

状态：已采纳

## 背景

`crates/agent-runtime/src/driver.rs` 注册的 `RequestPermissionRequest` 处理器
曾在处理器体内 `await` 一个 `oneshot`，等待用户在界面上作答。

官方 Rust SDK 对处理器的语义是原子的（`docs/rfds/rust-sdk-v1.mdx`，
"Atomic handlers"）：一个 `on_*` 处理器返回之前，这条连接上不再处理任何一条
消息。因此那次等待冻结的不是一次提问，而是整条连接：本轮的 `session/update`、
其他会话的请求、以及 `session/prompt` 的答复全部停在门外。

Kimi Code 的子代理让这件事必现。它把子代理的过程事件吞成 `SubagentEvent`
不发 ACP（`kimi_cli/acp/session.py`），却把 `ApprovalRequest` 原样转发给父
wire（`kimi_cli/subagents/runner.py` 的 `_make_ui_loop_fn`）—— 于是子代理回合
就是"长时间没有任何更新，然后突然来一次审批"，一问即死。

## 决定

等待搬进 `connection.spawn`，`responder` 随之移入（SDK 明写 `request_cx` 是
`Send`，并推荐 spawn）。处理器只做两件同步的事：把问题记进它所属会话，把等待
挂出去，然后立刻返回。

## 后果

- 一条会话在等人回答时，其他会话照常收发 —— 多 agent 的并发地基到此才成立。
- 记录顺序不变：提问在处理器内同步记录，回答在 spawn 内记录，仍然同一条会话。
- 回合结束时 `PermissionDesk::abandon` 丢掉发送端，spawn 内的等待观察到通道
  关闭，按协议答以 `cancelled`，语义与此前一致。

## 已知的上游问题（不在本次范围）

`kimi_cli/acp/session.py` 的 `_handle_approval_request` 以
`self._turn_state.tool_calls.get(request.tool_call_id)` 查登记，取不到即
`resolve("reject")`。子代理转发上来的 tool call id 属于子代理那一侧，从未在父
回合登记，因此会被静默拒绝。这是 Kimi 侧的缺陷，客户端无法修正。
