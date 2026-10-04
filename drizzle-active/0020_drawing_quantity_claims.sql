-- 0020_drawing_quantity_claims.sql
--
-- PHYSICAL DRAWING QUANTITY AUTHORITY -- governed persistence for the Al Mousa
-- drawing quantity claim model (app/domain/drawing-quantity-authority.mjs).
--
-- SCOPE, AND WHAT THIS TABLE DELIBERATELY HAS NO COLUMN FOR
-- This table stores PHYSICAL DEVICE QUANTITY only. It has no SLC resource column,
-- no address count, no detector/module pool, no panel allocation, no sizing, no
-- product and no price column. Those are downstream authorities (Agent 3+), and a
-- physical drawing count must never be able to masquerade as address demand. That
-- omission is the schema-level guarantee, not a convention.
--
-- IDENTITY (proved from the domain, NOT from the old handoff index)
-- The semantic identity of one current quantity claim is exactly:
--
--     (project_id, document_version_id, sheet, floor_or_area, device_class, device_variant)
--
-- Why each member is in:
--   project_id          every claim is project-bound (buildQuantityClaim refuses without it).
--   document_version_id currentness is defined by this equalling the document's CURRENT
--                       head, so it is the authority-bearing source identity.
--   sheet               one drawing PDF may carry several sheets; aggregateCoverage
--                       reads per sheet.
--   floor_or_area       PROVEN NECESSARY. derive-quantities.mjs emits one claim per
--                       (floor, class) inside ONE sheet: BOS "SMOKE DETECTOR" alone
--                       yields 6 claims (BASEMENT 01 2, GROUND FLOOR 128, LEVEL 01 126,
--                       LEVEL 02 116, LEVEL 03 113, ROOF 01 25) that are IDENTICAL on
--                       (project, document version, sheet, class, variant). Without
--                       floor_or_area in the identity those 6 collapse to one and the
--                       quantity is lost.
--   device_class        the governed semantic class.
--   device_variant      F STANDARD and F WEATHERPROOF are different devices sharing one
--                       printed code, so the variant is part of the identity.
--
-- Why `page` is NOT in the identity, though it IS in the authority fingerprint:
-- The two serve different purposes and must not be confused. The fingerprint is a
-- CONTENT-drift detector, so it includes page, parser_version and region -- any change
-- to the evidence must move it. The uniqueness tuple is a DOUBLE-COUNT guard, because
-- aggregateCoverage SUMS current claims. If page were part of the identity, a duplicate
-- claim re-read from a different page would be admitted and silently double-counted.
-- Excluding it fails closed instead: the duplicate is rejected and the human investigates.
--
-- NULL-SAFE CURRENT UNIQUENESS (the old handoff index was UNSAFE)
-- A plain partial UNIQUE index does NOT work here. SQLite treats NULLs as distinct in
-- a UNIQUE index, so two rows with sheet = NULL would both be admitted -- verified on
-- node:sqlite, which allowed exactly the duplicate the audit predicted. This migration
-- therefore uses an EXPRESSION index with COALESCE, which makes NULL compare equal to
-- NULL without writing a fabricated sentinel value into the data. Option B was chosen
-- over NOT-NULL sentinels precisely because a sentinel would turn "not stated" into a
-- lie that a reader could not distinguish from a real value.
--
-- VERSION / SUPERSESSION (project convention, from 0003 and the existing chain)
-- Claims are versioned and APPEND-ONLY: a correction inserts a NEW row carrying
-- previous_version_id and stamps superseded_at on the row it replaces. The original row
-- is never deleted or rewritten. Triggers below enforce that history cannot be edited
-- away, matching the review_decisions_immutable_* convention in 0003.
--
-- DERIVED, THEREFORE NOT PERSISTED
-- coverage_state is DERIVED from state by the domain (buildQuantityClaim maps
-- PROVEN -> Complete, CONFLICT -> Partial, UNRESOLVED -> Unresolved) and
-- aggregateCoverage recomputes the sheet-level coverage. Persisting it would create a
-- second source of truth that can silently disagree with `state`, so it is not a column.
-- Same reasoning for discrepancy.delta, which buildQuantityClaim derives from
-- printed_total and component_total rather than trusting a stored value.
--
-- source_asset_ids SERIALIZATION
-- Stored as a TEXT column holding a JSON ARRAY, read back with JSON.parse. The domain's
-- computeQuantityAuthorityFingerprint branches on Array.isArray and sorts, so anything
-- that does not round-trip to a real array would change the computed fingerprint and
-- make isFingerprintCurrent() report drift. Round-trip is asserted in the scratch
-- validation for this migration.

