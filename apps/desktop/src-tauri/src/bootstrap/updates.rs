use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// 启动后在后台检查更新。
///
/// 用户确认后才下载安装 —— 这是 Tauri 官方 updater 指南的流程，也是 VS Code /
/// Obsidian 的心智：更新永远不在用户不知情时替换掉正在用的程序。
///
/// debug 构建直接跳过：开发机上的版本号总是落后于已发布的 tag，每次 tauri dev
/// 都弹一次更新框没有任何意义。
pub fn spawn(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(error) = check(app).await {
            // 没有网络、端点还没发过 release、pubkey 尚未替换 —— 都走这里。
            // 更新检查失败从来不该影响应用本身可用。
            log::info!("update check skipped: {error}");
        }
    });
}

async fn check(app: AppHandle) -> tauri_plugin_updater::Result<()> {
    let Some(update) = app.updater()?.check().await? else {
        return Ok(());
    };

    let version = update.version.clone();
    let dialog = app.dialog().clone();

    /*
     * blocking_show 会阻塞调用它的线程直到用户点掉对话框，所以它不能待在
     * async 执行器的工作线程上。spawn_blocking 把这次等待挪到阻塞线程池。
     */
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        dialog
            .message(format!(
                "Poietica {version} is available. Install it now? The application will restart."
            ))
            .title("Update available")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Install".to_owned(),
                "Later".to_owned(),
            ))
            .blocking_show()
    })
    .await
    .unwrap_or(false);

    if !accepted {
        return Ok(());
    }

    update.download_and_install(|_chunk, _total| {}, || {}).await?;

    Ok(())
}
