-- Controlled historical BOQ learning dataset. Isolated from live project, matching and pricing records.
CREATE TABLE IF NOT EXISTS historical_boq_projects (
  id TEXT PRIMARY KEY, organization_id TEXT, name TEXT NOT NULL, client TEXT,
  disciplines TEXT NOT NULL, project_date TEXT, project_status TEXT NOT NULL,
  learning_pair_status TEXT NOT NULL, completion_evidence TEXT NOT NULL,
  source_root TEXT NOT NULL, dataset_version INTEGER NOT NULL DEFAULT 1,
  review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historical_boq_files (
  id TEXT PRIMARY KEY, historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  path TEXT NOT NULL, file_name TEXT NOT NULL, checksum TEXT NOT NULL, size_bytes INTEGER NOT NULL,
  extension TEXT, sheet_names TEXT NOT NULL, file_role TEXT NOT NULL, source_or_output TEXT NOT NULL,
  revision TEXT, role_evidence TEXT NOT NULL, role_confidence INTEGER NOT NULL,
  human_review_required INTEGER NOT NULL DEFAULT 1, readability TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(historical_project_id, checksum, path)
);
CREATE INDEX IF NOT EXISTS historical_boq_files_project_role_idx ON historical_boq_files(historical_project_id,file_role);

CREATE TABLE IF NOT EXISTS historical_boq_rows (
  id TEXT PRIMARY KEY, historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  file_id TEXT NOT NULL REFERENCES historical_boq_files(id), sheet_name TEXT NOT NULL, row_number INTEGER NOT NULL,
  item_number TEXT, section_path TEXT, original_cells TEXT NOT NULL, original_description TEXT,
  original_unit TEXT, original_quantity TEXT, formulae TEXT NOT NULL, discipline TEXT, system TEXT,
  location TEXT, row_formatting TEXT NOT NULL, merged_context TEXT NOT NULL,
  hidden_row INTEGER NOT NULL DEFAULT 0, row_type TEXT NOT NULL, classification_reason TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review', source_provenance TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(file_id,sheet_name,row_number)
);
CREATE INDEX IF NOT EXISTS historical_boq_rows_project_type_idx ON historical_boq_rows(historical_project_id,row_type);

CREATE TABLE IF NOT EXISTS historical_boq_final_rows (
  id TEXT PRIMARY KEY, historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  file_id TEXT NOT NULL REFERENCES historical_boq_files(id), page_number INTEGER, final_row_reference TEXT,
  final_row_type TEXT NOT NULL, final_description TEXT, final_unit TEXT, final_quantity TEXT,
  final_discipline TEXT, final_system TEXT, final_category TEXT, assembly_component TEXT,
  split_merge_decision TEXT, exclusion_decision TEXT, manufacturer TEXT, part_number TEXT,
  accessories TEXT, engineer_notes TEXT, approval_status TEXT, source_provenance TEXT NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'Needs Review', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historical_boq_alignments (
  id TEXT PRIMARY KEY, historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  source_row_id TEXT REFERENCES historical_boq_rows(id), final_row_id TEXT REFERENCES historical_boq_final_rows(id),
  outcome TEXT NOT NULL, alignment_method TEXT NOT NULL, confidence INTEGER NOT NULL,
  evidence TEXT NOT NULL, eligible_for_learning INTEGER NOT NULL DEFAULT 0,
  reviewer_status TEXT NOT NULL DEFAULT 'Needs Review', version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS historical_boq_alignments_project_outcome_idx ON historical_boq_alignments(historical_project_id,outcome);

CREATE TABLE IF NOT EXISTS historical_boq_decisions (
  id TEXT PRIMARY KEY, historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  alignment_id TEXT NOT NULL REFERENCES historical_boq_alignments(id), source_state TEXT NOT NULL,
  final_state TEXT NOT NULL, governance TEXT NOT NULL, eligible_for_boq_learning INTEGER NOT NULL DEFAULT 0,
  eligible_for_product_learning INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
  audit_history TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historical_boq_patterns (
  id TEXT PRIMARY KEY, pattern_type TEXT NOT NULL, discipline_scope TEXT NOT NULL,
  layout_signature TEXT NOT NULL, trigger_conditions TEXT NOT NULL, example_source_rows TEXT NOT NULL,
  expected_behavior TEXT NOT NULL, supporting_evidence_count INTEGER NOT NULL,
  confidence INTEGER NOT NULL, human_review_status TEXT NOT NULL DEFAULT 'Needs Review',
  scope_status TEXT NOT NULL, active_status TEXT NOT NULL DEFAULT 'Inactive', version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, last_validation_date TEXT
);

CREATE TABLE IF NOT EXISTS historical_boq_pattern_sources (
  id TEXT PRIMARY KEY, pattern_id TEXT NOT NULL REFERENCES historical_boq_patterns(id),
  historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  source_row_id TEXT REFERENCES historical_boq_rows(id), evidence TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historical_boq_validation_runs (
  id TEXT PRIMARY KEY, historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  validation_type TEXT NOT NULL, status TEXT NOT NULL, metrics TEXT NOT NULL,
  ground_truth_basis TEXT NOT NULL, blockers TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS historical_boq_audit_log (
  id TEXT PRIMARY KEY, historical_project_id TEXT NOT NULL REFERENCES historical_boq_projects(id),
  entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
  previous_value TEXT, new_value TEXT, reason TEXT NOT NULL, actor_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