CREATE TABLE drawing_quantity_claims (
  id                    TEXT PRIMARY KEY,
  project_id            TEXT NOT NULL REFERENCES projects(id),
  document_id           TEXT REFERENCES documents(id),
  document_version_id   TEXT NOT NULL REFERENCES document_versions(id),
  sheet                 TEXT,
  page                  INTEGER,
  floor_or_area         TEXT,
  parser_version        TEXT,
  semantics_version     TEXT NOT NULL,
  device_class          TEXT NOT NULL,
  device_variant        TEXT NOT NULL,
  quantity_type         TEXT NOT NULL,
  quantity              INTEGER,
  count_method          TEXT NOT NULL,
  printed_total         INTEGER,
  component_total       INTEGER,
  discrepancy           TEXT,
  unresolved_reason     TEXT,
  source_region         TEXT,
  source_asset_ids      TEXT NOT NULL DEFAULT '[]',
  evidence_fingerprint  TEXT NOT NULL,
  state                 TEXT NOT NULL,
  authority_version     TEXT NOT NULL,
  review_status         TEXT NOT NULL DEFAULT 'Needs Review',
  reviewed_by           TEXT,
  reviewed_at           TEXT,
  review_reason         TEXT,
  version_number        INTEGER NOT NULL DEFAULT 1,
  previous_version_id   TEXT REFERENCES drawing_quantity_claims(id),
  superseded_at         TEXT,
  created_by            TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- NULL-SAFE single-current-claim guard. COALESCE makes two NULL sheets/areas collide
-- instead of both being admitted; the partial predicate scopes uniqueness to CURRENT
-- claims only, so superseded history is unconstrained and can hold any number of rows
-- for the same identity.
CREATE UNIQUE INDEX drawing_quantity_claims_current_identity_idx
  ON drawing_quantity_claims (
    project_id,
    document_version_id,
    COALESCE(sheet, ''),
    COALESCE(floor_or_area, ''),
    device_class,
    device_variant
  )
  WHERE superseded_at IS NULL;

-- Current-read support: the canonical reader filters by project and current head.
CREATE INDEX drawing_quantity_claims_project_head_idx
  ON drawing_quantity_claims (project_id, document_version_id)
  WHERE superseded_at IS NULL;

CREATE INDEX drawing_quantity_claims_class_idx
  ON drawing_quantity_claims (project_id, device_class, device_variant)
  WHERE superseded_at IS NULL;

-- Domain invariants the schema must not be able to violate.
-- An unresolved class is NULL, never 0. Zero is a measured claim that nothing exists,
-- and conflating the two would silently delete devices from a panel.
CREATE TRIGGER drawing_quantity_claims_state_guard
BEFORE INSERT ON drawing_quantity_claims
  WHEN NEW.state NOT IN ('PROVEN', 'CONFLICT', 'UNRESOLVED')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_STATE_INVALID');
END;

CREATE TRIGGER drawing_quantity_claims_variant_guard
BEFORE INSERT ON drawing_quantity_claims
  WHEN NEW.device_variant NOT IN ('STANDARD', 'WEATHERPROOF')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_VARIANT_INVALID');
END;

CREATE TRIGGER drawing_quantity_claims_count_method_guard
BEFORE INSERT ON drawing_quantity_claims
  WHEN NEW.count_method NOT IN ('COMPONENT_CELL_SUM', 'PRINTED_CELL', 'PRINTED_ROW_TOTAL')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_COUNT_METHOD_INVALID');
END;

CREATE TRIGGER drawing_quantity_claims_quantity_guard
BEFORE INSERT ON drawing_quantity_claims
  WHEN NEW.quantity IS NOT NULL AND NEW.quantity < 0
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_NEGATIVE');
END;

-- A governed class may not carry a quantity without a count method, and an UNRESOLVED
-- class may not carry a quantity at all. Both are refused by buildQuantityClaim; the
-- schema repeats them so a hand-written insert cannot bypass the domain.
CREATE TRIGGER drawing_quantity_claims_unresolved_quantity_guard
BEFORE INSERT ON drawing_quantity_claims
  WHEN NEW.state = 'UNRESOLVED' AND NEW.quantity IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_UNRESOLVED_MUST_BE_NULL');
END;

-- APPEND-ONLY HISTORY.
--
-- A quantity claim, once written, is evidence about a specific drawing revision, so
-- its identity, quantity and provenance must never be edited in place: doing so
-- would silently rewrite the record of what the drawings said.
--
-- The ONE permitted mutation is stamping superseded_at, because that is how a
-- correction is expressed: the corrected claim is INSERTED as a new row carrying
-- previous_version_id, and the row it replaces is retired. A blanket immutability
-- trigger is therefore wrong here -- scratch validation proved it blocks that very
-- supersession path -- and the guard below permits only the lifecycle stamp while
-- forbidding every field that constitutes the evidence. The COALESCE(NEW,'') <>
-- COALESCE(OLD,'') comparison style follows project_npq_confirmed_update_guard in
-- the 0000 baseline, so NULL and '' are treated alike rather than slipping through.
CREATE TRIGGER drawing_quantity_claims_supersede_only_update
BEFORE UPDATE ON drawing_quantity_claims
WHEN
     COALESCE(NEW.project_id,'')            <> COALESCE(OLD.project_id,'')
  OR COALESCE(NEW.document_id,'')           <> COALESCE(OLD.document_id,'')
  OR COALESCE(NEW.document_version_id,'')   <> COALESCE(OLD.document_version_id,'')
  OR COALESCE(NEW.sheet,'')                 <> COALESCE(OLD.sheet,'')
  OR COALESCE(NEW.page,'')                  <> COALESCE(OLD.page,'')
  OR COALESCE(NEW.floor_or_area,'')         <> COALESCE(OLD.floor_or_area,'')
  OR COALESCE(NEW.parser_version,'')        <> COALESCE(OLD.parser_version,'')
  OR COALESCE(NEW.semantics_version,'')     <> COALESCE(OLD.semantics_version,'')
  OR COALESCE(NEW.device_class,'')          <> COALESCE(OLD.device_class,'')
  OR COALESCE(NEW.device_variant,'')        <> COALESCE(OLD.device_variant,'')
  OR COALESCE(NEW.quantity_type,'')         <> COALESCE(OLD.quantity_type,'')
  OR COALESCE(NEW.quantity,'')              <> COALESCE(OLD.quantity,'')
  OR COALESCE(NEW.count_method,'')          <> COALESCE(OLD.count_method,'')
  OR COALESCE(NEW.printed_total,'')         <> COALESCE(OLD.printed_total,'')
  OR COALESCE(NEW.component_total,'')       <> COALESCE(OLD.component_total,'')
  OR COALESCE(NEW.discrepancy,'')           <> COALESCE(OLD.discrepancy,'')
  OR COALESCE(NEW.unresolved_reason,'')     <> COALESCE(OLD.unresolved_reason,'')
  OR COALESCE(NEW.source_region,'')         <> COALESCE(OLD.source_region,'')
  OR COALESCE(NEW.source_asset_ids,'')      <> COALESCE(OLD.source_asset_ids,'')
  OR COALESCE(NEW.evidence_fingerprint,'')  <> COALESCE(OLD.evidence_fingerprint,'')
  OR COALESCE(NEW.state,'')                 <> COALESCE(OLD.state,'')
  OR COALESCE(NEW.authority_version,'')     <> COALESCE(OLD.authority_version,'')
  OR COALESCE(NEW.review_status,'')         <> COALESCE(OLD.review_status,'')
  OR COALESCE(NEW.reviewed_by,'')           <> COALESCE(OLD.reviewed_by,'')
  OR COALESCE(NEW.reviewed_at,'')           <> COALESCE(OLD.reviewed_at,'')
  OR COALESCE(NEW.review_reason,'')         <> COALESCE(OLD.review_reason,'')
  OR NEW.version_number                     <> OLD.version_number
  OR COALESCE(NEW.previous_version_id,'')   <> COALESCE(OLD.previous_version_id,'')
  OR COALESCE(NEW.created_by,'')            <> COALESCE(OLD.created_by,'')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_CLAIMS_EVIDENCE_IMMUTABLE');
END;

-- superseded_at is one-way: once stamped, a claim can never be un-retired, or a
-- "current" claim could be resurrected after a correction.
CREATE TRIGGER drawing_quantity_claims_supersede_once
BEFORE UPDATE ON drawing_quantity_claims
WHEN OLD.superseded_at IS NOT NULL AND COALESCE(NEW.superseded_at,'') <> COALESCE(OLD.superseded_at,'')
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_CLAIMS_ALREADY_SUPERSEDED');
END;

-- History rows are never deleted, so the audit trail of what the drawings said at
-- each revision cannot be erased.
CREATE TRIGGER drawing_quantity_claims_immutable_delete
BEFORE DELETE ON drawing_quantity_claims
BEGIN
  SELECT RAISE(ABORT, 'DRAWING_QUANTITY_CLAIMS_APPEND_ONLY');
END;
