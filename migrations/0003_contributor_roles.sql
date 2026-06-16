ALTER TABLE contributors
  ADD COLUMN role TEXT NOT NULL DEFAULT 'translator'
  CHECK (role IN ('translator', 'reviewer', 'admin'));

CREATE INDEX IF NOT EXISTS idx_contributors_role_last_seen
  ON contributors(role, last_seen_at);
