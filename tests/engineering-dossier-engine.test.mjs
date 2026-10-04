import test from "node:test";
import assert from "node:assert/strict";
import {
  DOSSIER_REQUIREMENT_TYPES,
  DOSSIER_STATUSES,
  DOSSIER_TYPE_LABELS,
  isDossierStatus,
  dossierTypeForLegacyClass,
  dossierTemplateFor,
  evaluateDossier,
  authorityCheckForDossierEvidence,
  evidenceFromCalculation,
  buildLiveDossierEvidence,
  evaluateLiveSystemEngineering,
  evaluateProjectLevelEngineering,
  evaluateTechnicalReadiness,
  DOSSIER_ENGINE_VERSION,
} from "../app/domain/engineering-dossier-engine.mjs";

// ---------------------------------------------------------------------------
// 4C-1 -- canonical types, statuses, and the r1-r6 normalization.
// ---------------------------------------------------------------------------
test("the six dossier requirement types are canonical and the legacy classes normalize to them", () => {
  assert.deepEqual(DOSSIER_REQUIREMENT_TYPES, ["SYSTEM_ARCHITECTURE", "AUTHORITY_APPROVAL", "CODE_STANDARD_BASIS", "CAPACITY_CALCULATION", "ENGINEERING_CALCULATION", "TECHNICAL_WARRANTY_OR_SUPPORT"]);
  for (const type of DOSSIER_REQUIREMENT_TYPES) assert.ok(DOSSIER_TYPE_LABELS[type]);
  assert.equal(dossierTypeForLegacyClass("System architecture"), "SYSTEM_ARCHITECTURE");
  assert.equal(dossierTypeForLegacyClass("Authority approval"), "AUTHORITY_APPROVAL");
  assert.equal(dossierTypeForLegacyClass("Codes and standards"), "CODE_STANDARD_BASIS");
  assert.equal(dossierTypeForLegacyClass("Capacity calculation"), "CAPACITY_CALCULATION");
  assert.equal(dossierTypeForLegacyClass("Engineering calculation"), "ENGINEERING_CALCULATION");
  assert.equal(dossierTypeForLegacyClass("Technical warranty"), "TECHNICAL_WARRANTY_OR_SUPPORT");
  assert.equal(dossierTypeForLegacyClass("Unclassified requirement"), null);
  assert.equal(DOSSIER_ENGINE_VERSION, "engineering-dossier-engine-1.0.0");
});

test("the eight dossier statuses are canonical and validated", () => {
  assert.deepEqual(DOSSIER_STATUSES, ["NOT_REQUIRED", "MISSING", "PRESENT_UNVERIFIED", "VERIFIED", "CONFLICTING", "STALE", "BLOCKING", "WARNING"]);
  for (const status of DOSSIER_STATUSES) assert.equal(isDossierStatus(status), true);
  assert.equal(isDossierStatus("GUESSED"), false);
});

// ---------------------------------------------------------------------------
// 4C-2 -- per-system templates: governed packs require the right basis;
// unknown systems and unrelated packs are never blocked by Fire Alarm items.
// ---------------------------------------------------------------------------
test("Fire Alarm requires architecture, code basis and capacity/engineering calculations; authority approval is conditioned on jurisdiction", () => {
  const template = dossierTemplateFor("Fire Alarm");
  const types = template.map((row) => row.type);
  assert.deepEqual(types, ["SYSTEM_ARCHITECTURE", "AUTHORITY_APPROVAL", "CODE_STANDARD_BASIS", "CAPACITY_CALCULATION", "ENGINEERING_CALCULATION", "TECHNICAL_WARRANTY_OR_SUPPORT"]);
  const authorityRow = template.find((row) => row.type === "AUTHORITY_APPROVAL");
  assert.equal(typeof authorityRow.required, "function", "authority approval applies only when the jurisdiction demands it");
  assert.equal(authorityRow.required({}), false);
  assert.equal(authorityRow.required({ jurisdiction: { regulatoryApproval: "Civil Defense" } }), true);
  assert.equal(authorityRow.required({ requiresAuthorityApproval: true }), true);
});

