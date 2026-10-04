#!/usr/bin/env node
/**
 * Fire Alarm E2E fix (candidate discrimination, Product Knowledge check) --
 * real Central Kitchen - Makkah gap: IDP-PHOTO-IV/IDP-PHOTO-W (plain
 * photoelectric) and IDP-PHOTO-T-IV/IDP-PHOTO-T-W ("...with Thermal
 * (135F)(57C)") are already correctly, separately catalogued, and their own
 * already-approved catalog descriptions already state the distinction
 * explicitly -- but none of the four carries a structured detector_technology
 * attribute recording it. Without it, a requirement that genuinely specifies
 * a thermal-combination sensing element has no governed attribute to compare
 * against, so ranking cannot prefer the correct combination variant over the
 * plain one.
 *
 * This is a narrow, single-fact addition to exactly these four SKUs, sourced
 * only from each product's own already-approved description field (no new
 * external document fetched) -- the same evidentiary shape the automated
 * fire-alarm-product-attribute-extraction-1.0.0 tool already used for these
 * same four products' own existing "addressing" attribute (EXTRACTED origin,
 * literal sourceText, no fabricated manufacturer-document citation). This is
 * not broad family enrichment: no other attribute, no other family, and no
 * other SKU in the family is touched.
 *
 * Value chosen to match the product's own literal wording:
 * - IDP-PHOTO-IV / IDP-PHOTO-W: "Photoelectric" (no thermal element stated
 *   anywhere in the description)
 * - IDP-PHOTO-T-IV / IDP-PHOTO-T-W: "Photoelectric, Thermal" (the
 *   description's own literal "...with Thermal (135F)(57C)..." clause)
 *
 * Idempotent: skips a product that already has detector_technology recorded.
 *
 * Usage:
 *   node scripts/seed-idp-photo-detector-technology-attribute.mjs <db-path> --dry-run
 *   node scripts/seed-idp-photo-detector-technology-attribute.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-idp-photo-detector-technology-attribute.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();

const TARGETS = [
  { partNumber: "IDP-PHOTO-IV", value: "Photoelectric", sourceText: "Photoelectric Smoke Detector" },
  { partNumber: "IDP-PHOTO-W", value: "Photoelectric", sourceText: "Photoelectric Smoke Detector" },
  { partNumber: "IDP-PHOTO-T-IV", value: "Photoelectric, Thermal", sourceText: "Photoelectric Smoke Detector with Thermal (135ºF)(57ºC)" },
  { partNumber: "IDP-PHOTO-T-W", value: "Photoelectric, Thermal", sourceText: "Photoelectric Smoke Detector with Thermal (135ºF)(57ºC)" },
];

const getProduct = db.prepare("SELECT id, part_number, description, attributes FROM library_products WHERE part_number = ? AND identity_status = 'Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let added = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const target of TARGETS) {
    const product = getProduct.get(target.partNumber);
    if (!product) { console.log(`SKIP (not found): ${target.partNumber}`); skipped += 1; continue; }
    if (!norm(product.description).includes(norm(target.sourceText))) throw new Error(`${target.partNumber}: cited sourceText does not literally appear in the product's own description -- refusing to write an unverified fact.`);
    const existing = JSON.parse(product.attributes || "[]");
    if (existing.some((entry) => norm(entry.name) === "detector_technology")) { console.log(`SKIP (already present): ${target.partNumber} -> detector_technology`); skipped += 1; continue; }
    const attribute = { name: "detector_technology", value: target.value, origin: "EXTRACTED", confidence: 90, sourceText: target.sourceText, extractionMethod: "fire-alarm-product-attribute-extraction-1.0.0:detector_technology" };
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${target.partNumber} -> detector_technology = ${JSON.stringify(target.value)}`);
    if (apply) updateAttributes.run(JSON.stringify([...existing, attribute]), product.id);
    added += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${added} attribute${added === 1 ? "" : "s"} ${apply ? "added" : "would be added"}, ${skipped} skipped.`);
