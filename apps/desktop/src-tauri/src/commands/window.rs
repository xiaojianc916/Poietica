use tauri::{AppHandle, Manager, command};

use crate::error::Result;

/// 唯一没有 JavaScript 对应物的窗口操作。
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
