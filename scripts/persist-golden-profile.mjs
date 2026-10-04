#!/usr/bin/env node
/**
 * Stage 4T-1 — Golden Heat Detector Requirement Profile Persistence
 *
 * Regenerates and persists the Requirement Profile using the same logic
 * as worker/technical-requirement-api.mjs executeRequirementProfile.
 *
 * Usage:
 *   node scripts/persist-golden-profile.mjs <db-path>
 */
import { DatabaseSync } from "node:sqlite";
import { buildTechnicalRequirementProfile, REQUIREMENT_ENGINE_VERSION, REQUIREMENT_RULESET_VERSION, REQUIREMENT_MODEL_VERSION } from "../app/domain/technical-requirement-engine.mjs";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: persist-golden-profile.mjs <db-path>");

const db = new DatabaseSync(dbPath);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const parse = (v, d) => { try { return typeof v === "string" ? JSON.parse(v) : v ?? d; } catch { return d; } };

const BOQ_ITEM_ID = "boqitem_f7fb1705-6d54-46b2-b1e8-4d2b15e421fc";
const PROJECT_ID = "project_0a49e924-1c3d-4cfb-b48a-02a66c00200c";
const USER_ID = "local-development-user";
const REQUIREMENT_INTELLIGENCE_VERSION = "requirement-intelligence-1.0.0";

// ─── Load BOQ Item ───
const item = db.prepare(`SELECT * FROM boq_items WHERE id = ? AND project_id = ?`).get(BOQ_ITEM_ID, PROJECT_ID);
if (!item) throw new Error("BOQ item not found");

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

// ─── Get previous profile ───
const previous = db.prepare(`
  SELECT * FROM requirement_profile_versions
  WHERE boq_item_id = ? ORDER BY version_number DESC LIMIT 1
`).get(BOQ_ITEM_ID);

const previousVersion = previous ? Number(previous.version_number) : 0;
console.log(`Previous profile: version ${previousVersion}, status: ${previous?.status}, readiness: ${previous?.readiness_status}`);

// ─── Build Profile ───
console.log(`\nBuilding profile with ${requirements.length} requirements, ${links.length} links...`);

const profile = buildTechnicalRequirementProfile({
  boqItem,
  links,
  requirements,
  knowledgeFacts: factsResult,
  relationships: relationsResult.map((e) => ({
    ...e, relationshipType: e.relationship_type, rightEntityId: e.right_entity_id
  })),
  previousVersion,
});

console.log(`\n=== Profile Result ===`);
console.log(`Readiness: ${profile.readiness.status}`);
console.log(`Approved: ${profile.readiness.approved}`);
console.log(`Version: ${profile.versionNumber}`);
console.log(`Applicable: ${profile.applicableRequirements.length} (${profile.applicableRequirements.filter(r => r.applicability.status === "Confirmed Applicable").length} confirmed)`);
console.log(`Consolidated: ${profile.consolidatedRequirements.length}`);
console.log(`Missing: ${profile.missingInformation.length}`);
for (const m of profile.missingInformation) {
  console.log(`  - ${m.field} (blocking: ${m.blocking})`);
}
console.log(`Conflicts: ${profile.conflicts.length}`);
console.log(`Standards: ${profile.standards.length}`);
console.log(`Compatibility: ${profile.compatibility.length}`);
console.log(`Intelligence facts: ${profile.intelligence.facts.length}`);

// ─── Persist Profile ───
console.log(`\nPersisting profile...`);

const profileId = id("reqprofile");
const stamp = now();
const profileStatus = ["Ready for Matching", "Ready with Warnings"].includes(profile.readiness.status)
  ? "Completed"
  : profile.readiness.status === "Conflict Blocking"
    ? "Blocked"
    : "Needs Review";

