//! Local index of conversations.
//!
//! 这个 crate 只回答三个问题：这台机器上有哪些对话、它们叫什么、各自握着
//! 谁的哪个会话。对话说过什么不在这里 —— 那份记录属于 agent，由 session/load
//! 交还，那是唯一一份不会和别人漂移的历史。

mod connection;
mod error;
mod key;
mod migrations;
mod store;
mod threads;

pub use connection::{DEFAULT_BUSY_TIMEOUT, open_or_convert};
pub use error::{Result, StoreError};
pub use key::{DatabaseKey, KEY_ACCOUNT, KEY_SERVICE};
pub use store::AgentStore;
pub use threads::{ThreadSummary, TitleSource};
