-- STEP 14.8 -- DRAWING ARCHITECTURE EXCEPTION ADJUDICATION (governed).
--
-- Governed persistence surface for the architecture-exception adjudication
-- that closes Step 14.8 (Step 14.7 already established the review surface in
-- 0078 and approved-version promotion v1 = 116 governed rows; this migration
-- adds the ADJUDICATION surface that resolves 21 pending review cases ->
-- 12 UNIQUE architecture exceptions -> promotes approved v2 = 128 rows,
-- superseding v1 = 116).
--
-- Exactly TWO governed tables are added (authority count 308 -> 310):
--
--   1) drawing_architecture_exception_adjudications
--      ONE adjudication row per UNIQUE architecture exception (exception_key
--      unique). After Step 14.8 the real corpus converges to exactly 12 unique
--      exceptions: 9 CROSS_SHEET_REFERENCE groups (each grouped 1:1 with its
--      mirrored ARCHITECTURE_DISCREPANCY that shares the same source fragment
--      -> ONE unique exception) + 3 GENERIC_FACP_IDENTITY (BOS/GRS/WLC
--      T-93-ZZZ-005 FACP schematics, governed to the campus legend
--      2401232-PC-AMS-DR-T-00-ZZZ-002 ELV legend register).
--      Each row preserves:
--        * the RAW exception subject + source fragment verbatim,
--        * the decision STATE (CONFIRMED_PROJECT_REFERENCE /
--          CONFIRMED_SAME_PANEL / ENGINEER_REVIEW_REQUIRED) + reasons,
--        * the canonical target (register-resolved reference number OR the
--          building asset code identity for a generic FACP),
--        * evidence fingerprint + audit (created_by = system architecture
--          evaluation actor, created_at, superseded_at preserved, history
--          kept, never deleted, never re-asked twice).
--
--   2) drawing_architecture_stage4_readiness
--      Project-scoped governed readiness row used to drive ARCHITECTURE_STATUS
--      PARTIAL -> COMPLETE and STAGE4_READINESS PARTIAL_NOT_READY ->
--      READY_FOR_STAGE4_BRIDGE once adjudication deterministically resolves
--      the 12 unique exceptions with NO remaining engineer-review-required,
--      NO stale, and NO real (material) architecture conflict. Stage-4
--      BLOCKING semantics are scoped to materially unreliable panel identity /
--      topology / loop ownership / system boundary / interface constraints
--      (STAGE4_BLOCKING_CLASS); reference-format / citation-convention issues
--      are NONBLOCKING_DRAWING_REVIEW and never block Stage 4.
--
-- No technical approval, no commercial / pricing / engineering-knowledge /
-- topology / ontology surface is created here. Adjudication is DETERMINISTIC,
-- evidence-only, actor = system architecture evaluation actor, and every
-- exception is adjudicated EXACTLY ONCE and never asked of an engineer more
-- than once.

