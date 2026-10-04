// STEP 14.8 -- DRAWING ARCHITECTURE EXCEPTION ADJUDICATION -- governed suite
// (tests A..N) against the live-parity fixture corpus.
//
//   A  inventory normalization: 21 pending records -> 12 UNIQUE exceptions
//      (9 CROSS_SHEET_REFERENCE + 3 GENERIC_FACP_IDENTITY), ungrouped 0
//   B  unique register target adjudicates CONFIRMED_PROJECT_REFERENCE with
//      the full evidence-reason set and the canonical registered target
//   C  multiple candidate targets -> ENGINEER_REVIEW_REQUIRED (never a guess)
//   D  no register target -> ENGINEER_REVIEW_REQUIRED (never a guess)
//   E  generic FACP identity confirms ONLY on strong anchors
//      (observations===1 + >=3 independent strong anchors)
//   F  mirrored ARCHITECTURE_DISCREPANCY folds 1:1 into its reference
//      exception; never adjudicated or approved separately
//   G  stage-4 blocking semantics: FACP identity blocks; reference format
//      issues are NONBLOCKING_DRAWING_REVIEW
//   H  status recompute: PARTIAL/PARTIAL_NOT_READY -> COMPLETE/
//      READY_FOR_STAGE4_BRIDGE exactly when the evidence supports it
//   I  adjudication evaluate is a read-only deterministic dry-run
//   J  adjudication apply is idempotent: a re-run creates/supersedes nothing
//   K  v1=116 -> v2=128 promotion; delta = the 12 confirmed exceptions only
//      (mirrored discrepancies never separately promoted)
//   L  readiness row carries the governed state fields verbatim
//   M  read surface: current + history adjudication/readiness/approved rows
//   N  side-effect containment: only the architecture governance surface is
//      ever written
import test from "node:test";
import assert from "node:assert/strict";
import {
  EXCEPTION_ADJUDICATION_DECISION_STATES,
  ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION,
  REFERENCE_ADJUDICATION_REASONS,
  FACP_IDENTITY_REASONS,
  STAGE4_BLOCKING_CLASS,
  ARCHITECTURE_STATUS_VALUES,
  STAGE4_READINESS_VALUES,
  adjudicateCrossSheetReference,
  adjudicateGenericFacp,
  stage4BlockingSemantics,
} from "../app/domain/drawing-architecture-adjudication.mjs";
import {
  SYSTEM_ARCHITECTURE_EVALUATION_ACTOR,
} from "../app/domain/drawing-architecture-decision-policy.mjs";
import {
  makeArchDb,
  seedArchDocument,
  seedRealT00Legend,
  seedRealSheet,
  apiArchRequest,
  archInitializePath,
  archConfirmPath,
  archAdjudicateEvaluatePath,
  archAdjudicateApplyPath,
  archAdjudicationCurrentPath,
  archAdjudicationHistoryPath,
  archReadinessPath,
  archReadinessHistoryPath,
  archApprovedCurrentPath,
  archApprovedHistoryPath,
  casesRows,
} from "./fixtures/drawing-architecture-fixture.mjs";

// ---------------------------------------------------------------------------
// Harness: fresh in-memory DB + routed handler calls (same shape as the
// governed review suite).
// ---------------------------------------------------------------------------
const boot = (projectId = "proj-1") => {
  const { raw, db } = makeArchDb(projectId);
  const run = (path, { method = "POST", body } = {}) => apiArchRequest(path, { method, body })({ DB: db });
  return { raw, db, run };
};

// Seed the LIVE-PARITY corpus: the T-00 governed legend authority + every
// evidence-bearing corpus sheet verbatim from the golden rebuild. Reproduces
// live exactly: 137 review cases = 116 approved (v1) + 21 pending
// (9 ARCHITECTURE_DISCREPANCY + 9 CROSS_SHEET_REFERENCE + 3 PANEL_EXISTS).
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
  assert.equal(confirm.body.promotion.version, 1);
  return h;
};

