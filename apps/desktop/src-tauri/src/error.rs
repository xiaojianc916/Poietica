use serde::Serialize;
use specta::Type;
use std::borrow::Cow;
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

    /// 受控 agent CLI 调用被拒或失败。
    ///
    /// 这是唯一一个消息原样透给界面的变体。判据不是「这条链上大概没有敏感
    /// 信息」这种自我保证，而是一件可核查的事：它的构造点全在
    /// `commands::agent_cli` 一个模块里，每一处都是本仓库的字面量常量，没有
    /// 一处把外部输入或系统错误拼进去。
    ///
    /// 而「为什么被拒」恰恰是用户唯一能据以修正的信息。换成一句「应用操作
    /// 失败」，等于让人去猜。
    #[error("Agent CLI error: {0}")]
    AgentCli(String),
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
            message: self.public_message().into_owned(),
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
            Self::AgentCli(_) => IpcErrorCode::Validation,
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
                | Self::AgentCli(_)
        )
    }
}

// the public message table is kept in its own block, apart from the IPC mapping
impl Error {
    /// 返回给 `WebView` 的稳定、脱敏错误消息。
    ///
    /// 不得在这里使用 `self.to_string()`、底层 `source` 或文件路径：
    /// Rust/Tauri/插件错误可能包含绝对路径、用户名、权限信息或系统细节。
    ///
    /// `AgentCli` 是唯一的例外，它原样透出自己的消息 —— 理由见那个变体的
    /// 文档。用 `Cow` 而不是把整张表改成 `String`：其余分支仍然是借用，一个
    /// 字节都不多分配。
    ///
    /// 这个返回类型本身曾经是个问题。它是 `&'static str`，于是「带具体原因
    /// 的错误」在类型上就无法到达界面：白名单拒绝时明明写了拒绝的理由，界面
    /// 上只会看到「应用操作失败」。
    fn public_message(&self) -> Cow<'static, str> {
        match self {
            Self::Validation(_) => Cow::Borrowed("请求参数无效"),
            Self::NotFound(_) => Cow::Borrowed("请求的资源不存在"),
            Self::FileConflict(_) => Cow::Borrowed("文件已在其他位置被修改"),
            Self::PermissionDenied(_) => Cow::Borrowed("该操作未获授权"),

            Self::Io(_) | Self::Persistence(_) | Self::File(_) | Self::Store(_) => {
                Cow::Borrowed("文件操作失败")
            }

            Self::SerdeJson(_) => Cow::Borrowed("数据格式无效"),

            Self::Import(_) => Cow::Borrowed("导入失败"),
            Self::Export(_) => Cow::Borrowed("导出失败"),
            Self::Asset(_) => Cow::Borrowed("资源处理失败"),

            Self::Plugin(_) => Cow::Borrowed("插件操作失败"),

            Self::AgentCli(reason) => Cow::Owned(reason.clone()),

            Self::Tauri(_)
            | Self::Dialog(_)
            | Self::Notification(_)
            | Self::WindowState(_)
            | Self::GlobalShortcut(_)
            | Self::Log(_)
            | Self::Internal(_)
            | Self::Collaboration(_) => Cow::Borrowed("应用操作失败"),
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

pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests {
    #![allow(
        clippy::expect_used,
        clippy::unwrap_used,
        clippy::panic,
        clippy::indexing_slicing,
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
            "permission denied for /Users/example/private/secret.txt",
        ));

        let value = serde_json::to_value(error).expect("error should serialize");
        let message = value["message"]
            .as_str()
            .expect("serialized error message should be a string");

        assert_eq!(message, "文件操作失败");
        assert!(!message.contains("/Users/"));
        assert!(!message.contains("secret.txt"));
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

    /*
     * 与上面两条相反的一条：这个变体存在的意义就是原因要能出去。少了它，
     * 下一个人看到「脱敏」两个字，很可能顺手把它也改回固定文案。
     */
    #[test]
    fn agent_cli_error_carries_its_own_reason() {
        let error = Error::AgentCli(
            "只允许 provider list / add / remove / catalog list / catalog add".to_owned(),
        );

        let value = serde_json::to_value(error).expect("error should serialize");

        assert_eq!(value["code"], "validation");
        assert_eq!(
            value["message"],
            "只允许 provider list / add / remove / catalog list / catalog add"
        );
        assert_eq!(value["recoverable"], true);
    }
}
