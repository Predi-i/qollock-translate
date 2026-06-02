CREATE TABLE IF NOT EXISTS languages (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS translations (
  language_code TEXT NOT NULL,
  translation_key TEXT NOT NULL,
  value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'translated' CHECK (status IN ('draft', 'translated', 'reviewed')),
  translator_email TEXT,
  reviewer_email TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (language_code, translation_key),
  FOREIGN KEY (language_code) REFERENCES languages(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_translations_language_status
  ON translations(language_code, status);
