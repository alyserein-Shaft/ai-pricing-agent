// STAGE 4 DRAWING BRIDGE -- governed suite against the live-parity fixture
// corpus (same seeded Al Mousa evidence the Step 14.8 adjudication suite
// uses). The bridge is a READ-ONLY projection: it reuses the existing
// governed architecture records (0078 approved v2 + 0079 adjudications +
// readiness), never duplicates them, never writes, and never feeds the
// product-compatibility channel.
//
//   1  current approved v2 is consumable and reaches the Stage 4 project
//      context (panel architecture + full evidence + readiness)
//   2  superseded v1 is NEVER used as current evidence
//   3  provenance survives the bridge (drawing, sheet, source evidence,
//      architecture version, adjudication decision)
//   4  unresolved drawing evidence stays non-blocking
//      (UNKNOWN_PROJECT, never FAIL)
//   5  SLC evidence is CIRCUIT_BUS project architecture evidence -- not a
//      protocol, no FlashScan/CLIP compatibility invented
//   6  panel relationships are project architecture evidence -- not product
//      compatibility
//   7  Golden remains intact: the bridge emits no compatibility/protocol
//      surface the matching engine consumes; the golden 4W decision is
//      unchanged
//   8  repeated bridge evaluation is idempotent
//   9  the bridge performs no writes (no schema change, no second store)
import test from "node:test";
import assert from "node:assert/strict";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import {
  DRAWING_ARCHITECTURE_BRIDGE_SEMANTIC_VERSION,
  BRIDGE_NO_CURRENT_VERSION,
  UNRESOLVED_EVIDENCE_POLICY,
  bridgeSemanticsFor,
} from "../app/domain/drawing-architecture-bridge.mjs";
import {
  makeArchDb,
  seedArchDocument,
  seedRealT00Legend,
  seedRealSheet,
  apiArchRequest,
  archInitializePath,
  archConfirmPath,
  archAdjudicateApplyPath,
  archApprovedCurrentPath,
  archBridgePath,
} from "./fixtures/drawing-architecture-fixture.mjs";

// ---------------------------------------------------------------------------
// Harness: identical to the adjudication suite (live-parity corpus + routed
// handler calls).
// ---------------------------------------------------------------------------
const boot = (projectId = "proj-1") => {
  const { raw, db } = makeArchDb(projectId);
  const run = (path, { method = "POST", body } = {}) => apiArchRequest(path, { method, body })({ DB: db });
  return { raw, db, run };
};

const seedRealCorpus = ({ raw, projectId = "proj-1" }) => {
  seedArchDocument({
    raw, projectId, documentId: "doc-t00-real",
    drawingNumber: "2401232- PC- AMS- DR- T-00-ZZZ-002",
    sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS",
  });
  seedRealT00Legend({ raw, projectId, documentId: "doc-t00-real" });
  const keys = [
    ["AMS_NET", "doc-ams-net"], ["KGS_005", "doc-kgs-005"], ["AMS_002", "doc-ams-002"],
    ["SHEET_2401232_PC_WLC_DR_T_93_ZZZ_005", "doc-wlc-93"], ["SHEET_2401232_PC_GRS_DR_T_93_ZZZ_005", "doc-grs-93"], ["SHEET_2401232_PC_BOS_DR_T_93_ZZZ_005", "doc-bos-93"],
    ["SHEET_2401232_PC_BOS_DR_T_94_ZZZ_001", "doc-bos-94"], ["SHEET_2401232_PC_AMS_DR_T_94_ZZZ_001", "doc-ams-94"], ["SHEET_2401232_PC_GRS_DR_T_94_ZZZ_001", "doc-grs-94"],
    ["SHEET_2401232_PC_WLC_DR_T_94_ZZZ_001", "doc-wlc-94"], ["SHEET_2401232_PC_KGS_DR_T_91_ZZZ_002", "doc-kgs-91"],
  ];
  for (const [key, docId] of keys) seedRealSheet({ raw, projectId, sheetKey: key, documentId: docId, intakeId: `intake-${docId}` });
};

const bootSeeded = async (projectId = "proj-1") => {
  const h = boot(projectId);
  seedRealCorpus({ raw: h.raw, projectId });
  assert.equal((await h.run(archInitializePath(projectId))).status, 200);
  const confirm = await h.run(archConfirmPath(projectId));
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.promotion.approvedRows, 116, "v1 must promote exactly 116 governed rows");
  return h;
};

