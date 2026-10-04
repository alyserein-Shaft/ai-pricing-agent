#!/usr/bin/env node
/**
 * CCTV System Pack v1 closure -- appends deterministic, evidence-only CCTV
 * attributes (see app/domain/cctv-product-attribute-extraction.mjs) to
 * library_products.attributes for the Hikvision CCTV catalog. Idempotent:
 * only ever appends an entry for a canonical name not already present on
 * that product's attributes array; never removes or rewrites an existing
 * entry; never touches part_number/description/family_id.
 *
 * Usage: node scripts/extract-cctv-product-attributes.mjs <path-to-d1-sqlite>
 */
import { DatabaseSync } from "node:sqlite";
import { extractCctvProductAttributes } from "../app/domain/cctv-product-attribute-extraction.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: extract-cctv-product-attributes.mjs <db-path>");

const db = new DatabaseSync(dbPath);
const manufacturer = db.prepare("SELECT id FROM product_manufacturers WHERE name = 'Hikvision'").get();
if (!manufacturer) throw new Error("Hikvision manufacturer not found -- run scripts/seed-cctv-central-kitchen-catalog.mjs first.");

const products = db.prepare(
  "SELECT p.id, p.description, p.attributes, f.name family FROM library_products p LEFT JOIN product_families f ON f.id = p.family_id WHERE p.manufacturer_id = ? AND p.identity_status = 'Active'",
).all(manufacturer.id);

const updateAttributes = db.prepare("UPDATE library_products SET attributes = ? WHERE id = ?");

let scanned = 0, productsChanged = 0, attributesAppended = 0, alreadyPresent = 0;
const byName = new Map();

db.exec("BEGIN IMMEDIATE");
try {
  for (const product of products) {
    scanned += 1;
    const existing = JSON.parse(product.attributes || "[]");
    const existingNames = new Set(existing.map((entry) => entry.name));
    const extracted = extractCctvProductAttributes({ description: product.description, family: product.family || null });
    const toAppend = extracted.filter((entry) => !existingNames.has(entry.name));
    alreadyPresent += extracted.length - toAppend.length;
    if (!toAppend.length) continue;
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

console.log(JSON.stringify({ scanned, productsChanged, attributesAppended, alreadyPresentSkipped: alreadyPresent, byAttributeName: Object.fromEntries(byName) }, null, 2));
