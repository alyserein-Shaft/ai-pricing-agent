import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateSafety } from "../app/domain/confidence-safety-engine.mjs";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";

// Stage-3 governance fix -- discovery/comparison (Stages 1-2) never required
// a project's blocking requirements to be resolved; the gap this closes is
// that Technical Approval (Stage 3) could reach "Eligible" for ANY family
// whose blocking requirement the old CATEGORY_REQUIRED_FIELDS allowlist in
// confidence-safety-engine.mjs didn't happen to name -- proven on Fire
// Alarm's own neutral "Heat Detector" family, which was never on that
// allowlist. The new check reads profile.missingInformation's own `blocking`
// flag -- the exact structural signal detectMissingInformation()
// (technical-requirement-engine.mjs) already computes generically, per
// system/family, via categoryMinimums/blockingFields -- never a
// re-derived or duplicated taxonomy rule inside the safety engine itself.

const root = new URL("../", import.meta.url);

const item = (overrides = {}) => ({ id: "boq-15", projectId: "project-1", system: "Fire Alarm", category: "Detection Devices", description: "Heat detector", unit: "Each", quantity: 9, productFamily: "Heat Detector", sourceDocumentId: "doc-1", sourceLocation: { sheet: "MECH RFQ", row: 15 }, extractionConfidence: 96, ...overrides });
const heatDetectorProfile = (overrides = {}) => ({
  id: "reqprofile-row15-v2", versionNumber: 2, readiness: { status: "Missing Critical Information", blockingReasons: ["compatibilityTarget is required to define a safe Fire Alarm product search boundary."] },
  confidence: { applicability: 0 }, standards: [], compatibility: [], accessories: [], categoryFields: {}, derivedRequirements: [],
  missingInformation: [
    { field: "standard", whyNeeded: "standard is required to define a safe Fire Alarm product search boundary.", blocking: false, clarificationQuestion: "Please confirm the standard, citing the governing document.", recommendedOwner: "Technical Reviewer" },
    { field: "compatibilityTarget", whyNeeded: "compatibilityTarget is required to define a safe Fire Alarm product search boundary.", technicalImpact: "Compliance or compatibility cannot be evaluated deterministically.", blocking: true, clarificationQuestion: "Please confirm the compatibility target, citing the governing document.", recommendedOwner: "Technical Reviewer" },
  ],
  ...overrides,
});
const candidate = (overrides = {}) => ({ id: "candidate-1", searchStage: "Structured", technicalStatus: "Technically Compliant", recommendationTier: "Recommended Candidate", confidence: "High Confidence", product: { id: "p1", partNumber: "IDP-HEAT-IV", reviewStatus: "Reviewed", sourceReliability: "Manufacturer Verified" }, comparisons: [{ pass: true, result: "Pass" }], standards: [], compatibility: [], accessories: [], lifecycle: { state: "Active", result: "Pass", blocking: false, warning: false }, mandatoryFailures: [], commercialAvailability: "Valid Current Price Available", provenance: { productSource: { documentId: "catalogue" } }, // R2: an ACCEPTABLE 4D decision, so these tests keep asserting the Requirement-Profile blocking-requirement contract rather than the 4D authority gate.
  engineeringTechnicalDecision: { state: "TECHNICALLY_ACCEPTABLE", authority: "SYSTEM_DETERMINISTIC_EVALUATION", deterministic: true, exceptionReasons: [], warnings: [], requiresAcknowledgment: false, versionFingerprints: { decisionVersion: "technical-decision-1.0.0", requirementProfileVersion: 2, itemId: "boq-15" } }, ...overrides });
const provenance = { complete: true, confidence: 100, documentClassificationConfidence: 98, specificationExtractionConfidence: 96 };
const user = { id: "reviewer-1" };
const price = { productId: "p1", candidateId: "candidate-1", approvalStatus: "Approved", sourceId: "quote-1", currency: "SAR", validUntil: "2099-01-01" };

test("2. Heat Detector + unresolved compatibilityTarget entering Safety evaluation -- technical eligibility is blocked", () => {
  const result = evaluateSafety({ item: item(), profile: heatDetectorProfile(), candidate: candidate(), provenance, prices: [price], user });
  assert.doesNotMatch(result.approvalEligibility.technical, /^Eligible/);
  assert.equal(result.approvalReady, false);
});