test("CCTV and UPS do not inherit Fire Alarm-specific dossier requirements", () => {
  const cctv = dossierTemplateFor("CCTV").map((row) => row.type);
  const ups = dossierTemplateFor("UPS").map((row) => row.type);
  assert.ok(!cctv.includes("AUTHORITY_APPROVAL"));
  assert.ok(!cctv.includes("CODE_STANDARD_BASIS"));
  assert.ok(cctv.includes("CAPACITY_CALCULATION"));
  assert.ok(!ups.includes("AUTHORITY_APPROVAL"));
  assert.ok(ups.includes("ENGINEERING_CALCULATION"));
  assert.deepEqual(dossierTemplateFor("Plumbing"), []);
});

// ---------------------------------------------------------------------------
// evaluateDossier state transitions.
// ---------------------------------------------------------------------------
test("a Fire Alarm dossier with no evidence is BLOCKED by its critical missing items; authority approval not required here", () => {
  const dossier = evaluateDossier({ system: "Fire Alarm" });
  assert.equal(dossier.status, "BLOCKED");
  assert.ok(dossier.blockers.some((line) => line.includes("System architecture: MISSING")));
  assert.ok(dossier.blockers.some((line) => line.includes("Codes and standards basis: MISSING")));
  assert.ok(dossier.blockers.some((line) => line.includes("Capacity calculation: MISSING")));
  const authority = dossier.items.find((entry) => entry.type === "AUTHORITY_APPROVAL");
  assert.equal(authority.status, "NOT_REQUIRED");
  assert.equal(authority.blocking, false);
  assert.ok(dossier.technicalReviewRequired.length >= 4, "critical gaps route to technical review");
});

test("when the jurisdiction requires Civil Defense approval, a missing authority approval blocks too", () => {
  const dossier = evaluateDossier({ system: "Fire Alarm", context: { jurisdiction: { regulatoryApproval: "Civil Defense" } } });
  const authority = dossier.items.find((entry) => entry.type === "AUTHORITY_APPROVAL");
  assert.equal(authority.status, "MISSING");
  assert.equal(authority.blocking, true);
  assert.ok(dossier.blockers.some((line) => line.includes("Authority approval: MISSING")));
});

test("a complete, verified dossier resolves to READY with deterministic verification -- no manual checkbox needed", () => {
  const verified = (authorityClass) => [{ state: "verified", reviewStatus: "Verified", authorityClass, evidenceKind: "EXPLICIT", claim: "governed evidence presented" }];
  const dossier = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: {
      SYSTEM_ARCHITECTURE: verified("ENGINEERING_DESIGN"),
      CODE_STANDARD_BASIS: verified("REGULATORY"),
      CAPACITY_CALCULATION: verified("ENGINEERING_DESIGN"),
      ENGINEERING_CALCULATION: verified("ENGINEERING_DESIGN"),
      TECHNICAL_WARRANTY_OR_SUPPORT: verified("COMMERCIAL"),
    },
  });
  assert.equal(dossier.status, "READY");
  assert.equal(dossier.blockers.length, 0);
  assert.equal(dossier.deterministicVerification, true, "a routine complete dossier needs no engineer checkbox");
  assert.equal(dossier.technicalReviewRequired.length, 0);
});

test("PRESENT_UNVERIFIED evidence warns and needs review but does not alone block", () => {
  const dossier = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: {
      SYSTEM_ARCHITECTURE: [{ state: "unverified", reviewStatus: "Unverified", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "EXPLICIT" }],
      CODE_STANDARD_BASIS: [{ state: "verified", reviewStatus: "Verified", authorityClass: "REGULATORY", evidenceKind: "EXPLICIT" }],
      CAPACITY_CALCULATION: [{ state: "verified", reviewStatus: "Verified", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "DERIVED" }],
      ENGINEERING_CALCULATION: [{ state: "verified", reviewStatus: "Verified", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "DERIVED" }],
    },
  });
  assert.equal(dossier.status, "READY_WITH_WARNINGS");
  const architecture = dossier.items.find((entry) => entry.type === "SYSTEM_ARCHITECTURE");
  assert.equal(architecture.status, "PRESENT_UNVERIFIED");
  assert.equal(architecture.reviewRequired, true);
  assert.equal(dossier.deterministicVerification, false);
});

