use tauri::{AppHandle, Manager, command};

use crate::error::Result;

/// 打开开发者工具。没有 `JavaScript` 对应物的两个窗口操作之一。
///
/// 渲染层需要的其余能力（show / hide / minimize / maximize / close / destroy /
/// `set_title`）都由 @tauri-apps/api/window 直接提供，权限在
/// capabilities/main-window.json 里声明。此前它们各自被包成一条自定义命令，
/// 其中 `window_destroy` 与 `window_open_devtools` 从未出现在 `invoke_handler` 里，
/// 于是应用退出的第一跳每次都失败，靠渲染层的 catch 兜底才走得下去。
///
/// # Errors
///
/// Returns an error when the underlying operation fails; the message handed
/// to the caller is the redacted IPC message, never native detail.
#[command]
pub async fn window_open_devtools(app: AppHandle, label: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        window.open_devtools();
    }

    Ok(())
}

/// 把一个外部 URL 交给系统默认浏览器。没有 `JavaScript` 对应物的两个之二。
///
/// 主窗口是 decorations: false，没有地址栏也没有后退按钮。让 webview 自己导航
/// 到外站，等于把应用替换成一个回不来的浏览器 —— 用户只能去杀进程。所以渲染层
/// 里所有 http(s) 链接都在 capture 阶段被拦下，改走这里。
///
/// 协议白名单在渲染层（presentation/chrome/external-links.ts）先过一遍，这里
/// 再过一遍：一条能把任意字符串交给系统 shell 的命令，不能只靠调用方自律。
///
/// 打不开一个链接不是故障，不中断调用方。真实原因留在原生日志里。
#[command]
pub async fn window_open_external_url(url: String) -> Result<()> {
    let allowed =
        url.starts_with("http://") || url.starts_with("https://") || url.starts_with("mailto:");

    if !allowed {
        log::warn!("refused to hand a non-web URL to the system browser");

        return Ok(());
    }

    if let Err(error) = tauri_plugin_opener::open_url(url.as_str(), None::<&str>) {
        log::warn!("could not hand a link to the system browser: {error}");
    }

    Ok(())
}
