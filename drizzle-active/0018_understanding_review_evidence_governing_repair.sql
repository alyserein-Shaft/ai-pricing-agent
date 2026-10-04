-- 0018: CURRENT-BOQ-AUTHORITY consolidation -- understanding-review evidence guard.
--
-- DEFECT. `estimator_understanding_review_current_evidence_guard` (baseline 0000,
-- narrowed by legacy 0062/0063, both preserved as immutable history in `drizzle/`)
-- joined:
--
--     JOIN document_versions dv
--       ON dv.id = e.document_version_id AND dv.document_id = d.id
--      AND d.current_version_id = dv.id
--
-- `documents.current_version_id` answers "which row is the head", not "which issue
-- governs" (DOC-R3 section 9): a future-dated addendum becomes the head the moment
-- it is uploaded and would displace a baseline that is still legitimately in
-- force, while a retired baseline kept as head would keep serving retired
-- evidence. The application authority (`worker/current-evidence-scope.mjs`)
-- resolves the governing version from in-force windows plus active
-- `document_supersessions` edges instead, and fails closed on conflict -- a rule
-- a SQLite trigger cannot faithfully express (recursive transitive retirement
-- plus project-declared calendars), so the trigger must not try.
--
-- REPAIR. Remove the head-pointer conjunct. The `document_versions` join remains
-- as existence-only: the evidence must reference a real version of the same
-- document. Version *currency* is enforced by the application-level governed
-- check, never by this trigger. Everything the trigger CAN truthfully enforce is
-- preserved byte-for-byte: live documents, Item/BOQ-Item rows, the claimed
-- extraction identity, non-superseded Completed/Needs-Review extraction, latest
-- extraction per version, and the same-fingerprint supersession rule (0062/0063).
DROP TRIGGER estimator_understanding_review_current_evidence_guard;
--> statement-breakpoint
CREATE TRIGGER estimator_understanding_review_current_evidence_guard
BEFORE INSERT ON estimator_understanding_review_versions
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM boq_items b
    JOIN boq_extraction_versions e ON e.id=b.extraction_version_id AND e.document_id=b.source_document_id
    JOIN documents d ON d.id=e.document_id AND d.project_id=b.project_id AND d.deleted_at IS NULL AND d.archived_at IS NULL
    JOIN document_versions dv ON dv.id=e.document_version_id AND dv.document_id=d.id
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
