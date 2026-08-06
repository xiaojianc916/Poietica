//! 库这一侧。
//!
//! 连接第一次被需要时才开，之后一直留着。读写都不站在主线程上。

use std::sync::{Arc, Mutex, MutexGuard};
use poietica_agent_persistence_native::{AgentStore, StoreError};
use tauri::{State, async_runtime};
use uuid::Uuid;
use crate::error::{Error, Result};

use super::{COUNT_TOO_LARGE, NO_READ, POISONED};
use super::failure::fn;
use super::runtime::{AgentRuntime, lock};

/// The one connection, opened the first time anything needs it.
///
/// Not at boot: opening it runs the migrations, and a launch that never
/// opens the assistant should not pay for that. Once, though, and not once
/// per command.
fn shared_store(state: &State<'_, AgentRuntime>) -> Result<Arc<Mutex<AgentStore>>> {
    if let Some(held) = state.store.get() {
        return Ok(Arc::clone(held));
    }

    let opened = Arc::new(Mutex::new(
        AgentStore::open(&state.database).map_err(persistence)?,
    ));

    // Two commands can race to be the first. The loser's connection is
    // dropped and everyone uses the winner's, which is the whole point.
    Ok(Arc::clone(state.store.get_or_init(|| opened)))
}

/// Takes the connection for the length of one statement.
///
/// Never held across an await: a guard that is would make the command's
/// future not Send, which is why this is a separate step from taking the
/// share above rather than one call that does both.
fn borrow_store(shared: &Arc<Mutex<AgentStore>>) -> Result<MutexGuard<'_, AgentStore>> {
    shared
        .lock()
        .map_err(|_poisoned| Error::Internal(POISONED.to_owned()))
}

/// Reads or writes the log without standing on the main thread.
///
/// A command that is not `async` runs on the main thread, and a read of the
/// index may wait on the write lock for as long as `DEFAULT_BUSY_TIMEOUT`
/// before a single row comes back. Put that on the main thread and the window stops
/// answering: the sidebar does not highlight, the click does not land, and
/// the conversation looks broken rather than slow.
///
/// The two halves are separate on purpose. Taking the share needs the
/// managed state, which is borrowed; running the work needs `'static`. So
/// the handle is taken here and the statement is handed to the pool.
pub(super) async fn on_store<T, F>(state: &State<'_, AgentRuntime>, work: F) -> Result<T>
where
    T: Send + 'static,
    F: FnOnce(&mut AgentStore) -> Result<T> + Send + 'static,
{
    let shared = shared_store(state)?;

    async_runtime::spawn_blocking(move || {
        let mut store = borrow_store(&shared)?;

        work(&mut store)
    })
    .await
    .map_err(|_dropped| Error::Internal(NO_READ.to_owned()))?
}

pub(super) fn persistence(error: StoreError) -> Error {
    Error::Persistence(error.to_string())
}

/// 库里的一个计数，缩成线上那一格。
///
/// 只有这一处做这件事。SQLite 交回来的一律是 i64，而这份 IPC 面上没有
/// 任何一个 64 位整数 —— 边界在这里，不在别处。
pub(super) fn counted(value: i64) -> Result<u32> {
    u32::try_from(value).map_err(|_overflow| Error::Internal(COUNT_TOO_LARGE.to_owned()))
}

/// Reads a conversation identifier the renderer supplied.
pub(super) fn conversation(named: &str) -> Result<Uuid> {
    Uuid::parse_str(named).map_err(|_invalid| {
        Error::Validation("the conversation identifier is not a UUID".to_owned())
    })
}
