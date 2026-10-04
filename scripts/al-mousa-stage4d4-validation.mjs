// STAGE 4D-4 -- AL MOUSA SCHOOL READ-ONLY EARLY-VALIDATION RUN.
//
// Re-runs the CURRENT matching pipeline (runProductMatching with the Stage 4D-3
// technical decision and the Stage 4D-4 auto-reject eligibility attach) against
// the Al Mousa School project's actual persisted data -- the saved requirement
// profiles, the canonical product catalog (project-scoped compatibility /
// accessories), and the live price records -- and DRIES-RUN the deterministic
// auto-reject policy over every produced candidate.
//
// THIS SCRIPT IS STRICTLY READ-ONLY: the database is opened with the
// readOnly flag (writes are refused by the driver), no product_match_reviews
// row is created, no candidate review_status is changed, and no profile or run
// is created. It only classifies and reports. If no candidate is
// deterministically rejection-eligible it reports ZERO -- it never fabricates
// a rejection case.
//
// The report answers the mandatory validation questions:
//   AL_MOUSA_TOTAL_CANDIDATES      candidates produced by the current engine
//   AL_MOUSA_AUTO_REJECT_ELIGIBLE  candidates the Stage 4D-4 gate would allow
//   AL_MOUSA_ENGINEER_EXCEPTION    candidates routed to ENGINEER_EXCEPTION
//   AL_MOUSA_STALE                 candidates routed to STALE
//   AL_MOUSA_ACCEPTABLE            candidates in the acceptable states
//   plus the top rejection and exception reasons, and an explicit check that
//   the previously-known compatibilityTarget / missing-information cases
//   (Heat detector, Combined smoke and heat detector, ...) stay
//   ENGINEER_EXCEPTION -- never auto-rejects.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { canAutoRejectTechnicalCandidate } from "../app/domain/auto-reject-policy.mjs";
import { projectMatchingProduct } from "../app/domain/matching-product-projection.mjs";

const AL_MOUSA_PROJECT_ID = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
const DEFAULT_DB = ".wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";

const flag = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const asJson = process.argv.includes("--json");
const dbPath = flag("--db", DEFAULT_DB);
const projectId = flag("--project", AL_MOUSA_PROJECT_ID);

if (!existsSync(dbPath)) {
  console.error(`DB snapshot not found: ${dbPath}`);
  process.exit(2);
}
const db = new DatabaseSync(dbPath, { readOnly: true });

const parse = (value, fallback) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };

// mirror of the live worker catalog loader (project-scoped compatibility and
// accessories, canonical discovery predicate, modern attributes).
const loadProducts = (id) => db.prepare(`
  SELECT p.*, m.name manufacturer, b.name brand, f.name family, f.engineering_domain category,
  (SELECT json_group_array(json_object(
    'attribute_name', a.attribute_name,
    'value_json', a.value_json,
    'original_value', a.original_value,
    'normalized_value', a.normalized_value,
    'unit', a.unit,
    'source_id', a.source_id,
    'evidence_json', a.evidence_json,
    'confidence', a.confidence,
    'review_status', a.review_status,
    'created_at', a.created_at
  )) FROM product_attributes a
  WHERE a.product_id=p.id
    AND a.deleted_at IS NULL
    AND a.superseded_at IS NULL
    AND a.review_status<>'Rejected'
  ORDER BY a.created_at DESC) modern_attributes, (SELECT json_group_array(json_object('targetItem', r.right_entity_id, 'relationshipType', r.relationship_type, 'conditions', r.conditions)) FROM engineering_relationships r WHERE r.left_entity_type='Product' AND r.left_entity_id=p.id AND r.status='Approved' AND (r.project_id IS NULL OR r.project_id=?)) compatibility, (SELECT json_group_array(json_object('name', COALESCE(af.name, ap.description), 'relationshipType', pa.relationship_type, 'accessoryProductId', pa.accessory_product_id, 'accessoryPartNumber', ap.part_number, 'included', pa.included, 'quantityRule', pa.quantity_rule, 'quantityParameter', pa.quantity_parameter, 'conditions', json(pa.condition_json), 'confidence', pa.confidence, 'evidence', json(pa.evidence_json))) FROM product_accessories pa JOIN library_products ap ON ap.id=pa.accessory_product_id LEFT JOIN product_families af ON af.id=ap.family_id WHERE pa.product_id=p.id AND pa.deleted_at IS NULL AND pa.superseded_at IS NULL AND pa.review_status NOT IN ('Rejected','Needs Review')) accessories, (SELECT json_object('sourceId', e.source_id, 'sheet', e.sheet, 'row', e.row_number, 'cells', e.cells) FROM product_source_evidence e WHERE e.product_id=p.id ORDER BY e.created_at LIMIT 1) source
  FROM canonical_library_products p
  JOIN product_manufacturers m ON m.id=p.manufacturer_id
  LEFT JOIN product_brands b ON b.id=p.brand_id
  LEFT JOIN product_families f ON f.id=p.family_id
  WHERE p.requested_product_id=p.id AND p.identity_status='Active' AND p.review_status<>'Rejected' AND EXISTS (SELECT 1 FROM product_source_evidence e WHERE e.product_id=p.id)
`).all(id).map((row) => {
  const projected = projectMatchingProduct(row, parse(row.modern_attributes, []));
  return {
    id: row.id,
    manufacturer: row.manufacturer,
    brand: row.brand,
    family: row.family,
    category: row.category,
    partNumber: row.part_number,
    normalizedPartNumber: row.normalized_part_number,
    description: row.description,
    lifecycleStatus: row.lifecycle_status,
    attributes: projected.attributes,
    standards: projected.standards,
    compatibility: parse(row.compatibility, []),
    accessories: parse(row.accessories, []),
    reviewStatus: row.review_status,
    source: parse(row.source, null),
  };
});

