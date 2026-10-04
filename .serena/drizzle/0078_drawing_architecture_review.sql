-- STEP 14.7 -- SYSTEM ARCHITECTURE FACT GOVERNANCE (Fire Alarm)
-- Governed surface for deterministic, evidenced architecture facts extracted
-- from riser / schematic / network-diagram sheets: panels, panel locations,
-- network links, loops, NAC circuits, external interfaces, cross-sheet
-- references, layout<->legend links, and engineering discrepancies.
--
-- Mirrors the existing governed drawing-fact surface (drawing_structure_*):
-- a per-candidate case row + review events + project-scoped approved versions
-- and rows + promotion audit. Architecture facts belong to the PROJECT (a
-- campus network spans many sheets), so approved versions are keyed by
-- project_id, unlike the per-document structure surface.
--
-- Decision policy lives in app/domain/drawing-architecture-decision-policy.mjs.
-- Promotion/actor rules mirror drawing-fact-decision-policy.mjs:
--   actor system:deterministic-drawing-evaluation, auto-confirm ONLY for
--   deterministic, fully evidenced, unambiguous facts; everything else is an
--   engineer-review item. Never a technical/product/commercial approval.
CREATE TABLE IF NOT EXISTS drawing_architecture_review_cases (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  drawing_intake_version_id TEXT NOT NULL,
  structure_version_id TEXT,
  fact_key TEXT NOT NULL,
  fact_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  relation TEXT,
  object TEXT,
  scope TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  authority_class TEXT,
  source_drawing_number TEXT,
  source_page INTEGER,
  source_region TEXT,
  source_fragment_ids TEXT NOT NULL DEFAULT '[]',
  parser_version TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  decision_state TEXT NOT NULL DEFAULT 'Pending',
  decision_reason TEXT NOT NULL DEFAULT '[]',
  decision_policy_version TEXT,
  case_version INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'Needs Review',
  original_snapshot TEXT NOT NULL,
  current_snapshot TEXT NOT NULL,
  adjustments TEXT NOT NULL DEFAULT '[]',
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(drawing_intake_version_id) REFERENCES drawing_intake_versions(id),
  FOREIGN KEY(structure_version_id) REFERENCES drawing_structure_versions(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_case_unique_idx ON drawing_architecture_review_cases(document_id,drawing_intake_version_id,fact_key);
CREATE INDEX IF NOT EXISTS drawing_architecture_case_status_idx ON drawing_architecture_review_cases(project_id,status,updated_at);
CREATE INDEX IF NOT EXISTS drawing_architecture_case_type_idx ON drawing_architecture_review_cases(document_id,fact_type);
CREATE TABLE IF NOT EXISTS drawing_architecture_review_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  drawing_intake_version_id TEXT NOT NULL,
  review_case_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_snapshot TEXT NOT NULL,
  new_snapshot TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  actor_permission TEXT NOT NULL,
  request_id TEXT NOT NULL,
  case_version INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(review_case_id) REFERENCES drawing_architecture_review_cases(id)
);
CREATE INDEX IF NOT EXISTS drawing_architecture_event_idx ON drawing_architecture_review_events(review_case_id,created_at);
CREATE TABLE IF NOT EXISTS drawing_architecture_approved_versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  approved_fact_count INTEGER NOT NULL,
  excluded_fact_count INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  superseded_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(project_id) REFERENCES projects(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_approved_version_idx ON drawing_architecture_approved_versions(project_id,version_number);
CREATE TABLE IF NOT EXISTS drawing_architecture_approved_rows (
  id TEXT PRIMARY KEY,
  approved_version_id TEXT NOT NULL,
  review_case_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  drawing_intake_version_id TEXT NOT NULL,
  structure_version_id TEXT,
  fact_type TEXT NOT NULL,
  subject TEXT NOT NULL,
  relation TEXT,
  object TEXT,
  scope TEXT NOT NULL,
  evidence_kind TEXT NOT NULL,
  authority_class TEXT,
  source_drawing_number TEXT,
  source_page INTEGER,
  source_region TEXT,
  source_fragment_ids TEXT NOT NULL DEFAULT '[]',
  parser_version TEXT NOT NULL,
  evidence_fingerprint TEXT NOT NULL,
  review_actor_id TEXT NOT NULL,
  review_reason TEXT NOT NULL,
  source_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(approved_version_id) REFERENCES drawing_architecture_approved_versions(id),
  FOREIGN KEY(review_case_id) REFERENCES drawing_architecture_review_cases(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_approved_row_idx ON drawing_architecture_approved_rows(approved_version_id,review_case_id);
CREATE TABLE IF NOT EXISTS drawing_architecture_approved_audit_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT,
  approved_version_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(approved_version_id) REFERENCES drawing_architecture_approved_versions(id)
);
CREATE INDEX IF NOT EXISTS drawing_architecture_approved_audit_idx ON drawing_architecture_approved_audit_events(approved_version_id,created_at);