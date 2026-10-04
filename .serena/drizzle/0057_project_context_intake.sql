CREATE TABLE project_context_extraction_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  classification_id TEXT,
  version_number INTEGER NOT NULL,
  source_checksum TEXT NOT NULL,
  parser_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  summary_json TEXT NOT NULL,
  error_code TEXT,
  error_message TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  superseded_at TEXT,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(document_version_id) REFERENCES document_versions(id),
  FOREIGN KEY(classification_id) REFERENCES document_classifications(id)
);

CREATE UNIQUE INDEX project_context_extraction_fingerprint_idx
  ON project_context_extraction_versions(project_id, document_version_id, input_fingerprint);

CREATE UNIQUE INDEX project_context_extraction_version_idx
  ON project_context_extraction_versions(document_id, version_number);

CREATE INDEX project_context_extraction_project_idx
  ON project_context_extraction_versions(project_id, status, created_at);


CREATE TABLE project_context_facts (
  id TEXT PRIMARY KEY,
  extraction_version_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  fact_key TEXT NOT NULL,
  label TEXT NOT NULL,
  extracted_value TEXT NOT NULL,
  normalized_value TEXT,
  value_origin TEXT NOT NULL DEFAULT 'Deterministic Extraction',
  confidence INTEGER NOT NULL DEFAULT 100,
  source_sheet TEXT NOT NULL,
  source_row INTEGER NOT NULL,
  source_cell TEXT NOT NULL,
  source_label_cell TEXT,
  requires_ai_interpretation INTEGER NOT NULL DEFAULT 0,
  ai_interpretation_json TEXT,
  review_status TEXT NOT NULL DEFAULT 'Needs Review',
  reviewed_value TEXT,
  review_reason TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(extraction_version_id) REFERENCES project_context_extraction_versions(id),
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(document_id) REFERENCES documents(id),
  FOREIGN KEY(document_version_id) REFERENCES document_versions(id)
);

CREATE UNIQUE INDEX project_context_fact_key_idx
  ON project_context_facts(extraction_version_id, fact_key);

CREATE INDEX project_context_fact_review_idx
  ON project_context_facts(project_id, review_status, requires_ai_interpretation);


CREATE TABLE project_context_review_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  extraction_version_id TEXT NOT NULL,
  fact_id TEXT,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id),
  FOREIGN KEY(extraction_version_id) REFERENCES project_context_extraction_versions(id),
  FOREIGN KEY(fact_id) REFERENCES project_context_facts(id)
);

CREATE INDEX project_context_review_event_fact_idx
  ON project_context_review_events(fact_id, created_at);

CREATE UNIQUE INDEX project_context_review_event_request_idx
  ON project_context_review_events(project_id, request_id);
