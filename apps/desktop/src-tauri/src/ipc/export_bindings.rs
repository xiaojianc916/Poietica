//! Build-time TypeScript binding exporter for document IPC.
//!
//! Rust command DTOs are the source of truth. The generated file is consumed by
//! @poietica/desktop-runtime; renderer code must not redefine native DTOs.

use specta_typescript::Typescript;
use tauri::Wry;
use tauri_specta::{Builder, ErrorHandlingMode};

use crate::{
    commands::{
        agent::{
            AgentConfigChoice, AgentConfigControl, AgentConfigPurpose, AgentLoadRunRequest,
            AgentLoadThreadRequest, AgentModelDescriptor, AgentModelList, AgentPromptRequest, AgentPromptResult,
            AgentResolvePermissionRequest, AgentRunSnapshot, AgentSelectConfigRequest,
            AgentSelectModelRequest, AgentThreadTranscript,
        },
        asset::{
            AssetRemoveRequest, AssetSessionCloseRequest, AssetSessionResult, AssetUploadRequest,
            AssetUploadResult,
        },
        document::{
            DocumentCloseRequest, DocumentDescriptor, DocumentId, DocumentOpenResponse,
            DocumentOpenResult, DocumentSaveAsRequest, DocumentSaveAsResult, DocumentSaveRequest,
        },
        settings::{AppSettings, CanvasSettings, EditorSettings, ExportSettings, PrivacySettings},
    },
    diagnostics::NativeCrashReport,
};

const OUTPUT_PATH: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../platforms/desktop-ipc/src/generated/ipc-bindings.ts"
);

/// Exports the document IPC DTO surface consumed by the TypeScript runtime.
///
/// This function is intentionally called by the dedicated
/// `export-ipc-bindings` binary, never on desktop application startup.
/// # Panics
///
/// Panics when the TypeScript bindings cannot be written. That is a build
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
            crate::commands::agent::agent_models,
            crate::commands::agent::agent_select_model,
            crate::commands::agent::agent_config_options,
            crate::commands::agent::agent_set_config_option,
            crate::commands::agent::agent_new_session,
            crate::commands::agent::agent_sessions,
            crate::commands::agent::agent_threads,
            crate::commands::agent::agent_open_thread,
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
        ])
        .typ::<AgentPromptRequest>()
        .typ::<AgentPromptResult>()
        .typ::<AgentLoadRunRequest>()
        .typ::<AgentResolvePermissionRequest>()
        .typ::<AgentRunSnapshot>()
        .typ::<AgentLoadThreadRequest>()
        .typ::<AgentThreadTranscript>()
        .typ::<AgentModelDescriptor>()
        .typ::<AgentModelList>()
        .typ::<AgentSelectModelRequest>()
        .typ::<AgentConfigPurpose>()
        .typ::<AgentConfigChoice>()
        .typ::<AgentConfigControl>()
        .typ::<AgentSelectConfigRequest>()
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
        .typ::<CanvasSettings>()
        .typ::<EditorSettings>()
        .typ::<ExportSettings>()
        .typ::<PrivacySettings>()
        .export(Typescript::default(), OUTPUT_PATH)
        .expect("failed to export document IPC TypeScript bindings");
}
