CREATE TABLE IF NOT EXISTS glossary_terms (
  language_code TEXT NOT NULL,
  source_term TEXT NOT NULL,
  target_term TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (language_code, source_term),
  FOREIGN KEY (language_code) REFERENCES languages(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_glossary_terms_language_updated
  ON glossary_terms(language_code, updated_at);