const bootstrapBridged = async (projectId = "proj-1") => {
  const h = await bootSeeded(projectId);
  const apply = await h.run(archAdjudicateApplyPath(projectId));
  assert.equal(apply.status, 200);
  return h;
};

const bridgeOf = async (run, projectId = "proj-1") => {
  const response = await run(archBridgePath(projectId), { method: "GET" });
  assert.equal(response.status, 200);
  return response.body.bridge;
};

// ---------------------------------------------------------------------------
// Governed taxonomy locks (fact types absent from the fixture corpus still
// carry the exact semantics; ARCHITECTURE_DISCREPANCY is NOT bridged).
// ---------------------------------------------------------------------------
test("0: the governed bridge taxonomy locks every architecture fact type's consumer channel; discrepancies are never bridged", () => {
  assert.equal(bridgeSemanticsFor("PANEL_EXISTS").downstreamConsumer, "PANEL_INVENTORY");
  assert.equal(bridgeSemanticsFor("PANEL_LABEL").downstreamConsumer, "PANEL_INVENTORY");
  assert.equal(bridgeSemanticsFor("SLC_LOOP_EXISTS").downstreamConsumer, "CIRCUIT_BUS");
  assert.equal(bridgeSemanticsFor("PANEL_LOOP_RELATION").downstreamConsumer, "CIRCUIT_BUS");
  assert.equal(bridgeSemanticsFor("SLC_LOOP_SERVES_AREA").downstreamConsumer, "CIRCUIT_BUS");
  assert.equal(bridgeSemanticsFor("SLC_DEVICE_BRANCH").downstreamConsumer, "CIRCUIT_BUS");
  assert.equal(bridgeSemanticsFor("NAC_CIRCUIT_EXISTS").downstreamConsumer, "NAC_CIRCUIT");
  assert.equal(bridgeSemanticsFor("PANEL_SERVES_AREA").downstreamConsumer, "AREA_COVERAGE");
  assert.equal(bridgeSemanticsFor("PANEL_NETWORK_LINK").downstreamConsumer, "PANEL_NETWORK");
  assert.equal(bridgeSemanticsFor("FIRE_ALARM_NETWORK_TOPOLOGY").downstreamConsumer, "PANEL_NETWORK");
  assert.equal(bridgeSemanticsFor("INTERFACE_CONNECTED_TO_SYSTEM").downstreamConsumer, "SYSTEM_INTERFACE");
  assert.equal(bridgeSemanticsFor("EXTERNAL_SYSTEM_INTERFACE").downstreamConsumer, "SYSTEM_INTERFACE");
  assert.equal(bridgeSemanticsFor("LAYOUT_LEGEND_LINK").downstreamConsumer, "LEGEND_LINKAGE");
  assert.equal(bridgeSemanticsFor("CROSS_SHEET_REFERENCE").downstreamConsumer, "CROSS_SHEET_RESOLUTION");
  const bridgedTypes = [
    "PANEL_EXISTS", "PANEL_LABEL", "SLC_LOOP_EXISTS", "PANEL_LOOP_RELATION",
    "SLC_LOOP_SERVES_AREA", "SLC_DEVICE_BRANCH", "NAC_CIRCUIT_EXISTS",
    "PANEL_SERVES_AREA", "PANEL_NETWORK_LINK", "FIRE_ALARM_NETWORK_TOPOLOGY",
    "INTERFACE_CONNECTED_TO_SYSTEM", "EXTERNAL_SYSTEM_INTERFACE",
    "LAYOUT_LEGEND_LINK", "CROSS_SHEET_REFERENCE",
  ];
  for (const factType of bridgedTypes) assert.ok(bridgeSemanticsFor(factType), `${factType} must be bridged`);
  assert.equal(bridgeSemanticsFor("ARCHITECTURE_DISCREPANCY"), null, "discrepancies are review artifacts -- never bridged as evidence");
  assert.equal(bridgeSemanticsFor("SLC_LOOP_EXISTS").protocol, false);
  assert.equal(bridgeSemanticsFor("SLC_LOOP_EXISTS").productCompatibility, false);
  assert.equal(bridgeSemanticsFor("PANEL_NETWORK_LINK").productCompatibility, false);
  assert.equal(bridgeSemanticsFor("PANEL_NETWORK_LINK").protocol, false);
});

