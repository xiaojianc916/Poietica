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

use tauri::{AppHandle, Manager, Runtime};

use crate::error::Result;

/// 用户可见设置。由 tauri-plugin-store 管理，落在 app_config_dir。
pub const SETTINGS_STORE: &str = "settings.json";

/// Agent 接入档案与 models.dev 目录缓存。密钥不在其中。
pub const AGENTS_STORE: &str = "agents.json";

/// 上一次原生崩溃。与日志同目录（app_log_dir）：它是诊断产物，不是用户数据。
pub const CRASH_REPORT_FILE_NAME: &str = "last-native-crash.json";

/// 全部 AI 对话，SQLCipher 加密；密钥在系统钥匙串，从不与它同行。
///
/// 库开在 WAL 模式下，所以磁盘上实际是三个文件：这一个，加上同名的 -wal 与
/// -shm。备份或迁移必须三个一起，只拷主文件会丢掉最后一批未 checkpoint 的
/// 事件 —— 这正是布局需要一处声明的原因。
///
/// 名字里的 ai 是历史词汇（类型已叫 AgentStore）。改它等于让已装机用户的对话
/// 从磁盘上消失，所以只在正式发布之前的窗口里改，不作为一次命名整理的代价。
pub const AGENT_DATABASE: &str = "ai.sqlite3";

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
pub fn agent_home<R: Runtime>(app: &AppHandle<R>, agent_id: &str) -> Result<PathBuf> {
    let directory = app
        .path()
        .app_data_dir()?
        .join(AGENTS_DIRECTORY)
        .join(agent_id)
        .join(AGENT_HOME_DIRECTORY);

    std::fs::create_dir_all(&directory)?;

    Ok(directory)
}

/// 应用私有数据的根，创建后返回。
///
/// # Errors
///
/// 平台目录无法解析、或目录无法创建时返回错误。
fn data_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let directory = app.path().app_data_dir()?;

    std::fs::create_dir_all(&directory)?;

    Ok(directory)
}

/// 加密对话库的位置。
///
/// 此前这个名字与它的目录创建都写在 commands/agent.rs 里，也就是说这个应用
/// 最重要的一个文件，是唯一一个不在布局声明中的落点。
///
/// # Errors
///
/// 平台目录无法解析、或数据目录无法创建时返回错误。
pub fn agent_database<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(data_root(app)?.join(AGENT_DATABASE))
}
