#!/usr/bin/env node
/**
 * Fire Alarm System Pack v1 closure -- real Opera Block gap sn4 (RPS-1000HV).
 *
 * Same situation as scripts/correct-5815rmk-identity-evidence.mjs: RPS-1000HV's
 * own catalog import evidence (product_source_evidence, "2023 Farenhyt" price
 * list) carries original_text "00RPS-1000HV" -- the real historical source
 * cell, never rewritten here (library_products.description stays untouched).
 *
 * Independent, official manufacturer evidence: Honeywell's RPS-1000 Series
 * "Intelligent Distributed Power Module" datasheet (hon-ba-fire-350070-rps-1000)
 * and its RPS-1000/RPS-1000HV installation manual (hbt-fire-151153-R) confirm
 * RPS-1000/B is rated 120 VAC and RPS-1000HV is rated 240 VAC -- matching the
 * real Opera Block BOQ line's own wording exactly ("High voltage (240V)
 * Intelligent Distributed Power Module"). This is external documentary
 * evidence, not an inference from the "HV" suffix alone.
 *
 * Effect (idempotent, id-scoped, never touches description/part_number):
 *   - Creates a "Booster Power Supply" product_families row if one does not
 *     already exist for this brand (same lookup-or-create convention as
 *     scripts/classify-fire-alarm-product-families.mjs), and sets RPS-1000HV's
 *     family_id to it, only if currently NULL.
 *   - Appends one operating_voltage=240 V entry to the legacy
 *     library_products.attributes array, with a full source citation, only
 *     if not already present.
 *
 * Usage: node scripts/correct-rps1000hv-identity-evidence.mjs <path-to-d1-sqlite>
 */
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2];
if (!path) throw new Error("Provide the D1 SQLite database path.");
const db = new DatabaseSync(path);
const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const target = db.prepare("SELECT id, family_id, brand_id, attributes FROM library_products WHERE part_number = 'RPS-1000HV' AND identity_status = 'Active'").get();
if (!target) throw new Error("RPS-1000HV not found or not Active -- nothing to do.");

const SOURCE = Object.freeze({
  sourceType: "Manufacturer Official Datasheet",
  sourceId: "Honeywell \"RPS-1000 Series Intelligent Distributed Power Module\" Datasheet, hon-ba-fire-350070-rps-1000",
  url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Farenhyt-120425/hon-ba-fire-350070-rps-1000.pdf",
  page: 1,
  section: "AC input rating -- RPS-1000/B (120 VAC) vs RPS-1000HV (240 VAC)",
});

let familyCreated = 0, familyChanged = 0, attributeAppended = 0;

db.exec("BEGIN IMMEDIATE");
try {
  let familyId = target.family_id;
  if (!familyId) {
    const normalizedName = normalized("Booster Power Supply");
    const existingFamily = db.prepare(
      "SELECT id FROM product_families WHERE normalized_name=? AND (brand_id=? OR (brand_id IS NULL AND ? IS NULL))",
    ).get(normalizedName, target.brand_id, target.brand_id);
    if (existingFamily) {
      familyId = existingFamily.id;
    } else {
      familyId = `family_${crypto.randomUUID()}`;
      db.prepare(
        "INSERT INTO product_families (id, brand_id, name, normalized_name, engineering_domain, review_status) VALUES (?, ?, 'Booster Power Supply', ?, 'Power and Batteries', 'Needs Review')",
      ).run(familyId, target.brand_id, normalizedName);
      familyCreated = 1;
    }
    db.prepare("UPDATE library_products SET family_id = ? WHERE id = ? AND family_id IS NULL").run(familyId, target.id);
    familyChanged = 1;
  }
  const existing = JSON.parse(target.attributes || "[]");
  if (!existing.some((entry) => entry.name === "operating_voltage")) {
    existing.push({
      name: "operating_voltage",
      value: "240 V",
      origin: "EXTRACTED",
      confidence: 85,
      sourceText: "RPS-1000HV AC input rating (240 VAC), distinguishing it from RPS-1000/B (120 VAC)",
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

console.log(JSON.stringify({ productId: target.id, familyCreated, familyChanged, attributeAppended }, null, 2));
