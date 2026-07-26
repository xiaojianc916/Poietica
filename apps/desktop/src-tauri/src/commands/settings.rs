use crate::error::{Error, IpcError, Result};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::{AppHandle, command};
use tauri_plugin_store::StoreExt;

type SettingsCommandResult<T> = std::result::Result<T, IpcError>;

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
pub struct AppSettings {
    pub theme: String,
    pub language: String,
    pub auto_save: bool,
    /// Milliseconds. u32 is intentional: generated TypeScript IPC uses number,
    /// while u64 would require bigint and is rejected by tauri-specta.
    pub auto_save_interval: u32,
    pub shortcuts: HashMap<String, String>,
    pub canvas: CanvasSettings,
    pub editor: EditorSettings,
    pub export: ExportSettings,
    pub privacy: PrivacySettings,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
pub struct CanvasSettings {
    pub default_zoom: f64,
    pub show_grid: bool,
    pub snap_to_grid: bool,
    pub grid_size: f64,
    pub show_rulers: bool,
    pub infinite_canvas: bool,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
pub struct EditorSettings {
    pub font_family: String,
    pub font_size: f64,
    pub line_height: f64,
    pub tab_size: u32,
    pub insert_spaces: bool,
    pub word_wrap: bool,
    pub minimap: bool,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
pub struct ExportSettings {
    pub default_format: String,
    pub png_dpi: u32,
    pub pdf_quality: u8,
    pub include_metadata: bool,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
pub struct PrivacySettings {
    pub telemetry: bool,
    pub crash_reporting: bool,
    pub update_check: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "system".into(),
            language: "zh-CN".into(),
            auto_save: true,
            auto_save_interval: 30000,
            shortcuts: HashMap::new(),
            canvas: CanvasSettings::default(),
            editor: EditorSettings::default(),
            export: ExportSettings::default(),
            privacy: PrivacySettings::default(),
        }
    }
}

impl Default for CanvasSettings {
    fn default() -> Self {
        Self {
            default_zoom: 1.0,
            show_grid: false,
            snap_to_grid: false,
            grid_size: 20.0,
            show_rulers: false,
            infinite_canvas: true,
        }
    }
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            font_family: "JetBrains Mono, Consolas, monospace".into(),
            font_size: 14.0,
            line_height: 1.5,
            tab_size: 2,
            insert_spaces: true,
            word_wrap: true,
            minimap: false,
        }
    }
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self {
            default_format: "svg".into(),
            png_dpi: 300,
            pdf_quality: 90,
            include_metadata: true,
        }
    }
}

impl Default for PrivacySettings {
    fn default() -> Self {
        Self {
            telemetry: false,
            crash_reporting: true,
            update_check: true,
        }
    }
}

/// # Errors
///
/// Returns an error when the underlying operation fails; the message handed
/// to the caller is the redacted IPC message, never native detail.
#[command]
#[specta::specta]
pub async fn settings_get(app: AppHandle) -> SettingsCommandResult<AppSettings> {
    (|| -> Result<AppSettings> {
        let store = app.store("settings.json")?;

        match store.get("settings") {
            None => Ok(AppSettings::default()),
            Some(value) => serde_json::from_value(value)
                .map_err(|error| Error::Validation(format!("invalid settings: {error}"))),
        }
    })()
    .map_err(IpcError::from)
}

/// # Errors
///
/// Returns an error when the underlying operation fails; the message handed
/// to the caller is the redacted IPC message, never native detail.
#[command]
#[specta::specta]
pub async fn settings_set(app: AppHandle, settings: AppSettings) -> SettingsCommandResult<()> {
    (|| -> Result<()> {
        let store = app.store("settings.json")?;
        store.set("settings", serde_json::to_value(&settings)?);
        store.save()?;
        Ok(())
    })()
    .map_err(IpcError::from)
}

/// # Errors
///
/// Returns an error when the underlying operation fails; the message handed
/// to the caller is the redacted IPC message, never native detail.
#[command]
#[specta::specta]
pub async fn settings_reset(app: AppHandle) -> SettingsCommandResult<AppSettings> {
    (|| -> Result<AppSettings> {
        let defaults = AppSettings::default();
        let store = app.store("settings.json")?;
        store.set("settings", serde_json::to_value(&defaults)?);
        store.save()?;
        Ok(defaults)
    })()
    .map_err(IpcError::from)
}
