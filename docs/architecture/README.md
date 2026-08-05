# Architecture Overview

分层与依赖方向的唯一事实来源是 `tests/architecture/rules.config.mjs`，
由 `pnpm test:architecture` 在每次 CI 与提交前执行。本文只做解释，
与配置不一致时以配置为准。

## TypeScript 包分层

分层表、依赖方向、原生宿主白名单、目录命名与体量债的**唯一事实来源**是
`tests/architecture/rules.config.mjs`，由 `pnpm test:architecture` 执行。

这里不再重抄一份 —— 此前 README.md、AGENTS.md、本文件与
tests/architecture/README.md 各存一份手抄表，四份互相矛盾（本文件曾把磁盘上
不存在的 `test-kit` 列进 foundations，又漏掉一个真实存在的包），而唯一被
执行的是那份配置。手抄表只会制造第二个真相。

依赖只能指向同层或更低层。允许直连 `@tauri-apps/*` 的只有 `ipc`、
`desktop-adapters` 与 `apps/desktop`。

## 包边界的由来

`agents` 是 `agent-registry` 与 `agent-providers` 合并来的。那条边按历史切，
不按职责：两边都以 agentId 定址、都开了同名的每家子目录、注释互相引用对方的
分法。合并后包内按 agentId 分文件；agent 名单与 provider 解析同处一包，而解析
那一侧仍然不认识任何一家 —— 它只认调用方递进来的字面量，那道护栏由
`kimi/__tests__/descriptor.test.ts` 与 `__tests__/provider-state.test.ts` 两边对钉。

## 强制约束

- 目录名必须等于 `@poietica/<目录名>`。
- 新增包必须先在分层表中定层，否则架构检查抛错。
- 跨包访问只走公开 exports，禁止 deep import 与跨包相对路径。
- 每一类状态只能有一个权威来源与一条写入路径。
