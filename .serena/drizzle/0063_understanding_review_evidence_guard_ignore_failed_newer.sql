-- Fire Alarm E2E fix (evidence/config-aware pilot fairness, follow-up 2) --
-- real Central Kitchen - Makkah gap: migration 0062 narrowed the evidence
-- guard to only block approval when a NEWER interpretation exists at the
-- SAME input_fingerprint -- but did not check that newer attempt's own
-- status. A newer attempt that itself FAILED (e.g. AI_OUTPUT_INVALID_SCHEMA)
-- was never a valid, approvable interpretation to begin with -- it cannot
-- "supersede" an earlier, genuinely successful (COMPLETED/NEEDS_REVIEW)
-- attempt at the same evidence. Without this, a transient model failure
-- recorded after a real one (both sharing the same fingerprint, since
-- nothing about the evidence changed) would permanently block approving
-- the earlier, valid attempt -- exactly the real "Flasher" gap hit
-- re-validating migration 0062 against Central Kitchen. This mirrors
-- resolveEffectiveUnderstandingInterpretation's own eligible-status filter
-- (worker/effective-understanding-interpretation.mjs), which already never
-- treats a FAILED attempt as superseding a genuinely current one.
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
      AND NOT EXISTS (SELECT 1 FROM estimator_item_interpretations newer_i WHERE newer_i.boq_item_id=i.boq_item_id AND newer_i.version_number>i.version_number AND newer_i.input_fingerprint=i.input_fingerprint AND newer_i.status IN ('COMPLETED','NEEDS_REVIEW'))
  ) THEN RAISE(ABORT, 'understanding review evidence is stale') END;
END;
