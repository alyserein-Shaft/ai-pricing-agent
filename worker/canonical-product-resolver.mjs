export class CanonicalProductResolutionError extends Error {
  constructor(code, message, details = {}) { super(message); this.code = code; this.status = 409; this.details = details; }
}

export const resolveCanonicalProduct = async (db, productId, { includeHistory = true, maxDepth = 32 } = {}) => {
  const path = [], seen = new Set(); let currentId = productId;
  for (let depth = 0; depth < maxDepth; depth += 1) {
    if (seen.has(currentId)) throw new CanonicalProductResolutionError("CANONICAL_PRODUCT_CYCLE", "Canonical product history contains a cycle.", { requestedProductId: productId });
    seen.add(currentId);
    const row = await db.prepare("SELECT p.*,m.name manufacturer,b.name brand,f.name family FROM library_products p JOIN product_manufacturers m ON m.id=p.manufacturer_id LEFT JOIN product_brands b ON b.id=p.brand_id LEFT JOIN product_families f ON f.id=p.family_id WHERE p.id=?").bind(currentId).first();
    if (!row) throw new CanonicalProductResolutionError("CANONICAL_PRODUCT_NOT_FOUND", "Product identity could not be resolved.", { requestedProductId: productId });
    path.push({ id: row.id, identityStatus: row.identity_status, supersededByProductId: row.superseded_by_product_id || null, identityVersion: Number(row.identity_version || 1) });
    if (row.identity_status !== "Superseded") return { requestedProductId: productId, canonicalProductId: row.id, product: row, historical: includeHistory ? path : undefined, wasSuperseded: row.id !== productId };
    if (!row.superseded_by_product_id) throw new CanonicalProductResolutionError("CANONICAL_PRODUCT_BROKEN_CHAIN", "Superseded product has no canonical successor.", { requestedProductId: productId, productId: row.id });
    currentId = row.superseded_by_product_id;
  }
  throw new CanonicalProductResolutionError("CANONICAL_PRODUCT_DEPTH_EXCEEDED", "Canonical product history exceeds the safe resolution depth.", { requestedProductId: productId });
};

export const resolveCanonicalProductIds = async (db, ids) => Promise.all([...new Set(ids)].map((id) => resolveCanonicalProduct(db, id)));
