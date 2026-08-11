-- Phase 5B: non-authoritative AI quotation advisory persistence.
CREATE TABLE IF NOT EXISTS ai_quotation_advisories (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  quotation_revision_id TEXT REFERENCES project_quotation_revisions(id),
  evidence_fingerprint TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  engine_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL,
  advisory_json TEXT NOT NULL,
  validation_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  UNIQUE(project_id,input_fingerprint,config_fingerprint)
);
CREATE INDEX IF NOT EXISTS ai_quotation_advisory_current_idx ON ai_quotation_advisories(project_id,evidence_fingerprint,created_at) WHERE superseded_at IS NULL;
