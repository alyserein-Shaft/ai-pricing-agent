-- GOVERNED PER-BUILDING MULTI-CLASS DRAWING FINGERPRINT
--
-- Alignment evidence for quantity block reconciliation: one row per
-- (project, building/scope, class, drawing version). This is EVIDENCE, never
-- quantity authority -- the table deliberately has NO device-quantity column, so
-- a consumer cannot read a device count out of it even by accident.
--
-- Additive only. It reads governed drawing authority (approved structure rows,
-- approved architecture applicability rows, governed drawing metadata) and
-- derives nothing from symbol-recognition tables.
CREATE TABLE IF NOT EXISTS drawing_building_class_fingerprints (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  building_id TEXT NOT NULL,
  governed_drawing_number TEXT NOT NULL,
  document_id TEXT NOT NULL,
  document_version_id TEXT NOT NULL,
  drawing_intake_version_id TEXT NOT NULL,
  legend_document_id TEXT,
  normalized_class TEXT,
  token TEXT NOT NULL,
  observed_value REAL,
  evidence_type TEXT NOT NULL,
  class_state TEXT NOT NULL,
  authority_status TEXT NOT NULL,
  authority_fact_id TEXT,
  source_asset_ids TEXT NOT NULL DEFAULT '[]',
  page_numbers TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  fingerprint TEXT NOT NULL,
  current_fingerprint TEXT NOT NULL,
  superseded_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_building_class_fingerprint_current_idx
  ON drawing_building_class_fingerprints (project_id, building_id, token, evidence_type)
  WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS drawing_building_class_fingerprint_project_idx
  ON drawing_building_class_fingerprints (project_id, building_id);
