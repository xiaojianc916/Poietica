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
`asset_protocol.rs` 同样过大。这些是待偿还的债，不是本文档认可的做法。
