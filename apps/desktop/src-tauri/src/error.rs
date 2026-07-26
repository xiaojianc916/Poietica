use serde::Serialize;
use specta::Type;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum Error {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Persistence error: {0}")]
    Persistence(String),

    #[error("JSON error: {0}")]
    SerdeJson(#[from] serde_json::Error),

    #[error("Tauri error: {0}")]
    Tauri(#[from] tauri::Error),

    #[error("Store error: {0}")]
    Store(#[from] tauri_plugin_store::Error),

    #[error("Dialog error: {0}")]
    Dialog(#[from] tauri_plugin_dialog::Error),

    #[error("FS error: {0}")]
    Fs(#[from] tauri_plugin_fs::Error),

    #[error("Opener error: {0}")]
    Opener(#[from] tauri_plugin_opener::Error),

    #[error("Updater error: {0}")]
    Updater(#[from] tauri_plugin_updater::Error),

    #[error("Clipboard error: {0}")]
    Clipboard(#[from] tauri_plugin_clipboard_manager::Error),

    #[error("Shell error: {0}")]
    Shell(#[from] tauri_plugin_shell::Error),

    #[error("Notification error: {0}")]
    Notification(#[from] tauri_plugin_notification::Error),

    #[error("Window state error: {0}")]
    WindowState(#[from] tauri_plugin_window_state::Error),

    #[error("Global shortcut error: {0}")]
    GlobalShortcut(#[from] tauri_plugin_global_shortcut::Error),

    #[error("Log error: {0}")]
    Log(#[from] tauri_plugin_log::Error),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("File conflict: {0}")]
    FileConflict(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Plugin error: {0}")]
    Plugin(String),

    #[error("Collaboration error: {0}")]
    Collaboration(String),

    #[error("Export error: {0}")]
    Export(String),

    #[error("Import error: {0}")]
    Import(String),

    #[error("Asset error: {0}")]
    Asset(String),

    #[error("File error: {0}")]
    File(String),
}

#[derive(Clone, Copy, Debug, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum IpcErrorCode {
    Validation,
    NotFound,
    FileConflict,
    PermissionDenied,
    Persistence,
    Plugin,
    Asset,
    ImportExport,
    Platform,
}

#[derive(Clone, Copy, Debug, Serialize, Type)]
#[serde(rename_all = "kebab-case")]
pub enum IpcOperation {
    File,
    Plugin,
    Asset,
    ImportExport,
    Platform,
}

#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IpcError {
    pub code: IpcErrorCode,
    pub message: String,
    pub operation: IpcOperation,
    pub recoverable: bool,
}

impl Error {
    fn to_ipc_error(&self) -> IpcError {
        IpcError {
            code: self.code(),
            message: self.public_message().to_owned(),
            operation: self.operation(),
            recoverable: self.recoverable(),
        }
    }

    fn code(&self) -> IpcErrorCode {
        match self {
            Self::Validation(_) => IpcErrorCode::Validation,
            Self::NotFound(_) => IpcErrorCode::NotFound,
            Self::FileConflict(_) => IpcErrorCode::FileConflict,
            Self::PermissionDenied(_) => IpcErrorCode::PermissionDenied,
            Self::Persistence(_) | Self::File(_) | Self::Io(_) => IpcErrorCode::Persistence,
            Self::Plugin(_) => IpcErrorCode::Plugin,
            Self::Asset(_) => IpcErrorCode::Asset,
            Self::Import(_) | Self::Export(_) => IpcErrorCode::ImportExport,
            _ => IpcErrorCode::Platform,
        }
    }

    fn operation(&self) -> IpcOperation {
        match self {
            Self::Persistence(_) | Self::File(_) | Self::FileConflict(_) | Self::Io(_) => {
                IpcOperation::File
            }
            Self::Plugin(_) => IpcOperation::Plugin,
            Self::Asset(_) => IpcOperation::Asset,
            Self::Import(_) | Self::Export(_) => IpcOperation::ImportExport,
            _ => IpcOperation::Platform,
        }
    }

    fn recoverable(&self) -> bool {
        matches!(
            self,
            Self::Io(_)
                | Self::Persistence(_)
                | Self::PermissionDenied(_)
                | Self::File(_)
                | Self::FileConflict(_)
                | Self::NotFound(_)
        )
    }
}

#[allow(
    clippy::multiple_inherent_impl,
    reason = "the public message table is kept in its own block, apart from the IPC mapping"
)]
impl Error {
    /// 返回给 `WebView` 的稳定、脱敏错误消息。
    ///
    /// 不得在这里使用 `self.to_string()`、底层 `source` 或文件路径：
    /// Rust/Tauri/插件错误可能包含绝对路径、用户名、权限信息或系统细节。
    fn public_message(&self) -> &'static str {
        match self {
            Self::Validation(_) => "请求参数无效",
            Self::NotFound(_) => "请求的资源不存在",
            Self::FileConflict(_) => "文件已在其他位置被修改",
            Self::PermissionDenied(_) => "该操作未获授权",

            Self::Io(_) | Self::Persistence(_) | Self::File(_) | Self::Store(_) | Self::Fs(_) => {
                "文件操作失败"
            }

            Self::SerdeJson(_) => "数据格式无效",

            Self::Import(_) => "导入失败",
            Self::Export(_) => "导出失败",
            Self::Asset(_) => "资源处理失败",

            Self::Plugin(_) => "插件操作失败",
            Self::Tauri(_)
            | Self::Dialog(_)
            | Self::Opener(_)
            | Self::Updater(_)
            | Self::Clipboard(_)
            | Self::Shell(_)
            | Self::Notification(_)
            | Self::WindowState(_)
            | Self::GlobalShortcut(_)
            | Self::Log(_)
            | Self::Internal(_)
            | Self::Collaboration(_) => "应用操作失败",
        }
    }
}

impl From<Error> for IpcError {
    fn from(error: Error) -> Self {
        error.to_ipc_error()
    }
}

impl Serialize for Error {
    fn serialize<S: serde::Serializer>(
        &self,
        serializer: S,
    ) -> std::result::Result<S::Ok, S::Error> {
        self.to_ipc_error().serialize(serializer)
    }
}

impl From<poietica_editor_persistence_native::Error> for Error {
    fn from(error: poietica_editor_persistence_native::Error) -> Self {
        Self::Persistence(error.to_string())
    }
}

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    #![allow(
        clippy::expect_used,
        clippy::unwrap_used,
        clippy::panic,
        clippy::indexing_slicing,
        clippy::as_conversions,
        clippy::missing_panics_doc,
        clippy::missing_errors_doc,
        clippy::too_many_lines,
        clippy::shadow_unrelated,
        reason = "tests operate on known-good fixtures; a broken assumption must fail the test loudly"
    )]

    use super::{Error, IpcErrorCode, IpcOperation};

    #[test]
    fn import_error_uses_import_message() {
        let error = Error::Import("invalid document".to_owned());

        assert_eq!(error.to_string(), "Import error: invalid document");
    }

    #[test]
    fn export_error_uses_export_message() {
        let error = Error::Export("unsupported target".to_owned());

        assert_eq!(error.to_string(), "Export error: unsupported target");
    }

    #[test]
    fn validation_error_has_validation_ipc_mapping() {
        let error = Error::Validation("invalid input".to_owned());

        assert!(matches!(error.code(), IpcErrorCode::Validation));
        assert!(matches!(error.operation(), IpcOperation::Platform));
        assert!(!error.recoverable());
    }

    #[test]
    fn import_error_has_import_export_operation() {
        let error = Error::Import("invalid document".to_owned());

        assert!(matches!(error.code(), IpcErrorCode::ImportExport));
        assert!(matches!(error.operation(), IpcOperation::ImportExport));
        assert!(!error.recoverable());
    }

    #[test]
    fn io_error_is_recoverable_persistence_error() {
        let error = Error::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "denied",
        ));

        assert!(matches!(error.code(), IpcErrorCode::Persistence));
        assert!(matches!(error.operation(), IpcOperation::File));
        assert!(error.recoverable());
    }

    #[test]
    fn serialized_error_preserves_ipc_contract() {
        let value = serde_json::to_value(Error::Validation("invalid settings".to_owned()))
            .expect("error should serialize");

        assert_eq!(value["code"], "validation");
        assert_eq!(value["operation"], "platform");
        assert_eq!(value["message"], "请求参数无效");
        assert_eq!(value["recoverable"], false);
    }

    #[test]
    fn serialized_file_conflict_has_stable_contract() {
        let value = serde_json::to_value(Error::FileConflict(
            "private conflict diagnostics".to_owned(),
        ))
        .expect("error should serialize");

        assert_eq!(value["code"], "file-conflict");
        assert_eq!(value["operation"], "file");
        assert_eq!(value["recoverable"], true);
        assert_eq!(value["message"], "文件已在其他位置被修改");
    }

    #[test]
    fn serialized_io_error_does_not_leak_path_or_native_error() {
        let error = Error::Io(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "permission denied for /Users/example/private/canvas.draw",
        ));

        let value = serde_json::to_value(error).expect("error should serialize");
        let message = value["message"]
            .as_str()
            .expect("serialized error message should be a string");

        assert_eq!(message, "文件操作失败");
        assert!(!message.contains("/Users/"));
        assert!(!message.contains("canvas.draw"));
        assert!(!message.contains("permission denied"));
    }

    #[test]
    fn serialized_permission_error_does_not_leak_approved_path() {
        let error = Error::PermissionDenied(
            "path was not approved by a native file dialog: /tmp/private.draw".to_owned(),
        );

        let value = serde_json::to_value(error).expect("error should serialize");
        let message = value["message"]
            .as_str()
            .expect("serialized error message should be a string");

        assert_eq!(message, "该操作未获授权");
        assert!(!message.contains("/tmp/"));
        assert!(!message.contains("private.draw"));
    }
}
