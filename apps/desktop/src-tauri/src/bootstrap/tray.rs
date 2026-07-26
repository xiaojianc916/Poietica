//! Windows-first system tray integration.
//!
//! The tray owns three behaviours:
//!   * left click on the icon restores and focuses the main window,
//!   * right click opens a menu with show / hide / quit,
//!   * pressing the window close button hides to tray instead of exiting.
//!
//! Quitting is explicit: the menu item raises a flag first, so the close
//! interceptor below lets the real shutdown through.

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Window, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Label of the window the tray controls. Matches tauri.conf.json.
const MAIN_WINDOW: &str = "main";

const TRAY_ID: &str = "poietica-tray";
const MENU_SHOW: &str = "poietica-tray-show";
const MENU_HIDE: &str = "poietica-tray-hide";
const MENU_QUIT: &str = "poietica-tray-quit";

/// Distinguishes "user closed the window" from "user asked to quit".
#[derive(Debug, Default)]
pub struct TrayState {
    quitting: AtomicBool,
}

impl TrayState {
    fn is_quitting(&self) -> bool {
        self.quitting.load(Ordering::SeqCst)
    }

    fn begin_quit(&self) {
        self.quitting.store(true, Ordering::SeqCst);
    }
}

/// Installs the tray icon and its menu. Called once from the composition root.
pub fn install(app: &AppHandle) -> tauri::Result<()> {
    let _managed = app.manage(TrayState::default());

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

/// Turns the window close button into "hide to tray" unless a quit is underway.
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if window.label() != MAIN_WINDOW {
        return;
    }

    if let WindowEvent::CloseRequested { api, .. } = event {
        let app = window.app_handle();
        if app.state::<TrayState>().is_quitting() {
            return;
        }

        api.prevent_close();
        hide_main(app);
    }
}

fn on_menu_event(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        MENU_SHOW => show_main(app),
        MENU_HIDE => hide_main(app),
        MENU_QUIT => {
            app.state::<TrayState>().begin_quit();
            // Persist geometry while the window still exists.
            persist_window_state(app);
            app.exit(0);
        }
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

fn show_main(app: &AppHandle) {
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
    if let Err(error) = app.save_window_state(StateFlags::all()) {
        log::debug!("tray: could not save window state: {error}");
    }
}
