// STEP 14.7 -- SYSTEM ARCHITECTURE REVIEW -- governed suite (tests A..T).
//
//   A  explicit panel evidence confirms -> PANEL_EXISTS / PANEL_LABEL
//   B  ambiguous panel label (two buildings equidistant) -> engineer review
//   C  panel-to-loop relation from ONE shared evidence line -> confirm
//   D  ambiguous line/shape is NEVER a connection (no line-based inference)
//   E  exact cross-sheet reference resolves -> confirmed
//   F  missing referenced sheet -> unresolved engineer review + discrepancy
//   G  same panel across sheets resolves only via exact shared location tokens
//   H  two resolved locations for one proven identity -> conflict discrepancy
//   I  layout token matches a GOVERNED legend row -> LAYOUT_LEGEND_LINK confirm
//   J  layout sheet authors NO panel facts; riser panel facts confirm
//   K  superseded intake on a confirmed fact -> stale + never re-promoted
//   L  evidence change in ONE doc does not stale an unrelated doc's facts
//   M  Fire Alarm <-> PA/VA isolation (PA-VA legend never authors FA facts)
//   N  no Technical Approval side-effects
//   O  no product-match side-effects
//   P  no pricing/commercial side-effects
//   Q  every promoted fact retains complete provenance
//   R  evaluate is a read-only deterministic dry-run (top-level idempotency)
//   S  repeated deterministic-confirm is idempotent (single approved version)
//   T  REAL Al Mousa integration: AMS network + KGS + substation golden sheets
//      through the real pipeline with the real governed T-00 legend rows
import test from "node:test";
import assert from "node:assert/strict";
import {
  ARCHITECTURE_FACT_DECISION_STATES,
  ARCHITECTURE_FACT_DECISION_POLICY_VERSION,
  SYSTEM_ARCHITECTURE_EVALUATION_ACTOR,
  isArchitectureAutoConfirmEligible,
} from "../app/domain/drawing-architecture-decision-policy.mjs";
import { ARCHITECTURE_PARSER_VERSION } from "../app/domain/drawing-architecture-intelligence.mjs";
import {
  makeArchDb,
  seedArchDocument,
  seedArchIntakeVersion,
  seedRealT00Legend,
  seedRealSheet,
  apiArchRequest,
  archInitializePath,
  archReviewPath,
  archEvaluatePath,
  archConfirmPath,
  archApprovedCurrentPath,
  archApprovedHistoryPath,
  casesRows,
  caseByFact,
  snapshotOf,
} from "./fixtures/drawing-architecture-fixture.mjs";

const box = (x, y, width = 60, height = 30) => ({ x, y, width, height });

// ---------------------------------------------------------------------------
// Harness: fresh in-memory DB + routed handler calls.
// ---------------------------------------------------------------------------
const boot = (projectId = "proj-1") => {
  const { raw, db } = makeArchDb(projectId);
  const run = (path, { method = "POST", body } = {}) => apiArchRequest(path, { method, body })({ DB: db });
  return { raw, db, run };
};

const reviewDecisions = async ({ run }, projectId = "proj-1") => {
  const res = await run(archEvaluatePath(projectId));
  assert.equal(res.status, 200);
  return res.body;
};

