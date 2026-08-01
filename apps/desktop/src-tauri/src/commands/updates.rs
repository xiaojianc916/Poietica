//! 更新能力。策略与呈现不在这里。
//!
//! 此前这整件事长在 `bootstrap/updates.rs`：一个后台任务自己判权限、自己检查、
//! 自己用 `tauri_plugin_dialog` 弹一个系统 message box 问人、再自己下载。那个
//! 对话框拿不到应用的设计令牌与主题，也没有地方放进度 —— 下载进度只写进日志，
//! 于是用户点完"安装"看到的是一个什么都不发生的界面。
//!
//! 现在原生侧只回答两个问题："有没有新版本"和"把它装上"，进度以事件广播。
//! 何时检查、要不要提示、长什么样，全部归渲染层，与设置页读的是同一份设置。

use std::time::Duration;

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter, command};
use tauri_plugin_updater::UpdaterExt;

use crate::error::{Error, IpcError};

/// 命令面上的错误是 `IpcError`，不是 `crate::error::Error`。
///
/// 后者没有、也不该有 `specta::Type`：它的变体里带着路径、系统错误串和 agent
/// 原话，那些东西经由 `error.rs` 的 `public_message` 表脱敏之后才是契约。与
/// `commands/provider_probe.rs` 的 `ProviderProbeCommandResult` 同一个范式。
type UpdateCommandResult<T> = Result<T, IpcError>;

/// 只罩住检查请求。
///
/// 此前这个值通过 `updater_builder().timeout()` 交给底层 HTTP 客户端，于是它
/// 同时成了**下载**的上限：检查只需几百毫秒，而安装包是几十 MB，网络稍慢下载
/// 就在第 20 秒被掐断。检查要有超时，下载不能有。
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// 下载进度事件。渲染层的常量与这里同名同值。
pub const UPDATE_PROGRESS_EVENT: &str = "poietica://update-progress";

/// 一个可安装的新版本。
#[derive(Clone, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRelease {
    pub version: String,
    pub notes: Option<String>,
}

/// 下载进度。`total` 在服务端未给出 Content-Length 时为空。
#[derive(Clone, Copy, Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpdateProgress {
    pub downloaded: u64,
    pub total: Option<u64>,
}

/// 更新器的失败原因不外带。
///
/// 它的错误串里可能有更新源地址、代理、以及安装包的本机落盘路径。界面要说的那
/// 句话不需要它们，日志里有完整的一份。这与 `error.rs` 那张脱敏表是同一条纪律。
fn plugin_failure(error: &tauri_plugin_updater::Error) -> IpcError {
    log::warn!("updater failed: {error}");

    Error::Plugin("update failed".to_owned()).into()
}

async fn fetch(app: &AppHandle) -> UpdateCommandResult<Option<tauri_plugin_updater::Update>> {
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

/// 下载并安装最新发布，期间以 `UPDATE_PROGRESS_EVENT` 广播进度。
///
/// 成功返回后安装器已经接手，应用即将被替换并重启。
///
/// 刻意不在 `update_check` 与这里之间缓存 `Update`：那需要一份带锁的原生状态，
/// 而它唯一省下的是一次几 KB 的清单请求，却会引入"缓存里的版本和现在的发布不是
/// 同一个"这一类只在发布当口出现的问题。
///
/// # Errors
///
/// 没有可安装的版本、下载失败、签名不匹配或安装器启动失败时返回错误。
#[command]
#[specta::specta]
pub async fn update_install(app: AppHandle) -> UpdateCommandResult<()> {
    let Some(update) = fetch(&app).await? else {
        return Err(Error::NotFound("no update is available".to_owned()).into());
    };

    let emitter = app.clone();
    let mut downloaded: u64 = 0;

    update
        .download_and_install(
            move |chunk, total| {
                downloaded = downloaded.saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));

                let progress = UpdateProgress { downloaded, total };

                if let Err(error) = emitter.emit(UPDATE_PROGRESS_EVENT, progress) {
                    log::warn!("could not emit update progress: {error}");
                }
            },
            || log::info!("update downloaded; handing over to the installer"),
        )
        .await
        .map_err(|error| plugin_failure(&error))?;

    Ok(())
}
