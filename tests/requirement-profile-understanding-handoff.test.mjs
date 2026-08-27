import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { mutateUnderstandingReview, understandingReviewSelectionAuthority, loadUnderstandingReviewRows } from "../worker/estimator-understanding-review-api.mjs";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import { prepareBoqUnderstandingInput, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";

// Sprint 0.25 restored the live understanding pipeline. This suite proves the
// next handoff: buildTechnicalRequirementProfile only reads the raw boq_items
// classification, so an approved AI interpretation never reached Requirement
// Profile generation and it reported "Classification Required" forever, even
// after an engineer explicitly approved a HIGH-confidence Fire Alarm / Manual
// Initiation / Manual Call Point classification. executeRequirementProfile now
// reads the same staleness-checked, approval-gated surface the review UI
// already uses (loadUnderstandingReviewRows + safeUnderstandingReviewItem)
// instead of re-deriving approval/staleness rules a second time.

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) || null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
  async batch(statements) {
    raw.exec("BEGIN IMMEDIATE");
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      raw.exec("COMMIT");
      return results;
    } catch (error) {
      raw.exec("ROLLBACK");
      throw error;
    }
  },
});

const schema = `
PRAGMA foreign_keys=OFF;
CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT, organization_id TEXT, archived_at TEXT);
CREATE TABLE documents(id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
CREATE TABLE document_versions(id TEXT PRIMARY KEY, document_id TEXT);
CREATE TABLE boq_extraction_versions(id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
CREATE TABLE boq_items(id TEXT PRIMARY KEY, project_id TEXT, row_type TEXT, extraction_version_id TEXT, source_document_id TEXT, sequence INTEGER, item_number TEXT, description TEXT, numeric_quantity REAL, original_quantity REAL, normalized_unit TEXT, original_unit TEXT, system_value TEXT, category TEXT, subcategory TEXT, manufacturer TEXT, model TEXT, part_number TEXT, current_values TEXT, source_location TEXT, review_status TEXT, approved_for_downstream INTEGER, specification_reference TEXT, system_confidence INTEGER, extraction_confidence INTEGER);
CREATE TABLE estimator_understanding_runs(id TEXT PRIMARY KEY, run_mode TEXT, parent_run_id TEXT);
CREATE TABLE estimator_item_interpretations(id TEXT PRIMARY KEY, boq_item_id TEXT, run_id TEXT, project_id TEXT, version_number INTEGER, input_fingerprint TEXT, config_fingerprint TEXT, status TEXT, validated_interpretation TEXT, error_code TEXT, model TEXT, raw_response TEXT, created_at TEXT);
CREATE TABLE boq_requirement_links(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, requirement_id TEXT, superseded_at TEXT, status TEXT);
CREATE TABLE technical_requirements(id TEXT PRIMARY KEY, approved_for_downstream INTEGER, normalized_requirement TEXT, source_location TEXT, review_status TEXT);
CREATE TABLE engineering_facts(id TEXT PRIMARY KEY, project_id TEXT, status TEXT, scope_type TEXT, scope_id TEXT);
CREATE TABLE engineering_relationships(id TEXT PRIMARY KEY, project_id TEXT, status TEXT, scope_type TEXT, scope_id TEXT, relationship_type TEXT, right_entity_id TEXT);
CREATE TABLE requirement_profile_versions(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, processing_run_id TEXT, version_number INTEGER, status TEXT, engine_version TEXT, ruleset_version TEXT, model_version TEXT, input_fingerprint TEXT, profile TEXT, explanation TEXT, readiness_status TEXT, confidence_summary TEXT, created_by TEXT, completed_at TEXT, superseded_at TEXT);
CREATE TABLE profile_requirement_applicability(id TEXT PRIMARY KEY, profile_version_id TEXT, requirement_id TEXT, status TEXT, method TEXT, confidence INTEGER, evidence TEXT, priority TEXT, review_status TEXT);
CREATE TABLE consolidated_profile_requirements(id TEXT PRIMARY KEY, profile_version_id TEXT, canonical_key TEXT, normalized_requirement TEXT, requirement_category TEXT, requirement_type TEXT, priority TEXT, governing_source_id TEXT, sources TEXT, attributes TEXT, standards TEXT, manufacturers TEXT, confidence INTEGER);
CREATE TABLE requirement_intelligence_facts(id TEXT PRIMARY KEY, profile_version_id TEXT, requirement_id TEXT, fact_key TEXT, fact_type TEXT, original_value TEXT, current_value TEXT, modality TEXT, confidence INTEGER, source_page INTEGER, source_page_to INTEGER, source_clause TEXT, source_section TEXT, evidence_snippet TEXT, extraction_basis TEXT, engine_version TEXT, review_status TEXT);
CREATE TABLE profile_issues(id TEXT PRIMARY KEY, profile_version_id TEXT, issue_type TEXT, related_requirement_id TEXT, related_field TEXT, payload TEXT, severity TEXT, blocking INTEGER, status TEXT);
CREATE TABLE requirement_rule_executions(id TEXT PRIMARY KEY, profile_version_id TEXT, rule_id TEXT, rule_version INTEGER, input TEXT, output TEXT, status TEXT, duration_ms INTEGER);
CREATE TABLE document_audit_events(id TEXT PRIMARY KEY, project_id TEXT, document_id TEXT, version_id TEXT, actor_user_id TEXT, action TEXT, old_value TEXT, new_value TEXT, reason TEXT, request_id TEXT);
`;

