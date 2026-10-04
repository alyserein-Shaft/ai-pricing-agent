#!/usr/bin/env node
/**
 * Fire Alarm System Pack v1 closure -- real Opera Block gap sn7 (5815RMK).
 *
 * 5815RMK's own catalog import evidence (product_source_evidence, "2023
 * Farenhyt" price list, row 15) has original_text "005815RMK" -- the real
 * historical source cell, not a data-entry error, and therefore never
 * rewritten by this script (library_products.description stays untouched,
 * exactly like every other script in this project).
 *
 * Because that description carries no real spec text, the deterministic
 * taxonomy classifier (classifyFireAlarmFamilyFromText) genuinely cannot
 * classify 5815RMK from its own row -- unlike its sibling 5815RMKB
 * ("Remote Mounting Kit Cabinet holds two 6815s. Black cabinet."), which
 * scripts/classify-fire-alarm-product-families.mjs already classified as
 * Enclosure from its own text.
 *
 * This script closes the gap with independent, external, official
 * manufacturer evidence instead of inferring anything from the "5815RMK" /
 * "5815RMKB" part-number suffix pair: Honeywell's own 5815RMK/5815RMKB
 * Remote Mounting Kit Product Installation Document (P/N 151391, Rev C)
 * describes both part numbers together and confirms 5815RMK is the red
 * cabinet, 5815RMKB the black cabinet -- independently corroborated by
 * this catalog's own IFP-2100/RFP-2100 family, where the identical
 * no-suffix=Red / -B-suffix=Black convention already holds across six
 * other real product pairs.
 *
 * Effect (idempotent, id-scoped, never touches description/part_number):
 *   - family_id set to the existing Enclosure family row (same one
 *     5815RMKB already carries), only if currently NULL.
 *   - one entry appended to the LEGACY library_products.attributes JSON
 *     array (color=Red, with a full source citation), only if a "color"
 *     entry is not already present -- same array, same append-only
 *     discipline, and the same {name,value,origin,confidence,sourceText,
 *     extractionMethod,source} shape already used for IFP-2100's
 *     manually-researched communication_interface entry (origin:
 *     "EXTRACTED", extractionMethod: "manual-research-official-
 *     documentation"), not the separate modern product_attributes table
 *     (which is FK-bound to product_sources/product_documents rows that
 *     do not exist for this external document).
 *
 * Usage: node scripts/correct-5815rmk-identity-evidence.mjs <path-to-d1-sqlite>
 */
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2];
if (!path) throw new Error("Provide the D1 SQLite database path.");
const db = new DatabaseSync(path);

const target = db.prepare("SELECT id, family_id, attributes FROM library_products WHERE part_number = '5815RMK' AND identity_status = 'Active'").get();
if (!target) throw new Error("5815RMK not found or not Active -- nothing to do.");

const sibling = db.prepare("SELECT family_id FROM library_products WHERE part_number = '5815RMKB' AND identity_status = 'Active'").get();
if (!sibling || !sibling.family_id) throw new Error("5815RMKB has no family_id yet -- run scripts/classify-fire-alarm-product-families.mjs first.");

const SOURCE = Object.freeze({
  sourceType: "Manufacturer Official Installation Document",
  sourceId: "Honeywell/Silent Knight \"5815RMK/5815RMKB Remote Mounting Kit Product Installation Document\", P/N 151391, Rev C",
  url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/hbt-fire-151391-C-5815RMK-installation-manual.pdf",
  page: 1,
  section: "5815RMK (red) / 5815RMKB (black) part number reference",
});

let familyChanged = 0, attributeAppended = 0;

db.exec("BEGIN IMMEDIATE");
try {
  if (!target.family_id) {
    db.prepare("UPDATE library_products SET family_id = ? WHERE id = ? AND family_id IS NULL").run(sibling.family_id, target.id);
    familyChanged = 1;
  }
  const existing = JSON.parse(target.attributes || "[]");
  if (!existing.some((entry) => entry.name === "color")) {
    existing.push({
      name: "color",
      value: "Red",
      origin: "EXTRACTED",
      confidence: 90,
      sourceText: "5815RMK (red cabinet), distinguished from 5815RMKB (black cabinet)",
      extractionMethod: "manual-research-official-documentation",
      source: SOURCE,
    });
    db.prepare("UPDATE library_products SET attributes = ? WHERE id = ?").run(JSON.stringify(existing), target.id);
    attributeAppended = 1;
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({ productId: target.id, familyChanged, attributeAppended }, null, 2));
