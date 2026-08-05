use tauri::{AppHandle, command};
use tauri_plugin_dialog::DialogExt;

/// 请系统的文件夹选择器给出一个工作目录。人按了取消就是 None。
///
/// 为什么是一条自己的命令，而不是让渲染层直接调 dialog 插件 —— 这与 opener 的
/// 取舍同源（理由写在 src-tauri/Cargo.toml 里那一段）：把插件的 IPC 面交给
/// webview，等于连 save / message / ask / confirm 一起交出去，而这里要的只有
/// 「选一个目录」。走这条命令，webview 能碰到的就只有它：没有参数，回一个路径。
///
/// 它不返回 Result。选择器开不出来、人什么都没选，调用方要做的事完全相同 ——
/// 什么也不改。与 window.rs 那两条命令同一条理由。
#[command]
#[specta::specta]
pub async fn workspace_pick_root(app: AppHandle) -> Option<String> {
    let (answer, wait) = tokio::sync::oneshot::channel();

    /* 回调式，不是 blocking_pick_folder：这条命令本来就是异步的，没有理由
    为了等人做决定去占住一个线程。 */
    app.dialog().file().pick_folder(move |picked| {
        drop(answer.send(picked));
    });

    match wait.await {
        Ok(picked) => picked.as_ref().map(ToString::to_string),
        Err(_) => {
            log::warn!("the folder chooser went away without answering");

            None
        }
    }
}
