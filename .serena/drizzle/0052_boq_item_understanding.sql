CREATE TABLE estimator_understanding_runs (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL REFERENCES projects(id),
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  total_items INTEGER NOT NULL DEFAULT 0,
  processed_items INTEGER NOT NULL DEFAULT 0,
  successful_items INTEGER NOT NULL DEFAULT 0,
  review_items INTEGER NOT NULL DEFAULT 0,
  failed_items INTEGER NOT NULL DEFAULT 0,
  requested_by TEXT NOT NULL,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);
CREATE INDEX estimator_understanding_runs_project_idx ON estimator_understanding_runs(project_id, started_at);

CREATE TABLE estimator_item_interpretations (
  id TEXT PRIMARY KEY NOT NULL,
  run_id TEXT NOT NULL REFERENCES estimator_understanding_runs(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  boq_item_id TEXT NOT NULL REFERENCES boq_items(id),
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  config_fingerprint TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  model_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  status TEXT NOT NULL,
  raw_response TEXT,
  validated_interpretation TEXT,
  error_code TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(boq_item_id, version_number),
  UNIQUE(boq_item_id, input_fingerprint, config_fingerprint)
);
CREATE INDEX estimator_item_interpretations_latest_idx ON estimator_item_interpretations(boq_item_id, version_number DESC);
CREATE INDEX estimator_item_interpretations_project_status_idx ON estimator_item_interpretations(project_id, status, created_at);
