/** Shared operational product authority used by matching and supplier mapping. */
// Technical discoverability is intentionally independent of the separate
// approved-for-discovery / reviewed business-review workflow
// (see worker/product-price-library-api.mjs "approve-discovery"): a product
// only needs a canonical, non-superseded identity and real ingestion
// provenance to be a technical matching/mapping candidate. Business review
// remains a distinct, still-available gate for whatever downstream purpose
// needs it -- it just no longer blocks matching from running at all.
// review_status='Rejected' is still excluded: unlike the default "Needs
// Review" (simply not yet business-reviewed), Rejected is an identity/data-
// integrity signal that something about this record is actually wrong.
export const CANONICAL_DISCOVERY_PRODUCT_PREDICATE = "p.requested_product_id=p.id AND p.identity_status='Active' AND p.review_status<>'Rejected' AND EXISTS (SELECT 1 FROM product_source_evidence e WHERE e.product_id=p.id)";

export const canonicalDiscoveryProductSql = (projection = "p.*") =>
  `SELECT ${projection} FROM canonical_library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id WHERE ${CANONICAL_DISCOVERY_PRODUCT_PREDICATE}`;
