-- Linkbeam initial schema. Numbered migrations are never edited after merge.
-- Timestamps are UTC unix seconds (integers). Ids are random opaque strings.
-- Statements are separated by semicolons at the end of a line. Do not put a
-- semicolon inside a string literal, because the test runner splits on them.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
  username TEXT UNIQUE CHECK (username IS NULL OR (username = lower(username) AND length(username) BETWEEN 3 AND 30)),
  username_changed_at INTEGER,
  display_name TEXT NOT NULL DEFAULT '' CHECK (length(display_name) <= 60),
  bio TEXT NOT NULL DEFAULT '' CHECK (length(bio) <= 160),
  avatar_key TEXT,
  theme TEXT NOT NULL DEFAULT 'forest',
  accent TEXT CHECK (accent IS NULL OR length(accent) = 7),
  is_banned INTEGER NOT NULL DEFAULT 0 CHECK (is_banned IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE avatars (
  key TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  content_type TEXT NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png', 'image/webp')),
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  user_agent_hash TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

CREATE TABLE login_tokens (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE INDEX idx_login_tokens_expires ON login_tokens(expires_at);

CREATE TABLE links (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('url', 'whatsapp', 'pay', 'call', 'email', 'map')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  target TEXT NOT NULL CHECK (length(target) <= 2048),
  message TEXT CHECK (message IS NULL OR length(message) <= 300),
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  starts_at INTEGER,
  ends_at INTEGER,
  UNIQUE (user_id, position)
);

CREATE INDEX idx_links_user ON links(user_id, position);

CREATE TABLE daily_stats (
  day INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  link_id TEXT REFERENCES links(id) ON DELETE CASCADE,
  views INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX idx_stats_page ON daily_stats(day, user_id) WHERE link_id IS NULL;

CREATE UNIQUE INDEX idx_stats_link ON daily_stats(day, user_id, link_id) WHERE link_id IS NOT NULL;

CREATE INDEX idx_stats_user_day ON daily_stats(user_id, day);

CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK (length(reason) BETWEEN 1 AND 500),
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'actioned', 'dismissed'))
);

CREATE INDEX idx_reports_user ON reports(user_id);

CREATE INDEX idx_reports_status ON reports(status, created_at);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  at INTEGER NOT NULL,
  ip_hash TEXT
);

CREATE INDEX idx_audit_user ON audit_log(user_id, at);