// ---------------------------------------------------------------------------
// 1 -- current approved v2 is consumable and reaches the Stage 4 project
//      context.
// ---------------------------------------------------------------------------
test("1: the bridge projects the CURRENT approved v2 (128 rows) onto the Stage 4 project context with the governed readiness", async () => {
  const { run } = await bootstrapBridged();
  const bridge = await bridgeOf(run);

  assert.equal(bridge.current, true);
  assert.equal(bridge.architectureVersion, 2, "only the current architecture version participates");
  assert.equal(bridge.approvedFactCount, 128);
  assert.equal(bridge.evidence.length, 128, "every approved v2 fact has a governed consumer channel");
  assert.equal(bridge.status, "READY_FOR_STAGE4_BRIDGE");
  assert.equal(bridge.readiness.architectureStatus, "COMPLETE");
  assert.equal(bridge.readiness.approvedNextVersionNumber, 2);
  assert.equal(bridge.semanticVersion, DRAWING_ARCHITECTURE_BRIDGE_SEMANTIC_VERSION);
  assert.ok(bridge.fingerprint, "bridge carries a deterministic fingerprint");

  // Governed panel architecture REACHES the Stage 4 project context.
  const panelInventory = bridge.evidence.filter((entry) => entry.downstreamConsumer === "PANEL_INVENTORY");
  assert.ok(panelInventory.length >= 13, "panel identity context is present in the project context");
  const facpCanonical = panelInventory
    .filter((entry) => entry.subject === "FACP" && entry.adjudication?.canonicalPanelIdentity)
    .map((entry) => entry.adjudication.canonicalPanelIdentity)
    .sort();
  assert.deepEqual(facpCanonical, ["FACP @BOS BUILDING", "FACP @GRS BUILDING", "FACP @WLC BUILDING"], "adjudicated generic FACP identities reach Stage 4");

  // Every bridged entry declares exactly one governed consumer channel and
  // carries project-architecture status (never a product/protocol role).
  const channels = new Set(bridge.evidence.map((entry) => entry.downstreamConsumer));
  for (const expected of ["PANEL_INVENTORY", "CIRCUIT_BUS", "PANEL_NETWORK", "SYSTEM_INTERFACE", "NAC_CIRCUIT", "AREA_COVERAGE", "LEGEND_LINKAGE", "CROSS_SHEET_RESOLUTION"]) {
    assert.ok(channels.has(expected), `channel ${expected} is present in the project context`);
  }
});

