// Drawing Fact Decision Authority + Canonical Promotion -- governed suite
// for Step 14.6. Covers:
//   A  current exact deterministic legend interpretation -> CONFIRMED_DRAWING_FACT
//   B  same exact interpretation with a warning -> CONFIRMED_WITH_WARNING (confirmable)
//   C  multiple viable proposal candidates -> ENGINEER_REVIEW_REQUIRED
//   D  NO_MATCH rows -> never auto-confirm
//   E  cross-system proposal claim -> REJECTED_INTERPRETATION (never confirmed)
//   F  replaced/superseded/processing structure -> STALE
//   G  changed document version -> STALE
//   H  changed/superseded/uncompleted intake -> STALE
//   I  proposal-evidence fingerprint mismatch -> STALE
//   J  missing fragment/initialization provenance -> engineer review
//   K  null-abbreviation native-symbol row WITH deterministic vector identity -> can confirm
//   L  null-abbreviation row with ambiguous identity -> engineer review
//   M  human-approved case -> never overwritten by the system
//   N  human-rejected case -> never overwritten by the system
//   O/P/Q confirmed fact -> drawing taught facts ONLY (no technical/product/commercial action)
//   R  repeated governed confirmation -> idempotent, no duplicate canonical facts
//   S  new structure version -> old current fact STALE + approval superseded
//   T  Fire Alarm vs PA/VA isolation incl. cross-system proposal never binding
//   U  T-00 real fixture: 20 FA confirmed (16 explicit + 4 vector-derived), 4 PA/VA isolated
//   V  every promoted fact retains complete provenance
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseDrawingStructure } from "../app/domain/drawing-structural-parser.mjs";
import { persist } from "../worker/drawing-structural-parser-api.mjs";
import {
  DRAWING_FACT_DECISION_STATES,
  DRAWING_FACT_DECISION_POLICY_VERSION,
  SYSTEM_DRAWING_EVALUATION_ACTOR,
  DRAWING_FACT_EVIDENCE_KINDS,
  DRAWING_FACT_HARMLESS_WARNINGS,
  decideDrawingFact,
  isAutoConfirmEligible,
} from "../app/domain/drawing-fact-decision-policy.mjs";
import { T00_LEGEND_DEFINITION_PROPOSALS } from "./golden/t00-review-proposals.fixture.mjs";
import {
  makeDb, seedCanonicalFixture, seedVersion, seedChildrenFromResult, seedPages, seedProposals,
  apiRequest, casesView, snapshotOf,
  buildReviewResult, proposalsForResult,
  initializePath, evaluatePath, deterministicConfirmPath, publishPath, approvedCurrentPath,
  confirmCasePath, rejectCasePath,
  now, sha256hex, DEV_ID,
} from "./fixtures/drawing-review-fixture.mjs";

const FP = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const FA_SECTION = "FIRE ALARM SYSTEM";
const PA_SECTION = "PUBLIC ADDRESS AND VOICE ALARM SYSTEM";

const exactCandidate = (overrides = {}) => ({
  proposalId: "proposal-fa-1",
  classification: "EXACT_JOIN",
  descriptionAgreement: true,
  labelAgreement: true,
  metrics: {
    row: { containment: 0.95, intersectionArea: 2000 },
    symbol: { containment: 0.85, intersectionArea: 120 },
    descriptionAgreement: true,
    labelAgreement: true,
  },
  ...overrides,
});

const baseInput = (overrides = {}) => {
  const snapshot = {
    initializationProvenance: { proposalEvidenceFingerprint: FP, documentVersionId: "ver-1", structureOutputFingerprint: "OUT_v3" },
    sourceFragmentIds: ["frag-1", "frag-2"],
    cells: [{ original_fragments: [{ id: "frag-1" }] }],
    abbreviation: "S1",
    description: "FIRE ALARM SYSTEM DEVICE 1",
    notes: null,
    symbolGeometry: [],
    attributionState: "ATTRIBUTED",
    symbolRepresentation: "TEXT_CODE",
    joinClassification: "EXACT_JOIN",
    proposalCandidateCount: 1,
    proposalCandidates: [exactCandidate()],
    validationIssues: [],
    sourcePage: 1,
    sourceRow: 1,
  };
  const legendRow = {
    id: "legend-1", section: FA_SECTION, tableKey: "ft",
    abbreviation: "S1", description: "FIRE ALARM SYSTEM DEVICE 1", notes: null,
    symbolGeometry: [], sourceFragmentIds: ["frag-1", "frag-2"],
    boundingBox: { x: 560, y: 200, width: 300, height: 130 },
  };
  return {
    structure: { id: "v3", documentVersionId: "ver-1", intakeVersionId: "intake-1", status: "Completed", supersededAt: null, outputFingerprint: "OUT_v3" },
    currentStructureId: "v3",
    documentCurrentVersionId: "ver-1",
    intake: { id: "intake-1", status: "Completed", supersededAt: null },
    snapshot,
    legendRow,
    joinRow: { rowId: "legend-1", tableId: "ft", classification: "EXACT_JOIN", candidates: [exactCandidate()], duplicateProposalCandidates: false },
    evidenceFingerprint: FP,
    proposalSectionById: { "proposal-fa-1": FA_SECTION },
    ...overrides,
  };
};

