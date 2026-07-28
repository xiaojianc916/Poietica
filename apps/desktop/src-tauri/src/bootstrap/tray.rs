//! Windows-first system tray integration.
//!
//! 托盘只做三件事：显示窗口、隐藏窗口、请求退出。
//!
//! 它不决定应用能不能退出。未保存的工作属于应用层，所以"退出程序"发出的是一个
//! 请求：渲染层收到后走与关闭按钮完全相同的确认流程，确认完再销毁窗口。此前这里
//! 直接 app.exit(0)，那条路径绕开了全部确认，从托盘退出会静默丢弃未保存的画布。
//!
//! 关闭按钮也不再被这里拦截。拦截权归渲染层，唯一。

use std::time::Duration;

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_window_state::AppHandleExt;

use super::app::{MAIN_WINDOW, WINDOW_STATE_FLAGS};

const TRAY_ID: &str = "poietica-tray";
const MENU_SHOW: &str = "poietica-tray-show";
const MENU_HIDE: &str = "poietica-tray-hide";
const MENU_QUIT: &str = "poietica-tray-quit";

/// 与渲染层之间唯一的退出契约。
pub const TERMINATION_REQUESTED_EVENT: &str = "poietica://termination-requested";

/// 渲染层无响应时的兜底时限：它可能正停在崩溃屏上，处理不了退出请求。
const TERMINATION_FALLBACK: Duration = Duration::from_secs(5);

/// Installs the tray icon and its menu. Called once from the composition root.
///
/// # Errors
///
/// Returns an error when the underlying operation fails; the message handed
/// to the caller is the redacted IPC message, never native detail.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, MENU_SHOW, "显示窗口", true, None::<&str>)?;
    let hide = MenuItem::with_id(app, MENU_HIDE, "隐藏到托盘", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, MENU_QUIT, "退出程序", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &hide, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Poietica")
        .menu(&menu)
        // Windows convention: left click activates, right click opens the menu.
        .show_menu_on_left_click(false)
        .on_menu_event(on_menu_event)
        .on_tray_icon_event(on_tray_icon_event);

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let _tray = builder.build(app)?;
    Ok(())
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_SHOW => show_main(app),
        MENU_HIDE => hide_main(app),
        MENU_QUIT => request_termination(app),
        other => log::debug!("unhandled tray menu id: {other}"),
    }
}

fn on_tray_icon_event(tray: &tauri::tray::TrayIcon, event: TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        toggle_main(tray.app_handle());
    }
}

/// 发出退出请求。销毁窗口是渲染层确认之后的事。
fn request_termination(app: &AppHandle) {
    // 先把窗口叫出来：确认对话框画在一个隐藏的窗口里等于没有对话框。
    show_main(app);

    if let Err(error) = app.emit(TERMINATION_REQUESTED_EVENT, ()) {
        log::warn!("tray: could not deliver the termination request: {error}");
    }

    let fallback = app.clone();

    std::thread::spawn(move || {
        std::thread::sleep(TERMINATION_FALLBACK);

        // 渲染层活着就会在这之前销毁窗口。窗口还在，说明它处理不了退出请求，
        // 由原生侧收尾——但只在这一种情况下。
        if fallback.get_webview_window(MAIN_WINDOW).is_some() {
            log::warn!("tray: frontend did not terminate within the fallback window");

            persist_window_state(&fallback);
            fallback.exit(0);
        }
    });
}

fn toggle_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    match (window.is_visible(), window.is_minimized()) {
        (Ok(true), Ok(false)) => match window.is_focused() {
            // Visible and focused: a second click tucks it away again.
            Ok(true) => hide_main(app),
            _ => show_main(app),
        },
        _ => show_main(app),
    }
}

pub(crate) fn show_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        log::warn!("tray: main window is gone, nothing to show");
        return;
    };

    if let Err(error) = window.unminimize() {
        log::debug!("tray: unminimize failed: {error}");
    }
    if let Err(error) = window.show() {
        log::warn!("tray: show failed: {error}");
        return;
    }
    if let Err(error) = window.set_focus() {
        log::warn!("tray: focus failed: {error}");
    }
}

fn hide_main(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };

    // Geometry is saved before hiding, so a later restore keeps the position
    // even if the process is killed while sitting in the tray.
    persist_window_state(app);

    if let Err(error) = window.hide() {
        log::warn!("tray: hide failed: {error}");
    }
}

fn persist_window_state(app: &AppHandle) {
    if let Err(error) = app.save_window_state(WINDOW_STATE_FLAGS) {
        log::debug!("tray: could not save window state: {error}");
    }
}
