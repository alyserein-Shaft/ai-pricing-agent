#!/usr/bin/env node
/**
 * CCTV System Pack v1 -- real, evidence-backed camera-to-accessory
 * relationships, sourced entirely from Central Kitchen - Makkah's own real,
 * validated final quotation (Al Mespar Contracting Corp, Q1067-626-LCU,
 * "Relationships" sheet of Central_Kitchen_CCTV_Comparison_v8.xlsx). Every
 * relationship_type/quantity_rule pair below mirrors the real quantity the
 * historical project actually needed -- never a generic "every camera needs
 * an accessory" assumption.
 *
 * Classified against the four relationship classes (see docs/cctv-gap-matrix.md):
 *   GLOBAL_PRODUCT_RELATIONSHIP     -- Dome/Bullet Camera -> Junction Box.
 *                                       Every real camera in this project's
 *                                       quotation had exactly one junction
 *                                       box (132:132, 47:47, 14:14).
 *   PROJECT-SPECIFIC_REQUIREMENT    -- Anti-fog Bullet Camera -> Pole Mount.
 *                                       Only 5 of the project's real 20
 *                                       anti-fog bullet cameras needed a
 *                                       pole mount (the rest were wall-
 *                                       mounted) -- genuinely site-specific,
 *                                       never a fixed per-camera ratio.
 *                                       quantity_parameter is left NULL so
 *                                       the BOM layer correctly reports this
 *                                       as an unresolved, non-deterministic
 *                                       quantity rather than guessing 1:1.
 *
 * Idempotent: skips a relationship if the exact (product_id,
 * accessory_product_id, relationship_type) triple already exists and is not
 * superseded/deleted.
 *
 * Usage: node scripts/seed-cctv-compatibility-relationships.mjs <path-to-d1-sqlite>
 */
import { DatabaseSync } from "node:sqlite";

const path = process.argv[2];
if (!path) throw new Error("Provide the D1 SQLite database path.");
const db = new DatabaseSync(path);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const CREATED_BY = "local-development-user";

const findProductId = (partNumber) => {
  const row = db.prepare("SELECT id FROM library_products WHERE part_number = ? AND identity_status = 'Active'").get(partNumber);
  if (!row) throw new Error(`Product not found: ${partNumber} -- run scripts/seed-cctv-central-kitchen-catalog.mjs first.`);
  return row.id;
};

const EVIDENCE = Object.freeze({
  sourceType: "Historical Supplier Quotation (Relationships sheet)",
  sourceId: "Al Mespar Contracting Corp (MCC), Final Quotation Q1067-626-LCU, \"Central Kitchen - Makkah\", cross-checked \"Relationships\"/\"Validation\" sheets of Central_Kitchen_CCTV_Comparison_v8.xlsx (all 9 validation checks PASS)",
});

const RELATIONSHIPS = [
  { primary: "DS-2CD3161G2-LIUF", accessory: "DS-1280ZJ-DM46", type: "Compatible Junction Box", quantityRule: "One per camera", quantityParameter: 1, evidenceNote: "132 cameras : 132 junction boxes (indoor+outdoor dome, consolidated)." },
  { primary: "DS-2CD3166G2-ISU-H", accessory: "DS-1280ZJ-DM46", type: "Compatible Junction Box", quantityRule: "One per camera", quantityParameter: 1, evidenceNote: "14 anti-fog dome cameras : 14 junction boxes." },
  { primary: "DS-2CD3061G2-LIUF", accessory: "DS-1280ZJ-XS", type: "Compatible Junction Box", quantityRule: "One per camera", quantityParameter: 1, evidenceNote: "47 outdoor bullet cameras : 47 junction boxes." },
  { primary: "DS-2CD3T66G2-4IS", accessory: "DS-1275ZJ-SUS", type: "Compatible Pole Mount", quantityRule: "PROJECT_SPECIFIC -- quantity depends on which cameras require pole mounting at this site (not every unit); never derived automatically from camera count", quantityParameter: null, evidenceNote: "20 anti-fog bullet cameras total, but only 5 pole mounts -- the other 15 were wall-mounted with no pole accessory." },
];

const findExisting = db.prepare(
  "SELECT id FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND relationship_type=? AND deleted_at IS NULL AND superseded_at IS NULL",
);
const insert = db.prepare(
  "INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, quantity_parameter, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, ?, ?, ?, '[]', 0, 1, ?, 90, 'Approved', ?)",
);

let created = 0, skipped = 0;
db.exec("BEGIN IMMEDIATE");
try {
  for (const rel of RELATIONSHIPS) {
    const primaryId = findProductId(rel.primary);
    const accessoryId = findProductId(rel.accessory);
    if (findExisting.get(primaryId, accessoryId, rel.type)) { skipped += 1; continue; }
    insert.run(
      id("productaccessory"), primaryId, accessoryId, rel.type, rel.quantityRule, rel.quantityParameter,
      JSON.stringify({ ...EVIDENCE, evidenceNote: rel.evidenceNote }), CREATED_BY,
    );
    created += 1;
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({ created, skipped }, null, 2));