const setup = ({ fa = 3, pa = 2, title = 0, documentId = "doc-1", projectId = "proj-1" } = {}) => {
  const { raw, db } = makeDb(documentId, projectId, { track: true });
  const result = buildReviewResult({ fa, pa, title });
  return { raw, db, result };
};

const seedAndInitialize = async ({ raw, db, result, documentId = "doc-1" }) => {
  seedCanonicalFixture({ raw, db, result });
  const run = await apiRequest(initializePath(documentId), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 200);
  return run;
};

// ---------------------------------------------------------------------------
// Policy unit tests (A-L): pure decision ladder.
// ---------------------------------------------------------------------------
test("A: current exact deterministic legend interpretation confirms as a drawing fact", () => {
  const decision = decideDrawingFact(baseInput());
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.CONFIRMED_DRAWING_FACT);
  assert.equal(decision.eligible, true);
  assert.equal(isAutoConfirmEligible(decision), true);
  assert.equal(decision.candidateProposalId, "proposal-fa-1");
  assert.equal(decision.candidateCount, 1);
  assert.equal(decision.evidenceKind, DRAWING_FACT_EVIDENCE_KINDS.EXPLICIT);
  assert.equal(decision.decisionPolicyVersion, DRAWING_FACT_DECISION_POLICY_VERSION);
  for (const reason of ["STRUCTURE_CURRENT", "DOCUMENT_VERSION_CURRENT", "INTAKE_CURRENT", "EVIDENCE_FINGERPRINT_MATCH", "SINGLE_EXACT_CANDIDATE", "PROVENANCE_COMPLETE", "SYSTEM_IDENTITY_RESOLVED", "SYMBOL_CODE_PRESENT"]) {
    assert.ok(decision.decisionReasons.includes(reason), `missing reason ${reason}`);
  }
  assert.deepEqual(decision.warnings, []);
});

test("B: same exact interpretation carrying a warning is CONFIRMED_WITH_WARNING and still confirmable", () => {
  const input = baseInput();
  input.snapshot.abbreviation = null;
  input.snapshot.symbolRepresentation = "VECTOR_GEOMETRY";
  input.snapshot.symbolGeometry = [{ id: "shape-1", type: "polyline", points: [] }];
  input.legendRow.abbreviation = null;
  input.legendRow.symbolGeometry = input.snapshot.symbolGeometry;
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING);
  assert.equal(decision.eligible, true);
  assert.equal(isAutoConfirmEligible(decision), true);
  assert.deepEqual(decision.warnings, [DRAWING_FACT_HARMLESS_WARNINGS.NATIVE_SYMBOL_EMPTY_ABBREVIATION]);
  assert.equal(decision.evidenceKind, DRAWING_FACT_EVIDENCE_KINDS.DERIVED);
  assert.ok(decision.decisionReasons.includes("SYMBOL_VECTOR_IDENTITY_DETERMINISTIC"));
});

test("C: multiple viable proposal candidates route to engineer review", () => {
  const input = baseInput();
  const second = exactCandidate({ proposalId: "proposal-fa-1b" });
  input.snapshot.proposalCandidates = [exactCandidate(), second];
  input.snapshot.proposalCandidateCount = 2;
  input.snapshot.duplicateProposalEvidence = true;
  input.joinRow.candidates = [exactCandidate(), second];
  input.joinRow.duplicateProposalCandidates = true;
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.equal(decision.eligible, false);
  assert.equal(isAutoConfirmEligible(decision), false);
  assert.ok(decision.decisionReasons.includes("MULTIPLE_PROPOSAL_CANDIDATES"));
  assert.ok(decision.decisionReasons.includes("UNRESOLVED_DUPLICATE_CANDIDATES"));
});

