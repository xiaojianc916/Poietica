//! Build-time `TypeScript` binding exporter for document IPC.
//!
//! Rust command DTOs are the source of truth. The generated file is consumed by
//! @poietica/desktop-runtime; renderer code must not redefine native DTOs.

use specta_typescript::Typescript;
use tauri::Wry;
use tauri_specta::{Builder, ErrorHandlingMode};

use crate::{
    commands::{
        agent::{
            AgentCapabilitiesRequest, AgentConfigChoice, AgentConfigControl, AgentConfigPurpose,
            AgentLoadRunRequest, AgentLoadThreadRequest, AgentPinThreadRequest, AgentPromptRequest,
            AgentPromptResult, AgentRenameThreadRequest, AgentResolvePermissionRequest,
            AgentRunSnapshot, AgentSelectConfigRequest, AgentThreadRequest, AgentThreadTranscript,
        },
        agent_cli::{AgentCliRequest, AgentCliResult},
        agent_config::AgentConfigSnapshot,
        asset::{
            AssetRemoveRequest, AssetSessionCloseRequest, AssetSessionResult, AssetUploadRequest,
            AssetUploadResult,
        },
        document::{
            DocumentCloseRequest, DocumentDescriptor, DocumentId, DocumentOpenResponse,
            DocumentOpenResult, DocumentSaveAsRequest, DocumentSaveAsResult, DocumentSaveRequest,
        },
        settings::{AppSettings, PrivacySettings},
    },
    diagnostics::NativeCrashReport,
};

const OUTPUT_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../platforms/desktop-ipc/src/generated/ipc-bindings.ts"
);

/// Exports the document IPC DTO surface consumed by the `TypeScript` runtime.
///
/// This function is intentionally called by the dedicated
/// `export-ipc-bindings` binary, never on desktop application startup.
/// # Panics
///
/// Panics when the `TypeScript` bindings cannot be written. That is a build
/// fault rather than a runtime condition, so the build must stop here.
#[allow(
    clippy::expect_used,
    reason = "a binding export that silently failed would ship a stale IPC surface"
)]
pub fn export_document_bindings() {
    Builder::<Wry>::new()
        .error_handling(ErrorHandlingMode::Throw)
        .commands(tauri_specta::collect_commands![
            crate::commands::agent::agent_prompt,
            crate::commands::agent::agent_cancel,
            crate::commands::agent::agent_resolve_permission,
            crate::commands::agent::agent_shutdown,
            crate::commands::agent::agent_load_run,
            crate::commands::agent::agent_load_thread,
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
            crate::commands::document::document_open,
            crate::commands::document::document_save_as,
            crate::commands::document::document_save,
            crate::commands::document::document_close,
            crate::commands::settings::settings_get,
            crate::commands::settings::settings_set,
            crate::commands::settings::settings_reset,
            crate::commands::agent_config::agent_config_get,
            crate::commands::agent_config::agent_config_save_agents,
            crate::commands::agent_config::agent_config_clear_legacy_providers,
            crate::commands::agent_cli::agent_cli_exec,
        ])
        .typ::<AgentPromptRequest>()
        .typ::<AgentPromptResult>()
        .typ::<AgentLoadRunRequest>()
        .typ::<AgentResolvePermissionRequest>()
        .typ::<AgentRunSnapshot>()
        .typ::<AgentLoadThreadRequest>()
        .typ::<AgentThreadTranscript>()
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
        .typ::<DocumentId>()
        .typ::<DocumentDescriptor>()
        .typ::<DocumentOpenResult>()
        .typ::<DocumentOpenResponse>()
        .typ::<DocumentSaveRequest>()
        .typ::<DocumentSaveAsRequest>()
        .typ::<DocumentSaveAsResult>()
        .typ::<DocumentCloseRequest>()
        .typ::<AppSettings>()
        .typ::<PrivacySettings>()
        .typ::<AgentConfigSnapshot>()
        .typ::<AgentCliRequest>()
        .typ::<AgentCliResult>()
        .export(Typescript::default(), OUTPUT_PATH)
        .expect("failed to export document IPC TypeScript bindings");
}
