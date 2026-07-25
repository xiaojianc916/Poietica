use rusqlite::Connection;

use crate::error::Result;

/// Ordered migrations. Never edit one that has shipped; add the next.
const MIGRATIONS: &[(i64, &str, &str)] =
    &[(1, "initial", include_str!("schema/0001_initial.sql"))];

/// Brings the database up to the current schema version.
///
/// Each migration runs inside a transaction together with the row that records
/// it, so a failure leaves no half applied schema behind.
///
/// # Errors
///
/// Fails when a migration statement is rejected.
pub fn migrate(connection: &mut Connection) -> Result<()> {
    connection.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version    INTEGER PRIMARY KEY,
            name       TEXT    NOT NULL,
            applied_at TEXT    NOT NULL
         ) STRICT;",
    )?;

    let applied: i64 = connection.query_row(
        "SELECT coalesce(max(version), 0) FROM schema_migrations",
        [],
        |row| row.get(0),
    )?;

    for (version, name, sql) in MIGRATIONS {
        if *version <= applied {
            continue;
        }

        let transaction = connection.transaction()?;
        transaction.execute_batch(sql)?;
        transaction.execute(
            "INSERT INTO schema_migrations (version, name, applied_at)
             VALUES (?1, ?2, datetime('now'))",
            rusqlite::params![version, name],
        )?;
        transaction.commit()?;
    }

    Ok(())
}
