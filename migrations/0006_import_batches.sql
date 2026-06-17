-- A bulk JSON upload can go wrong in one click (e.g. uploading the English
-- source by mistake), so every import is recorded as a revertible batch. We
-- store, per affected string, the state it had BEFORE the import so an undo can
-- put it back exactly: restore the prior value, or delete the row if the import
-- was the thing that created it.
CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  language_code TEXT NOT NULL,
  translator_email TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  undone_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (language_code) REFERENCES languages(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_import_batches_language_created
  ON import_batches(language_code, undone_at, created_at);

-- One row per string the import created or overwrote. prior_existed = 0 means
-- the import created the row (undo deletes it); = 1 means it overwrote an
-- existing row (undo restores the prior_* columns). imported_value is what the
-- import wrote, used as a guard so an undo never clobbers an edit the translator
-- made by hand after the import.
CREATE TABLE IF NOT EXISTS import_batch_entries (
  batch_id TEXT NOT NULL,
  translation_key TEXT NOT NULL,
  prior_existed INTEGER NOT NULL,
  prior_value TEXT,
  prior_status TEXT,
  prior_needs_review INTEGER,
  prior_translator_email TEXT,
  prior_reviewer_email TEXT,
  prior_updated_at TEXT,
  imported_value TEXT NOT NULL,
  PRIMARY KEY (batch_id, translation_key),
  FOREIGN KEY (batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
);
