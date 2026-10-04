-- 0021_drawing_quantity_expected_scope.sql
--
-- GOVERNED EXPECTED DRAWING QUANTITY SCOPE AUTHORITY
--
-- WHY THIS TABLE EXISTS
-- app/domain/drawing-quantity-project-scope.mjs (added by the project-scope
-- completeness slice) answers "is every expected location governed?", and it
-- fails closed with UNKNOWN_SCOPE because it has no governed expected-scope
-- source. That source had to exist somewhere WITHOUT being inferred from the
-- quantity claims themselves: inferring expected scope from observed claims
-- makes a missing location invisible by construction, which is the exact defect
-- the completeness resolver was built to close.
--
-- Every candidate reuse was tested and rejected (recorded in .lore):
--   document_assertions        no project_id, no actor, no supersession
--   review_decisions           event log on review_queue_items; location+class
--                              would live in free-text `scope`
--   governed_identity_decisions product-identity merges only
--   drawing_architecture_approved_rows  `object` is free TEXT with no FK to
--                              documents, so it cannot carry the canonical
--                              location identity 0020 requires
--
-- WHAT THIS TABLE DELIBERATELY HAS NO COLUMN FOR
-- It stores EXPECTED SCOPE ONLY. There is no quantity column, no count, no
-- total, no recognition count and no link to BOQ. "WLC is expected to carry
-- Fireman Telephone quantity" is an obligation about a location; it is NOT a
-- statement that any number of devices exists there. Authorising a quantity is
-- the separate business of drawing_quantity_claims (0020), and nothing here can
-- influence it. Expected location != quantity, and the schema -- not a
-- convention -- is what guarantees it.
--
-- CANONICAL LOCATION IDENTITY
-- Bound to the SAME identity the quantity claim domain uses, so the registry is
-- directly comparable with claims and no fuzzy matching is ever required:
--   document_id / document_version_id  FKs (governed drawing + revision)
--   sheet                              the exact 0020 `sheet` key
-- `display_label` is a human-readable convenience and is NOT authority. Aliases,
-- AI-normalised names and reviewer-typed free text are explicitly not a way to
-- satisfy an expected location.
--
-- SCOPE GRAIN
-- project + governed device/legend class + canonical location. `device_variant`
-- is NULLABLE and NULL means "all variants of this class", so the default grain
-- is class-level and a variant may narrow it later. T is therefore separable
-- from every other device class; no location is globally quantity-obliged.
--
-- GOVERNANCE -- APPEND-ONLY, ONE NEW VERSION PER DECISION
-- A scope row is immutable once written. The ONE permitted mutation is stamping
-- superseded_at, because that is how a decision is expressed: the decided row is
-- INSERTED as a new version carrying previous_version_id, and the row it
-- replaces is retired. So approving or rejecting never edits history, and the
-- full proposal -> decision trail survives. A row is CURRENT when
-- superseded_at IS NULL.
--
-- ONLY A CURRENT `Approved` ROW IS AUTHORITY. A `Needs Review` proposal is a
-- proposal; a `Rejected` row is a refusal. Neither satisfies expected scope.
-- The vocabulary is the existing project decision vocabulary
-- ('Needs Review' / 'Approved' / 'Rejected') already used by 0020's
-- review_status, not a new parallel review language.

