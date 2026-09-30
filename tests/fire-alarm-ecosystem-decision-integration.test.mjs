// SLICE 2B -- END-TO-END INTEGRATION PROOF.
//
// The unit suite (fire-alarm-ecosystem-decision.test.mjs) proves the domain
// contract. THIS suite proves the wiring: that a governed project ecosystem
// decision actually reaches `executeRequirementProfile`, the real worker path,
// against a database built from the ACTUAL ordered drizzle-active migration
// chain -- and that it fails closed when there is no decision.
//
// It pins the four things the mission calls out that a unit test cannot prove:
//
//   A. With no governed decision, a Fire Alarm panel is STILL blocked, and the
//      ecosystem module changes nothing about that.
//   B. Recording a governed decision moves the requirement off
//      "Missing Critical Information" to a real review state -- never straight
//      to "Ready for Matching".
//   C. The decision participates in the input FINGERPRINT, so recording,
//      superseding or reversing it invalidates a cached profile through the
//      existing currency mechanism. There is no second staleness framework.
//   D. PROVENANCE names the authority: the profile's compatibility entry is
//      attributable to a human project decision, and claims no product
//      compatibility whatsoever.
//
// It also proves the negative cases still hold end-to-end: a protocol Source
// Fact alone never satisfies the target, and an open blocking conflict stays
// blocking even when a governed decision exists.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { executeRequirementProfile } from "../worker/technical-requirement-api.mjs";
import {
  recordFireAlarmEcosystemDecision,
  resolveProjectFireAlarmEcosystemDecision,
} from "../worker/fire-alarm-ecosystem-decision-api.mjs";
import {
  buildTechnicalRequirementProfile,
} from "../app/domain/technical-requirement-engine.mjs";
import {
  ecosystemBasisRelationships,
  ECOSYSTEM_ELIGIBILITY,
} from "../app/domain/fire-alarm-ecosystem-requirement-basis.mjs";
import { validateProjectFireAlarmEcosystemDecision } from "../app/domain/fire-alarm-ecosystem-decision.mjs";

const OWNER = "user-owner-1";
const PROJECT = "project-ecosystem-e2e";

