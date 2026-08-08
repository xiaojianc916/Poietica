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
//! 安装版的根就是可执行文件所在的那个目录。用户在安装器的目录页只做一次选择，
//! 那一次选择同时回答「程序装到哪」和「数据存到哪」，不需要第二个页面、第二个
//! 开关，也不需要记住第二条路径。
//!
//! 这里不去读安装器写的声明文件。Tauri 打的是 Unicode NSIS 安装器，它的
//! FileWrite 输出 UTF-16LE，而这边按 UTF-8 读 —— 一个需要跨语言约定编码的机制，
//! 换成「exe 在哪，数据就在哪」之后没有可错的地方。
//!
//! 卸载不会带走数据：卸载器逐个 Delete 它自己装进去的文件，最后那句
//! RMDir 不带 /r，数据文件还在时它删不掉那个目录。要清干净得由用户在卸载器上
//! 勾「删除应用数据」，那一条在 installer-hooks.nsh 里处置。
//!
//! 开发构建不适用上面这条：exe 在 target/debug 下，那不是任何人的数据目录。
//! 开发落点固定在平台目录，而 identifier 由 tauri.dev.conf.json 覆盖成带 .dev
//! 后缀的形式 —— 开发与安装版因此不会同时打开同一个 WAL 库，也不会互相覆盖各自
//! 的 settings.json 与 agent 凭据。目录名不在这个模块里重复一遍：
//! `app_local_data_dir()` 返回的就是本地数据目录拼上 identifier，identifier 归
//! 配置管，在这里再写一份常量等于同一件事有两个真相。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::{AppHandle, Manager, Runtime};

use crate::error::{Error, Result};

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
const PLUGINS_DIRECTORY: &str = "plugins";
/// 点开头：列举托管副本时那条「点开头不是合法插件标识符」的规则会排除它。
const PLUGINS_STAGING_DIRECTORY: &str = ".staging";
const PLUGINS_RECORD_FILE: &str = "installed.json";
const MARKETPLACE_CATALOG_FILE: &str = "marketplace.json";
const AGENTS_DIRECTORY: &str = "agents";

/// 受控 home：agent 自己的 CLI 往这里写它自己的配置文件，由它自己热重载。
const AGENT_HOME_DIRECTORY: &str = "home";

/// 根解析一次就固定。它在进程存续期间不会变，而每条命令都要问它。
static ROOT: OnceLock<PathBuf> = OnceLock::new();

/// 安装时选定的根，也就是可执行文件旁边。
///
/// 开发构建返回 None：那时 exe 在 target/debug 下，往那里写用户数据既会被
/// cargo clean 抹掉，也会跟着构建产物进版本库。用 cfg! 而不是两份 #[cfg] 函数
/// 体，是为了让两条分支都参与编译，不会有一侧变成没人发现的死代码。
fn installed_root() -> Option<PathBuf> {
    if cfg!(debug_assertions) {
        return None;
    }

    Some(std::env::current_exe().ok()?.parent()?.to_path_buf())
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

    let resolved = match installed_root() {
        Some(chosen) => chosen,
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

/// 插件的托管副本都在这一层下面，一个插件一个目录。
pub fn plugins_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let directory = root(app)?.join(PLUGINS_DIRECTORY);

    fs::create_dir_all(&directory)?;

    Ok(directory)
}

/// 某一个插件的托管副本。
///
/// 标识符来自渲染层解码出来的清单，在拼路径的这一处验，而不是指望每个调用点自己
/// 记得验 —— 这是唯一一个把它变成路径的地方。
pub fn plugin_directory<R: Runtime>(app: &AppHandle<R>, plugin_id: &str) -> Result<PathBuf> {
    if !poietica_plugin_host_native::is_safe_segment(plugin_id) {
        return Err(Error::Validation(format!("不是合法的插件标识符：{plugin_id}")));
    }

    Ok(plugins_root(app)?.join(plugin_id))
}

/// 安装中途的暂存区。
///
/// 放在 plugins/ 里面而不是系统临时目录：认领那一步是一次 rename，跨卷会失败，而
/// 系统临时目录经常在另一个卷上。名字以点开头，列举托管副本时会被那条「点开头不是
/// 合法插件标识符」的规则自然排除。
pub fn plugins_staging_root<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    let directory = plugins_root(app)?.join(PLUGINS_STAGING_DIRECTORY);

    fs::create_dir_all(&directory)?;

    Ok(directory)
}

/// 装了哪些插件、开没开、哪些 MCP 服务器被单独关掉。
pub fn plugins_record<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(plugins_root(app)?.join(PLUGINS_RECORD_FILE))
}

/// 上一次拉到的市场目录。拉过一次就不再自动拉，刷新是用户的动作。
pub fn marketplace_catalog<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf> {
    Ok(plugins_root(app)?.join(MARKETPLACE_CATALOG_FILE))
}

