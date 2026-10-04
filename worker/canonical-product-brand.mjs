// GOLDEN-7A3B1 -- governed canonical product brand registry.
//
// WHY THIS EXISTS.
//
// `product_brands` was previously written in exactly one way: as a side effect of
// ingesting a supplier price list, catalogue or datasheet. There was no way to
// register a canonical brand as reference data in its own right, so representing
// `Honeywell / Gamewell-FCI` or `Honeywell / Gent` would have required either
// abusing document ingestion or writing raw SQL. This module is that missing
// governed operation.
//
// WHAT IT IS NOT.
//
// It is NOT product promotion, NOT identity review, NOT ecosystem selection, NOT
// compatibility, and NOT product creation. It writes at most one row to
// `product_brands` plus one audit row. It never touches `product_identities`,
// `library_products`, `requirement_compatibility` or any Fire Alarm policy.
//
// REUSE, NOT REINVENTION.
//
// The brand normalization and lookup-then-create semantics are extracted VERBATIM
// from `worker/product-price-library-api.mjs` (the general XLSX price-list path and
// the datasheet path), which both already did:
//
//   String(brand).toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim()
//
// followed by `SELECT … WHERE manufacturer_id=? AND normalized_name=?`, reuse on
// hit, otherwise INSERT with status 'Needs Review'. This module is that logic
// extracted so ingestion and the governed path cannot drift apart. The
// normalization semantics are unchanged; the ingestion route now calls this.
//
// MANUFACTURER IS NEVER CREATED HERE.
//
// A brand requires an already-existing canonical manufacturer row. Creating a
// manufacturer is a different governance decision and is refused here, so brand
// registration can never fork the manufacturer registry.

// This is a governed MUTATION service, not a pure domain rule: it needs the
// library authorization model, which lives in the worker layer. app/domain stays
// pure -- every other app/domain reference to worker/ is a comment, not an import.
import { MIN_GOVERNED_REASON_LENGTH } from "../app/domain/reason-governance.mjs";
import { requireLibraryCapability } from "./library-auth.mjs";

export const CANONICAL_BRAND_REGISTRY_VERSION = "canonical-product-brand-1.0.0";

// Standing capability for canonical global reference-data mutation. `apply` is
// Library Manager, which is the SAME bar the price-list ingestion path enforces
// through its own canGovernGlobal() check. This path never weakens it.
export const BRAND_REGISTRY_CAPABILITY = "apply";

// Matches the initial status the existing ingestion writers already use. A
// manager-authorized registration is still a governed reference record awaiting
// review; it is not silently "Active" or "Approved".
export const INITIAL_BRAND_STATUS = "Needs Review";

const text = (value) => String(value ?? "").trim();

/**
 * The canonical brand normalization rule, extracted verbatim from the existing
 * ingestion writers. Punctuation collapses to a single space, so "Gamewell-FCI",
 * "GAMEWELL-FCI" and "Gamewell FCI" all normalize to "GAMEWELL FCI" -- they are
 * therefore the SAME canonical brand, not three. That is existing repository
 * semantics and is deliberately not changed here.
 */
export const normalizeBrandName = (value) =>
  String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

export const canonicalBrandId = (manufacturerId, normalizedName) =>
  `brand_${manufacturerId}_${normalizedName.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`.slice(0, 96);

export function brandRegistryFailure(code, message, status = 422, details = null) {
  const error = new Error(`${code}: ${message}`);
  Object.setPrototypeOf(error, brandRegistryFailure.prototype);
  error.name = "brandRegistryFailure";
  error.code = code;
  error.status = status;
  if (details) error.details = details;
  return error;
}
brandRegistryFailure.prototype = Object.create(Error.prototype);

const fail = (code, message, status, details) => { throw brandRegistryFailure(code, message, status, details); };

/**
 * Validates the request WITHOUT touching the database. Kept separate so the
 * contract is testable and so authorization always runs before any lookup.
 */
export const validateBrandRequest = ({ manufacturerId, brandName, actor, reason, provenance, organizationId } = {}) => {
  // 12 -- authorization is never weakened; Viewer and Reviewer are refused.
  const denied = requireLibraryCapability(actor, BRAND_REGISTRY_CAPABILITY);
  if (denied) fail(denied.code, denied.message, denied.status);

  const resolvedManufacturerId = text(manufacturerId);
  if (!resolvedManufacturerId) {
    fail("MANUFACTURER_NOT_FOUND", "A brand requires an existing canonical manufacturer; supply manufacturerId.", 422);
  }
  const requestedBrandName = text(brandName);
  if (!requestedBrandName) {
    fail("BRAND_NAME_REQUIRED", "A canonical brand name is required.", 422);
  }
  const normalizedName = normalizeBrandName(requestedBrandName);
  if (!normalizedName) {
    fail("BRAND_NAME_REQUIRED", "The supplied brand name has no normalizable content.", 422, { brandName: requestedBrandName });
  }
  // 13 -- canonical reference-data mutation requires a substantive human reason.
  const substantiveReason = text(reason);
  if (substantiveReason.length < MIN_GOVERNED_REASON_LENGTH) {
    fail("BRAND_REASON_REQUIRED", `A governed reason of at least ${MIN_GOVERNED_REASON_LENGTH} characters is required.`, 422);
  }
  // 14 -- provenance is mandatory; a brand may not be registered on assertion.
  const evidence = isUsableProvenance(provenance);
  if (!evidence) {
    fail("BRAND_PROVENANCE_REQUIRED", "Governed provenance is required: supply at least one source reference (knowledge file, manufacturer evidence, or an existing governed identity observation).", 422);
  }
  return {
    manufacturerId: resolvedManufacturerId,
    requestedBrandName,
    normalizedName,
    reason: substantiveReason,
    provenance: evidence,
    organizationId: text(organizationId) || null,
    actorId: text(actor?.id) || null,
    actorRole: text(actor?.permission || actor?.role) || null,
  };
};

