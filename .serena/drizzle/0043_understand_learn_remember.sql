-- Explicit, inspectable stages for completed-project learning.
CREATE TABLE IF NOT EXISTS pricing_learning_stage_results (
 id TEXT PRIMARY KEY,
 organization_id TEXT NOT NULL,
 learning_run_id TEXT NOT NULL REFERENCES pricing_learning_runs(id),
 project_id TEXT NOT NULL,
 stage TEXT NOT NULL CHECK(stage IN ('Understand','Learn','Remember')),
 stage_order INTEGER NOT NULL,
 status TEXT NOT NULL,
 result TEXT NOT NULL,
 safety_boundary TEXT NOT NULL,
 input_fingerprint TEXT NOT NULL,
 engine_version TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(learning_run_id,stage)
);
CREATE INDEX IF NOT EXISTS pricing_learning_stage_project_idx ON pricing_learning_stage_results(organization_id,project_id,stage_order);