test("CONFLICTING evidence blocks the dossier", () => {
  const dossier = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: {
      SYSTEM_ARCHITECTURE: [{ state: "conflict", reviewStatus: "Conflict", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "EXPLICIT" }],
    },
  });
  const architecture = dossier.items.find((entry) => entry.type === "SYSTEM_ARCHITECTURE");
  assert.equal(architecture.status, "CONFLICTING");
  assert.equal(architecture.blocking, true);
  assert.equal(dossier.status, "BLOCKED");
});

test("stale critical evidence blocks the dossier until re-verified", () => {
  const dossier = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: {
      SYSTEM_ARCHITECTURE: [{ stale: true, state: "unverified", reviewStatus: "Stale", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "EXPLICIT" }],
    },
  });
  const architecture = dossier.items.find((entry) => entry.type === "SYSTEM_ARCHITECTURE");
  assert.equal(architecture.status, "STALE");
  assert.equal(architecture.blocking, true);
  assert.equal(dossier.status, "BLOCKED");
});

test("an ungoverned system resolves to READY with every dossier item NOT_REQUIRED -- nothing blocks on inapplicable items", () => {
  const dossier = evaluateDossier({ system: "Plumbing" });
  assert.equal(dossier.status, "READY");
  assert.equal(dossier.blockers.length, 0);
  assert.ok(dossier.items.every((entry) => entry.status === "NOT_REQUIRED"));
});

// ---------------------------------------------------------------------------
// 4C-4 -- evidence must bind to a governed authority class.
// ---------------------------------------------------------------------------
test("dossier evidence without a governed authority class or with inferred kind is unacceptable", () => {
  const noAuthority = authorityCheckForDossierEvidence({ evidenceKind: "EXPLICIT" });
  assert.equal(noAuthority.acceptable, false);
  assert.match(noAuthority.reason, /authority class/i);
  const inferred = authorityCheckForDossierEvidence({ authorityClass: "AI_INFERENCE", evidenceKind: "INFERRED" });
  assert.equal(inferred.acceptable, false);
  const unknownKind = authorityCheckForDossierEvidence({ authorityClass: "REGULATORY", evidenceKind: "GUESSED" });
  assert.equal(unknownKind.acceptable, false);
});

test("commercial evidence is acceptable only as warranty corroboration and never verifies a technical item", () => {
  const warranty = authorityCheckForDossierEvidence({ authorityClass: "COMMERCIAL", evidenceKind: "EXPLICIT" });
  assert.equal(warranty.acceptable, true);
  assert.equal(warranty.commercial, true);
  const regulatory = authorityCheckForDossierEvidence({ authorityClass: "REGULATORY", evidenceKind: "EXPLICIT" });
  assert.equal(regulatory.acceptable, true);
  // Enforced at the dossier layer: commercial evidence on a technical item
  // forces PRESENT_UNVERIFIED, never VERIFIED.
  const dossier = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: {
      SYSTEM_ARCHITECTURE: [{ state: "verified", reviewStatus: "Verified", authorityClass: "COMMERCIAL", evidenceKind: "EXPLICIT", claim: "vendor brochure" }],
      CODE_STANDARD_BASIS: [{ state: "verified", reviewStatus: "Verified", authorityClass: "REGULATORY", evidenceKind: "EXPLICIT" }],
      CAPACITY_CALCULATION: [{ state: "verified", reviewStatus: "Verified", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "DERIVED" }],
      ENGINEERING_CALCULATION: [{ state: "verified", reviewStatus: "Verified", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "DERIVED" }],
    },
  });
  const architecture = dossier.items.find((entry) => entry.type === "SYSTEM_ARCHITECTURE");
  assert.equal(architecture.status, "PRESENT_UNVERIFIED");
  assert.equal(dossier.status, "READY_WITH_WARNINGS");
});

// ---------------------------------------------------------------------------
// 4C -- evidence from Stage 4B calculations.
// ---------------------------------------------------------------------------
test("a calculated PASS certifies its dossier item as VERIFIED DERIVED engineering evidence", () => {
  const calculation = {
    calculationType: "slc.loop-and-expansion",
    state: "CALCULATED_PASS",
    result: "PASS",
    performedAt: "2026-09-19T00:00:00.000Z",
    evidence: { ruleId: "slc.loop-and-expansion", ruleVersion: "slc.loop-and-expansion-1.0.0" },
    trace: ["SLC demand fits native capacity."],
  };
  const entry = evidenceFromCalculation(calculation);
  assert.equal(entry.dossierType, "ENGINEERING_CALCULATION");
  assert.equal(entry.authorityClass, "ENGINEERING_DESIGN");
  assert.equal(entry.evidenceKind, "DERIVED");
  assert.equal(entry.state, "verified");
  const dossier = evaluateDossier({ system: "Fire Alarm", dossierEvidence: { ENGINEERING_CALCULATION: [entry] } });
  assert.equal(dossier.items.find((item) => item.type === "ENGINEERING_CALCULATION").status, "VERIFIED");
});

