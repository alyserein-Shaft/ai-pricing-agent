-- GENERAL DRAWING EXTRACTION -- governed persistence (WORKSTREAM 5/6).
--
-- Proposals from app/domain/drawing-general-extraction-engine.mjs were
-- previously a client-side-only read-model (recomputed on every render,
-- never persisted, never reviewable). This migration adds the smallest
-- safe persistence layer: proposals are stored WITH their computed
-- governance (authority_role/governed_status/hard_review_reasons -- the
-- SYSTEM's own reference computation, from drawing-evidence-authority-
-- policy.mjs) kept separate from review_status (the ENGINEER's actual
-- decision, defaulting to governed_status until an engineer acts). This is
-- explicitly NOT an approved-engineering-objects table -- it never feeds
-- Product Matching or Pricing; it exists purely so a proposal and its
-- review trail survive a page reload and are auditable.
--
-- proposal_key is a stable, deterministic string derived from the
-- proposal's own content (e.g. "schedule:1:11", "callout:<assetId>") --
-- rerunning the (deterministic) engine against the same intake version
-- reproduces the same key, so persistence is an idempotent upsert, never a
-- growing pile of duplicate rows across reruns.
CREATE TABLE IF NOT EXISTS drawing_extraction_proposals (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  intake_version_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  proposal_key TEXT NOT NULL,
  proposal_type TEXT NOT NULL,
  raw_label TEXT,
  normalized_value TEXT,
  bounding_box TEXT,
  confidence INTEGER,
  authority_role TEXT NOT NULL,
  governed_status TEXT NOT NULL,
  hard_review_reasons TEXT NOT NULL,
  evidence TEXT NOT NULL,
  source_references TEXT NOT NULL,
  extraction_method TEXT NOT NULL,
  extraction_version TEXT NOT NULL,
  review_status TEXT NOT NULL,
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_reason TEXT,
  corrected_value TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (document_id) REFERENCES documents(id),
  FOREIGN KEY (intake_version_id) REFERENCES drawing_intake_versions(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS drawing_extraction_proposal_key_idx ON drawing_extraction_proposals (intake_version_id, proposal_key);
CREATE INDEX IF NOT EXISTS drawing_extraction_proposal_document_idx ON drawing_extraction_proposals (document_id, page_number);
CREATE INDEX IF NOT EXISTS drawing_extraction_proposal_status_idx ON drawing_extraction_proposals (document_id, review_status);

-- Same shape as every other drawing review's audit table
-- (drawing_symbol_review_events, drawing_structure_review_events) --
-- actor/reason/old-value/new-value/timestamp per action, nothing bespoke.
CREATE TABLE IF NOT EXISTS drawing_extraction_review_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  proposal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (proposal_id) REFERENCES drawing_extraction_proposals(id)
);
CREATE INDEX IF NOT EXISTS drawing_extraction_review_event_idx ON drawing_extraction_review_events (proposal_id, created_at);