// ---------------------------------------------------------------------------
// 2 -- superseded v1 is never used as current evidence.
// ---------------------------------------------------------------------------
test("2: a superseded approved version is NOT current evidence; the bridge never projects it", async () => {
  // v1 promoted (Active at this point), then manually superseded with no v2:
  // the bridge must report NO current architecture rather than fabricate v1.
  const h = await bootSeeded();
  const before = (await h.run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(before.version, 1);
  h.raw.prepare("UPDATE drawing_architecture_approved_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?").run(before.approvedVersionId);

  const bridge = await bridgeOf(h.run);
  assert.equal(bridge.current, false);
  assert.equal(bridge.status, BRIDGE_NO_CURRENT_VERSION);
  assert.equal(bridge.architectureVersion, null);
  assert.deepEqual(bridge.evidence, [], "no superseded fact may be projected as evidence");

  // After the real promotion, v2 is current and every entry carries version 2.
  h.raw.prepare("UPDATE drawing_architecture_approved_versions SET superseded_at=NULL WHERE id=?").run(before.approvedVersionId);
  await h.run(archAdjudicateApplyPath("proj-1"));
  const after = await bridgeOf(h.run);
  assert.equal(after.architectureVersion, 2);
  assert.equal(after.evidence.length, 128);
  assert.ok(after.evidence.every((entry) => entry.architectureVersion === 2), "no entry may reference the superseded v1");
});

// ---------------------------------------------------------------------------
// 3 -- provenance survives the bridge.
// ---------------------------------------------------------------------------
test("3: provenance survives: drawing, sheet, source evidence, architecture version, and adjudication decision", async () => {
  const { run } = await bootstrapBridged();
  const bridge = await bridgeOf(run);

  for (const entry of bridge.evidence) {
    assert.equal(entry.architectureVersion, 2);
    assert.ok(entry.provenance.sourceDrawingNumber, `${entry.factType} ${entry.id}: drawing number survives`);
    assert.ok(Number.isInteger(entry.provenance.sourcePage), `${entry.id}: source page survives`);
    assert.ok(Array.isArray(entry.provenance.sourceFragmentIds), `${entry.id}: fragment provenance survives`);
    assert.ok(/^[0-9a-f]{64}$/.test(entry.provenance.evidenceFingerprint || ""), `${entry.id}: evidence fingerprint survives`);
    assert.ok(entry.provenance.reviewActorId, `${entry.id}: review actor survives`);
    assert.ok(entry.provenance.reviewReason, `${entry.id}: review reason survives`);
  }

  const refs = bridge.evidence.filter((entry) => entry.factType === "CROSS_SHEET_REFERENCE");
  assert.equal(refs.length, 9);
  assert.ok(refs.every((entry) => entry.adjudication?.decisionState === "CONFIRMED_PROJECT_REFERENCE"), "every cross-sheet reference carries its adjudication decision");
  assert.ok(refs.every((entry) => entry.adjudication?.canonicalTargetDrawingNumber === "2401232- PC- AMS- DR- T-00-ZZZ-002"), "DR-less citations resolve to the registered T-00 legend target");

  const facp = bridge.evidence.filter((entry) => entry.factType === "PANEL_EXISTS" && entry.adjudication?.canonicalPanelIdentity);
  assert.equal(facp.length, 3);
  assert.ok(facp.every((entry) => entry.adjudication.decisionState === "CONFIRMED_SAME_PANEL" && entry.adjudication.canonicalBuildingAssetCode), "FACP identity adjudications carry decision + building code");

  const states = {};
  for (const entry of bridge.adjudications) states[entry.decisionState] = (states[entry.decisionState] || 0) + 1;
  assert.deepEqual(states, { CONFIRMED_PROJECT_REFERENCE: 9, CONFIRMED_SAME_PANEL: 3 }, "the 12 governed adjudications ride the bridge");
});

// ---------------------------------------------------------------------------
// 4 -- unresolved drawing evidence stays non-blocking.
// ---------------------------------------------------------------------------
test("4: unresolved drawing evidence stays non-blocking UNKNOWN_PROJECT (never FAIL) and the bridge stays READY", async () => {
  const { run } = await bootstrapBridged();
  const bridge = await bridgeOf(run);

  assert.equal(bridge.unresolved.length, 9, "the 9 mirrored discrepancy review cases remain unresolved");
  assert.ok(bridge.unresolved.every((entry) => entry.factType === "ARCHITECTURE_DISCREPANCY"));
  assert.ok(bridge.unresolved.every((entry) => entry.policy === UNRESOLVED_EVIDENCE_POLICY), "unresolved evidence is UNKNOWN_PROJECT");
  assert.ok(bridge.unresolved.every((entry) => entry.blocking === false), "unresolved drawing evidence never blocks Stage 4");
  assert.ok(!bridge.evidence.some((entry) => entry.factType === "ARCHITECTURE_DISCREPANCY"), "discrepancies never enter the evidence projection");
  assert.ok(!bridge.unresolved.some((entry) => entry.factType !== "ARCHITECTURE_DISCREPANCY"), "no other fact type is left unresolved in the bridged corpus");
  assert.equal(bridge.status, "READY_FOR_STAGE4_BRIDGE", "UNKNOWN_PROJECT evidence does not disturb readiness");
});

// ---------------------------------------------------------------------------
// 5 -- SLC evidence is CIRCUIT_BUS project architecture evidence, not a
//      protocol; no FlashScan/CLIP compatibility is invented.
// ---------------------------------------------------------------------------
test("5: SLC evidence is CIRCUIT_BUS project architecture evidence -- never a protocol, no FlashScan/CLIP invented", async () => {
  const { run } = await bootstrapBridged();
  const bridge = await bridgeOf(run);

  const slc = bridge.evidence.filter((entry) => entry.downstreamConsumer === "CIRCUIT_BUS");
  assert.equal(slc.length, 24, "all SLC loop facts bridge to the circuit-bus channel");
  assert.ok(slc.every((entry) => entry.factType === "SLC_LOOP_EXISTS"));
  assert.ok(slc.every((entry) => entry.protocol === false), "SLC is architecture evidence, not a protocol claim");
  assert.ok(slc.every((entry) => entry.productCompatibility === false));
  assert.ok(slc.every((entry) => entry.matchingRole === "project-architecture-context"));

  const serialized = JSON.stringify(bridge);
  assert.ok(!/flashscan|clip/i.test(serialized), "no FlashScan/CLIP compatibility token may be invented by the bridge");
});

// ---------------------------------------------------------------------------
// 6 -- panel relationships are project architecture evidence, not product
//      compatibility.
// ---------------------------------------------------------------------------
test("6: panel relationships are project architecture evidence -- never product compatibility", async () => {
  const { run } = await bootstrapBridged();
  const bridge = await bridgeOf(run);

  const network = bridge.evidence.filter((entry) => entry.downstreamConsumer === "PANEL_NETWORK");
  assert.equal(network.length, 18, "17 panel network links + 1 topology fact bridge to the network channel");
  assert.ok(network.every((entry) => entry.productCompatibility === false));
  assert.ok(network.every((entry) => entry.protocol === false));

  assert.ok(bridge.evidence.every((entry) => entry.productCompatibility === false), "no bridged entry may be a product compatibility claim");
  assert.ok(bridge.evidence.every((entry) => entry.protocol === false), "no bridged entry may be a protocol claim");
  assert.ok(bridge.evidence.every((entry) => entry.matchingRole === "project-architecture-context"));
  // The bridge carries NO compatibility surface at all: the only "compatibility"
  // string is the boolean field name productCompatibility.
  const keys = new Set();
  for (const entry of bridge.evidence) for (const key of Object.keys(entry)) keys.add(key);
  assert.ok(!keys.has("compatibility"), "no compatibility array is produced");
  assert.ok(!keys.has("compatibilityTarget"), "no compatibility target is produced");
});

// ---------------------------------------------------------------------------
// 7 -- Golden remains intact: matching inputs are structurally unaffected,
//      and the Golden Heat Detector 4W decision is unchanged.
// ---------------------------------------------------------------------------
const goldenProfile = (overrides = {}) => ({
  versionNumber: 10,
  boqItem: { id: "boqitem_golden", itemNumber: "C", description: "Heat detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Heat Detector", attributes: {} },
  readiness: { status: "Ready with Warnings", blockingReasons: [] },
  consolidatedRequirements: [{
    id: "consolidated:Compliance|fixed temperature rate of rise heat detectors",
    governingSourceId: "specjob_golden_requirement_197",
    requirementType: "Mandatory",
    requirementCategory: "Compliance",
    priority: "Mandatory",
    applicability: { status: "Confirmed Applicable" },
    attributes: [
      { name: "addressing", operator: "Equal", normalizedValue: "Addressable", confidence: 95 },
      { name: "fixed_temperature_setpoint", operator: "Equal", normalizedValue: "135°F", confidence: 95 },
      { name: "rate_of_rise_sensitivity", operator: "Equal", normalizedValue: "15°F/min", confidence: 95 },
    ],
    standards: [], manufacturers: [], compatibility: [], accessories: [],
    confidence: 83,
  }],
  standards: [],
  manufacturers: [],
  compatibility: [{ requirementId: "specjob_golden_requirement_197", targetItem: "Flash Scan® and CLIP protocol systems", relationshipType: "Compatible With", confidence: 84 }],
  accessories: [],
  derivedRequirements: [],
  ...overrides,
});

const goldenProduct = (overrides = {}) => ({
  id: "p1", manufacturer: "Honeywell", family: "Heat Detector", partNumber: "IDP-HEAT-ROR-IV",
  description: "Addressable ROR heat detector", lifecycleStatus: "Active", reviewStatus: "Reviewed",
  attributes: [
    { name: "addressing", normalizedValue: "Addressable" },
    { name: "fixed_temperature_setpoint", normalizedValue: "135°F" },
    { name: "rate_of_rise_sensitivity", normalizedValue: "15°F/min" },
  ],
  standards: [],
  compatibility: [{ targetItem: "the control unit", relationshipType: "Compatible With" }],
  accessories: [],
  source: { sheet: "Catalogue", row: 1 },
  ...overrides,
});

test("7: Golden Heat Detector decision is unchanged and the bridge emits no compatibility surface the matching engine consumes", async () => {
  const { run } = await bootstrapBridged();
  const bridge = await bridgeOf(run);

  // Structural isolation: the matching engine only reads profile fields; the
  // bridge projection contains none of them (no compatibility, no attributes,
  // no consolidated requirements).
  const profileKeys = ["consolidatedRequirements", "compatibility", "accessories", "attributes", "standards", "manufacturers"];
  const bridgeKeys = new Set(Object.keys(bridge));
  assert.ok(!profileKeys.some((key) => bridgeKeys.has(key)), "the bridge never emits matching-engine surface");

  // Golden 4W decision re-run (identical inputs as the golden closure test):
  const { candidates } = runProductMatching({
    profile: goldenProfile(),
    products: [goldenProduct()],
    prices: [],
    projectId: "project-1",
  });
  const candidate = candidates[0];
  assert.ok(candidate.technicalStatus !== "Non-Compliant", "golden heat detector is not rejected -- decision unchanged");
  assert.ok(candidate.mandatoryFailures.length === 0, "no mandatory failure is introduced");
  const attr = candidate.comparisons.filter((entry) => entry.comparisonType === "Attribute");
  assert.ok(attr.every((entry) => entry.pass === true), "addressing / 135F / ROR still pass -- golden decision unchanged");
  const compat = candidate.comparisons.filter((entry) => entry.comparisonType === "Compatibility");
  assert.equal(compat.length, 1);
  assert.match(compat[0].requirement?.targetItem || "", /Flash Scan/, "FlashScan/CLIP compatibility comparison is preserved");
  // The golden matcher must NOT invent an SLC comparison: project SLC evidence
  // stays project architecture evidence and never becomes a matching input,
  // even though the bridge exposes 24 SLC circuit-bus entries.
  const slc = candidate.comparisons.filter((entry) => /two.?wire|slc/i.test(entry.required?.name || ""));
  assert.equal(slc.length, 0, "SLC project evidence does not leak into product matching");
  assert.equal(bridge.evidence.filter((entry) => entry.downstreamConsumer === "CIRCUIT_BUS").length, 24);
});

// ---------------------------------------------------------------------------
// 8 -- repeated bridge evaluation is idempotent.
// ---------------------------------------------------------------------------
test("8: repeated bridge evaluation is idempotent (identical projection + fingerprint), including after an idempotent re-apply", async () => {
  const h = await bootstrapBridged();
  const first = await bridgeOf(h.run);
  const second = await bridgeOf(h.run);

  assert.equal(second.fingerprint, first.fingerprint, "fingerprint is stable across repeated evaluation");
  assert.deepEqual(second, first, "projection is byte-identical across repeated evaluation");

  // Idempotent re-apply (Step 14.8 discipline: no new rows) then re-evaluate.
  const apply2 = await h.run(archAdjudicateApplyPath("proj-1"));
  assert.equal(apply2.status, 200);
  const third = await bridgeOf(h.run);
  assert.equal(third.fingerprint, first.fingerprint, "an idempotent re-apply leaves the bridge projection unchanged");
  assert.deepEqual(third.evidence, first.evidence);
});

// ---------------------------------------------------------------------------
// 9 -- the bridge performs no writes (no schema change, no second store).
// ---------------------------------------------------------------------------
test("9: the bridge is read-only -- zero writes, zero new tables, reuses the existing governed records", async () => {
  const h = await bootstrapBridged();
  const writesBefore = [...h.db.trackedWrites];
  const bridge = await bridgeOf(h.run);
  assert.deepEqual(h.db.trackedWrites, writesBefore, "GET bridge performs no writes");
  const tables = h.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'drawing_architecture%' ORDER BY name").all().map((row) => row.name);
  assert.deepEqual(tables, [
    "drawing_architecture_approved_audit_events",
    "drawing_architecture_approved_rows",
    "drawing_architecture_approved_versions",
    "drawing_architecture_exception_adjudications",
    "drawing_architecture_review_cases",
    "drawing_architecture_review_events",
    "drawing_architecture_stage4_readiness",
  ], "the bridge introduces no new tables");
  assert.equal(bridge.evidence.length, 128);
});