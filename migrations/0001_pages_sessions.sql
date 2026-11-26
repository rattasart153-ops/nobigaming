CREATE TABLE IF NOT EXISTS nobi_pages_sessions (
  session_hash TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK (role IN ('member', 'admin')),
  token_ciphertext TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_nobi_pages_sessions_expiry
  ON nobi_pages_sessions (expires_at);

CREATE INDEX IF NOT EXISTS idx_nobi_pages_sessions_role_last_seen
  ON nobi_pages_sessions (role, last_seen_at);