const buildDatabase = async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  const migration = await readFile(new URL("../drizzle/0060_estimator_understanding_review.sql", import.meta.url), "utf8");
  raw.exec(migration);
  return raw;
};

const AI_ATTRIBUTES = { "Mounting Type": { value: "Surface", origin: "INFERRED", confidence: 60 } };

const proposalPayload = (overrides = {}) => ({
  normalizedDescription: { value: "Manual Call Point MCLP", origin: "EXTRACTED", confidence: 95 },
  system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 95 },
  category: { value: "Manual Initiation", origin: "EXTRACTED", confidence: 90 },
  subcategory: { value: null, origin: "MISSING", confidence: 0 },
  equipmentType: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  productFamily: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  attributes: AI_ATTRIBUTES,
  manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
  requiredAccessories: [], searchTerms: ["manual call point"], missingInformation: [], ambiguities: [],
  engineeringNotes: [], confidence: "HIGH", reviewReasons: [],
  ...overrides,
});

const seedItem = async (raw, { interpretation = proposalPayload() } = {}) => {
  const DB = d1(raw);
  const boqInput = prepareBoqUnderstandingInput({
    id: "boq-mcp-1", rowType: "BOQ Item", description: "Manual Call Point MCLP",
    numericQuantity: 12, originalQuantity: 12, normalizedUnit: "Each", originalUnit: "Each",
    system: null, category: null, subcategory: null, manufacturer: null, model: null, partNumber: null,
    currentValues: {}, sourceLocation: null,
  });
  const inputFingerprint = interpretationInputFingerprint(boqInput);
  raw.exec(`
    INSERT INTO projects VALUES ('p1','owner1','org1',NULL);
    INSERT INTO documents VALUES ('doc1','p1','dv1',NULL,NULL);
    INSERT INTO document_versions VALUES ('dv1','doc1');
    INSERT INTO boq_extraction_versions VALUES ('ext1','doc1','dv1',1,'Completed',NULL);
  `);
  raw.prepare(`INSERT INTO boq_items (id,project_id,row_type,extraction_version_id,source_document_id,sequence,item_number,description,numeric_quantity,original_quantity,normalized_unit,original_unit,system_value,category,subcategory,manufacturer,model,part_number,current_values,source_location,review_status,approved_for_downstream,specification_reference,system_confidence,extraction_confidence)
    VALUES ('boq-mcp-1','p1','BOQ Item','ext1','doc1',1,'27.10','Manual Call Point MCLP',12,12,'Each','Each',NULL,NULL,NULL,NULL,NULL,NULL,'{}',NULL,'Needs Review',0,NULL,NULL,60)`).run();
  raw.exec(`INSERT INTO estimator_understanding_runs VALUES ('run1',NULL,NULL)`);
  raw.prepare(`INSERT INTO estimator_item_interpretations (id,boq_item_id,run_id,project_id,version_number,input_fingerprint,config_fingerprint,status,validated_interpretation,error_code,model,raw_response,created_at)
    VALUES ('interp1','boq-mcp-1','run1','p1',1,?,'cfg1','NEEDS_REVIEW',?,NULL,'test-model',NULL,'2026-08-23T00:00:00Z')`)
    .run(inputFingerprint, JSON.stringify(interpretation));
  const row = (await loadUnderstandingReviewRows(DB, "p1")).find((entry) => entry.boqItemId === "boq-mcp-1");
  return { DB, row };
};

const decide = async (DB, row, action, { reason = null, requestId = `req-${action}` } = {}) => mutateUnderstandingReview(
  DB, { userId: "engineer1" }, "p1", row,
  { action, expectedVersion: Number(row.reviewVersion || 0), requestId, selectionAuthority: understandingReviewSelectionAuthority("p1", row), reason },
);

const currentProfile = (raw) => {
  const row = raw.prepare("SELECT * FROM requirement_profile_versions WHERE boq_item_id='boq-mcp-1' AND superseded_at IS NULL").get();
  return row ? { ...row, profile: JSON.parse(row.profile) } : null;
};

