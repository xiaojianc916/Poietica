//! 这个应用在磁盘上占了哪些位置 —— 唯一的声明处。
//!
//! 此前每个落盘点各写一份字面量：settings.json 在 bootstrap/app.rs 与
//! commands/settings.rs 共四处，agents.json 在 app.rs 与 commands/agent_config.rs
//! 共三处，受控 home 的 "agents"/"home" 只活在 controlled_home 一个私有函数里。
//! 于是没有任何一个地方能回答"卸载时该清哪些目录""备份该带走什么"。
//!
//! 布局是产品决策，属于应用组合层，不属于某一条命令 —— 专业桌面软件都有这么
//! 一个模块（VS Code 的 IEnvironmentService、Zed 的 paths.rs）。
//!
//! 平台目录由 Tauri 按 tauri.conf.json 的 identifier 解析。注意 Windows 上
//! app_config_dir 与 app_data_dir 恰好同为 %APPDATA%\{identifier}，而 Linux 上
//! 它们分别是 ~/.config 与 ~/.local/share：设置与 agent 私有数据本就分居两处。

use std::path::PathBuf;

use tauri::{AppHandle, Manager};

use crate::error::Result;

/// 用户可见设置。由 tauri-plugin-store 管理，落在 app_config_dir。
pub const SETTINGS_STORE: &str = "settings.json";

/// Agent 接入档案与 models.dev 目录缓存。密钥不在其中。
pub const AGENTS_STORE: &str = "agents.json";

/// 上一次原生崩溃。与日志同目录（app_log_dir）：它是诊断产物，不是用户数据。
pub const CRASH_REPORT_FILE_NAME: &str = "last-native-crash.json";

/// 按 agent 隔离的私有数据根，位于 app_data_dir 之下。
const AGENTS_DIRECTORY: &str = "agents";

/// 受控 home：agent 自己的 CLI 往这里写它自己的配置文件，由它自己热重载。
const AGENT_HOME_DIRECTORY: &str = "home";

/// 这个 agent 的受控 home，创建后返回。
///
/// 路径由 Rust 算，不由渲染层传：写 provider 的 CLI 与起会话的连接必须落在同一
/// 个目录，否则配置写进了一个 home、对话读的是另一个。
///
/// # Errors
///
/// 平台目录无法解析、或目录无法创建时返回错误。
pub fn agent_home(app: &AppHandle, agent_id: &str) -> Result<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()?
        .join(AGENTS_DIRECTORY)
        .join(agent_id)
        .join(AGENT_HOME_DIRECTORY);

    std::fs::create_dir_all(&directory)?;

    Ok(directory)
}
