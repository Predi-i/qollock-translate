-- A commit-style log of every translation change. The translations table only
-- holds each string's latest state, so this is where the per-edit history lives:
-- one row per save / approve / import / delete, with the value before and after.
-- It starts empty at rollout (there is nowhere to recover past edits from) and
-- grows from the first change onward.
CREATE TABLE IF NOT EXISTS translation_history (
  id INTEGER PRIMARY KEY,
  language_code TEXT NOT NULL,
  translation_key TEXT NOT NULL,
  -- What produced the change: a manual edit, a reviewer approval, a bulk import,
  -- or a deletion (value cleared).
  action TEXT NOT NULL CHECK (action IN ('edit', 'approve', 'import', 'delete')),
  old_value TEXT,                 -- NULL when the string was newly created
  new_value TEXT,                 -- NULL when the string was deleted
  status TEXT,                    -- resulting status; NULL for a delete
  changed_by TEXT,                -- GitHub login of whoever made the change
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_translation_history_lang_time
  ON translation_history(language_code, created_at);
