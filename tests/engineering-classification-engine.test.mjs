import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildEngineeringClassification, CLASSIFICATION_TYPES } from "../app/domain/engineering-classification-engine.mjs";

const fact = (id, factType, value, reviewStatus = "Approved") => ({ id, requirementId: "req-78", factType, value, confidence: 90, reviewStatus, sourcePage: 5, sourceClause: "P", sourceSection: "28 46 00", evidenceSnippet: "Approved source evidence." });

test("classifies only approved, evidence-supported facts", () => {
  const output = buildEngineeringClassification({ facts: [fact("f1", "Equipment Type", "Fire Alarm Panel"), fact("f2", "Product Family", "Fire Alarm Panel", "Needs Review"), fact("f3", "Protocol", "RS-485", "Rejected")] });
  assert.ok(output.decisions.some((entry) => entry.classificationType === "Equipment Category" && entry.value === "Control Equipment"));
  assert.ok(output.decisions.some((entry) => entry.classificationType === "Device Type" && entry.value === "Fire Alarm Panel"));
  assert.equal(output.decisions.some((entry) => entry.classificationType === "Product Family"), false);
  assert.equal(output.decisions.some((entry) => entry.classificationType === "Protocol Classification"), false);
  assert.ok(output.decisions.every((entry) => entry.supportingFactIds.length > 0));
});

test("missing evidence reduces completeness and blocks readiness", () => {
  const output = buildEngineeringClassification({ facts: [fact("f1", "Equipment Type", "Fire Alarm Panel")] });
  assert.equal(output.completeness, 13);
  assert.equal(output.readiness, "Not Ready");
  assert.ok(output.blockingMissingInformation.some((entry) => entry.classificationType === "Product Family"));
  assert.ok(output.missingEvidence.includes("Compatibility Readiness"));
  assert.equal(output.autoApproved, false);
});

test("complete approved evidence can be ready but is never auto-approved", () => {
  const facts = [fact("f1", "Equipment Type", "Fire Alarm Panel"), fact("f2", "Product Family", "Fire Alarm Panel"), fact("f3", "Addressability", "Addressable"), fact("f4", "Functional Role", "Network Communication"), fact("f5", "Installation Context", "Indoor"), fact("f6", "Voltage / Current", "24 VDC"), fact("f7", "Technical Dependencies", "Networked panels"), fact("f8", "Protocol", "RS-485"), fact("f9", "Environmental Rating", "IP30"), fact("f10", "Required Certifications", "UL Listed"), fact("f11", "Required Standards", "UL 864"), fact("f12", "Compatible Panel", "Panel A"), fact("f13", "Required Accessories", "Printer")];
  const output = buildEngineeringClassification({ facts });
  assert.equal(output.completeness, 100);
  assert.equal(output.readiness, "Ready");
  assert.equal(output.autoApproved, false);
  assert.equal(output.decisions.length, CLASSIFICATION_TYPES.length);
});

test("classification is deterministic and versions only changed output", () => {
  const facts = [fact("f1", "Equipment Type", "Fire Alarm Panel")];
  assert.deepEqual(buildEngineeringClassification({ facts, previousVersion: 1 }), buildEngineeringClassification({ facts, previousVersion: 1 }));
  assert.notDeepEqual(buildEngineeringClassification({ facts, previousVersion: 1 }).decisions, buildEngineeringClassification({ facts: [...facts, fact("f2", "Product Family", "Fire Alarm Panel")], previousVersion: 1 }).decisions);
});

test("wires persisted versions, governed review and scoped profile UI", async () => {
  const [worker, schema, page, migration, index] = await Promise.all([readFile(new URL("../worker/engineering-classification-api.mjs", import.meta.url), "utf8"), readFile(new URL("../db/schema.ts", import.meta.url), "utf8"), readFile(new URL("../app/page.tsx", import.meta.url), "utf8"), readFile(new URL("../drizzle/0029_engineering_classification.sql", import.meta.url), "utf8"), readFile(new URL("../worker/index.ts", import.meta.url), "utf8")]);
  assert.match(schema, /engineeringClassificationVersions/); assert.match(schema, /engineeringClassificationDecisions/);
  assert.match(worker, /output_fingerprint/); assert.match(worker, /outputChanged: false/); assert.match(worker, /ENGINEERING_DECISION_REASON_REQUIRED/);
  assert.match(page, /Engineering Classification/); assert.match(page, /ENGINEERING COMPLETENESS/); assert.match(page, /Evidence provenance/);
  assert.match(migration, /approved_for_matching.*DEFAULT 0/); assert.match(index, /handleEngineeringClassificationApi/);
});
