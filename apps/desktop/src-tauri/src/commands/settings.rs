use crate::error::{IpcError, Result};
use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use tauri::{AppHandle, command};
use tauri_plugin_store::StoreExt;

type SettingsCommandResult<T> = std::result::Result<T, IpcError>;

/// 颜色模式是一个闭集，不是一段自由文本。
///
/// 写成枚举，生成的 TypeScript 就是 `"light" | "dark" | "system"`，与 design
/// system 的 `ThemePreference` 是同一个集合，界面不必在每个调用点各自断言一次。
#[derive(Debug, Deserialize, Serialize, Type, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum ThemePreference {
    Light,
    Dark,
    #[default]
    System,
}

/*
 * 线上字段名一律 camelCase。
 *
 * 这是全仓 IPC 的既有约定（agent 侧每个 DTO 都写了这一行），设置是唯一漏掉的
 * 一个：生成物是 snake_case，手写界面按约定是 camelCase，两边对不上。补这一行
 * 是修契约，而不是把界面改成 snake_case 去迁就一个漏掉的属性。
 *
 * 容器级 default 让旧盘上缺键的 settings.json 逐项退回默认值，而不是整份读取
 * 失败：用户的设置不该因为一次字段改名炸成一个错误横幅。
 */
#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct AppSettings {
    pub theme: ThemePreference,
    pub language: String,
    pub auto_save: bool,
    /// 毫秒；单位写进字段名，生成物即 `autoSaveIntervalMs`。
    ///
    /// u32 是故意的：生成的 TypeScript 用 number，u64 会要求 bigint，而
    /// tauri-specta 拒绝 bigint。
    pub auto_save_interval_ms: u32,
    pub shortcuts: HashMap<String, String>,
    pub canvas: CanvasSettings,
    pub editor: EditorSettings,
    pub export: ExportSettings,
    pub privacy: PrivacySettings,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct CanvasSettings {
    pub default_zoom: f64,
    pub show_grid: bool,
    pub snap_to_grid: bool,
    pub grid_size: f64,
    pub show_rulers: bool,
    pub infinite_canvas: bool,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase", default)]
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
#[serde(rename_all = "camelCase", default)]
pub struct ExportSettings {
    pub default_format: String,
    pub png_dpi: u32,
    pub pdf_quality: u8,
    pub include_metadata: bool,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct PrivacySettings {
    pub telemetry: bool,
    pub crash_reporting: bool,
    pub update_check: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: ThemePreference::System,
            language: "zh-CN".into(),
            auto_save: true,
            auto_save_interval_ms: 30000,
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

        /*
         * 一份读不动的设置不是一次失败，是一次回退。
         *
         * 字段级容错由容器 default 兜住；这里兜的是整份 JSON 结构都不成立的
         * 情况（手改坏了、上个大版本的形状）。专业设置面板在这一步给默认值并
         * 让用户继续用，而不是把一个红条摆在所有开关前面。
         */
        Ok(store
            .get("settings")
            .and_then(|value| serde_json::from_value(value).ok())
            .unwrap_or_default())
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
