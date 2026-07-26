use std::path::Path;
use std::time::Duration;

use rusqlite::Connection;

use crate::error::{Result, StoreError};
use crate::key::DatabaseKey;

/// How long a writer waits for the lock before giving up.
pub const DEFAULT_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

/// Opens an encrypted database and puts it into the configuration the rest of
/// the crate assumes.
///
/// The order matters. `SQLCipher` needs the key before any other statement, and
/// the key is only proven correct once a page is actually read, which is why
/// the schema is queried immediately: a wrong key fails here rather than
/// somewhere deep in a later query.
///
/// # Errors
///
/// Fails when the file cannot be opened, the key does not decrypt it, or a
/// pragma is rejected.
pub fn open_encrypted(path: &Path, key: &DatabaseKey) -> Result<Connection> {
    let connection = Connection::open(path)?;

    // Interpolated rather than bound: pragma values cannot be parameters, and
    // the text is hexadecimal produced by this crate.
    connection.execute_batch(&format!("PRAGMA key = \"x'{}'\";", key.to_hex()))?;

    connection
        .query_row("SELECT count(*) FROM sqlite_master", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|_ignored| StoreError::WrongKey)?;

    // Write ahead logging lets the UI read while a run is being recorded.
    let _mode: String =
        connection.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;

    connection.pragma_update(None, "synchronous", "NORMAL")?;
    connection.pragma_update(None, "foreign_keys", true)?;
    connection.busy_timeout(DEFAULT_BUSY_TIMEOUT)?;

    Ok(connection)
}