test("D: NO_MATCH rows never auto-confirm and route to engineer review", () => {
  const input = baseInput();
  input.joinRow.candidates = [];
  input.joinRow.classification = "NO_MATCH";
  input.snapshot.proposalCandidates = [];
  input.snapshot.proposalCandidateCount = 0;
  input.snapshot.joinClassification = "NO_MATCH";
  input.snapshot.attributionState = "PARTIALLY_ATTRIBUTED";
  input.snapshot.attributionWarnings = ["NO_DETERMINISTIC_PROPOSAL_ATTRIBUTION"];
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.equal(decision.eligible, false);
  assert.ok(decision.decisionReasons.includes("NO_DETERMINISTIC_CANDIDATE"));
  assert.equal(decision.candidateProposalId, null);
});

test("E: a cross-system proposal claim is NEVER confirmed", () => {
  const input = baseInput({ proposalSectionById: { "proposal-fa-1": PA_SECTION } });
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.REJECTED_INTERPRETATION);
  assert.equal(decision.eligible, false);
  assert.ok(decision.decisionReasons.includes("CROSS_SYSTEM_MATCH"));
});

test("F: a replaced, superseded or processing structure is STALE", () => {
  const replaced = decideDrawingFact(baseInput({ currentStructureId: "v4" }));
  assert.equal(replaced.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.deepEqual(replaced.decisionReasons, ["STRUCTURE_NOT_CURRENT"]);
  assert.equal(replaced.eligible, false);

  const superseded = baseInput();
  superseded.structure.supersededAt = now();
  const supersededDecision = decideDrawingFact(superseded);
  assert.equal(supersededDecision.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.deepEqual(supersededDecision.decisionReasons, ["STRUCTURE_SUPERSEDED"]);

  const processing = baseInput();
  processing.structure.status = "Processing";
  const processingDecision = decideDrawingFact(processing);
  assert.equal(processingDecision.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.deepEqual(processingDecision.decisionReasons, ["STRUCTURE_NOT_COMPLETED"]);
});

test("G: a changed document version is STALE", () => {
  const input = baseInput({ documentCurrentVersionId: "ver-2" });
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.deepEqual(decision.decisionReasons, ["DOCUMENT_VERSION_CHANGED"]);
});

test("H: a changed, superseded or uncompleted intake is STALE", () => {
  const changed = decideDrawingFact(baseInput({ intake: { id: "intake-2", status: "Completed", supersededAt: null } }));
  assert.equal(changed.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.deepEqual(changed.decisionReasons, ["INTAKE_VERSION_CHANGED"]);

  const superseded = baseInput();
  superseded.intake.supersededAt = now();
  const supersededDecision = decideDrawingFact(superseded);
  assert.equal(supersededDecision.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.deepEqual(supersededDecision.decisionReasons, ["INTAKE_SUPERSEDED"]);

  const uncompleted = baseInput();
  uncompleted.intake.status = "Processing";
  const uncompletedDecision = decideDrawingFact(uncompleted);
  assert.equal(uncompletedDecision.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.deepEqual(uncompletedDecision.decisionReasons, ["INTAKE_NOT_COMPLETED"]);
});

test("I: a proposal-evidence fingerprint mismatch is STALE and never confirmable", () => {
  const input = baseInput({ evidenceFingerprint: "b".repeat(64) });
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.deepEqual(decision.decisionReasons, ["PROPOSAL_EVIDENCE_CHANGED"]);
  assert.equal(decision.eligible, false);
});

test("J: missing fragment + initialization provenance routes to engineer review", () => {
  const input = baseInput();
  input.snapshot.sourceFragmentIds = [];
  input.snapshot.cells = [];
  input.legendRow.sourceFragmentIds = [];
  input.snapshot.initializationProvenance = null;
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.ok(decision.decisionReasons.includes("MISSING_FRAGMENT_PROVENANCE"));
  assert.ok(decision.decisionReasons.includes("MISSING_INITIALIZATION_PROVENANCE"));
  assert.equal(decision.eligible, false);
});

test("K: a null-abbreviation native-symbol row can confirm when vector identity is deterministic", () => {
  const input = baseInput();
  input.snapshot.abbreviation = null;
  input.snapshot.symbolRepresentation = "VECTOR_GEOMETRY";
  input.snapshot.symbolGeometry = [{ id: "shape-1", type: "polyline", points: [] }, { id: "shape-2", type: "polyline", points: [] }];
  input.legendRow.abbreviation = null;
  input.legendRow.symbolGeometry = input.snapshot.symbolGeometry;
  input.snapshot.description = "FIRE ALARM SYSTEM DEVICE 1";
  input.legendRow.description = "FIRE ALARM SYSTEM DEVICE 1";
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING);
  assert.equal(decision.eligible, true);
  assert.equal(isAutoConfirmEligible(decision), true);
  assert.equal(decision.candidateProposalId, "proposal-fa-1");
  assert.equal(decision.evidenceKind, DRAWING_FACT_EVIDENCE_KINDS.DERIVED);
});

test("L: a null-abbreviation row with ambiguous identity cannot confirm", () => {
  const input = baseInput();
  input.snapshot.abbreviation = null;
  input.snapshot.symbolGeometry = [];
  input.snapshot.symbolRepresentation = "NONE";
  input.legendRow.abbreviation = null;
  input.legendRow.symbolGeometry = [];
  const decision = decideDrawingFact(input);
  assert.equal(decision.state, DRAWING_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
  assert.ok(decision.decisionReasons.includes("NATIVE_SYMBOL_AMBIGUOUS_IDENTITY"));
  assert.equal(decision.eligible, false);
});

// ---------------------------------------------------------------------------
// Worker integration tests (M-V): governed mutation + promotion.
// ---------------------------------------------------------------------------
test("M: a human-approved case is never overwritten by the system evaluator", async () => {
  const { raw, db, result } = setup({ fa: 2, pa: 1, title: 0 });
  await seedAndInitialize({ raw, db, result });
  const cases = casesView(raw);
  assert.equal(cases.length, 3);
  for (const row of cases) {
    const confirm = await apiRequest(confirmCasePath(row.id), { method: "POST", body: { reason: "Engineer visually verified this legend row against the drawing and confirmed the interpretation" } })({ DB: db });
    assert.equal(confirm.status, 200);
  }
  const before = casesView(raw).map(row => ({ id: row.id, status: row.status, reviewed_by: row.reviewed_by, reason: row.review_reason, version: row.case_version }));
  const run = await apiRequest(deterministicConfirmPath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 200);
  assert.equal(run.body.counts.wouldConfirm, 0);
  assert.equal(run.body.counts.humanProtected, 3);
  assert.equal(run.body.promotion, null);
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_review_events WHERE action='SYSTEM_DETERMINISTIC_CONFIRMATION'").get().count, 0, "the system never re-decides a human decision");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_versions").get().count, 0, "no promotion is manufactured from human decisions");
  const after = casesView(raw).map(row => ({ id: row.id, status: row.status, reviewed_by: row.reviewed_by, reason: row.review_reason, version: row.case_version }));
  assert.deepEqual(after, before);
});

test("N: a human-rejected case is never overwritten by the system evaluator", async () => {
  const { raw, db, result } = setup({ fa: 2, pa: 1, title: 0 });
  await seedAndInitialize({ raw, db, result });
  for (const row of casesView(raw)) {
    const reject = await apiRequest(rejectCasePath(row.id), { method: "POST", body: { reason: "Engineer rejected this legend interpretation as not established by the drawing" } })({ DB: db });
    assert.equal(reject.status, 200);
  }
  const run = await apiRequest(deterministicConfirmPath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 200);
  assert.equal(run.body.counts.wouldConfirm, 0);
  assert.equal(run.body.counts.humanProtected, 3);
  assert.equal(run.body.promotion, null);
  const rows = casesView(raw);
  assert.ok(rows.every(row => row.status === "Rejected" && row.reviewed_by === DEV_ID));
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_review_events WHERE action='SYSTEM_DETERMINISTIC_CONFIRMATION'").get().count, 0, "the system never writes decision events over a human rejection");
});

test("O/P/Q: a confirmed fact creates taught drawing rows ONLY -- no technical, product or commercial action anywhere", async () => {
  const { raw, db, result } = setup({ fa: 3, pa: 2, title: 0 });
  await seedAndInitialize({ raw, db, result });

  const eventsBefore = raw.prepare("SELECT count(*) count FROM drawing_structure_review_events").get().count;
  const dry = await apiRequest(evaluatePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dryRun, true);
  assert.equal(dry.body.counts.wouldConfirm, 3);
  assert.equal(dry.body.counts.wouldRequireEngineer, 2);
  assert.equal(dry.body.promotion, null);
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_review_events").get().count, eventsBefore, "dry-run writes nothing");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_versions").get().count, 0);

  const run = await apiRequest(deterministicConfirmPath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.status, 200);
  assert.equal(run.body.counts.wouldConfirm, 3);
  assert.equal(run.body.counts.wouldRequireEngineer, 2);
  assert.equal(run.body.counts.wouldReject, 0);
  assert.equal(run.body.counts.stale, 0);
  assert.equal(run.body.counts.alreadyConfirmed, 0);
  assert.equal(run.body.counts.humanProtected, 0);
  assert.ok(run.body.promotion);
  assert.equal(run.body.promotion.idempotent, false);
  assert.equal(run.body.promotion.approvedRows, 3, "only the three deterministic Fire Alarm facts are promoted");
  assert.equal(run.body.promotion.excludedRows, 2, "the two PA/VA rows stay excluded");

  const writeTables = [...db.trackedWrites].sort();
  assert.deepEqual(writeTables, ["drawing_structure_approved_audit_events", "drawing_structure_approved_rows", "drawing_structure_approved_versions", "drawing_structure_review_cases", "drawing_structure_review_events"], "reviews + approved drawing rows only -- no other artifacts");

  // O: no Technical Approval artifact, P: no product conclusion, Q: no pricing/commercial action
  const proposals = raw.prepare("SELECT * FROM drawing_extraction_proposals ORDER BY id").all();
  assert.ok(proposals.length >= 3);
  assert.ok(proposals.every(p => p.review_status === "Needs Review" && p.reviewed_by === null && p.corrected_value === null && p.governed_status === "Needs Review" && p.superseded_at === null), "proposal rows never carry an approval side-effect");

  const remaining = casesView(raw).filter(row => row.status === "Needs Review");
  assert.equal(remaining.length, 2);
  assert.ok(remaining.every(row => row.section_title === PA_SECTION));
});

test("R: repeating the governed confirmation is idempotent and never duplicates canonical facts", async () => {
  const { raw, db, result } = setup();
  await seedAndInitialize({ raw, db, result });

  const one = await apiRequest(deterministicConfirmPath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(one.status, 200);
  assert.equal(one.body.counts.wouldConfirm, 3);
  assert.equal(one.body.promotion.idempotent, false);
  assert.equal(one.body.promotion.approvedRows, 3);
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_versions").get().count, 1);
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_rows").get().count, 3);

  const two = await apiRequest(deterministicConfirmPath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(two.status, 200);
  assert.equal(two.body.counts.wouldConfirm, 0, "no new facts to confirm on the second pass");
  assert.equal(two.body.counts.alreadyConfirmed, 3);
  assert.equal(two.body.promotion.idempotent, true);
  assert.equal(two.body.promotion.approvedVersionId, one.body.promotion.approvedVersionId);
  assert.equal(two.body.promotion.approvedRows, 3);
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_versions").get().count, 1, "no duplicate canonical version");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_rows").get().count, 3, "no duplicate approved rows");
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_review_events WHERE action='SYSTEM_DETERMINISTIC_CONFIRMATION'").get().count, 3, "one decision event per fact, never re-fired");
});

test("S: a new structure version makes the old current drawing fact STALE and supersedes its approval", async () => {
  const { raw, db, result } = setup();
  await seedAndInitialize({ raw, db, result });
  const one = await apiRequest(deterministicConfirmPath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(one.body.promotion.version, 1);
  const v1 = raw.prepare("SELECT * FROM drawing_structure_approved_versions WHERE version_number=1").get();
  assert.equal(v1.superseded_at, null);

  seedVersion(raw, { id: "v4", versionNumber: 4, status: "Completed", supersededAt: null, inputFingerprint: "IN_v4", outputFingerprint: "OUT_v4" });
  seedChildrenFromResult(raw, result, "v4");
  const v4init = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(v4init.body.created, result.legendRows.length, "v4 gets fresh cases; none are inherited");
  const v4Publish = await apiRequest(publishPath("doc-1"), { method: "POST", body: { reason: "Publishing the v4 structural review reset for the next evidence cycle" } })({ DB: db });
  assert.equal(v4Publish.status, 201);
  assert.equal(v4Publish.body.version, 2);

  const v1After = raw.prepare("SELECT * FROM drawing_structure_approved_versions WHERE version_number=1").get();
  assert.ok(v1After.superseded_at, "the v3-derived canonical version is superseded when a newer approved version lands");
  const current = await apiRequest(approvedCurrentPath("doc-1"))({ DB: db });
  assert.equal(current.status, 200);
  assert.equal(current.body.version.source_structure_version_id, "v4");
  assert.equal(current.body.version.superseded_at, null);

  const staleDecision = decideDrawingFact(baseInput({ currentStructureId: "v4" }));
  assert.equal(staleDecision.state, DRAWING_FACT_DECISION_STATES.STALE);
  assert.ok(staleDecision.decisionReasons.includes("STRUCTURE_NOT_CURRENT"));
  assert.equal(staleDecision.eligible, false);
});

test("T: Fire Alarm facts and PA/VA facts stay isolated; a cross-system proposal never binds", async () => {
  const { raw, db, result } = setup({ fa: 3, pa: 2, title: 0 });
  const fa1 = proposalsForResult(result).find(p => String(p.id).endsWith("-1"));
  const crossSystem = {
    ...fa1,
    id: "fixture-proposal-pa-labelled",
    proposalKey: "fixture-proposal-pa-labelled",
    rawLabel: fa1.rawLabel,
    normalizedMeaning: "PUBLIC ADDRESS AND VOICE ALARM SYSTEM DEVICE 1",
    evidence: { ...fa1.evidence, rawDescription: "PUBLIC ADDRESS AND VOICE ALARM SYSTEM DEVICE 1", section: PA_SECTION },
  };
  seedCanonicalFixture({ raw, db, result, proposalRows: [...proposalsForResult(result), crossSystem] });
  const init = await apiRequest(initializePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(init.body.created, 5);

  const evaluate = await apiRequest(evaluatePath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(evaluate.status, 200);
  const fa = evaluate.body.outcomes.filter(o => o.section === FA_SECTION);
  const pa = evaluate.body.outcomes.filter(o => o.section === PA_SECTION);
  assert.equal(fa.length, 3);
  assert.equal(pa.length, 2);
  for (const outcome of fa) {
    assert.equal(outcome.decision.state, DRAWING_FACT_DECISION_STATES.CONFIRMED_DRAWING_FACT);
    assert.ok(outcome.decision.candidateProposalId && outcome.decision.candidateProposalId.startsWith("fixture-proposal-fa-"), "the PA-labelled proposal is never selected as an FA fact candidate");
  }
  for (const outcome of pa) {
    assert.equal(outcome.decision.state, DRAWING_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED);
    assert.ok(outcome.decision.decisionReasons.includes("NO_DETERMINISTIC_CANDIDATE"));
    assert.equal(outcome.decision.candidateProposalId, null);
  }

  const confirm = await apiRequest(deterministicConfirmPath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(confirm.body.counts.wouldConfirm, 3);
  const approved = raw.prepare("SELECT ar.source_legend_row_id FROM drawing_structure_approved_rows ar").all();
  assert.equal(approved.length, 3);
  for (const row of approved) {
    const legend = raw.prepare("SELECT l.id, t.table_key FROM drawing_structure_legend_rows l JOIN drawing_structure_tables t ON t.id=l.table_id WHERE l.id=?").get(row.source_legend_row_id);
    assert.equal(legend.table_key, "ft", "promoted facts are strictly Fire Alarm legend rows");
  }
});

test("U: T-00 real fixture -- 20 Fire Alarm facts confirm (16 explicit + 4 vector-derived), 4 PA/VA stay isolated for review", async t => {
  const path = "/Users/serein-b/Downloads/17- Fire Alarm/2401232-PC-AMS-DR-T-00-ZZZ-002.pdf";
  if (!fs.existsSync(path)) return t.skip("T-00 source unavailable");
  const rawPdf = fs.readFileSync(path);
  const result = await parseDrawingStructure(new Uint8Array(rawPdf));
  assert.equal(result.legendRows.length, 24);

  const DOC = "doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0";
  const PROJECT = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
  const INTAKE = "drawingIntake_57719080-1ce0-4a11-833a-311f213efcd1";
  const DOC_VER = "ver_47d5b443-74a1-4643-a29f-c8f7b4fdc5e6";

  const { raw, db } = makeDb(DOC, PROJECT);
  raw.prepare("UPDATE documents SET current_version_id=? WHERE id=?").run(DOC_VER, DOC);
  raw.prepare("UPDATE drawing_intake_versions SET id=? WHERE id='intake-1'").run(INTAKE);
  seedPages(raw, INTAKE);
  seedProposals(raw, T00_LEGEND_DEFINITION_PROPOSALS);
  const doc = { id: DOC, project_id: PROJECT, version_id: DOC_VER, sha256: sha256hex(rawPdf) };
  await persist({ DB: db }, doc, { id: INTAKE }, result, { id: DEV_ID });

  const init = await apiRequest(initializePath(DOC), { method: "POST", body: {} })({ DB: db });
  assert.equal(init.status, 200);
  assert.equal(init.body.created, 24);
  assert.equal(init.body.attributed, 20);

  const evaluate = await apiRequest(evaluatePath(DOC), { method: "POST", body: {} })({ DB: db });
  assert.equal(evaluate.status, 200);
  assert.equal(evaluate.body.dryRun, true);
  assert.equal(evaluate.body.counts.wouldConfirm, 20, "all 20 Fire Alarm facts confirm on the exact ladder");
  assert.equal(evaluate.body.counts.wouldRequireEngineer, 4, "the four PA/VA rows require engineer review");
  assert.equal(evaluate.body.counts.wouldReject, 0);
  assert.equal(evaluate.body.counts.stale, 0);
  assert.equal(evaluate.body.counts.total, 24);

  const fa = evaluate.body.outcomes.filter(o => o.section === FA_SECTION);
  const pa = evaluate.body.outcomes.filter(o => o.section === PA_SECTION);
  assert.equal(fa.length, 20);
  assert.equal(pa.length, 4);
  const explicitFacts = fa.filter(o => o.decision.state === DRAWING_FACT_DECISION_STATES.CONFIRMED_DRAWING_FACT);
  const derivedFacts = fa.filter(o => o.decision.state === DRAWING_FACT_DECISION_STATES.CONFIRMED_WITH_WARNING);
  assert.equal(explicitFacts.length, 16);
  assert.equal(derivedFacts.length, 4, "the four null-abbreviation native-symbol rows confirm via deterministic vector identity");
  for (const outcome of explicitFacts) {
    assert.ok(outcome.abbreviation, "text-code facts carry their real code -- nothing fabricated");
    assert.equal(outcome.decision.evidenceKind, DRAWING_FACT_EVIDENCE_KINDS.EXPLICIT);
  }
  for (const outcome of derivedFacts) {
    assert.ok(!outcome.abbreviation);
    assert.ok(outcome.decision.warnings.includes(DRAWING_FACT_HARMLESS_WARNINGS.NATIVE_SYMBOL_EMPTY_ABBREVIATION));
    assert.equal(outcome.decision.evidenceKind, DRAWING_FACT_EVIDENCE_KINDS.DERIVED);
    assert.ok(outcome.decision.candidateProposalId, "vector-derived facts still bind their deterministic proposal");
  }
  assert.ok(pa.every(o => o.decision.state === DRAWING_FACT_DECISION_STATES.ENGINEER_REVIEW_REQUIRED));
  assert.ok(pa.every(o => o.decision.decisionReasons.includes("NO_DETERMINISTIC_CANDIDATE")));

  const confirm = await apiRequest(deterministicConfirmPath(DOC), { method: "POST", body: {} })({ DB: db });
  assert.equal(confirm.status, 200);
  assert.equal(confirm.body.counts.wouldConfirm, 20);
  assert.equal(confirm.body.promotion.approvedRows, 20);
  assert.equal(confirm.body.promotion.excludedRows, 4);
  assert.equal(raw.prepare("SELECT count(*) count FROM drawing_structure_approved_rows").get().count, 20, "PA/VA rows are never promoted");
  const faApproved = raw.prepare("SELECT ar.* FROM drawing_structure_approved_rows ar JOIN drawing_structure_legend_rows l ON l.id=ar.source_legend_row_id JOIN drawing_structure_tables t ON t.id=l.table_id WHERE t.section_title=?").all(FA_SECTION);
  assert.equal(faApproved.length, 20);
});

test("V: every promoted fact retains complete decision + promotion provenance", async () => {
  const { raw, db, result } = setup();
  await seedAndInitialize({ raw, db, result });
  const run = await apiRequest(deterministicConfirmPath("doc-1"), { method: "POST", body: {} })({ DB: db });
  assert.equal(run.body.promotion.approvedRows, 3);

  const version = raw.prepare("SELECT * FROM drawing_structure_approved_versions").get();
  assert.equal(version.created_by, SYSTEM_DRAWING_EVALUATION_ACTOR);
  assert.equal(version.status, "Approved");
  assert.match(version.reason, /Canonical promotion of 3 deterministic drawing facts/);

  const approvedRows = raw.prepare("SELECT * FROM drawing_structure_approved_rows ORDER BY source_row").all();
  assert.equal(approvedRows.length, 3);
  for (const row of approvedRows) {
    assert.equal(row.review_actor_id, SYSTEM_DRAWING_EVALUATION_ACTOR);
    assert.ok(String(row.review_reason).startsWith("System deterministic drawing evaluation: CONFIRMED_DRAWING_FACT"), row.review_reason);
    assert.ok(row.source_legend_row_id && row.source_page === 1 && row.source_row >= 1);
    const snapshot = snapshotOf({ current_snapshot: row.source_snapshot });
    assert.ok(snapshot.drawingFactDecision, "decision provenance block present");
    assert.equal(snapshot.drawingFactDecision.decisionState, DRAWING_FACT_DECISION_STATES.CONFIRMED_DRAWING_FACT);
    assert.equal(snapshot.drawingFactDecision.decisionPolicyVersion, DRAWING_FACT_DECISION_POLICY_VERSION);
    assert.equal(snapshot.drawingFactDecision.actor, SYSTEM_DRAWING_EVALUATION_ACTOR);
    assert.equal(snapshot.drawingFactDecision.decisionAuthority, "SYSTEM_DETERMINISTIC_EVALUATION");
    assert.equal(snapshot.drawingFactDecision.evidenceKind, DRAWING_FACT_EVIDENCE_KINDS.EXPLICIT);
    assert.equal(snapshot.drawingFactDecision.candidateCount, 1);
    assert.equal(snapshot.drawingFactDecision.candidateProposalId, `fixture-proposal-fa-${row.source_row}`);
    assert.equal(snapshot.drawingFactDecision.proposalEvidenceFingerprint, run.body.evidenceFingerprint);
    assert.ok(snapshot.drawingFactDecision.decisionReasons.length >= 8);
    assert.ok(snapshot.promotionProvenance, "promotion provenance block present");
    assert.equal(snapshot.promotionProvenance.sourceTableKey, "ft");
    assert.equal(snapshot.promotionProvenance.sectionTitle, FA_SECTION);
    assert.equal(snapshot.promotionProvenance.sourceRegionKey, "ft-region");
    assert.equal(snapshot.promotionProvenance.sourcePage, 1);
    assert.equal(snapshot.promotionProvenance.sourceRow, row.source_row);
    assert.equal(snapshot.promotionProvenance.documentVersionId, "ver-1");
    assert.equal(snapshot.promotionProvenance.intakeVersionId, "intake-1");
    assert.equal(snapshot.promotionProvenance.structureOutputFingerprint, "OUT_v3");
    assert.ok(snapshot.promotionProvenance.sourceFragmentIds.length >= 1);
    assert.equal(snapshot.initializationProvenance.documentVersionId, "ver-1");
    assert.equal(snapshot.initializationProvenance.structureOutputFingerprint, "OUT_v3");
    assert.equal(snapshot.initializationProvenance.proposalEvidenceFingerprint, run.body.evidenceFingerprint);
    assert.ok(!("systemArchitectureClaimed" in snapshot.drawingFactDecision), "legend facts never claim system architecture");
    assert.ok(!("systemArchitecture" in snapshot.promotionProvenance));
  }

  const audit = raw.prepare("SELECT * FROM drawing_structure_approved_audit_events").all();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_user_id, SYSTEM_DRAWING_EVALUATION_ACTOR);
  assert.equal(audit[0].action, "Publish");
  assert.equal(audit[0].request_id.length > 0, true);

  const events = raw.prepare("SELECT * FROM drawing_structure_review_events WHERE action='SYSTEM_DETERMINISTIC_CONFIRMATION' ORDER BY created_at").all();
  assert.equal(events.length, 3);
  for (const event of events) {
    assert.equal(event.actor_user_id, SYSTEM_DRAWING_EVALUATION_ACTOR);
    assert.equal(event.actor_permission, "System");
    assert.equal(event.case_version, 2);
    const prev = JSON.parse(event.previous_snapshot);
    const next = JSON.parse(event.new_snapshot);
    assert.equal(prev.status, "Needs Review");
    assert.equal(next.status, "Approved");
    assert.ok(next.snapshot.drawingFactDecision);
    assert.ok(next.snapshot.promotionProvenance);
  }
});