// ---------------------------------------------------------------------------
// A -- explicit panel evidence confirms.
// ---------------------------------------------------------------------------
test("A: explicit panel evidence confirms PANEL_EXISTS/PANEL_LABEL + interface (riser, unambiguous geometry)", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-a",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-001",
    sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [
      { id: "a1", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: box(2400, 1400, 420, 80) },
      { id: "a2", text: "FACP", box: box(2000, 2000) },
      { id: "a3", text: "BOYS SCHOOL", box: box(2050, 2070, 180, 40) },
      { id: "a4", text: "GIRLS SCHOOL", box: box(300, 3000, 180, 40) },
      { id: "a5", text: "SIGNAL TO CIVIL DEFENSE", box: box(3000, 1400, 400, 60) },
    ],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  assert.equal(decisions.counts.total, 5);
  assert.equal(decisions.counts.wouldConfirm, 4);
  assert.equal(decisions.counts.wouldRequireEngineer, 1); // lone generic FACP symbol
  const exists = decisionFor(decisions, "PANEL_EXISTS", "MFACP", null);
  assert.equal(exists.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
  assert.equal(isArchitectureAutoConfirmEligible(exists), true);
  assert.ok(exists.decisionReasons.includes("EXPLICIT_SHEET_EVIDENCE"));
  const label = decisionFor(decisions, "PANEL_LABEL", "MFACP", null);
  assert.equal(label.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
  const serves = decisionFor(decisions, "PANEL_SERVES_AREA", "FACP", "BOYS SCHOOL");
  assert.equal(serves.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING);
  assert.deepEqual(serves.warnings, ["DERIVED_FROM_DETERMINISTIC_GEOMETRY"]);
  const iface = decisionFor(decisions, "EXTERNAL_SYSTEM_INTERFACE", "AMS FIRE ALARM SYSTEM", "CIVIL DEFENCE");
  assert.equal(iface.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
});

// ---------------------------------------------------------------------------
// B -- ambiguous panel label -> engineer review.
// ---------------------------------------------------------------------------
test("B: panel equidistant from two building labels is engineer-review (never a guess)", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-b",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-002",
    sheetName: "FIRE DETECTION & ALARM SCHEMATIC",
    assets: [
      { id: "b1", text: "FACP", box: box(500, 500) },
      { id: "b2", text: "BOYS SCHOOL", box: box(530, 500, 160) },
      { id: "b3", text: "GIRLS SCHOOL", box: box(530, 545, 160) },
    ],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  const ambiguous = decisionFor(decisions, "PANEL_SERVES_AREA", "FACP", null, /AMBIGUOUS/);
  assert.ok(ambiguous, "ambiguous PANEL_SERVES_AREA expected");
  assert.equal(ambiguous.state, ARCHITECTURE_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.ok(ambiguous.decisionReasons.includes("PANEL_IDENTITY_AMBIGUOUS") || ambiguous.decisionReasons.includes("ASSIGNMENT_AMBIGUOUS_NEAREST"));
  // A deterministic discrepancy signal is also recorded for review.
  const disc = caseByFact(raw, "proj-1", "ARCHITECTURE_DISCREPANCY", "2401232-PC-AMS-DR-T-93-ZZZ-002");
  assert.ok(disc, "discrepancy case expected for ambiguous assignment");
  assert.notEqual(decisionFor(decisions, "PANEL_EXISTS", "FACP", null).state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
});

// ---------------------------------------------------------------------------
// C -- panel-to-loop relation from ONE shared evidence line.
// ---------------------------------------------------------------------------
test("C: panel-to-loop relation confirms only from a shared reconstructed line", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-c",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-003",
    sheetName: "FIRE DETECTION & ALARM SCHEMATIC",
    assets: [
      { id: "c1", text: "FACP", box: box(100, 100) },
      { id: "c2", text: "LOOP-1", box: box(160, 100, 90) },
    ],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  const rel = decisionFor(decisions, "PANEL_LOOP_RELATION", "FACP", "LOOP-1");
  assert.ok(rel, "PANEL_LOOP_RELATION expected");
  assert.equal(rel.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING);
  assert.ok(rel.decisionReasons.includes("DETERMINISTIC_GEOMETRY_ASSIGNMENT"));
  const loop = decisionFor(decisions, "SLC_LOOP_EXISTS", "LOOP-1", null);
  assert.equal(loop.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
});

// ---------------------------------------------------------------------------
// D -- ambiguous line/shape is NEVER a connection.
// ---------------------------------------------------------------------------
test("D: a bare Line shape and unlinked tokens never infer a connection", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-d",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-004",
    sheetName: "FIRE DETECTION & ALARM SCHEMATIC",
    assets: [
      { id: "d1", assetType: "Line", text: null, box: box(100, 100, 400, 2) },
      { id: "d2", text: "MAIN PANEL", box: box(100, 100) },
      { id: "d3", text: "LOOP-4", box: box(500, 500) },
    ],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const review = await run(archReviewPath("proj-1"));
  const cases = review.body.cases;
  assert.equal(cases.length, 1, "only the isolated LOOP-4 fact should exist");
  assert.equal(cases[0].factType, "SLC_LOOP_EXISTS");
  assert.equal(cases[0].subject, "LOOP-4");
  const decisions = await reviewDecisions({ run });
  assert.equal(decisions.counts.wouldConfirm, 1);
  assert.equal(decisions.outcomes.filter((o) => o.factType === "PANEL_NETWORK_LINK" || o.factType === "PANEL_LOOP_RELATION").length, 0);
});

// ---------------------------------------------------------------------------
// E -- exact cross-sheet reference resolves -> confirmed.
// ---------------------------------------------------------------------------
test("E: exact cross-sheet drawing-number reference resolves and confirms", async () => {
  const { raw, db, run } = boot();
  const src = seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-e-src",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-011",
    sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [{ id: "e-ref", text: "REFER DRAWING NO. 2401232-PC-AMS-DR-T-00-ZZZ-002", box: box(100, 100, 600, 40) }],
  });
  const tgt = seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-e-tgt",
    drawingNumber: "2401232- PC- AMS- DR- T-00-ZZZ-002",
    sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS",
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  const ref = decisionFor(decisions, "CROSS_SHEET_REFERENCE", "2401232-PC-AMS-DR-T-93-ZZZ-011", "2401232-PC-AMS-DR-T-00-ZZZ-002");
  assert.ok(ref, "CROSS_SHEET_REFERENCE expected");
  assert.equal(ref.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
  assert.ok(ref.decisionReasons.includes("CROSS_SHEET_EXACT_RESOLUTION"));
  const row = caseByFact(raw, "proj-1", "CROSS_SHEET_REFERENCE", "2401232-PC-AMS-DR-T-93-ZZZ-011");
  const snap = snapshotOf(row);
  assert.equal(snap.resolution?.state, "Resolved");
  assert.equal(snap.resolution?.resolvedTargetDocumentId, tgt.documentId);
  assert.deepEqual(snap.source?.sourceFragmentIds, ["e-ref"]);
});

// ---------------------------------------------------------------------------
// F -- missing referenced sheet -> unresolved engineer review + discrepancy.
// ---------------------------------------------------------------------------
test("F: a reference to a drawing absent from the register is never confirmed", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-f-src",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-012",
    sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [{ id: "f-ref", text: "REFER DRAWING NO. 2401232-PC-AMS-DR-T-00-ZZZ-099", box: box(100, 100, 600, 40) }],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  const ref = decisionFor(decisions, "CROSS_SHEET_REFERENCE", "2401232-PC-AMS-DR-T-93-ZZZ-012", "2401232-PC-AMS-DR-T-00-ZZZ-099");
  assert.ok(ref, "CROSS_SHEET_REFERENCE expected");
  assert.equal(ref.state, ARCHITECTURE_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.ok(ref.decisionReasons.includes("CROSS_SHEET_UNRESOLVED_TARGET"));
  const disc = caseByFact(raw, "proj-1", "ARCHITECTURE_DISCREPANCY", "2401232-PC-AMS-DR-T-93-ZZZ-012");
  assert.ok(disc, "discrepancy case expected for the unresolved reference");
  assert.ok(disc.object && disc.object.includes("2401232-PC-AMS-DR-T-00-ZZZ-099"));
});

// ---------------------------------------------------------------------------
// G -- same panel across sheets resolves ONLY via exact shared location tokens.
// ---------------------------------------------------------------------------
test("G: cross-sheet panel identity resolves via shared location tokens, never by name", async () => {
  const { raw, db, run } = boot();
  const labelBox = (y) => box(1000, y, 420, 60);
  const roomBox = (y) => box(1000, y + 100, 300, 40);
  seedArchDocument({ raw, projectId: "proj-1", documentId: "doc-g1", drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-013", sheetName: "FIRE DETECTION & ALARM SCHEMATIC", assets: [ { id: "g1a", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: labelBox(1000) }, { id: "g1b", text: "AT FCC ROOM -00-015", box: roomBox(1000) } ] });
  seedArchDocument({ raw, projectId: "proj-1", documentId: "doc-g2", drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-014", sheetName: "FIRE DETECTION & ALARM SCHEMATIC", assets: [ { id: "g2a", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: labelBox(2000) }, { id: "g2b", text: "AT FCC ROOM -00-015", box: roomBox(2000) } ] });
  seedArchDocument({ raw, projectId: "proj-1", documentId: "doc-g3", drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-015", sheetName: "FIRE DETECTION & ALARM SCHEMATIC", assets: [ { id: "g3a", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: labelBox(3000) }, { id: "g3b", text: "AT SCHOOL GYMNASIUM", box: roomBox(3000) } ] });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const review = await run(archReviewPath("proj-1"));
  const located = review.body.cases.filter((c) => c.factType === "PANEL_SERVES_AREA" && c.subject === "MFACP" && c.relation === "LOCATED_AT");
  const g1 = located.find((c) => c.sourceDrawingNumber.includes("013"));
  const g2 = located.find((c) => c.sourceDrawingNumber.includes("014"));
  const g3 = located.find((c) => c.sourceDrawingNumber.includes("015"));
  assert.ok(g1 && g2 && g3, "three LOCATED_AT cases expected");
  assert.equal(g1.snapshot.crossSheetIdentity?.resolved, true, "g1 should resolve against g2 via shared tokens");
  assert.equal(g2.snapshot.crossSheetIdentity?.resolved, true);
  assert.ok(g1.snapshot.crossSheetIdentity.sharedTokens.includes("FCC"), "shared tokens are exact location text");
  assert.ok(g2.snapshot.crossSheetIdentity.acrossSheets.length >= 2);
  assert.ok(!g3.snapshot.crossSheetIdentity, "g3 (no shared location tokens) must NOT resolve by name alone");
});

// ---------------------------------------------------------------------------
// H -- two resolved locations for one proven identity -> conflict discrepancy.
// ---------------------------------------------------------------------------
test("H: a proven identity located at two different rooms is a conflict discrepancy", async () => {
  const { raw, db, run } = boot();
  const labelBox = (y) => box(1000, y, 420, 60);
  const roomBox = (y) => box(1000, y + 100, 300, 40);
  seedArchDocument({ raw, projectId: "proj-1", documentId: "doc-h1", drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-016", sheetName: "FIRE DETECTION & ALARM SCHEMATIC", assets: [ { id: "h1a", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: labelBox(1000) }, { id: "h1b", text: "AT FCC ROOM -00-015", box: roomBox(1000) } ] });
  seedArchDocument({ raw, projectId: "proj-1", documentId: "doc-h2", drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-017", sheetName: "FIRE DETECTION & ALARM SCHEMATIC", assets: [ { id: "h2a", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: labelBox(2000) }, { id: "h2b", text: "AT FCC ROOM -00-125", box: roomBox(2000) } ] });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  const conflictCase = caseByFact(raw, "proj-1", "ARCHITECTURE_DISCREPANCY", "2401232-PC-AMS-DR-T-93-ZZZ-017");
  assert.ok(conflictCase, "conflict discrepancy expected on the second sheet");
  assert.ok(conflictCase.object.includes("CONFLICTING PANEL LOCATION"));
  assert.ok(conflictCase.object.includes("FCC ROOM -00-015") && conflictCase.object.includes("FCC ROOM -00-125"));
  assert.equal(decisionFor(decisions, "ARCHITECTURE_DISCREPANCY", "2401232-PC-AMS-DR-T-93-ZZZ-017", null).state, ARCHITECTURE_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
});

// ---------------------------------------------------------------------------
// I -- layout token matches a GOVERNED legend row.
// ---------------------------------------------------------------------------
test("I: layout token matching a governed legend row confirms LAYOUT_LEGEND_LINK", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-t00",
    drawingNumber: "2401232- PC- AMS- DR- T-00-ZZZ-002",
    sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS",
  });
  seedRealT00Legend({ raw, projectId: "proj-1", documentId: "doc-t00" });
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-layout",
    drawingNumber: "2401232-PC-AMS-DR-L-01-ZZZ-001",
    sheetName: "GROUND FLOOR FIRE ALARM LAYOUT",
    classificationType: "Floor Plan",
    assets: [{ id: "i-h", text: "H", box: box(100, 100, 40, 40) }],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  const link = decisionFor(decisions, "LAYOUT_LEGEND_LINK", "H", "HEAT DETECTOR");
  assert.ok(link, "LAYOUT_LEGEND_LINK expected");
  assert.equal(link.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
  assert.equal(decisions.outcomes.filter((o) => o.factType === "PANEL_EXISTS").length, 0, "layout sheet authors no panel facts");
});

// ---------------------------------------------------------------------------
// J -- layout sheet authors NO panel facts; riser panel facts confirm.
// ---------------------------------------------------------------------------
test("J: panel existence/facts are authored only by riser/schematic sheets", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-t00-b",
    drawingNumber: "2401232- PC- AMS- DR- T-00-ZZZ-002",
    sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS",
  });
  seedRealT00Legend({ raw, projectId: "proj-1", documentId: "doc-t00-b" });
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-layout-j",
    drawingNumber: "2401232-PC-AMS-DR-L-01-ZZZ-002",
    sheetName: "GROUND FLOOR FIRE ALARM LAYOUT",
    classificationType: "Floor Plan",
    assets: [{ id: "j-h", text: "F", box: box(100, 100, 40, 40) }],
  });
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-riser-j",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-021",
    sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [
      { id: "j1", text: "FACP", box: box(2000, 2000) },
      { id: "j2", text: "BOYS SCHOOL", box: box(2050, 2070, 180, 40) },
    ],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const review = await run(archReviewPath("proj-1"));
  const layoutCases = review.body.cases.filter((c) => c.sourceDrawingNumber === "2401232-PC-AMS-DR-L-01-ZZZ-002");
  assert.equal(layoutCases.filter((c) => c.factType.startsWith("PANEL")).length, 0);
  const riserCases = review.body.cases.filter((c) => c.sourceDrawingNumber === "2401232-PC-AMS-DR-T-93-ZZZ-021");
  const riserExists = riserCases.find((c) => c.factType === "PANEL_EXISTS" && c.subject === "FACP");
  const riserServes = riserCases.find((c) => c.factType === "PANEL_SERVES_AREA" && c.object === "BOYS SCHOOL");
  assert.ok(riserExists && riserServes);
});

// ---------------------------------------------------------------------------
// K -- superseded intake on a confirmed fact -> stale + never re-promoted.
// ---------------------------------------------------------------------------
test("K: superseded intake invalidates an approved architecture fact (stale, never silently re-promoted)", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw,
    projectId: "proj-1",
    documentId: "doc-k",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-031",
    sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    intakeId: "intake-k1",
    assets: [{ id: "k1", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: box(2400, 1400, 420, 80) }],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  assert.equal((await run(archConfirmPath("proj-1"))).status, 200);
  const v1 = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(v1.version, 1);
  assert.equal(v1.approvedRows.length, 2, "PANEL_EXISTS + PANEL_LABEL for the single MFACP label");

  // Supersede the intake + provide a NEWER current intake with changed evidence.
  raw.prepare("UPDATE drawing_intake_versions SET superseded_at=CURRENT_TIMESTAMP WHERE id='intake-k1'").run();
  seedArchIntakeVersion({
    raw,
    projectId: "proj-1",
    documentId: "doc-k",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-031",
    sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    intakeId: "intake-k2",
    intakeVersion: 2,
    assets: [{ id: "k2", text: "CAMPUS-WIDE MAIN FIRE ALARM CONTROL PANEL", box: box(2400, 1400, 420, 80) }],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  assert.ok(decisions.counts.stale >= 2, "both previously-approved v1 facts must be STALE");
  assert.equal(decisions.counts.wouldConfirm, 2, "the new intake's fresh PANEL_EXISTS+PANEL_LABEL confirm");

  assert.equal((await run(archConfirmPath("proj-1"))).status, 200);
  const approved = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(approved.version, 2);
  assert.equal(approved.approvedRows.length, 2, "only the fresh intake's PANEL_EXISTS+PANEL_LABEL promote again");
  assert.ok(approved.approvedRows.every((r) => r.drawingIntakeVersionId === "intake-k2"), "every promoted row comes from the current intake");
  const history = (await run(archApprovedHistoryPath("proj-1"), { method: "GET" })).body.history;
  assert.equal(history.length, 2);
  assert.equal(history.find((v) => v.version === 1).status, "Superseded");
});

// ---------------------------------------------------------------------------
// L -- evidence change in ONE doc does not stale an unrelated doc's facts.
// ---------------------------------------------------------------------------
test("L: unrelated document facts are not staled by another document's evidence change", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-la",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-041", sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [{ id: "la1", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: box(2400, 1400, 420, 80) }],
  });
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-lb",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-042", sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    intakeId: "intake-lb",
    assets: [{ id: "lb1", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: box(2400, 1400, 420, 80) }],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  assert.equal((await run(archConfirmPath("proj-1"))).status, 200);
  const v1 = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(v1.version, 1);
  assert.equal(v1.approvedRows.length, 4, "two docs x (PANEL_EXISTS + PANEL_LABEL)");

  // Only B's evidence changes.
  raw.prepare("UPDATE drawing_assets SET text_content='CAMPUS-WIDE MAIN FIRE ALARM CONTROL PANEL' WHERE id='lb1'").run();
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const decisions = await reviewDecisions({ run });
  // A's facts are untouched -> already confirmed; nothing staled for A.
  assert.equal(decisions.counts.alreadyConfirmed, 2, "A's two facts stay confirmed");
  assert.equal(decisions.counts.stale, 2, "B's two changed-evidence facts go stale instead of being re-confirmed");
  const aOutcomes = decisions.outcomes.filter((o) => o.reviewCaseId && casesRows(raw, "proj-1").find((r) => r.id === o.reviewCaseId)?.document_id === "doc-la" && o.decision?.alreadyConfirmed);
  assert.equal(aOutcomes.length, 2, "both A facts are already-confirmed");
});

// ---------------------------------------------------------------------------
// M -- Fire Alarm <-> PA/VA isolation.
// ---------------------------------------------------------------------------
test("M: Fire Alarm <-> PA/VA isolation (PA-VA legend never authors FA facts)", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-pa",
    drawingNumber: "2401232-PC-AMS-DR-T-00-ZZZ-051", sheetName: "PUBLIC ADDRESS AND VOICE ALARM LEGEND, NOTES",
    classificationType: "Legend Sheet",
    assets: [
      { id: "pa1", text: "VOICE ALARM CONTROL PANEL (VACP)", box: box(100, 100, 400, 60) },
      { id: "pa2", text: "PA/VA ACTIVE SPEAKER", box: box(100, 200, 300, 40) },
    ],
  });
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-fa",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-052", sheetName: "FIRE DETECTION & ALARM SCHEMATIC",
    assets: [{ id: "fa1", text: "INTERFACE TO PUBLIC ADDRESS & VOICE ALARM SYSTEM", box: box(300, 300, 500, 40) }],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const review = await run(archReviewPath("proj-1"));
  const paCases = review.body.cases.filter((c) => c.sourceDrawingNumber === "2401232-PC-AMS-DR-T-00-ZZZ-051");
  assert.equal(paCases.length, 0, "PA-VA legend sheet authors zero FA facts");
  const decisions = await reviewDecisions({ run });
  const iface = decisions.outcomes.find((o) => o.factType === "INTERFACE_CONNECTED_TO_SYSTEM");
  assert.ok(iface, "FA interface to PA/VA system expected");
  assert.equal(iface.decision.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
  const row = caseByFact(raw, "proj-1", "INTERFACE_CONNECTED_TO_SYSTEM", "FIRE ALARM SYSTEM");
  assert.equal(row.scope, "FIRE_ALARM");
});

// ---------------------------------------------------------------------------
// N/O/P -- no technical approval / product-match / pricing side-effects.
// ---------------------------------------------------------------------------
test("N/O/P: initialize+confirm touches ONLY the architecture governance surface (no Technical Approval / product match / pricing)", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-nop",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-061", sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [
      { id: "n1", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: box(2400, 1400, 420, 80) },
      { id: "n2", text: "SIGNAL TO CIVIL DEFENSE", box: box(3000, 1400, 400, 60) },
    ],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  assert.equal((await run(archConfirmPath("proj-1"))).status, 200);
  const expected = new Set(["drawing_architecture_review_cases", "drawing_architecture_approved_versions", "drawing_architecture_approved_rows", "drawing_architecture_approved_audit_events"]);
  for (const table of db.trackedWrites) assert.ok(expected.has(table), `unexpected write to ${table}`);
  assert.ok(!db.trackedWrites.some((t) => /technical_approv|product|pricing|commercial/i.test(t)), "no Technical Approval / product / pricing writes");
});