test("3. the Safety block explicitly references compatibilityTarget with Requirement Profile provenance", () => {
  const result = evaluateSafety({ item: item(), profile: heatDetectorProfile(), candidate: candidate(), provenance, prices: [price], user });
  const found = result.blocks.find((entry) => entry.code === "UNRESOLVED_PROJECT_REQUIREMENT" && entry.source?.field === "compatibilityTarget");
  assert.ok(found, JSON.stringify(result.blocks));
  assert.equal(found.source.requirementProfileId, "reqprofile-row15-v2");
  assert.equal(found.source.requirementProfileVersion, 2);
  assert.equal(found.blocking, true);
  assert.match(found.technicalMessage, /compatibilityTarget is required to define a safe Fire Alarm product search boundary/);
});

test("5. resolving all blocking Requirement Profile requirements removes this specific block", () => {
  const resolvedProfile = heatDetectorProfile({
    readiness: { status: "Ready for Matching", blockingReasons: [] },
    confidence: { applicability: 95 },
    missingInformation: [{ field: "standard", blocking: false, whyNeeded: "..." }],
  });
  const result = evaluateSafety({ item: item(), profile: resolvedProfile, candidate: candidate(), provenance, prices: [price], user });
  assert.equal(result.blocks.some((entry) => entry.code === "UNRESOLVED_PROJECT_REQUIREMENT"), false);
  assert.equal(result.approvalEligibility.technical, "Eligible for Technical Approval");
  assert.equal(result.approvalReady, true);
});

test("6. missing non-blocking/optional requirements do NOT prevent technical eligibility", () => {
  const onlyOptionalMissing = heatDetectorProfile({
    readiness: { status: "Ready with Warnings", blockingReasons: [] },
    confidence: { applicability: 95 },
    missingInformation: [{ field: "standard", blocking: false, whyNeeded: "..." }],
  });
  const result = evaluateSafety({ item: item(), profile: onlyOptionalMissing, candidate: candidate(), provenance, prices: [price], user });
  assert.equal(result.blocks.some((entry) => entry.code === "UNRESOLVED_PROJECT_REQUIREMENT"), false);
  assert.equal(result.approvalReady, true);
});

test("7. existing candidate attribute mismatches continue to block independently of this gate", () => {
  const nonCompliantCandidate = candidate({ technicalStatus: "Non-Compliant", mandatoryFailures: [{ type: "Voltage", result: "Fail" }] });
  const resolvedProfile = heatDetectorProfile({ readiness: { status: "Ready for Matching", blockingReasons: [] }, missingInformation: [] });
  const result = evaluateSafety({ item: item(), profile: resolvedProfile, candidate: nonCompliantCandidate, provenance, prices: [price], user });
  assert.equal(result.blocks.some((entry) => entry.code === "UNRESOLVED_PROJECT_REQUIREMENT"), false, "the resolved profile must not spuriously block");
  assert.equal(result.complianceState, "Non-Compliant");
  assert.equal(result.approvalReady, false, "the pre-existing mandatory-failure gate must still block independently");
});

test("8. the gate is generic -- a second, unrelated family/system with its own blocking Requirement Profile requirement is blocked identically, with no Heat-Detector- or Fire-Alarm-specific logic involved", () => {
  const cctvItem = item({ system: "CCTV", category: "Cameras", description: "4MP IP dome camera", productFamily: "Dome Camera" });
  const cctvProfile = heatDetectorProfile({
    id: "reqprofile-cctv-v1",
    versionNumber: 1,
    missingInformation: [{ field: "ipRating", whyNeeded: "ipRating is required to define a safe CCTV product search boundary.", blocking: true, recommendedOwner: "Technical Reviewer" }],
  });
  const result = evaluateSafety({ item: cctvItem, profile: cctvProfile, candidate: candidate({ product: { id: "p2", partNumber: "DOME-4MP", reviewStatus: "Reviewed" } }), provenance, prices: [price], user });
  const found = result.blocks.find((entry) => entry.code === "UNRESOLVED_PROJECT_REQUIREMENT" && entry.source?.field === "ipRating");
  assert.ok(found, "the same generic gate must fire for an unrelated system/family without any new family-specific code");
  assert.equal(result.approvalReady, false);
});

test("candidate discovery is unaffected -- a normal, healthy Safety evaluation with no blocking requirements still reaches Eligible (regression sanity)", () => {
  const healthyProfile = heatDetectorProfile({ readiness: { status: "Ready for Matching", blockingReasons: [] }, confidence: { applicability: 95 }, missingInformation: [], standards: [{ body: "EN54" }], compatibility: [{ targetItem: "Farenhyt protocol" }], accessories: [{ accessory: "Detector base" }] });
  const result = evaluateSafety({ item: item(), profile: healthyProfile, candidate: candidate({ standards: [{ pass: true, result: "Pass" }], compatibility: [{ pass: true, result: "Pass" }], accessories: [{ pass: true, result: "Pass" }] }), provenance, prices: [price], user });
  assert.equal(result.approvalEligibility.technical, "Eligible for Technical Approval");
  assert.equal(result.approvalReady, true);
});

