/**
 * R8 -- atomic review persistence.
 *
 * Focused contract for the governed review decision write path:
 *   1. request-id replay never duplicates a decision or an audit record
 *   2. a reused request id with a different canonical payload is rejected
 *   3. compare-and-set on the prior version yields exactly one winner
 *   4. the technical stage cannot finalize the review
 *   5. a stale technical approval blocks the commercial stage
 *   6. open approval conditions block an unconditional final approval
 *   7. the canonical Technical Manager role decides without a user assignment
 *   8. review_decisions and review_audit_log are append-only in the database
 *   9. the whole batch is one atomic unit
 *
 * No Golden fixture, gate, or evidence artifact is read or written here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { handleReviewWorkflowApi, technicalApprovalCurrency } from "../worker/review-workflow-api.mjs";
import {
  REVIEW_FINALIZING_STATUSES,
  canonicalReviewDecisionRequest,
  isCommercialDecisionType,
  isTechnicalDecisionType,
  resolveReviewDecisionState,
  validateDecision,
  validateReviewDecisionSubmission,
} from "../app/domain/review-workflow.mjs";

const ROOT = new URL("../", import.meta.url);
const USER = "local-development-user";

const d1 = (raw) => {
  let batchChain = Promise.resolve();
  return ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  batch: (statements) => {
    const run = batchChain.then(async () => {
      raw.exec("BEGIN IMMEDIATE");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        raw.exec("COMMIT");
        return results;
      } catch (error) {
        raw.exec("ROLLBACK");
        throw error;
      }
    });
    batchChain = run.catch(() => {});
    return run;
  },
  });
};

/**
 * Mirrors drizzle-active/0003_review_decision_immutability.sql exactly:
 * the request_fingerprint column, the append-only triggers and the
 * compare-and-set guard are part of the schema the API writes against.
 */
