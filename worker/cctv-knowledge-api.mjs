// CCTV System Pack v1 -- a read-only Knowledge overview for the CCTV
// system pack, mirroring worker/fire-alarm-knowledge-api.mjs's exact shape
// and discipline (every number is a live COUNT/aggregate, nothing is
// computed, cached, or approximated, nothing mutates anything). CCTV's
// catalog is small (14 products) at v1 -- this endpoint is a parameterized
// analog of the Fire Alarm one, not a rebuild of the Knowledge UX
// architecture.
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { CCTV_ATTRIBUTE_PROFILES, CCTV_TAXONOMY, CCTV_TAXONOMY_VERSION } from "../app/domain/cctv-taxonomy.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const flattenTaxonomy = () => Object.entries(CCTV_TAXONOMY).flatMap(([category, families]) => families.map((family) => ({ category, family })));

const governedAttributeIndex = () => {
  const byName = new Map();
  for (const [family, profile] of Object.entries(CCTV_ATTRIBUTE_PROFILES)) {
    for (const name of profile.attributes) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(family);
    }
  }
  return byName;
};

export async function handleCctvKnowledgeApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/knowledge/cctv/overview") return null;
  if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
  if (!env.DB) return json({ error: { code: "KNOWLEDGE_UNAVAILABLE", message: "Knowledge storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  applicationActor(resolved.context);

  const manufacturer = await env.DB.prepare("SELECT id, name FROM product_manufacturers WHERE name = 'Hikvision'").first();
  if (!manufacturer) return json({ error: { code: "MANUFACTURER_NOT_FOUND", message: "Hikvision manufacturer record not found." } }, 404);

  const taxonomyFamilies = flattenTaxonomy();
  const dbFamilies = (await env.DB.prepare("SELECT f.id, f.name, f.engineering_domain category, COUNT(p.id) activeCount FROM product_families f LEFT JOIN library_products p ON p.family_id = f.id AND p.manufacturer_id = ? AND p.identity_status = 'Active' GROUP BY f.id, f.name, f.engineering_domain").bind(manufacturer.id).all()).results || [];
  const dbFamilyByName = new Map(dbFamilies.map((row) => [row.name, row]));

  const families = taxonomyFamilies.map(({ category, family }) => {
    const row = dbFamilyByName.get(family);
    const activeCount = Number(row?.activeCount || 0);
    const coverageState = activeCount === 0 ? "Not yet available" : "Available";
    return { family, category, activeProductCount: activeCount, coverageState, hasNoDbRow: !row };
  });

  const totalsRow = await env.DB.prepare(
    `SELECT
       COUNT(*) total,
       SUM(CASE WHEN family_id IS NOT NULL THEN 1 ELSE 0 END) classified,
       SUM(CASE WHEN family_id IS NULL THEN 1 ELSE 0 END) unclassified,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM product_source_evidence e WHERE e.product_id = p.id) THEN 1 ELSE 0 END) withEvidence,
       SUM(CASE WHEN attributes IS NOT NULL AND attributes <> '[]' AND attributes <> '' THEN 1 ELSE 0 END) withTechnicalDetail,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM product_accessories pa2 WHERE pa2.product_id = p.id AND pa2.deleted_at IS NULL AND pa2.superseded_at IS NULL AND pa2.review_status = 'Approved') THEN 1 ELSE 0 END) withAccessories,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM product_lifecycle_events le WHERE le.product_id = p.id) THEN 1 ELSE 0 END) withLifecycleEvents
     FROM library_products p WHERE p.manufacturer_id = ? AND p.identity_status = 'Active'`,
  ).bind(manufacturer.id).first();

  const roleRows = (await env.DB.prepare("SELECT product_role role, COUNT(*) n FROM library_products WHERE manufacturer_id = ? AND identity_status = 'Active' GROUP BY product_role ORDER BY n DESC").bind(manufacturer.id).all()).results || [];
  const reviewStatusRows = (await env.DB.prepare("SELECT review_status status, COUNT(*) n FROM library_products WHERE manufacturer_id = ? AND identity_status = 'Active' GROUP BY review_status ORDER BY n DESC").bind(manufacturer.id).all()).results || [];
  const lifecycleRows = (await env.DB.prepare("SELECT COALESCE(lifecycle_status, 'Unknown — Review Required') status, COUNT(*) n FROM library_products WHERE manufacturer_id = ? AND identity_status = 'Active' GROUP BY status ORDER BY n DESC").bind(manufacturer.id).all()).results || [];

  const familiesWithNoDbRow = families.filter((entry) => entry.hasNoDbRow).length;
  const familiesZeroCoverage = families.filter((entry) => entry.activeProductCount === 0).length;
  const familiesPopulated = families.length - familiesZeroCoverage;

  const productRows = (await env.DB.prepare(
    `SELECT p.part_number partNumber, m.name manufacturer, f.name family, p.product_role productRole,
       (SELECT COUNT(*) FROM product_source_evidence e WHERE e.product_id = p.id) evidenceCount,
       (CASE WHEN p.attributes IS NOT NULL AND p.attributes <> '[]' AND p.attributes <> '' THEN 1 ELSE 0 END) hasTechnicalDetail,
       (SELECT COUNT(*) FROM price_records pr WHERE pr.product_id = p.id) priceRecordCount
     FROM library_products p JOIN product_manufacturers m ON m.id = p.manufacturer_id LEFT JOIN product_families f ON f.id = p.family_id
     WHERE p.manufacturer_id = ? AND p.identity_status = 'Active' ORDER BY p.part_number`,
  ).bind(manufacturer.id).all()).results || [];

  const attributeIndex = governedAttributeIndex();
  const attributeRows = [];
  for (const [name, appliesTo] of attributeIndex) {
    const row = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM library_products p WHERE p.manufacturer_id = ? AND p.identity_status = 'Active' AND p.attributes LIKE '%"name":"' || ? || '"%') coverage`,
    ).bind(manufacturer.id, name).first();
    attributeRows.push({ attribute: name, applicableFamilies: appliesTo, productCoverage: Number(row?.coverage || 0) });
  }
  attributeRows.sort((a, b) => b.productCoverage - a.productCoverage || a.attribute.localeCompare(b.attribute));

  const registeredSources = (await env.DB.prepare(
    "SELECT source_type sourceType, authority, file_name fileName, validity_state validityState FROM product_sources WHERE file_name LIKE '%Central Kitchen%' OR file_name LIKE '%Hikvision%' ORDER BY source_type",
  ).all()).results || [];
  const externallyResearchedCitations = await env.DB.prepare(
    `SELECT COUNT(*) n FROM library_products p WHERE p.manufacturer_id = ? AND p.identity_status = 'Active' AND p.attributes LIKE '%"sourceType":"Manufacturer Official%'`,
  ).bind(manufacturer.id).first();

  const pricingRow = await env.DB.prepare(
    `SELECT
       COUNT(DISTINCT p.id) productsWithPriceEvidence,
       SUM(CASE WHEN pr.validity_state = 'Current' THEN 1 ELSE 0 END) currentPriceRecords,
       SUM(CASE WHEN pr.validity_state = 'Historical' THEN 1 ELSE 0 END) historicalPriceRecords,
       SUM(CASE WHEN pr.validity_state = 'Expired' THEN 1 ELSE 0 END) expiredPriceRecords,
       SUM(CASE WHEN pr.approval_status = 'Approved' THEN 1 ELSE 0 END) approvedPriceRecords,
       SUM(CASE WHEN pr.project_id IS NOT NULL THEN 1 ELSE 0 END) projectSpecificPriceRecords,
       SUM(CASE WHEN pr.project_id IS NULL THEN 1 ELSE 0 END) globalPriceRecords
     FROM price_records pr JOIN library_products p ON p.id = pr.product_id WHERE p.manufacturer_id = ?`,
  ).bind(manufacturer.id).first();
  const downstreamUseRows = (await env.DB.prepare(
    `SELECT pr.downstream_use downstreamUse, COUNT(*) n FROM price_records pr JOIN library_products p ON p.id = pr.product_id WHERE p.manufacturer_id = ? GROUP BY pr.downstream_use ORDER BY n DESC`,
  ).bind(manufacturer.id).all()).results || [];

  // Engineer-facing: describes the GLOBAL CCTV knowledge gap itself, never a
  // project/BOQ/fixture reference (that lives in governance.validationGaps
  // below, mirroring the Fire Alarm pattern exactly). Mirrors
  // docs/cctv-gap-matrix.md so the two never silently drift apart.
  const knownGaps = [
    {
      area: "Catalog Coverage",
      gap: "Only one real historical project anchors this catalog",
      impact: "Matching quality is validated against a single real project; broader CCTV product/manufacturer coverage is not yet proven.",
      validationEvidence: "Central Kitchen - Makkah (Al Mespar Contracting Corp, Q1067-626-LCU) is the only graded Golden dataset; a second project's real BOQ text was checked informally (classification only, no historical PN to grade against).",
    },
    {
      area: "Catalog Coverage",
      gap: `${familiesZeroCoverage} taxonomy families have no active catalog products`,
      impact: "Deferred pending future sourcing -- no real project evidence found yet for these families.",
      validationEvidence: `Live count from the catalog: ${familiesZeroCoverage} of ${taxonomyFamilies.length} governed families currently have zero Active products.`,
    },
    {
      area: "Capacity Logic",
      gap: "PoE power-budget calculation not built",
      impact: "No real project evidence required it yet (v1 has no PoE switch products); storage sizing is built and validated.",
      validationEvidence: "No PoE switch/injector product or real project PoE requirement was found during the CCTV v1 audit.",
    },
    {
      area: "Live Pipeline",
      gap: "Full live AI-understanding re-match not exercised for a real project BOQ line",
      impact: "Every deterministic downstream stage (taxonomy classification, requirement facts, matching, BOM) is proven directly; the live AI-provider step itself requires a remote Workers AI binding unavailable in this offline session.",
      validationEvidence: "Confirmed structurally: estimator_understanding_runs has no manual/human-only run mode -- at least one real AI-provider run is required before the review/approval layer has anything to review.",
    },
  ];

  return json({
    generatedAt: new Date().toISOString(),
    taxonomy: { version: CCTV_TAXONOMY_VERSION, totalFamilies: taxonomyFamilies.length, populatedFamilies: familiesPopulated, zeroCoverageFamilies: familiesZeroCoverage, familiesWithNoDbRow },
    families: families
      .map(({ family, category, activeProductCount, coverageState }) => ({ family, category, activeProductCount, coverageState }))
      .sort((a, b) => b.activeProductCount - a.activeProductCount || a.family.localeCompare(b.family)),
    products: {
      manufacturer: manufacturer.name,
      total: Number(totalsRow?.total || 0),
      classified: Number(totalsRow?.classified || 0),
      unclassified: Number(totalsRow?.unclassified || 0),
      withSourceEvidence: Number(totalsRow?.withEvidence || 0),
      withTechnicalDetail: Number(totalsRow?.withTechnicalDetail || 0),
      withApprovedAccessoryRelationship: Number(totalsRow?.withAccessories || 0),
      withLifecycleEvents: Number(totalsRow?.withLifecycleEvents || 0),
    },
    productRoleDistribution: roleRows.map((row) => ({ role: row.role, count: Number(row.n) })),
    reviewStatusDistribution: reviewStatusRows.map((row) => ({ status: row.status, count: Number(row.n) })),
    lifecycleDistribution: lifecycleRows.map((row) => ({ status: row.status, count: Number(row.n) })),
    productList: productRows.map((row) => ({
      partNumber: row.partNumber,
      manufacturer: row.manufacturer,
      family: row.family,
      productRole: row.productRole,
      evidenceCount: Number(row.evidenceCount || 0),
      hasTechnicalDetail: Boolean(row.hasTechnicalDetail),
      hasPriceEvidence: Number(row.priceRecordCount || 0) > 0,
    })),
    attributes: attributeRows,
    manufacturers: {
      registeredSources,
      externallyResearchedCitations: Number(externallyResearchedCitations?.n || 0),
    },
    pricing: {
      productsWithPriceEvidence: Number(pricingRow?.productsWithPriceEvidence || 0),
      currentPriceRecords: Number(pricingRow?.currentPriceRecords || 0),
      historicalPriceRecords: Number(pricingRow?.historicalPriceRecords || 0),
      expiredPriceRecords: Number(pricingRow?.expiredPriceRecords || 0),
      approvedPriceRecords: Number(pricingRow?.approvedPriceRecords || 0),
      projectSpecificPriceRecords: Number(pricingRow?.projectSpecificPriceRecords || 0),
      globalPriceRecords: Number(pricingRow?.globalPriceRecords || 0),
      downstreamUseDistribution: downstreamUseRows.map((row) => ({ downstreamUse: row.downstreamUse, count: Number(row.n) })),
    },
    coverageGaps: {
      status: "Validated",
      gaps: knownGaps.map(({ area, gap, impact }) => ({ area, gap, impact })),
    },
    governance: {
      taxonomyVersion: CCTV_TAXONOMY_VERSION,
      goldenValidation: {
        status: "PASSED",
        summary: "0 true matching errors, 0 false resolves, 0 cross-family ranking errors against the frozen Central Kitchen - Makkah CCTV validation project.",
        detail: "See docs/cctv-system-pack-v1-release.md for the current run and full history.",
      },
      validationGaps: knownGaps,
    },
  });
}
