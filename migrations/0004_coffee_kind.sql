-- Stage 5: Linkbeam has no payment features. The "pay" link kind is replaced by an optional "coffee" kind
-- (a link to the owner's own Buy Me a Coffee page). Old "pay" links become ordinary web links, so nothing is lost.
-- SQLite cannot change a CHECK rule in place, so the links table is rebuilt. The daily_stats rows are copied aside
-- first, because dropping the old table would otherwise remove them through ON DELETE CASCADE.

CREATE TABLE stats_copy AS SELECT * FROM daily_stats;

CREATE TABLE links_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('url', 'whatsapp', 'coffee', 'call', 'email', 'map')),
  title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 60),
  target TEXT NOT NULL CHECK (length(target) <= 2048),
  message TEXT CHECK (message IS NULL OR length(message) <= 300),
  position INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  starts_at INTEGER,
  ends_at INTEGER,
  UNIQUE (user_id, position)
);

INSERT INTO links_new (id, user_id, kind, title, target, message, position, enabled, starts_at, ends_at)
  SELECT id, user_id, CASE WHEN kind = 'pay' THEN 'url' ELSE kind END, title, target, message, position, enabled, starts_at, ends_at FROM links;

DROP TABLE links;

ALTER TABLE links_new RENAME TO links;

CREATE INDEX idx_links_user ON links(user_id, position);

DELETE FROM daily_stats;

INSERT INTO daily_stats SELECT * FROM stats_copy;

DROP TABLE stats_copy;