test("a calculated FAIL or capacity conflict is a dossier conflict (blocking), and a refused calculation is MISSING evidence", () => {
  const failEntry = evidenceFromCalculation({ calculationType: "slc.loop-and-expansion", state: "CALCULATED_FAIL", result: "FAIL", trace: ["demand exceeds ceiling"] });
  assert.equal(failEntry.state, "conflict");
  const missingEntry = evidenceFromCalculation({ calculationType: "battery.standby-alarm", state: "REQUIRED_BUT_INPUTS_MISSING", missingInputs: ["standbyCurrent"], trace: [] });
  assert.equal(missingEntry.state, "missing");
  assert.equal(missingEntry.reviewStatus, "Missing");
  const zero = evidenceFromCalculation({ calculationType: "slc.loop-and-expansion", state: "NOT_REQUIRED" });
  assert.equal(zero, null, "a not-required calculation certifies nothing");
});

// ---------------------------------------------------------------------------
// R1 -- Fire Alarm dossier readiness: capacity evidence + architecture
// evidence contracts. One governed calculation legitimately serves the
// requirement roles it actually proves; one approved architecture version
// legitimately evidences system architecture. Nothing else may.
// ---------------------------------------------------------------------------

// A capacity-dimension calculation result exactly as the live 4D-1 engine emits
// it (calculation-requirement-engine.mjs evaluateCandidateEngineeringCalculations).
const capacityCalculation = (overrides = {}) => ({
  calculationType: "slc.loop-and-expansion",
  ruleId: "slc.loop-and-expansion",
  ruleVersion: "slc.loop-and-expansion-1.0.0",
  dimension: "capacity",
  state: "CALCULATED_PASS",
  result: "PASS",
  blocking: false,
  performedAt: "2026-09-24T00:00:00.000Z",
  evidence: { ruleId: "slc.loop-and-expansion", ruleVersion: "slc.loop-and-expansion-1.0.0" },
  inputFingerprint: { candidateSpecific: "fp-slc-1", requirementProfileVersion: 11, productEvidenceVersion: 7, itemBasis: "boq-1" },
  trace: ["SLC demand fits native capacity."],
  ...overrides,
});

// A governed, approved, consumable Stage 4 drawing-architecture context.
const archRow = (id, subject) => ({
  id,
  reviewCaseId: `case-${id}`,
  factType: "system-architecture",
  subject,
  relation: "contains",
  object: "FACP",
  evidenceKind: "EXPLICIT",
  // NOTE: the bridge uses PRIMARY/SECONDARY drawing roles, which are NOT
  // Stage 4A authority classes and must never be promoted.
  authorityClass: "PRIMARY",
  productCompatibility: false,
  protocol: false,
  matchingRole: "project-architecture-context",
  architectureVersion: 3,
  provenance: { documentId: "doc-1", reviewActorId: "reviewer-1", reviewReason: "verified against panel schedule", evidenceFingerprint: `fp-${id}` },
});

const approvedArchitectureContext = () => ({
  version: "stage4-drawing-architecture-context-1.0.0",
  available: true,
  reason: null,
  architectureVersion: 3,
  status: "READY_FOR_STAGE4_BRIDGE",
  readiness: { stage4Readiness: "READY_FOR_STAGE4_BRIDGE" },
  channels: {
    PANEL_INVENTORY: { count: 1, evidence: [archRow("a1", "FACP-1")] },
    CIRCUIT_BUS: { count: 1, evidence: [archRow("a2", "CIRCUIT-7")] },
  },
  evidenceCount: 2,
  adjudications: [],
  unresolved: [],
  fingerprint: "arch-fp-3",
  provenance: { bridgeSemanticVersion: "drawing-architecture-bridge-1.0.0", readFromVersionId: "dav_1", approvedFactCount: 2, nonBridgedFactTypes: [] },
});

