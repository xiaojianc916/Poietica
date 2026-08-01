use tauri::AppHandle;

use crate::{
    diagnostics::{self, NativeCrashReport},
    error::IpcError,
};

type DiagnosticsCommandResult<T> = Result<T, IpcError>;

/// Returns and consumes the previous native process crash report.
///
/// The renderer receives a bounded DTO, not an arbitrary filesystem path or
/// unrestricted native error object.
#[tauri::command]
#[specta::specta]
pub fn diagnostics_take_previous_crash(
    app: AppHandle,
) -> DiagnosticsCommandResult<Option<NativeCrashReport>> {
    diagnostics::take_previous_crash_report(&app).map_err(Into::into)
}
