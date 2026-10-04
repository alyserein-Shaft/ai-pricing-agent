#!/usr/bin/env node
/**
 * Stage 4T-1 — Golden Heat Detector Requirement Profile Regeneration
 *
 * Directly regenerates the Requirement Profile using the same logic as
 * worker/technical-requirement-api.mjs executeRequirementProfile, but
 * synchronous via DatabaseSync.
 *
 * Usage:
 *   node scripts/regenerate-golden-profile.mjs <db-path>
 */
import { DatabaseSync } from "node:sqlite";
import { buildTechnicalRequirementProfile, REQUIREMENT_ENGINE_VERSION, REQUIREMENT_RULESET_VERSION, REQUIREMENT_MODEL_VERSION } from "../app/domain/technical-requirement-engine.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: regenerate-golden-profile.mjs <db-path>");

const db = new DatabaseSync(dbPath);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (v, d) => { try { return typeof v === "string" ? JSON.parse(v) : v ?? d; } catch { return d; } };

const BOQ_ITEM_ID = "boqitem_f7fb1705-6d54-46b2-b1e8-4d2b15e421fc";
const PROJECT_ID = "project_0a49e924-1c3d-4cfb-b48a-02a66c00200c";

// ─── Load BOQ Item ───
const item = db.prepare(`
  SELECT b.*
  FROM boq_items b
  WHERE b.id = ? AND b.project_id = ?
`).get(BOQ_ITEM_ID, PROJECT_ID);

if (!item) throw new Error("BOQ item not found");
console.log(`BOQ Item: ${item.description} (qty ${item.numeric_quantity})`);
console.log(`System: ${item.system_value}, Category: ${item.category}`);

// ─── Load Requirements + Links (same as loadInputs) ───
const linksResult = db.prepare(`
  SELECT l.*, r.original_text, r.normalized_requirement, r.requirement_type,
         r.requirement_category, r.system, r.category, r.subcategory,
         r.condition, r.exception, r.confidence, r.source_location,
         r.approved_for_downstream
  FROM boq_requirement_links l
  JOIN technical_requirements r ON r.id = l.requirement_id
  WHERE l.boq_item_id = ?
    AND l.superseded_at IS NULL
    AND l.status = 'Confirmed'
    AND r.approved_for_downstream = 1
`).all(BOQ_ITEM_ID);

console.log(`\nLoaded ${linksResult.length} Confirmed links`);

const requirements = [];
const links = [];

for (const row of linksResult) {
  const attributes = db.prepare("SELECT * FROM requirement_attributes WHERE requirement_id=?").all(row.requirement_id);
  const standards = db.prepare("SELECT * FROM requirement_standards WHERE requirement_id=?").all(row.requirement_id);
  const manufacturers = db.prepare("SELECT * FROM requirement_manufacturers WHERE requirement_id=?").all(row.requirement_id);
  const compatibility = db.prepare("SELECT * FROM requirement_compatibility WHERE requirement_id=?").all(row.requirement_id);
  const accessories = db.prepare("SELECT * FROM requirement_accessories WHERE requirement_id=?").all(row.requirement_id);

  requirements.push({
    id: row.requirement_id,
    originalText: row.original_text,
    normalizedRequirement: row.normalized_requirement,
    requirementType: row.requirement_type,
    requirementCategory: row.requirement_category,
    system: row.system,
    category: row.category,
    condition: row.condition,
    confidence: row.confidence,
    sourceType: "Specification",
    source: parse(row.source_location, {}),
    attributes: attributes.map((e) => ({
      name: e.name, operator: e.operator,
      normalizedValue: parse(e.normalized_value, e.normalized_value),
      normalizedUnit: e.normalized_unit, confidence: e.confidence,
      source: parse(e.source_location, {})
    })),
    standards,
    manufacturers,
    compatibility: compatibility.map((e) => ({
      ...e, targetItem: e.target_item, relationshipType: e.relationship_type
    })),
    accessories
  });

  links.push({
    requirementId: row.requirement_id,
    status: row.status,
    confidence: row.confidence,
    linkMethod: row.link_method || "Deterministic Applicability",
    evidence: parse(row.evidence, [])
  });
}

