CREATE TABLE IF NOT EXISTS contributors (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  trust_level INTEGER NOT NULL DEFAULT 0,
  banned_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS translation_suggestions (
  id TEXT PRIMARY KEY,
  language_code TEXT NOT NULL,
  translation_key TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  contributor_id TEXT NOT NULL,
  context_route TEXT,
  app_version TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (language_code) REFERENCES languages(code) ON DELETE CASCADE,
  FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_translation_suggestions_language_status
  ON translation_suggestions(language_code, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_translation_suggestions_key
  ON translation_suggestions(language_code, translation_key, status);

CREATE INDEX IF NOT EXISTS idx_translation_suggestions_contributor
  ON translation_suggestions(contributor_id, created_at);
