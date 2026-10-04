-- Phase 5A: exact quotation evidence, export binding and guarded lifecycle transitions.
ALTER TABLE project_quotation_revisions ADD COLUMN evidence_fingerprint TEXT;
ALTER TABLE project_quotation_revisions ADD COLUMN evidence_manifest_json TEXT;
ALTER TABLE project_quotation_revisions ADD COLUMN terms_provenance_json TEXT;

ALTER TABLE excel_export_jobs ADD COLUMN quotation_revision_id TEXT REFERENCES project_quotation_revisions(id);
ALTER TABLE excel_export_jobs ADD COLUMN quotation_fingerprint TEXT;
ALTER TABLE excel_export_jobs ADD COLUMN evidence_fingerprint TEXT;

CREATE INDEX IF NOT EXISTS quotation_evidence_fingerprint_idx ON project_quotation_revisions(project_id,evidence_fingerprint,status);
CREATE INDEX IF NOT EXISTS export_quotation_binding_idx ON excel_export_jobs(quotation_revision_id,quotation_fingerprint,evidence_fingerprint);
CREATE UNIQUE INDEX IF NOT EXISTS quotation_single_approval_decision_idx ON project_quotation_decisions(quotation_revision_id,action) WHERE action='Approve';
CREATE UNIQUE INDEX IF NOT EXISTS quotation_single_issue_idx ON project_quotation_issues(quotation_revision_id);

CREATE TRIGGER IF NOT EXISTS quotation_approval_transition_guard
BEFORE INSERT ON project_quotation_decisions WHEN NEW.action='Approve'
BEGIN
  SELECT CASE WHEN COALESCE((SELECT status FROM project_quotation_revisions WHERE id=NEW.quotation_revision_id),'Missing')<>'Draft'
    THEN RAISE(ABORT,'QUOTATION_APPROVAL_STALE') END;
END;

CREATE TRIGGER IF NOT EXISTS quotation_issue_transition_guard
BEFORE INSERT ON project_quotation_issues
BEGIN
  SELECT CASE WHEN COALESCE((SELECT status FROM project_quotation_revisions WHERE id=NEW.quotation_revision_id),'Missing')<>'Approved'
    THEN RAISE(ABORT,'QUOTATION_ISSUE_STALE') END;
END;
