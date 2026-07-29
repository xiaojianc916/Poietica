//! 受控的 agent CLI 调用。
//!
//! 模式 B 下，provider 与模型的写入路径只有一条：agent 自己的 CLI。我们不
//! 自己拼 TOML —— 那等于把对方的配置 schema 抄一份到这里，对方一改就坏，而且
//! 两个进程同时写同一个文件没有跨进程锁。
//!
//! 这不是通用的命令执行入口，也永远不该变成那个东西：
//!   - 子命令白名单，只放行 provider 的五条操作；
//!   - 拒绝任何含 shell 元字符的参数（虽然不经 shell，仍然拒绝，避免它被当成
//!     可以放心传任意文本的通道）；
//!   - 显式禁止 --api-key：Windows 上任何用户都能读到别的进程的完整命令行，
//!     密钥一律走环境变量注入。

use crate::commands::agent_config::{KEYRING_SERVICE, keyring_account};
use crate::error::{Error, IpcError, Result};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{async_runtime, command};

type AgentCliCommandResult<T> = std::result::Result<T, IpcError>;

const MAX_ARGS: usize = 16;
const MAX_ARG_LEN: usize = 512;

/// 反引号写成转义形式，避免源码里出现难以辨认的字面量。
const SHELL_METACHARACTERS: [char; 11] = [
    ';', '&', '|', '<', '>', '$', '\u{60}', '\n', '\r', '"', '\'',
];

/// 命令行上被禁止出现的参数。密钥只能走环境变量。
const FORBIDDEN_FLAGS: [&str; 2] = ["--api-key", "--apikey"];

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliRequest {
    /// 用于定位钥匙串条目。
    pub agent_id: String,
    /// 可执行文件名或绝对路径。
    pub command: String,
    pub args: Vec<String>,
    /// 要注入的凭据环境变量名。留空表示这次调用不需要凭据。
    pub secret_var: String,
    /// agent 数据根目录的环境变量名，例如 KIMI_CODE_HOME。留空表示不设置。
    pub home_var: String,
    pub home_dir: String,
}

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliResult {
    /// 进程退出码。被信号终止时为 -1。
    pub status: i32,
    pub stdout: String,
    pub stderr: String,
}

fn contains_metacharacter(text: &str) -> bool {
    SHELL_METACHARACTERS
        .iter()
        .any(|candidate| text.contains(*candidate))
}

/// 判断这串参数是否落在白名单内。
fn is_allowed(args: &[String]) -> bool {
    let first = args.first().map(String::as_str);
    let second = args.get(1).map(String::as_str);
    let third = args.get(2).map(String::as_str);

    if first != Some("provider") {
        return false;
    }

    match second {
        Some("list" | "add" | "remove") => true,
        Some("catalog") => matches!(third, Some("list" | "add")),
        _ => false,
    }
}

fn validate(request: &AgentCliRequest) -> Result<()> {
    if request.command.is_empty() || request.command.len() > MAX_ARG_LEN {
        return Err(Error::Internal("agent 命令不能为空".to_owned()));
    }

    if contains_metacharacter(&request.command) {
        return Err(Error::Internal(
            "agent 命令不能包含 shell 元字符".to_owned(),
        ));
    }

    if request.args.len() > MAX_ARGS {
        return Err(Error::Internal(format!("参数不能超过 {MAX_ARGS} 项")));
    }

    for arg in &request.args {
        if arg.len() > MAX_ARG_LEN {
            return Err(Error::Internal("参数过长".to_owned()));
        }

        if contains_metacharacter(arg) {
            return Err(Error::Internal(format!("参数含有不被接受的字符：{arg}")));
        }

        let lowered = arg.to_ascii_lowercase();

        if FORBIDDEN_FLAGS
            .iter()
            .any(|flag| lowered == *flag || lowered.starts_with(&format!("{flag}=")))
        {
            return Err(Error::Internal(
                "密钥不能出现在命令行上，请使用环境变量注入".to_owned(),
            ));
        }
    }

    if !is_allowed(&request.args) {
        return Err(Error::Internal(
            "只允许 provider list / add / remove / catalog list / catalog add".to_owned(),
        ));
    }

    Ok(())
}

/// 在白名单内调用 agent 的 CLI。
///
/// 凭据从钥匙串取出后经环境变量注入子进程，既不落盘也不上命令行。
///
/// # Errors
///
/// 参数未通过白名单校验、或子进程无法启动时返回错误。子进程本身以非零码退出
/// 不算错误 —— 那是调用方需要看到的结果，通过 status 与 stderr 返回。
#[command]
#[specta::specta]
pub async fn agent_cli_exec(request: AgentCliRequest) -> AgentCliCommandResult<AgentCliResult> {
    validate(&request).map_err(IpcError::from)?;

    let secret = if request.secret_var.is_empty() {
        None
    } else {
        let account = keyring_account(&request.agent_id, &request.secret_var);
        keyring::Entry::new(KEYRING_SERVICE, &account)
            .ok()
            .and_then(|entry| entry.get_password().ok())
    };

    let spawned = async_runtime::spawn_blocking(move || {
        let mut command = std::process::Command::new(&request.command);
        command.args(&request.args);

        if let Some(value) = secret {
            command.env(&request.secret_var, value);
        }

        if !request.home_var.is_empty() && !request.home_dir.is_empty() {
            command.env(&request.home_var, &request.home_dir);
        }

        command.output()
    })
    .await
    .map_err(|error| Error::Internal(error.to_string()))
    .map_err(IpcError::from)?;

    let output = spawned
        .map_err(|error| Error::Internal(format!("无法启动 agent CLI：{error}")))
        .map_err(IpcError::from)?;

    Ok(AgentCliResult {
        status: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}