CREATE TABLE drawing_quantity_expected_scope (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  -- Canonical location identity, shared with drawing_quantity_claims (0020).
  document_id           TEXT NOT NULL REFERENCES documents(id),
  document_version_id   TEXT NOT NULL REFERENCES document_versions(id),
  sheet                 TEXT NOT NULL,
  floor_or_area         TEXT,
  -- Governed quantity grain.
  device_class          TEXT NOT NULL,
  -- NULL means every variant of the class.
  device_variant        TEXT,
  -- Human-readable only. NEVER authority.
  display_label         TEXT,
  -- Why this location was proposed to owe quantity, and on what evidence.
  proposed_reason       TEXT NOT NULL,
  provenance            TEXT NOT NULL DEFAULT '{}',
  authority_version     TEXT NOT NULL,
  -- 'Needs Review' | 'Approved' | 'Rejected'
  review_status         TEXT NOT NULL DEFAULT 'Needs Review',
  reviewed_by           TEXT,
  reviewed_at           TEXT,
  review_reason         TEXT,
  version_number        INTEGER NOT NULL DEFAULT 1,
  previous_version_id   TEXT REFERENCES drawing_quantity_expected_scope(id),
  superseded_at         TEXT,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NULL-SAFE single-current-scope guard, in the same style as
-- drawing_quantity_claims_current_identity_idx. COALESCE makes two NULL
-- variants/areas collide instead of both being admitted; the partial predicate
-- scopes uniqueness to CURRENT rows only, so superseded history is unconstrained.
-- This is what makes a duplicate current Approved scope identity impossible, so
-- one expected location can never be double-counted as two obligations.
CREATE UNIQUE INDEX drawing_quantity_expected_scope_current_identity_idx
  ON drawing_quantity_expected_scope (
    project_id,
    device_class,
    COALESCE(device_variant, ''),
    document_id,
    COALESCE(sheet, ''),
    COALESCE(floor_or_area, '')
  )
  WHERE superseded_at IS NULL;

-- Current-read support: the resolver filters by project and current head.
CREATE INDEX drawing_quantity_expected_scope_project_head_idx
  ON drawing_quantity_expected_scope (project_id, document_version_id)
  WHERE superseded_at IS NULL;

CREATE INDEX drawing_quantity_expected_scope_class_idx
  ON drawing_quantity_expected_scope (project_id, device_class, device_variant)
  WHERE superseded_at IS NULL;

-- Immutable decision audit. One row per proposal/review action, carrying
-- previous -> new status, a substantive reason, the real actor and the request id,
-- following the same convention as drawing_extraction_review_events and
-- drawing_architecture_review_events.
CREATE TABLE drawing_quantity_expected_scope_events (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  scope_id              TEXT NOT NULL REFERENCES drawing_quantity_expected_scope(id),
  action                TEXT NOT NULL,
  previous_status       TEXT,
  new_status            TEXT NOT NULL,
  reason                TEXT NOT NULL,
  actor_user_id         TEXT NOT NULL,
  request_id            TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX drawing_quantity_expected_scope_events_scope_idx
  ON drawing_quantity_expected_scope_events (scope_id, created_at);

-- A scope decision carries no authority vocabulary of its own.
CREATE TRIGGER drawing_quantity_expected_scope_review_status_guard
BEFORE INSERT ON drawing_quantity_expected_scope
WHEN NEW.review_status NOT IN ('Needs Review', 'Approved', 'Rejected')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_SCOPE_REVIEW_STATUS_INVALID');
END;

-- Only the existing decision vocabulary; no quantity may ever be asserted here.
CREATE TRIGGER drawing_quantity_expected_scope_no_quantity_guard
BEFORE INSERT ON drawing_quantity_expected_scope
WHEN NEW.sheet IS NULL OR COALESCE(TRIM(NEW.sheet), '') = ''
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_SCOPE_SHEET_REQUIRED');
END;

-- An Approved scope row must record WHO decided it and WHY. This is the schema
-- half of the human-review gate: a scope authority row can never exist without a
-- real reviewer, a timestamp and a substantive reason.
CREATE TRIGGER drawing_quantity_expected_scope_approval_attribution_guard
BEFORE INSERT ON drawing_quantity_expected_scope
WHEN NEW.review_status = 'Approved'
 AND (COALESCE(NEW.reviewed_by, '') = ''
   OR COALESCE(NEW.reviewed_at, '') = ''
   OR COALESCE(TRIM(NEW.review_reason), '') = '')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_SCOPE_APPROVAL_ATTRIBUTION_REQUIRED');
END;

-- APPEND-ONLY HISTORY. A scope decision, once written, must never be edited in
-- place: the identity, the governed class, the canonical location and the review
-- verdict are all evidence about a specific decision at a specific drawing
-- revision. The ONLY permitted mutation is stamping superseded_at, which is how a
-- correction or reversal is expressed by inserting the next version.
CREATE TRIGGER drawing_quantity_expected_scope_supersede_only_update
BEFORE UPDATE ON drawing_quantity_expected_scope
WHEN
     COALESCE(NEW.project_id,'')            <> COALESCE(OLD.project_id,'')
  OR COALESCE(NEW.document_id,'')           <> COALESCE(OLD.document_id,'')
  OR COALESCE(NEW.document_version_id,'')   <> COALESCE(OLD.document_version_id,'')
  OR COALESCE(NEW.sheet,'')                 <> COALESCE(OLD.sheet,'')
  OR COALESCE(NEW.floor_or_area,'')         <> COALESCE(OLD.floor_or_area,'')
  OR COALESCE(NEW.device_class,'')          <> COALESCE(OLD.device_class,'')
  OR COALESCE(NEW.device_variant,'')        <> COALESCE(OLD.device_variant,'')
  OR COALESCE(NEW.display_label,'')         <> COALESCE(OLD.display_label,'')
  OR COALESCE(NEW.proposed_reason,'')       <> COALESCE(OLD.proposed_reason,'')
  OR COALESCE(NEW.provenance,'')            <> COALESCE(OLD.provenance,'')
  OR COALESCE(NEW.authority_version,'')     <> COALESCE(OLD.authority_version,'')
  OR COALESCE(NEW.review_status,'')         <> COALESCE(OLD.review_status,'')
  OR COALESCE(NEW.reviewed_by,'')           <> COALESCE(OLD.reviewed_by,'')
  OR COALESCE(NEW.reviewed_at,'')           <> COALESCE(OLD.reviewed_at,'')
  OR COALESCE(NEW.review_reason,'')         <> COALESCE(OLD.review_reason,'')
  OR NEW.version_number                     <> OLD.version_number
  OR COALESCE(NEW.previous_version_id,'')   <> COALESCE(OLD.previous_version_id,'')
  OR COALESCE(NEW.created_by,'')            <> COALESCE(OLD.created_by,'')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_SCOPE_EVIDENCE_IMMUTABLE');
END;

-- superseded_at is one-way: a retired scope decision can never be resurrected.
CREATE TRIGGER drawing_quantity_expected_scope_supersede_once
BEFORE UPDATE ON drawing_quantity_expected_scope
WHEN OLD.superseded_at IS NOT NULL AND COALESCE(NEW.superseded_at,'') <> COALESCE(OLD.superseded_at,'')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_SCOPE_ALREADY_SUPERSEDED');
END;

-- History is never deleted, so the trail of what was proposed, decided and
-- reversed cannot be erased.
CREATE TRIGGER drawing_quantity_expected_scope_immutable_delete
BEFORE DELETE ON drawing_quantity_expected_scope
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_SCOPE_APPEND_ONLY');
END;

-- The decision audit is itself append-only.
CREATE TRIGGER drawing_quantity_expected_scope_events_immutable_delete
BEFORE DELETE ON drawing_quantity_expected_scope_events
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_SCOPE_EVENTS_APPEND_ONLY');
END;