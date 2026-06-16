-- A translator can flag a finished string as "please give this a second look".
-- Separate from status: a row can be 'translated' AND awaiting review at once.
ALTER TABLE translations
  ADD COLUMN needs_review INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_translations_language_review
  ON translations(language_code, needs_review);