const unavailableArchitectureContext = (reason = "NO_CURRENT_ARCHITECTURE_VERSION") => ({
  version: "stage4-drawing-architecture-context-1.0.0",
  available: false,
  reason,
  architectureVersion: null,
  status: null,
  readiness: null,
  channels: {},
  evidenceCount: 0,
  adjudications: [],
  unresolved: [],
  fingerprint: null,
  provenance: null,
});

const faProfile = (extra = {}) => ({
  versionNumber: 11,
  boqItem: { id: "boq-1", description: "Fire alarm control panel", system: "Fire Alarm", category: "Equipment", productFamily: "Fire Alarm Control Panel", attributes: {} },
  readiness: { status: "Ready for Matching", blockingReasons: [] },
  consolidatedRequirements: [],
  standards: [{ body: "NFPA", number: "72", part: "2022" }],
  manufacturers: [],
  compatibility: [],
  accessories: [],
  ...extra,
});

const itemStatus = (evaluation, type) => evaluation.dossier.items.find((entry) => entry.type === type)?.status;

// CASE A -- a legitimate Fire Alarm SLC/loop capacity calculation satisfies the
// CAPACITY_CALCULATION requirement it actually proves.
test("R1 CASE A -- a valid Fire Alarm SLC capacity calculation satisfies CAPACITY_CALCULATION", () => {
  const evaluation = evaluateLiveSystemEngineering({
    profile: faProfile(),
    calculationResults: [capacityCalculation()],
  });
  assert.equal(itemStatus(evaluation, "CAPACITY_CALCULATION"), "VERIFIED");
  // One governed calculation serves both requirement roles it proves.
  assert.equal(itemStatus(evaluation, "ENGINEERING_CALCULATION"), "VERIFIED");
});

// CASE A (invariant 2) -- one calculation, two requirement roles, identical
// identity and provenance. Never two independent calculations.
test("R1 CASE A -- one capacity calculation projects to both roles with identical identity, not two calculations", () => {
  const evidence = buildLiveDossierEvidence({ profile: faProfile(), calculationResults: [capacityCalculation()] });
  const capacity = evidence.CAPACITY_CALCULATION || [];
  const engineering = evidence.ENGINEERING_CALCULATION || [];
  assert.equal(capacity.length, 1);
  assert.equal(engineering.length, 1);
  const identity = (entry) => [entry.calculationType, entry.ruleId, entry.ruleVersion, entry.fingerprint];
  assert.deepEqual(identity(capacity[0]), identity(engineering[0]));
  assert.deepEqual(identity(capacity[0]), ["slc.loop-and-expansion", "slc.loop-and-expansion", "slc.loop-and-expansion-1.0.0", "fp-slc-1"]);
  // The shared calculation is disclosed on the row so it can never be read as
  // an independent second authority.
  assert.deepEqual([...capacity[0].satisfiedDossierTypes].sort(), ["CAPACITY_CALCULATION", "ENGINEERING_CALCULATION"]);
  // Provenance and DERIVED standing survive the projection unchanged.
  for (const entry of [capacity[0], engineering[0]]) {
    assert.equal(entry.authorityClass, "ENGINEERING_DESIGN");
    assert.equal(entry.evidenceKind, "DERIVED");
    assert.equal(entry.provenance.requirementProfileVersion, 11);
    assert.equal(entry.provenance.productEvidenceVersion, 7);
  }
});

// CASE C -- without a valid capacity calculation the requirement stays MISSING.
test("R1 CASE C -- no valid capacity calculation leaves CAPACITY_CALCULATION MISSING", () => {
  const refused = evaluateLiveSystemEngineering({
    profile: faProfile(),
    calculationResults: [capacityCalculation({ state: "REQUIRED_BUT_INPUTS_MISSING", result: "UNKNOWN", evidence: null, missingInputs: ["demand.detectors"] })],
  });
  assert.equal(itemStatus(refused, "CAPACITY_CALCULATION"), "MISSING");
  assert.equal(itemStatus(refused, "ENGINEERING_CALCULATION"), "MISSING");
  const absent = evaluateLiveSystemEngineering({ profile: faProfile(), calculationResults: [] });
  assert.equal(itemStatus(absent, "CAPACITY_CALCULATION"), "MISSING");
  const notRequired = evaluateLiveSystemEngineering({ profile: faProfile(), calculationResults: [capacityCalculation({ state: "NOT_REQUIRED" })] });
  assert.equal(itemStatus(notRequired, "CAPACITY_CALCULATION"), "MISSING");
});

