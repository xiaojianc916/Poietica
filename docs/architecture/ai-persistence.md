# AI persistence

The crate `poietica-ai-persistence-native` at `features/ai/native` owns everything the
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
