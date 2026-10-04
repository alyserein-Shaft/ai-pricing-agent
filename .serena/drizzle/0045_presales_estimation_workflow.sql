-- End-to-end pre-sales orchestration and governed quotation lifecycle.
CREATE TABLE IF NOT EXISTS presales_workflow_snapshots (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), model_version TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL, status TEXT NOT NULL, progress INTEGER NOT NULL,
  current_stage_id TEXT NOT NULL, ready_for_quotation INTEGER NOT NULL DEFAULT 0,
  ready_for_issue INTEGER NOT NULL DEFAULT 0, stages_json TEXT NOT NULL,
  blockers_json TEXT NOT NULL, warnings_json TEXT NOT NULL, calculated_by TEXT NOT NULL,
  calculated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id,input_fingerprint)
);
CREATE INDEX IF NOT EXISTS presales_workflow_project_idx ON presales_workflow_snapshots(project_id,calculated_at);

CREATE TABLE IF NOT EXISTS project_quotation_revisions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), revision_number INTEGER NOT NULL,
  quotation_fingerprint TEXT NOT NULL, workflow_snapshot_id TEXT NOT NULL REFERENCES presales_workflow_snapshots(id),
  currency TEXT NOT NULL, subtotal_minor INTEGER NOT NULL, vat_basis_points INTEGER NOT NULL,
  vat_minor INTEGER NOT NULL, total_minor INTEGER NOT NULL, terms_json TEXT NOT NULL,
  source_summary_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'Draft', created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, approved_at TEXT, issued_at TEXT, superseded_at TEXT,
  UNIQUE(project_id,revision_number), UNIQUE(project_id,quotation_fingerprint)
);
CREATE INDEX IF NOT EXISTS project_quotation_status_idx ON project_quotation_revisions(project_id,status,revision_number);

CREATE TABLE IF NOT EXISTS project_quotation_decisions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  quotation_revision_id TEXT NOT NULL REFERENCES project_quotation_revisions(id), action TEXT NOT NULL,
  previous_status TEXT, next_status TEXT NOT NULL, reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL, actor_role TEXT NOT NULL, quotation_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS project_quotation_decisions_idx ON project_quotation_decisions(quotation_revision_id,created_at);

CREATE TABLE IF NOT EXISTS project_quotation_issues (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
  quotation_revision_id TEXT NOT NULL REFERENCES project_quotation_revisions(id),
  export_job_id TEXT REFERENCES excel_export_jobs(id), issue_reference TEXT NOT NULL,
  recipient TEXT, transmission_method TEXT, issued_by TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, notes TEXT,
  UNIQUE(quotation_revision_id)
);
CREATE INDEX IF NOT EXISTS project_quotation_issues_project_idx ON project_quotation_issues(project_id,issued_at);
