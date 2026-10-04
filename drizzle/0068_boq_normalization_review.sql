-- BOQ NORMALIZATION REVIEW + GOVERNED APPLY
--
-- The controlled normalized BOQ review was CLIENT-STATE ONLY: `applyKnownBoqExtraction`
-- wrote React state and nothing else, and browser persistence is disabled by the
-- Phase 4 decision (browser snapshots may not persist project truth). The accepted
-- result was therefore never durable, and canonical BOQ Understanding -- which
-- reads `boq_items` -- could not consume the governed 21-line scope at all.
--
-- Three layers are kept explicitly separate here:
--   A. RAW EXTRACTION EVIDENCE -- the 108 extraction rows / 90 BOQ item rows.
--      Untouched and immutable. Nothing in this migration alters them.
--   B. NORMALIZATION REVIEW    -- the candidate set + per-candidate human decisions.
--   C. GOVERNED DOWNSTREAM    -- materialised ONLY by a governed human Apply.
--
-- Authority is keyed by (project, document, document_version, extraction,
-- generation fingerprint) -- never by filename, browser state or upload order.

CREATE TABLE boq_normalization_reviews (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  source_document_id TEXT NOT NULL REFERENCES documents(id),
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  source_extraction_id TEXT NOT NULL REFERENCES boq_extraction_versions(id),
  -- SHA-256 of the controlled source workbook: the canonical content identity.
  source_sha256 TEXT NOT NULL,
  -- Fingerprint of the CONTROLLED CANDIDATE SET. If the controlled generation
  -- changes, the fingerprint changes, this review is no longer current, and an
  -- Apply against it fails closed instead of silently applying stale candidates.
  generation_fingerprint TEXT NOT NULL,
  generation_number INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','APPLIED','SUPERSEDED','STALE')),
  candidate_count INTEGER NOT NULL DEFAULT 0,
  -- Set only by a governed human Apply. Never by the AI reconciliation reasoner.
  applied_at TEXT,
  applied_by TEXT,
  applied_by_name TEXT,
  superseded_at TEXT,
  superseded_by_review_id TEXT REFERENCES boq_normalization_reviews(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX boq_normalization_review_generation_idx
  ON boq_normalization_reviews (project_id, source_document_id, source_document_version_id, source_extraction_id, generation_fingerprint);
CREATE INDEX boq_normalization_review_current_idx
  ON boq_normalization_reviews (project_id, status);

-- One row per normalized candidate. Deliberately carries NO system, NO category and
-- NO product family: classification belongs to BOQ Understanding and downstream, so a
-- normalized line starts semantically UNCLASSIFIED and nothing in this layer may
-- invent a technical meaning.
CREATE TABLE boq_normalization_candidates (
  id TEXT PRIMARY KEY,
  review_id TEXT NOT NULL REFERENCES boq_normalization_reviews(id),
  project_id TEXT NOT NULL REFERENCES projects(id),
  ordinal INTEGER NOT NULL,
  normalized_description TEXT NOT NULL,
  normalized_unit TEXT,
  -- The governed consolidated quantity, derived from the contributing source rows.
  normalized_quantity REAL NOT NULL,
  decision TEXT NOT NULL DEFAULT 'Pending'
    CHECK (decision IN ('Pending','Accepted','Excluded')),
  exclusion_reason TEXT,
  decided_by TEXT,
  decided_by_name TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX boq_normalization_candidate_ordinal_idx
  ON boq_normalization_candidates (review_id, ordinal);

-- CANONICAL candidate <-> source-row relation. Provenance is a real relation, never a
-- comma-separated display string, so "which exact source rows contributed to this
-- line?" is answerable by a join. A source row MAY legitimately appear under more
-- than one candidate only if the model says so; nothing here infers or collapses it.
CREATE TABLE boq_normalization_candidate_sources (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES boq_normalization_candidates(id),
  review_id TEXT NOT NULL REFERENCES boq_normalization_reviews(id),
  source_boq_item_id TEXT NOT NULL REFERENCES boq_items(id),
  source_row INTEGER NOT NULL,
  source_description TEXT,
  source_unit TEXT,
  source_quantity REAL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX boq_normalization_candidate_source_idx
  ON boq_normalization_candidate_sources (candidate_id, source_boq_item_id);
CREATE INDEX boq_normalization_candidate_source_review_idx
  ON boq_normalization_candidate_sources (review_id, source_boq_item_id);

-- Governed Apply writes the accepted candidates into a dedicated
-- `boq_normalization_scope` table rather than mutating the raw `boq_items`
-- extraction population, so the raw evidence stays immutable and the two
-- populations can never be silently mixed by a reader.
CREATE TABLE boq_normalization_scope (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  review_id TEXT NOT NULL REFERENCES boq_normalization_reviews(id),
  candidate_id TEXT NOT NULL REFERENCES boq_normalization_candidates(id),
  source_document_id TEXT NOT NULL REFERENCES documents(id),
  source_document_version_id TEXT NOT NULL REFERENCES document_versions(id),
  source_extraction_id TEXT NOT NULL REFERENCES boq_extraction_versions(id),
  generation_number INTEGER NOT NULL,
  normalized_description TEXT NOT NULL,
  normalized_unit TEXT,
  normalized_quantity REAL NOT NULL,
  applied_by TEXT NOT NULL,
  applied_by_name TEXT,
  applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  superseded_by_review_id TEXT REFERENCES boq_normalization_reviews(id)
);
CREATE UNIQUE INDEX boq_normalization_scope_candidate_idx
  ON boq_normalization_scope (project_id, candidate_id, review_id);
CREATE INDEX boq_normalization_scope_current_idx
  ON boq_normalization_scope (project_id, superseded_at);

-- Audit of every governed transition in this subsystem. Decisions and Apply are
-- human-authority mutations and are recorded under the server-configured R1 human
-- identity (CONV-2026-10-01-3e17), never the synthetic development user.
CREATE TABLE boq_normalization_decisions_log (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  review_id TEXT NOT NULL REFERENCES boq_normalization_reviews(id),
  candidate_id TEXT,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT,
  actor_id TEXT NOT NULL,
  actor_name TEXT,
  actor_role TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX boq_normalization_decisions_log_review_idx
  ON boq_normalization_decisions_log (review_id, created_at);

-- Immutability: a candidate's normalized DESCRIPTION / UNIT / QUANTITY may be
-- superseded by a NEW generation (a new review row), never edited in place, so a
-- governed Apply can always be re-derived from immutable history.
CREATE TRIGGER boq_normalization_candidate_identity_immutable
BEFORE UPDATE OF normalized_description, normalized_unit, normalized_quantity ON boq_normalization_candidates
FOR EACH ROW WHEN
  OLD.normalized_description IS NOT NEW.normalized_description
  OR OLD.normalized_unit IS NOT NEW.normalized_unit
  OR OLD.normalized_quantity IS NOT NEW.normalized_quantity
BEGIN
  SELECT RAISE(ABORT, 'BOQ_NORMALIZATION_CANDIDATE_IDENTITY_IMMUTABLE');
END;
