#!/usr/bin/env node
/**
 * Sprint 0.3 -- Product Knowledge Classification for Real Matching.
 *
 * Populates library_products.family_id (and, where needed, a new
 * product_families row) using ONLY the existing, reusable Fire Alarm taxonomy
 * classifier (app/domain/fire-alarm-taxonomy.mjs), applied to each product's
 * own catalog description -- the same engine already used by BOQ understanding
 * and requirement-profile generation. No Opera-specific or part-number-specific
 * mapping exists anywhere in this file; the rule is generic and applies to the
 * whole catalog, and to any future product with a matching description.
 *
 * Conservative acceptance rule: classifyFireAlarmFamilyFromText (fire-alarm-
 * taxonomy.mjs) is the single, shared rule for this -- also used by the
 * Farenhyt price-list importer (app/domain/product-price-library.mjs) so that
 * catalog imports and this backfill can never write incompatible family/
 * category vocabularies. It only accepts a literal exact-phrase match; a lone
 * token-overlap match (e.g. "...detector (Base Not Included)" token-matching
 * "Detector Base" purely because the word "base" appears) is rejected.
 *
 * Idempotent / import-safe: only ever writes to rows where family_id IS NULL,
 * and reuses an existing product_families row (scoped by brand_id + normalized
 * name, matching worker/product-price-library-api.mjs's own family-creation
 * convention) instead of creating a duplicate on reruns. Never touches
 * part_number, description, or any other identity/evidence field.
 *
 * Usage: node scripts/classify-fire-alarm-product-families.mjs <path-to-d1-sqlite>
 */
import { DatabaseSync } from "node:sqlite";
import { buildFireAlarmTaxonomyContext, classifyFireAlarmFamilyFromText } from "../app/domain/fire-alarm-taxonomy.mjs";

const path = process.argv[2];
if (!path) throw new Error("Provide the D1 SQLite database path.");

const normalized = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const db = new DatabaseSync(path);
const products = db.prepare(`SELECT id, part_number, description, brand_id FROM library_products WHERE identity_status <> 'Superseded' AND family_id IS NULL`).all();

const familyCache = new Map();
const findFamily = db.prepare(`SELECT id FROM product_families WHERE normalized_name=? AND (brand_id=? OR (brand_id IS NULL AND ? IS NULL))`);
const insertFamily = db.prepare(`INSERT INTO product_families (id, brand_id, name, normalized_name, engineering_domain, review_status) VALUES (?, ?, ?, ?, ?, 'Needs Review')`);
const updateProduct = db.prepare(`UPDATE library_products SET family_id=? WHERE id=? AND family_id IS NULL`);

let classified = 0, familiesCreated = 0, skippedNoSignal = 0;
const byFamily = new Map();

db.exec("BEGIN IMMEDIATE");
try {
  for (const product of products) {
    const top = classifyFireAlarmFamilyFromText(product.description);
    if (!top) { skippedNoSignal += 1; continue; }

    const normalizedName = normalized(top.family);
    const cacheKey = `${product.brand_id || ""}|${normalizedName}`;
    let familyId = familyCache.get(cacheKey);
    if (!familyId) {
      const existing = findFamily.get(normalizedName, product.brand_id, product.brand_id);
      if (existing) {
        familyId = existing.id;
      } else {
        familyId = id("family");
        insertFamily.run(familyId, product.brand_id, top.family, normalizedName, top.category);
        familiesCreated += 1;
      }
      familyCache.set(cacheKey, familyId);
    }
    updateProduct.run(familyId, product.id);
    classified += 1;
    byFamily.set(top.family, (byFamily.get(top.family) || 0) + 1);
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({
  scanned: products.length,
  classified,
  familiesCreated,
  skippedNoSignal,
  byFamily: Object.fromEntries(byFamily),
  taxonomyVersion: buildFireAlarmTaxonomyContext({}).version,
}, null, 2));
