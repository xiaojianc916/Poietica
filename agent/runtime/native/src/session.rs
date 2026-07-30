//! 一条连接说得出口的名词。
//!
//! 怎么起进程、怎么开会话、怎么走一轮，都在 driver.rs；命令怎么发在
//! commands.rs。这里只有那几个两边都要认识的类型。

use std::fmt;
use std::path::PathBuf;

use futures::channel::oneshot;
use futures::future::BoxFuture;

use crate::commands::AgentClient;
use crate::config::ConfigControl;
use crate::error::Result;
use crate::sessions::SessionBook;

/// How the agent process is started.
#[derive(Clone, Debug)]
pub struct AgentSpawn {
    /// 可执行文件名或路径，不含参数，也不经过 shell。
    ///
    /// 进程本身就是传输层：协议在它的标准输入输出上说 JSON-RPC，所以这里没有
    /// 任何东西打开套接字。
    ///
    /// 名字与参数分开存，因为拼成一行再切回来是有损的：POSIX 词法会把 Windows
    /// 路径里的反斜杠当成转义符吃掉，带空格的路径会被切断。Zed 的
    /// \`AgentServerCommand\` 同样是 path/args/env 三元组，连跨进程的 protobuf
    /// （crates/proto/proto/ai.proto）都不降级成字符串。
    pub program: String,
    /// 传给它的参数，逐个原样递给进程，不做任何引号或转义处理。
    pub args: Vec<String>,
    /// The working directory the session is created against.
    pub cwd: PathBuf,
    /// Environment variables the child process is started with.
    ///
    /// 只放非密文的启动变量，受控 home 的路径就是其一。密钥不走这里：模式 B
    /// 下它们由 agent 自己的 CLI 写进那个 home 里的配置文件。也不走参数 ——
    /// Windows 上任何用户都读得到别的进程的完整命令行。
    pub env: Vec<(String, String)>,
}

/// A connected session, before anything has been spawned onto a runtime.
///
/// The crate stays runtime-agnostic on purpose: it hands back a future and the
/// composition root decides which executor runs it.
pub struct AgentConnection {
    /// Sends prompts, cancellation and shutdown to the connection.
    pub client: AgentClient,
    /// The sessions of this connection, keyed by the name the agent gave
    /// them.
    ///
    /// Held by the caller so a session opened later is entered in the same
    /// book the protocol handlers already read from.
    pub book: SessionBook,
    /// Resolves with the first session identifier once the agent created it.
    pub session_id: oneshot::Receiver<String>,
    /// Must be spawned; the connection only lives while this future is polled.
    pub driver: BoxFuture<'static, Result<()>>,
}

impl fmt::Debug for AgentConnection {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("AgentConnection")
            .field("client", &self.client)
            .finish_non_exhaustive()
    }
}

/// A session the agent just opened, and the selectors it offers for it.
#[derive(Debug, Clone)]
pub struct OpenedSession {
    /// The name every frame of this session will carry.
    pub session_id: String,
    /// What may be chosen for this session, as the agent reported it.
    pub selectors: Vec<ConfigControl>,
}

/// One line of the agent's own session list.
#[derive(Debug, Clone)]
pub struct SessionEntry {
    /// The session this line describes.
    pub session_id: String,
    /// The title the agent gave it, if it has given one.
    pub title: Option<String>,
    /// When the agent last saw activity on it, as it reported it.
    pub updated_at: Option<String>,
}
