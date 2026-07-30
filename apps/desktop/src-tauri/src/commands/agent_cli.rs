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

use crate::commands::agent_config::{agent_program, launch_env};
use crate::error::{Error, IpcError, Result};
use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::{AppHandle, async_runtime, command};

type AgentCliCommandResult<T> = std::result::Result<T, IpcError>;

const MAX_ARGS: usize = 16;
const MAX_ARG_LEN: usize = 512;

/// 反引号写成转义形式，避免源码里出现难以辨认的字面量。
const SHELL_METACHARACTERS: [char; 11] = [
    ';', '&', '|', '<', '>', '$', '\u{60}', '\n', '\r', '"', '\'',
];

/// 命令行上被禁止出现的参数。密钥只能走环境变量。
const FORBIDDEN_FLAGS: [&str; 2] = ["--api-key", "--apikey"];

/// 不要给子进程开控制台窗口。
///
/// GUI 进程 spawn 一个控制台程序时，Windows 会给它开一个窗口：刷新一次模型清单就闪一
/// 次黑框，添加一次 provider 再闪一次。Zed 的 crates/util/src/command.rs 对每一条命令
/// 都设这个标志，理由相同。
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Deserialize, Serialize, Type, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentCliRequest {
    /// 用于算出受控 home，也用于从档案里查出该执行哪个程序。
    pub agent_id: String,
    /// 完整的子命令序列，例如 ["provider", "list", "--json"]。
    ///
    /// 第一项是子命令名，`is_allowed` 看的就是它。
    ///
    /// 可执行文件不在这里。它曾经在：渲染层报一个程序路径过来，而白名单只
    /// 校验参数，于是 `{ command: 任意程序, args: ["provider", "list"] }` 会
    /// 被放行执行。程序现在由 `agent_program` 从档案里取。
    pub args: Vec<String>,
    /// 要注入的凭据环境变量名。它不是秘密，只是个名字。
    pub secret_var: String,
    /// 凭据本身。只在内存里过一趟：注入子进程后随请求一起丢弃，不落盘、不进
    /// 日志，也永远不上命令行（见 `FORBIDDEN_FLAGS`）。留空表示不注入。
    pub secret_value: String,
    // 这里本该有 home_var 与 home_dir。它们被删掉了：受控 home 由原生侧的
    // launch_env 用 paths::agent_home 现算，与 ACP 会话同源。让渲染层报一个
    // 路径过来，就等于给了两条管线各算出不同目录的自由。
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

/// 「找不到那个程序」这一种失败的唯一文案。
///
/// 程序名来自我们自己的 agents.json，不是系统路径，所以说得出名字；which
/// 的错误里可能带上被搜过的目录，那部分丢掉。
fn missing_program(program: &str) -> Error {
    Error::AgentCli(format!(
        "找不到可执行文件 {program}，请确认它已安装并在 PATH 中"
    ))
}

/// 校验从档案里取出来的程序名。
///
/// 档案在 TS 侧过了 `parseAcpAgentProfile`，但那道校验不在这个进程里 ——
/// agents.json 是一个可以手改的文件，信它等于把校验交给了文本编辑器。
fn validate_program(program: &str) -> Result<()> {
    if program.is_empty() || program.len() > MAX_ARG_LEN {
        return Err(Error::AgentCli("agent 接入档案里的程序名为空".to_owned()));
    }

    if contains_metacharacter(program) {
        return Err(Error::AgentCli(
            "agent 接入档案里的程序名含有 shell 元字符".to_owned(),
        ));
    }

    Ok(())
}

fn validate(request: &AgentCliRequest) -> Result<()> {
    if request.args.len() > MAX_ARGS {
        return Err(Error::AgentCli(format!("参数不能超过 {MAX_ARGS} 项")));
    }

    for arg in &request.args {
        if arg.len() > MAX_ARG_LEN {
            return Err(Error::AgentCli("参数过长".to_owned()));
        }

        if contains_metacharacter(arg) {
            return Err(Error::AgentCli(format!("参数含有不被接受的字符：{arg}")));
        }

        let lowered = arg.to_ascii_lowercase();

        if FORBIDDEN_FLAGS
            .iter()
            .any(|flag| lowered == *flag || lowered.starts_with(&format!("{flag}=")))
        {
            return Err(Error::AgentCli(
                "密钥不能出现在命令行上，请使用环境变量注入".to_owned(),
            ));
        }
    }

    if !is_allowed(&request.args) {
        return Err(Error::AgentCli(
            "只允许 provider list / add / remove / catalog list / catalog add".to_owned(),
        ));
    }

    Ok(())
}

/// 在白名单内调用 agent 的 CLI。
///
/// 凭据由调用方随这一次请求带上，经环境变量注入子进程。
///
/// 我们不保存它。agent 的 CLI 会把它写进 agent 自己的配置文件，那之后它与
/// Poietica 无关 —— 包括「配没配过」这个问题，答案也在那边。
///
/// # Errors
///
/// 参数未通过白名单校验、或子进程无法启动时返回错误。子进程本身以非零码退出
/// 不算错误 —— 那是调用方需要看到的结果，通过 status 与 stderr 返回。
#[command]
#[specta::specta]
pub async fn agent_cli_exec(
    app: AppHandle,
    request: AgentCliRequest,
) -> AgentCliCommandResult<AgentCliResult> {
    validate(&request).map_err(IpcError::from)?;

    // 程序与环境来自同一份档案。CLI 用哪个程序、往哪个 home 写 provider，
    // 都得与 ACP 会话起来的那个进程一致 —— 两处各算一次，迟早算出两个。
    let program = agent_program(&app, &request.agent_id).map_err(IpcError::from)?;
    validate_program(&program).map_err(IpcError::from)?;

    let env = launch_env(&app, &request.agent_id).map_err(IpcError::from)?;

    // 裸名字不是一条可启动的路径：Windows 上包管理器装出来的是 kimi.CMD，
    // CreateProcess 只补 .exe、不读 PATHEXT，于是 Command::new("kimi") 直接
    // NotFound —— 明明装了，界面却报找不到。ACP 会话那条路径一直是解析过的，
    // 这条没有，同一个程序两条管线一条找得到一条找不到。
    //
    // 这也是「路径不能写死」的答案：解析用的是运行这台机器的 PATH 与
    // PATHEXT，agents.json 里换成绝对路径也照样原样通过。
    let resolved = poietica_agent_runtime_native::resolve_program(&program)
        .map_err(|_searched| missing_program(&program))
        .map_err(IpcError::from)?;

    let spawned = async_runtime::spawn_blocking(move || {
        let mut command = std::process::Command::new(&resolved);
        command.args(&request.args);
        command.envs(env);

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;

            command.creation_flags(CREATE_NO_WINDOW);
        }

        if !request.secret_var.is_empty() && !request.secret_value.is_empty() {
            command.env(&request.secret_var, &request.secret_value);
        }

        command.output()
    })
    .await
    .map_err(|error| Error::Internal(error.to_string()))
    .map_err(IpcError::from)?;

    // 「没装」是这里最常见的一种失败，也是用户自己能解决的那一种。其余的
    // io 错误可能带上系统路径，仍然走脱敏。
    let output = spawned
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                // 解析成功之后仍然 NotFound：文件在这两步之间被移走了。
                missing_program(&program)
            } else {
                Error::Internal(format!("无法启动 agent CLI：{error}"))
            }
        })
        .map_err(IpcError::from)?;

    Ok(AgentCliResult {
        status: output.status.code().unwrap_or(-1),
        stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}