const loadPrices = () => db.prepare("SELECT product_id, project_id, approval_status, downstream_use, valid_until FROM price_records").all()
  .map((row) => ({ productId: row.product_id, projectId: row.project_id, approvalStatus: row.approval_status, downstreamUse: row.downstream_use, validUntil: row.valid_until }));

const alreadyKnownMissingInformationItems = [
  "boqitem_5af0a8eb-7233-4dcb-bf46-8b7a28ffc5bf", // C -- Heat detector
  "boqitem_b2a8235a-dcea-418d-948d-c0c365350e41", // D -- Combined smoke and heat detector
  "boqitem_e613397f-ddaf-4a18-85ef-dd7791d8aac4", // G -- Main FACP
];

// ---------------------------------------------------------------------------
// Run the pipeline once per Al Mousa item that has a current persisted profile.
// ---------------------------------------------------------------------------
const products = loadProducts(projectId);
const prices = loadPrices();

const items = db.prepare("SELECT id, item_number, sequence, description, system_value, category, subcategory FROM boq_items WHERE project_id=? AND row_type='BOQ Item' AND approved_for_downstream=1 AND review_status IN ('Approved','Accepted','Auto Verified') ORDER BY sequence").all(projectId);
const profilesByItem = new Map();
for (const item of items) {
  const row = db.prepare("SELECT profile, version_number FROM requirement_profile_versions WHERE boq_item_id=? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1").get(item.id);
  if (row) profilesByItem.set(item.id, parse(row.profile, null));
}

const totals = {
  items: items.length,
  itemsWithCurrentProfile: profilesByItem.size,
  itemsWithoutCurrentProfile: items.length - profilesByItem.size,
  notReadyRuns: 0,
  candidateRunCount: 0,
  candidates: 0,
  autoRejectEligible: 0,
  engineerException: 0,
  stale: 0,
  acceptable: 0,
  missingDecision: 0,
};
const exceptionReasonCounts = new Map();
const rejectionReasonCounts = new Map();
const missingInformationItems = [];
const eligibleSamples = [];

for (const item of items) {
  const profile = profilesByItem.get(item.id);
  if (!profile) continue;
  const matching = runProductMatching({ profile, products, prices, projectId });
  if (matching.status === "Not Ready" || !matching.candidates?.length) {
    totals.notReadyRuns += 1;
    if (alreadyKnownMissingInformationItems.includes(item.id) && !matching.candidates?.length) {
      missingInformationItems.push({ item, observation: "no candidates produced (Not Ready or no match)" });
    }
    continue;
  }
  totals.candidateRunCount += 1;
  for (const candidate of matching.candidates) {
    totals.candidates += 1;
    const decision = candidate.technicalDecision || null;
    const eligibility = canAutoRejectTechnicalCandidate(decision, {
      governingBasisCurrent: true,
      candidate,
      manualCandidate: null,
      approvedDeviationRequired: false,
      technicalSubstitutionReview: false,
    });
    if (!decision) { totals.missingDecision += 1; continue; }
    const state = decision.state;
    if (state === "TECHNICALLY_UNACCEPTABLE" || state === "TECHNICALLY_ACCEPTABLE" || state === "TECHNICALLY_ACCEPTABLE_WITH_WARNING") {
      if (eligibility.eligible) {
        totals.autoRejectEligible += 1;
        rejectionReasonCounts.set(eligibility.reasonCode, (rejectionReasonCounts.get(eligibility.reasonCode) || 0) + 1);
        if (eligibleSamples.length < 10) eligibleSamples.push({ item: { id: item.id, description: item.description }, product: candidate.product.partNumber, reasonCode: eligibility.reasonCode });
      } else if (state === "TECHNICALLY_UNACCEPTABLE") {
        totals.acceptable += 0; // UNACCEPTABLE but gate-blocked (defensive) still counts as its own bucket below
        if (alreadyKnownMissingInformationItems.includes(item.id)) missingInformationItems.push({ item, observation: `TECHNICALLY_UNACCEPTABLE yet gate-ineligible (${eligibility.blockReason}) -- NOT auto-rejected` });
      } else {
        totals.acceptable += 1;
      }
    } else if (state === "ENGINEER_EXCEPTION") {
      totals.engineerException += 1;
      for (const reason of decision.exceptionReasons || []) {
        exceptionReasonCounts.set(reason, (exceptionReasonCounts.get(reason) || 0) + 1);
      }
      if (alreadyKnownMissingInformationItems.includes(item.id) && missingInformationItems.every((entry) => entry.item.id !== item.id)) {
        missingInformationItems.push({ item, observation: "ENGINEER_EXCEPTION kept (never auto-rejected)" });
      }
    } else if (state === "STALE") {
      totals.stale += 1;
    }
  }
}