test("an approved interpretation is consumed as authoritative classification downstream", async () => {
  const raw = await buildDatabase();
  const { DB, row } = await seedItem(raw);
  const approval = await decide(DB, row, "APPROVE_INTERPRETATION");
  assert.equal(approval.review.status, "APPROVED");

  await executeRequirementProfile({ DB }, { itemId: "boq-mcp-1", userId: "owner1", runId: null });
  const profile = currentProfile(raw);
  assert.equal(profile.profile.boqItem.system, "Fire Alarm");
  assert.equal(profile.profile.boqItem.category, "Manual Initiation");
  assert.equal(profile.profile.boqItem.productFamily, "Manual Call Point");
  assert.equal(profile.profile.boqItem.attributes["Mounting Type"], "Surface");
  assert.notEqual(profile.readiness_status, "Classification Required");

  // Provenance: downstream facts identify the approved AI interpretation as their
  // source, distinct from the (still-blank) raw BOQ extraction.
  assert.deepEqual(profile.profile.boqItem.classificationProvenance, {
    system: "Approved AI Understanding", category: "Approved AI Understanding", productFamily: "Approved AI Understanding",
  });

  // Raw BOQ evidence is untouched — nothing was copied into boq_items.
  const raw_item = raw.prepare("SELECT system_value, category, subcategory FROM boq_items WHERE id='boq-mcp-1'").get();
  assert.equal(raw_item.system_value, null);
  assert.equal(raw_item.category, null);
  assert.equal(raw_item.subcategory, null);
});

test("an unapproved (AWAITING_REVIEW) interpretation is not promoted downstream", async () => {
  const raw = await buildDatabase();
  const { DB } = await seedItem(raw);
  await executeRequirementProfile({ DB }, { itemId: "boq-mcp-1", userId: "owner1", runId: null });
  const profile = currentProfile(raw);
  assert.equal(profile.readiness_status, "Classification Required");
  assert.equal(profile.profile.boqItem.system, null);
  assert.deepEqual(profile.profile.boqItem.classificationProvenance, {
    system: "BOQ Extraction", category: "BOQ Extraction", productFamily: "BOQ Extraction",
  });
});

test("a rejected interpretation is not promoted downstream", async () => {
  const raw = await buildDatabase();
  const { DB, row } = await seedItem(raw);
  const rejection = await decide(DB, row, "REJECT_INTERPRETATION", { reason: "Evidence is ambiguous, needs a site visit." });
  assert.equal(rejection.review.status, "REJECTED");

  await executeRequirementProfile({ DB }, { itemId: "boq-mcp-1", userId: "owner1", runId: null });
  const profile = currentProfile(raw);
  assert.equal(profile.readiness_status, "Classification Required");
  assert.equal(profile.profile.boqItem.system, null);
});

test("an interpretation missing an essential field cannot be approved, so nothing is promoted", async () => {
  const raw = await buildDatabase();
  // Fire Alarm E2E fix (BOQ Understanding robustness) -- equipmentType is no
  // longer an essential/blocking field (a reviewable free-text label never
  // consumed by matching, see estimator-understanding-review.mjs's own
  // comment on ESSENTIAL_UNDERSTANDING_FIELDS). Nulling category or
  // productFamily instead would also invalidate the separate governed
  // taxonomy-pair/acceptedCandidate check (both are inputs to it), so the
  // failure would be reported as TAXONOMY_INVALID, not this guard. Nulling
  // system in isolation keeps that check out of it entirely -- a row with no
  // system is treated as ungoverned (hasGovernedTaxonomy(null) is false, so
  // there is no candidate to accept or reject) -- so this still isolates
  // exactly the essential-field guard being tested.
  const { DB, row } = await seedItem(raw, { interpretation: proposalPayload({ system: { value: null, origin: "MISSING", confidence: 0 } }) });
  const attempt = await decide(DB, row, "APPROVE_INTERPRETATION");
  // The action-policy layer (evaluateUnderstandingAuthority) and the deeper
  // validateUnderstandingForApproval guard share the same essential-field list,
  // so the missing field is caught before a review row is ever written.
  assert.equal(attempt.error, "BLOCKING_FIELDS_UNRESOLVED");
  assert.ok(attempt.missing.includes("system"));

  const stillNoReview = raw.prepare("SELECT COUNT(*) count FROM estimator_understanding_review_versions").get();
  assert.equal(stillNoReview.count, 0);

  await executeRequirementProfile({ DB }, { itemId: "boq-mcp-1", userId: "owner1", runId: null });
  const profile = currentProfile(raw);
  assert.equal(profile.readiness_status, "Classification Required");
});

test("a stale approval (extraction changed since approval) is not promoted downstream", async () => {
  const raw = await buildDatabase();
  const { DB, row } = await seedItem(raw);
  const approval = await decide(DB, row, "APPROVE_INTERPRETATION");
  assert.equal(approval.review.status, "APPROVED");

  // The BOQ description changes after approval (e.g. re-extraction from a revised
  // document). This changes the understanding input fingerprint, so the previously
  // approved interpretation no longer matches current evidence.
  raw.prepare("UPDATE boq_items SET description=? WHERE id='boq-mcp-1'").run("Manual Call Point MCLP — Addressable");

  await executeRequirementProfile({ DB }, { itemId: "boq-mcp-1", userId: "owner1", runId: null });
  const profile = currentProfile(raw);
  assert.equal(profile.readiness_status, "Classification Required");
  assert.equal(profile.profile.boqItem.system, null);
});
