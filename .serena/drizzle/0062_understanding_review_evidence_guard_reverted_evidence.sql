-- Fire Alarm E2E fix (evidence/config-aware pilot fairness, follow-up) --
-- real Central Kitchen - Makkah gap: estimator_understanding_review_current_evidence_guard
-- required the interpretation being approved to be the boq item's absolute
-- latest attempt by version_number, full stop. That is stricter than the
-- staleness question it exists to answer: whether the interpretation being
-- approved reflects CURRENT evidence. When a project's evidence/requirement-
-- link state changes and then correctly REVERTS (e.g. a system-wide
-- requirement link confirmed, then superseded once found to be mis-scoped),
-- the item's current input_fingerprint reverts to a value an EARLIER,
-- no-longer-latest attempt already recorded -- and that earlier attempt IS
-- the one genuinely reflecting current evidence; the later, higher-version
-- attempt reflects evidence that no longer applies. The old trigger blocked
-- approving the correct (earlier) one forever, because a newer row existed
-- at all -- regardless of what that newer row's own fingerprint was.
--
-- This narrows the guard to what it actually needs to protect: it now only
-- blocks approving an interpretation when a NEWER interpretation exists for
-- the SAME item AT THE SAME input_fingerprint (a genuinely superseded
-- attempt at the identical evidence state -- e.g. a re-run under an updated
-- engine/prompt version, where the newer one should govern). A newer
-- attempt made under a DIFFERENT (since-reverted) evidence state no longer
-- blocks approval of an older attempt that matches the CURRENT state. This
-- mirrors resolveEffectiveUnderstandingInterpretation's own, already-trusted
-- application-layer definition of "current" (worker/effective-understanding-interpretation.mjs)
-- -- it closes the gap between the DB guard and the app's own logic, it does
-- not introduce any new leniency beyond what every other part of the review
-- system already treats as safe, current truth.
DROP TRIGGER estimator_understanding_review_current_evidence_guard;

CREATE TRIGGER estimator_understanding_review_current_evidence_guard
BEFORE INSERT ON estimator_understanding_review_versions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM boq_items b
    JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.document_id=b.source_document_id
    JOIN documents d ON d.id=e.document_id AND d.project_id=b.project_id AND d.deleted_at IS NULL AND d.archived_at IS NULL
    JOIN document_versions dv ON dv.id=e.document_version_id AND dv.document_id=d.id AND d.current_version_id=dv.id
    JOIN estimator_item_interpretations i ON i.id=NEW.interpretation_id AND i.boq_item_id=b.id AND i.input_fingerprint=NEW.source_input_fingerprint
    WHERE b.id=NEW.boq_item_id
      AND b.project_id=NEW.project_id
      AND b.row_type IN ('Item','BOQ Item')
      AND e.document_version_id=NEW.source_document_version_id
      AND e.version_number=NEW.source_extraction_version
      AND e.superseded_at IS NULL
      AND e.status IN ('Completed','Needs Review')
      AND NOT EXISTS (SELECT 1 FROM boq_extraction_versions newer WHERE newer.document_id=e.document_id AND newer.document_version_id=e.document_version_id AND newer.superseded_at IS NULL AND newer.status IN ('Completed','Needs Review') AND (newer.version_number>e.version_number OR (newer.version_number=e.version_number AND newer.id>e.id)))
      AND NOT EXISTS (SELECT 1 FROM estimator_item_interpretations newer_i WHERE newer_i.boq_item_id=i.boq_item_id AND newer_i.version_number>i.version_number AND newer_i.input_fingerprint=i.input_fingerprint)
  ) THEN RAISE(ABORT, 'understanding review evidence is stale') END;
END;
