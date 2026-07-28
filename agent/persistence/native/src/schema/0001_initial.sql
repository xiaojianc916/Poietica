-- Initial schema for agent state.
--
-- run_events is append only and is the source of truth for what happened
-- inside a run. runs, tool_calls and permissions are projections of it: they
-- exist to be queried, they can be rebuilt from the log, and a bug in one of
-- them is never a data loss bug.
--
-- threads is not one of those, and saying it was is what this comment used to
-- get wrong. A manual title and a pin are decisions the user made about a
-- conversation, not things that happened inside one, and no event in the log
-- records either of them. Rebuilding this table from run_events would throw
-- both away. It is authoritative, and it is the only table here that is.
--
-- (A comment carries no schema, and this file is only ever executed against a
--  database that has not applied version 1, so correcting one is not editing
--  a migration that has shipped.)

CREATE TABLE threads (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE runs (
    id          TEXT PRIMARY KEY,
    thread_id   TEXT NOT NULL REFERENCES threads (id) ON DELETE CASCADE,
    status      TEXT NOT NULL CHECK (
                    status IN ('running', 'finished', 'failed', 'cancelled')
                ),
    stop_reason TEXT,
    started_at  TEXT NOT NULL,
    ended_at    TEXT
) STRICT;

-- The unique key is the deduplication guarantee for the ACP stream: a session
-- update that arrives twice is rejected by the database, not by the caller.
CREATE TABLE run_events (
    run_id      TEXT    NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    seq         INTEGER NOT NULL,
    kind        TEXT    NOT NULL,
    payload     TEXT    NOT NULL,
    recorded_at TEXT    NOT NULL,
    PRIMARY KEY (run_id, seq)
) STRICT;

CREATE TABLE tool_calls (
    id         TEXT NOT NULL,
    run_id     TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    kind       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (
                   status IN ('pending', 'in_progress', 'completed', 'failed')
               ),
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    PRIMARY KEY (run_id, id)
) STRICT;

CREATE TABLE permissions (
    request_id   TEXT PRIMARY KEY,
    run_id       TEXT NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
    tool_call_id TEXT,
    outcome      TEXT CHECK (outcome IN ('allowed', 'denied', 'cancelled')),
    requested_at TEXT NOT NULL,
    resolved_at  TEXT
) STRICT;

CREATE INDEX runs_by_thread ON runs (thread_id, started_at DESC);
CREATE INDEX threads_by_recency ON threads (updated_at DESC);
CREATE INDEX tool_calls_by_status ON tool_calls (run_id, status);
