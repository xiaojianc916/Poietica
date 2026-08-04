# 0004 · Kimi 接在 legacy 的 ACP 入口上

## 状态

已定。切换的前置条件见下,三条都满足之前不动。

## 事实

上游 `apps/kimi-code/src/cli/sub/` 下有两个子命令,后端是两套不同的实现:

| 子命令 | 后端 | 上游自己的说法 |
| --- | --- | --- |
| `kimi acp` | `@moonshot-ai/acp-adapter` + SDK harness | `acp-v2.ts` 逐字称它 "the legacy `@moonshot-ai/acp-adapter` over the SDK harness" |
| `kimi acp-v2` | `@moonshot-ai/acp-server` + `agent-core-v2` | "experimental agent-core-v2 engine",经 lazy dynamic import 隔离,"so the default CLI / `kimi acp` module graph stays free of the experimental v2 engine" |

只在 v2 那一套里存在的东西:

- **终端反向 RPC** — `packages/acp-server/src/acp-terminal/acpTerminalRunner.ts` 的 `AcpProcessRunner`:
  `terminal/create` → `terminal/output`(250 ms 轮询,上限 4 MiB)→ `terminal/wait_for_exit` →
  `terminal/kill` / `terminal/release`。只有 Bash 工具的调用走它(`isBashToolInvocation`:三个参数、
  `-c`、`NO_COLOR=1`、`TERM=dumb`)。
- **文件宿主** — `clientCapabilities.fs.readTextFile` 在场时 `AcpServer.newSession` 才建 `AcpKaos`
  (`test/e2e-fs.test.ts` 的说明)。
- **`session/close`** — `test/close.test.ts` 读的是 `agentCapabilities.sessionCapabilities.close`,
  而我们的握手读的是 `.delete`(`crates/agent-runtime/src/driver.rs`)。
- 每会话临时 MCP 服务、skills。

legacy 那一套里,这些一个都没有:`acp-adapter/src/marker.ts` 只留下一段讲 "Phase 7's
`AcpTerminalTool`" 的注释,而那个类在全仓不存在。

## 决定

`packages/agent-registry/src/agents/kimi.ts` 保持 `args: ['acp']`。

理由三条,都不是偏好:

1. 上游把 v2 标为 experimental,并特意用 lazy import 把它排除在默认模块图之外。
2. `acp-v2.ts` 的 `runAcpServer` 调用**没有传 `slashCommands`**。`acp.ts` 那边整段
   `resolveSlashCommands`(内置命令 + `session.listSkills()` 拼出的 `/skill:*`)在 v2 里不存在,
   切过去等于把命令面板整个丢掉。
3. v2 的红利拿不到,除非我们先实现客户端侧。`terminal/*` 与 `fs/*` 都是**客户端**方法:声明能力
   就是承诺由我们起进程、持有它、响应 kill 与 release。声明而不实现,比不声明糟。

## 切换的前置条件

三条全部满足才动那一格,顺序不能颠倒:

1. Rust 侧实现终端宿主,并在 `InitializeRequest` 上如实声明 `clientCapabilities.terminal`。
   今天那一句是 `InitializeRequest::new(ProtocolVersion::V1)` —— 一个能力都没声明,全是默认的 false。
2. 决定 `session/close` 与 `session/delete` 哪一个是我们要读的那一格,并把 `driver.rs` 的
   `sessionCapabilities.delete` 一并核对。
3. 确认 v2 的命令面板补齐,或者接受没有 `/skill:*`。

## 后果

- 抽屉在运行期没有内容,是 legacy 那一套的事实,不是 ACP 的限制。UI 因此按"有没有东西可看"
  决定自动展开(`ToolCallCard` 的 `revealsProgress`),而不是把"运行期一定空"焊进界面。
- 工具卡片的意图靠 `rawInput` 自己解(`domain/tool-intent.ts`)。上游本有结构化的
  `ToolInputDisplay`(`packages/agent-core-v2/src/tool/toolInputDisplay.ts`),但 legacy 的
  `displayBlockToAcpContent` 只放行 `diff` / `file_io` / `plan_review`,其余一律 `return null`。