// CASE F -- an engineering calculation that does not represent capacity must not
// satisfy the capacity requirement merely by being an engineering calculation.
test("R1 CASE F -- a non-capacity engineering calculation cannot satisfy CAPACITY_CALCULATION", () => {
  const nonCapacity = capacityCalculation({
    calculationType: "design.voltage-drop",
    ruleId: "design.voltage-drop",
    ruleVersion: "design.voltage-drop-1.0.0",
    dimension: "engineering",
    evidence: { ruleId: "design.voltage-drop", ruleVersion: "design.voltage-drop-1.0.0" },
  });
  const evaluation = evaluateLiveSystemEngineering({ profile: faProfile(), calculationResults: [nonCapacity] });
  assert.equal(itemStatus(evaluation, "CAPACITY_CALCULATION"), "MISSING");
  assert.equal(itemStatus(evaluation, "ENGINEERING_CALCULATION"), "VERIFIED");
  // A calculation with no declared dimension is treated conservatively: it may
  // not claim capacity.
  const undimensioned = capacityCalculation({ calculationType: "legacy.check", ruleId: "legacy.check", dimension: null });
  const conservative = evaluateLiveSystemEngineering({ profile: faProfile(), calculationResults: [undimensioned] });
  assert.equal(itemStatus(conservative, "CAPACITY_CALCULATION"), "MISSING");
  assert.equal(itemStatus(conservative, "ENGINEERING_CALCULATION"), "VERIFIED");
});

// CASE B -- an approved, consumable architecture context satisfies
// SYSTEM_ARCHITECTURE, and a complete Fire Alarm dossier can then be truthful.
test("R1 CASE B -- approved architecture context satisfies SYSTEM_ARCHITECTURE", () => {
  const evaluation = evaluateLiveSystemEngineering({
    profile: faProfile({ drawingArchitectureContext: approvedArchitectureContext() }),
    calculationResults: [capacityCalculation()],
  });
  assert.equal(itemStatus(evaluation, "SYSTEM_ARCHITECTURE"), "VERIFIED");
  assert.equal(itemStatus(evaluation, "CODE_STANDARD_BASIS"), "VERIFIED");
  assert.equal(itemStatus(evaluation, "CAPACITY_CALCULATION"), "VERIFIED");
  assert.equal(evaluation.dossier.status, "READY");
  assert.deepEqual(evaluation.dossier.blockers, []);
  const item = evaluation.dossier.items.find((entry) => entry.type === "SYSTEM_ARCHITECTURE");
  assert.ok(item.evidenceCount >= 1, "architecture evidence is attached");
  for (const evidence of item.evidence) {
    assert.equal(evidence.authorityClass, "ENGINEERING_DESIGN", "architecture binds a real Stage 4A authority class");
    assert.equal(evidence.evidenceKind, "EXPLICIT", "approved architecture facts are governed explicit evidence");
    assert.equal(evidence.review, "Verified");
  }
});

// CASE D -- missing / unavailable / unapproved architecture stays MISSING.
test("R1 CASE D -- unavailable or non-consumable architecture cannot satisfy SYSTEM_ARCHITECTURE", () => {
  for (const context of [undefined, null, unavailableArchitectureContext(), unavailableArchitectureContext("READINESS_NOT_CONSUMABLE:STAGE4_READINESS_UNRECORDED")]) {
    const evaluation = evaluateLiveSystemEngineering({
      profile: faProfile(context === undefined ? {} : { drawingArchitectureContext: context }),
      calculationResults: [capacityCalculation()],
    });
    assert.equal(itemStatus(evaluation, "SYSTEM_ARCHITECTURE"), "MISSING");
    assert.equal(evaluation.dossier.status, "BLOCKED");
  }
  // An "available" context that carries no bridged fact certifies nothing.
  const emptyButAvailable = { ...approvedArchitectureContext(), evidenceCount: 0, channels: {} };
  const empty = evaluateLiveSystemEngineering({ profile: faProfile({ drawingArchitectureContext: emptyButAvailable }), calculationResults: [capacityCalculation()] });
  assert.equal(itemStatus(empty, "SYSTEM_ARCHITECTURE"), "MISSING");
});

