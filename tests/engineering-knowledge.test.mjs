import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assembleKnowledgeProfile, createKnowledgeFact, normalizeMeasurement, resolveEffectiveVersion, resolveScopedFacts, scoreRequirementLink, validateRequirementLink } from "../app/domain/engineering-knowledge.mjs";

const provenance = { sourceType: "Specification Clause", sourceId: "req-1", documentId: "doc-1", documentVersionId: "ver-1", clause: "2.1", originalText: "The detector shall be IP66", extractionMethod: "pdfjs-coordinate-layout", parserVersion: "1", confidence: 90, createdAt: "2026-08-01T00:00:00Z" };
test("enforces fact classification, provenance, normalization lineage and AI safety", () => { const source = createKnowledgeFact({ id: "f1", entityType: "Requirement", entityId: "req-1", predicate: "IP Rating", value: "IP 66", factType: "Source Fact", scopeType: "Project", scopeId: "p1", projectId: "p1", provenance }); assert.equal(source.factType, "Source Fact"); assert.throws(() => createKnowledgeFact({ ...source, id: "f2", factType: "Normalized Fact", sourceFactId: null }), /source fact/i); assert.throws(() => createKnowledgeFact({ ...source, id: "f3", factType: "AI Suggestion", status: "Approved" }), /cannot approve/i); });
test("normalizes compatible units while retaining originals and fails closed", () => { assert.deepEqual(normalizeMeasurement({ value: 1500, unit: "mA", targetUnit: "A" }), { originalValue: 1500, originalUnit: "mA", normalizedValue: 1.5, normalizedUnit: "A", status: "Normalized" }); assert.equal(normalizeMeasurement({ value: 12, unit: "V", targetUnit: "A" }).status, "Invalid Conversion"); assert.equal(normalizeMeasurement({ value: 12, unit: "unknown" }).normalizedValue, null); });
test("resolves effective immutable versions", () => { const found = resolveEffectiveVersion([{ id: "old", effectiveFrom: "2025-01-01", effectiveTo: "2026-01-01" }, { id: "current", effectiveFrom: "2026-01-01" }], new Date("2026-08-01")); assert.equal(found.id, "current"); });
test("keeps project overrides scoped and ahead of global rules", () => { const facts = [{ id: "g", scopeType: "Global", status: "Active" }, { id: "p1", scopeType: "Project", scopeId: "project-1", status: "Active" }, { id: "p2", scopeType: "Project", scopeId: "project-2", status: "Active" }]; assert.deepEqual(resolveScopedFacts(facts, { projectId: "project-1" }).map((fact) => fact.id), ["p1", "g"]); });
test("creates suggestions from structured BOQ-to-requirement signals but never confirms them", () => { const link = scoreRequirementLink({ boqItem: { description: "Addressable smoke detector", system: "Fire Alarm", category: "Detection" }, requirement: { originalText: "Addressable smoke detector shall comply", system: "Fire Alarm", category: "Detection", source: {} } }); assert.ok(link.confidence >= 55); assert.notEqual(link.status, "Confirmed"); assert.throws(() => validateRequirementLink({ projectId: "p", boqItemId: "b", requirementId: "r", status: "Confirmed" }), /reviewer/i); });
test("penalizes cross-equipment keyword collisions", () => { const link = scoreRequirementLink({ boqItem: { description: "Loop powered sounder with strobe", system: "Fire Alarm" }, requirement: { originalText: "The fire alarm control panel shall provide alarm verification", system: "Fire Alarm", source: {} } }); assert.ok(link.confidence < 45); assert.ok(link.evidence.some((entry) => entry.includes("Cross-equipment conflict"))); assert.equal(link.assessment, "Uncertain"); });
// Sprint 1.22 -- real Opera gap: a genuinely applicable, device-specific
// clause ("Heat detector heads shall include combination rate-of-rise and
// rate compensated fixed temperature sensing...135 degrees F...") used to
// score ~9 confidence against a "Heat Detector Ceiling Mounted" BOQ item,
// below the 15/25 confirmation-worthy thresholds, purely because
// equipmentType() had no private regex for "heat detector" at all -- not
// because the clause was inapplicable. Proves the governed taxonomy-backed
// fix clears the threshold without lowering it and without any Opera-item-ID
// special-casing.
test("Sprint 1.22 -- a genuinely applicable Heat Detector clause now clears the confirmation-worthy threshold via the shared governed taxonomy, not a lowered bar", () => {
  const item = { description: "Heat Detector Ceiling Mounted", system: "Fire Alarm", category: null };
  const rateOfRise = scoreRequirementLink({ boqItem: item, requirement: { originalText: "Heat detector heads shall include combination rate-of-rise and rate compensated fixed temperature sensing, two levels of rate-of-rise sensitivity selectable at the panel, and an independent 135 degrees F fixed temperature set point.", system: "Fire Alarm", category: "Environmental", source: {} } });
  const selfRestoring = scoreRequirementLink({ boqItem: item, requirement: { originalText: "Heat detector heads shall be self- restoring.", system: "Fire Alarm", category: "Other", source: {} } });
  assert.equal(rateOfRise.itemEquipment, "Heat Detector");
  assert.equal(rateOfRise.requirementEquipment, "Heat Detector");
  assert.ok(rateOfRise.confidence >= 25, `expected a confirmation-worthy score, got ${rateOfRise.confidence}`);
  assert.ok(selfRestoring.confidence >= 25, `expected a confirmation-worthy score, got ${selfRestoring.confidence}`);
  // A genuinely unrelated clause must still fail closed to Unknown, never
  // "Heat Detector" -- broader recognition of a real family, never "match
  // every detector or every clause".
  const unrelated = scoreRequirementLink({ boqItem: item, requirement: { originalText: "Card readers shall support Wiegand and OSDP protocols.", system: "Access Control", category: "Other", source: {} } });
  assert.equal(unrelated.requirementEquipment, "Access Control Door Assembly");
  assert.notEqual(unrelated.requirementEquipment, "Heat Detector");
  // A different, real Detection Devices family must NOT be swept into Heat
  // Detector either -- this is a specific family match, not a generic
  // "any detector" bucket.
  const smokeClause = scoreRequirementLink({ boqItem: item, requirement: { originalText: "Addressable smoke detector shall meet UL 268.", system: "Fire Alarm", category: "Compliance", source: {} } });
  assert.equal(smokeClause.requirementEquipment, "Smoke Detector");
});
test("recognizes CCTV and access-control equipment using specific technical terms", () => {
  const fixed = scoreRequirementLink({ boqItem: { description: "Fixed dome camera, 5MP, outdoor" }, requirement: { originalText: "Megapixel Resolution Fixed Cameras shall be fixed Network IP megapixel cameras.", source: {} } });
  const ptz = scoreRequirementLink({ boqItem: { description: "PTZ camera, wall mounted" }, requirement: { originalText: "PTZ Cameras shall be Network IP cameras with dome enclosure.", source: {} } });
  const access = scoreRequirementLink({ boqItem: { description: "SACS door assembly with card reader and door contact" }, requirement: { originalText: "Door hardware equipment includes card readers and door contacts.", source: {} } });
  assert.ok(fixed.confidence >= 45); assert.equal(fixed.itemEquipment, "Fixed Camera");
  assert.ok(ptz.confidence >= 45); assert.equal(ptz.itemEquipment, "PTZ Camera");
  assert.ok(access.confidence >= 45); assert.equal(access.itemEquipment, "Access Control Door Assembly");
});
// Sprint 0.7 -- real Opera Fire Alarm project bug: BOQ item 34 "Manual Call
// Point MCLP" never received a link suggestion for the project's own approved
// spec clauses (28 46 00 PART 2 PRODUCTS, page 32, A/B) even after both the
// BOQ row and requirements were approved, because equipmentType() had no
// pattern for manual call points/pull stations -- both sides classified as
// "Unknown" and lost the +48 equipment-match signal, scoring below the link
// threshold. Reproduces the exact real text on both sides.
test("recognizes Manual Call Point / pull station equipment across BS EN and NFPA terminology", () => {
  const addressing = scoreRequirementLink({ boqItem: { description: "Manual Call Point MCLP", system: "28.01 - Fire Alarm System" }, requirement: { originalText: "Manual pull stations shall be individually addressable, suitable for two wire operation, with a high impact red Lexan body and raised white lettering.", source: {} } });
  const actionType = scoreRequirementLink({ boqItem: { description: "Manual Call Point MCLP", system: "28.01 - Fire Alarm System" }, requirement: { originalText: "Stations shall include an ADA compliant single action operating mechanism with a mechanical latch to hold an operated station open until reset.", source: {} } });
  assert.equal(addressing.itemEquipment, "Manual Call Point");
  assert.equal(addressing.requirementEquipment, "Manual Call Point");
  assert.ok(addressing.evidence.some((entry) => entry.startsWith("Equipment type: Manual Call Point")));
  assert.ok(addressing.confidence >= 25, `expected addressing clause to clear the link threshold, got ${addressing.confidence}`);
  assert.equal(actionType.itemEquipment, "Manual Call Point");
  const nfpaBox = scoreRequirementLink({ boqItem: { description: "Manual Call Point MCLP WP" }, requirement: { originalText: "Actuation of any manual fire alarm box shall cause the system to alarm.", source: {} } });
  assert.equal(nfpaBox.itemEquipment, "Manual Call Point");
  assert.equal(nfpaBox.requirementEquipment, "Manual Call Point");
  const doorHardware = scoreRequirementLink({ boqItem: { description: "Door locks shall unlock via a manual release device" }, requirement: { originalText: "The manual release device shall be readily accessible.", source: {} } });
  assert.notEqual(doorHardware.itemEquipment, "Manual Call Point");
});
// Sprint 1.11 -- the real remaining gap: requirement_364 is the SECOND
// sentence of requirement_363's own clause (28 46 00, PART 2 PRODUCTS, page
// 32, clause A -- the real Opera spec), continuing with bare "Stations"
// rather than repeating "manual pull stations". Its own source_location
// already carries originalClauseText spanning both sentences (the exact
// field requirement-intelligence-engine.mjs already reads for the same
// reason -- see its "shared clause-block" tests). Before this fix,
// scoreRequirementLink never read it, so requirement_364 never resolved to
// Manual Call Point on the requirement side and never cleared the link
// threshold for item 34 -- exactly reproducing the real DB gap traced this
// sprint (item 34 confirmed only to requirement_363, never even suggested
// requirement_364).
test("Sprint 1.11 -- a clause's second sentence resolves via the requirement's own shared clause-block text, not just its own sentence", () => {
  const clauseText = "Manual pull stations shall be individually addressable, suitable for two wire operation, with a high impact red Lexan body and raised white lettering. Stations shall include an ADA compliant single action operating mechanism with a mechanical latch to hold an operated station open until reset.";
  const withClauseContext = scoreRequirementLink({ boqItem: { description: "Manual Call Point MCLP", system: "28.01 - Fire Alarm System" }, requirement: { originalText: "Stations shall include an ADA compliant single action operating mechanism with a mechanical latch to hold an operated station open until reset.", system: "Fire Alarm", source: { originalClauseText: clauseText } } });
  assert.equal(withClauseContext.requirementEquipment, "Manual Call Point");
  assert.ok(withClauseContext.confidence >= 25, `expected the action-type clause to clear the link threshold once its own clause block is visible, got ${withClauseContext.confidence}`);
  assert.ok(withClauseContext.evidence.some((entry) => entry.startsWith("Equipment type: Manual Call Point")));
  // Missing/empty source (e.g. a requirement with no captured clause text) must not throw or fabricate a match.
  const withoutClauseContext = scoreRequirementLink({ boqItem: { description: "Manual Call Point MCLP", system: "28.01 - Fire Alarm System" }, requirement: { originalText: "Stations shall include an ADA compliant single action operating mechanism.", system: "Fire Alarm" } });
  assert.equal(withoutClauseContext.requirementEquipment, "Unknown");
});
test("assembles a Task 8 profile from confirmed links only", () => { const requirement = { id: "r1", standards: [{ body: "NFPA", number: "72" }], attributes: [{ name: "Voltage", value: 24 }], manufacturers: [{ manufacturer: "Honeywell", status: "Approved" }] }; const profile = assembleKnowledgeProfile({ boqItem: { id: "b1", projectId: "p1" }, links: [{ requirementId: "r1", status: "Confirmed" }, { requirementId: "r2", status: "Suggested" }], requirements: [requirement, { id: "r2" }], conflicts: [], accessories: [], compatibility: [] }); assert.equal(profile.requirements.length, 1); assert.equal(profile.suggestedLinks.length, 1); assert.equal(profile.readiness.approvedForTask8, true); });
test("wires canonical persistence, publication, profiles and auditable applicability review", async () => { const [schema, worker, index] = await Promise.all([readFile(new URL("../db/schema.ts", import.meta.url), "utf8"), readFile(new URL("../worker/engineering-knowledge-api.mjs", import.meta.url), "utf8"), readFile(new URL("../worker/index.ts", import.meta.url), "utf8")]); for (const entity of ["engineeringFacts", "engineeringFactProvenance", "boqRequirementLinks", "engineeringRelationships", "engineeringKnowledgeDecisions", "engineeringKnowledgeConflicts", "engineeringTaxonomyTerms", "engineeringUnitDefinitions"]) assert.match(schema, new RegExp(`export const ${entity}`)); assert.match(worker, /approved_for_downstream=1/); assert.match(worker, /knowledge-profile/); assert.match(worker, /Requirement Applicability Reviewed/); assert.match(index, /handleEngineeringKnowledgeApi/); });