const fixture = ({ role = "Engineering Reviewer", requiredRole = "Senior Technical Reviewer", status = "In Review", version = 1, pricingReady = true, safetyEligibility = "Eligible" } = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE projects(id TEXT PRIMARY KEY, owner_user_id TEXT);
    CREATE TABLE project_members(id TEXT PRIMARY KEY, project_id TEXT, user_id TEXT, role TEXT, status TEXT, revoked_at TEXT);
    CREATE TABLE boq_items(id TEXT PRIMARY KEY, description TEXT, item_number TEXT, original_unit TEXT, original_quantity REAL, source_location TEXT, original_raw_values TEXT, current_values TEXT);
    CREATE TABLE review_queue_items(id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, review_type TEXT, priority TEXT, priority_score INTEGER, severity TEXT, status TEXT, required_role TEXT, assigned_reviewer_id TEXT, version_number INTEGER, entity_version INTEGER, approval_level INTEGER, safety_state TEXT, blocking INTEGER, escalation_status TEXT, closed_at TEXT, updated_at TEXT, deleted_at TEXT, due_date TEXT);
    CREATE TABLE review_assignments(id TEXT PRIMARY KEY, review_item_id TEXT, assignee_id TEXT, role TEXT, assignment_type TEXT, team TEXT, due_date TEXT, sla_hours INTEGER, assigned_by TEXT, started_at TEXT, ended_at TEXT);
    CREATE TABLE safety_decisions(id TEXT PRIMARY KEY, boq_item_id TEXT, superseded_at TEXT, version_number INTEGER, safety_state TEXT, technical_eligibility TEXT);
    CREATE TABLE safety_approval_requests(id TEXT PRIMARY KEY, safety_decision_id TEXT, approval_type TEXT, status TEXT, decided_at TEXT, created_at TEXT);
    CREATE TABLE project_dashboard_profiles(project_id TEXT, selected_pricing_scenario_id TEXT, deleted_at TEXT);
    CREATE TABLE pricing_runs(id TEXT PRIMARY KEY, scenario_id TEXT, project_id TEXT, version_number INTEGER, superseded_at TEXT);
    CREATE TABLE pricing_lines(id TEXT PRIMARY KEY, pricing_run_id TEXT, boq_item_id TEXT, project_id TEXT, approval_ready INTEGER, status TEXT, final_value_minor INTEGER, margin_basis_points INTEGER);
    CREATE TABLE review_dependencies(id TEXT PRIMARY KEY, review_item_id TEXT, blocking INTEGER, status TEXT);
    CREATE TABLE review_approval_conditions(id TEXT PRIMARY KEY, review_item_id TEXT, decision_id TEXT, description TEXT, risk TEXT, owner_id TEXT, due_date TEXT, verification_method TEXT, status TEXT, closed_at TEXT);
    CREATE TABLE review_decisions(id TEXT PRIMARY KEY, review_item_id TEXT, project_id TEXT, decision_type TEXT, outcome TEXT, previous_state TEXT, new_state TEXT, entity_version INTEGER, review_version INTEGER, safety_state TEXT, reason TEXT, notes TEXT, evidence TEXT, scope TEXT, conditions TEXT, expires_at TEXT, approval_level INTEGER, decided_by TEXT, decided_role TEXT, request_id TEXT, request_fingerprint TEXT NOT NULL DEFAULT '', decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE review_audit_log(id TEXT PRIMARY KEY, project_id TEXT, review_item_id TEXT, action TEXT, previous_value TEXT, new_value TEXT, reason TEXT, actor_user_id TEXT, actor_role TEXT, request_id TEXT, entity_version INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

    CREATE UNIQUE INDEX review_decisions_request_idx
      ON review_decisions(project_id, request_id)
      WHERE request_fingerprint <> '';
    CREATE UNIQUE INDEX review_decisions_version_unique_idx
      ON review_decisions(review_item_id, review_version)
      WHERE request_fingerprint <> '';

    CREATE TRIGGER review_decisions_immutable_update
    BEFORE UPDATE ON review_decisions
    BEGIN
      SELECT RAISE(ABORT, 'REVIEW_DECISIONS_IMMUTABLE');
    END;

    CREATE TRIGGER review_decisions_immutable_delete
    BEFORE DELETE ON review_decisions
    BEGIN
      SELECT RAISE(ABORT, 'REVIEW_DECISIONS_IMMUTABLE');
    END;

    CREATE TRIGGER review_decisions_version_cas_guard
    BEFORE INSERT ON review_decisions
    WHEN NEW.request_fingerprint <> '' AND NEW.review_version <>
         (SELECT q.version_number FROM review_queue_items q WHERE q.id = NEW.review_item_id) + 1
    BEGIN
      SELECT RAISE(ABORT, 'REVIEW_VERSION_CAS_CONFLICT');
    END;

    CREATE TRIGGER review_audit_log_immutable_update
    BEFORE UPDATE ON review_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'REVIEW_AUDIT_LOG_IMMUTABLE');
    END;

    CREATE TRIGGER review_audit_log_immutable_delete
    BEFORE DELETE ON review_audit_log
    BEGIN
      SELECT RAISE(ABORT, 'REVIEW_AUDIT_LOG_IMMUTABLE');
    END;

    INSERT INTO projects VALUES('p1','owner');
    INSERT INTO project_members VALUES('m1','p1','${USER}','${role}','Active',NULL);
    INSERT INTO boq_items VALUES('b1','Addressable Smoke Detector','1','EA',1,'{}','{}','{}');
    INSERT INTO review_queue_items VALUES('r1','p1','b1','Final Estimation Review','High',60,'High','${status}','${requiredRole}',NULL,${version},1,1,'Approval Ready',0,'None',NULL,NULL,NULL,NULL);
    INSERT INTO safety_decisions VALUES('s1','b1',NULL,1,'Approval Ready','${safetyEligibility}');
    INSERT INTO project_dashboard_profiles VALUES('p1','sc1',NULL);
    INSERT INTO pricing_runs VALUES('r1','sc1','p1',1,NULL);
    INSERT INTO pricing_lines VALUES('pl1','r1','b1','p1',${pricingReady ? 1 : 0},'Draft',100000,1500);
  `);
  return { raw, db: d1(raw) };
};

const env = (db) => ({ DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: USER, APP_ORGANIZATION_ID: "org" });

const post = (body) => new Request("https://local.test/api/reviews/r1/decision", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const technical = (overrides = {}) => ({
  reviewVersion: 1,
  type: "Approve Technical Match",
  outcome: "Approved",
  reason: "Detector match confirmed against the current BOQ and safety evidence",
  ...overrides,
});

const commercial = (overrides = {}) => ({
  reviewVersion: 1,
  type: "Approve Commercial",
  outcome: "Approved",
  reason: "Commercial cost and margin reviewed against the current pricing run",
  ...overrides,
});

const count = (raw, table) => Number(raw.prepare(`SELECT COUNT(*) count FROM ${table}`).get().count);
const item = (raw) => raw.prepare("SELECT * FROM review_queue_items WHERE id='r1'").get();

/* ------------------------------------------------------------------ *
 * Canonical decision semantics (pure domain, no I/O)
 * ------------------------------------------------------------------ */

test("R8 canonical Technical Manager role decides technical review without a user assignment", () => {
  const decision = { type: "Approve Technical Match", outcome: "Approved" };
  assert.equal(
    validateReviewDecisionSubmission({ requiredRole: "Technical Manager", currentRole: "Technical Manager", decision }).permitted,
    true,
    "a canonical Technical Manager must be able to decide a technical review",
  );
  assert.equal(
    validateReviewDecisionSubmission({ requiredRole: "Senior Technical Reviewer", currentRole: "Technical Manager", decision }).permitted,
    true,
    "Technical Manager must carry technical decision authority for technical required roles",
  );
  assert.equal(
    validateReviewDecisionSubmission({ requiredRole: "Technical Manager", currentRole: "Commercial Approver", decision }).permitted,
    false,
    "Technical Manager must not gain commercial authority",
  );
  assert.equal(
    validateReviewDecisionSubmission({ requiredRole: "Commercial Approver", currentRole: "Technical Manager", decision: { type: "Approve Commercial", outcome: "Approved" } }).permitted,
    false,
  );
});

test("R8 technical decisions resolve to a non-finalizing state and cannot be forced to finalize", () => {
  assert.equal(isTechnicalDecisionType("Approve Technical Match"), true);
  assert.equal(isCommercialDecisionType("Approve Commercial Cost"), true);

  const approved = resolveReviewDecisionState({ status: "In Review", type: "Approve Technical Match", outcome: "Approved" });
  assert.equal(approved.state, "Waiting for Commercial Approval");
  assert.equal(approved.finalizing, false);
  assert.equal(approved.errors.length, 0);

  const conditional = resolveReviewDecisionState({ status: "In Review", type: "Approve Technical Match", outcome: "Approved with Conditions" });
  assert.equal(conditional.state, "Waiting for Commercial Approval");
  assert.equal(conditional.finalizing, false, "a conditional technical approval must not finalize the review");

  const commercialApproved = resolveReviewDecisionState({ status: "Waiting for Commercial Approval", type: "Approve Commercial", outcome: "Approved" });
  assert.equal(commercialApproved.state, "Approved");
  assert.equal(commercialApproved.finalizing, true);

  // A client-supplied finalizing state on a technical decision is refused.
  const hostile = validateDecision({
    review: { versionNumber: 1, status: "In Review" },
    currentVersion: 1,
    decision: { ...technical(), newState: "Approved" },
    safety: { technicalEligibility: "Eligible" },
    technicalApproved: false,
    pricingReady: true,
  });
  assert.ok(hostile.errors.includes("TECHNICAL_STAGE_CANNOT_FINALIZE"), hostile.errors.join(","));
  assert.equal(hostile.permitted, false);
});

test("R8 a stale technical approval blocks the commercial stage", () => {
  const base = {
    review: { versionNumber: 4, status: "Waiting for Commercial Approval" },
    currentVersion: 4,
    decision: commercial(),
    safety: { technicalEligibility: "Eligible" },
    pricingReady: true,
  };
  const stale = validateDecision({ ...base, technicalApproved: true, technicalApprovalCurrent: false });
  assert.ok(stale.errors.includes("TECHNICAL_APPROVAL_STALE"), stale.errors.join(","));
  assert.equal(stale.permitted, false);

  const current = validateDecision({ ...base, technicalApproved: true, technicalApprovalCurrent: true });
  assert.equal(current.permitted, true, current.errors.join(","));

  const missing = validateDecision({ ...base, technicalApproved: false, technicalApprovalCurrent: false });
  assert.ok(missing.errors.includes("TECHNICAL_APPROVAL_REQUIRED"));
  assert.equal(missing.errors.includes("TECHNICAL_APPROVAL_STALE"), false, "absence is reported as a missing approval, not as staleness");
});

test("R8 open approval conditions block an unconditional final approval", () => {
  const conditionalConditions = [{ description: "Certification pending", owner: "u1", dueDate: "2026-12-01" }];
  const base = {
    review: { versionNumber: 3, status: "Waiting for Commercial Approval" },
    currentVersion: 3,
    decision: commercial(),
    safety: { technicalEligibility: "Eligible" },
    technicalApproved: true,
    technicalApprovalCurrent: true,
    pricingReady: true,
  };
  const blocked = validateDecision({ ...base, openConditions: 1 });
  assert.ok(blocked.errors.includes("OPEN_APPROVAL_CONDITIONS_BLOCK"), blocked.errors.join(","));
  assert.equal(blocked.permitted, false);

  const governed = validateDecision({
    ...base,
    openConditions: 1,
    decision: commercial({ outcome: "Approved with Conditions", conditions: conditionalConditions }),
  });
  assert.equal(governed.permitted, true, "a conditional approval is the governed route through open conditions");

  const clear = validateDecision({ ...base, openConditions: 0 });
  assert.equal(clear.permitted, true, clear.errors.join(","));

  // Rejection is the safe direction and is never blocked by open conditions.
  const rejected = validateDecision({ ...base, openConditions: 2, decision: { ...commercial(), outcome: "Rejected" } });
  assert.equal(rejected.errors.includes("OPEN_APPROVAL_CONDITIONS_BLOCK"), false);
});

test("R8 the canonical decision request payload is order and whitespace independent", () => {
  const a = canonicalReviewDecisionRequest({ reviewItemId: "r1", priorVersion: 1, decision: technical() });
  const b = canonicalReviewDecisionRequest({ reviewItemId: "r1", priorVersion: 1, decision: { reason: `  ${technical().reason}  `, outcome: "Approved", type: "Approve Technical Match", notes: null, evidence: [], scope: "BOQ Item", conditions: [], expiresAt: null } });
  assert.equal(a, b, "semantically identical payloads must canonicalize identically");
  assert.notEqual(a, canonicalReviewDecisionRequest({ reviewItemId: "r1", priorVersion: 2, decision: technical() }));
  assert.notEqual(a, canonicalReviewDecisionRequest({ reviewItemId: "r2", priorVersion: 1, decision: technical() }));
  assert.notEqual(a, canonicalReviewDecisionRequest({ reviewItemId: "r1", priorVersion: 1, decision: commercial() }));
  assert.notEqual(a, canonicalReviewDecisionRequest({ reviewItemId: "r1", priorVersion: 1, decision: technical({ outcome: "Approved with Conditions" }) }));
});

test("R8 finalizing review statuses are declared, not inferred", () => {
  assert.deepEqual([...REVIEW_FINALIZING_STATUSES].sort(), ["Approved", "Approved with Conditions", "Rejected"]);
});

/* ------------------------------------------------------------------ *
 * Atomic persistence against real SQLite with the 0003 triggers loaded
 * ------------------------------------------------------------------ */

test("R8 request-id replay returns the original decision and writes no duplicate decision or audit record", async () => {
  const { raw, db } = fixture();
  const first = await handleReviewWorkflowApi(post(technical({ requestId: "req-1" })), env(db));
  assert.equal(first.status, 201);
  const created = await first.json();
  assert.equal(created.idempotent, false);

  const replay = await handleReviewWorkflowApi(post(technical({ requestId: "req-1" })), env(db));
  assert.equal(replay.status, 200, "a replay must not be rejected as stale");
  const replayed = await replay.json();
  assert.equal(replayed.idempotent, true);
  assert.equal(replayed.decisionId, created.decisionId);
  assert.equal(replayed.status, created.status);
  assert.equal(replayed.version, created.version);

  assert.equal(count(raw, "review_decisions"), 1, "replay must not duplicate the decision");
  assert.equal(count(raw, "review_audit_log"), 1, "replay must not duplicate the audit record");
  assert.equal(raw.prepare("SELECT request_id FROM review_audit_log").get().request_id, "req-1", "the decision audit must retain the originating request id");
  assert.equal(item(raw).version_number, 2, "replay must not advance the review version");
  raw.close();
});

test("R8 a reused request id with a different canonical payload is rejected without persisting", async () => {
  const { raw, db } = fixture();
  assert.equal((await handleReviewWorkflowApi(post(technical({ requestId: "req-1" })), env(db))).status, 201);

  const reused = await handleReviewWorkflowApi(post(technical({ requestId: "req-1", reason: "A materially different justification for the same request id" })), env(db));
  assert.equal(reused.status, 409);
  assert.equal((await reused.json()).error.code, "REVIEW_REQUEST_ID_CONFLICT");

  assert.equal(count(raw, "review_decisions"), 1);
  assert.equal(count(raw, "review_audit_log"), 1);
  assert.equal(item(raw).version_number, 2);
  raw.close();
});

test("R8 compare-and-set on the prior version produces exactly one winner", async () => {
  const { raw, db } = fixture();
  const responses = await Promise.all([
    handleReviewWorkflowApi(post(technical({ requestId: "req-a" })), env(db)),
    handleReviewWorkflowApi(post(technical({ requestId: "req-b" })), env(db)),
  ]);
  const statuses = responses.map((response) => response.status).sort();
  assert.deepEqual(statuses, [201, 409], `expected one winner and one loser, got ${statuses.join(",")}`);

  const loser = responses.find((response) => response.status === 409);
  assert.ok(["REVIEW_VERSION_CAS_CONFLICT", "STALE_REVIEW_VERSION"].includes((await loser.json()).error.code));

  assert.equal(count(raw, "review_decisions"), 1, "only the winning compare-and-set may persist a decision");
  assert.equal(count(raw, "review_audit_log"), 1, "only the winning compare-and-set may persist an audit record");
  assert.equal(item(raw).version_number, 2, "the review advances by exactly one version");
  raw.close();
});

test("R8 the database compare-and-set guard rejects a decision that does not own the next version", () => {
  const { raw } = fixture();
  const insert = () => raw.prepare(
    "INSERT INTO review_decisions (id, review_item_id, project_id, decision_type, outcome, previous_state, new_state, entity_version, review_version, safety_state, reason, evidence, scope, conditions, approval_level, decided_by, decided_role, request_id, request_fingerprint) VALUES (?, 'r1', 'p1', 'Approve Technical Match', 'Approved', 'In Review', 'Waiting for Commercial Approval', 1, ?, 'Approval Ready', 'guard probe', '[]', 'BOQ Item', '[]', 1, 'u1', 'Engineering Reviewer', ?, ?)",
  );
  const runInsert = (decisionId, reviewVersion, requestId = `req-${decisionId}`) => insert().run(decisionId, reviewVersion, requestId, "f".repeat(64));
  assert.throws(() => runInsert("skip", 7), /REVIEW_VERSION_CAS_CONFLICT/, "a decision may not skip the current version");
  assert.throws(() => runInsert("replay", 1), /REVIEW_VERSION_CAS_CONFLICT/, "a decision may not replay the current version");
  assert.equal(runInsert("owner", 2).changes, 1, "the owner of the next version is accepted");
  raw.prepare("UPDATE review_queue_items SET version_number=2 WHERE id='r1'").run();
  assert.throws(() => runInsert("dup", 3, "req-owner"), /UNIQUE constraint failed: review_decisions.project_id, review_decisions.request_id/, "the request id is unique per project at the database level");
  assert.equal(count(raw, "review_decisions"), 1);
  raw.close();
});

test("R8 the technical stage cannot finalize the review through the API", async () => {
  const { raw, db } = fixture({ status: "Waiting for Technical Approval" });
  const response = await handleReviewWorkflowApi(post(technical({ requestId: "req-1" })), env(db));
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.status, "Waiting for Commercial Approval");
  assert.equal(REVIEW_FINALIZING_STATUSES.has(body.status), false, "a technical decision must never finalize the review");
  assert.equal(item(raw).status, "Waiting for Commercial Approval");
  assert.equal(item(raw).closed_at, null, "a technical approval must not close the review");
  raw.close();
});

test("R8 a hostile client cannot force a technical decision into a finalizing state", async () => {
  const { raw, db } = fixture();
  const response = await handleReviewWorkflowApi(post(technical({ requestId: "req-1", newState: "Approved" })), env(db));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "TECHNICAL_STAGE_CANNOT_FINALIZE");
  assert.equal(count(raw, "review_decisions"), 0);
  assert.equal(count(raw, "review_audit_log"), 0);
  raw.close();
});

test("R8 a stale technical approval blocks the commercial stage through the API", async () => {
  const { raw, db } = fixture();
  assert.equal((await handleReviewWorkflowApi(post(technical({ requestId: "req-tech" })), env(db))).status, 201);
  assert.equal(item(raw).status, "Waiting for Commercial Approval");

  // The technical stage hands the review to the commercial stage; the same
  // project member must therefore be re-authorized under the commercial role
  // before the second governed decision is submitted.
  raw.prepare("UPDATE project_members SET role='Commercial Approver' WHERE id='m1'").run();
  // Any later governed change to the review advances its version, so the
  // technical approval no longer speaks for the current review state.
  raw.prepare("UPDATE review_queue_items SET version_number=version_number+1 WHERE id='r1'").run();

  const response = await handleReviewWorkflowApi(post(commercial({ reviewVersion: 3, requestId: "req-comm" })), env(db));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "TECHNICAL_APPROVAL_STALE");
  assert.equal(count(raw, "review_decisions"), 1, "a blocked commercial decision must not persist");
  assert.equal(item(raw).status, "Waiting for Commercial Approval");
  raw.close();
});

test("R8 a current technical approval admits the commercial stage", async () => {
  const { raw, db } = fixture();
  assert.equal((await handleReviewWorkflowApi(post(technical({ requestId: "req-tech" })), env(db))).status, 201);
  raw.prepare("UPDATE project_members SET role='Commercial Approver' WHERE id='m1'").run();
  const commercialResponse = await handleReviewWorkflowApi(post(commercial({ reviewVersion: 2, requestId: "req-comm" })), env(db));
  assert.equal(commercialResponse.status, 201, JSON.stringify(await commercialResponse.clone().json()));
  assert.equal((await commercialResponse.json()).status, "Approved");
  assert.equal(item(raw).status, "Approved");
  raw.close();
});

test("R8 open approval conditions block an unconditional final approval through the API", async () => {
  const { raw, db } = fixture();
  assert.equal((await handleReviewWorkflowApi(post(technical({ requestId: "req-tech" })), env(db))).status, 201);
  raw.prepare("UPDATE project_members SET role='Commercial Approver' WHERE id='m1'").run();
  raw.prepare("INSERT INTO review_approval_conditions (id, review_item_id, decision_id, description, risk, owner_id, due_date, verification_method, status) VALUES ('cond-1','r1','legacy','Site certification outstanding','Documented','u1','2026-12-01','Evidence review','Open')").run();

  const response = await handleReviewWorkflowApi(post(commercial({ reviewVersion: 2, requestId: "req-comm" })), env(db));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "OPEN_APPROVAL_CONDITIONS_BLOCK");
  assert.equal(count(raw, "review_decisions"), 1, "the blocked commercial decision must not add a decision");
  assert.equal(count(raw, "review_audit_log"), 1, "the blocked commercial decision must not add an audit record");
  raw.close();
});

test("R8 the canonical Technical Manager role decides through the API without an assignee", async () => {
  const { raw, db } = fixture({ role: "Technical Manager" });
  const response = await handleReviewWorkflowApi(post(technical({ requestId: "req-1" })), env(db));
  assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
  assert.equal(item(raw).assigned_reviewer_id, null, "Technical Manager authority must not require assigning a user");
  const decision = raw.prepare("SELECT * FROM review_decisions").get();
  assert.equal(decision.decided_role, "Technical Manager");
  assert.equal(decision.request_fingerprint.length, 64, "the canonical payload fingerprint must be a sha256 digest");
  raw.close();
});

test("R8 the whole decision batch is atomic: a failing statement leaves no partial state", async () => {
  const { raw, db } = fixture();
  // A closed review is not re-decidable, and the batch carries the decision,
  // the compare-and-set update, the audit record and the conditions together.
  raw.prepare("UPDATE review_queue_items SET status='Cancelled' WHERE id='r1'").run();
  const response = await handleReviewWorkflowApi(post(technical({ requestId: "req-1" })), env(db));
  assert.equal(response.status, 409);
  assert.equal(count(raw, "review_decisions"), 0, "the decision insert must roll back with the rest of the batch");
  assert.equal(count(raw, "review_audit_log"), 0, "the audit record must roll back with the rest of the batch");
  assert.equal(item(raw).version_number, 1, "the compare-and-set update must roll back with the rest of the batch");
  raw.close();
});

test("R8 review decisions and review audit records are append-only in the database", () => {
  const { raw } = fixture();
  raw.prepare("INSERT INTO review_decisions (id, review_item_id, project_id, decision_type, outcome, previous_state, new_state, entity_version, review_version, safety_state, reason, evidence, scope, conditions, approval_level, decided_by, decided_role, request_id, request_fingerprint) VALUES ('d1','r1','p1','Approve Technical Match','Approved','In Review','Waiting for Commercial Approval',1,2,'Approval Ready','probe','[]','BOQ Item','[]',1,'u1','Engineering Reviewer','req-probe','ff')").run();
  raw.prepare("INSERT INTO review_audit_log (id, project_id, review_item_id, action, reason, actor_user_id, actor_role, request_id, entity_version) VALUES ('a1','p1','r1','Approve Technical Match','probe','u1','Engineering Reviewer','req-probe',2)").run();

  assert.throws(() => raw.prepare("UPDATE review_decisions SET outcome='Rejected' WHERE id='d1'").run(), /REVIEW_DECISIONS_IMMUTABLE/);
  assert.throws(() => raw.prepare("DELETE FROM review_decisions WHERE id='d1'").run(), /REVIEW_DECISIONS_IMMUTABLE/);
  assert.throws(() => raw.prepare("UPDATE review_audit_log SET reason='rewritten' WHERE id='a1'").run(), /REVIEW_AUDIT_LOG_IMMUTABLE/);
  assert.throws(() => raw.prepare("DELETE FROM review_audit_log WHERE id='a1'").run(), /REVIEW_AUDIT_LOG_IMMUTABLE/);

  assert.equal(raw.prepare("SELECT outcome FROM review_decisions WHERE id='d1'").get().outcome, "Approved");
  assert.equal(raw.prepare("SELECT reason FROM review_audit_log WHERE id='a1'").get().reason, "probe");
  raw.close();
});

/* ------------------------------------------------------------------ *
 * Active migration 0003, journal, snapshot and manifest
 * ------------------------------------------------------------------ */

test("R8 active migration 0003 installs the append-only and compare-and-set protections", () => {
  const sql = readFileSync(new URL("drizzle-active/0003_review_decision_immutability.sql", ROOT), "utf8");
  for (const trigger of [
    "review_decisions_immutable_update",
    "review_decisions_immutable_delete",
    "review_decisions_version_cas_guard",
    "review_audit_log_immutable_update",
    "review_audit_log_immutable_delete",
  ]) assert.match(sql, new RegExp(`CREATE TRIGGER IF NOT EXISTS ${trigger}\\b`), `${trigger} must be installed by 0003`);
  assert.match(sql, /`request_fingerprint` text DEFAULT '' NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS review_decisions_request_idx/);
  assert.match(sql, /ON review_decisions\s*\(project_id,\s*request_id\)/);
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS review_decisions_version_unique_idx/);
  assert.match(sql, /ON review_decisions\s*\(review_item_id,\s*review_version\)/);
  assert.match(sql, /WHERE request_fingerprint <> ''/);
  assert.doesNotMatch(sql, /^\s*(?:UPDATE|DELETE|TRUNCATE)\s+/im, "the rebuild must not rewrite or discard existing data");
});

test("R8 the active chain journal, snapshot and manifest retain the review protections", () => {
  const journal = JSON.parse(readFileSync(new URL("drizzle-active/meta/_journal.json", ROOT), "utf8"));
  const tags = journal.entries.map((entry) => entry.tag);
  assert.deepEqual(tags.slice(0, 5), [
    "0000_baseline_schema_0082",
    "0001_price_record_intake_lineage",
    "0002_governing_source_fk",
    "0003_review_decision_immutability",
    "0004_fire_alarm_panel_sizing_snapshots",
  ]);
  assert.ok(tags.length >= 5, "the active chain must retain the review and panel-sizing migrations");
  assert.deepEqual(journal.entries.map((entry) => entry.idx), journal.entries.map((_, index) => index));

  const manifest = JSON.parse(readFileSync(new URL("drizzle-active/manifest.json", ROOT), "utf8"));
  const latestNumber = tags.at(-1).match(/^(\d{4})_/)?.[1];
  const previousNumber = tags.at(-2).match(/^(\d{4})_/)?.[1];
  assert.ok(latestNumber && previousNumber, "active migration tags must carry numeric snapshot prefixes");
  const snapshot = JSON.parse(readFileSync(new URL(`drizzle-active/meta/${latestNumber}_snapshot.json`, ROOT), "utf8"));
  const previous = JSON.parse(readFileSync(new URL(`drizzle-active/meta/${previousNumber}_snapshot.json`, ROOT), "utf8"));
  assert.equal(snapshot.prevId, previous.id);
  assert.equal(Object.keys(snapshot.tables).length, manifest.counts.businessTables);
  assert.ok(Object.keys(snapshot.tables.review_decisions.columns).includes("request_fingerprint"));
  assert.ok(
    Object.values(snapshot.tables.review_decisions.indexes || {}).some((index) => index.name === "review_decisions_version_unique_idx" && index.isUnique),
    "the snapshot must carry the review-version unique index",
  );

  const triggerNames = manifest.triggers.map((trigger) => trigger.name);
  for (const trigger of [
    "review_decisions_immutable_update",
    "review_decisions_immutable_delete",
    "review_decisions_version_cas_guard",
    "review_audit_log_immutable_update",
    "review_audit_log_immutable_delete",
  ]) assert.ok(triggerNames.includes(trigger), `${trigger} must be in the manifest`);
  assert.deepEqual(triggerNames, [...triggerNames].sort(), "manifest triggers must stay sorted");
  assert.equal(new Set(triggerNames).size, triggerNames.length);
  assert.equal(manifest.counts.triggers, triggerNames.length);
  assert.equal(manifest.counts.businessTables, manifest.tables.length);
  assert.equal(manifest.counts.namedIndexes, manifest.indexes.length);
  assert.equal(manifest.counts.views, manifest.views.length);
  const indexNames = manifest.indexes.map((index) => index.name);
  assert.ok(indexNames.includes("review_decisions_request_idx"));
  assert.ok(indexNames.includes("review_decisions_version_unique_idx"));
  assert.deepEqual(indexNames, [...indexNames].sort(), "manifest indexes must stay sorted");
  assert.ok(manifest.tables.find((table) => table.name === "review_decisions").columns.some((column) => column.name === "request_fingerprint"));

  // 0003 rebuilds the review table only to add the governed request fingerprint,
  // while preserving the frozen target objects and installing database guards.
  for (const object of ["review_decisions", "review_audit_log", "review_queue_items"]) {
    assert.ok(manifest.tables.some((table) => table.name === object), `${object} must remain in the manifest`);
  }
});

test("R8 migration 0003 leaves the frozen baseline and the legacy chain untouched", () => {
  const baseline = readFileSync(new URL("drizzle-active/0000_baseline_schema_0082.sql", ROOT), "utf8");
  assert.doesNotMatch(baseline, /request_fingerprint[^\n]*review_decisions/);
  assert.equal([...baseline.matchAll(/CREATE TABLE IF NOT EXISTS `review_decisions`/g)].length, 1);
  const migration = readFileSync(new URL("drizzle-active/0003_review_decision_immutability.sql", ROOT), "utf8");
  // The migration is additive: it must not drop the table. `review_approval_conditions`
  // and `review_attachments` both hold a foreign key to review_decisions(id), and a
  // migrator runs a migration inside one transaction where PRAGMA foreign_keys is a
  // no-op, so a DROP would abort the whole migration the moment either held a row.
  assert.doesNotMatch(migration, /DROP\s+TABLE/i);
  assert.match(migration, /ALTER TABLE `?review_decisions`? ADD COLUMN `?request_fingerprint`?/i);
  assert.doesNotMatch(migration, /DELETE FROM|TRUNCATE/i);
});

test("R8 the review API and domain keep the review write path free of client-trusted authority", async () => {
  const api = await readFile(new URL("worker/review-workflow-api.mjs", ROOT), "utf8");
  const domain = await readFile(new URL("app/domain/review-workflow.mjs", ROOT), "utf8");
  for (const control of ["request_fingerprint", "REVIEW_REQUEST_ID_CONFLICT", "REVIEW_VERSION_CAS_CONFLICT", "idempotent", "version_number=?"]) {
    assert.match(api, new RegExp(control), `review API must retain ${control}`);
  }
  for (const control of ["TECHNICAL_APPROVAL_STALE", "OPEN_APPROVAL_CONDITIONS_BLOCK", "TECHNICAL_STAGE_CANNOT_FINALIZE"]) {
    assert.match(domain, new RegExp(control), `review domain must retain ${control}`);
  }
  assert.doesNotMatch(api, /localStorage|sessionStorage|x-user-role/);
});

test("R8 the review role vocabulary has exactly one authority and the domain consumes it", async () => {
  // The canonical role names must not be restated as a second list inside the
  // review domain. The domain previously carried a private permitted-role table
  // that had drifted from the durable project authority, which locked out the
  // very roles a technical review names. The names now live once, in
  // `app/domain/project-roles.mjs`, and both the review domain and the worker
  // project authority must read them from there.
  const domain = await readFile(new URL("app/domain/review-workflow.mjs", ROOT), "utf8");
  const roles = await readFile(new URL("app/domain/project-roles.mjs", ROOT), "utf8");
  const projectAuthority = await readFile(new URL("worker/project-authority.mjs", ROOT), "utf8");

  assert.match(domain, /from "\.\/project-roles\.mjs"/, "the review domain must read the role vocabulary from the shared module");
  assert.doesNotMatch(domain, /DECISION_ROLE_AUTHORITY/, "the review domain must not keep a second permitted-role table");
  for (const role of ["Technical Manager", "Technical Reviewer", "Senior Technical Reviewer", "Commercial Approver", "Project Manager", "Administrator"]) {
    assert.match(roles, new RegExp(role), `the shared role authority must retain ${role}`);
  }
  assert.match(projectAuthority, /from "\.\.\/app\/domain\/project-roles\.mjs"/, "the worker project authority must read the same shared module");
  assert.doesNotMatch(projectAuthority, /new Set\(\[\s*"?Project Manager/, "the worker project authority must not restate the approval sets");
});

/* ------------------------------------------------------------------ *
 * Authority latching, retry idempotency, and decision ordering
 * ------------------------------------------------------------------ */

test("R8 assignment records the assignee's role without rewriting the review's required role", async () => {
  // `required_role` is the authority that will judge this review. It is latched
  // when the item is created and advanced only by the server-side decision
  // transition into the commercial stage. The assignment endpoint used to write
  // the client's `role` field straight into `review_queue_items.required_role`,
  // so the person being assigned a review also chose the gate that would judge
  // it -- assigning `role: "Administrator"` to oneself made any review trivially
  // approvable by the assignee.
  const { raw, db } = fixture({ status: "Open" });
  const before = item(raw).required_role;
  assert.equal(before, "Senior Technical Reviewer");

  const response = await handleReviewWorkflowApi(new Request("https://local.test/api/reviews/r1/assign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assigneeId: "reviewer-1", role: "Administrator", reason: "Route to the administrator" }),
  }), env(db));

  assert.equal(response.status, 200, JSON.stringify(await response.clone().json()));
  const after = item(raw);
  assert.equal(after.required_role, before, "assignment must not rewrite the latched review requirement");
  assert.equal(after.assigned_reviewer_id, "reviewer-1");
  // The assignee's own role is still recorded -- on the assignment, where it
  // belongs, not on the review item.
  assert.equal(raw.prepare("SELECT role FROM review_assignments WHERE review_item_id='r1'").get().role, "Administrator");
  raw.close();
});

test("R8 assignment refuses a role outside the canonical vocabulary", async () => {
  const { raw, db } = fixture({ status: "Open" });
  const response = await handleReviewWorkflowApi(new Request("https://local.test/api/reviews/r1/assign", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assigneeId: "reviewer-1", role: "Definitely An Engineer", reason: "Invent a role" }),
  }), env(db));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "ASSIGNMENT_ROLE_INVALID");
  assert.equal(count(raw, "review_assignments"), 0, "an unrecognised assignee role must not be recorded");
  assert.equal(item(raw).required_role, "Senior Technical Reviewer");
  raw.close();
});

test("R8 the latest technical decision wins even when two land in the same second", async () => {
  // `review_decisions.decided_at` is `CURRENT_TIMESTAMP`, which SQLite records at
  // one-second resolution, so two technical decisions recorded in the same second
  // tie. `technicalApprovalCurrency` broke that tie on `id DESC`, and decision ids
  // are random, so "the latest technical approval" resolved arbitrarily: a later
  // rejection could be masked by an earlier approval and the commercial stage
  // would then be admitted on authority that had already been withdrawn.
  const { raw, db } = fixture();
  const at = "2026-01-01 00:00:00";
  const decision = (id, reviewVersion, outcome) => raw.prepare(`
    INSERT INTO review_decisions
      (id, review_item_id, project_id, decision_type, outcome, previous_state, new_state,
       entity_version, review_version, safety_state, reason, evidence, scope, conditions,
       approval_level, decided_by, decided_role, request_id, request_fingerprint, decided_at)
    VALUES (?, 'r1', 'p1', 'Approve Technical Match', ?, 'In Review', 'Waiting for Commercial Approval',
            1, ?, 'Approval Ready', 'technical decision for ordering evidence', '[]', 'BOQ Item', '[]',
            1, ?, 'Engineering Reviewer', ?, 'seed', ?)
  `).run(id, outcome, reviewVersion, USER, `req-${reviewVersion}`, at);

  // The approved row sorts *after* the later rejection under `id DESC`, which is
  // exactly the ordering that used to let a stale approval win.
  decision("reviewdecision_zzz", 2, "Approved");
  raw.prepare("UPDATE review_queue_items SET version_number=2 WHERE id='r1'").run();
  decision("reviewdecision_aaa", 3, "Rejected");
  raw.prepare("UPDATE review_queue_items SET version_number=3 WHERE id='r1'").run();

  const currency = await technicalApprovalCurrency(db, "r1", 3);
  assert.equal(currency.approved, false, "the most recent technical decision is a rejection, so no technical approval stands");
  assert.equal(currency.reviewVersion, 3, "the latest technical decision is the one at the current review version");
  raw.close();
});

test("R8 a concurrent retry of the same request id is answered idempotently, not refused", async () => {
  // The replay lookup runs before the batch, so a duplicate that arrives while the
  // first request is still committing misses the lookup, loses the race in the
  // database, and used to be reported as a conflict -- telling the client its
  // own identical retry had reused a request id. A request id exists precisely so
  // that a retry is safe, so the loser of the race must receive the winner's
  // decision.
  const { raw, db } = fixture();
  const body = technical({ requestId: "req-retry" });
  const fingerprint = createHash("sha256")
    .update(canonicalReviewDecisionRequest({ reviewItemId: "r1", priorVersion: 1, decision: body }))
    .digest("hex");

  // The competing request commits in the window between this request's replay
  // lookup and its own batch.
  let raced = false;
  const racingDb = {
    ...db,
    async batch(statements) {
      if (!raced) {
        raced = true;
        raw.prepare(`
          INSERT INTO review_decisions
            (id, review_item_id, project_id, decision_type, outcome, previous_state, new_state,
             entity_version, review_version, safety_state, reason, evidence, scope, conditions,
             approval_level, decided_by, decided_role, request_id, request_fingerprint)
          VALUES ('reviewdecision_winner', 'r1', 'p1', 'Approve Technical Match', 'Approved',
                  'In Review', 'Waiting for Commercial Approval', 1, 2, 'Approval Ready',
                  'Detector match confirmed against the current BOQ and safety evidence',
                  '[]', 'BOQ Item', '[]', 1, ?, 'Engineering Reviewer', ?, ?)
        `).run(USER, body.requestId, fingerprint);
        raw.prepare("UPDATE review_queue_items SET version_number=2 WHERE id='r1'").run();
      }
      return db.batch(statements);
    },
  };

  const response = await handleReviewWorkflowApi(post(body), env(racingDb));
  assert.equal(response.status, 200, `a same-payload retry must be idempotent, got ${response.status} ${JSON.stringify(await response.clone().json())}`);
  const result = await response.json();
  assert.equal(result.idempotent, true);
  assert.equal(result.decisionId, "reviewdecision_winner", "the retry must return the decision that actually won");
  assert.equal(count(raw, "review_decisions"), 1, "the retry must not create a second decision");
  raw.close();
});

test("R8 a reused request id with a different payload is still a conflict", async () => {
  // The idempotent retry above must not weaken the guard it sits next to: a
  // request id reused for genuinely different content is still refused, and the
  // refusal must be distinguishable from the retry. This runs after a successful
  // technical decision, so the item has already advanced to the commercial stage
  // and the reviewer no longer holds the required role -- proving the conflict is
  // detected as a conflict, not merely blocked for an unrelated reason.
  const { raw, db } = fixture();
  const first = technical({ requestId: "req-shared" });
  assert.equal((await handleReviewWorkflowApi(post(first), env(db))).status, 201);

  const second = technical({ reviewVersion: 2, requestId: "req-shared", reason: "A materially different technical rationale" });
  const response = await handleReviewWorkflowApi(post(second), env(db));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "REVIEW_REQUEST_ID_CONFLICT");
  assert.equal(count(raw, "review_decisions"), 1, "the conflicting request must not persist");
  raw.close();
});
