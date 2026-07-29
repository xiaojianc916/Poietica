//! The encrypted store itself.
//!
//! Opening the file is all this module does. What can be asked of it lives
//! next to the thing being asked about: threads.rs, runs.rs and events.rs,
//! each extending this same type, in the manner projections.rs already
//! established.

use std::path::Path;

use rusqlite::Connection;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::connection::open_encrypted;
use crate::error::Result;
use crate::key::{DatabaseKey, KEY_ACCOUNT, KEY_SERVICE};
use crate::migrations::migrate;

/// Owns the encrypted database.
///
/// A single writer is intentional. The log is the contention point and its
/// ordering is what everything else relies on, so serialising writes here is
/// simpler and safer than reconciling interleaved sequence numbers later.
#[derive(Debug)]
pub struct AgentStore {
    pub(crate) connection: Connection,
}

pub(crate) fn now() -> Result<String> {
    Ok(OffsetDateTime::now_utc().format(&Rfc3339)?)
}

impl AgentStore {
    /// Opens the store with the key held in the operating system credential
    /// store.
    ///
    /// # Errors
    ///
    /// Fails when the credential store is unavailable, the key does not fit
    /// the file, or a migration is rejected.
    pub fn open(path: &Path) -> Result<Self> {
        let key = DatabaseKey::load_or_create(KEY_SERVICE, KEY_ACCOUNT)?;
        Self::open_with_key(path, &key)
    }

    /// Opens the store with a caller supplied key, which is how the tests run
    /// without touching a real credential store.
    ///
    /// # Errors
    ///
    /// Fails when the key does not fit the file or a migration is rejected.
    pub fn open_with_key(path: &Path, key: &DatabaseKey) -> Result<Self> {
        let mut connection = open_encrypted(path, key)?;
        migrate(&mut connection)?;
        seal_orphaned_runs(&connection)?;
        Ok(Self { connection })
    }
}

/// 把上一次运行留下的、永远停在 running 的轮次封掉。
///
/// 一轮的存活完全依赖内存里的那个 Recorder：finish_run 只有它一个调用者。
/// 进程一旦退出，不可能再有任何人去写那一行，所以开库这一刻看到的每一个
/// running 都是上一次运行留下的尸体。这是从架构本身推出来的判定，不是一个
/// 超时启发式。同一时刻只有一个进程开这个库，由 bootstrap/app.rs 里第一个
/// 注册的 single-instance 插件保证。
///
/// 结束时间不编造。日志里那一行最后一帧的时间，就是它最后活着的证据；一帧
/// 都没留下的，就用它开始的时间。往这里填一个"发现它的时刻"，等于让日志说
/// 一件没发生过的事。
///
/// 界面本来就把非终态的重放显示成失败，所以这一刀不改变任何人看到的东西。
/// 它改变的是：这些轮次从此可以被折叠 —— 而最容易留下孤儿的，恰恰是跑得最
/// 久、帧最多、最需要折叠的那些轮次。
fn seal_orphaned_runs(connection: &Connection) -> Result<()> {
    connection.execute(
        "UPDATE runs
            SET status = 'failed',
                ended_at = coalesce(
                  ended_at,
                  (SELECT max(recorded_at) FROM run_events WHERE run_events.run_id = runs.id),
                  started_at
                )
          WHERE status = 'running'",
        [],
    )?;

    Ok(())
}
