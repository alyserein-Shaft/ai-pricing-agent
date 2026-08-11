/** Shared operational product authority used by matching and supplier mapping. */
export const CANONICAL_DISCOVERY_PRODUCT_PREDICATE = "p.requested_product_id=p.id AND p.identity_status='Active' AND p.approved_for_discovery=1 AND p.review_status='Reviewed'";

export const canonicalDiscoveryProductSql = (projection = "p.*") =>
  `SELECT ${projection} FROM canonical_library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id WHERE ${CANONICAL_DISCOVERY_PRODUCT_PREDICATE}`;
