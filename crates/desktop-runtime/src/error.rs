use thiserror::Error;

/// 这个 crate 的失败。
///
/// Display、source、以及 io::Error 的转换都由 thiserror 生成 —— 手写这三个
/// impl 不会更清楚，只会多三处需要跟着变体一起维护的地方。
#[derive(Debug, Error)]
pub enum Error {
    #[error("IO: {0}")]
    Io(#[from] std::io::Error),

    #[error("Internal: {0}")]
    Internal(String),
}

pub type Result<T> = std::result::Result<T, Error>;
