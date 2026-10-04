-- Slice 5: immutable line-level snapshot contract for quotation revisions.
-- Commercial calculations remain owned by canonical pricing authority.
-- This table records exactly what each quotation revision quoted.

CREATE TABLE IF NOT EXISTS project_quotation_lines (
  id TEXT PRIMARY KEY,

  quotation_revision_id TEXT NOT NULL
    REFERENCES project_quotation_revisions(id),

  project_id TEXT NOT NULL
    REFERENCES projects(id),

  boq_item_id TEXT NOT NULL
    REFERENCES boq_items(id),

  sequence INTEGER NOT NULL,
  item_number TEXT,
  description TEXT,
  unit TEXT NOT NULL,
  quantity TEXT NOT NULL,

  candidate_id TEXT NOT NULL
    REFERENCES product_match_candidates(id),

  product_id TEXT NOT NULL
    REFERENCES library_products(id),

  manufacturer_name TEXT NOT NULL,
  part_number TEXT NOT NULL,
  product_description TEXT NOT NULL,

  pricing_run_id TEXT NOT NULL
    REFERENCES pricing_runs(id),

  pricing_run_version INTEGER NOT NULL,

  pricing_line_id TEXT NOT NULL
    REFERENCES pricing_lines(id),

  pricing_line_version INTEGER NOT NULL,
  pricing_input_fingerprint TEXT NOT NULL,

  commercial_approval_id TEXT NOT NULL
    REFERENCES pricing_approvals(id),

  commercial_approval_version INTEGER NOT NULL,

  currency TEXT NOT NULL,

  total_cost_minor INTEGER NOT NULL,
  net_selling_minor INTEGER NOT NULL,

  source_snapshot_json TEXT NOT NULL,

  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE(quotation_revision_id, boq_item_id)
);

CREATE INDEX IF NOT EXISTS quotation_lines_revision_idx
  ON project_quotation_lines(quotation_revision_id, sequence);

CREATE INDEX IF NOT EXISTS quotation_lines_project_idx
  ON project_quotation_lines(project_id, quotation_revision_id);

CREATE INDEX IF NOT EXISTS quotation_lines_pricing_idx
  ON project_quotation_lines(pricing_run_id, pricing_line_id);

CREATE INDEX IF NOT EXISTS quotation_lines_product_idx
  ON project_quotation_lines(product_id);

-- Quotation line snapshots are historical records.
-- Corrections require a new quotation revision; existing snapshots cannot
-- be edited or deleted in place.

CREATE TRIGGER IF NOT EXISTS quotation_line_snapshot_update_guard
BEFORE UPDATE ON project_quotation_lines
BEGIN
  SELECT RAISE(ABORT, 'QUOTATION_LINE_SNAPSHOT_IMMUTABLE');
END;

CREATE TRIGGER IF NOT EXISTS quotation_line_snapshot_delete_guard
BEFORE DELETE ON project_quotation_lines
BEGIN
  SELECT RAISE(ABORT, 'QUOTATION_LINE_SNAPSHOT_IMMUTABLE');
END;
