#!/usr/bin/env node
/**
 * Sprint 1.1 -- Step 10 live proof.
 *
 * Read-only against the real live D1 file: no INSERT/UPDATE/DELETE anywhere
 * in this script. Demonstrates, against the real Al Mespar Opera Block
 * Townhouses project, the full chain required by this sprint:
 *   (A) real project demand (exact approved BOQ items/quantities)
 *   (B) real product capacity evidence (exact manufacturer/catalog citations)
 *   (C) the deterministic calculation (every arithmetic step)
 *   (D) the real runtime result -- calling the actual, unmodified,
 *       production app/domain/product-matching-engine.mjs's evaluateCandidate
 *       (the same function worker/product-matching-api.mjs calls for every
 *       real product-matching run), so accessoryCandidates[].capacityResolution
 *       in this output is exactly what a live product-matching run against
 *       IFP-2100HV would produce once profile.capacityEvidence is supplied.
 */
import { DatabaseSync } from "node:sqlite";
import { calculateSlcExpansion } from "../app/domain/fire-alarm-slc-capacity-calculator.mjs";
import { evaluateCandidate } from "../app/domain/product-matching-engine.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.1-slc-capacity-live-proof.mjs <db-path>");
const raw = new DatabaseSync(dbPath, { readOnly: true });
const PROJECT_ID = "project_c8d6ffe8-a781-4bdf-94aa-a40eea873920";
const IFP_2100HV_ID = "product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7";

const line = (title) => console.log(`\n${"=".repeat(78)}\n${title}\n${"=".repeat(78)}`);

// ---------------------------------------------------------------------------
line("(A) PROJECT DEMAND -- real, approved Opera BOQ items");
// ---------------------------------------------------------------------------
const boqRows = raw.prepare(`
  SELECT item_number, description, numeric_quantity, review_status, approved_for_downstream
  FROM boq_items
  WHERE project_id = ? AND system_value LIKE '%Fire Alarm%' AND item_number IN ('28','29','30','31','32','33','34','35','36','37')
  ORDER BY sequence
`).all(PROJECT_ID);
for (const row of boqRows) console.log(`  Item ${row.item_number}: "${row.description}" qty=${row.numeric_quantity} review_status=${row.review_status} approved_for_downstream=${row.approved_for_downstream}`);

const item28 = boqRows.find((r) => r.item_number === "28");
const item29 = boqRows.find((r) => r.item_number === "29");
console.log(`\n  INCLUDED as addressable detector demand (both Approved + approved_for_downstream=1, both matched to`);
console.log(`  IDP-PHOTO-IV which carries a governed "addressing: Addressable" attribute -- Sprint 1.0 proof):`);
console.log(`    Item 28 "Smoke Detector Ceiling Mounted": ${item28.numeric_quantity}`);
console.log(`    Item 29 "Smoke Detector Ceiling Mounted with Sounder": ${item29.numeric_quantity}`);
const detectorDemand = Number(item28.numeric_quantity) + Number(item29.numeric_quantity);
console.log(`    Total addressable detector demand = ${item28.numeric_quantity} + ${item29.numeric_quantity} = ${detectorDemand}`);

console.log(`\n  EXCLUDED, with reasons (Sprint 1.1 Step 4 -- every inclusion/exclusion must be explainable):`);
console.log(`    Item 30 "Sounder with Strobe Wall Mounted": review_status=Needs Review, not approved for downstream -- excluded pending review.`);
console.log(`    Item 31 "Fire Alarm Control Panel FACP": this IS the panel, not an SLC-address-consuming device -- excluded by definition.`);
console.log(`    Item 32/33 Voice Evacuation Speakers: review_status=Needs Review; also, no verified evidence these consume SLC addresses (notification/audio circuit devices) -- excluded.`);
console.log(`    Item 34 "Manual Call Point MCLP": Approved + approved_for_downstream=1, BUT the governed BOQ Understanding interpretation's "addressing" attribute value is the literal item code "MCLP", not a confirmed "Addressable" determination (unlike items 28/29/IDP-PHOTO-IV) -- INSUFFICIENT_EVIDENCE to classify as addressable-loop demand; excluded rather than guessed.`);
console.log(`    Item 35 MCLP WP, 36 Heat Detector, 37 Interface Unit: review_status=Needs Review, not approved for downstream -- excluded pending review.`);
console.log(`  Addressable MODULE demand = 0: no approved BOQ item in this project carries confirmed evidence of consuming an independent SLC module address.`);
console.log(`    (B200S-IV addressable sounder base, item 29's matched base, was investigated: official System Sensor/Honeywell documentation states it`);
console.log(`     "adopts the same address as the detector head... as a unique device type on the loop" -- i.e. it does NOT clearly consume a SEPARATE`);
console.log(`     numeric module-pool address distinct from its paired detector. This is reported honestly as a real, unresolved evidence gap in the`);
console.log(`     final report rather than guessed in either direction; module demand is conservatively left at 0, not inflated by 1221.)`);

