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
/// 不会失败。窗口已经不在了就什么也不做 —— 一个关掉的窗口没有开发者工具可开，
/// 那不是故障。
///
/// 此前这一段写的是「底层操作失败时返回错误」，而这个函数的每一条路径都返回
/// `Ok` —— 那不是一段文档，是一句假话，它唯一的作用是让 clippy 闭嘴。返回
/// `Result` 的真实理由是这张 `invoke_handler` 上的命令共用一个返回形状；要换成
/// `()`，得连生成绑定和渲染层的调用点一起改。
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
///
/// # Errors
///
/// 不会失败，理由就是上面那句：拒掉一个非 web 协议、以及系统浏览器没能打开，
/// 都各自记进日志，而不是变成一次调用失败。返回 `Result` 的理由与上面那条命令
/// 相同。
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