// ---------------------------------------------------------------------------
// Q -- every promoted fact retains complete provenance.
// ---------------------------------------------------------------------------
test("Q: promoted architecture facts retain complete provenance", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-q",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-071", sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [
      { id: "q1", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: box(2400, 1400, 420, 80) },
      { id: "q2", text: "SIGNAL TO CIVIL DEFENSE", box: box(3000, 1400, 400, 60) },
    ],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  assert.equal((await run(archConfirmPath("proj-1"))).status, 200);
  const approved = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(approved.approvedRows.length, 3, "MFACP label (PANEL_EXISTS+PANEL_LABEL) + civil-defence interface");
  for (const row of approved.approvedRows) {
    assert.ok(row.sourceFragmentIds.length > 0, "fragment provenance required");
    assert.ok(row.sourceRegion && typeof row.sourceRegion.x === "number", "source region required");
    assert.ok(row.evidenceFingerprint && row.evidenceFingerprint.length === 64, "evidence fingerprint required");
    assert.equal(row.parserVersion, ARCHITECTURE_PARSER_VERSION);
    assert.equal(row.reviewActorId, SYSTEM_ARCHITECTURE_EVALUATION_ACTOR);
    assert.ok(row.reviewReason.includes(ARCHITECTURE_FACT_DECISION_POLICY_VERSION));
    assert.ok(row.snapshot.initializationProvenance?.actor === SYSTEM_ARCHITECTURE_EVALUATION_ACTOR);
  }
});

