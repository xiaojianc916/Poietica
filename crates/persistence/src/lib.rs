//! Local index of conversations.
//!
//! 这个 crate 只回答四个问题：这台机器上有哪些对话、它们叫什么、各自握着
//! 谁的哪个会话，以及各自挂着哪些附件。对话说过什么不在这里 —— 那份记录属于
//! agent，由 session/load 交还，那是唯一一份不会和别人漂移的历史。
//!
//! 附件是第四个问题而不是第一个问题的一部分，理由在 attachments.rs：agent
//! 收到的是用户文件的一份 base64 副本，它没有义务交还，多数 CLI 也确实不
//! 交还。那份字节的主人是这台机器，所以账也记在这台机器上。
//!
//! 也正因为如此，这里没有秘密可保：七列元数据的那份副本，挡不住任何一个能
//! 读到 agent 那份明文全文的人。
//!
//! workspace_state 不在这四个问题之内，也不走这张库：工作台的标签布局按仓库
//! 分域、每次整份覆盖、崩溃时只需要「要么旧的要么新的」，同目录 rename 就给得
//! 出这份原子性，不需要事务、索引或迁移。它此刻寄居在本 crate 里，这件事本身
//! 仍待重新安置 —— 它记的不是 agent 的状态。

mod attachments;
mod connection;
mod error;
mod migrations;
mod store;
mod threads;
pub mod workspace_state;

pub use attachments::ThreadAttachment;
pub use connection::DEFAULT_BUSY_TIMEOUT;
pub use error::{Result, StoreError};
pub use store::AgentStore;
pub use threads::{ThreadSummary, TitleSource};
