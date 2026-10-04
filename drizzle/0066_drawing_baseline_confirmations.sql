-- Persisted project drawing baseline confirmations (minimal, additive).
-- One row per confirmation generation. Members are stored as JSON with exact
-- document/version/intake identities; currentness is re-derived at read time
-- from live heads, never trusted from the stored JSON.
CREATE TABLE IF NOT EXISTS drawing_baseline_confirmations (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  member_count INTEGER NOT NULL,
  members_json TEXT NOT NULL,
  set_fingerprint TEXT NOT NULL,
  confirmed_by TEXT NOT NULL,
  confirmed_at TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_baseline_generation_idx
  ON drawing_baseline_confirmations(project_id, generation);
CREATE INDEX IF NOT EXISTS drawing_baseline_current_idx
  ON drawing_baseline_confirmations(project_id, superseded_at);