// ---------------------------------------------------------------------------
// R -- evaluate is a read-only deterministic dry-run.
// ---------------------------------------------------------------------------
test("R: evaluate dry-run is deterministic, read-only and changes nothing", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-r",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-081", sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [{ id: "r1", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: box(2400, 1400, 420, 80) }],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const before = (await run(archReviewPath("proj-1"), { method: "GET" })).body;
  const writesBeforeDryRun = [...db.trackedWrites];
  const first = await run(archEvaluatePath("proj-1"));
  const second = await run(archEvaluatePath("proj-1"));
  assert.equal(first.status, 200);
  assert.equal(first.body.dryRun, true);
  assert.deepEqual(second.body, first.body, "two dry-runs must be byte-identical");
  assert.deepEqual(db.trackedWrites, writesBeforeDryRun, "dry-run performs no writes");
  const after = (await run(archReviewPath("proj-1"), { method: "GET" })).body;
  assert.deepEqual(after.cases.map((c) => c.status), before.cases.map((c) => c.status), "case statuses unchanged by dry-run");
  assert.ok(first.body.counts.wouldConfirm >= 1);
});

// ---------------------------------------------------------------------------
// S -- repeated deterministic-confirm is idempotent.
// ---------------------------------------------------------------------------
test("S: repeated deterministic-confirm is idempotent (one approved version, no duplicates)", async () => {
  const { raw, db, run } = boot();
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-s",
    drawingNumber: "2401232-PC-AMS-DR-T-93-ZZZ-082", sheetName: "OVERALL FIRE ALARM PANEL NETWORK DIAGRAM",
    assets: [{ id: "s1", text: "MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)", box: box(2400, 1400, 420, 80) }],
  });
  assert.equal((await run(archInitializePath("proj-1"))).status, 200);
  const first = await run(archConfirmPath("proj-1"));
  assert.equal(first.status, 200);
  assert.equal(first.body.promotion.version, 1);
  const second = await run(archConfirmPath("proj-1"));
  assert.equal(second.status, 200);
  assert.equal(second.body.promotion.idempotent, true);
  assert.equal(second.body.promotion.approvedVersionId, first.body.promotion.approvedVersionId);
  assert.equal(second.body.promotion.version, 1);
  const current = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(current.version, 1);
  assert.equal(raw.prepare("SELECT count(*) n FROM drawing_architecture_approved_audit_events").get().n, 1, "no duplicate audit events");
  assert.equal(raw.prepare("SELECT count(*) n FROM drawing_architecture_approved_rows").get().n, 2, "no duplicate approved rows");
});

