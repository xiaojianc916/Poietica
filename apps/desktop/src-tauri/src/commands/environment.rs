//! 这台机器上、这个应用之外已经有的能力。
//!
//! 只读。这里每一条都指向别人拥有的文件 —— 从图形界面里悄悄改掉终端 CLI 的配置，
//! 是一个用户无从预期、也无从撤销的副作用。本应用自己装进来的东西一律落在
//! data_root 之下，paths 模块顶上那条「抹干净只需要知道一条路径」因此仍然成立。
//!
//! 交出去的是正文而不是解析结果：mcp.json 的形状归 MCP 规范所有，规范的解码在领域
//! 层只做一次（packages/plugins 的 mcp-config），原生侧再解一遍就是两份真相。

use std::fs;
use std::io::ErrorKind;

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, command};

use crate::error::{Error, IpcError};
use crate::paths::user_mcp_config;

type EnvironmentCommandResult<T> = std::result::Result<T, IpcError>;

/// 一份属于别人的配置文件。
#[derive(Debug, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentFile {
    /// 它在这台机器上的位置。
    ///
    /// 路径原样交给界面，与错误消息那条脱敏规则不冲突：屏幕前的人就是这台机器的
    /// 主人，而「它到底在读哪个文件」是他唯一能据以排查的东西。storage_data_directory
    /// 出于同一个理由把数据根显示给用户。
    pub location: String,
    /// 正文。文件不存在就是 None —— 那是常态，不是错误。
    pub contents: Option<String>,
}

/// 用户级 mcp.json 的位置与正文。
///
/// # Errors
///
/// 家目录解析不出来，或文件存在却读不动时返回错误。文件不存在不算错误。
#[command]
#[specta::specta]
pub async fn environment_mcp_config(app: AppHandle) -> EnvironmentCommandResult<EnvironmentFile> {
    let path = user_mcp_config(&app)?;

    let contents = match fs::read_to_string(&path) {
        Ok(text) => Some(text),
        Err(cause) if cause.kind() == ErrorKind::NotFound => None,
        Err(cause) => return Err(Error::Io(cause).into()),
    };

    Ok(EnvironmentFile {
        location: path.to_string_lossy().into_owned(),
        contents,
    })
}
