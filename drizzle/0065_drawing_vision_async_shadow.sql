-- Async Muse vision shadow path (slice 1).
--
-- Extends drawing_visual_runs into a lease-guarded async job row. The base
-- table shape mirrors the visual-runs migration; CREATE TABLE IF NOT EXISTS
-- keeps this safe whether or not that migration has landed.
-- New columns are strictly additive: no existing column is renamed, removed,
-- or redefined. Shadow runs never become current production authority (see
-- vision_generation + VISION_CURRENTNESS_RULE in drawing-vision-background.mjs).
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

-- Async job fields. Added one per statement so a partially-applied migration
-- can be resumed safely by re-running the file.
ALTER TABLE drawing_visual_runs ADD COLUMN fingerprint TEXT;
ALTER TABLE drawing_visual_runs ADD COLUMN vision_generation TEXT;
ALTER TABLE drawing_visual_runs ADD COLUMN model_config_version TEXT;
ALTER TABLE drawing_visual_runs ADD COLUMN lease_owner TEXT;
ALTER TABLE drawing_visual_runs ADD COLUMN lease_expires_at TEXT;
ALTER TABLE drawing_visual_runs ADD COLUMN attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE drawing_visual_runs ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 3;
ALTER TABLE drawing_visual_runs ADD COLUMN retryable INTEGER;
ALTER TABLE drawing_visual_runs ADD COLUMN cancel_requested INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS drawing_visual_fingerprint_idx ON drawing_visual_runs(fingerprint);
CREATE INDEX IF NOT EXISTS drawing_visual_lease_idx ON drawing_visual_runs(status, lease_expires_at);
