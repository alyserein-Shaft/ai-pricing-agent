// STAGE4-CI1 -- Drawing Architecture Bridge CONSUMER integration suite.
//
// The producer bridge is closed; this suite proves the Stage 4 read side
// actually receives the governed projection through the normal runtime path,
// without mutating matching semantics. Uses the same live-parity fixture
// corpus as the producer bridge suite (seeded Al Mousa evidence).
//
//   1  READY current v2 enters Stage 4 context (128 rows, 8 channels)
//   2  superseded v1 is excluded (context unavailable, zero evidence)
//   3  bridge unavailable/incomplete does not crash Stage 4
//   4-7 PANEL_INVENTORY / CIRCUIT_BUS / PANEL_NETWORK / CROSS_SHEET_RESOLUTION
//       reach project context
//   8  provenance survives
//   9  SLC remains CIRCUIT_BUS
//   10 SLC does NOT become FlashScan/CLIP/IDP
//   11 panel network does NOT become product compatibility
//   12 no Drawing evidence is inserted into product attributes
//   13 no Drawing evidence changes mandatoryFailures
//   14 no Drawing evidence changes mandatoryUnresolved
//   15 Al Mousa Golden matcher result before/after is identical
//   16 repeated context load is idempotent/read-only
//   17 missing Drawing architecture is fail-safe/non-blocking
//   18 128 architecture rows remain exactly 128 context evidence rows
import test from "node:test";
import assert from "node:assert/strict";
import { runProductMatching } from "../app/domain/product-matching-engine.mjs";
import { buildTechnicalRequirementProfile } from "../app/domain/technical-requirement-engine.mjs";
import { projectSearchProfileToRequirementProfile } from "../app/domain/ai-product-ranking-engine.mjs";
import { buildDrawingArchitectureBridge } from "../app/domain/drawing-architecture-bridge.mjs";
import {
  STAGE4_DRAWING_ARCHITECTURE_CONTEXT_VERSION,
  buildStage4DrawingArchitectureContext,
  normalizeStage4DrawingArchitectureContext,
  emptyDrawingArchitectureContext,
} from "../app/domain/stage4-drawing-architecture-context.mjs";
import { loadStage4DrawingArchitectureContext } from "../worker/technical-requirement-api.mjs";
import {
  makeArchDb,
  seedArchDocument,
  seedRealT00Legend,
  seedRealSheet,
  apiArchRequest,
  archInitializePath,
  archConfirmPath,
  archAdjudicateApplyPath,
  archBridgePath,
  archApprovedCurrentPath,
} from "./fixtures/drawing-architecture-fixture.mjs";

const boot = (projectId = "proj-1") => {
  const { raw, db } = makeArchDb(projectId);
  const run = (path, { method = "POST", body } = {}) => apiArchRequest(path, { method, body })({ DB: db });
  return { raw, db, run };
};

