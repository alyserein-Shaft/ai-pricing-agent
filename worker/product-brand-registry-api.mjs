// GOLDEN-7A3B1 -- governed standalone canonical brand registry route.
//
// Exposes the missing capability: registering a canonical product brand as
// reference data in its own right, without a supplier document, a source object,
// or manual document classification.
//
// Route: POST /api/product-brands/ensure
//
// The domain operation carries the governance (canonical manufacturer required,
// normalized manufacturer-scoped uniqueness, authorization, reason, provenance,
// lookup-first idempotency, audit). This route only resolves the acting
// organization/user and shapes the HTTP response; it deliberately exposes no
// arbitrary-column write surface.

import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { ensureCanonicalBrand, normalizeBrandName, brandRegistryFailure } from "./canonical-product-brand.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
});

const organization = async (db, userId) => {
  const rows = await db.prepare(
    "SELECT o.id,o.name FROM organization_memberships m JOIN organizations o ON o.id=m.organization_id WHERE m.user_id=? AND m.status='Active' AND m.revoked_at IS NULL AND o.status='Active' ORDER BY m.granted_at LIMIT 2",
  ).bind(userId).all();
  return rows.results?.length === 1 ? rows.results[0] : null;
};

const errorResponse = (error) => {
  if (error instanceof brandRegistryFailure) {
    return json({ error: { code: error.code, message: error.message.replace(`${error.code}: `, ""), ...(error.details ? { details: error.details } : {}) } }, error.status);
  }
  return json({ error: { code: "BRAND_REGISTRY_INTERNAL_ERROR", message: "Canonical brand registration failed unexpectedly." } }, 500);
};

export async function handleProductBrandRegistryApi(request, env) {
  // No match means "not my route": the router chain must continue.
  if (new URL(request.url).pathname !== "/api/product-brands/ensure") return null;
  if (!env.DB) return json({ error: { code: "BRAND_REGISTRY_UNAVAILABLE", message: "Brand registry storage is unavailable." } }, 503);

  if (request.method === "GET") {
    // Read-only inspection: every brand under a manufacturer, so a caller can see
    // what already exists without attempting a create.
    const url = new URL(request.url);
    const manufacturerId = url.searchParams.get("manufacturerId");
    if (!manufacturerId) return json({ error: { code: "MANUFACTURER_NOT_FOUND", message: "manufacturerId is required." } }, 422);
    const rows = await env.DB.prepare("SELECT id, manufacturer_id, name, normalized_name, status, created_at FROM product_brands WHERE manufacturer_id=? ORDER BY normalized_name")
      .bind(manufacturerId).all();
    return json({ brands: rows.results || [] });
  }

  if (request.method !== "POST") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed." } }, 405);

  try {
    const resolved = await resolveApplicationContext(request, env);
    if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
    const actor = applicationActor(resolved.context);
    const org = await organization(env.DB, actor.id);
    if (!org) return json({ error: { code: "ORGANIZATION_REQUIRED", message: "An active organization membership is required to register canonical reference data." } }, 403);

    const body = await request.json().catch(() => ({}));
    const result = await ensureCanonicalBrand({
      db: env.DB,
      manufacturerId: body.manufacturerId,
      brandName: body.brandName,
      actor,
      reason: body.reason,
      provenance: body.provenance,
      organizationId: org.id,
      // Accepted for traceability and echoed back; semantic uniqueness is by
      // (manufacturer_id, normalized_name), not by this key alone.
      idempotencyKey: body.idempotencyKey ?? null,
    });

    return json({
      brand: result.brand,
      manufacturer: result.manufacturer,
      created: result.created,
      idempotent: result.idempotent,
      requested: {
        brandName: result.request?.requestedBrandName ?? body.brandName ?? null,
        normalizedName: result.request?.normalizedName ?? normalizeBrandName(body.brandName),
      },
    }, result.created ? 201 : 200);
  } catch (error) {
    return errorResponse(error);
  }
}

export const PRODUCT_BRAND_REGISTRY_ROUTE = "/api/product-brands/ensure";
