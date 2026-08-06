# Rust Crate 分层

工作区成员见根 `Cargo.toml`。三个 crate 加一个组合根，依赖单向向下。

## crates/agent-runtime — `poietica-agent-runtime-native`

拥有 agent 进程的驱动：会话生命周期、运行槽、权限请求、帧编解码、
事件记录与 stderr 归集。

- 依赖 `agent-client-protocol`、`futures`、`serde`、`serde_json`、
  `thiserror`、`uuid`、`which`。
- **不依赖 `tauri`**，可用普通 `cargo test` 单独测试。

## crates/persistence — `poietica-agent-persistence-native`

拥有本地 SQLite 存储：连接管理、迁移、schema 与线程记录。

- 依赖 `rusqlite`、`serde`、`serde_json`、`time`、`uuid`、`log`。
- **不依赖 `tauri`**。

## crates/desktop-runtime — `poietica-desktop-runtime-native`

拥有与业务无关的桌面平台能力：窗口、外部打开、生命周期、系统主题、
运行时信息。

- 依赖仅 `serde` 与 `thiserror`。**不依赖 `tauri`**，也不依赖另外两个 crate。

## apps/desktop/src-tauri — `poietica`

唯一的组合根：初始化 Tauri 与插件、建窗、注册命令、持有 native 服务、
在边界上把 IPC DTO 与领域类型互转、把错误映射为稳定的 IPC 错误。

## 规则

- 三个 native crate 都不得依赖 `tauri`，也不得互相依赖。
- 命令函数是薄封装，业务分支应下沉到 native crate。
- 领域实体定义在 native crate，不在 `src-tauri`。
- 每个 crate 都必须写 `[lints] workspace = true`，否则工作区的
  `unsafe_code = "deny"` 与 `non_ascii_idents = "forbid"` 对它不生效。

## 已知偏差

`src-tauri/src/commands/` 下的 `agent.rs`、`agent_config.rs`、
`agent_install.rs` 远超"薄封装"的规模，业务分支尚未下沉到 native crate。
这些偏差已被 `tools/architecture/size-budget.json` 的体量棘轮冻结：基线里的文件只
允许变小，基线外的生产源文件不得越过字节上限。债只能往下走，不会再悄悄长大。

上面「规则」一节的四条，目前有三条由 `pnpm test:architecture` 的
`native-crates-stay-host-agnostic` 执行：不依赖 `tauri`、互不依赖、必须写
`[lints] workspace = true`。第四条「领域实体定义在 native crate，不在
`src-tauri`」**没有机器执行** —— 它需要语义分析，不是正则或清单判得出来的，
所以这里不假装它被守住了。「命令函数是薄封装」同理，只由体量棘轮从旁侧压住。
