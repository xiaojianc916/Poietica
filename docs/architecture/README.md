# Architecture Overview

分层与依赖方向的唯一事实来源是 `tests/architecture/rules.config.mjs`，
由 `pnpm test:architecture` 在每次 CI 与提交前执行。本文只做解释，
与配置不一致时以配置为准。

## TypeScript 包分层

| 层 | 包 | 职责 |
|----|----|------|
| 0 foundations | `core` `observability` `serialization` `test-kit` `ui` | 与产品无关的基础能力；不依赖任何产品包 |
| 1 protocol | `acp` | Agent Client Protocol 的类型与编解码 |
| 2 domain | `agent-registry` `agent-session` `agent-timeline` | 会话、时间线、agent 注册的产品规则 |
| 3 transport | `ipc` | 与原生宿主之间的类型安全 DTO 通道 |
| 4 features | `agent-ui` `settings` `workspace` | 面向用户的功能域 |
| 5 composition | `desktop-runtime` | 把功能域与原生能力接线成桌面运行时 |
| 6 application | `apps/desktop` | 最终装配与入口 |

依赖只能指向同层或更低层。允许直连 `@tauri-apps/*` 的只有 `ipc`、
`desktop-runtime` 与 `apps/desktop`。

## 强制约束

- 目录名必须等于 `@poietica/<目录名>`。
- 新增包必须先在分层表中定层，否则架构检查抛错。
- 跨包访问只走公开 exports，禁止 deep import 与跨包相对路径。
- 每一类状态只能有一个权威来源与一条写入路径。
