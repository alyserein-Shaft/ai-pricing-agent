#!/usr/bin/env node
/**
 * Stage 4U — Governed product technical enrichment for the Addressable Heat
 * Detector family (IDP-HEAT).
 *
 * What it does:
 *   - Extracts literal technical attributes from the manufacturer price-list
 *     description text via app/domain/idp-heat-description-parser.mjs and
 *     writes them to product_attributes (all Needs Review, provenance in
 *     evidence_json, idempotent).
 *   - Creates Global engineering_relationships rows COMPATIBLE_WITH_PANEL
 *     -> IFP-75 from the official IFP-75 datasheet evidence (Needs Review,
 *     idempotent). Product-library knowledge, never project scope.
 *
 * What it refuses to do (enforced in code):
 *   - Write any product_certifications rows (no listing evidence exists).
 *   - Touch approved_for_discovery, review_status, lifecycle_status.
 *   - Touch any project data (Al Mousa or dfg) or any pricing records.
 *
 * Usage: node scripts/enrich-idp-heat-products.mjs <db-path>
 */
import { DatabaseSync } from "node:sqlite";
import {
  extractIdpHeatAttributes,
  classifyIdpHeatVariant,
  buildPanelCompatibilityRelationship,
  IDP_HEAT_DESCRIPTION_PARSER_VERSION,
} from "../app/domain/idp-heat-description-parser.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: enrich-idp-heat-products.mjs <db-path>");
const db = new DatabaseSync(dbPath);

const FAMILY_ID = "family_928e2de6-f424-4fdc-83dd-25828dadcff3";
const ACTOR = "system:stage-4u-product-enrichment";

const products = db.prepare(
  "SELECT id, part_number, description FROM library_products WHERE family_id = ? AND identity_status = 'Active' ORDER BY part_number",
).all(FAMILY_ID);

console.log(`IDP-HEAT family products: ${products.length}`);

// ─── Pre-state ───
const preAttrs = db.prepare(
  "SELECT COUNT(*) c FROM product_attributes WHERE product_id IN (SELECT id FROM library_products WHERE family_id = ?)",
).get(FAMILY_ID).c;
const preRels = db.prepare(
  "SELECT COUNT(*) c FROM engineering_relationships WHERE relationship_type = 'COMPATIBLE_WITH_PANEL' AND left_entity_id IN (SELECT id FROM library_products WHERE family_id = ?)",
).get(FAMILY_ID).c;
console.log(`Pre-state: ${preAttrs} attributes, ${preRels} panel relationships`);

let attrsInserted = 0, attrsSkipped = 0, relsInserted = 0, relsSkipped = 0;
const variantMatrix = [];