test("1. candidate discovery/matching retrieval never reads Requirement Profile missingInformation/readiness -- unaffected by an unresolved blocking requirement", () => {
  const boqItem = { id: "boq-15", description: "Heat detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Heat Detector", attributes: {} };
  const products = [{ id: "p1", manufacturer: "Honeywell", family: "Heat Detector", partNumber: "IDP-HEAT-IV", description: "Addressable heat detector", lifecycleStatus: "Active", reviewStatus: "Reviewed", attributes: [], standards: [], compatibility: [], accessories: [], source: { sheet: "Catalogue", row: 1 } }];
  const blocked = runProductMatching({ profile: { versionNumber: 2, boqItem, readiness: { status: "Missing Critical Information", blockingReasons: ["compatibilityTarget is required..."] }, consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [], missingInformation: heatDetectorProfile().missingInformation }, products });
  const asIfResolved = runProductMatching({ profile: { versionNumber: 2, boqItem, readiness: { status: "Ready for Matching", blockingReasons: [] }, consolidatedRequirements: [], standards: [], manufacturers: [], compatibility: [], accessories: [], derivedRequirements: [], clarifications: [], missingInformation: [] }, products });
  assert.equal(blocked.candidates.length, asIfResolved.candidates.length);
  assert.equal(blocked.candidates[0]?.product.id, asIfResolved.candidates[0]?.product.id);
  assert.equal(blocked.candidates[0]?.searchStage, asIfResolved.candidates[0]?.searchStage, "an unresolved blocking project requirement must not narrow or change retrieval");
});

// 4. Technical approval endpoint rejects the candidate while the block
// remains open -- proven as a full provenance chain rather than a live HTTP
// call (per this suite's own established convention in
// tests/confidence-safety-api.test.mjs, which tests this exact file
// structurally): (a) evaluateSafety's own output above already proves
// technical_eligibility fails /^Eligible/ and the block carries blocking:true;
// (b) the persistence layer inserts this block with no explicit status
// column, so it relies on the schema's own default; (c) that default is
// 'Open'; (d) the approve endpoint's own EXISTING, UNMODIFIED check already
// refuses whenever any block has status 'Open'. No new approval logic was
// added or needed.
test("4. the approval endpoint's existing open-block check applies unmodified to this new block (full provenance chain)", async () => {
  const apiSource = await readFile(new URL("worker/confidence-safety-api.mjs", root), "utf8");
  const engineSource = await readFile(new URL("app/domain/confidence-safety-engine.mjs", root), "utf8");
  const schemaSource = await readFile(new URL("db/schema.ts", root), "utf8");
  // (b) the INSERT never sets a status column for safety_blocks -- it relies
  // entirely on the schema's own default.
  assert.match(apiSource, /INSERT INTO safety_blocks \(id, safety_decision_id, code, severity, scope, user_message, technical_message, resolution_action, owner, source, rule_version, overridable\)/);
  // (d) the approve handler's own unmodified refusal condition -- no parallel
  // gate was added anywhere in this file for the new block type.
  assert.match(apiSource, /full\.blocks\.some\(\(entry\) => entry\.status === "Open"\)/);
  assert.match(apiSource, /eligible = type === "Technical" \? \/\^Eligible\/\.test\(current\.technical_eligibility\)/);
  // (c) the canonical schema default safety_blocks rows are created under
  // (db/schema.ts is the source of truth every drizzle migration is
  // generated from).
  const safetyBlocksDefinition = schemaSource.slice(schemaSource.indexOf('sqliteTable("safety_blocks"'));
  assert.match(safetyBlocksDefinition.slice(0, safetyBlocksDefinition.indexOf(")]);") + 1), /status: text\("status"\)\.notNull\(\)\.default\("Open"\)/);
  // (a) this new code path produces exactly that shape.
  assert.match(engineSource, /"UNRESOLVED_PROJECT_REQUIREMENT"/);
});

// 9. No automatic pricing, selection, Requirement Profile mutation, or
// matching run occurs anywhere in this file -- every test above calls only
// the pure evaluateSafety()/runProductMatching() functions directly with
// hand-built fixtures; none touches a database, an HTTP endpoint, or any
// mutating worker function.
