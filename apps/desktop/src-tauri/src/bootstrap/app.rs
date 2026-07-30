use tauri::{Manager, Wry, async_runtime};
use tauri_plugin_store::StoreExt;
use tauri_plugin_window_state::{StateFlags, WindowExt};

use super::{logging, tray};
use crate::asset_protocol::{ASSET_PROTOCOL_SCHEME, AssetProtocolRegistry};
use crate::commands;
use crate::paths::{AGENTS_STORE, SETTINGS_STORE};

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
        /*
         * 必须是第一个注册的插件：它要在其余初始化发生之前判定本进程是不是多余
         * 的那一个。
         *
         * 一个带托盘的应用不做单实例，后果是确定的：第二次双击图标开出第二个
         * 进程、第二个托盘图标、两份互相覆写的窗口状态，以及两个互不知情的
         * DocumentRegistry —— 同一个文件可以在两个窗口里各改各的。
         */
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                tray::show_main(app);
            },
        ))
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
            app.store(SETTINGS_STORE)?;
            app.store(AGENTS_STORE)?;
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
            constrain_to_visible_area(&main_window);

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
            commands::agent::agent_set_config_option,
            commands::agent::agent_capabilities,
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
            commands::settings::settings_get,
            commands::settings::settings_set,
            commands::settings::settings_reset,
            commands::agent_config::agent_config_get,
            commands::agent_config::agent_key_tails,
            commands::agent_config::agent_config_save_agents,
            commands::agent_config::agent_config_clear_legacy_providers,
            commands::agent_cli::agent_cli_exec,
        ])
}

/// 把窗口约束回它所在显示器的可视范围内。
///
/// 几何有两个来源。磁盘上的状态文件由 window-state 插件负责，它自己会把恢复出
/// 的位置约束回显示器，那条路径是安全的。没有被任何人检查过的是另一条：
/// tauri.conf.json 里的默认值。1400x900 在一台 1366x768 的笔记本上放不下，而
/// 居中会把它摆在 y = -86，标题栏落到工作区上方 —— 窗口是 decorations: false，
/// 没有原生系统菜单可以用键盘把它拖回来，于是首次启动就是一个拖不动的窗口。
///
/// 这里只做约束，不做决定：几何本来就成立时它是空操作。最大化与全屏跳过，
/// 那两种状态下的尺寸本来就等于显示器。
fn constrain_to_visible_area(window: &tauri::WebviewWindow) {
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return;
    }

    let Ok(Some(monitor)) = window.current_monitor() else {
        return;
    };

    let monitor_size = *monitor.size();
    let monitor_position = *monitor.position();

    /*
     * 95% 是任务栏的替代品，不是它的测量值。work_area 的语义各平台不一致，而
     * 这里要的只是"别铺满整块屏、别顶到边缘之外"，不需要像素级贴合。
     */
    let max_width = monitor_size.width.saturating_mul(95) / 100;
    let max_height = monitor_size.height.saturating_mul(95) / 100;

    let Ok(size) = window.outer_size() else {
        return;
    };

    let width = size.width.min(max_width);
    let height = size.height.min(max_height);

    if (width, height) != (size.width, size.height)
        && let Err(error) = window.set_size(tauri::PhysicalSize::new(width, height))
    {
        log::warn!("could not clamp the window to its monitor: {error}");
        return;
    }

    let Ok(position) = window.outer_position() else {
        return;
    };

    let monitor_left = i64::from(monitor_position.x);
    let monitor_top = i64::from(monitor_position.y);
    let monitor_right = monitor_left + i64::from(monitor_size.width);
    let monitor_bottom = monitor_top + i64::from(monitor_size.height);

    let left = i64::from(position.x);
    let top = i64::from(position.y);

    let fits = left >= monitor_left
        && top >= monitor_top
        && left + i64::from(width) <= monitor_right
        && top + i64::from(height) <= monitor_bottom;

    if fits {
        return;
    }

    if let Err(error) = window.center() {
        log::warn!("could not recentre the window on its monitor: {error}");
    }
}
