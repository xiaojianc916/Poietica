use std::time::Duration;

use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_store::StoreExt;
use tauri_plugin_updater::UpdaterExt;

use crate::commands::settings::AppSettings;
use crate::paths::SETTINGS_STORE;

/// 检查间隔。只在启动时查一次，等于"一直开着的机器永远收不到更新"——桌面应用
/// 连开一周是常态。VS Code 每小时、Chrome 每五小时；六小时对一个桌面客户端
/// 足够，也不会把 GitHub 端点当成心跳接口。
const CHECK_EVERY: Duration = Duration::from_hours(6);

/// 后台检查不该在网络不通时挂住一个任务。
const CHECK_TIMEOUT: Duration = Duration::from_secs(20);

/// 启动后驱动整条更新管线：检查 → 询问 → 下载安装。
///
/// 用户确认后才下载安装 —— 这是 Tauri 官方 updater 指南的流程，也是 VS Code /
/// Obsidian 的心智：更新永远不在用户不知情时替换掉正在用的程序。
///
/// debug 构建直接跳过：开发机上的版本号总是落后于已发布的 tag。
pub fn spawn(app: &AppHandle) {
    if cfg!(debug_assertions) {
        return;
    }

    let app = app.clone();

    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(CHECK_EVERY);

        // 对话框可以停留几分钟。默认的 Burst 会把错过的 tick 立刻补上，用户
        // 点完 Later 转头就再弹一次。
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        // 用户对某个版本说过 Later，就不要每六小时再问一遍；下一个版本重新问。
        let mut declined: Option<String> = None;

        loop {
            // 第一次 tick 立即返回：启动即检查。
            ticker.tick().await;

            // 每一轮都重读设置：开关是运行时可改的，只在启动时读一次等于关掉
            // 之后仍然联网，直到下次重启。
            if !permitted(&app) {
                log::info!("update check is switched off in settings");

                continue;
            }

            match check(&app, declined.as_deref()).await {
                Ok(postponed) => declined = postponed,
                // 没有网络、端点还没发过 release、清单与内嵌公钥对不上 —— 都
                // 走这里。更新失败从不影响应用可用，但它是一条真实故障，不是
                // 一条 info：整条通道断掉过一个版本而无人知晓，就是这么来的。
                Err(error) => log::warn!("update check failed: {error}"),
            }
        }
    });
}

/// 用户此刻还允不允许联网查版本。
///
/// 整份反序列化成 `AppSettings`，不去手抄 `privacy.updateCheck` 这条 JSON 路径：
/// 手抄一次，设置的形状就有了第二个真相来源，改一次字段名两边悄悄对不上，而这里
/// 对不上的后果是一个隐私开关静默失效。
///
/// 读不出来就按默认值走，与 `settings_get` 面对坏 JSON 时的处理一致。
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

/// 走一轮检查。返回值是"用户已推迟的版本"，交回给调用方作为下一轮的输入。
async fn check(
    app: &AppHandle,
    declined: Option<&str>,
) -> tauri_plugin_updater::Result<Option<String>> {
    let updater = app.updater_builder().timeout(CHECK_TIMEOUT).build()?;

    let Some(update) = updater.check().await? else {
        return Ok(None);
    };

    if declined == Some(update.version.as_str()) {
        return Ok(declined.map(str::to_owned));
    }

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
        return Ok(Some(update.version.clone()));
    }

    /*
     * NSIS 的 passive 模式只在安装阶段显示进度条，下载阶段是完全静默的。安装包
     * 上百 MB，这段时间里没有任何记录，出问题时连"下到哪儿断的"都答不上来。
     * 每 10% 打一个点，足够定位，也不会把日志刷满。
     */
    let mut received = 0_u64;
    let mut logged = 0_u64;

    update
        .download_and_install(
            move |chunk, total| {
                received += u64::try_from(chunk).unwrap_or_default();

                let Some(total) = total.filter(|bytes| *bytes > 0) else {
                    return;
                };

                let percent = received.saturating_mul(100) / total;

                if percent >= logged + 10 {
                    logged = percent - percent % 10;
                    log::info!("update download {logged}%");
                }
            },
            || log::info!("update downloaded; handing over to the installer"),
        )
        .await?;

    Ok(None)
}
