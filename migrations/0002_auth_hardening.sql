-- Stage 2: idle session timeout, rate limits and OAuth state.
-- Statements end with a semicolon at the end of a line. Do not put semicolons inside strings.

ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0;

UPDATE sessions SET last_seen_at = created_at;

-- One row per (counter, time window). Identifiers are hashed, so no raw IP or email is stored here.
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, window)
);

CREATE INDEX idx_rate_limits_expires ON rate_limits(expires_at);

-- Pending Google/GitHub sign-ins. The state is stored hashed and can be used once.
CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_oauth_states_expires ON oauth_states(expires_at);