// CASE E -- compatibility evidence must never masquerade as architecture.
test("R1 CASE E -- compatibility evidence cannot satisfy SYSTEM_ARCHITECTURE", () => {
  const evaluation = evaluateLiveSystemEngineering({
    profile: faProfile({ compatibility: [{ type: "protocol", value: "HoneywellNet", status: "Approved" }] }),
    calculationResults: [capacityCalculation()],
  });
  assert.equal(itemStatus(evaluation, "SYSTEM_ARCHITECTURE"), "MISSING");
});

// Invariant 6 -- architecture stays architecture: it is never flattened into
// compatibility, certification, capacity, product or commercial evidence.
test("R1 -- architecture evidence stays architecture and never becomes compatibility", () => {
  const evidence = buildLiveDossierEvidence({ profile: faProfile({ drawingArchitectureContext: approvedArchitectureContext() }), calculationResults: [] });
  const architecture = evidence.SYSTEM_ARCHITECTURE || [];
  assert.ok(architecture.length >= 1, "architecture evidence exists");
  // It only ever appears under SYSTEM_ARCHITECTURE.
  for (const type of ["CAPACITY_CALCULATION", "ENGINEERING_CALCULATION", "CODE_STANDARD_BASIS", "TECHNICAL_WARRANTY_OR_SUPPORT", "AUTHORITY_APPROVAL"]) {
    const rows = evidence[type] || [];
    for (const row of rows) {
      assert.ok(!(row.architectureVersion !== undefined), `architecture never lands under ${type}`);
    }
  }
  for (const entry of architecture) {
    assert.equal(entry.architectureEvidence, true);
    assert.equal(entry.productCompatibility, false, "architecture is never product compatibility");
    assert.equal(entry.protocol, false, "architecture is never a protocol claim");
    assert.equal(entry.authorityClass, "ENGINEERING_DESIGN");
    // The bridge's own drawing role is preserved as provenance, never promoted.
    assert.ok(["PRIMARY", "SECONDARY", null].includes(entry.architectureSourceRole));
    assert.equal(entry.authorityClass === entry.architectureSourceRole, false, "drawing role is not a Stage 4A authority class");
    assert.ok(entry.architectureVersion, "architecture version is traceable");
    assert.ok(entry.fingerprint, "architecture fingerprint is traceable");
  }
  // Traceability back to the governed approval.
  const panel = architecture.find((entry) => entry.claim.includes("PANEL_INVENTORY"));
  assert.ok(panel, "channel claim is descriptive");
  assert.equal(panel.provenance.reviewActorId, "reviewer-1");
  assert.equal(panel.provenance.reviewReason, "verified against panel schedule");
});

// ---------------------------------------------------------------------------
// 4C-6 -- project-level engineering checks.
// ---------------------------------------------------------------------------
test("project-level checks flag single-manufacturer, approved-list and common-protocol violations", () => {
  const items = [
    { itemId: "it-1", recommendedProduct: { manufacturer: "Honeywell", protocol: "HoneywellNet" } },
    { itemId: "it-2", recommendedProduct: { manufacturer: "Siemens", protocol: "SiemensOpen" } },
  ];
  const single = evaluateProjectLevelEngineering({ items, projectConstraints: { singleManufacturer: true } });
  const manufacturerViolation = single.violations.find((entry) => entry.type === "MANUFACTURER_CONSISTENCY");
  assert.ok(manufacturerViolation);
  assert.ok(manufacturerViolation.reason.includes("mandates a single manufacturer"));
  const approved = evaluateProjectLevelEngineering({ items, projectConstraints: { approvedManufacturers: ["Honeywell"] } });
  assert.ok(approved.violations.some((entry) => entry.type === "APPROVED_MANUFACTURER_VIOLATION" && entry.severity === "BLOCKING"));
  const protocol = evaluateProjectLevelEngineering({ items, projectConstraints: { commonProtocol: "HoneywellNet" } });
  const protocolViolation = protocol.violations.find((entry) => entry.type === "COMMON_PROTOCOL_VIOLATION");
  assert.equal(protocolViolation.severity, "BLOCKING");
  assert.deepEqual(protocolViolation.itemsAffected, ["it-2"]);
});

