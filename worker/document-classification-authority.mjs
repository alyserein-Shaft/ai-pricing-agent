// Targeted Document Classification Authority Fix, item 7: the single
// canonical "current document classification" query -- previously
// hand-copied, identically, into boq-extraction-api.mjs,
// specification-extraction-api.mjs, specification-extraction-background.mjs,
// supplier-price-intake-api.mjs, project-context-api.mjs and
// document-api.mjs's listing query. Deliberately a small, dependency-free
// leaf module (no imports of its own) rather than exported from
// classification-api.mjs: classification-api.mjs already imports FROM most
// of those files (executeBoqExtraction, createSpecificationJob,
// executeSupplierQuoteExtraction, executeProjectContextExtraction), so
// having them import a shared classification helper back from
// classification-api.mjs would be circular. Both classification-api.mjs and
// every extraction file import from here instead.
//
// Governed authority: document_classifications, current row = the one with
// superseded_at IS NULL, most recent classified_at. documents.document_type
// is a denormalized mirror only (see worker/document-api.mjs's upload/
// updateDocument comments) -- never read it in place of this.

// Standalone lookup -- for callers that only need the current classification
// on its own, not joined into a larger per-document query.
export const currentDocumentClassification = (db, documentId) =>
  db
    .prepare(
      "SELECT * FROM document_classifications WHERE document_id=? AND superseded_at IS NULL ORDER BY classified_at DESC LIMIT 1",
    )
    .bind(documentId)
    .first();

// Content-Readability Authority Fix (2026-09-16): classification authority
// ("what type does this document belong to") and content-readability
// authority ("can the system actually read its bytes") are deliberately
// independent -- a human may validly, manually classify an unreadable file
// (e.g. an Outlook .msg genuinely known to be a Drawing). That manual
// classification is real, valid metadata and must never be undone by this
// check; it only means no CONTENT-DEPENDENT processing may start. Mirrors
// app/domain/document-downstream-state.mjs's contentReadableForDownstream
// (same canonical persisted field, independent implementation on purpose:
// both files are deliberately dependency-free leaf modules). Deliberately
// narrow -- only UNREADABLE_CONTENT is a genuine format limitation.
// OCR_REQUIRED (a real, different, still-actionable pipeline step) and any
// other classification error are NOT included.
export const classificationContentReadable = (classification) =>
  !classification || classification.error_code !== "UNREADABLE_CONTENT";

// One consistent error contract every extraction/analysis start route
// should fail closed with, instead of each route inventing its own
// wording.
export const DOCUMENT_CONTENT_UNREADABLE_ERROR = {
  code: "DOCUMENT_CONTENT_UNREADABLE",
  message: "This document is manually classified, but its content cannot be read in the current build.",
  suggestedAction: "Upload a readable version before starting downstream processing.",
};

// For embedding as `LEFT JOIN document_classifications c ON c.id=${CURRENT_CLASSIFICATION_JOIN}`
// in a larger query that already aliases the documents table as `d` --
// avoids an N+1 round trip when a caller already needs other document/
// version columns in the same query. Requires the outer query's documents
// table alias to be exactly `d`.
export const CURRENT_CLASSIFICATION_JOIN =
  "(SELECT id FROM document_classifications WHERE document_id=d.id AND superseded_at IS NULL ORDER BY classified_at DESC LIMIT 1)";
