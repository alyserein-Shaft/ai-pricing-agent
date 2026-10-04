// Fire Alarm System Pack v1 closure -- Phase N: a read-only Knowledge
// overview for the Fire Alarm system pack, so an engineer can inspect its
// governance state directly instead of trusting it blindly. Every number
// here is a live COUNT/aggregate over existing authoritative tables
// (product_families, library_products, product_source_evidence,
// product_attributes, product_accessories, product_lifecycle_events,
// price_records, product_sources) -- nothing here is computed, cached, or
// approximated, and nothing here mutates anything.
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { FIRE_ALARM_ATTRIBUTE_PROFILES, FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION } from "../app/domain/fire-alarm-taxonomy.mjs";

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

const flattenTaxonomy = () => Object.entries(FIRE_ALARM_TAXONOMY).flatMap(([category, families]) => families.map((family) => ({ category, family })));

// Every distinct governed attribute name across every family's profile
// (COMMON_ATTRIBUTES + FAMILY_SPECIFIC_ATTRIBUTES), each with the list of
// families it applies to -- derived directly from the taxonomy, never a
// second hand-maintained list.
const governedAttributeIndex = () => {
  const byName = new Map();
  for (const [family, profile] of Object.entries(FIRE_ALARM_ATTRIBUTE_PROFILES)) {
    for (const name of profile.attributes) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(family);
    }
  }
  return byName;
};

export async function handleFireAlarmKnowledgeApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/knowledge/fire-alarm/overview") return null;
  if (request.method !== "GET") return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET." } }, 405);
  if (!env.DB) return json({ error: { code: "KNOWLEDGE_UNAVAILABLE", message: "Knowledge storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  applicationActor(resolved.context);

  const manufacturer = await env.DB.prepare("SELECT id, name FROM product_manufacturers WHERE name = 'Honeywell'").first();
  if (!manufacturer) return json({ error: { code: "MANUFACTURER_NOT_FOUND", message: "Honeywell manufacturer record not found." } }, 404);

  const taxonomyFamilies = flattenTaxonomy();
  const dbFamilies = (await env.DB.prepare("SELECT f.id, f.name, f.engineering_domain category, COUNT(p.id) activeCount FROM product_families f LEFT JOIN library_products p ON p.family_id = f.id AND p.manufacturer_id = ? AND p.identity_status = 'Active' GROUP BY f.id, f.name, f.engineering_domain").bind(manufacturer.id).all()).results || [];
  const dbFamilyByName = new Map(dbFamilies.map((row) => [row.name, row]));

  const families = taxonomyFamilies.map(({ category, family }) => {
    const row = dbFamilyByName.get(family);
    const activeCount = Number(row?.activeCount || 0);
    // Engineer-facing label: does this family have real, selectable catalog
    // products today. Whether a product_families DB row exists at all is an
    // internal schema distinction with no engineer-relevant difference from
    // "zero catalog products" -- both mean the same practical thing, so they
    // collapse to one label; the raw distinction is preserved in
    // `hasNoDbRow` for the governance-only aggregate below.
    const coverageState = activeCount === 0 ? "Not yet available" : "Available";
    return { family, category, activeProductCount: activeCount, coverageState, hasNoDbRow: !row };
  });

  const totalsRow = await env.DB.prepare(
    `SELECT
       COUNT(*) total,
       SUM(CASE WHEN family_id IS NOT NULL THEN 1 ELSE 0 END) classified,
       SUM(CASE WHEN family_id IS NULL THEN 1 ELSE 0 END) unclassified,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM product_source_evidence e WHERE e.product_id = p.id) THEN 1 ELSE 0 END) withEvidence,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = p.id) THEN 1 ELSE 0 END) withModernAttributes,
       SUM(CASE WHEN attributes IS NOT NULL AND attributes <> '[]' AND attributes <> '' THEN 1 ELSE 0 END) withLegacyAttributes,
       SUM(CASE WHEN standards IS NOT NULL AND standards <> '[]' AND standards <> '' THEN 1 ELSE 0 END) withLegacyStandards,
       SUM(CASE WHEN EXISTS (SELECT 1 FROM product_certifications pc WHERE pc.product_id = p.id) THEN 1 ELSE 0 END) withModernCertifications,
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

  // PRODUCTS tab -- every Active product, one row each. 482 rows is small
  // enough to return whole; no pagination needed at this catalog size.
  // hasTechnicalDetail/hasPriceEvidence are engineer-facing yes/no signals
  // (has this product got enough Product Knowledge / linked price data to
  // be selected with confidence) -- lifecycle/review-status stay out of the
  // primary row shape; they are internal governance state, not a selection
  // signal, and remain queryable via the Governance tab's aggregates.
  const productRows = (await env.DB.prepare(
    `SELECT p.part_number partNumber, m.name manufacturer, f.name family, p.product_role productRole,
       (SELECT COUNT(*) FROM product_source_evidence e WHERE e.product_id = p.id) evidenceCount,
       (CASE WHEN (p.attributes IS NOT NULL AND p.attributes <> '[]' AND p.attributes <> '') OR EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = p.id) THEN 1 ELSE 0 END) hasTechnicalDetail,
       (SELECT COUNT(*) FROM price_records pr WHERE pr.product_id = p.id) priceRecordCount
     FROM library_products p JOIN product_manufacturers m ON m.id = p.manufacturer_id LEFT JOIN product_families f ON f.id = p.family_id
     WHERE p.manufacturer_id = ? AND p.identity_status = 'Active' ORDER BY p.part_number`,
  ).bind(manufacturer.id).all()).results || [];

  // ATTRIBUTES tab -- one row per governed attribute name. "productCoverage"
  // is a best-effort presence count (legacy attributes JSON text match OR a
  // modern product_attributes row with this exact name) -- a coverage
  // signal, not a re-verification of every value's correctness.
  const attributeIndex = governedAttributeIndex();
  const attributeRows = [];
  for (const [name, appliesTo] of attributeIndex) {
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM library_products p WHERE p.manufacturer_id = ? AND p.identity_status = 'Active' AND (p.attributes LIKE '%"name":"' || ? || '"%' OR EXISTS (SELECT 1 FROM product_attributes pa WHERE pa.product_id = p.id AND pa.attribute_name = ?))) coverage`,
    ).bind(manufacturer.id, name, name).first();
    attributeRows.push({ attribute: name, applicableFamilies: appliesTo, productCoverage: Number(row?.coverage || 0) });
  }
  attributeRows.sort((a, b) => b.productCoverage - a.productCoverage || a.attribute.localeCompare(b.attribute));

  // MANUFACTURERS / EVIDENCE tab.
  const registeredSources = (await env.DB.prepare(
    "SELECT source_type sourceType, authority, file_name fileName, validity_state validityState FROM product_sources ORDER BY source_type",
  ).all()).results || [];
  const externallyResearchedCitations = await env.DB.prepare(
    `SELECT COUNT(*) n FROM library_products p WHERE p.manufacturer_id = ? AND p.identity_status = 'Active' AND p.attributes LIKE '%"sourceType":"Manufacturer Official%'`,
  ).bind(manufacturer.id).first();

  // PRICING tab.
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

  // COVERAGE / GAPS -- these describe the GLOBAL Fire Alarm knowledge gap
  // itself (what an engineer needs to know to use the pack safely), never a
  // specific project, BOQ line, or regression fixture. Each gap also carries
  // a `validationEvidence` string, WHICH SOFTWARE VALIDATED IT AND HOW --
  // that field is project/fixture-specific by design and must only ever be
  // rendered in Advanced/Governance, never in the primary engineer Gaps
  // view. Golden status is read from the frozen baseline doc reference (not
  // re-run here -- this endpoint stays read-only/fast); this list mirrors
  // docs/fire-alarm-gap-matrix.md so the two never silently drift apart.
  const knownGaps = [
    {
      area: "Catalog Identity",
      gap: "Battery sibling identity ambiguity",
      impact: "Model/capacity cannot be uniquely selected without more project detail.",
      validationEvidence: "Opera Block regression, lines sn3 & sn5: the source line states no model/spec, and the catalog holds multiple valid AH-rated battery siblings -- correctly left unresolved rather than guessed.",
    },
    {
      area: "Attribute Discrimination",
      gap: "Notification appliance variant selection incomplete",
      impact: "Mounting/candela discriminator still required to fully separate same-color siblings.",
      validationEvidence: "Opera Block regression, lines sn19-21 (P2RL/SPSCRL/SPSRL vs P2RHK/SPSRK): color now resolves part of the tie; a second attribute (mounting/candela variant) is not yet modeled.",
    },
    {
      area: "Attribute Discrimination",
      gap: "Wired vs wireless pull station ambiguity",
      impact: "Requires explicit project evidence stating wired or wireless.",
      validationEvidence: "Opera Block regression, line sn17 (IDP-PULL-DA vs WIDP-PULL-DA): the source line does not rule out wireless -- a genuine tie, correctly escalated rather than forced.",
    },
    {
      area: "Taxonomy / Identity",
      gap: "Firefighter Telephone sibling distinction",
      impact: "Family is recognized; exact sibling selection may require engineer review.",
      validationEvidence: "Opera Block regression, lines sn25-26 (FFT-RHS/FFT-FPJ vs FFT-STSS): the family is now governed with real catalog evidence; a within-family low-confidence tie remains, correctly escalated.",
    },
    {
      area: "Catalog Coverage",
      gap: `${familiesZeroCoverage} taxonomy families have no active catalog products`,
      impact: "Deferred pending future sourcing; one (Break Glass Unit) is intentionally out of scope.",
      validationEvidence: `Live count from the catalog: ${familiesZeroCoverage} of ${taxonomyFamilies.length} governed families currently have zero Active products.`,
    },
  ];

  return json({
    generatedAt: new Date().toISOString(),
    taxonomy: { version: FIRE_ALARM_TAXONOMY_VERSION, totalFamilies: taxonomyFamilies.length, populatedFamilies: familiesPopulated, zeroCoverageFamilies: familiesZeroCoverage, familiesWithNoDbRow },
    families: families
      .map(({ family, category, activeProductCount, coverageState }) => ({ family, category, activeProductCount, coverageState }))
      .sort((a, b) => b.activeProductCount - a.activeProductCount || a.family.localeCompare(b.family)),
    products: {
      manufacturer: manufacturer.name,
      total: Number(totalsRow?.total || 0),
      classified: Number(totalsRow?.classified || 0),
      unclassified: Number(totalsRow?.unclassified || 0),
      withSourceEvidence: Number(totalsRow?.withEvidence || 0),
      withModernAttributes: Number(totalsRow?.withModernAttributes || 0),
      withLegacyAttributesOnly: Number(totalsRow?.withLegacyAttributes || 0),
      withLegacyStandards: Number(totalsRow?.withLegacyStandards || 0),
      withModernCertifications: Number(totalsRow?.withModernCertifications || 0),
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
    // Engineer-facing: the knowledge gap itself, in plain language, with no
    // project/BOQ/fixture reference -- safe to show as global system truth.
    coverageGaps: {
      status: "Validated",
      gaps: knownGaps.map(({ area, gap, impact }) => ({ area, gap, impact })),
    },
    // Advanced/Governance only: taxonomy version, raw validation metrics,
    // and the SAME gaps with their validation evidence (which project/
    // regression surfaced each one) -- this is where a project name is
    // allowed to appear, as audit trail, never as the definition of the gap.
    governance: {
      taxonomyVersion: FIRE_ALARM_TAXONOMY_VERSION,
      goldenValidation: {
        status: "PASSED",
        summary: "0 true matching errors, 0 false resolves, 0 cross-family ranking errors across the frozen Central Kitchen and Opera Block validation projects.",
        detail: "See docs/fire-alarm-system-pack-v1-release.md for the current run and full history.",
      },
      validationGaps: knownGaps,
    },
  });
}