// ---------------------------------------------------------------------------
// T -- REAL Al Mousa integration through the real pipeline.
// ---------------------------------------------------------------------------
test("T: REAL Al Mousa -- AMS network + KGS + substation sheets, real governed T-00 legend rows", async () => {
  const { raw, db, run } = boot();
  // Real governed legend authority (T-00, drawn from the actual approved rows).
  seedArchDocument({
    raw, projectId: "proj-1", documentId: "doc-t00-real",
    drawingNumber: "2401232- PC- AMS- DR- T-00-ZZZ-002",
    sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS",
  });
  seedRealT00Legend({ raw, projectId: "proj-1", documentId: "doc-t00-real" });
  // Real evidence sheets (text + geometry extracted verbatim from the live DB).
  seedRealSheet({ raw, projectId: "proj-1", sheetKey: "AMS_NET", documentId: "doc-ams-net", intakeId: "intake-ams-net" });
  seedRealSheet({ raw, projectId: "proj-1", sheetKey: "KGS_005", documentId: "doc-kgs", intakeId: "intake-kgs" });
  seedRealSheet({ raw, projectId: "proj-1", sheetKey: "AMS_002", documentId: "doc-sub", intakeId: "intake-sub" });

  const init = await run(archInitializePath("proj-1"));
  assert.equal(init.status, 200);
  assert.ok(init.body.total >= 30, "real set must produce a substantial candidate inventory");
  assert.ok(init.body.documents >= 4);

  const decisions = await reviewDecisions({ run });
  const confirmedSet = new Set(decisions.outcomes.filter((o) => /CONFIRMED/.test(o.decision?.state)).map((o) => `${o.factType}|${o.subject}|${o.object ?? ""}`));

  // Campus-wide main panel, label, explicit location (network diagram).
  assert.ok(confirmedSet.has("PANEL_EXISTS|MFACP|"), "real MFACP existence confirms");
  assert.ok(confirmedSet.has("PANEL_LABEL|MFACP|MAIN FIRE ALARM CONTROL PANEL (M.F.A.C.P)"), "real MFACP label confirms");
  // External civil-defence signal on the network sheet + KGS.
  assert.ok([...confirmedSet].some((k) => k.startsWith("EXTERNAL_SYSTEM_INTERFACE|") && k.includes("CIVIL DEFENCE")), "real civil-defence interface confirms");
  // Campus network: building FACPs connected to the campus-wide MFACP via fiber.
  assert.ok([...confirmedSet].some((k) => k.startsWith("PANEL_NETWORK_LINK|BUILDING FACP") && k.includes("CAMPUS-WIDE MFACP")), "real campus fiber network link confirms");
  // Derived network topology (star, 6 buildings).
  assert.ok([...confirmedSet].some((k) => k.startsWith("FIRE_ALARM_NETWORK_TOPOLOGY|")), "real network topology (DERIVED) present");
  const topo = decisions.outcomes.find((o) => o.factType === "FIRE_ALARM_NETWORK_TOPOLOGY");
  assert.equal(topo.decision.state, ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING);
  assert.ok(topo.object.includes("BOYS SCHOOL") && topo.object.includes("DG STATION"), "topology aggregates the real building list");
  // Real building serve-area assignments.
  assert.ok(confirmedSet.has("PANEL_SERVES_AREA|FACP|BOYS SCHOOL"), "real FACP->BOYS SCHOOL assignment");
  assert.ok(confirmedSet.has("PANEL_SERVES_AREA|FACP|GIRLS SCHOOL"), "real FACP->GIRLS SCHOOL assignment");
  // KGS schematic loops + NAC circuit.
  for (const loop of ["LOOP-1", "LOOP-2", "LOOP-3", "LOOP-4", "LOOP-5", "LOOP-6"]) {
    assert.ok(confirmedSet.has(`SLC_LOOP_EXISTS|${loop}|`), `real ${loop} existence confirms`);
  }
  assert.ok(confirmedSet.has("NAC_CIRCUIT_EXISTS|NAC LOOP|"), "real NAC circuit confirms");
  // KGS interfaces (ACS / elevators / emergency lighting / IBMS / PA&VA / video surveillance).
  const interfaces = decisions.outcomes.filter((o) => o.factType === "INTERFACE_CONNECTED_TO_SYSTEM" && o.decision?.state === ARCHITECTURE_FACT_DECISION_STATES.CONFIRMED_ARCHITECTURE_FACT);
  assert.ok(interfaces.length >= 5, `real interface statements confirm (got ${interfaces.length})`);
  // KGS main panel located at its FCC room (derived).
  assert.ok([...confirmedSet].some((k) => k.startsWith("PANEL_SERVES_AREA|MFACP|FCC ROOM") || k.startsWith("PANEL_SERVES_AREA|MFACP|FIRE COMMAND CENTER")), "real MFACP room/FCC location");
  // Substation loops + network links toward the AMS campus.
  assert.ok(confirmedSet.has("SLC_LOOP_EXISTS|LOOP-1|"), "substation LOOP-1 confirms");
  // The REAL KGS cross-sheet note omits the -DR- segment vs the register
  // (2401232-PC-AMS-T-00-ZZZ-002 vs 2401232-PC-AMS-DR-T-00-ZZZ-002): under the
  // exact-match rule it must stay engineer-review + spawn a discrepancy.
  const refOutcome = decisions.outcomes.find((o) => o.factType === "CROSS_SHEET_REFERENCE");
  assert.ok(refOutcome, "real cross-sheet reference (KGS->T-00) recorded");
  assert.equal(refOutcome.decision.state, ARCHITECTURE_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.ok(refOutcome.decision.decisionReasons.includes("CROSS_SHEET_UNRESOLVED_TARGET"));
  const discRows = casesRows(raw, "proj-1").filter((r) => r.fact_type === "ARCHITECTURE_DISCREPANCY");
  assert.ok(discRows.length >= 1, "unresolved reference spawns a discrepancy record");
  // Nothing in the pipeline may reject an in-scope FA fact outright.
  assert.equal(decisions.counts.wouldReject, 0, "no FA fact is rejected");
  assert.ok(decisions.counts.wouldConfirm >= 25, `must confirm the real architecture set (got ${decisions.counts.wouldConfirm})`);

  // Governed promotion of the REAL set.
  const confirm = await run(archConfirmPath("proj-1"));
  assert.equal(confirm.status, 200);
  const approved = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(approved.version, 1);
  assert.ok(approved.approvedRows.length >= 25, "real confirmed rows promoted");
  const promotedSubjects = approved.approvedRows.map((r) => `${r.factType}|${r.subject}`);
  assert.ok(promotedSubjects.includes("PANEL_EXISTS|MFACP"));
  assert.ok(promotedSubjects.includes("FIRE_ALARM_NETWORK_TOPOLOGY|CAMPUS-WIDE FIRE ALARM NETWORK"));
  assert.ok(promotedSubjects.includes("SLC_LOOP_EXISTS|LOOP-6"));
});

// Small helper: find an outcome by fact type + subject + optional object match.
function decisionFor(decisions, factType, subject, object, objectLike = null) {
  return decisions.outcomes.find((o) => {
    if (o.factType !== factType || o.subject !== subject) return false;
    if (object !== null && o.object !== object) return false;
    if (objectLike && !objectLike.test(o.object ?? "")) return false;
    return true;
  })?.decision;
}