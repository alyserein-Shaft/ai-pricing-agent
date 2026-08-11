import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";

import { parseXlsxWorkbook } from "../app/document-parsers/xlsx.mjs";
import { buildHistoricalLearningPack } from "../app/domain/historical-learning-pack-adapter.mjs";
import {
  assertPublicationAllowed,
  computeCompleteness,
  computeHistoricalCompleteness,
} from "../app/domain/case-study-learning-engine.mjs";

const provenance = { fileName: "history.xlsx", sha256: "abc", sheet: "Evidence", row: 2, historicalOnly: true };
const source = (sourceType = "Historical Component Register") => ({ sourceType, completenessState: "Available", checksum: "abc", scope: "Component learning", provenance });
const truth = (recordType, originalValue = { value: "supported" }) => ({ recordType, originalValue, confidence: 90, reviewState: "Needs Review", provenance });
const knowledge = (reviewState = "Needs Review") => ({ classification: "Engineering rule", reviewState, publicationState: "Not Published", reusable: false, confidence: 90, evidence: provenance });
const snapshot = { projectId: "p1", systemDomain: "Structured Cabling", governance: { historicalOnly: true } };

test("historical evidence can be substantial while legacy tender completeness remains low", () => {
  const sources = [source()];
  const records = [truth("Passive Component"), truth("Quantity Relationship"), truth("Rack or Service")];
  const legacy = computeCompleteness(sources, records);
  const historical = computeHistoricalCompleteness({ snapshot, sources, groundTruth: records, knowledge: [knowledge()] });
  assert.equal(legacy.sourceCompleteness, 0);
  assert.equal(legacy.groundTruthCompleteness, 0);
  assert.ok(historical.score >= 65);
});

test("drawings are not required when they are not applicable to component learning", () => {
  const input = { snapshot, sources: [source()], groundTruth: [truth("Passive Component"), truth("Quantity Relationship")], knowledge: [knowledge()] };
  const withoutDrawing = computeHistoricalCompleteness(input);
  const withDrawing = computeHistoricalCompleteness({ ...input, sources: [...input.sources, source("Drawing")] });
  assert.equal(withoutDrawing.score, withDrawing.score);
  assert.equal(withoutDrawing.missing.some((entry) => /drawing/i.test(entry)), false);
});

test("missing commercial evidence reduces only the commercial dimension", () => {
  const result = computeHistoricalCompleteness({
    snapshot,
    sources: [source("Final Quotation")],
    groundTruth: [truth("Passive Component"), truth("Quantity Relationship")],
    knowledge: [knowledge()],
  });
  assert.equal(result.dimensions.commercialEvidenceCoverage.score, 0);
  assert.equal(result.dimensions.technicalGroundTruthCoverage.score, 100);
});

test("high completeness does not approve, reuse, publish, or create canonical rules", () => {
  const item = knowledge();
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE requirement_rules(id TEXT PRIMARY KEY); INSERT INTO requirement_rules VALUES ('existing')");
  computeHistoricalCompleteness({ snapshot, sources: [source()], groundTruth: [truth("Passive Component")], knowledge: [item] });
  assert.equal(item.reviewState, "Needs Review");
  assert.equal(item.publicationState, "Not Published");
  assert.equal(item.reusable, false);
  assert.equal(assertPublicationAllowed({ item: { ...item, provenance }, caseStudy: { benchmarkState: "Learning" }, releaseId: "r1" }).allowed, false);
  assert.equal(db.prepare("SELECT COUNT(*) count FROM requirement_rules").get().count, 1);
  db.close();
});

test("all pending knowledge remains Needs Engineering Review", () => {
  const result = computeHistoricalCompleteness({ snapshot, sources: [source()], groundTruth: [truth("Passive Component")], knowledge: [knowledge(), knowledge()] });
  assert.equal(result.learningReadiness, "Needs Engineering Review");
});

test("legacy live-project completeness behavior remains unchanged", () => {
  const inventory = ["BOQ", "Specification", "Drawing", "Supplier Quotation", "Final Quotation", "Approval Record", "Final Product Selection"].map((sourceType) => ({ sourceType, completenessState: "Available" }));
  const groundTruth = ["Selected Product", "Quantity", "Technical Approval", "Final Cost", "Final Selling Price", "Supplier Source"].map((recordType) => ({ recordType, originalValue: "x", provenance: { sourceDocumentId: "d" } }));
  assert.deepEqual(computeCompleteness(inventory, groundTruth), { sourceCompleteness: 100, groundTruthCompleteness: 100 });
});

test("additive migration preserves legacy scores and leaves historical metadata unasserted", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec(await readFile(new URL("../drizzle/0040_completed_project_learning.sql", import.meta.url), "utf8"));
  db.prepare("INSERT INTO case_studies (id,project_id,organization_id,case_version,snapshot_fingerprint,project_snapshot,source_completeness,ground_truth_completeness,frozen_at,frozen_by) VALUES ('c','p','o',1,'f','{}',14,0,'now','u')").run();
  db.exec(await readFile(new URL("../drizzle/0049_historical_case_completeness.sql", import.meta.url), "utf8"));
  const row = db.prepare("SELECT source_completeness,ground_truth_completeness,historical_completeness_assessment,learning_readiness FROM case_studies WHERE id='c'").get();
  assert.deepEqual({ ...row }, { source_completeness: 14, ground_truth_completeness: 0, historical_completeness_assessment: null, learning_readiness: null });
  db.close();
});

test("Central Kitchen assessment is deterministic and evidence-derived", async () => {
  const bytes = await readFile("outputs/central-kitchen-approved/Central_Kitchen_Structured_Cabling_Learning_Pack_v1.xlsx");
  const sha256 = "f392fe2a76dacd7748f23d4efea2da8d3e30b57e41d396fdac050d2d6da37a84";
  const workbook = parseXlsxWorkbook(bytes, { fileName: "Central_Kitchen_Structured_Cabling_Learning_Pack_v1.xlsx", sha256 });
  const pack = buildHistoricalLearningPack({ workbook, sha256, project: { id: "project_62553bdf-a06f-4951-8503-d058ac2d1a94", organizationId: "organization_bd_shaft_internal_pilot", name: "Central Kitchen - Makkah", systemDomain: "Data & Structured Cabling", client: "Central Kitchen", currency: "SAR" } });
  const first = computeHistoricalCompleteness({ snapshot: pack.snapshot, sources: pack.sources, groundTruth: pack.groundTruthRecords, knowledge: pack.knowledgeItems });
  const second = computeHistoricalCompleteness({ snapshot: pack.snapshot, sources: pack.sources, groundTruth: pack.groundTruthRecords, knowledge: pack.knowledgeItems });
  assert.deepEqual(first, second);
  assert.equal(first.score, 80);
  assert.equal(first.learningReadiness, "Needs Engineering Review");
  assert.equal(first.dimensions.evidenceCoverage.score, 100);
  assert.equal(first.dimensions.technicalGroundTruthCoverage.score, 100);
  assert.equal(first.dimensions.commercialEvidenceCoverage.score, 0);
  assert.equal(first.dimensions.reviewCoverage.score, 100);
  assert.equal(first.dimensions.provenanceQuality.score, 100);
});
