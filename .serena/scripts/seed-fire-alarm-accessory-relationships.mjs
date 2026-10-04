#!/usr/bin/env node
/**
 * Sprint 0.9 -- Accessories + Compatibility Knowledge.
 *
 * Inserts evidence-backed rows into product_accessories (the authoritative,
 * already-runtime-wired, GLOBAL product-to-product accessory table -- see
 * worker/product-matching-api.mjs's loadProducts, which already reads it into
 * product.accessories for Product Matching, and worker/product-price-library-api.mjs's
 * GET /api/products/:id, which already reads it for the product detail view).
 * No schema change; no new table. Scoped to exactly the products named in the
 * Sprint 0.9 brief plus their directly-evidenced accessory pairs -- never a
 * catalog-wide enrichment.
 *
 * Evidence used (see EVIDENCE_NOTE per row for the specific citation):
 *  - This project's own catalog data: library_products.description /
 *    product_source_evidence (KSA Honeywell Farenhyt Series Price List -2023.xlsx,
 *    sheet "2023 Farenhyt", explicit row numbers) -- every IDP-* detector head's
 *    own description literally states "(Base Not Included)"; every IFP-2100*
 *    panel's own description literally states "Additional Loop cards can be
 *    expanded through 5815RMK ... (6815)"; 5815RMK/5815RMKB's own description
 *    literally states "holds two 6815s".
 *  - Official Honeywell Farenhyt datasheets (web-confirmed, since project/local
 *    evidence alone established the base requirement but not which base model):
 *    B501 confirmed compatible with IDP-PHOTO, IDP-HEAT/-HT, IDP-FIRE-CO;
 *    B200SR/B200S sounder base family confirmed compatible with IDP-PHOTO.
 *  - The real historical Al Mespar Opera Block Townhouses final quotation
 *    (scripts/regression-opera-block-fas.mjs GROUND_TRUTH, sn1-16) used ONLY
 *    as corroboration, never as sole justification: sn9/sn10 IDP-PHOTO-IV+B501-IV
 *    (516ea, 1:1), sn11/sn12 IDP-PHOTO-IV+B200S-IV (1221ea, 1:1, "with Sounder"
 *    line item), sn13/sn14 IDP-FIRE-CO-IV+B501-IV, sn15/sn16 IDP-HEAT-ROR-IV+B501-IV,
 *    sn1/sn7/sn8 IFP-2100ECSHV/5815RMK/6815 (5815RMK holds 2x6815, matches
 *    qty 5 RMK : qty 10 6815 in that project -- the per-project TOTAL count is
 *    project-engineered/capacity-derived and is NOT reproduced here).
 *
 * Classification (Sprint 0.9 Step 4):
 *  - GLOBAL_PRODUCT_RELATIONSHIP, review_status "Approved": detector-head -> its
 *    UNCONDITIONAL default compatible base (no sounder-type requirement).
 *  - CONDITIONAL_PRODUCT_RELATIONSHIP, review_status "Needs Review": the sounder
 *    base (IDP-PHOTO-IV -> B200S-IV). This repo has no automated mechanism
 *    (this sprint deliberately does not build one -- would be new comparison/
 *    evaluation logic, out of scope) to test a specific project's "audible
 *    notification required" condition against condition_json, so a conditional
 *    relationship stays "Needs Review" -- the existing product_accessories
 *    review-status filter (worker/product-matching-api.mjs's loadProducts:
 *    `review_status NOT IN ('Rejected','Needs Review')`) then correctly keeps
 *    it OUT of automatic resolution until an engineer confirms it for a given
 *    context, exactly matching Step 7's "remain Needs Validation rather than
 *    becoming resolved."
 *  - The IFP-2100*->5815RMK and 5815RMK->6815 relationships are real and
 *    unconditional (review_status "Approved") but their QUANTITY is
 *    CAPACITY_DEPENDENT (Step 9) -- quantity_rule says so explicitly,
 *    quantity_parameter is left null for the panel->RMK relationship (total
 *    unknown) and set to 2 for RMK->6815 (a real, evidenced PHYSICAL capacity
 *    cap per unit, not a project sizing calculation).
 *
 * Idempotent: skips a (product_id, accessory_product_id, relationship_type)
 * pair that already has a non-superseded, non-deleted row. Never updates or
 * deletes an existing row. Never touches library_products (identity, part
 * number, description, price, or any other column).
 *
 * Usage:
 *   node scripts/seed-fire-alarm-accessory-relationships.mjs <db-path> --dry-run
 *   node scripts/seed-fire-alarm-accessory-relationships.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-fire-alarm-accessory-relationships.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const findId = (partNumber) => { const row = db.prepare("SELECT id FROM library_products WHERE part_number = ?").get(partNumber); if (!row) throw new Error(`Product not found in catalog: ${partNumber}`); return row.id; };

const PRICE_LIST_EVIDENCE = (partNumber, note) => ({ sourceType: "Manufacturer Price List", fileName: "KSA Honeywell Farenhyt Series Price List -2023.xlsx", sheet: "2023 Farenhyt", authority: "Manufacturer", note: `${partNumber}'s own catalog description: ${note}` });
const DATASHEET_EVIDENCE = (url, note) => ({ sourceType: "Manufacturer Official Datasheet", url, authority: "Manufacturer", note });
const HISTORICAL_EVIDENCE = (rows, note) => ({ sourceType: "Historical Project Quotation (corroboration only, not sole justification)", project: "Al Mespar Opera Block Townhouses", rows, note });

const RELATIONSHIPS = [
  {
    product: "IDP-PHOTO-IV", accessory: "B501-IV", relationshipType: "Compatible Base",
    classification: "GLOBAL_PRODUCT_RELATIONSHIP", conditions: [], included: false, separatelyPriced: true,
    quantityRule: "One per detector", quantityParameter: 1, confidence: 95, reviewStatus: "Approved",
    evidence: [PRICE_LIST_EVIDENCE("IDP-PHOTO-IV", '"Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)"'), DATASHEET_EVIDENCE("https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-PHOTO-IV-Datasheet.pdf", "B501 4\" Mounting Base confirmed compatible with IDP-PHOTO in the official Honeywell IDP-PHOTO datasheet."), HISTORICAL_EVIDENCE("sn9 IDP-PHOTO-IV qty516 / sn10 B501-IV qty516 (1:1)", "Opera Block final quotation used B501-IV for the plain (no-sounder) smoke detector line.")],
  },
  {
    product: "IDP-HEAT-ROR-IV", accessory: "B501-IV", relationshipType: "Compatible Base",
    classification: "GLOBAL_PRODUCT_RELATIONSHIP", conditions: [], included: false, separatelyPriced: true,
    quantityRule: "One per detector", quantityParameter: 1, confidence: 90, reviewStatus: "Approved",
    evidence: [PRICE_LIST_EVIDENCE("IDP-HEAT-ROR-IV", '"...Rate-of-rise detection... (Base Not Included)(Ivory Color)"'), DATASHEET_EVIDENCE("https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/farenhyt/hbt-fire-IDP_Heat_HT%20Intelligent%20Thermal%20and%20Rate%20of%20Rise%20Thermal.pdf", "B501 confirmed compatible with IDP-HEAT family in official Honeywell IDP-HEAT datasheets."), HISTORICAL_EVIDENCE("sn15 IDP-HEAT-ROR-IV qty149 / sn16 B501-IV qty149 (1:1)", "Opera Block final quotation used B501-IV for this heat detector line.")],
  },
  {
    product: "IDP-FIRE-CO-IV", accessory: "B501-IV", relationshipType: "Compatible Base",
    classification: "GLOBAL_PRODUCT_RELATIONSHIP", conditions: [], included: false, separatelyPriced: true,
    quantityRule: "One per detector", quantityParameter: 1, confidence: 90, reviewStatus: "Approved",
    evidence: [PRICE_LIST_EVIDENCE("IDP-FIRE-CO-IV", '"Advanced multi-criteria fire/CO detector, Ivory color. (Base Not Included)"'), DATASHEET_EVIDENCE("https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/farenhyt/hbt-fire-IDP_Fire_CO_Datasheet.pdf", "B501 mounting bases (white/ivory/black) confirmed compatible with IDP-FIRE-CO in the official Honeywell IDP-FIRE-CO datasheet."), HISTORICAL_EVIDENCE("sn13 IDP-FIRE-CO-IV qty93 / sn14 B501-IV qty93 (1:1)", "Opera Block final quotation used B501-IV for this fire/CO detector line.")],
  },
  {
    product: "IDP-PHOTO-IV", accessory: "B200S-IV", relationshipType: "Sounding Base",
    classification: "CONDITIONAL_PRODUCT_RELATIONSHIP",
    conditions: [{ type: "requirement_condition", field: "notificationType", operator: "Equal", value: "Audible at detector location", note: "Applies only when the BOQ/specification requires audible notification (a sounder) at this detector's location -- e.g. \"Smoke Detector ... with Sounder\". Not automatically evaluated by this repository yet; requires explicit engineer confirmation for a given BOQ item." }],
    included: false, separatelyPriced: true, quantityRule: "One per detector, only when the sounder condition applies", quantityParameter: 1, confidence: 85, reviewStatus: "Needs Review",
    evidence: [DATASHEET_EVIDENCE("https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-PHOTO-IV-Datasheet.pdf", "IDP-PHOTO datasheet lists B200SR 6\" Sounder Base as a compatible base option alongside B501."), PRICE_LIST_EVIDENCE("B200S-IV", '"Ivory Color, Intelligent addressable sounder base... ANSI Temporal 3, ANSI Temporal 4, continuous tone, marching tone, and custom tone."'), HISTORICAL_EVIDENCE("sn11 IDP-PHOTO-IV qty1221 / sn12 B200S-IV qty1221 (1:1)", "Opera Block final quotation used B200S-IV specifically for the \"Smoke Detector Ceiling Mounted WITH SOUNDER\" line -- corroborates the condition, not sufficient alone.")],
  },
  ...["IFP-2100HV", "IFP-2100HVB", "IFP-2100ECSHV", "IFP-2100ECSHVB"].map((panel) => ({
    product: panel, accessory: "5815RMK", relationshipType: "Expansion Module",
    classification: "GLOBAL_PRODUCT_RELATIONSHIP (relationship) / CAPACITY_DEPENDENT (quantity)",
    conditions: [{ type: "capacity_dependent", note: "Only required if the project's SLC loop/point count exceeds the panel's single built-in loop card. Sizing calculation is explicitly out of scope for Sprint 0.9 -- reported as a remaining gap, not implemented." }],
    included: false, separatelyPriced: true, quantityRule: "CAPACITY_DEPENDENT -- quantity depends on the project's SLC loop/point count; not calculated by this system", quantityParameter: null, confidence: 90, reviewStatus: "Approved",
    evidence: [PRICE_LIST_EVIDENCE(panel, '"...Additional Loop cards can be expanded through 5815RMK (Remote mounting Kit which accomodates 2 SLC Cards (6815))..."'), HISTORICAL_EVIDENCE("sn1 IFP-2100ECSHV qty6 / sn7 5815RMK qty5 / sn8 6815 qty10", "Opera Block final quotation used this same expansion mechanism; the specific 5:10 ratio is that project's own loop-count engineering, not reproduced as a rule here.")],
  })),
  ...["5815RMK", "5815RMKB"].map((rmk) => ({
    product: rmk, accessory: "6815", relationshipType: "Expansion Module",
    classification: "GLOBAL_PRODUCT_RELATIONSHIP (relationship + physical cap) / CAPACITY_DEPENDENT (total units needed)",
    conditions: [{ type: "capacity_dependent", note: "An additional SLC loop card is only required if the project's SLC loop/point count requires it. How many 5815RMK units the project needs is a sizing calculation, explicitly out of scope for Sprint 0.9." }],
    included: false, separatelyPriced: true, quantityRule: "Up to 2 per 5815RMK unit (physical capacity, evidenced); total units required across the project is CAPACITY_DEPENDENT and not calculated by this system", quantityParameter: 2, confidence: 90, reviewStatus: "Approved",
    evidence: [PRICE_LIST_EVIDENCE(rmk, rmk === "5815RMKB" ? '"Remote Mounting Kit Cabinet holds two 6815s. Black cabinet."' : '"Remote Mounting Kit Cabinet holds two 6815s. Red Cabinet" (regression ground truth description)'), HISTORICAL_EVIDENCE("sn7 5815RMK qty5 / sn8 6815 qty10 (exactly 2 per RMK)", "Opera Block final quotation is fully consistent with the evidenced 2-per-unit physical capacity.")],
  })),
];

let inserted = 0, skipped = 0;
const findExisting = db.prepare("SELECT id FROM product_accessories WHERE product_id = ? AND accessory_product_id = ? AND relationship_type = ? AND superseded_at IS NULL AND deleted_at IS NULL");
const insert = db.prepare(`INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, quantity_parameter, scope, condition_json, included, separately_priced, source_id, evidence_json, confidence, review_status, version_number, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'Global', ?, ?, ?, NULL, ?, ?, ?, 1, 'sprint-0.9-accessory-seed', CURRENT_TIMESTAMP)`);

if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const rel of RELATIONSHIPS) {
    const productId = findId(rel.product);
    const accessoryId = findId(rel.accessory);
    const existing = findExisting.get(productId, accessoryId, rel.relationshipType);
    const label = `${rel.product} -> ${rel.accessory} [${rel.relationshipType}] (${rel.classification})`;
    if (existing) { console.log(`SKIP (already exists, id=${existing.id}): ${label}`); skipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${label} | reviewStatus=${rel.reviewStatus} confidence=${rel.confidence} qty=${rel.quantityRule}`);
    if (apply) { insert.run(randomUUID(), productId, accessoryId, rel.relationshipType, rel.quantityRule, rel.quantityParameter, JSON.stringify(rel.conditions), rel.included ? 1 : 0, rel.separatelyPriced ? 1 : 0, JSON.stringify(rel.evidence), rel.confidence, rel.reviewStatus); }
    inserted += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} relationship(s) ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped).`);
