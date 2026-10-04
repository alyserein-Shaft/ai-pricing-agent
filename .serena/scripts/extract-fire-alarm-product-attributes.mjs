#!/usr/bin/env node
/**
 * Sprint 0.5 -- Selection-Critical Product Attribute Enrichment.
 *
 * Appends deterministic, evidence-only Fire Alarm attributes (see
 * app/domain/fire-alarm-product-attribute-extraction.mjs) to
 * library_products.attributes for a SCOPED target set of products only --
 * never the whole catalog. The target set is passed in explicitly by id
 * (computed by the caller from real Opera coverage + same-family siblings +
 * named supporting products; this script does not decide targeting itself).
 *
 * Idempotent: only ever appends an entry for a canonical name that is not
 * already present on that product's attributes array; never removes or
 * rewrites an existing entry (preserves specification-extractor.mjs's own
 * raw Title-Case entries untouched). Never touches part_number, description,
 * family_id, or any other column.
 *
 * Usage: node scripts/extract-fire-alarm-product-attributes.mjs <path-to-d1-sqlite> <path-to-target-ids.json>
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { extractFireAlarmProductAttributes } from "../app/domain/fire-alarm-product-attribute-extraction.mjs";

const [dbPath, targetIdsPath] = process.argv.slice(2);
if (!dbPath || !targetIdsPath) throw new Error("Usage: extract-fire-alarm-product-attributes.mjs <db-path> <target-ids.json>");

const targetIds = JSON.parse(readFileSync(targetIdsPath, "utf8"));
if (!Array.isArray(targetIds) || !targetIds.length) throw new Error("target-ids.json must be a non-empty array of library_products.id values.");

const db = new DatabaseSync(dbPath);
const selectProduct = db.prepare(`SELECT lp.id, lp.description, lp.attributes, f.name family FROM library_products lp LEFT JOIN product_families f ON f.id = lp.family_id WHERE lp.id = ?`);
const updateAttributes = db.prepare(`UPDATE library_products SET attributes = ? WHERE id = ?`);

let scanned = 0, productsChanged = 0, attributesAppended = 0, alreadyPresent = 0, noEvidence = 0;
const byName = new Map();
const remainingWithoutEvidence = [];

db.exec("BEGIN IMMEDIATE");
try {
  for (const id of targetIds) {
    const product = selectProduct.get(id);
    if (!product) continue;
    scanned += 1;
    const existing = JSON.parse(product.attributes || "[]");
    const existingNames = new Set(existing.map((entry) => entry.name));
    const extracted = extractFireAlarmProductAttributes({ description: product.description, family: product.family || null });
    const toAppend = extracted.filter((entry) => !existingNames.has(entry.name));
    alreadyPresent += extracted.length - toAppend.length;
    if (!toAppend.length) {
      if (!extracted.length) { noEvidence += 1; remainingWithoutEvidence.push({ id: product.id, family: product.family || null }); }
      continue;
    }
    const merged = [...existing, ...toAppend];
    updateAttributes.run(JSON.stringify(merged), product.id);
    productsChanged += 1;
    attributesAppended += toAppend.length;
    for (const entry of toAppend) byName.set(entry.name, (byName.get(entry.name) || 0) + 1);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({
  targetProducts: targetIds.length,
  scanned,
  productsChanged,
  attributesAppended,
  alreadyPresentSkipped: alreadyPresent,
  productsWithNoExtractableEvidence: noEvidence,
  byAttributeName: Object.fromEntries(byName),
}, null, 2));
