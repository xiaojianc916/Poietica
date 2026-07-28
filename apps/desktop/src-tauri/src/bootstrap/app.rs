use tauri::{Manager, Wry, async_runtime};
use tauri_plugin_store::StoreExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};

use super::{logging, tray};
use crate::asset_protocol::{ASSET_PROTOCOL_SCHEME, AssetProtocolRegistry};
use crate::commands;
use crate::commands::document::DocumentRegistry;

/// Label of the only window this application declares. Matches tauri.conf.json.
pub const MAIN_WINDOW: &str = "main";

/// 被持久化、也被恢复的那一份窗口几何。
///
/// 保存与恢复必须用同一个集合，否则磁盘上会留下没人读的字段，或者读到没人写的
/// 字段。这个常量是唯一的声明处：托盘与窗口命令都消费它，不再各写一遍 `all()`。
///
/// 刻意不含 VISIBLE：可见性归托盘状态机。隐藏到托盘时存下的 visible: false 若被
/// 当成恢复目标，下一次启动窗口就打不开了。
///
/// 刻意不含 DECORATIONS：边框归 tauri.conf.json（decorations: false + 自绘标题
/// 栏）。让磁盘上的旧值有机会把原生边框装回来，收益为零。
pub const WINDOW_STATE_FLAGS: StateFlags = StateFlags::SIZE
    .union(StateFlags::POSITION)
    .union(StateFlags::MAXIMIZED)
    .union(StateFlags::FULLSCREEN);

pub fn build() -> tauri::Builder<Wry> {
    let asset_protocol = AssetProtocolRegistry::default();
    let protocol_registry = asset_protocol.clone();

    tauri::Builder::<Wry>::default()
        .manage(DocumentRegistry::default())
        .manage(asset_protocol)
        /*
         * A synchronous protocol handler is invoked by the platform webview on
         * its own thread, which is the UI thread on Windows and macOS. Building
         * a response takes the registry read lock and copies the asset, up to
         * MAX_ASSET_BYTES of it, so answering inline stalled painting and input
         * for the length of that copy on every cache miss.
         *
         * The copy cannot be removed. Tauri bounds a protocol response body by
         * Into<Cow<'static, [u8]>>, and an asset owned by the registry is not
         * 'static, so it can only be handed over as Cow::Owned. Sharing types
         * do not help. What can be fixed is which thread pays for it.
         *
         * The responder is Send, so the work moves to the blocking executor and
         * the webview thread returns immediately.
         */
        .register_asynchronous_uri_scheme_protocol(
            ASSET_PROTOCOL_SCHEME,
            move |_context, request, responder| {
                let registry = protocol_registry.clone();

                async_runtime::spawn_blocking(move || {
                    responder.respond(registry.response(&request));
                });
            },
        )
        .plugin(logging::plugin().build())
        .plugin(tauri_plugin_store::Builder::new().build())
        /*
         * 初始几何恢复由下面的 setup 显式驱动，插件不做。
         *
         * 插件默认在 on_window_ready 里 restore_state，那已经晚于窗口按
         * center: true 创建并显示的时刻，于是每次启动都能看见窗口从屏幕中央被磁盘
         * 上的坐标挪走。窗口现在以 visible: false 创建，恢复完位置和尺寸才呈现:
         * 一次定位，一次呈现。
         *
         * 首次启动没有状态文件，恢复是空操作，此时生效的正是 center: true。
         */
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(WINDOW_STATE_FLAGS)
                .skip_initial_state(MAIN_WINDOW)
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            app.store("settings.json")?;
            let _managed = app.manage(commands::agent::AgentRuntime::new(app.handle())?);
            crate::diagnostics::install(app.handle())?;
            tray::install(app.handle())?;

            /*
             * 承接 skip_initial_state：初始几何恢复的责任在这里，不在插件。
             *
             * 窗口此刻还不可见（tauri.conf.json 的 visible: false），所以恢复位置和
             * 尺寸不会被看到，用户第一次看见它时它已经在正确的地方。restore_state
             * 期间插件持有恢复锁，其间产生的 Moved / Resized 不会被当成用户操作写
             * 回缓存 —— 这也是宁可调插件自己的恢复、而不是手写 set_position 的原因。
             *
             * 首次启动没有状态文件，恢复是空操作，此时生效的正是 center: true。
             */
            let main_window = app
                .get_webview_window(MAIN_WINDOW)
                .ok_or("tauri.conf.json 未声明 main 窗口")?;

            main_window.restore_state(WINDOW_STATE_FLAGS)?;

            /*
             * 呈现权归渲染层：窗口在 React 首帧提交后由前端 present()。
             *
             * 此前 show() 就在这里。setup 早于 webview 执行任何脚本，所以用户先
             * 看到的是一个空的 #f3f3f3 窗口，一直持续到首帧。visible: false 换来
             * 的只是"位置不跳"，白屏并没有被解决。
             *
             * 下面是唯一的兜底：webview 若根本没跑起来（脚本 404、CSP 拦截、渲染
             * 进程启动失败），没有它窗口会永远不可见，进程只存在于任务管理器里。
             */
            let watchdog = main_window.clone();

            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(8));

                if watchdog.is_visible().unwrap_or(false) {
                    return;
                }

                log::warn!("frontend did not present within 8s; showing the window anyway");

                let _shown = watchdog.show();
                let _focused = watchdog.set_focus();
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::agent::agent_prompt,
            commands::agent::agent_cancel,
            commands::agent::agent_resolve_permission,
            commands::agent::agent_shutdown,
            commands::agent::agent_load_run,
            commands::agent::agent_load_thread,
            commands::agent::agent_config_options,
            commands::agent::agent_set_config_option,
            commands::agent::agent_new_session,
            commands::agent::agent_sessions,
            commands::agent::agent_threads,
            commands::agent::agent_open_thread,
            commands::agent::agent_rename_thread,
            commands::agent::agent_delete_thread,
            commands::agent::agent_pin_thread,
            commands::asset::asset_session_open,
            commands::asset::asset_upload,
            commands::asset::asset_remove,
            commands::asset::asset_session_close,
            commands::diagnostics::diagnostics_take_previous_crash,
            commands::window::window_open_devtools,
            commands::document::document_open,
            commands::document::document_save_as,
            commands::document::document_save,
            commands::document::document_close,
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_reset,
        ])
}