// Create new profile version
db.prepare(`
  INSERT INTO requirement_profile_versions (
    id, project_id, boq_item_id, version_number, status,
    engine_version, ruleset_version, model_version,
    input_fingerprint, profile, explanation, readiness_status,
    confidence_summary, approved_for_matching, created_by, completed_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  profileId,
  PROJECT_ID,
  BOQ_ITEM_ID,
  profile.versionNumber,
  profileStatus,
  REQUIREMENT_ENGINE_VERSION,
  REQUIREMENT_RULESET_VERSION,
  REQUIREMENT_MODEL_VERSION,
  "stage-4t-1-regeneration",
  JSON.stringify(profile),
  profile.explanation,
  profile.readiness.status,
  JSON.stringify(profile.confidence),
  0, // approved_for_matching = false (requires engineer review)
  USER_ID,
  stamp
);

// Supersede previous version
if (previous) {
  db.prepare(`UPDATE requirement_profile_versions SET superseded_at = ? WHERE id = ?`).run(stamp, previous.id);
}

// Persist applicability records
for (const requirement of [...profile.applicableRequirements, ...profile.suggestedRequirements]) {
  db.prepare(`
    INSERT INTO profile_requirement_applicability (
      id, profile_version_id, requirement_id, status, method, confidence, evidence, priority, review_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id("applicability"),
    profileId,
    requirement.id,
    requirement.applicability.status,
    requirement.applicability.method,
    requirement.applicability.confidence,
    JSON.stringify(requirement.applicability.evidence),
    requirement.priority,
    requirement.applicability.reviewStatus
  );
}

// Persist consolidated requirements
for (const requirement of profile.consolidatedRequirements) {
  db.prepare(`
    INSERT INTO consolidated_profile_requirements (
      id, profile_version_id, canonical_key, normalized_requirement,
      requirement_category, requirement_type, priority, governing_source_id,
      sources, attributes, standards, manufacturers, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id("consolidated"),
    profileId,
    requirement.key,
    requirement.normalizedRequirement,
    requirement.requirementCategory,
    requirement.requirementType,
    requirement.priority,
    requirement.governingSourceId,
    JSON.stringify(requirement.sources),
    JSON.stringify(requirement.attributes),
    JSON.stringify(requirement.standards),
    JSON.stringify(requirement.manufacturers),
    requirement.confidence
  );
}

// Persist intelligence facts
for (const fact of profile.intelligence.facts) {
  db.prepare(`
    INSERT INTO requirement_intelligence_facts (
      id, profile_version_id, requirement_id, fact_key, fact_type,
      original_value, current_value, modality, confidence,
      source_page, source_page_to, source_clause, source_section,
      evidence_snippet, extraction_basis, engine_version, review_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Needs Review')
  `).run(
    id("intelligenceFact"),
    profileId,
    fact.requirementId,
    fact.key,
    fact.factType,
    JSON.stringify(fact.value),
    JSON.stringify(fact.value),
    fact.modality,
    fact.confidence,
    fact.source?.page,
    fact.source?.pageTo,
    fact.source?.clause,
    fact.source?.section,
    fact.evidenceSnippet,
    fact.extractionBasis,
    REQUIREMENT_INTELLIGENCE_VERSION
  );
}

console.log(`\nProfile persisted: ${profileId}`);
console.log(`Version: ${profile.versionNumber}`);
console.log(`Status: ${profileStatus}`);
console.log(`Readiness: ${profile.readiness.status}`);

// ─── Verify ───
const verify = db.prepare(`
  SELECT id, version_number, status, readiness_status, approved_for_matching, created_at
  FROM requirement_profile_versions
  WHERE id = ?
`).get(profileId);

console.log(`\n=== Verification ===`);
console.log(`Profile ID: ${verify.id}`);
console.log(`Version: ${verify.version_number}`);
console.log(`Status: ${verify.status}`);
console.log(`Readiness: ${verify.readiness_status}`);
console.log(`Approved for matching: ${verify.approved_for_matching}`);
console.log(`Created: ${verify.created_at}`);

// ─── Verify addressable requirement ───
const addrReq = profile.applicableRequirements.find(r => r.id === "requirement_b8817753-cfce-4c14-9296-a74e04302de1");
console.log(`\n=== Addressable Requirement ===`);
console.log(`In profile: ${addrReq ? "YES" : "NO"}`);
if (addrReq) {
  console.log(`  Applicability: ${addrReq.applicability.status}`);
  console.log(`  Priority: ${addrReq.priority}`);
}

// ─── Summary ───
console.log(`\n=== Stage 4T-1 Summary ===`);
console.log(`Golden BOQ Item: ${BOQ_ITEM_ID}`);
console.log(`Confirmed links consumed: ${linksResult.length}`);
console.log(`Requirements in profile: ${profile.applicableRequirements.length}`);
console.log(`Equipment type: ${boqItem.category}`);
console.log(`Product family: ${boqItem.productFamily}`);
console.log(`System: ${boqItem.system}`);
console.log(`Readiness: ${profile.readiness.status}`);
console.log(`Missing information: ${profile.missingInformation.length}`);
console.log(`Conflicts: ${profile.conflicts.length}`);
console.log(`Approved for matching: ${verify.approved_for_matching}`);

db.close();
