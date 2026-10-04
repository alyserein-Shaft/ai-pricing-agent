-- Immutable visual-analysis attempts. Review decisions remain on the existing proposals.
CREATE TABLE IF NOT EXISTS drawing_visual_runs (
 id TEXT PRIMARY KEY,
 project_id TEXT NOT NULL,
 document_id TEXT NOT NULL,
 document_version_id TEXT NOT NULL,
 intake_version_id TEXT NOT NULL,
 page_number INTEGER NOT NULL,
 status TEXT NOT NULL,
 input_manifest TEXT NOT NULL,
 model_info TEXT NOT NULL DEFAULT '{}',
 raw_responses TEXT NOT NULL DEFAULT '[]',
 result TEXT,
 error_code TEXT,
 created_at TEXT NOT NULL,
 completed_at TEXT,
 superseded_at TEXT,
 FOREIGN KEY(document_id) REFERENCES documents(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_visual_running_idx ON drawing_visual_runs(intake_version_id,page_number) WHERE status='Running';
CREATE INDEX IF NOT EXISTS drawing_visual_document_idx ON drawing_visual_runs(document_id,created_at);
ALTER TABLE drawing_extraction_proposals ADD COLUMN visual_run_id TEXT;
ALTER TABLE drawing_extraction_proposals ADD COLUMN superseded_at TEXT;
ALTER TABLE drawing_extraction_proposals ADD COLUMN superseded_by_run_id TEXT;
ALTER TABLE drawing_extraction_proposals ADD COLUMN history_warning TEXT;
