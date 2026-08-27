import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { mutateUnderstandingReview, understandingReviewSelectionAuthority, loadUnderstandingReviewRows, currentApprovedUnderstandingFacts } from "../worker/estimator-understanding-review-api.mjs";
import { buildProductSearchProfile } from "../app/domain/ai-product-ranking-engine.mjs";
import { prepareBoqUnderstandingInput, interpretationInputFingerprint } from "../app/domain/boq-understanding-engine.mjs";

// worker/product-matching-api.mjs's executeProductMatching previously read
// estimator_item_interpretations directly (the raw, ungated AI proposal) to build
// the product search profile, bypassing the approval authority Sprint 0.25.1 already
// enforced for Requirement Profile generation. It now calls the same shared resolver,
// currentApprovedUnderstandingFacts, that technical-requirement-api.mjs uses. This
// suite proves the exact composition executeProductMatching now performs —
// `buildProductSearchProfile({ boqItem, understanding: { interpretation: approvedFacts || {} } })`
// — respects approval authority for every review state, using the real,
// production currentApprovedUnderstandingFacts and buildProductSearchProfile.

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
`;

const buildDatabase = async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  const migration = await readFile(new URL("../drizzle/0060_estimator_understanding_review.sql", import.meta.url), "utf8");
  raw.exec(migration);
  return raw;
};

const proposalPayload = (overrides = {}) => ({
  normalizedDescription: { value: "Manual Call Point MCLP", origin: "EXTRACTED", confidence: 95 },
  system: { value: "Fire Alarm", origin: "EXTRACTED", confidence: 95 },
  category: { value: "Manual Initiation", origin: "EXTRACTED", confidence: 90 },
  subcategory: { value: null, origin: "MISSING", confidence: 0 },
  equipmentType: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  productFamily: { value: "Manual Call Point", origin: "EXTRACTED", confidence: 90 },
  attributes: { "Mounting Type": { value: "Surface", origin: "INFERRED", confidence: 60 } },
  manufacturerPreferences: [], manufacturerRestrictions: [], standards: [], compatibilityRequirements: [],
  requiredAccessories: [], searchTerms: ["manual call point"], missingInformation: [], ambiguities: [],
  engineeringNotes: [], confidence: "HIGH", reviewReasons: [],
  ...overrides,
});

const rawItemFixture = {
  system_value: "28.01 - Fire Alarm System", category: null, subcategory: null,
  description: "Manual Call Point MCLP", model: null, part_number: null,
};

const seedItem = async (raw, { interpretation = proposalPayload() } = {}) => {
  const DB = d1(raw);
  const boqInput = prepareBoqUnderstandingInput({
    id: "boq-mcp-1", rowType: "BOQ Item", description: "Manual Call Point MCLP",
    numericQuantity: 16, originalQuantity: 16, normalizedUnit: "Each", originalUnit: "Each",
    system: rawItemFixture.system_value, category: rawItemFixture.category, subcategory: rawItemFixture.subcategory, manufacturer: null, model: null, partNumber: null,
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
    VALUES ('boq-mcp-1','p1','BOQ Item','ext1','doc1',1,'34','Manual Call Point MCLP',16,16,'Each','Each',?,NULL,NULL,NULL,NULL,NULL,'{}',NULL,'Needs Review',0,NULL,95,60)`)
    .run(rawItemFixture.system_value);
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

// Mirrors exactly what worker/product-matching-api.mjs's executeProductMatching now does.
const buildMatchingSearchProfile = async (DB) => {
  const approvedFacts = await currentApprovedUnderstandingFacts(DB, "p1", "boq-mcp-1");
  return buildProductSearchProfile({
    boqItem: { id: "boq-mcp-1", system: rawItemFixture.system_value, category: rawItemFixture.category, subcategory: rawItemFixture.subcategory, description: rawItemFixture.description, model: rawItemFixture.model, partNumber: rawItemFixture.part_number },
    understanding: { interpretation: approvedFacts || {} },
  });
};

const rawUnchanged = (raw) => {
  const row = raw.prepare("SELECT system_value, category, subcategory FROM boq_items WHERE id='boq-mcp-1'").get();
  assert.equal(row.system_value, rawItemFixture.system_value);
  assert.equal(row.category, null);
  assert.equal(row.subcategory, null);
};

test("APPROVED current interpretation influences the matching search profile", async () => {
  const raw = await buildDatabase();
  const { DB, row } = await seedItem(raw);
  const approval = await decide(DB, row, "APPROVE_INTERPRETATION");
  assert.equal(approval.review.status, "APPROVED");

  const searchProfile = await buildMatchingSearchProfile(DB);
  assert.equal(searchProfile.system.value, "Fire Alarm");
  assert.equal(searchProfile.category.value, "Manual Initiation");
  assert.equal(searchProfile.productFamily.value, "Manual Call Point");
  assert.equal(searchProfile.requiredAttributes["Mounting Type"].value, "Surface");
  rawUnchanged(raw);
});

test("AWAITING_REVIEW (a raw AI proposal that was never approved) cannot influence matching", async () => {
  const raw = await buildDatabase();
  const { DB } = await seedItem(raw);
  // No review decision was ever made — this is also the "raw AI proposal alone" case:
  // an interpretation exists, but nothing has ever approved it.
  const searchProfile = await buildMatchingSearchProfile(DB);
  assert.equal(searchProfile.system.value, rawItemFixture.system_value);
  assert.equal(searchProfile.category.value, null);
  assert.equal(searchProfile.productFamily.value, null);
  assert.deepEqual(searchProfile.requiredAttributes, {});
  rawUnchanged(raw);
});

test("REJECTED interpretation cannot influence matching", async () => {
  const raw = await buildDatabase();
  const { DB, row } = await seedItem(raw);
  const rejection = await decide(DB, row, "REJECT_INTERPRETATION", { reason: "Evidence is ambiguous, needs a site visit." });
  assert.equal(rejection.review.status, "REJECTED");

  const searchProfile = await buildMatchingSearchProfile(DB);
  assert.equal(searchProfile.system.value, rawItemFixture.system_value);
  assert.equal(searchProfile.category.value, null);
  rawUnchanged(raw);
});

test("a stale approval (extraction changed since approval) cannot influence matching", async () => {
  const raw = await buildDatabase();
  const { DB, row } = await seedItem(raw);
  const approval = await decide(DB, row, "APPROVE_INTERPRETATION");
  assert.equal(approval.review.status, "APPROVED");

  raw.prepare("UPDATE boq_items SET description=? WHERE id='boq-mcp-1'").run("Manual Call Point MCLP — Addressable");

  const searchProfile = await buildMatchingSearchProfile(DB);
  assert.equal(searchProfile.system.value, rawItemFixture.system_value);
  assert.equal(searchProfile.category.value, null);
});
