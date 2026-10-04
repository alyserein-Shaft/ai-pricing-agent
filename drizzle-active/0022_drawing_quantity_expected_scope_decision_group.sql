-- 0022_drawing_quantity_expected_scope_decision_group.sql
--
-- MUTUAL EXCLUSION FOR COMPETING CANDIDATE LOCATION SHEETS.
--
-- WHY THIS MIGRATION EXISTS
-- Every Fireman Telephone location currently has TWO candidate drawings (for
-- example `2401232-PC-BOS-DR-T-93-ZZZ-005.pdf` and
-- `2401232-PC-BOS-DR-T-94-ZZZ-001.pdf`), and the human decision is "choose the
-- canonical location sheet". They are MUTUALLY EXCLUSIVE for one location.
--
-- PROVEN DEFECT, not a hypothetical: with 0021 as shipped, both candidates of a
-- single location could each be approved and both become CURRENT Approved
-- expected-scope authority, because 0021's partial unique index is keyed on the
-- candidate's own identity (project, class, document_id, sheet). Measured
-- in-memory: approving both produced
--   approvedExpectedLocations = [ '...-93-ZZZ-005.pdf', '...-94-ZZZ-001.pdf' ]
-- i.e. one physical location carrying TWO independent quantity obligations,
-- which would double-count that location in any project aggregate. That is the
-- exact failure mode the expected-scope authority exists to prevent, so it is a
-- genuine safety defect rather than a modelling preference.
--
-- WHAT THIS ADDS (and nothing else)
-- One nullable grouping column plus one partial unique index. `decision_group`
-- is a MUTUAL-EXCLUSION KEY, NOT A LOCATION IDENTITY: it never becomes the
-- canonical `sheet`, which is still derived from `documents.logical_name`. A NULL
-- group means "no mutual exclusion declared" and preserves 0021's behaviour
-- exactly, so nothing existing changes meaning.
--
-- The index admits at most one CURRENT Approved row per
-- (project, device class, decision group). Superseded history is unconstrained,
-- and Needs Review / Rejected rows are unconstrained -- so both candidates may
-- still be PROPOSED and compared, which is the whole point of the review.

ALTER TABLE drawing_quantity_expected_scope ADD COLUMN decision_group TEXT;

-- The mutual-exclusion guard. COALESCE keeps a NULL group out of the key, and
-- the `decision_group IS NOT NULL` predicate means rows that declared no group
-- are unaffected by this index entirely.
CREATE UNIQUE INDEX drawing_quantity_expected_scope_decision_group_idx
  ON drawing_quantity_expected_scope (
    project_id,
    device_class,
    COALESCE(decision_group, '')
  )
  WHERE superseded_at IS NULL
    AND review_status = 'Approved'
    AND decision_group IS NOT NULL;