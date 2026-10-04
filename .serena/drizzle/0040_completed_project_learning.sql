-- Governed Completed Projects Learning Foundation.
-- Deliberately isolated from matching, pricing and canonical product records.
CREATE TABLE IF NOT EXISTS case_studies (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL, organization_id TEXT NOT NULL,
  case_version INTEGER NOT NULL, snapshot_fingerprint TEXT NOT NULL,
  project_snapshot TEXT NOT NULL, system_domain TEXT, client TEXT, location TEXT,
  currency TEXT, project_outcome TEXT, source_completeness INTEGER NOT NULL DEFAULT 0,
  ground_truth_completeness INTEGER NOT NULL DEFAULT 0, review_state TEXT NOT NULL DEFAULT 'Needs Review',
  publication_state TEXT NOT NULL DEFAULT 'Not Published', benchmark_state TEXT NOT NULL DEFAULT 'Learning',
  benchmark_release TEXT, frozen_at TEXT NOT NULL, frozen_by TEXT NOT NULL,
  superseded_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, case_version), UNIQUE(project_id, snapshot_fingerprint)
);
CREATE INDEX IF NOT EXISTS case_studies_org_state_idx ON case_studies(organization_id,review_state,publication_state);
CREATE INDEX IF NOT EXISTS case_studies_benchmark_idx ON case_studies(benchmark_state,benchmark_release,superseded_at);

CREATE TABLE IF NOT EXISTS case_study_sources (
  id TEXT PRIMARY KEY, case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  document_id TEXT, document_version_id TEXT, source_type TEXT NOT NULL, name TEXT NOT NULL,
  checksum TEXT, revision TEXT, issue_date TEXT, authority TEXT, scope TEXT,
  completeness_state TEXT NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_study_id,document_version_id,source_type)
);
CREATE INDEX IF NOT EXISTS case_sources_case_type_idx ON case_study_sources(case_study_id,source_type);

CREATE TABLE IF NOT EXISTS case_ground_truth_records (
  id TEXT PRIMARY KEY, case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  record_key TEXT NOT NULL, boq_item_id TEXT, record_type TEXT NOT NULL,
  original_value TEXT NOT NULL, normalized_value TEXT, confidence INTEGER NOT NULL,
  review_state TEXT NOT NULL DEFAULT 'Needs Review', evidence_scope TEXT NOT NULL,
  provenance TEXT NOT NULL, effective_date TEXT, version INTEGER NOT NULL DEFAULT 1,
  superseded_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_study_id,record_key,version)
);
CREATE INDEX IF NOT EXISTS case_ground_truth_case_idx ON case_ground_truth_records(case_study_id,record_type,review_state);

CREATE TABLE IF NOT EXISTS case_knowledge_items (
  id TEXT PRIMARY KEY, case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  ground_truth_record_id TEXT REFERENCES case_ground_truth_records(id),
  classification TEXT NOT NULL, layer TEXT NOT NULL, title TEXT NOT NULL,
  original_value TEXT NOT NULL, normalized_value TEXT, confidence INTEGER NOT NULL,
  scope TEXT NOT NULL, review_state TEXT NOT NULL DEFAULT 'Needs Review',
  publication_state TEXT NOT NULL DEFAULT 'Not Published', reusable INTEGER NOT NULL DEFAULT 0,
  evidence TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS case_knowledge_queue_idx ON case_knowledge_items(layer,review_state,publication_state);
CREATE INDEX IF NOT EXISTS case_knowledge_case_idx ON case_knowledge_items(case_study_id,classification);

CREATE TABLE IF NOT EXISTS case_knowledge_decisions (
  id TEXT PRIMARY KEY, case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  knowledge_item_id TEXT NOT NULL REFERENCES case_knowledge_items(id), action TEXT NOT NULL,
  previous_value TEXT, new_value TEXT NOT NULL, reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL, actor_permission TEXT NOT NULL,
  decision_version INTEGER NOT NULL, reversed_by_decision_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS case_knowledge_decision_item_idx ON case_knowledge_decisions(knowledge_item_id,created_at);

CREATE TABLE IF NOT EXISTS case_similarity_signals (
  id TEXT PRIMARY KEY, case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  signal_type TEXT NOT NULL, signal_value TEXT NOT NULL, normalized_value TEXT NOT NULL,
  weight REAL NOT NULL, provenance TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(case_study_id,signal_type,normalized_value)
);
CREATE INDEX IF NOT EXISTS case_similarity_lookup_idx ON case_similarity_signals(signal_type,normalized_value,case_study_id);

CREATE TABLE IF NOT EXISTS case_learning_evaluations (
  id TEXT PRIMARY KEY, case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  release_id TEXT NOT NULL, suggestion_type TEXT NOT NULL, suggestion_id TEXT,
  outcome TEXT NOT NULL, evidence TEXT NOT NULL, explanation TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS case_learning_eval_release_idx ON case_learning_evaluations(release_id,case_study_id,outcome);

CREATE TABLE IF NOT EXISTS case_study_audit_log (
  id TEXT PRIMARY KEY, case_study_id TEXT NOT NULL REFERENCES case_studies(id),
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
  previous_value TEXT, new_value TEXT, reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL, actor_permission TEXT NOT NULL,
  request_id TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS case_audit_case_idx ON case_study_audit_log(case_study_id,created_at);

