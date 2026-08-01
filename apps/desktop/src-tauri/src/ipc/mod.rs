//! 这个应用暴露给渲染层的那一张 IPC 面。
//!
//! 清单只有一份，就在下面的 `surface`。它同时是两件事的产地：运行期交给 Tauri 的
//! `invoke_handler`，以及构建期导出的 TypeScript 绑定。
//!
//! 此前是两份手抄的清单 —— `bootstrap/app.rs` 的 `generate_handler!` 和这里的
//! `collect_commands!`。没有任何东西校验它们一致，于是它们不一致：
//! `window_open_devtools`、`window_open_external_url`、`agent_default_model`、
//! `agent_set_default_model`、`agent_key_tails` 五条命令只在前者里，从未进过生成
//! 绑定，渲染层要用只能手写命令名字符串。漏抄不会报错，只会安静地少一条绑定。
//!
//! 一份清单两用，是 tauri-specta 自己的范式，也是这类漂移唯一的结构性解法。

pub mod export_bindings;

use tauri::Wry;
use tauri_specta::{Builder, ErrorHandlingMode};

use crate::commands::{
    agent::{
        AgentCapabilitiesRequest, AgentConfigChoice, AgentConfigControl, AgentConfigPurpose,
        AgentPinThreadRequest, AgentPromptRequest, AgentPromptResult, AgentRenameThreadRequest,
        AgentResolvePermissionRequest, AgentSelectConfigRequest, AgentThreadRequest,
    },
    agent_cli::{AgentCliRequest, AgentCliResult},
    agent_config::AgentConfigSnapshot,
    agent_install::{AgentInstallState, AgentInstallStatus},
    asset::{
        AssetRemoveRequest, AssetSessionCloseRequest, AssetSessionResult, AssetUploadRequest,
        AssetUploadResult,
    },
    provider_probe::ProviderProbeOutcome,
    settings::{AppSettings, PrivacySettings},
};
use crate::diagnostics::NativeCrashReport;

/// 这个应用的全部 IPC 命令与 DTO。
///
/// Rust 侧的类型是权威，渲染层不得重新声明原生 DTO。
#[must_use]
pub fn surface() -> Builder<Wry> {
    Builder::<Wry>::new()
        .error_handling(ErrorHandlingMode::Throw)
        .commands(tauri_specta::collect_commands![
            crate::commands::agent::agent_prompt,
            crate::commands::agent::agent_cancel,
            crate::commands::agent::agent_resolve_permission,
            crate::commands::agent::agent_shutdown,
            crate::commands::agent::agent_set_config_option,
            crate::commands::agent::agent_capabilities,
            crate::commands::agent::agent_new_session,
            crate::commands::agent::agent_sessions,
            crate::commands::agent::agent_threads,
            crate::commands::agent::agent_open_thread,
            crate::commands::agent::agent_rename_thread,
            crate::commands::agent::agent_delete_thread,
            crate::commands::agent::agent_pin_thread,
            crate::commands::asset::asset_session_open,
            crate::commands::asset::asset_upload,
            crate::commands::asset::asset_remove,
            crate::commands::asset::asset_session_close,
            crate::commands::diagnostics::diagnostics_take_previous_crash,
            crate::commands::window::window_open_devtools,
            crate::commands::window::window_open_external_url,
            crate::commands::settings::settings_get,
            crate::commands::settings::settings_set,
            crate::commands::settings::settings_reset,
            crate::commands::agent_config::agent_config_get,
            crate::commands::agent_config::agent_default_model,
            crate::commands::agent_config::agent_set_default_model,
            crate::commands::agent_config::agent_key_tails,
            crate::commands::agent_config::agent_config_save_agents,
            crate::commands::agent_config::agent_config_clear_legacy_providers,
            crate::commands::agent_cli::agent_cli_exec,
            crate::commands::agent_install::agent_install_status,
            crate::commands::agent_install::agent_install_run,
            crate::commands::provider_probe::provider_probe_key,
        ])
        .typ::<AgentPromptRequest>()
        .typ::<AgentPromptResult>()
        .typ::<AgentResolvePermissionRequest>()
        .typ::<AgentConfigPurpose>()
        .typ::<AgentConfigChoice>()
        .typ::<AgentConfigControl>()
        .typ::<AgentCapabilitiesRequest>()
        .typ::<AgentSelectConfigRequest>()
        .typ::<AgentRenameThreadRequest>()
        .typ::<AgentThreadRequest>()
        .typ::<AgentPinThreadRequest>()
        .typ::<AssetSessionResult>()
        .typ::<AssetUploadRequest>()
        .typ::<AssetUploadResult>()
        .typ::<AssetRemoveRequest>()
        .typ::<AssetSessionCloseRequest>()
        .typ::<NativeCrashReport>()
        .typ::<AppSettings>()
        .typ::<PrivacySettings>()
        .typ::<AgentConfigSnapshot>()
        .typ::<AgentCliRequest>()
        .typ::<AgentInstallState>()
        .typ::<AgentInstallStatus>()
        .typ::<AgentCliResult>()
        .typ::<ProviderProbeOutcome>()
}