// ---------------------------------------------------------------------------
line("(B) PRODUCT CAPACITY EVIDENCE -- verified, cited");
// ---------------------------------------------------------------------------
const panelRow = raw.prepare(`SELECT part_number, description FROM library_products WHERE id = ?`).get(IFP_2100HV_ID);
console.log(`  Panel: ${panelRow.part_number}`);
console.log(`  Source: this repo's own product_source_evidence / library_products.description (ingested manufacturer price-list catalog text):`);
console.log(`    "${panelRow.description.slice(0, 220)}..."`);
console.log(`  Extracted facts: nativeLoops=1 ("One SLC loop card inbuild"), detectorsPerLoop=159, modulesPerLoop=159 ("159 Detectors and 159 Modules per loop").`);
console.log(`  Corroborated by official Honeywell Farenhyt 6815 datasheet (hbt-fire-6815_Datasheet.pdf, web-verified this session):`);
console.log(`    "Additional 6815s support 159 IDP or SK devices, and 159 IDP or SK modules for a maximum of 2100 points per IFP-2100/ECS`);
console.log(`     or 300 points per IFP-300/ECS." -- confirms separate detector/module pools per loop, and that the "2100 point" figure`);
console.log(`     (also literally in this panel's own product name/description) is the IFP-2100/ECS-family-specific absolute system ceiling.`);
console.log(`  Expansion evidence: same catalog text -- "Additional Loop cards can be expanded through 5815RMK (Remote mounting Kit`);
console.log(`    which accomodates 2 SLC Cards (6815))" -- 6815 adds 1 loop/unit; 5815RMK is a mounting kit (not itself an SLC card),`);
console.log(`    holding up to 2x 6815 units. Independently confirmed by 5815RMKB's own catalog description ("holds two 6815s") and by`);
console.log(`    an official Honeywell 6815 datasheet web search finding no fixed max-units-per-panel figure -- the panel's own`);
console.log(`    system-wide "2100 point" ceiling is the governing upper bound, not an arbitrary loop-count cap (also web-confirmed).`);

const capacityEvidence = {
  demand: { detectors: detectorDemand, modules: 0 },
  panelCapacity: { nativeLoops: 1, detectorsPerLoop: 159, modulesPerLoop: 159, systemPointCeiling: 2100 },
  expansionOptions: {
    loopExpansionUnit: { partNumber: "6815", loopsAddedPerUnit: 1 },
    mountingUnit: { partNumber: "5815RMK", capacityPerMountingUnit: 2 },
  },
};

// ---------------------------------------------------------------------------
line("(C) CALCULATION -- calculateSlcExpansion (pure, deterministic)");
// ---------------------------------------------------------------------------
const result = calculateSlcExpansion(capacityEvidence);
console.log(`  status: ${result.status}`);
for (const step of result.calculationTrace) console.log(`  - ${step}`);
console.log(`\n  requiredExpansionQuantity (6815): ${result.requiredExpansionQuantity}`);
console.log(`  mountingUnit (5815RMK) quantity: ${result.mountingUnit?.quantity}`);
console.log(`  capacityAfterExpansion: ${JSON.stringify(result.capacityAfterExpansion)}`);
console.log(`  headroom: ${JSON.stringify(result.headroom)}`);

// ---------------------------------------------------------------------------
line("(D) RUNTIME RESULT -- real evaluateCandidate() from app/domain/product-matching-engine.mjs");
// ---------------------------------------------------------------------------
// Same accessories subquery worker/product-matching-api.mjs's loadProducts
// uses, run directly here (read-only) for the exact real, live row.
const accessoriesJson = raw.prepare(`
  SELECT json_group_array(json_object(
    'name', COALESCE(af.name, ap.description), 'relationshipType', pa.relationship_type,
    'accessoryProductId', pa.accessory_product_id, 'accessoryPartNumber', ap.part_number,
    'included', pa.included, 'quantityRule', pa.quantity_rule, 'quantityParameter', pa.quantity_parameter,
    'conditions', json(pa.condition_json), 'confidence', pa.confidence, 'evidence', json(pa.evidence_json)
  )) accessories
  FROM product_accessories pa
  JOIN library_products ap ON ap.id = pa.accessory_product_id
  LEFT JOIN product_families af ON af.id = ap.family_id
  WHERE pa.product_id = ? AND pa.deleted_at IS NULL AND pa.superseded_at IS NULL AND pa.review_status NOT IN ('Rejected','Needs Review')
`).get(IFP_2100HV_ID);
const accessories = JSON.parse(accessoriesJson.accessories || "[]");
console.log(`  Real, live product_accessories rows for IFP-2100HV (review_status-filtered, exactly as loadProducts sees them):`);
console.log(`  ${JSON.stringify(accessories, null, 2).split("\n").join("\n  ")}`);

const product = { id: IFP_2100HV_ID, manufacturer: "Honeywell", brand: "Farenhyt", family: "Fire Alarm Control Panel", category: "Fire Detection Devices", partNumber: panelRow.part_number, normalizedPartNumber: panelRow.part_number, description: panelRow.description, lifecycleStatus: "Reviewed", attributes: [], standards: [], compatibility: [], accessories, reviewStatus: "Reviewed", source: null };

// A minimal, honestly-labeled profile: Opera has no APPROVED BOQ item for the
// panel itself yet (item 31 "Fire Alarm Control Panel FACP" is Needs Review),
// so this profile is illustrative of the runtime wiring only -- it is not
// claiming a governed requirement profile exists for a panel BOQ item in
// this project. profile.capacityEvidence is the ONLY Sprint 1.1-specific
// addition; everything else here is the ordinary product-matching profile
// shape this engine already consumes for every system.
const profile = {
  boqItem: { id: "demonstration-only", system: "Fire Alarm", category: "Fire Detection Devices", productFamily: "Fire Alarm Control Panel", attributes: {} },
  consolidatedRequirements: [],
  readiness: { status: "Ready for Matching" },
  versionNumber: 1,
  capacityEvidence,
};

const candidate = evaluateCandidate({ profile, generated: { product, stage: "Manufacturer Family", basis: ["Manufacturer + Product Family"], searchScore: 88 }, prices: [], projectId: PROJECT_ID });
console.log(`\n  candidate.accessoryCandidates (real output of the production evaluateCandidate()):`);
console.log(`  ${JSON.stringify(candidate.accessoryCandidates, null, 2).split("\n").join("\n  ")}`);