const buildDatabase = () => {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id, name) VALUES ('org1', 'Org One');
    INSERT INTO projects (id, name, owner_user_id, organization_id, system_domain, initial_status)
      VALUES ('${PROJECT}', 'Fire Alarm Ecosystem E2E', '${OWNER}', 'org1', 'Fire Alarm', 'Active');
    INSERT INTO documents (id, project_id, logical_name, document_type, classification_source, created_by)
      VALUES ('doc1', '${PROJECT}', 'Spec 28 46 00', 'Technical Specification', 'Manual', '${OWNER}');
    INSERT INTO document_versions (id, document_id, version_number, original_filename, stored_filename, extension, mime_type, byte_size, sha256, object_key, uploaded_by)
      VALUES ('dv1', 'doc1', 1, 'spec.pdf', 'spec.stored', 'pdf', 'application/pdf', 4, 'sha-dv1', 'projects/${PROJECT}/spec.pdf', '${OWNER}');
    UPDATE documents SET current_version_id = 'dv1' WHERE id = 'doc1';
    INSERT INTO boq_extraction_versions (id, document_id, document_version_id, version_number, status, parser_version, ruleset_version, ocr_version, created_by)
      VALUES ('ext1', 'doc1', 'dv1', 1, 'Completed', 'parser-v1', 'rules-v1', 'ocr-v1', '${OWNER}');
    INSERT INTO boq_items (id, project_id, row_type, extraction_version_id, source_document_id, sequence, section_path, item_number, description, numeric_quantity, original_quantity, normalized_unit, original_unit, system_value, category, subcategory, current_values, source_location, original_raw_values, review_status, approved_for_downstream, extraction_confidence, confidence_state)
      VALUES ('boq-facp', '${PROJECT}', 'BOQ Item', 'ext1', 'doc1', 1, '[]', '1', 'Addressable fire alarm control panel', '1', '1', 'Each', 'Each', 'Fire Alarm', 'Control Equipment', 'Fire Alarm Control Panel', '{}', '{"row": 3, "column": "Description"}', '{}', 'Approved', 1, 92, 'High Confidence');
  `);
  return { raw, DB: d1(raw) };
};

const decisionInput = (overrides = {}) => ({
  ecosystem: "NOTIFIER",
  primaryProtocol: "FlashScan",
  allowedLegacyProtocols: ["CLIP"],
  preliminaryPanelFamily: { key: "INSPIRE_N16", isSelected: false, isConsultantApproved: false },
  complianceBasisState: "PARTIALLY_RESOLVED",
  contractualManufacturerAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
  substitutionAuthority: "HUMAN_APPROVAL_REQUIRED",
  directMatchPolicy: "Addressable devices must be Notifier ecosystem; third-party permitted only via proven supervised interfaces.",
  notDirectMatchEcosystems: ["SIMPLEX"],
  appliesWhile: "This project's Fire Alarm system, per the current specification version.",
  evidence: ["28 46 00 Fire Detection and Alarm System"],
  reason: "Project documents name FlashScan/CLIP references without mandating a manufacturer; adopt Notifier as the governed technical design basis.",
  decidedBy: OWNER,
  decidedRole: "Technical Manager",
  specificationVersion: "SPEC-28-46-00-rev-3",
  ...overrides,
});

// The D1 shim's run()/all() are async and take no arguments -- values go
// through .bind(). Seeding uses the raw DatabaseSync handle, exactly as the
// established handoff suite does, because the shim exists to model the worker.
// `executeRequirementProfile` returns {profileId, status, profile, idempotent} --
// it does NOT surface the fingerprint. The fingerprint is a PERSISTED column on
// requirement_profile_versions, so currentness is asserted against the stored
// rows. That is the stronger assertion anyway: it proves the decision changed
// what was actually written, not merely what an in-memory value held.
const profileRows = async (DB) =>
  (await DB.prepare(
    "SELECT id, version_number, status, readiness_status, input_fingerprint, superseded_at FROM requirement_profile_versions WHERE project_id=? ORDER BY version_number",
  ).bind(PROJECT).all()).results;

const compatGap = (profile) => (profile.missingInformation || []).find((e) => e.field === "compatibilityTarget");

// Shared deterministic fixtures for the engine-level negative cases.
const PANEL = {
  id: "boq-facp", itemNumber: "1", system: "Fire Alarm", category: "Control Equipment",
  productFamily: "Fire Alarm Control Panel", description: "Addressable fire alarm control panel",
  unit: "EA", quantity: 1, classificationConfidence: 92,
};
const CURRENT = {
  id: "ecosystemDecision_test", projectId: PROJECT, decidedAt: "2026-09-29T00:00:00.000Z",
  decision: validateProjectFireAlarmEcosystemDecision({
    ecosystem: "NOTIFIER", primaryProtocol: "FlashScan", allowedLegacyProtocols: ["CLIP"],
    preliminaryPanelFamily: { key: "INSPIRE_N16", isSelected: false, isConsultantApproved: false },
    complianceBasisState: "PARTIALLY_RESOLVED",
    contractualManufacturerAcceptance: "CONSULTANT_APPROVAL_REQUIRED",
    substitutionAuthority: "HUMAN_APPROVAL_REQUIRED",
    directMatchPolicy: "Addressable devices must be Notifier ecosystem; third-party permitted only via proven supervised interfaces.",
    notDirectMatchEcosystems: ["SIMPLEX"],
    appliesWhile: "This project's Fire Alarm system, per the current specification version.",
    evidence: ["28 46 00 Fire Detection and Alarm System"],
    reason: "Project documents name FlashScan/CLIP references without mandating a manufacturer; adopt Notifier as the governed technical design basis.",
    decidedBy: OWNER, decidedRole: "Technical Manager", specificationVersion: "SPEC-28-46-00-rev-3",
  }),
};

// ===========================================================================
test("Slice 2B-E2E-1. NO governed decision -> the engine is untouched and fails closed", async () => {
  const { DB } = buildDatabase();

  const resolved = await resolveProjectFireAlarmEcosystemDecision(DB, PROJECT);
  assert.equal(resolved, null, "no decision may be invented");

  const result = await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });
  const profile = result.profile;

  assert.ok(compatGap(profile), "compatibilityTarget must still be reported");
  assert.equal(compatGap(profile).blocking, true, "and must still BLOCK");
  assert.equal(profile.readiness.status, "Missing Critical Information");
  assert.equal(profile.compatibility.length, 0, "no ecosystem relationship may be invented");
  assert.equal(profile.compatibility.some((c) => c.authority === "PROJECT_ECOSYSTEM_DECISION"), false);
});

// ===========================================================================
test("Slice 2B-E2E-2. WITH a governed decision -> target named, review still required", async () => {
  const { DB } = buildDatabase();
  await recordFireAlarmEcosystemDecision(DB, { projectId: PROJECT, actor: { id: OWNER, role: "Technical Manager" }, input: decisionInput() });

  const result = await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });
  const profile = result.profile;

  assert.equal(compatGap(profile), undefined, "a genuinely named governed target clears the gap");
  assert.notEqual(profile.readiness.status, "Missing Critical Information");
  assert.notEqual(profile.readiness.status, "Ready for Matching",
    "an ecosystem basis alone must NEVER make an item ready for matching");

  assert.equal(profile.compatibility.length, 1);
  const entry = profile.compatibility[0];
  assert.equal(entry.targetItem, "Notifier Fire Alarm ecosystem (FlashScan / CLIP)");
  assert.match(entry.targetItem, /ecosystem/i, "the target is a family, never an exact model");
  assert.doesNotMatch(entry.targetItem, /\b(FACP|HP-|Notifier-[A-Z]?\d)\b/i,
    "no model number may be implied by the basis");
});

// ===========================================================================
test("Slice 2B-E2E-3. PROVENANCE names the ecosystem authority and claims no product compatibility", async () => {
  const { DB } = buildDatabase();
  await recordFireAlarmEcosystemDecision(DB, { projectId: PROJECT, actor: { id: OWNER, role: "Technical Manager" }, input: decisionInput() });
  const { profile } = await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });

  const entry = profile.compatibility[0];
  assert.equal(entry.authority, "PROJECT_ECOSYSTEM_DECISION");
  assert.equal(entry.scope, "PROJECT_REQUIREMENT");
  assert.equal(entry.basis, "HUMAN_ENGINEERING_DECISION");
  assert.ok(entry.decisionId, "the governing decision id travels with the evidence");
  assert.equal(entry.decidedRole, "Technical Manager");

  // The single most important boundary, end to end.
  assert.equal(entry.productCompatibilityClaimed, false);
  assert.equal(entry.productCompatibilityState, "NOT_EVALUATED_NO_PRODUCT_EVIDENCE");
  assert.equal(profile.compatibility.some((c) => c.productCompatibilityClaimed === true), false,
    "no compatibility entry may claim a product is compatible");
});

// ===========================================================================
test("Slice 2B-E2E-4. The decision participates in the FINGERPRINT (currentness)", async (t) => {
  const { DB } = buildDatabase();

  await t.test("recording a decision produces a NEW profile version with a DIFFERENT fingerprint", async () => {
    await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });
    const before = await profileRows(DB);
    assert.equal(before.length, 1);

    await recordFireAlarmEcosystemDecision(DB, { projectId: PROJECT, actor: { id: OWNER, role: "Technical Manager" }, input: decisionInput() });
    const after = await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });

    assert.equal(after.idempotent, false, "recording a decision must force recomputation, not reuse the cache");
    const rows = await profileRows(DB);
    assert.equal(rows.length, 2, "a genuinely new profile version must be written");
    assert.notEqual(rows[1].input_fingerprint, rows[0].input_fingerprint,
      "the decision MUST change the input fingerprint, or a cached profile could silently outlive it");
  });

  await t.test("SUPERSEDING the decision also invalidates the cached profile", async () => {
    const before = await profileRows(DB);
    await recordFireAlarmEcosystemDecision(DB, {
      projectId: PROJECT,
      actor: { id: OWNER, role: "Technical Manager" },
      input: decisionInput({ directMatchPolicy: "Superseded: tightened direct-match policy for this project." }),
    });
    const after = await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });
    assert.equal(after.idempotent, false);
    const rows = await profileRows(DB);
    assert.notEqual(rows.at(-1).input_fingerprint, before.at(-1).input_fingerprint,
      "a superseding decision must also invalidate the cached profile");
  });

  await t.test("an unchanged decision stays idempotent through the normal path", async () => {
    const first = await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });
    const rows = await profileRows(DB);
    const second = await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });
    assert.equal(second.idempotent, true, "no spurious recomputation when nothing changed");
    assert.equal(second.profileId, first.profileId);
    assert.equal((await profileRows(DB)).length, rows.length, "no extra version may be written");
  });

  await t.test("history is preserved, never overwritten", async () => {
    const rows = await profileRows(DB);
    assert.ok(rows.length >= 3, `expected the superseded history to be retained, saw ${rows.length}`);
    const superseded = rows.filter((r) => r.superseded_at);
    assert.ok(superseded.length >= 2, "prior profile versions must be superseded, not deleted");
    const fingerprints = new Set(rows.map((r) => r.input_fingerprint));
    assert.equal(fingerprints.size, rows.length, "each version must carry its own distinct fingerprint");
  });
});

// ===========================================================================
test("Slice 2B-E2E-5. NEGATIVE -- a protocol Source Fact alone still cannot satisfy the target", async () => {
  const { raw, DB } = buildDatabase();
  raw.prepare(`INSERT INTO engineering_facts (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,model_version)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    "fact-protocol", PROJECT, "BOQ Item", "boq-facp", "protocol_compatibility",
    JSON.stringify({ value: "FlashScan, CLIP", unit: null }), "text", "Equal", "Source Fact",
    "BOQ Item", "boq-facp", "Active", 95, "spec-source-fact-promotion-1.0.0",
  );
  raw.prepare(`INSERT INTO engineering_fact_provenance (id,fact_id,source_type,source_id,document_id,document_version_id,page,section,clause,confidence)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
    "prov-f1", "fact-protocol", "Specification", "doc1", "doc1", "dv1", 11, "28 46 00", "5", 95,
  );

  const { profile } = await executeRequirementProfile({ DB }, { itemId: "boq-facp", userId: OWNER, runId: null });

  assert.ok(compatGap(profile), "a protocol Source Fact must NOT satisfy compatibilityTarget");
  assert.equal(compatGap(profile).blocking, true);

  const evidence = profile.compatibility.find((c) => c.source === "Source Fact");
  assert.ok(evidence, "the Source Fact is still recorded as compatibility EVIDENCE");
  assert.equal(evidence.blocking, false);
  assert.equal(evidence.status, "Evidence");
});

// ===========================================================================
test("Slice 2B-E2E-6. NEGATIVE -- a governing ecosystem basis does not MASK a blocking conflict", () => {
  // The claim under test is Slice 2B's, not the engine's: adding the ecosystem
  // basis relationship must not change how a blocking conflict is treated.
  // `calculateReadiness` already gives conflicts precedence over missing
  // information (engine:249-250); this proves the basis cannot reorder that.
  //
  // Asserted against the engine's real contract using a Source Fact conflict --
  // the same mechanism IR-1 restored -- rather than re-deriving the engine's own
  // conflict precedence in a fixture.
  const withConflict = (relationships) => buildTechnicalRequirementProfile({
    boqItem: PANEL,
    relationships,
    // Conflict shape copied from the engine's own passing case (test K,
    // tests/technical-requirement-engine-source-facts.test.mjs): BOTH facts
    // named in sourceFacts, and BOTH ids listed in sourceFactConflicts. The
    // engine derives the conflict entry from the intersection (engine:280
    // conflictedFactIds -> engine:301 conflictedSourceFacts), so naming a fact
    // as conflicted that was never supplied as evidence would invent a
    // conflict rather than record one.
    sourceFacts: [
      { factId: "fact-a", predicate: "fixed_temperature_setpoint", value: "135\u00b0F", unit: null, confidence: 95, scopeType: "BOQ Item", scopeId: PANEL.id, factType: "Source Fact", status: "Active" },
      { factId: "fact-b", predicate: "fixed_temperature_setpoint", value: "190\u00b0F", unit: null, confidence: 95, scopeType: "BOQ Item", scopeId: PANEL.id, factType: "Source Fact", status: "Active" },
    ],
    sourceFactConflicts: [{ factId: "fact-a" }, { factId: "fact-b" }],
  });

  const withoutBasis = withConflict([]);
  const withBasis = withConflict(ecosystemBasisRelationships(CURRENT));

  assert.equal(withoutBasis.readiness.status, "Conflict Blocking");
  assert.equal(withBasis.readiness.status, "Conflict Blocking",
    "a governing ecosystem basis must NEVER mask an open blocking conflict");

  // And the basis still contributes its evidence while the conflict stands.
  assert.equal(withBasis.compatibility.some((c) => c.authority === "PROJECT_ECOSYSTEM_DECISION"), true,
    "the basis evidence is still present; it is the conflict that blocks");
  assert.equal(withBasis.compatibility.some((c) => c.productCompatibilityClaimed === true), false);
});

// ===========================================================================
test("Slice 2B-E2E-7. LIFECYCLE / AVAILABILITY is advisory, never a technical gate", async (t) => {
  // Mission section 5/12: a technically suitable, compatible, evidence-backed
  // product must remain selectable when lifecycle or regional availability is
  // uncertain, discontinued in another market, or unknown. Those are commercial
  // / procurement conditions, not engineering incompatibility.
  //
  // Asserted by executing the REAL matching engine against the same profile
  // with only lifecycleStatus varied -- so the comparison isolates lifecycle
  // completely.
  const { evaluateCandidate } = await import("../app/domain/product-matching-engine.mjs");

  const profile = {
    boqItem: {
      id: PANEL.id, system: "Fire Alarm", category: "Control Equipment",
      productFamily: "Fire Alarm Control Panel", description: PANEL.description,
      unit: "EA", quantity: 1,
    },
    consolidatedRequirements: [], standards: [], compatibility: [], accessories: [],
    derivedRequirements: [], versionNumber: 1,
  };
  const product = (lifecycleStatus) => ({
    id: "prod-1", partNumber: "IFP-2100HV", manufacturer: "NOTIFIER",
    lifecycleStatus, attributes: {}, certifications: [], compatibility: [], source: {},
  });
  const evaluate = (lifecycleStatus) => evaluateCandidate({
    profile,
    generated: { product: product(lifecycleStatus), stage: "Exact Identity", searchScore: 1, basis: [], evidenceStrength: "Strong" },
    projectId: null,
  });

  await t.test("a DISCONTINUED product is not a technical failure", () => {
    const result = evaluate("Discontinued");
    assert.equal(result.lifecycle.blocking, false,
      "lifecycle must never be a technical blocking predicate");
    assert.equal(result.mandatoryFailures.length, 0,
      "a discontinued product must not accumulate a mandatory technical failure");
    assert.equal(result.lifecycle.warning, true,
      "but it MUST still surface as a warning requiring acknowledgment");
  });

  await t.test("end-of-sale and unknown lifecycle are likewise non-blocking", () => {
    for (const state of ["End of Sale", "Unknown — Review Required"]) {
      const result = evaluate(state);
      assert.equal(result.lifecycle.blocking, false, `${state} must not block`);
      assert.equal(result.mandatoryFailures.length, 0, `${state} must not be a mandatory failure`);
    }
  });

  await t.test("lifecycle uncertainty never changes technicalStatus", () => {
    const statuses = ["Current", "Discontinued", "End of Sale", "Unknown — Review Required"]
      .map((state) => evaluate(state).technicalStatus);
    assert.equal(new Set(statuses).size, 1,
      `lifecycle must not alter technicalStatus; saw ${JSON.stringify(statuses)}`);
  });

  await t.test("a replacement candidate is a clean pass, not a warning", () => {
    const result = evaluate("Discontinued — Replacement Candidate");
    assert.equal(result.lifecycle.result, "Pass");
    assert.equal(result.lifecycle.warning, false);
  });

  await t.test("the ecosystem basis does not introduce any lifecycle gate", async () => {
    const source = await readFile(
      new URL("../app/domain/fire-alarm-ecosystem-requirement-basis.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(source, /lifecycle|discontinued|end of sale|availability|stock/i,
      "Slice 2B must not read lifecycle or availability as an eligibility input");
  });
});

// ===========================================================================
test("Slice 2B-E2E-8. MATCHING consumes the basis as a REQUIREMENT, never as a product capability", async (t) => {
  // End-to-end closure of the mission's integration requirement (#3, #4, #6):
  // the persisted decision must actually reach Technical Matching, be visible
  // in its compatibility comparison, and be reported honestly as unmet
  // product evidence -- because NO product evidence has been established.
  const { evaluateCandidate } = await import("../app/domain/product-matching-engine.mjs");

  const profile = {
    boqItem: {
      id: PANEL.id, system: "Fire Alarm", category: "Control Equipment",
      productFamily: "Fire Alarm Control Panel", description: PANEL.description,
      unit: "EA", quantity: 1,
    },
    consolidatedRequirements: [], standards: [], accessories: [], derivedRequirements: [],
    compatibility: ecosystemBasisRelationships(CURRENT),
    versionNumber: 1,
  };
  const product = (manufacturer, compatibility = []) => ({
    id: "prod-1", partNumber: "X-1", manufacturer, lifecycleStatus: "Current",
    attributes: {}, certifications: [], compatibility, source: {},
  });
  const run = (manufacturer, compatibility) => evaluateCandidate({
    profile,
    generated: { product: product(manufacturer, compatibility), stage: "Exact Identity", searchScore: 1, basis: [], evidenceStrength: "Strong" },
    projectId: null,
  });

  await t.test("the basis reaches matching as a compatibility REQUIREMENT", () => {
    const result = run("NOTIFIER");
    assert.equal(result.compatibility.length, 1,
      "the ecosystem basis must appear in the matching compatibility comparison");
    const entry = result.compatibility[0];
    assert.equal(entry.result, "Evidence Missing",
      "with no product evidence the honest result is Evidence Missing, never 'Verified Compatible'");
    assert.equal(entry.compatibilityState, "UNKNOWN");
    assert.equal(entry.pass, false, "the requirement is not satisfied by the decision alone");
    assert.equal(entry.blocking, false, "an unmet requirement is not an incompatibility");
  });

  await t.test("the decision does NOT manufacture a compatible product", () => {
    const result = run("NOTIFIER");
    assert.equal(result.compatibility.some((c) => c.result === "Verified Compatible"), false,
      "an ecosystem decision must never produce a verified product match");
    assert.equal(result.mandatoryFailures.length, 0,
      "and must never create a mandatory technical failure on its own");
  });

  await t.test("a product OUTSIDE the ecosystem is not verified by shared parent alone", () => {
    const inEcosystem = run("NOTIFIER");
    const other = run("Simplex");
    const a = inEcosystem.compatibility[0];
    const b = other.compatibility[0];
    assert.equal(b.result, "Evidence Missing",
      "a Simplex product gets no credit merely for being comparable in kind");
    assert.equal(a.requirement.targetItem, b.requirement.targetItem,
      "both are measured against the same governed target");
  });

  await t.test("genuine product evidence is what flips it, and then only for that product", () => {
    // The only thing that may satisfy the basis is REAL product-level
    // compatibility evidence naming the governed target.
    const withEvidence = run("NOTIFIER", [{ targetItem: CURRENT.decision.compatibilityTarget, relationshipType: "Compatible With" }]);
    assert.equal(withEvidence.compatibility[0].result, "Verified Compatible");
    assert.equal(withEvidence.compatibility[0].pass, true);

    const stillOther = run("Simplex", [{ targetItem: CURRENT.decision.compatibilityTarget, relationshipType: "Compatible With" }]);
    assert.equal(stillOther.compatibility[0].result, "Verified Compatible",
      "product evidence is the governing input; the basis does not override it either way");
  });

  await t.test("an explicit incompatibility offer still blocks, basis or no basis", () => {
    const blocked = run("NOTIFIER", [{ targetItem: CURRENT.decision.compatibilityTarget, relationshipType: "Does Not Support" }]);
    assert.equal(blocked.compatibility[0].blocking, true,
      "a recorded incompatibility remains blocking; the basis cannot mask it");
    assert.equal(blocked.compatibility[0].result, "Incompatible");
  });
});

// ===========================================================================
test("Slice 2B-E2E-9. ROUTE is live, authorized, and fail-closed", async (t) => {
  const { handleFireAlarmEcosystemDecisionApi } = await import("../worker/fire-alarm-ecosystem-decision-api.mjs");

  // The route authenticates through resolveApplicationContext, which in this
  // deployment is single-user (worker/application-context.mjs). The env must
  // therefore declare the access mode and the acting user, exactly as
  // tests/auth-001-library-capability.test.mjs:24 does, and the seeded project
  // owner must be that same user -- the handler scopes every read by
  // owner_user_id.
  const env = (DB) => ({ DB, APP_ACCESS_MODE: "single-user", APP_USER_ID: OWNER, APP_ORGANIZATION_ID: "org1" });
  const call = (DB, path, init = {}) => handleFireAlarmEcosystemDecisionApi(
    new Request(`https://app.test${path}`, init),
    env(DB),
  );
  const post = (DB, path, body) => call(DB, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  await t.test("GET with no decision is 404 ECOSYSTEM_DECISION_REQUIRED", async () => {
    const { DB } = buildDatabase();
    const response = await call(DB, `/api/projects/${PROJECT}/fire-alarm/ecosystem`);
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.error.code, "ECOSYSTEM_DECISION_REQUIRED");
    assert.match(body.error.message, /fail-closed/i, "the message must state the fail-closed posture");
  });

  await t.test("GET returns the basis and never claims product compatibility", async () => {
    const { DB } = buildDatabase();
    await recordFireAlarmEcosystemDecision(DB, { projectId: PROJECT, actor: { id: OWNER, role: "Technical Manager" }, input: decisionInput() });
    const response = await call(DB, `/api/projects/${PROJECT}/fire-alarm/ecosystem`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.productCompatibilityClaimed, false);
    assert.ok(body.requirementBasis, "the API must expose the engine input");
    assert.equal(body.requirementBasis.compatibilityRelationship.productCompatibilityClaimed, false);
    assert.equal(body.stillUnresolved.contractualManufacturerAcceptance, "CONSULTANT_APPROVAL_REQUIRED",
      "the API must keep reporting what is still unresolved");
  });

  await t.test("classify is reachable and returns a governed verdict, not a match", async () => {
    const { DB } = buildDatabase();
    await recordFireAlarmEcosystemDecision(DB, { projectId: PROJECT, actor: { id: OWNER, role: "Technical Manager" }, input: decisionInput() });
    const response = await post(DB, `/api/projects/${PROJECT}/fire-alarm/ecosystem/classify`, {
      candidate: { manufacturer: "NOTIFIER", ecosystem: "NOTIFIER", category: "Control Equipment", productFamily: "Fire Alarm Control Panel", interfaceMethod: "DIRECT_ADDRESSABLE" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.verdict.eligibility, ECOSYSTEM_ELIGIBILITY.ADDRESSABLE_WITHIN_ECO_SYSTEM);
    assert.equal(body.productCompatibilityClaimed, false);
    assert.equal(body.compatibilityTargetSatisfiedByThis, false);
  });

  await t.test("classify with NO decision fails closed for every candidate", async () => {
    const { DB } = buildDatabase();
    const response = await post(DB, `/api/projects/${PROJECT}/fire-alarm/ecosystem/classify`, {
      candidate: { manufacturer: "NOTIFIER", ecosystem: "NOTIFIER", category: "Control Equipment", productFamily: "Fire Alarm Control Panel", interfaceMethod: "DIRECT_ADDRESSABLE" },
    });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.verdict.eligibility, ECOSYSTEM_ELIGIBILITY.NO_GOVERNED_DECISION);
    assert.equal(body.verdict.blocking, true, "no decision must block, not silently pass");
  });

  await t.test("classify is read-only: it records nothing", async () => {
    const { DB } = buildDatabase();
    await recordFireAlarmEcosystemDecision(DB, { projectId: PROJECT, actor: { id: OWNER, role: "Technical Manager" }, input: decisionInput() });
    const before = await decisionCount(DB);
    await post(DB, `/api/projects/${PROJECT}/fire-alarm/ecosystem/classify`, {
      candidate: { manufacturer: "NOTIFIER", category: "Control Equipment", interfaceMethod: "DRY_CONTACT", supervisionProven: true },
    });
    assert.equal(await decisionCount(DB), before, "classification must never write a decision");
  });

  await t.test("a non-Fire-Alarm project is refused", async () => {
    const { raw, DB } = buildDatabase();
    raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
      .run("project-cctv", "CCTV Project", OWNER, "org1", "CCTV", "Active");
    const response = await call(DB, "/api/projects/project-cctv/fire-alarm/ecosystem");
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, "ECOSYSTEM_DECISION_SYSTEM_SCOPE");
  });

  await t.test("another user's project is a 404, not a data leak", async () => {
    const { raw, DB } = buildDatabase();
    raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id,system_domain,initial_status) VALUES (?,?,?,?,?,?)")
      .run("project-other-owner", "Someone Else's Project", "a-different-user", "org1", "Fire Alarm", "Active");
    const response = await call(DB, "/api/projects/project-other-owner/fire-alarm/ecosystem");
    assert.equal(response.status, 404, "a project the caller does not own must be indistinguishable from absent");
    assert.equal((await response.json()).error.code, "PROJECT_NOT_FOUND");
  });

  await t.test("an unrouted path is ignored entirely", async () => {
    const { DB } = buildDatabase();
    const response = await handleFireAlarmEcosystemDecisionApi(
      new Request("https://app.test/api/projects/anything-else"),
      env(DB),
    );
    assert.equal(response, null, "the handler must not claim paths it does not serve");
  });
});

// Count decisions straight from the D1 shim (async, bound). Awaited at every
// call site -- a bare call would hand back a Promise and compare as "<pending>".
const decisionCount = async (DB) =>
  (await DB.prepare("SELECT COUNT(*) AS n FROM engineering_knowledge_decisions WHERE project_id=?").bind(PROJECT).first()).n;
