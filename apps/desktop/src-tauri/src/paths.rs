//! 这个应用在磁盘上占了哪些位置 —— 唯一的声明处。
//!
//! 一个根，一个位置。settings.json、agents.json、automations.json、线程索引、
//! 附件字节、各 agent 的受控 home、日志与崩溃报告，全都在它下面。用户要备份、
//! 要搬机器、要把这个应用从磁盘上抹干净，需要知道的路径只有一条。
//!
//! 此前是三个根：三份 store 在 `app_config_dir`（Windows 上的漫游 %APPDATA%），
//! 线程库与附件在 `app_local_data_dir`，日志在 `app_log_dir`。三处都由平台目录
//! 各自解析，谁也不知道另外两处在哪 —— 这个模块的存在意义正是回答「卸载时该清
//! 哪些目录」，而它当时答不上来。
//!
//! 根在哪由两件事决定，顺序固定：
//!
//! 1. 可执行文件旁边的 `data-directory`。安装器按用户在安装期选的位置写下它。
//! 2. 没有这个文件时，`app_local_data_dir()`。
//!
//! 目录名不在这个模块里重复一遍。`app_local_data_dir()` 返回的就是本地数据目录
//! 拼上 identifier，而 identifier 归配置管：开发运行时 `scripts/tauri.mjs` 会给
//! dev 子命令补上 `tauri.dev.conf.json`，那份配置把 identifier 覆盖成带 .dev 后缀
//! 的形式，于是开发与安装版天然落在两个目录里，不会共用一个 WAL 库、不会互相覆盖
//! 各自的 settings.json 与 agent 凭据。在这里再写一份常量，等于同一件事有两个真相，
//! 改一处另一处不会跟着变。
//!
//! 别把根挪成按 productName 命名的目录。Tauri 的 NSIS 模板在 currentUser 模式下
//! 把安装目录默认成本地数据目录下以 productName 命名的那个文件夹，两者同名就是把
//! 用户数据摊进安装目录，交给升级与卸载流程去动。而卸载器上「删除应用数据」那个
//! 复选框，删的正是以 identifier 命名的目录 —— 跟着 identifier 走，这两件事自动
//! 对齐，不需要任何人记住。
//!
//! 声明文件放在 exe 旁边而不是某个平台目录里，是因为「可移动的位置」总得有一个
//! 不可移动的地方来记。JetBrains 的 idea.properties 与 VS Code 的 portable data
//! 目录用的是同一个位置。
//!
//! 为什么是本地数据目录而不是漫游目录：Windows 的漫游配置文件在登录与注销时整份
//! 同步 %APPDATA%，而线程索引开在 WAL 模式下，附件可以是几十 MB。把它们放进会被
//! 同步的目录，代价是登录变慢加上库损坏（SQLite 明确不支持 WAL 走网络文件系统）。
//! settings.json 本可以漫游，但把它单独留在另一个根，等于为了一个 2 KB 的文件把
//! 「一个位置」这件事作废。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

use crate::error::Result;

/// 安装器写在可执行文件旁边的落点声明。内容是一行绝对路径。
const LOCATION_FILE: &str = "data-directory";

const SETTINGS_FILE: &str = "settings.json";
const AGENTS_FILE: &str = "agents.json";
const AUTOMATIONS_FILE: &str = "automations.json";

/// 对话索引：有哪些对话、叫什么、握着谁的会话、挂着哪些附件。
///
/// 不加密，也不存对话内容 —— 判据见 ADR 0012。库开在 WAL 模式下，所以磁盘上
/// 实际是三个文件：这一个，加上同名的 -wal 与 -shm。备份必须三个一起。
const THREAD_DATABASE: &str = "threads.sqlite3";

const LOG_DIRECTORY: &str = "logs";
const CRASH_REPORT_FILE: &str = "last-native-crash.json";
const ATTACHMENTS_DIRECTORY: &str = "attachments";
const AGENTS_DIRECTORY: &str = "agents";

/// 受控 home：agent 自己的 CLI 往这里写它自己的配置文件，由它自己热重载。
const AGENT_HOME_DIRECTORY: &str = "home";

/// 根解析一次就固定。它在进程存续期间不会变，而每条命令都要问它。
static ROOT: OnceLock<PathBuf> = OnceLock::new();