-- Governed exception-adjudication inventory (ONE row per unique exception).
CREATE TABLE IF NOT EXISTS drawing_architecture_exception_adjudications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  -- The normalized EXCEPTION_KEY for the unique exception this adjudication
  -- resolves. UNIQUE per project so the SAME exception is never adjudicated
  -- twice; re-runs supersede the prior adjudication (history kept).
  exception_key TEXT NOT NULL,
  -- Normalized inventory exception type. Values:
  --   CROSS_SHEET_REFERENCE       (the 9 real cross-sheet reference groups)
  --   GENERIC_FACP_IDENTITY       (the 3 generic FIRE ALARM CONTROL PANEL
  --                               identities on BOS/GRS/WLC T-93-ZZZ-005)
  -- Each UNIQUE exception is governed by normalizeExceptionInventory which
  -- groups the 21 pending review cases -> exactly 12 unique exceptions
  -- (9 CROSS_SHEET_REFERENCE each folding its mirrored ARCHITECTURE_DISCREPANCY
  -- 1:1 + 3 GENERIC_FACP_IDENTITY).
  exception_type TEXT NOT NULL,
  -- The RAW (unnormalized) exception identification as authored on the sheet,
  -- preserved verbatim (never "fixed").
  raw_subject TEXT NOT NULL,
  raw_relation TEXT,
  raw_object TEXT,
  -- Building / discipline identity derived from the source drawing number
  -- (governed by the domain's drawingNumber semantics).
  raw_drawing_number TEXT NOT NULL,
  building_code TEXT NOT NULL,
  source_drawing_number TEXT NOT NULL,
  source_drawing_name TEXT,
  -- ADJUDICATION DECISION (governed; decision states from the domain policy).
  decision_state TEXT NOT NULL, -- CONFIRMED_PROJECT_REFERENCE | CONFIRMED_SAME_PANEL | ENGINEER_REVIEW_REQUIRED
  decision_reasons TEXT NOT NULL DEFAULT '[]', -- JSON array of REFERENCE_ADJUDICATION_REASONS / FACP_IDENTITY_REASONS
  decision_policy_version TEXT NOT NULL,
  decision_actor TEXT NOT NULL,   -- system:architecture-evaluation-actor
  decision_fingerprint TEXT NOT NULL, -- evidence fingerprint of the decision
  -- Canonical registry target for a CROSS_SHEET_REFERENCE adjudication.
  canonical_target_drawing_number TEXT,
  canonical_target_document_id TEXT,
  canonical_target_drawing_number_raw TEXT, -- RAW DR-less number preserved verbatim
  -- Canonical building identity for a GENERIC_FACP_IDENTITY adjudication.
  canonical_building_asset_code TEXT,  -- BOS | GRS | WLC (never merged with WELCOME CENTER)
  canonical_building_name TEXT,        -- BOYS SCHOOL | GIRLS SCHOOL | WELCOME CENTER
  canonical_panel_identity TEXT,       -- governed token, e.g. 'FACP @BOS BUILDING'
  -- Stage-4 blocking classification (governed).
  stage4_blocking_class TEXT NOT NULL DEFAULT 'NONBLOCKING_DRAWING_REVIEW',
  -- Evidence anchors that grounded the decision (JSON).
  evidence_observations_count INTEGER,
  evidence_fingerprint TEXT,
  evidence_summary TEXT NOT NULL DEFAULT '{}',
  -- Audit / governed history.
  review_case_ids TEXT NOT NULL DEFAULT '[]', -- the review case id(s) this adjudication resolves
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  -- Describe how/when superseded (policy version or actor); preserved, never deleted.
  superseding_adjudication_id TEXT
);

-- ONE ACTIVE adjudication row per (project_id, exception_key): re-runs
-- supersede the active row (superseded_at set, history kept) and insert the
-- new decision row. The unique constraint is PARTIAL over active rows so the
-- superseded history can share the same exception_key.
CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_exception_adj_project_key_idx
  ON drawing_architecture_exception_adjudications (project_id, exception_key)
  WHERE superseded_at IS NULL;

CREATE INDEX IF NOT EXISTS drawing_architecture_exception_adj_project_type_idx
  ON drawing_architecture_exception_adjudications (project_id, exception_type);

CREATE INDEX IF NOT EXISTS drawing_architecture_exception_adj_source_idx
  ON drawing_architecture_exception_adjudications (source_drawing_number);

-- Governed Stage-4 readiness (project-scoped; ONE current readiness row per
-- project with superseded history kept).
CREATE TABLE IF NOT EXISTS drawing_architecture_stage4_readiness (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1,
  -- Governed architecture status values: PARTIAL | COMPLETE
  architecture_status TEXT NOT NULL,
  -- Governed Stage-4 readiness values: PARTIAL_NOT_READY | READY_FOR_STAGE4_BRIDGE
  stage4_readiness TEXT NOT NULL,
  stage4_blocking_class_summary TEXT NOT NULL DEFAULT 'NONBLOCKING_DRAWING_REVIEW',
  -- Counts that govern the readiness decision.
  unique_exception_count INTEGER NOT NULL DEFAULT 0,
  cross_sheet_reference_count INTEGER NOT NULL DEFAULT 0,
  generic_facp_count INTEGER NOT NULL DEFAULT 0,
  remaining_engineer_review_required INTEGER NOT NULL DEFAULT 0,
  remaining_confirm_project_reference INTEGER NOT NULL DEFAULT 0,
  remaining_confirm_same_panel INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  mirrored_discrepancy_resolved INTEGER NOT NULL DEFAULT 0,
  stale_count INTEGER NOT NULL DEFAULT 0,
  real_architecture_conflict_remaining INTEGER NOT NULL DEFAULT 0,
  -- Approved-version promotion facts that this readiness supports.
  approved_prior_row_count INTEGER NOT NULL DEFAULT 0,
  approved_next_row_count INTEGER NOT NULL,
  approved_next_version_number INTEGER NOT NULL,
  -- Governance / audit.
  policy_version TEXT NOT NULL,
  computed_by TEXT NOT NULL,   -- system:architecture-evaluation-actor
  evidence_fingerprint TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  superseding_readiness_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS drawing_architecture_stage4_readiness_project_version_idx
  ON drawing_architecture_stage4_readiness (project_id, version_number);

CREATE INDEX IF NOT EXISTS drawing_architecture_stage4_readiness_project_idx
  ON drawing_architecture_stage4_readiness (project_id);
