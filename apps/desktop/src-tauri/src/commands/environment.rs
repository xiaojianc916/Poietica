//! 这个 agent 自己那份 mcp.json —— 只读。
//!
//! 判据只有一条：我们启动的那个进程会不会读它。这条判据不是这里发明的，
//! `profile.rs` 的 `agent_config_file` 上面早就写着「读一份它根本不看的文件，等于把
//! 屏幕上因此显示出来的每一行都说成假话」。那里管 config.toml，这里管 mcp.json，
//! 两者是同一个进程按同一个变量找到的同一个家。
//!
//! 所以这里不去翻别家客户端的配置。Cursor 的 ~/.cursor/mcp.json、Claude Desktop 的
//! claude_desktop_config.json、Windsurf 的 ~/.codeium/windsurf/mcp_config.json、
//! Visual Studio 当作全局位置的 %USERPROFILE%\.mcp.json —— 这些位置都真实存在，但
//! Kimi 一个都不读。把它们列到界面上，人拨那个开关不会有任何事情发生。
//!
//! 也不去解析 JSON：形状的解释归领域层，全仓只有 mcp-config 一处。这里只交正文。

use std::fs;
use std::io::ErrorKind;

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, command};

use crate::commands::agent_setup::profile::agent_mcp_config;
use crate::error::{Error, IpcError, Result};

type EnvironmentCommandResult<T> = std::result::Result<T, IpcError>;

/// 一份配置文件的现状：它在哪，以及它的正文。
///
/// 文件不在时 contents 是 None 而不是空串：一个空文件与一个不存在的文件，界面要
/// 说的话不一样。
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentFile {
    pub location: String,
    pub contents: Option<String>,
}

/// 默认 agent 会去读的那份 mcp.json。
///
/// # Errors
///
/// 没有默认 agent、档案不存在、家目录算不出来，或文件存在却读不动时返回错误。
#[command]
#[specta::specta]
pub async fn environment_mcp_config(app: AppHandle) -> EnvironmentCommandResult<EnvironmentFile> {
    (|| -> Result<EnvironmentFile> {
        let path = agent_mcp_config(&app)?;

        let contents = match fs::read_to_string(&path) {
            Ok(text) => Some(text),
            Err(cause) if cause.kind() == ErrorKind::NotFound => None,
            Err(cause) => return Err(Error::from(cause)),
        };

        Ok(EnvironmentFile {
            location: path.to_string_lossy().into_owned(),
            contents,
        })
    })()
    .map_err(IpcError::from)
}