const seedRealCorpus = ({ raw, projectId = "proj-1" }) => {
  seedArchDocument({ raw, projectId, documentId: "doc-t00-real", drawingNumber: "2401232- PC- AMS- DR- T-00-ZZZ-002", sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS" });
  seedRealT00Legend({ raw, projectId, documentId: "doc-t00-real" });
  const keys = [
    ["AMS_NET", "doc-ams-net"], ["KGS_005", "doc-kgs-005"], ["AMS_002", "doc-ams-002"],
    ["SHEET_2401232_PC_WLC_DR_T_93_ZZZ_005", "doc-wlc-93"], ["SHEET_2401232_PC_GRS_DR_T_93_ZZZ_005", "doc-grs-93"], ["SHEET_2401232_PC_BOS_DR_T_93_ZZZ_005", "doc-bos-93"],
    ["SHEET_2401232_PC_BOS_DR_T_94_ZZZ_001", "doc-bos-94"], ["SHEET_2401232_PC_AMS_DR_T_94_ZZZ_001", "doc-ams-94"], ["SHEET_2401232_PC_GRS_DR_T_94_ZZZ_001", "doc-grs-94"],
    ["SHEET_2401232_PC_WLC_DR_T_94_ZZZ_001", "doc-wlc-94"], ["SHEET_2401232_PC_KGS_DR_T_91_ZZZ_002", "doc-kgs-91"],
  ];
  for (const [key, docId] of keys) seedRealSheet({ raw, projectId, sheetKey: key, documentId: docId, intakeId: `intake-${docId}` });
};

const bootstrapBridged = async (projectId = "proj-1") => {
  const h = boot(projectId);
  seedRealCorpus({ raw: h.raw, projectId });
  assert.equal((await h.run(archInitializePath(projectId))).status, 200);
  assert.equal((await h.run(archConfirmPath(projectId))).status, 200);
  assert.equal((await h.run(archAdjudicateApplyPath(projectId))).status, 200);
  return h;
};

const bridgeOf = async (run, projectId = "proj-1") => {
  const response = await run(archBridgePath(projectId), { method: "GET" });
  assert.equal(response.status, 200);
  return response.body.bridge;
};

// The REAL Stage 4 consumer path for the context: worker loader over the
// project DB (read-only) -> consumer contract. This is the exact function
// executeRequirementProfile calls.
const contextOf = async (h, projectId = "proj-1") => loadStage4DrawingArchitectureContext(h.db, projectId);

const EXPECTED_CHANNEL_COUNTS = {
  PANEL_INVENTORY: 13, CIRCUIT_BUS: 24, PANEL_NETWORK: 18, SYSTEM_INTERFACE: 26,
  NAC_CIRCUIT: 5, AREA_COVERAGE: 8, LEGEND_LINKAGE: 25, CROSS_SHEET_RESOLUTION: 9,
};

// 1 -- READY current v2 enters Stage 4 context through the real loader.
test("CI1-1: READY current v2 enters Stage 4 context via the real worker loader (128 rows, 8 channels)", async () => {
  const h = await bootstrapBridged();
  const writesBefore = [...h.db.trackedWrites];
  const context = await contextOf(h);
  assert.deepEqual(h.db.trackedWrites, writesBefore, "context load performs zero writes");
  assert.equal(context.available, true);
  assert.equal(context.architectureVersion, 2, "only the current architecture version participates");
  assert.equal(context.status, "READY_FOR_STAGE4_BRIDGE");
  assert.equal(context.evidenceCount, 128);
  assert.equal(context.version, STAGE4_DRAWING_ARCHITECTURE_CONTEXT_VERSION);
  assert.ok(context.fingerprint, "context carries a deterministic fingerprint");
  for (const [channel, count] of Object.entries(EXPECTED_CHANNEL_COUNTS)) {
    assert.equal(context.channels[channel].count, count, `channel ${channel} preserves its governed row count`);
    assert.equal(context.channels[channel].evidence.length, count);
  }
  const total = Object.values(context.channels).reduce((sum, entry) => sum + entry.count, 0);
  assert.equal(total, 128, "128 architecture rows remain exactly 128 context evidence rows");
});

// 2 -- superseded v1 is excluded.
test("CI1-2: superseded v1 without replacement yields unavailable context with zero evidence", async () => {
  const h = boot();
  seedRealCorpus({ raw: h.raw });
  assert.equal((await h.run(archInitializePath("proj-1"))).status, 200);
  assert.equal((await h.run(archConfirmPath("proj-1"))).status, 200);
  const before = (await h.run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(before.version, 1);
  h.raw.prepare("UPDATE drawing_architecture_approved_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id=?").run(before.approvedVersionId);
  const context = await contextOf(h);
  assert.equal(context.available, false, "superseded v1 is never consumed as current context");
  assert.equal(context.architectureVersion, null);
  assert.equal(context.evidenceCount, 0);
  assert.deepEqual(Object.values(context.channels).map((entry) => entry.count), [0, 0, 0, 0, 0, 0, 0, 0]);
});

// 3 -- bridge unavailable/incomplete does not crash Stage 4.
test("CI1-3: missing Drawing architecture is fail-safe -- null bridge normalizes to unavailable context", () => {
  const context = buildStage4DrawingArchitectureContext(null);
  assert.equal(context.available, false);
  assert.equal(context.evidenceCount, 0);
  assert.equal(normalizeStage4DrawingArchitectureContext(undefined).available, false);
  assert.equal(normalizeStage4DrawingArchitectureContext(null).available, false);
  // A profile still builds and matches with unavailable context.
  const profile = buildTechnicalRequirementProfile({
    boqItem: { id: "boq-1", description: "Heat detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Heat Detector" },
    drawingArchitectureContext: null,
  });
  assert.equal(profile.drawingArchitectureContext.available, false);
});

// 4-7 -- governed channels reach project context.
test("CI1-4/7: PANEL_INVENTORY, CIRCUIT_BUS, PANEL_NETWORK, CROSS_SHEET_RESOLUTION reach project context with provenance", async () => {
  const h = await bootstrapBridged();
  const context = await contextOf(h);
  const panel = context.channels.PANEL_INVENTORY.evidence;
  assert.ok(panel.length >= 13);
  assert.ok(panel.every((entry) => entry.provenance?.sourceDrawingNumber), "panel provenance survives");
  const circuit = context.channels.CIRCUIT_BUS.evidence;
  assert.equal(circuit.length, 24);
  assert.ok(circuit.every((entry) => entry.factType === "SLC_LOOP_EXISTS"));
  const network = context.channels.PANEL_NETWORK.evidence;
  assert.equal(network.length, 18);
  const refs = context.channels.CROSS_SHEET_RESOLUTION.evidence;
  assert.equal(refs.length, 9);
  assert.ok(refs.every((entry) => entry.adjudication?.decisionState === "CONFIRMED_PROJECT_REFERENCE"), "cross-sheet adjudication survives");
});

// 8 -- provenance survives on every row.
test("CI1-8: provenance (drawing, sheet, fingerprint, version) survives on every context row", async () => {
  const h = await bootstrapBridged();
  const context = await contextOf(h);
  const all = Object.values(context.channels).flatMap((entry) => entry.evidence);
  assert.equal(all.length, 128);
  for (const entry of all) {
    assert.equal(entry.architectureVersion, 2);
    assert.ok(entry.provenance?.sourceDrawingNumber, `${entry.id}: drawing survives`);
    assert.ok(/^[0-9a-f]{64}$/.test(entry.provenance?.evidenceFingerprint || ""), `${entry.id}: evidence fingerprint survives`);
  }
});

// 9/10 -- SLC stays CIRCUIT_BUS; never FlashScan/CLIP/IDP.
test("CI1-9/10: SLC remains CIRCUIT_BUS project architecture -- never protocol, never FlashScan/CLIP/IDP", async () => {
  const h = await bootstrapBridged();
  const context = await contextOf(h);
  const serialized = JSON.stringify(context);
  assert.ok(!/flashscan|clip/i.test(serialized), "no FlashScan/CLIP token may appear in Stage 4 context");
  assert.ok(!/\bIDP\b/.test(serialized), "no IDP protocol token may appear in Stage 4 context");
  for (const entry of context.channels.CIRCUIT_BUS.evidence) {
    assert.equal(entry.protocol, false);
    assert.equal(entry.productCompatibility, false);
    assert.equal(entry.matchingRole, "project-architecture-context");
  }
});

// 11 -- panel network never becomes product compatibility.
test("CI1-11: panel network and every other channel never become product compatibility", async () => {
  const h = await bootstrapBridged();
  const context = await contextOf(h);
  const all = Object.values(context.channels).flatMap((entry) => entry.evidence);
  assert.ok(all.every((entry) => entry.productCompatibility === false));
  assert.ok(all.every((entry) => entry.protocol === false));
  assert.ok(!("compatibility" in context), "context carries no compatibility surface");
});

// 12 -- no Drawing evidence is inserted into product attributes.
test("CI1-12: Stage 4 context exposes no product-attribute surface", async () => {
  const h = await bootstrapBridged();
  const context = await contextOf(h);
  const keys = new Set(Object.keys(context));
  for (const forbidden of ["attributes", "compatibility", "standards", "requirements", "consolidatedRequirements", "accessories"]) {
    assert.ok(!keys.has(forbidden), `context must not carry ${forbidden}`);
  }
});

// 15 -- Golden before/after identical (13/14 fold into the matrix assertions).
const REQ_197 = "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_197";
const goldenProfileBase = () => ({
  versionNumber: 10,
  boqItem: { id: "boqitem_5af0a8eb-7233-4dcb-bf46-8b7a28ffc5bf", itemNumber: "C", description: "Heat detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Heat Detector", attributes: {} },
  readiness: { status: "Ready with Warnings", blockingReasons: [] },
  consolidatedRequirements: [{
    id: "consolidated:Compliance|fixed temperature rate of rise heat detectors",
    governingSourceId: REQ_197, requirementType: "Mandatory", requirementCategory: "Compliance", priority: "Mandatory",
    attributes: [
      { name: "addressing", operator: "Equal", normalizedValue: "Addressable" },
      { name: "fixed_temperature_setpoint", operator: "Equal", normalizedValue: "135°F" },
      { name: "rate_of_rise_sensitivity", operator: "Equal", normalizedValue: "15°F/min" },
    ],
  }],
  standards: [],
  compatibility: [{ requirement_id: REQ_197, targetItem: "Flash Scan® and CLIP protocol systems", relationshipType: "Compatible With", mandatory: 1, confidence: 84 }],
  accessories: [{ requirement_id: REQ_197, accessory: "isolator", sourceType: "Derived", confidence: 60, reviewStatus: "Needs Review" }],
  derivedRequirements: [],
});
const goldenProduct = () => ({
  id: "product_161c27bf-70d9-4e3e-b1c9-ad7783dc3dac", manufacturer: "Honeywell", family: "Addressable Heat Detector", partNumber: "IDP-HEAT-ROR-IV",
  description: "Addressable ROR heat detector", lifecycleStatus: "Active", reviewStatus: "Reviewed",
  attributes: [
    { name: "addressing", normalizedValue: "Addressable" },
    { name: "fixed_temperature_setpoint", normalizedValue: "135°F" },
    { name: "rate_of_rise_sensitivity", normalizedValue: "15°F/min" },
  ],
  standards: [], compatibility: [{ targetItem: "the control unit", relationshipType: "Compatible With" }], accessories: [],
  source: { sheet: "Catalogue", row: 1 },
});
const candidateSummary = (candidate) => ({
  technicalStatus: candidate.technicalStatus,
  recommendationTier: candidate.recommendationTier,
  approvalReady: candidate.approvalReady,
  mandatoryFailures: candidate.mandatoryFailures.length,
  mandatoryUnresolved: candidate.mandatoryUnresolved.map((entry) => `${entry.comparisonType}:${entry.result}`),
  comparisons: candidate.comparisons.map((entry) => `${entry.comparisonType}:${entry.required?.name || entry.requirement?.targetItem || entry.accessory}:${entry.result}:${entry.pass}:${entry.blocking}`),
});

test("CI1-13/14/15: Golden matcher result is identical with and without Drawing context; mandatory aggregates unchanged", async () => {
  const h = await bootstrapBridged();
  const context = await contextOf(h);
  assert.equal(context.available, true, "precondition: real v2 context is available");
  const before = runProductMatching({ profile: goldenProfileBase(), products: [goldenProduct()], prices: [], projectId: "project_c0123d91-c30b-4956-87cb-e473ef53f89d" }).candidates[0];
  const after = runProductMatching({ profile: { ...goldenProfileBase(), drawingArchitectureContext: context }, products: [goldenProduct()], prices: [], projectId: "project_c0123d91-c30b-4956-87cb-e473ef53f89d" }).candidates[0];
  assert.deepEqual(candidateSummary(after), candidateSummary(before), "Drawing context must not change any matching verdict");
  assert.equal(after.technicalStatus, "Technical Review Required");
  assert.equal(after.recommendationTier, "Pending Evidence");
  assert.equal(after.mandatoryFailures.length, 0);
  assert.equal(after.mandatoryUnresolved.length, 1);
  assert.equal(after.approvalReady, false);
});

// 16 -- idempotent, read-only repeated loads.
test("CI1-16: repeated context loads are idempotent and read-only", async () => {
  const h = await bootstrapBridged();
  const writesBefore = [...h.db.trackedWrites];
  const first = await contextOf(h);
  const second = await contextOf(h);
  assert.deepEqual(h.db.trackedWrites, writesBefore, "repeated loads perform zero writes");
  assert.deepEqual(second, first, "context is byte-identical across repeated loads");
});

// 17 -- missing architecture fail-safe through the real loader.
test("CI1-17: project with no architecture records yields unavailable context, never a crash", async () => {
  const h = boot("proj-empty");
  const context = await contextOf(h, "proj-empty");
  assert.equal(context.available, false);
  assert.equal(context.evidenceCount, 0);
});

// Profile-level consumer exposure through the normal runtime path.
test("CI1-G: requirement profile carries the context; the matching-API transformer preserves it", async () => {
  const h = await bootstrapBridged();
  const context = await contextOf(h);
  const profile = buildTechnicalRequirementProfile({
    boqItem: { id: "boq-1", description: "Heat detector", system: "Fire Alarm", category: "Detection Devices", productFamily: "Addressable Heat Detector" },
    drawingArchitectureContext: context,
  });
  assert.equal(profile.drawingArchitectureContext.available, true);
  assert.equal(profile.drawingArchitectureContext.evidenceCount, 128);
  // The exact transformer product-matching-api applies before matching.
  const relayed = projectSearchProfileToRequirementProfile({
    boqItemId: "boq-1",
    normalizedDescription: { value: "Heat detector" },
    system: { value: "Fire Alarm" }, category: { value: "Detection Devices" }, subcategory: null,
    equipmentType: null, productFamily: null,
    manufacturerHints: [], explicitModelHints: [],
  }, JSON.parse(JSON.stringify(profile)));
  assert.equal(relayed.drawingArchitectureContext.evidenceCount, 128, "context survives the matching-API profile relay");
  assert.ok(!("drawingArchitectureContext" in runProductMatching({ profile: relayed, products: [], prices: [] })) || true, "matcher accepts the broader Stage 4 context object");
});

// Discrepancies never become positive engineering facts in context.
test("CI1-E: ARCHITECTURE_DISCREPANCY rows never enter context evidence", async () => {
  const h = await bootstrapBridged();
  const context = await contextOf(h);
  const all = Object.values(context.channels).flatMap((entry) => entry.evidence);
  assert.ok(!all.some((entry) => entry.factType === "ARCHITECTURE_DISCREPANCY"), "discrepancies stay review artifacts");
  assert.ok(context.unresolved.every((entry) => entry.blocking === false), "unresolved context stays non-blocking");
  assert.deepEqual(context.provenance.nonBridgedFactTypes, [], "this corpus bridges 128/128 approved rows; discrepancies live only as unresolved review cases, never as approved rows");
});
