//! Local index of conversations.
//!
//! 这个 crate 只回答三个问题：这台机器上有哪些对话、它们叫什么、各自握着
//! 谁的哪个会话。对话说过什么不在这里 —— 那份记录属于 agent，由 session/load
//! 交还，那是唯一一份不会和别人漂移的历史。
//!
//! 也正因为如此，这里没有秘密可保：七列元数据的那份副本，挡不住任何一个能
//! 读到 agent 那份明文全文的人。

mod connection;
mod error;
mod migrations;
mod store;
mod threads;

pub use connection::DEFAULT_BUSY_TIMEOUT;
pub use error::{Result, StoreError};
pub use store::AgentStore;
pub use threads::{ThreadSummary, TitleSource};
