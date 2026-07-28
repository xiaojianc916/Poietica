-- A thread may be holding one agent session, and a title may be the
-- agent's own or a stand in the interface chose. Both are recorded so a
-- stand in never overwrites an official name.

ALTER TABLE threads ADD COLUMN session_id TEXT;
ALTER TABLE threads ADD COLUMN title_source TEXT NOT NULL DEFAULT 'fallback';

-- A session belongs to at most one thread. Threads holding no session
-- keep a null here, and nulls do not collide in a unique index.
CREATE UNIQUE INDEX IF NOT EXISTS threads_session_id
    ON threads (session_id);