// ─── Load knowledge facts ───
const factsResult = db.prepare(`
  SELECT * FROM engineering_facts
  WHERE project_id = ? AND status <> 'Superseded'
    AND (scope_type = 'Project' OR (scope_type = 'BOQ Item' AND scope_id = ?))
`).all(PROJECT_ID, BOQ_ITEM_ID);

// ─── Load relationships ───
const relationsResult = db.prepare(`
  SELECT * FROM engineering_relationships
  WHERE status IN ('Active','Approved','Confirmed')
    AND ((project_id = ? AND (scope_type = 'Project' OR (scope_type = 'BOQ Item' AND scope_id = ?)))
      OR (project_id IS NULL AND scope_type = 'Global'))
`).all(PROJECT_ID, BOQ_ITEM_ID);

// ─── Build BOQ Item for profile engine ───
const boqItem = {
  id: item.id,
  itemNumber: item.item_number,
  description: item.description,
  system: item.system_value,
  category: item.category,
  subcategory: item.subcategory,
  unit: item.normalized_unit || item.original_unit,
  quantity: item.numeric_quantity,
  productFamily: item.subcategory || item.category,
  manufacturer: item.manufacturer || null,
  partNumber: item.part_number || null,
  specificationReference: item.specification_reference,
  classificationConfidence: item.system_confidence || item.extraction_confidence || 100,
  source: parse(item.source_location, {}),
};

console.log(`\nBOQ Item for profile: ${JSON.stringify(boqItem, null, 2)}`);

// ─── Build Profile ───
console.log(`\nBuilding profile with ${requirements.length} requirements, ${links.length} links...`);

const previous = db.prepare(`
  SELECT * FROM requirement_profile_versions
  WHERE boq_item_id = ? ORDER BY version_number DESC LIMIT 1
`).get(BOQ_ITEM_ID);

const profile = buildTechnicalRequirementProfile({
  boqItem,
  links,
  requirements,
  knowledgeFacts: factsResult,
  relationships: relationsResult.map((e) => ({
    ...e, relationshipType: e.relationship_type, rightEntityId: e.right_entity_id
  })),
  previousVersion: previous ? Number(previous.version_number) : 0,
});

console.log(`\n=== Profile Result ===`);
console.log(`Readiness: ${JSON.stringify(profile.readiness, null, 2)}`);
console.log(`Applicable requirements: ${profile.applicableRequirements.length}`);
console.log(`  Confirmed: ${profile.applicableRequirements.filter(r => r.applicability.status === "Confirmed Applicable").length}`);
console.log(`  Suggested: ${profile.applicableRequirements.filter(r => r.applicability.status !== "Confirmed Applicable").length}`);
console.log(`Consolidated: ${profile.consolidatedRequirements.length}`);
console.log(`Intelligence facts: ${profile.intelligence.facts.length}`);
console.log(`Missing information: ${profile.missingInformation.length}`);
for (const m of profile.missingInformation) {
  console.log(`  - ${m.field} (blocking: ${m.blocking}): ${m.clarificationQuestion}`);
}
console.log(`Conflicts: ${profile.conflicts.length}`);
console.log(`Derived: ${profile.derivedRequirements.length}`);
console.log(`Standards: ${profile.standards.length}`);
console.log(`Compatibility: ${profile.compatibility.length}`);

// ─── Check addressable requirement ───
const addrReq = profile.applicableRequirements.find(r => r.id === "requirement_b8817753-cfce-4c14-9296-a74e04302de1");
console.log(`\n=== Addressable Requirement in Profile ===`);
if (addrReq) {
  console.log(`Found: YES`);
  console.log(`  Applicability: ${addrReq.applicability.status}`);
  console.log(`  Priority: ${addrReq.priority}`);
  console.log(`  Text: ${addrReq.originalText?.slice(0, 100)}...`);
} else {
  console.log(`Found: NO`);
}

// ─── Show all applicable requirements ───
console.log(`\n=== All Applicable Requirements ===`);
for (const r of profile.applicableRequirements) {
  console.log(`  ${r.id} | ${r.applicability.status} | ${r.priority} | ${(r.originalText || "").slice(0, 80)}...`);
}

db.close();