test("project-level panel capacity reuses the verified SLC calculator: exceeded ceils block, expansion warns, missing evidence warns", () => {
  const basePanel = { panelCapacity: { nativeLoops: 1, detectorsPerLoop: 189, modulesPerLoop: 189, systemPointCeiling: 500 } };
  const exceeded = evaluateProjectLevelEngineering({
    items: [],
    projectConstraints: { panelCapacityByPanel: { "panel-1": { ...basePanel, demand: { detectors: 600, modules: 100 }, expansionOptions: null } } },
  });
  const exceededViolation = exceeded.violations.find((entry) => entry.type === "TOTAL_PANEL_CAPACITY");
  assert.equal(exceededViolation.severity, "BLOCKING");
  assert.equal(exceededViolation.scope, "PROJECT");
  const needsExpansion = evaluateProjectLevelEngineering({
    items: [],
    projectConstraints: { panelCapacityByPanel: { "panel-1": { ...basePanel, demand: { detectors: 400, modules: 100 }, expansionOptions: { loopExpansionUnit: { partNumber: "6815", loopsAddedPerUnit: 2 } } } } },
  });
  const expansionViolation = needsExpansion.violations.find((entry) => entry.type === "TOTAL_PANEL_CAPACITY");
  assert.equal(expansionViolation.severity, "WARNING");
  assert.match(expansionViolation.reason, /expansion/i);
  const noEvidence = evaluateProjectLevelEngineering({
    items: [],
    projectConstraints: { panelCapacityByPanel: { "panel-1": { demand: { detectors: 10, modules: 5 } } } },
  });
  assert.ok(noEvidence.violations.some((entry) => entry.type === "PANEL_CAPACITY_EVIDENCE" && entry.severity === "WARNING"));
});

// ---------------------------------------------------------------------------
// 4C-8 -- technical readiness input.
// ---------------------------------------------------------------------------
test("technical readiness resolves deterministically: only genuine blockers block, warnings never auto-approve", () => {
  const dossier = evaluateDossier({
    system: "Fire Alarm",
    dossierEvidence: {
      SYSTEM_ARCHITECTURE: [{ state: "verified", reviewStatus: "Verified", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "EXPLICIT" }],
      CODE_STANDARD_BASIS: [{ state: "verified", reviewStatus: "Verified", authorityClass: "REGULATORY", evidenceKind: "EXPLICIT" }],
      CAPACITY_CALCULATION: [{ state: "verified", reviewStatus: "Verified", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "DERIVED" }],
      ENGINEERING_CALCULATION: [{ state: "verified", reviewStatus: "Verified", authorityClass: "ENGINEERING_DESIGN", evidenceKind: "DERIVED" }],
    },
  });
  const ready = evaluateTechnicalReadiness({ system: "Fire Alarm", itemReadiness: { status: "Ready for Matching", blockingReasons: [] }, dossier });
  assert.equal(ready.status, "Technically Ready");
  assert.equal(ready.deterministicVerification, true);
  assert.equal(ready.engineerReviewRequired.length, 0);
  const blocked = evaluateTechnicalReadiness({ system: "Fire Alarm", itemReadiness: { status: "Blocked", blockingReasons: ["Mandatory standard not evidenced"] }, dossier });
  assert.equal(blocked.status, "Blocked");
  assert.ok(blocked.blockers.some((line) => line.includes("Mandatory standard not evidenced")));
  const projectBlocked = evaluateTechnicalReadiness({ system: "Fire Alarm", itemReadiness: { status: "Ready for Matching" }, dossier, projectViolations: [{ severity: "BLOCKING", reason: "Total addressable demand exceeds the verified system-wide ceiling." }] });
  assert.equal(projectBlocked.status, "Blocked");
  const warned = evaluateTechnicalReadiness({ system: "Fire Alarm", itemReadiness: { status: "Ready for Matching" }, dossier: { ...dossier, status: "READY_WITH_WARNINGS", warnings: ["System architecture: PRESENT_UNVERIFIED."], blockers: [], deterministicVerification: false, technicalReviewRequired: ["System architecture"] } });
  assert.equal(warned.status, "Ready with Warnings");
  assert.deepEqual(warned.engineerReviewRequired, ["System architecture"], "exceptions exist only for unverified-critical dossier items");
});