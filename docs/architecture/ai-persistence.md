# AI persistence

The crate `poietica-agent-persistence-native` at `agent/persistence/native` owns everything the
assistant keeps on disk.

## Encryption

The whole database is encrypted with SQLCipher, compiled in through
`rusqlite`'s bundled feature rather than linked against whatever the host
happens to provide, so the cipher configuration in production matches the one
under test.

The key is 32 random bytes held in the operating system credential store and
passed as a raw key, `PRAGMA key = "x'<hex>'"`. A raw key skips key
derivation entirely; deriving from a passphrase would cost hundreds of
thousands of PBKDF2 rounds on every open and add nothing, because the material
already has full entropy.

A wrong key is detected immediately after opening by reading
`sqlite_master`, since SQLCipher only proves a key once a page is decrypted.

Credential storage goes through `keyring`, whose version 4 reaches the macOS
keychain, the Windows Credential Manager and the \*nix Secret Service through
its default `v1` feature. The per-platform features of version 3 no longer
exist, and the entry type now lives in the `v1` module.

## The event log

`run_events` is append only and is the source of truth. The ACP client
writes each session update to it **before** forwarding it to the interface, so
an interrupted run stays replayable and `session/load` has something to read.

`UNIQUE (run_id, seq)` is the deduplication guarantee. A redelivered update
is refused by the database rather than by whichever caller happened to notice,
and surfaces as `StoreError::DuplicateSeq`.

Every other table is a projection. Projections can be rebuilt from the log,
which means a bug in one is never a loss of data.

## Concurrency

Write ahead logging lets the interface read a run while it is still being
recorded. Writes go through one connection, because the log's ordering is what
the rest of the system depends on and serialising them is cheaper than
reconciling interleaved sequence numbers afterwards. Readers wait up to five
seconds for the lock.

## What comes next

The message, plan and attachment projections are deliberately absent. They are
derived from ACP updates, and their shape should follow the client that
produces them rather than be guessed ahead of it.

## Tool call and permission projections

`tool_calls` and `permissions` are projections. They are written from the
same code path that appends to `run_events`, never independently of it, so
they can be dropped and rebuilt by replaying the log.

Three rules follow from the fact that the source of those writes is a stream
that may repeat itself:

- An announcement that arrives twice folds into the existing row. The protocol
  permits an agent to describe the same call more than once while its input is
  still streaming in.
- An update that arrives before the announcement it belongs to matches no row.
  The write reports that instead of inventing one, because only the caller
  knows whether that is a recoverable ordering artefact or a real fault.
- An answer to a permission request only lands while the request is still
  outstanding. This is what stops a late click from overwriting a
  cancellation.

The end timestamp is written by exactly one decision, `ToolCallStatus::is_terminal`,
so completed and failed calls can never disagree about whether they finished.
