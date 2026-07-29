//! 这个应用在磁盘上占了哪些位置 —— 唯一的声明处。
//!
//! 此前每个落盘点各写一份字面量：settings.json 在 bootstrap/app.rs 与
//! commands/settings.rs 共四处，agents.json 在 app.rs 与 `commands/agent_config.rs`
//! 共三处，受控 home 的 "agents"/"home" 只活在 `controlled_home` 一个私有函数里。
//! 于是没有任何一个地方能回答"卸载时该清哪些目录""备份该带走什么"。
//!
//! 布局是产品决策，属于应用组合层，不属于某一条命令 —— 专业桌面软件都有这么
//! 一个模块（VS Code 的 IEnvironmentService、Zed 的 paths.rs）。
//!
//! 平台目录由 Tauri 按 tauri.conf.json 的 identifier 解析，分两类，判据是数据
//! 本身而不是习惯：
//!
//! - 可漫游（`app_config_dir`，Windows 上是 %APPDATA%）：小、跟人走、丢了不心疼
//!   的用户设置。settings.json、agents.json、窗口几何都在这里。
//! - 机器本地（`app_local_data_dir`，Windows 上是 %LOCALAPPDATA%）：大的、与这台
//!   机器绑定的数据。加密对话库与各 agent 的受控 home 在这里。
//!
//! 这个划分不是风格。Windows 的漫游配置文件会在登录与注销时整份同步 %APPDATA%，
//! 而对话库开在 WAL 模式下：一个正在被 WAL 事务写、且随时会长到上百 MB 的
//! `SQLite` 库放进会被同步的目录，代价是登录变慢加上库损坏（`SQLite` 明确不支持
//! WAL 走网络文件系统）。日志与 `WebView2` 的缓存本来就由 Tauri 放在
//! `app_local_data_dir` —— 此前只有这个仓库自己手写的那个落点跑到了漫游目录。
//!
//! macOS 与 Linux 上这两个目录里的 data 一侧本就同为
//! ~/Library/Application Support 与 ~/.local/share，所以这个划分只在 Windows 上
//! 产生位移，其余平台的路径一个字节都不变。

use std::path::PathBuf;

use tauri::{AppHandle, Manager, Runtime};

use crate::error::Result;

/// 用户可见设置。由 tauri-plugin-store 管理，落在 `app_config_dir`。
pub const SETTINGS_STORE: &str = "settings.json";

/// Agent 接入档案与 models.dev 目录缓存。密钥不在其中。
pub const AGENTS_STORE: &str = "agents.json";

/// 上一次原生崩溃。与日志同目录（`app_log_dir`）：它是诊断产物，不是用户数据。
pub const CRASH_REPORT_FILE_NAME: &str = "last-native-crash.json";

/// 全部 AI 对话，SQLCipher 加密；密钥在系统钥匙串，从不与它同行。
///
/// 库开在 WAL 模式下，所以磁盘上实际是三个文件：这一个，加上同名的 -wal 与
/// -shm。备份或迁移必须三个一起，只拷主文件会丢掉最后一批未 checkpoint 的
/// 事件 —— 这正是布局需要一处声明的原因。
///
/// 名字与 identifier、与 `AgentStore` 同批改到位。改它等于让已装机用户的对话从
/// 磁盘上消失，所以只有正式发布之前这一个窗口 —— 而 identifier 这次也在改，旧
/// 路径无论如何都会作废，两件事共用同一次断裂，用户只承受一次。
pub const AGENT_DATABASE: &str = "agent.sqlite3";

/// 按 agent 隔离的私有数据根，位于 `app_local_data_dir` 之下。
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
        .app_local_data_dir()?
        .join(AGENTS_DIRECTORY)
        .join(agent_id)
        .join(AGENT_HOME_DIRECTORY);

    std::fs::create_dir_all(&directory)?;

    Ok(directory)
}

/// 机器本地数据的根，创建后返回。
///
/// 是 local 而不是 roaming：见模块头。日志与 `WebView2` 缓存同在这个根之下，所以
/// 这台机器上的全部大体积数据只有一个位置。
///
/// # Errors
///
/// 平台目录无法解析、或目录无法创建时返回错误。
fn data_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let directory = app.path().app_local_data_dir()?;

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
