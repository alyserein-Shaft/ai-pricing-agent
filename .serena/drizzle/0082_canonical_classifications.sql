-- DOC-R1A.2 -- CANONICAL CLASSIFICATIONS ADDITIVE VIEW.
--
-- Read-only compatibility projection that exposes the current persisted
-- document classification together with a canonicalized document type
-- matching the exact semantics of normalizeDocumentType(value) from
-- app/domain/document-classifier.mjs (exact-case only, 7 legacy aliases).
--
-- This view is a projection only. It must NOT replace:
-- * current classification authority (superseded_at IS NULL ORDER BY classified_at DESC)
-- * supersession logic
-- * Manually Confirmed gate
-- * classification decisions / audit history
-- Canonicalization does not manufacture authority. Raw primary_type remains
-- available as primary_type; canonical_type is the trimmed, canonicalized
-- form for diagnostics, audits, and SQL consumers.
--
-- Alias contract (exact-case only, no LOWER/ILIKE/COLLATE NOCASE):
--   Specification    -> Technical Specification
--   Catalogue        -> Product Catalogue
--   Datasheet        -> Product Datasheet
--   Supplier Quote   -> Supplier Quotation
--   Compliance       -> Compliance Document
--   Email            -> Project Email
--   Previous Project -> Previous Project Reference
-- NULL / blank / whitespace -> Unknown
-- Auto Detection remains Auto Detection
-- Unsupported nonblank -> trimmed original
--
-- Commercial isolation: this view concerns document classification only;
-- product_sources.source_type / price_records.price_type are not included.
--
-- View hardening (DOC-R1A.3): explicit column list replaces dc.* to prevent
-- silent view shape changes when document_classifications gains new columns.
-- The column list below exactly reflects the document_classifications table
-- schema as of migration 0002.

CREATE VIEW `canonical_classifications` AS
SELECT
  dc.`id`,
  dc.`document_id`,
  dc.`document_version_id`,
  dc.`processing_run_id`,
  dc.`model_version_id`,
  dc.`primary_type`,
  dc.`secondary_types`,
  dc.`confidence`,
  dc.`confidence_state`,
  dc.`status`,
  dc.`method`,
  dc.`extraction_method`,
  dc.`extraction_quality_basis_points`,
  dc.`mixed`,
  dc.`manual_review_required`,
  dc.`downstream_route`,
  dc.`error_code`,
  dc.`error_message`,
  dc.`technical_details`,
  dc.`suggested_action`,
  dc.`confirmed_by`,
  dc.`confirmed_at`,
  dc.`classified_at`,
  dc.`superseded_at`,
  CASE
    WHEN dc.primary_type IS NULL OR TRIM(dc.primary_type) = '' THEN 'Unknown'
    WHEN TRIM(dc.primary_type) = 'Specification' THEN 'Technical Specification'
    WHEN TRIM(dc.primary_type) = 'Catalogue' THEN 'Product Catalogue'
    WHEN TRIM(dc.primary_type) = 'Datasheet' THEN 'Product Datasheet'
    WHEN TRIM(dc.primary_type) = 'Supplier Quote' THEN 'Supplier Quotation'
    WHEN TRIM(dc.primary_type) = 'Compliance' THEN 'Compliance Document'
    WHEN TRIM(dc.primary_type) = 'Email' THEN 'Project Email'
    WHEN TRIM(dc.primary_type) = 'Previous Project' THEN 'Previous Project Reference'
    ELSE TRIM(dc.primary_type)
  END AS `canonical_type`
FROM `document_classifications` dc;
