use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_store::StoreExt;
use tauri_plugin_updater::UpdaterExt;

use crate::commands::settings::AppSettings;
use crate::paths::SETTINGS_STORE;

/// 启动后在后台检查更新。
///
/// 用户确认后才下载安装 —— 这是 Tauri 官方 updater 指南的流程，也是 VS Code /
/// Obsidian 的心智：更新永远不在用户不知情时替换掉正在用的程序。
///
/// debug 构建直接跳过：开发机上的版本号总是落后于已发布的 tag，每次 tauri dev
/// 都弹一次更新框没有任何意义。
///
/// 用户在「设置 → 隐私 → 诊断与更新」里关掉「自动检查更新」时也跳过。此前这个
/// 开关拨得动、存得下、读得回，唯独没有任何人消费它 —— 一个用户明确关闭的对外
/// 网络请求仍在发生，而界面还在显示它已经关闭。
pub fn spawn(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    if !permitted(app) {
        log::info!("update check is switched off in settings");

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

/// 用户此刻还允不允许启动时联网查版本。
///
/// 整份反序列化成 `AppSettings`，不去手抄 `privacy.updateCheck` 这条 JSON 路径：
/// 手抄一次，设置的形状就有了第二个真相来源，改一次字段名两边悄悄对不上，而这里
/// 对不上的后果是一个隐私开关静默失效。
///
/// 读不出来就按默认值走。这与 `settings_get` 面对一份坏掉的 JSON 时的处理一致 ——
/// 一份读不动的设置是一次回退，不是一次失败，更不该让"检查更新"这件事以"反正读
/// 不到，那就查吧"收场。默认值本身来自 `AppSettings`，所以这里也没有第二个来源。
fn permitted(app: &AppHandle) -> bool {
    let Ok(store) = app.store(SETTINGS_STORE) else {
        return AppSettings::default().privacy.update_check;
    };

    store
        .get("settings")
        .and_then(|value| serde_json::from_value::<AppSettings>(value).ok())
        .unwrap_or_default()
        .privacy
        .update_check
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
