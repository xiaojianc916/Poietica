//! 更新能力。策略与呈现不在这里。
//!
//! 原生侧只回答三件事：有没有新版本、把它下下来、装上并重启。何时检查、要不要
//! 提示、长什么样，全部归渲染层，与设置页读的是同一份设置。

use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, command};
use tauri_plugin_updater::{Update, UpdaterExt};
use tauri_specta::Event;

use crate::error::{Error, IpcError};

/// 命令面上的错误是 `IpcError`，不是 `crate::error::Error`。后者没有、也不该有
/// `specta::Type`：它的变体里带着路径与系统错误串，那些东西经 `error.rs` 的
/// `public_message` 表脱敏之后才是契约。范式同 `commands/provider_probe.rs`。
type UpdateCommandResult<T> = Result<T, IpcError>;

/// 只罩住检查请求。
///
/// 此前这个值通过 `updater_builder().timeout()` 交给底层 HTTP 客户端，于是它同时
/// 成了**下载**的上限：检查只需几百毫秒，安装包却是几十 MB，网络稍慢下载就在第
/// 20 秒被掐断。检查要有超时，下载不能有。
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// 已经下完、等着人点重启的那一个。
///
/// 上一版的注释里写过"刻意不缓存 Update"，理由是省下的只是一次几 KB 的清单请求，
/// 却引入了版本漂移。那个判断在当时成立——当时没有中间态，下载完就直接重装。
///
/// 现在中间态是需求本身：胶囊要在"下完了"和"重启吧"之间停住，等人点。而
/// `Update::install` 要的正是 `download` 吐出的那些字节和产出它们的那个
/// `Update`，两者必须一起活到人点下去为止。缓存不再是优化，是唯一的实现路径。
///
/// 代价照实说：这期间那几十 MB 待在内存里。这是这套 API 的形状决定的。
static STAGED: Mutex<Option<StagedUpdate>> = Mutex::new(None);

struct StagedUpdate {
    update: Update,
    bytes: Vec<u8>,
}

/// 一个可安装的新版本。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRelease {
    pub version: String,
    pub notes: Option<String>,
}

/// 下载进度，以百分比表达。总长未知（服务端没给 Content-Length）时为空。
///
/// 跨 IPC 的是这一个标量，不是两个字节数。此前这里是 `downloaded` 与 `total` 两个
/// `u32`：内部累加是 `u64`，跨 IPC 前饱和截断（specta 默认 `BigIntForbidden` 拒绝
/// 64 位整数），并为此写了六行注释论证 4 GiB 以上的安装包不存在。
///
/// 而渲染层拿到这两个数之后唯一做的事，是 `Math.round(downloaded / total * 100)`
/// —— 界面上从来没有出现过任何一个字节数。既然比值是唯一的消费形式，比值就该是
/// IPC 上的东西：截断连同它的论证一起不存在了，渲染层也不再重复一份算术。
/// 事件名与 payload 类型由 `collect_events!` 一并导出，渲染层不再手抄任何一个。
/// `Event` 派生要求 `Deserialize`，它只服务于这条生成通道。
#[derive(Clone, Copy, Debug, Deserialize, Event, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub percent: Option<u8>,
}

/// 已下载字节占总长的百分比，钳在 0..=100。总长未知或为零时为空。
fn percent_of(downloaded: u64, total: Option<u64>) -> Option<u8> {
    let total = total.filter(|bytes| *bytes > 0)?;

    u8::try_from((downloaded.saturating_mul(100) / total).min(100)).ok()
}

/// 更新器的失败原因不外带。
///
/// 它的错误串里可能有更新源地址、代理、以及安装包的本机落盘路径。界面要说的那句
/// 话不需要它们，日志里有完整的一份。与 `error.rs` 那张脱敏表同一条纪律。
fn plugin_failure(error: &tauri_plugin_updater::Error) -> IpcError {
    log::warn!("updater failed: {error}");

    Error::Plugin("update failed".to_owned()).into()
}

fn take_staged() -> Option<StagedUpdate> {
    STAGED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .take()
}

fn put_staged(staged: StagedUpdate) {
    *STAGED.lock().unwrap_or_else(PoisonError::into_inner) = Some(staged);
}

async fn fetch(app: &AppHandle) -> UpdateCommandResult<Option<Update>> {
    let updater = app.updater().map_err(|error| plugin_failure(&error))?;

    tokio::time::timeout(CHECK_TIMEOUT, updater.check())
        .await
        .map_err(|_elapsed| IpcError::from(Error::Plugin("update check timed out".to_owned())))?
        .map_err(|error| plugin_failure(&error))
}

/// 是否存在比当前版本更新的发布。
///
/// # Errors
///
/// 更新源不可达、超时、清单无法解析或签名校验失败时返回错误。
#[command]
#[specta::specta]
pub async fn update_check(app: AppHandle) -> UpdateCommandResult<Option<UpdateRelease>> {
    Ok(fetch(&app).await?.map(|update| UpdateRelease {
        version: update.version.clone(),
        notes: update.body.clone(),
    }))
}

/// 下载最新发布并留在内存里，期间以 `UpdateProgress` 事件广播进度。
///
/// 只下载，不安装：安装是 `update_relaunch` 的事，中间隔着人的一次点击。
///
/// # Errors
///
/// 没有可安装的版本、下载失败或签名不匹配时返回错误。
#[command]
#[specta::specta]
pub async fn update_download(app: AppHandle) -> UpdateCommandResult<()> {
    let Some(update) = fetch(&app).await? else {
        return Err(Error::NotFound("no update is available".to_owned()).into());
    };

    let emitter = app.clone();
    let mut downloaded: u64 = 0;
    let mut broadcast: Option<u8> = None;

    let bytes = update
        .download(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));

                let percent = percent_of(downloaded, total);

                /*
                 * 每个 chunk 一次事件，就是每个 chunk 一次 IPC 往返加一次渲染层的
                 * 状态更新。一个 60 MB 的安装包按 8 KB 一块是七千多次，而胶囊上能
                 * 显示的只有 101 个不同的值。没变就不发。
                 */
                if percent == broadcast {
                    return;
                }

                broadcast = percent;

                if let Err(error) = (UpdateProgress { percent }).emit(&emitter) {
                    log::warn!("could not emit update progress: {error}");
                }
            },
            || log::info!("update downloaded; waiting for the user to restart"),
        )
        .await
        .map_err(|error| plugin_failure(&error))?;

    put_staged(StagedUpdate { update, bytes });

    Ok(())
}

/// 安装已经下好的那一个，然后重启。
///
/// 这个函数正常路径上不返回：Windows 的 NSIS 安装器在 passive 模式下会接管进程。
///
/// # Errors
///
/// 没有下好的版本（例如中途重启过应用），或安装器启动失败。
#[command]
#[specta::specta]
pub async fn update_relaunch(app: AppHandle) -> UpdateCommandResult<()> {
    let Some(staged) = take_staged() else {
        return Err(Error::NotFound("no downloaded update is waiting".to_owned()).into());
    };

    staged
        .update
        .install(staged.bytes)
        .map_err(|error| plugin_failure(&error))?;

    app.restart()
}