/// 安装期选定的根，如果安装器声明过的话。
///
/// 读不到、是空行、或者不是绝对路径，都当作没有声明：一个相对路径会相对于进程
/// 的工作目录展开，而那是调用方决定的，不是用户决定的。
///
/// 开发构建同样问这个文件，不开特例。开发时 exe 在 target/debug 下，安装器从没
/// 在那里写过东西，正常情况下读不到；真有人把声明文件放了过去，那就是明确要求
/// 换个落点，照办即可 —— 开发与安装版之间的隔离由 identifier 保证，不靠这里。
fn configured_root() -> Option<PathBuf> {
    let beside = std::env::current_exe().ok()?.parent()?.join(LOCATION_FILE);
    let declared = fs::read_to_string(beside).ok()?;
    let trimmed = declared.trim();

    if trimmed.is_empty() {
        return None;
    }

    let path = PathBuf::from(trimmed);

    path.is_absolute().then_some(path)
}

/// 这个应用的数据根，创建后返回。
///
/// # Errors
///
/// 平台目录无法解析、或根目录无法创建时返回错误。
fn root<R: Runtime>(app: &AppHandle<R>) -> Result<&'static Path> {
    if let Some(known) = ROOT.get() {
        return Ok(known.as_path());
    }

    let resolved = match configured_root() {
        Some(declared) => declared,
        None => app.path().app_local_data_dir()?,
    };

    fs::create_dir_all(&resolved)?;

    Ok(ROOT.get_or_init(|| resolved).as_path())
}

/// 数据根本身。关于面板要把它显示给用户，所以它是公开的。
///
/// # Errors
///
/// 平台目录无法解析、或根目录无法创建时返回错误。
pub fn data_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(root(app)?.to_path_buf())
}

/// 用户可见设置。
///
/// # Errors
///
/// 根目录无法解析或创建时返回错误。
pub fn settings_store<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(root(app)?.join(SETTINGS_FILE))
}

/// Agent 接入档案与安装状态缓存。密钥不在其中。
///
/// # Errors
///
/// 根目录无法解析或创建时返回错误。
pub fn agents_store<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(root(app)?.join(AGENTS_FILE))
}

/// 自动化定义。运行记录只在其中留指针，正文在对话里。
///
/// # Errors
///
/// 根目录无法解析或创建时返回错误。
pub fn automations_store<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(root(app)?.join(AUTOMATIONS_FILE))
}

/// 对话索引库的位置。
///
/// # Errors
///
/// 根目录无法解析或创建时返回错误。
pub fn thread_database<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(root(app)?.join(THREAD_DATABASE))
}

/// 日志目录，创建后返回。
///
/// # Errors
///
/// 根目录无法解析、或日志目录无法创建时返回错误。
pub fn log_directory<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let directory = root(app)?.join(LOG_DIRECTORY);

    fs::create_dir_all(&directory)?;

    Ok(directory)
}

/// 上一次原生崩溃的报告。与日志同目录：它是诊断产物，不是用户数据。
///
/// # Errors
///
/// 日志目录无法解析或创建时返回错误。
pub fn crash_report<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(log_directory(app)?.join(CRASH_REPORT_FILE))
}

/// 附件字节的根，内容寻址，创建后返回。
///
/// 目录里的东西是内容寻址的：`<root>/<hash 前两位>/<hash>`。两级散列不是装饰，
/// 单目录堆上几万个条目之后，NTFS 的枚举与创建都会明显变慢 —— git 的 objects、
/// npm 的 cache、浏览器的 cache 用的都是这一套。
///
/// 谁清理它：字节不跟着对话删。删对话只解开索引里的链接，字节留给启动时的回收，
/// 因为同一张图可能还挂在别的对话上。
///
/// # Errors
///
/// 根目录无法解析、或附件目录无法创建时返回错误。
pub fn attachments_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let directory = root(app)?.join(ATTACHMENTS_DIRECTORY);

    fs::create_dir_all(&directory)?;

    Ok(directory)
}

/// 这个 agent 的受控 home，创建后返回。
///
/// 路径由 Rust 算，不由渲染层传：写 provider 的 CLI 与起会话的连接必须落在同一
/// 个目录，否则配置写进了一个 home、对话读的是另一个。
///
/// # Errors
///
/// 根目录无法解析、或目录无法创建时返回错误。
pub fn agent_home<R: Runtime>(app: &AppHandle<R>, agent_id: &str) -> Result<PathBuf> {
    let directory = root(app)?
        .join(AGENTS_DIRECTORY)
        .join(agent_id)
        .join(AGENT_HOME_DIRECTORY);

    fs::create_dir_all(&directory)?;

    Ok(directory)
}