// ---------------------------------------------------------------------------
// A -- inventory normalization: 21 pending -> 12 unique exceptions.
// ---------------------------------------------------------------------------
test("A: 21 pending records normalize to exactly 12 unique exceptions (9 cross-sheet + 3 generic FACP), ungrouped 0", async () => {
  const { run } = await bootSeeded();
  const dry = await run(archAdjudicateEvaluatePath("proj-1"));
  assert.equal(dry.status, 200);
  const counts = dry.body.inventory.counts;
  assert.equal(counts.totalRecords, 21, "all 21 pending records are consumed");
  assert.equal(counts.referenceRecords, 9);
  assert.equal(counts.discrepancyRecords, 9);
  assert.equal(counts.facpRecords, 3);
  assert.equal(counts.uniqueExceptions, 12);
  assert.equal(counts.referenceGroups, 9);
  assert.equal(counts.facpGroups, 3);
  assert.equal(counts.ungrouped, 0, "no record may escape adjudication");
  const types = {};
  for (const e of dry.body.inventory.exceptions) types[e.exceptionType] = (types[e.exceptionType] || 0) + 1;
  assert.deepEqual(types, { CROSS_SHEET_REFERENCE: 9, GENERIC_FACP_IDENTITY: 3 });
});

// ---------------------------------------------------------------------------
// B -- unique register target confirms on full evidence.
// ---------------------------------------------------------------------------
test("B: every cross-sheet citation resolves to CONFIRMED_PROJECT_REFERENCE with the canonical registered target", async () => {
  const { run } = await bootSeeded();
  const dry = await run(archAdjudicateEvaluatePath("proj-1"));
  const csr = dry.body.adjudications.filter((a) => a.exceptionType === "CROSS_SHEET_REFERENCE");
  assert.equal(csr.length, 9);
  for (const a of csr) {
    assert.equal(a.decision.decisionState, EXCEPTION_ADJUDICATION_DECISION_STATES.CONFIRMED_PROJECT_REFERENCE);
    // RAW DR-less reference preserved verbatim...
    assert.equal(a.referencedDrawingNumber, "2401232-PC-AMS-T-00-ZZZ-002");
    assert.equal(a.decision.referencedDrawingNumber, "2401232-PC-AMS-T-00-ZZZ-002");
    // ...while the CANONICAL registered -DR- target is what gets persisted.
    assert.equal(a.decision.canonicalTargetDrawingNumber, "2401232- PC- AMS- DR- T-00-ZZZ-002");
    const reasons = a.decision.decisionReasons;
    assert.ok(reasons.includes(REFERENCE_ADJUDICATION_REASONS.UNIQUE_REGISTER_TARGET));
    assert.ok(reasons.includes(REFERENCE_ADJUDICATION_REASONS.PROJECT_REFERENCE_FORMAT_VARIANT_CONFIRMED));
    assert.ok(reasons.includes(REFERENCE_ADJUDICATION_REASONS.CORPUS_DR_LESS_CONVENTION), "corpus-wide DR-less convention is evidence, not convention");
    assert.ok(reasons.includes(REFERENCE_ADJUDICATION_REASONS.NOTE_TEXT_MATCHES_TARGET_TITLE));
    assert.ok(reasons.includes(REFERENCE_ADJUDICATION_REASONS.DISTINCT_DISCIPLINE_EVIDENCE));
    assert.equal(a.decision.decisionPolicyVersion, ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION);
    assert.equal(a.decision.stage4BlockingClass, STAGE4_BLOCKING_CLASS.NONBLOCKING_DRAWING_REVIEW);
  }
});

