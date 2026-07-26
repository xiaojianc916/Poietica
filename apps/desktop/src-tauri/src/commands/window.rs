use crate::error::Result;
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, Manager, WebviewWindow, command};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[derive(Debug, Deserialize, Type)]
pub struct WindowOptions {
    pub label: String,
    pub title: Option<String>,
    pub width: Option<f64>,
    pub height: Option<f64>,
    pub min_width: Option<f64>,
    pub min_height: Option<f64>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub fullscreen: Option<bool>,
    pub resizable: Option<bool>,
    pub decorations: Option<bool>,
    pub always_on_top: Option<bool>,
    pub visible: Option<bool>,
}

#[derive(Debug, Serialize, Type)]
pub struct WindowInfo {
    pub label: String,
    pub title: String,
    pub width: f64,
    pub height: f64,
    pub x: f64,
    pub y: f64,
    pub fullscreen: bool,
    pub resizable: bool,
    pub minimized: bool,
    pub maximized: bool,
    pub visible: bool,
    pub focused: bool,
}

#[command]
pub async fn window_create(app: AppHandle, options: WindowOptions) -> Result<WindowInfo> {
    if let Some(existing) = app.get_webview_window(&options.label) {
        existing.show()?;
        existing.set_focus()?;
        return window_info(existing);
    }

    let mut builder =
        tauri::WebviewWindowBuilder::new(&app, &options.label, tauri::WebviewUrl::default())
            .title(options.title.unwrap_or_else(|| "Poietica".into()))
            .inner_size(
                options.width.unwrap_or(800.0),
                options.height.unwrap_or(600.0),
            )
            .resizable(options.resizable.unwrap_or(true))
            .decorations(options.decorations.unwrap_or(true))
            .always_on_top(options.always_on_top.unwrap_or(false))
            .visible(options.visible.unwrap_or(true));
    if let Some(min_width) = options.min_width {
        builder = builder.min_inner_size(min_width, options.min_height.unwrap_or(min_width));
    }

    if let (Some(x), Some(y)) = (options.x, options.y) {
        builder = builder.position(x, y);
    }
    if let Some(fs) = options.fullscreen {
        builder = builder.fullscreen(fs);
    }

    window_info(builder.build()?)
}

#[command]
pub async fn window_get(app: AppHandle, label: String) -> Result<Option<WindowInfo>> {
    app
        .get_webview_window(&label)
        .map(window_info)
        .transpose()
}

#[command]
pub async fn window_list(app: AppHandle) -> Result<Vec<WindowInfo>> {
    app
        .webview_windows()
        .into_values()
        .map(window_info)
        .collect::<Result<Vec<_>>>()
}

#[command]
pub async fn window_show(app: AppHandle, label: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        window.show()?;
    }
    Ok(())
}

#[command]
pub async fn window_focus(app: AppHandle, label: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        window.set_focus()?;
    }
    Ok(())
}

#[command]
pub async fn window_close(app: AppHandle, label: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        window.close()?;
    }
    Ok(())
}

#[command]
pub async fn window_destroy(app: AppHandle, label: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        // destroy bypasses CloseRequested. The application layer has already
        // completed dirty-document confirmation before invoking this command.
        window.destroy()?;
    }

    Ok(())
}

#[command]
pub async fn window_open_devtools(app: AppHandle, label: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        window.open_devtools();
    }

    Ok(())
}

#[command]
pub async fn window_set_title(app: AppHandle, label: String, title: String) -> Result<()> {
    if let Some(window) = app.get_webview_window(&label) {
        window.set_title(&title)?;
    }
    Ok(())
}

#[command]
pub async fn window_save_state(app: AppHandle, _label: String) -> Result<()> {
    app.save_window_state(StateFlags::all())?;
    Ok(())
}

fn window_info(window: WebviewWindow) -> Result<WindowInfo> {
    let outer = window.outer_size()?;
    let pos = window.outer_position()?;
    Ok(WindowInfo {
        label: window.label().to_owned(),
        title: window.title()?,
        width: f64::from(outer.width),
        height: f64::from(outer.height),
        x: f64::from(pos.x),
        y: f64::from(pos.y),
        fullscreen: window.is_fullscreen()?,
        resizable: window.is_resizable()?,
        minimized: window.is_minimized()?,
        maximized: window.is_maximized()?,
        visible: window.is_visible()?,
        focused: window.is_focused()?,
    })
}