const topExceptions = [...exceptionReasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
const topRejections = [...rejectionReasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

const report = {
  stage: "4D-4",
  mode: "READ_ONLY_DRY_RUN",
  project: "Al Mousa School",
  projectId,
  dbPath,
  catalog: { products: products.length, prices: prices.length },
  items: totals.items,
  itemsWithCurrentProfile: totals.itemsWithCurrentProfile,
  itemsWithoutCurrentProfile: totals.itemsWithoutCurrentProfile,
  notReadyRuns: totals.notReadyRuns,
  candidateRunCount: totals.candidateRunCount,
  AL_MOUSA_TOTAL_CANDIDATES: totals.candidates,
  AL_MOUSA_AUTO_REJECT_ELIGIBLE: totals.autoRejectEligible,
  AL_MOUSA_ENGINEER_EXCEPTION: totals.engineerException,
  AL_MOUSA_STALE: totals.stale,
  AL_MOUSA_ACCEPTABLE_EVALUATIONS: totals.acceptable,
  topRejectionReasons: topRejections.length ? Object.fromEntries(topRejections) : "NONE -- no deterministic auto-reject eligible candidate",
  topEngineerExceptionReasons: Object.fromEntries(topExceptions),
  previouslyKnownMissingInformationCases: missingInformationItems.map((entry) => ({ itemNumber: entry.item.item_number, description: entry.item.description, observation: entry.observation })),
  safety: { safetyApprovalRequestsCreated: 0, pricingChanged: false, candidatesDeleted: 0, candidateStatusChanged: false, reviewRowsCreated: 0 },
  eligibleSamples,
  engine: { runProductMatching: "current working tree", decisionsAttached: true, eligibilityAttached: true },
};

if (asJson) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  const print = (line) => console.log(line);
  print("STAGE 4D-4 AL MOUSA READ-ONLY VALIDATION -- deterministic auto-reject policy dry-run");
  print("----------------------------------------------------------------------------------------");
  print(`DB snapshot:             ${report.dbPath} (READ-ONLY)`);
  print(`Project:                 ${report.project} (${report.projectId})`);
  print(`Catalog:                 ${report.catalog.products} active reviewed products, ${report.catalog.prices} price records`);
  print(`Al Mousa BOQ items:      ${report.items} (${report.itemsWithCurrentProfile} with a current requirement profile, ${report.itemsWithoutCurrentProfile} without)`);
  print(`Item runs:               ${report.candidateRunCount} produced candidates; ${report.notReadyRuns} had no current evaluable run (Not Ready / zero candidates)`);
  print("");
  print(`AL_MOUSA_TOTAL_CANDIDATES      = ${report.AL_MOUSA_TOTAL_CANDIDATES}`);
  print(`AL_MOUSA_AUTO_REJECT_ELIGIBLE  = ${report.AL_MOUSA_AUTO_REJECT_ELIGIBLE}`);
  print(`AL_MOUSA_ENGINEER_EXCEPTION    = ${report.AL_MOUSA_ENGINEER_EXCEPTION}`);
  print(`AL_MOUSA_STALE                 = ${report.AL_MOUSA_STALE}`);
  print(`AL_MOUSA_ACCEPTABLE_EVALUATIONS= ${report.AL_MOUSA_ACCEPTABLE_EVALUATIONS}`);
  print("");
  print(`Top rejection reasons:   ${report.topRejectionReasons}`);
  print(`Top engineer-exception reasons:`);
  for (const [reason, count] of topExceptions) print(`  - ${reason}: ${count}`);
  print("");
  print("Previously-known compatibilityTarget / missing-information cases (must stay ENGINEER_EXCEPTION, never auto-reject):");
  for (const entry of report.previouslyKnownMissingInformationCases) {
    print(`  - ${entry.itemNumber} ${entry.description}: ${entry.observation}`);
  }
  print("");
  print(`Writes performed:        safetyApprovalRequests=${report.safety.safetyApprovalRequestsCreated}, reviewRows=${report.safety.reviewRowsCreated}, candidateStatusChanged=${report.safety.candidateStatusChanged}, pricingChanged=${report.safety.pricingChanged}`);
  print(`ENGINEER_EXCEPTION_PROTECTION: ${report.AL_MOUSA_AUTO_REJECT_ELIGIBLE === 0 ? "VERIFIED -- zero deterministic auto-reject eligible candidates; nothing auto-rejected" : `VIOLATED -- ${report.AL_MOUSA_AUTO_REJECT_ELIGIBLE} eligible (unexpected)`}`);
  print("----------------------------------------------------------------------------------------");
  print("READ-ONLY DRY RUN COMPLETE -- no project data was written.");
}

db.close();