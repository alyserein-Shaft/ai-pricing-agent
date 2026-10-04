-- Slice 5: quotation revision commercial/document payload is historical.
-- Lifecycle fields may transition, but the quoted document itself must not
-- change in place. Any commercial/document correction requires a new revision.

CREATE TRIGGER IF NOT EXISTS quotation_revision_payload_update_guard
BEFORE UPDATE ON project_quotation_revisions
WHEN
     NEW.id                    IS NOT OLD.id
  OR NEW.project_id            IS NOT OLD.project_id
  OR NEW.revision_number       IS NOT OLD.revision_number
  OR NEW.quotation_fingerprint IS NOT OLD.quotation_fingerprint
  OR NEW.workflow_snapshot_id  IS NOT OLD.workflow_snapshot_id
  OR NEW.currency              IS NOT OLD.currency
  OR NEW.subtotal_minor        IS NOT OLD.subtotal_minor
  OR NEW.vat_basis_points      IS NOT OLD.vat_basis_points
  OR NEW.vat_minor             IS NOT OLD.vat_minor
  OR NEW.total_minor           IS NOT OLD.total_minor
  OR NEW.terms_json            IS NOT OLD.terms_json
  OR NEW.source_summary_json   IS NOT OLD.source_summary_json
  OR NEW.created_by            IS NOT OLD.created_by
  OR NEW.created_at            IS NOT OLD.created_at
  OR NEW.evidence_fingerprint  IS NOT OLD.evidence_fingerprint
  OR NEW.evidence_manifest_json IS NOT OLD.evidence_manifest_json
  OR NEW.terms_provenance_json IS NOT OLD.terms_provenance_json
BEGIN
  SELECT RAISE(ABORT, 'QUOTATION_REVISION_PAYLOAD_IMMUTABLE');
END;