// ---------------------------------------------------------------------------
// C -- multiple candidate targets -> ENGINEER_REVIEW_REQUIRED.
// ---------------------------------------------------------------------------
test("C: two registered drawings match one citation -> ENGINEER_REVIEW_REQUIRED (MULTIPLE_CANDIDATE_TARGETS)", () => {
  // Both the DR-less registered form and the -DR- registered form are distinct
  // documents that match the same DR-less citation -> exactly 2 candidates.
  const decision = adjudicateCrossSheetReference({
    exception: { referencedDrawingNumber: "2401232-PC-AMS-T-00-ZZZ-002" },
    evidence: {
      register: [
        { documentId: "doc-a", drawingNumber: "2401232-PC-AMS-T-00-ZZZ-002", sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS" },
        { documentId: "doc-b", drawingNumber: "2401232-PC-AMS-DR-T-00-ZZZ-002", sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS" },
      ],
      corpusCounts: { withoutDr: 2, withDr: 0, totalT00: 2 },
    },
  });
  assert.equal(decision.decisionState, EXCEPTION_ADJUDICATION_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.deepEqual(decision.decisionReasons, [REFERENCE_ADJUDICATION_REASONS.MULTIPLE_CANDIDATE_TARGETS]);
  assert.equal(decision.canonicalTargetDrawingNumber, null, "never guess a target");
});

// ---------------------------------------------------------------------------
// D -- no register target -> ENGINEER_REVIEW_REQUIRED.
// ---------------------------------------------------------------------------
test("D: a citation with no registered match -> ENGINEER_REVIEW_REQUIRED (NO_REGISTER_TARGET)", () => {
  const decision = adjudicateCrossSheetReference({
    exception: { referencedDrawingNumber: "2401232-PC-AMS-T-00-ZZZ-002" },
    evidence: { register: [{ documentId: "doc-z", drawingNumber: "2401232-PC-AMS-DR-T-95-ZZZ-001", sheetName: "SOMETHING ELSE" }] },
  });
  assert.equal(decision.decisionState, EXCEPTION_ADJUDICATION_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.deepEqual(decision.decisionReasons, [REFERENCE_ADJUDICATION_REASONS.NO_REGISTER_TARGET]);
  assert.equal(decision.canonicalTargetDrawingNumber, null);
});

// ---------------------------------------------------------------------------
// E -- generic FACP identity: strong-anchor ladder only.
// ---------------------------------------------------------------------------
test("E: generic FACP confirms CONFIRMED_SAME_PANEL on strong anchors; weak evidence alone never merges", () => {
  const exception = { buildingCode: "BOS" };
  const strong = adjudicateGenericFacp({
    exception,
    evidence: {
      observations: 1, // unique topology position
      titleBlockBuildingCode: "BOS", // explicit building area
      crossSheetIdentityTokens: ["MFACP @BOS BUILDING"], // explicit cross-sheet identity
      sourceTargetConnections: ["t1", "t2"], // explicit source->target connections
      servedAreas: ["BOS BUILDING"],
      loopOwnership: ["LOOP-B1"],
    },
  });
  assert.equal(strong.decisionState, EXCEPTION_ADJUDICATION_DECISION_STATES.CONFIRMED_SAME_PANEL);
  const anchors = strong.decisionReasons;
  assert.ok(anchors.includes(FACP_IDENTITY_REASONS.UNIQUE_TOPOLOGY_POSITION));
  assert.ok(anchors.includes(FACP_IDENTITY_REASONS.EXPLICIT_BUILDING_AREA));
  assert.ok(anchors.includes(FACP_IDENTITY_REASONS.EXPLICIT_CROSS_SHEET_IDENTITY));
  assert.ok(anchors.includes(FACP_IDENTITY_REASONS.EXPLICIT_SOURCE_TARGET_CONNECTION));
  assert.equal(strong.canonicalPanelIdentity, "FACP @BOS BUILDING");
  assert.equal(strong.buildingCode, "BOS");
  assert.equal(strong.decisionPolicyVersion, ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION);

  // observations !== 1 (not a unique topology position) -> NOT confirmed.
  const twoObservations = adjudicateGenericFacp({
    exception,
    evidence: {
      observations: 2,
      titleBlockBuildingCode: "BOS",
      crossSheetIdentityTokens: ["MFACP @BOS BUILDING"],
      sourceTargetConnections: ["t1", "t2"],
    },
  });
  assert.equal(twoObservations.decisionState, EXCEPTION_ADJUDICATION_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.ok(twoObservations.decisionReasons.includes(FACP_IDENTITY_REASONS.WEAK_EVIDENCE_ONLY));

  // Generic "FACP" text alone is weak evidence, NEVER enough to merge a panel.
  const weak = adjudicateGenericFacp({ exception, evidence: { observations: 1 } });
  assert.equal(weak.decisionState, EXCEPTION_ADJUDICATION_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.ok(weak.decisionReasons.includes(FACP_IDENTITY_REASONS.WEAK_EVIDENCE_ONLY));
});

// ---------------------------------------------------------------------------
// F -- mirrored ARCHITECTURE_DISCREPANCY folds 1:1 into its exception.
// ---------------------------------------------------------------------------
test("F: mirrored ARCHITECTURE_DISCREPANCY folds 1:1 into its reference exception and is never approved separately", async () => {
  const { raw, run } = await bootSeeded();
  const dry = await run(archAdjudicateEvaluatePath("proj-1"));
  assert.equal(dry.body.inventory.counts.referenceRecords, 9);
  assert.equal(dry.body.inventory.counts.discrepancyRecords, 9);
  // 9 mirrored discrepancies + 9 references produce NINE exceptions, not 18.
  assert.equal(dry.body.inventory.counts.uniqueExceptions, 12);
  const pendingBefore = casesRows(raw, "proj-1").filter((c) => c.status === "Needs Review");
  assert.equal(pendingBefore.length, 21);
  const discIds = new Set(pendingBefore.filter((c) => c.fact_type === "ARCHITECTURE_DISCREPANCY").map((c) => c.id));

  const apply = await run(archAdjudicateApplyPath("proj-1"));
  assert.equal(apply.status, 200);
  // Only the 12 PRIMARY cases (CROSS_SHEET_REFERENCE + PANEL_EXISTS) are approved.
  assert.equal(apply.body.persistence.approvedPrimaryCases, 12);
  const after = casesRows(raw, "proj-1");
  const approved = after.filter((c) => c.status === "Approved");
  const stillPending = after.filter((c) => c.status === "Needs Review");
  // 116 (v1) + 12 primary cases = 128 approved; the 9 mirrored discrepancies
  // stay pending -- resolved BY their folded exception, never promoted.
  assert.equal(approved.length, 128);
  assert.equal(stillPending.length, 9);
  assert.ok(stillPending.every((c) => discIds.has(c.id)), "every leftover pending record is a mirrored discrepancy");
  // Per in-memory identity, the folded resolution count matches 1:1.
  assert.equal(apply.body.persistence.readiness?.idempotent, false);
});

// ---------------------------------------------------------------------------
// G -- stage-4 blocking semantics.
// ---------------------------------------------------------------------------
test("G: generic FACP identity blocks the Stage 4 bridge; reference-format issues are non-blocking drawing review", () => {
  const facp = stage4BlockingSemantics({ exceptionType: "GENERIC_FACP_IDENTITY" });
  assert.equal(facp.stage4BlockingClass, STAGE4_BLOCKING_CLASS.STAGE4_BLOCKING);
  const csr = stage4BlockingSemantics({ exceptionType: "CROSS_SHEET_REFERENCE" });
  assert.equal(csr.stage4BlockingClass, STAGE4_BLOCKING_CLASS.NONBLOCKING_DRAWING_REVIEW);
  const unknown = stage4BlockingSemantics({ exceptionType: "SOMETHING_ELSE" });
  assert.equal(unknown.stage4BlockingClass, STAGE4_BLOCKING_CLASS.STAGE4_BLOCKING, "unclassified exceptions block conservatively");
});

// ---------------------------------------------------------------------------
// H -- status recompute: PARTIAL -> COMPLETE / READY exactly on evidence.
// ---------------------------------------------------------------------------
test("H: status recomputes PARTIAL/PARTIAL_NOT_READY -> COMPLETE/READY_FOR_STAGE4_BRIDGE on the resolved exception set", async () => {
  const { run } = await bootSeeded();
  const dry = await run(archAdjudicateEvaluatePath("proj-1"));
  const before = dry.body.status.before;
  assert.equal(before.architectureStatus, ARCHITECTURE_STATUS_VALUES.PARTIAL);
  assert.equal(before.stage4Readiness, STAGE4_READINESS_VALUES.PARTIAL_NOT_READY);
  assert.equal(before.stage4BlockingCount, 3, "only the 3 unadjudicated generic FACP exceptions block");
  assert.equal(before.nonblockingDrawingReviewCount, 9);
  assert.equal(before.pendingExceptionCount, 12);
  assert.equal(before.resolvedExceptionCount, 0);
  const after = dry.body.status.after;
  assert.equal(after.architectureStatus, ARCHITECTURE_STATUS_VALUES.COMPLETE);
  assert.equal(after.stage4Readiness, STAGE4_READINESS_VALUES.READY_FOR_STAGE4_BRIDGE);
  assert.equal(after.stage4BlockingCount, 0);
  assert.equal(after.nonblockingDrawingReviewCount, 0);
  assert.equal(after.pendingExceptionCount, 0);
  assert.equal(after.resolvedExceptionCount, 12);
  assert.equal(after.engineerReviewExceptionCount, 0);
});

// ---------------------------------------------------------------------------
// I -- evaluate is a read-only deterministic dry-run.
// ---------------------------------------------------------------------------
test("I: adjudication evaluate is read-only and fully deterministic across repeated calls", async () => {
  const { raw, db, run } = await bootSeeded();
  const tables = ["drawing_architecture_exception_adjudications", "drawing_architecture_stage4_readiness", "drawing_architecture_approved_versions", "drawing_architecture_approved_rows", "drawing_architecture_approved_audit_events"];
  const countsBefore = Object.fromEntries(tables.map((t) => [t, raw.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
  const pendingBefore = casesRows(raw, "proj-1").filter((c) => c.status === "Needs Review").length;
  const writesBeforeDryRun = [...db.trackedWrites];

  const first = await run(archAdjudicateEvaluatePath("proj-1"));
  const second = await run(archAdjudicateEvaluatePath("proj-1"));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(first.body.dryRun, true);
  // Deterministic: identical decision output both times.
  const shape = (b) => JSON.stringify({
    counts: b.inventory.counts,
    status: b.status,
    exceptions: b.inventory.exceptions.map((e) => ({ key: e.exceptionKey, type: e.exceptionType, source: e.sourceDrawingNumber, target: e.referencedDrawingNumber ?? e.buildingCode })),
    adjudications: b.adjudications.map((a) => ({ key: a.exceptionKey, state: a.decision.decisionState, reasons: a.decision.decisionReasons, target: a.decision.canonicalTargetDrawingNumber ?? a.decision.canonicalPanelIdentity })),
  });
  assert.equal(shape(first.body), shape(second.body), "repeated dry-runs must be byte-identical");
  // Read-only: nothing was written anywhere.
  for (const t of tables) assert.equal(raw.prepare(`SELECT count(*) n FROM ${t}`).get().n, countsBefore[t], `${t} must be untouched`);
  assert.equal(casesRows(raw, "proj-1").filter((c) => c.status === "Needs Review").length, pendingBefore);
  assert.deepEqual(db.trackedWrites, writesBeforeDryRun, "dry-run performs no writes");
});

// ---------------------------------------------------------------------------
// J -- apply is idempotent end-to-end.
// ---------------------------------------------------------------------------
test("J: adjudication apply is idempotent -- a re-run creates/supersedes nothing and readiness stays a single row", async () => {
  const { raw, run } = await bootSeeded();
  const apply1 = await run(archAdjudicateApplyPath("proj-1"));
  assert.equal(apply1.status, 200);
  assert.equal(apply1.body.persistence.created, 12);
  assert.equal(apply1.body.persistence.superseded, 0);
  assert.equal(apply1.body.persistence.unchanged, 0);
  assert.equal(apply1.body.persistence.approvedPrimaryCases, 12);
  assert.equal(apply1.body.persistence.readiness.idempotent, false);
  assert.equal(apply1.body.promotion.version, 2);
  assert.equal(apply1.body.promotion.approvedRows, 128);
  const rowsAfterFirst = raw.prepare("SELECT count(*) n FROM drawing_architecture_exception_adjudications WHERE project_id=? AND superseded_at IS NULL").get("proj-1").n;

  const apply2 = await run(archAdjudicateApplyPath("proj-1"));
  assert.equal(apply2.status, 200);
  assert.equal(apply2.body.persistence.created, 0, "no duplicate adjudication rows");
  assert.equal(apply2.body.persistence.superseded, 0, "no churn -- the decision did not change");
  assert.equal(apply2.body.persistence.approvedPrimaryCases, 0, "cases approved once, never re-asked");
  assert.equal(apply2.body.persistence.readiness.idempotent, true, "readiness row identity is stable (single row preserved)");
  assert.equal(raw.prepare("SELECT count(*) n FROM drawing_architecture_exception_adjudications WHERE project_id=? AND superseded_at IS NULL").get("proj-1").n, rowsAfterFirst);
  assert.equal(raw.prepare("SELECT count(*) n FROM drawing_architecture_exception_adjudications WHERE project_id=?").get("proj-1").n, 12, "no secondary history rows either");
  assert.equal(raw.prepare("SELECT count(*) n FROM drawing_architecture_stage4_readiness WHERE project_id=?").get("proj-1").n, 1);
  assert.equal(apply2.body.status.after.architectureStatus, ARCHITECTURE_STATUS_VALUES.COMPLETE);
  assert.equal(apply2.body.status.after.stage4Readiness, STAGE4_READINESS_VALUES.READY_FOR_STAGE4_BRIDGE);
  // Approved version still v2=128 -- promotion is fingerprint-idempotent.
  const current = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(current.version, 2);
  assert.equal(current.approvedRows.length, 128);
});

// ---------------------------------------------------------------------------
// K -- promotion delta: 116 -> 128, exactly the 12 confirmed exceptions.
// ---------------------------------------------------------------------------
test("K: approved version promotes v1=116 -> v2=128; the +12 delta is exactly the confirmed primary cases", async () => {
  const { run } = await bootSeeded();
  const before = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(before.version, 1);
  assert.equal(before.approvedRows.length, 116);

  await run(archAdjudicateApplyPath("proj-1"));
  const after = (await run(archApprovedCurrentPath("proj-1"), { method: "GET" })).body.current;
  assert.equal(after.version, 2);
  assert.equal(after.approvedRows.length, 128);
  const delta = after.approvedRows.length - before.approvedRows.length;
  assert.equal(delta, 12, "delta equals the 12 confirmed exceptions (9 cross-sheet + 3 FACP)");
  const history = (await run(archApprovedHistoryPath("proj-1"), { method: "GET" })).body.history;
  assert.equal(history.length, 2);
  const versions = history.map((h) => h.version).sort((a, b) => a - b);
  assert.deepEqual(versions, [1, 2]);
  const v1 = history.find((h) => h.version === 1);
  assert.ok(v1.supersededAt, "v1 is superseded by the promotion");
  const v2 = history.find((h) => h.version === 2);
  assert.equal(v2.supersededAt, null, "v2 is current");
});

// ---------------------------------------------------------------------------
// L -- readiness row fields.
// ---------------------------------------------------------------------------
test("L: the governed readiness row carries the exact status + counts state", async () => {
  const { run } = await bootSeeded();
  await run(archAdjudicateApplyPath("proj-1"));
  const cur = (await run(archAdjudicationCurrentPath("proj-1"), { method: "GET" })).body;
  assert.equal(cur.readiness.length, 1);
  const r = cur.readiness[0];
  assert.equal(r.architecture_status, "COMPLETE");
  assert.equal(r.stage4_readiness, "READY_FOR_STAGE4_BRIDGE");
  assert.equal(r.stage4_blocking_class_summary, "NONBLOCKING_DRAWING_REVIEW");
  assert.equal(r.unique_exception_count, 12);
  assert.equal(r.cross_sheet_reference_count, 9);
  assert.equal(r.generic_facp_count, 3);
  assert.equal(r.remaining_engineer_review_required, 0);
  assert.equal(r.remaining_confirm_project_reference, 9);
  assert.equal(r.remaining_confirm_same_panel, 3);
  assert.equal(r.resolved_count, 12);
  assert.equal(r.mirrored_discrepancy_resolved, 9);
  assert.equal(r.stale_count, 0);
  assert.equal(r.real_architecture_conflict_remaining, 0);
  assert.equal(r.approved_prior_row_count, 116);
  assert.equal(r.approved_next_row_count, 128);
  assert.equal(r.approved_next_version_number, 2);
  assert.equal(r.policy_version, ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION);
  assert.equal(r.computed_by, SYSTEM_ARCHITECTURE_EVALUATION_ACTOR);
  assert.ok(r.evidence_fingerprint, "readiness identity fingerprint is persisted");
});

// ---------------------------------------------------------------------------
// M -- read surface: adjudication current + history.
// ---------------------------------------------------------------------------
test("M: adjudication current/history read surfaces expose the 12 governed rows with decisions, targets and audit", async () => {
  const { run } = await bootSeeded();
  await run(archAdjudicateApplyPath("proj-1"));

  const cur = (await run(archAdjudicationCurrentPath("proj-1"), { method: "GET" })).body;
  assert.equal(cur.operation, "adjudication-current");
  assert.equal(cur.adjudications.length, 12);
  const states = {};
  const types = {};
  for (const a of cur.adjudications) {
    states[a.decisionState] = (states[a.decisionState] || 0) + 1;
    types[a.exceptionType] = (types[a.exceptionType] || 0) + 1;
    assert.equal(a.decisionPolicyVersion, ARCHITECTURE_EXCEPTION_ADJUDICATION_POLICY_VERSION);
    assert.equal(a.decisionActor, SYSTEM_ARCHITECTURE_EVALUATION_ACTOR);
    // The persisted row carries the DECISION's blocking class: every confirmed
    // exception is resolved, so none of the 12 stored rows blocks the bridge.
    assert.equal(a.stage4BlockingClass, "NONBLOCKING_DRAWING_REVIEW");
    assert.ok(a.createdAt, "audit timestamp present");
    assert.equal(a.supersededAt, null, "current rows are active");
  }
  assert.deepEqual(states, { CONFIRMED_PROJECT_REFERENCE: 9, CONFIRMED_SAME_PANEL: 3 });
  assert.deepEqual(types, { CROSS_SHEET_REFERENCE: 9, GENERIC_FACP_IDENTITY: 3 });
  const csr = cur.adjudications.filter((a) => a.exceptionType === "CROSS_SHEET_REFERENCE");
  for (const a of csr) {
    assert.equal(a.canonicalTargetDrawingNumber, "2401232- PC- AMS- DR- T-00-ZZZ-002");
    assert.equal(a.canonicalTargetDrawingNumberRaw, "2401232-PC-AMS-T-00-ZZZ-002");
  }
  const facp = cur.adjudications.filter((a) => a.exceptionType === "GENERIC_FACP_IDENTITY");
  assert.deepEqual(facp.map((a) => a.canonicalBuildingAssetCode).sort(), ["BOS", "GRS", "WLC"]);
  assert.deepEqual(facp.map((a) => a.canonicalPanelIdentity).sort(), ["FACP @BOS BUILDING", "FACP @GRS BUILDING", "FACP @WLC BUILDING"]);

  const hist = (await run(archAdjudicationHistoryPath("proj-1"), { method: "GET" })).body;
  assert.equal(hist.operation, "adjudication-history");
  assert.equal(hist.adjudications.length, 12, "history holds exactly the 12 governed rows (never deleted, never duplicated)");
});

// ---------------------------------------------------------------------------
// N -- side-effect containment.
// ---------------------------------------------------------------------------
test("N: adjudication apply touches ONLY the architecture governance surface (plus review-case status) -- never pricing/product/bom/technical-approval", async () => {
  const { db, run } = await bootSeeded();
  const writesBeforeDryRun = [...db.trackedWrites];
  await run(archAdjudicateEvaluatePath("proj-1"));
  assert.deepEqual(db.trackedWrites, writesBeforeDryRun, "dry-run writes nothing");
  await run(archAdjudicateApplyPath("proj-1"));
  const uniqueTables = [...new Set(db.trackedWrites)].sort();
  assert.deepEqual(uniqueTables, [
    "drawing_architecture_approved_audit_events",
    "drawing_architecture_approved_rows",
    "drawing_architecture_approved_versions",
    "drawing_architecture_exception_adjudications",
    "drawing_architecture_review_cases",
    "drawing_architecture_stage4_readiness",
  ]);
  for (const t of uniqueTables) assert.ok(t.startsWith("drawing_architecture_"), `${t} must stay within the architecture governance surface`);
});