const isUsableProvenance = (provenance) => {
  if (!provenance) return null;
  if (Array.isArray(provenance)) {
    const usable = provenance.filter((entry) => entry && text(entry.reference ?? entry.fileId ?? entry.identityId ?? entry.documentId));
    return usable.length > 0 ? usable : null;
  }
  if (typeof provenance === "object") {
    const reference = text(provenance.reference ?? provenance.fileId ?? provenance.identityId ?? provenance.documentId);
    return reference ? [provenance] : null;
  }
  const single = text(provenance);
  return single ? [{ reference: single }] : null;
};

/**
 * The governed operation.
 *
 * Lookup-first (never relying on catching a UNIQUE violation), so a repeated
 * request is a genuine no-op rather than an error-and-retry.
 *
 * @param {{ db: object, ...request }} input `db` is a D1-style handle
 *        (prepare(...).bind(...).first()/.run()).
 * @returns {Promise<{ brand: object, created: boolean, idempotent: boolean }>}
 */
export async function ensureCanonicalBrand(input = {}) {
  const request = validateBrandRequest(input);
  const db = input.db;
  if (!db || typeof db.prepare !== "function") {
    fail("BRAND_REGISTRY_UNAVAILABLE", "A database handle is required to resolve a canonical brand.", 500);
  }

  // 7 -- the manufacturer must already exist. A brand NEVER creates one.
  const manufacturer = await db
    .prepare("SELECT id, name, normalized_name FROM product_manufacturers WHERE id=?")
    .bind(request.manufacturerId).first();
  if (!manufacturer) {
    fail("MANUFACTURER_NOT_FOUND", "No canonical manufacturer exists with that id; brand registration never creates a manufacturer.", 422, { manufacturerId: request.manufacturerId });
  }

  // 10/11 -- explicit lookup-first reuse, before any write attempt.
  const existing = await db
    .prepare("SELECT id, manufacturer_id, name, normalized_name, status, created_at FROM product_brands WHERE manufacturer_id=? AND normalized_name=?")
    .bind(request.manufacturerId, request.normalizedName).first();
  if (existing) {
    return {
      brand: existing,
      created: false,
      // 10 -- reuse changes nothing: no status reset, no timestamp rewrite.
      idempotent: true,
      manufacturer,
      request: { requestedBrandName: request.requestedBrandName, normalizedName: request.normalizedName },
    };
  }

  const brandId = canonicalBrandId(request.manufacturerId, request.normalizedName);
  const statements = [
    db.prepare("INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status) VALUES (?,?,?,?,?)")
      .bind(brandId, request.manufacturerId, request.requestedBrandName, request.normalizedName, INITIAL_BRAND_STATUS),
  ];

  // 15 -- reuse the existing generic decision/audit table. No new audit table.
  if (request.organizationId) {
    statements.push(db.prepare(
      "INSERT INTO product_library_decisions (id,project_id,entity_type,entity_id,action,previous_value,new_value,reason,decided_by,decided_role) VALUES (?,NULL,?,?,?,?,?,?,?,?)",
    ).bind(
      `brandDecision_${brandId}`, "Product Brand", brandId, "Canonical Product Brand Created",
      JSON.stringify({ exists: false }),
      JSON.stringify({ brandId, manufacturerId: request.manufacturerId, name: request.requestedBrandName, normalizedName: request.normalizedName, status: INITIAL_BRAND_STATUS }),
      request.reason, request.actorId, request.actorRole,
    ));
  }

  try {
    for (const statement of statements) await statement.run();
  } catch (error) {
    // 33 -- a concurrent creator may have won the race. Re-read before failing, so
    // two concurrent attempts converge on ONE canonical row.
    const winner = await db
      .prepare("SELECT id, manufacturer_id, name, normalized_name, status, created_at FROM product_brands WHERE manufacturer_id=? AND normalized_name=?")
      .bind(request.manufacturerId, request.normalizedName).first();
    if (winner) return { brand: winner, created: false, idempotent: true, manufacturer, concurrentWinner: true };
    throw error;
  }

  const brand = await db
    .prepare("SELECT id, manufacturer_id, name, normalized_name, status, created_at FROM product_brands WHERE manufacturer_id=? AND normalized_name=?")
    .bind(request.manufacturerId, request.normalizedName).first();
  return { brand, created: true, idempotent: false, manufacturer, request: { requestedBrandName: request.requestedBrandName, normalizedName: request.normalizedName } };
}