for (const product of products) {
  const classification = classifyIdpHeatVariant(product.part_number, product.description);
  if (!classification.isIdpHeat) {
    console.log(`  SKIP ${product.part_number}: description not recognized as IDP-HEAT`);
    continue;
  }
  if (!classification.codeSuffixConsistent) {
    console.log(`  IDENTITY CONFLICT ${product.part_number}: ${classification.identityConflicts.join("; ")}`);
  }
  variantMatrix.push({ partNumber: product.part_number, ...classification });

  for (const a of extractIdpHeatAttributes(product.description)) {
    const existing = db.prepare(
      "SELECT id FROM product_attributes WHERE product_id = ? AND attribute_name = ? AND superseded_at IS NULL AND deleted_at IS NULL",
    ).get(product.id, a.attributeName);
    if (existing) { attrsSkipped += 1; continue; }
    db.prepare(
      `INSERT INTO product_attributes
        (id, product_id, attribute_name, value_json, original_value, normalized_value, unit,
         source_id, evidence_json, confidence, review_status, version_number, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      `pattribute_${crypto.randomUUID()}`,
      product.id,
      a.attributeName,
      JSON.stringify({ value: a.normalizedValue, unit: a.unit, basis: a.basis }),
      a.originalValue,
      a.normalizedValue,
      a.unit,
      a.sourceId,
      JSON.stringify({
        sourceId: a.sourceId,
        documentId: a.documentId,
        documentVersionId: a.documentVersionId,
        section: a.section,
        exactText: a.exactText,
        parserVersion: a.parserVersion,
        basis: a.basis,
      }),
      a.confidence,
      a.reviewStatus,
      ACTOR,
    );
    attrsInserted += 1;
  }

  const rel = buildPanelCompatibilityRelationship({ productId: product.id });
  const existingRel = db.prepare(
    `SELECT id FROM engineering_relationships
      WHERE left_entity_id = ? AND right_entity_id = ? AND relationship_type = ? AND effective_to IS NULL`,
  ).get(rel.leftEntityId, rel.rightEntityId, rel.relationshipType);
  if (existingRel) { relsSkipped += 1; continue; }
  db.prepare(
    `INSERT INTO engineering_relationships
      (id, project_id, left_entity_type, left_entity_id, relationship_type, right_entity_type,
       right_entity_id, conditions, exceptions, fact_type, scope_type, scope_id, confidence,
       status, version_number, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    `engrel_${crypto.randomUUID()}`,
    rel.projectId,
    rel.leftEntityType,
    rel.leftEntityId,
    rel.relationshipType,
    rel.rightEntityType,
    rel.rightEntityId,
    JSON.stringify(rel.conditions),
    JSON.stringify(rel.exceptions),
    rel.factType,
    rel.scopeType,
    null,
    rel.confidence,
    rel.status,
    ACTOR,
  );
  relsInserted += 1;
}

// ─── Hard safety assertions ───
const certCount = db.prepare(
  "SELECT COUNT(*) c FROM product_certifications WHERE product_id IN (SELECT id FROM library_products WHERE family_id = ?)",
).get(FAMILY_ID).c;
if (certCount !== 0) throw new Error("SAFETY VIOLATION: certifications were written without listing evidence");
const flagDrift = db.prepare(
  "SELECT COUNT(*) c FROM library_products WHERE family_id = ? AND (approved_for_discovery != 0)",
).get(FAMILY_ID).c;
if (flagDrift !== 0) throw new Error("SAFETY VIOLATION: discovery flags were flipped outside governance");

// ─── Post-state verification ───
const postAttrs = db.prepare(
  "SELECT COUNT(*) c FROM product_attributes WHERE product_id IN (SELECT id FROM library_products WHERE family_id = ?)",
).get(FAMILY_ID).c;
const postRels = db.prepare(
  "SELECT COUNT(*) c FROM engineering_relationships WHERE relationship_type = 'COMPATIBLE_WITH_PANEL' AND left_entity_id IN (SELECT id FROM library_products WHERE family_id = ?)",
).get(FAMILY_ID).c;

console.log(`\nInserted: ${attrsInserted} attributes (${attrsSkipped} already present), ${relsInserted} relationships (${relsSkipped} already present)`);
console.log(`Post-state: ${postAttrs} attributes, ${postRels} panel relationships`);
if (postAttrs - preAttrs !== attrsInserted) throw new Error("Delta verification failed for attributes");
if (postRels - preRels !== relsInserted) throw new Error("Delta verification failed for relationships");

// ─── Matchability validation (does NOT pick a winner) ───
console.log("\n=== Variant matrix (attribute-derived, no hardcoded logic) ===");
for (const v of variantMatrix) {
  console.log(`  ${v.partNumber.padEnd(16)} variant=${v.variant}${v.codeSuffixConsistent ? "" : "  [IDENTITY CONFLICT: " + v.identityConflicts.join("; ") + "]"}`);
}
const distinctModes = new Set(variantMatrix.map((v) => v.variant));
console.log(`Distinct heat_detector_mode values: ${[...distinctModes].join(", ")}`);
if (distinctModes.size < 2) throw new Error("Matchability validation failed: variants are not distinguishable by attributes");

const goldenCheck = db.prepare(
  `SELECT COUNT(DISTINCT pa.product_id) c FROM product_attributes pa
    JOIN library_products lp ON lp.id = pa.product_id
    WHERE lp.family_id = ? AND pa.attribute_name = 'addressable_capability' AND pa.normalized_value = 'intelligent-addressable'`,
).get(FAMILY_ID).c;
console.log(`Golden-profile 'addressable' requirement comparable against ${goldenCheck}/${variantMatrix.length} candidates via attributes`);

console.log(`\nParser: ${IDP_HEAT_DESCRIPTION_PARSER_VERSION}`);
console.log("Governance: all rows Needs Review; no certifications; no flags changed; no project data touched.");
db.close();
