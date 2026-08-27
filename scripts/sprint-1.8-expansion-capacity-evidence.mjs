#!/usr/bin/env node
/**
 * Mini Sprint 1.8 -- close the last two hardcoded expansion-capacity
 * constants in the SLC sizing caller (6815 loops-added-per-unit=1,
 * 5815RMK capacity-per-kit=2) by writing them as structured, provenance-
 * backed Product Knowledge / relationship facts, per this sprint's explicit
 * authorization to use stronger evidence than 6815/5815RMK's own broken
 * catalog descriptions.
 *
 * 1) added_slc_loops -- NEW library_products.attributes entry on 6815.
 *    Evidence: the REAL, official Honeywell Farenhyt 6815 datasheet
 *    (document 351620 | Rev A | 11/17, (c) 2017 Honeywell International Inc.,
 *    fetched and read this session), which states under its own
 *    "SYSTEM CAPACITY" heading: "6815 Capacity: 159 IDP or SK sensors and
 *    159 IDP or SK modules per loop" -- i.e. the 6815's own rated capacity
 *    is expressed on a PER-LOOP basis, matching the SAME per-loop framing
 *    IFP-2100's own catalog description uses for its native "One SLC loop
 *    card inbuild" ("159 Detectors and 159 Modules per loop"). The 6815's
 *    formal product name ("Signaling Line Circuit Expander", singular
 *    "Circuit") and its own product overview sentence ("The 6815 is A
 *    signaling line circuit (SLC) expander... Use the 6815 to add more SLC
 *    devices of the same protocol") are consistent with one loop per unit.
 *    This is NOT one single explicit "adds 1 loop" sentence -- it is a
 *    reasoned, disclosed reading of two independent pieces of real,
 *    official/manufacturer evidence, recorded at confidence 85 (not 95+)
 *    to reflect that honestly.
 *
 * 2) 5815RMK-holds-2x6815 -- ALREADY structured (Sprint 0.9,
 *    product_accessories.quantity_parameter=2, review_status=Approved).
 *    This script only ADDS a stronger, cleaner corroborating evidence entry
 *    (the same official datasheet's own "ACCESSORIES" section: "5815RMK:
 *    Remote Mounting Kit Cabinet holds two 6815s. Red cabinet") to the
 *    EXISTING approved rows' evidence_json array -- it does not change
 *    quantity_parameter, review_status, or any other field.
 *
 * Idempotent: skips products/rows that already carry this exact evidence.
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.8-expansion-capacity-evidence.mjs <db-path>");
const raw = new DatabaseSync(dbPath);
const id = (prefix) => `${prefix}_${randomUUID()}`;
const MODEL_VERSION = "sprint-1.8-expansion-capacity-evidence-1.0.0";
const OFFICIAL_DATASHEET = "Honeywell Farenhyt 6815 Signaling Line Circuit Expander Datasheet, document 351620 | Rev A | 11/17, (c) 2017 Honeywell International Inc.";

// --- 1) added_slc_loops on 6815 ---------------------------------------
const product6815 = raw.prepare("SELECT id, attributes FROM library_products WHERE part_number = '6815'").get();
if (!product6815) throw new Error("6815 product not found.");
const existing6815Attrs = JSON.parse(product6815.attributes || "[]");
if (existing6815Attrs.some((a) => a.name === "added_slc_loops")) {
  console.log("SKIP: 6815 already has added_slc_loops.");
} else {
  const newAttr = {
    name: "added_slc_loops",
    value: 1,
    origin: "EXTRACTED",
    confidence: 85,
    sourceText: `${OFFICIAL_DATASHEET} -- "6815 Capacity: 159 IDP or SK sensors and 159 IDP or SK modules per loop" (SYSTEM CAPACITY section) + "The 6815 is a signaling line circuit (SLC) expander..." (product overview) -- capacity expressed per-loop, singular "Circuit" naming, consistent with IFP-2100's own native "One SLC loop card inbuild" per-loop framing. Reasoned reading of real evidence, not one explicit numeral -- recorded at confidence 85, not higher.`,
    extractionMethod: "sprint-1.8-cross-referenced-official-datasheet",
  };
  const merged = [...existing6815Attrs, newAttr];
  raw.exec("BEGIN IMMEDIATE");
  raw.prepare("UPDATE library_products SET attributes = ? WHERE id = ?").run(JSON.stringify(merged), product6815.id);
  raw.exec("COMMIT");
  console.log("WROTE: 6815.added_slc_loops = 1 (confidence 85)");
}

// --- 2) corroborate 5815RMK/5815RMKB -> 6815 quantity_parameter=2 -----
const accessoryRows = raw.prepare(`
  SELECT pa.id, p.part_number left_pn, pa.evidence_json
  FROM product_accessories pa
  JOIN library_products p ON p.id = pa.product_id
  JOIN library_products ap ON ap.id = pa.accessory_product_id
  WHERE ap.part_number = '6815' AND p.part_number IN ('5815RMK','5815RMKB') AND pa.deleted_at IS NULL AND pa.superseded_at IS NULL
`).all();

for (const row of accessoryRows) {
  const evidence = JSON.parse(row.evidence_json || "[]");
  const alreadyHasOfficialDatasheet = evidence.some((e) => e.sourceType === "Manufacturer Datasheet (Official)" && e.fileName === "hbt-fire-6815_Datasheet.pdf (doc 351620)");
  if (alreadyHasOfficialDatasheet) {
    console.log(`SKIP: ${row.left_pn}->6815 accessory row already has the official datasheet corroboration.`);
    continue;
  }
  const label = row.left_pn === "5815RMK" ? "Red cabinet" : "Black cabinet";
  const quote = row.left_pn === "5815RMK" ? "5815RMK: Remote Mounting Kit Cabinet holds two 6815s. Red cabinet" : "5815RMKB: Remote Mounting Kit Cabinet holds two 6815s. Black cabinet.";
  const newEvidenceEntry = {
    sourceType: "Manufacturer Datasheet (Official)",
    fileName: "hbt-fire-6815_Datasheet.pdf (doc 351620)",
    authority: "Manufacturer",
    note: `Official Honeywell 6815 datasheet's own ACCESSORIES section: "${quote}" (${label}) -- independent, stronger corroboration of the already-approved quantity_parameter=2, fetched and read directly this session.`,
  };
  const updated = [...evidence, newEvidenceEntry];
  raw.exec("BEGIN IMMEDIATE");
  raw.prepare("UPDATE product_accessories SET evidence_json = ? WHERE id = ?").run(JSON.stringify(updated), row.id);
  raw.exec("COMMIT");
  console.log(`WROTE: ${row.left_pn}->6815 accessory row corroborated with official datasheet (quantity_parameter unchanged).`);
}
