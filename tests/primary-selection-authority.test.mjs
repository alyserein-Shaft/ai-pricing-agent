import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";
import { resolveCurrentPrimarySelection } from "../worker/primary-selection-authority.mjs";

const d1 = (sql) => ({
  prepare(text) {
    let values = [];
    return {
      bind(...next) {
        values = next;
        return this;
      },
      first: async () => sql.prepare(text).get(...values) ?? null,
      all: async () => ({ results: sql.prepare(text).all(...values) }),
      run: async () => sql.prepare(text).run(...values),
    };
  },
  batch: async (statements) => Promise.all(statements.map((statement) => statement.run())),
});

const fixture = () => {
  const sql = new DatabaseSync(":memory:");
  sql.exec(`
    CREATE TABLE product_match_runs (
      id TEXT PRIMARY KEY,
      boq_item_id TEXT NOT NULL,
      requirement_profile_version_id TEXT,
      version_number INTEGER NOT NULL,
      superseded_at TEXT
    );
    CREATE TABLE requirement_profile_versions (
      id TEXT PRIMARY KEY,
      boq_item_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      superseded_at TEXT
    );
    CREATE TABLE product_match_candidates (
      id TEXT PRIMARY KEY,
      match_run_id TEXT NOT NULL,
      product_id TEXT NOT NULL,
      rank INTEGER NOT NULL,
      review_status TEXT DEFAULT 'Needs Review'
    );
    CREATE TABLE safety_decisions (
      id TEXT PRIMARY KEY,
      boq_item_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      superseded_at TEXT
    );
    CREATE TABLE safety_approval_requests (
      id TEXT PRIMARY KEY,
      safety_decision_id TEXT NOT NULL,
      approval_type TEXT NOT NULL,
      status TEXT NOT NULL,
      entity_version INTEGER NOT NULL,
      decided_at TEXT,
      created_at TEXT NOT NULL
    );
  `);
  return sql;
};

// Fixture profile lifecycle mirrors run lifecycle: each run pins the profile
// version created alongside it, so seeded runs are profile-fresh by
// construction (staleness itself is covered by dedicated currency tests).
const seedRun = (sql, run) => {
  sql.prepare("INSERT INTO requirement_profile_versions (id,boq_item_id,version_number,superseded_at) VALUES (?,?,?,?)")
    .run(`prof-${run.id}`, run.boqItemId, run.version, run.supersededAt ?? null);
  sql.prepare("INSERT INTO product_match_runs (id,boq_item_id,requirement_profile_version_id,version_number,superseded_at) VALUES (?,?,?,?,?)")
    .run(run.id, run.boqItemId, `prof-${run.id}`, run.version, run.supersededAt ?? null);
  for (const candidate of run.candidates || []) {
    sql.prepare("INSERT INTO product_match_candidates (id,match_run_id,product_id,rank) VALUES (?,?,?,?)")
      .run(candidate.id, run.id, candidate.productId, candidate.rank);
  }
};

const seedSafety = (sql, decision) => {
  sql.prepare("INSERT INTO safety_decisions (id,boq_item_id,candidate_id,version_number,superseded_at) VALUES (?,?,?,?,?)")
    .run(decision.id, decision.boqItemId, decision.candidateId, decision.version, decision.supersededAt ?? null);
};

const seedApproval = (sql, approval) => {
  sql.prepare("INSERT INTO safety_approval_requests (id,safety_decision_id,approval_type,status,entity_version,decided_at,created_at) VALUES (?,?,?,?,?,?,?)")
    .run(
      approval.id,
      approval.safetyDecisionId,
      approval.approvalType || "Technical",
      approval.status,
      approval.entityVersion,
      approval.decidedAt ?? null,
      approval.createdAt,
    );
};

test("primary-selection-authority approves exactly one current candidate with current safety and latest durable Technical approval", async () => {
  const sql = fixture();
  seedRun(sql, {
    id: "run-current",
    boqItemId: "boq-1",
    version: 2,
    candidates: [
      { id: "candidate-top", productId: "product-top", rank: 1 },
      { id: "candidate-approved", productId: "product-approved", rank: 2 },
    ],
  });
  seedSafety(sql, { id: "safety-approved", boqItemId: "boq-1", candidateId: "candidate-approved", version: 4 });
  seedApproval(sql, {
    id: "approval-approved",
    safetyDecisionId: "safety-approved",
    status: "Approved",
    entityVersion: 4,
    decidedAt: "2026-09-25T10:00:00.000Z",
    createdAt: "2026-09-25T09:59:00.000Z",
  });

  const result = await resolveCurrentPrimarySelection(d1(sql), "boq-1");

  assert.equal(result.status, "APPROVED");
  assert.equal(result.approved, true);
  assert.equal(result.selection.candidateId, "candidate-approved");
  assert.equal(result.selection.productId, "product-approved");
  assert.equal(result.safetyDecision.id, "safety-approved");
  assert.equal(result.technicalApproval.status, "Approved");
});

test("primary-selection-authority never lets a prior match run approval select a candidate from the current run", async () => {
  const sql = fixture();
  seedRun(sql, {
    id: "run-old",
    boqItemId: "boq-1",
    version: 1,
    supersededAt: "2026-09-24T12:00:00.000Z",
    candidates: [{ id: "candidate-old", productId: "product-old", rank: 1 }],
  });
  seedSafety(sql, { id: "safety-old", boqItemId: "boq-1", candidateId: "candidate-old", version: 1 });
  seedApproval(sql, {
    id: "approval-old",
    safetyDecisionId: "safety-old",
    status: "Approved",
    entityVersion: 1,
    decidedAt: "2026-09-24T12:01:00.000Z",
    createdAt: "2026-09-24T12:00:30.000Z",
  });
  seedRun(sql, {
    id: "run-current",
    boqItemId: "boq-1",
    version: 2,
    candidates: [{ id: "candidate-current", productId: "product-current", rank: 1 }],
  });

  const result = await resolveCurrentPrimarySelection(d1(sql), "boq-1");

  assert.equal(result.status, "PROVISIONAL");
  assert.equal(result.approved, false);
  assert.equal(result.selection, null);
  assert.equal(result.provisionalCandidate.candidateId, "candidate-current");
  assert.equal(result.code, "CURRENT_SAFETY_DECISION_REQUIRED");
});

test("primary-selection-authority fails closed when the latest Technical request is not Approved or targets another safety version", async () => {
  const sql = fixture();
  seedRun(sql, {
    id: "run-current",
    boqItemId: "boq-1",
    version: 1,
    candidates: [{ id: "candidate-1", productId: "product-1", rank: 1 }],
  });
  seedSafety(sql, { id: "safety-v1", boqItemId: "boq-1", candidateId: "candidate-1", version: 1 });
  seedApproval(sql, {
    id: "approval-stale-version",
    safetyDecisionId: "safety-v1",
    status: "Approved",
    entityVersion: 0,
    decidedAt: "2026-09-25T08:00:00.000Z",
    createdAt: "2026-09-25T08:00:00.000Z",
  });
  seedApproval(sql, {
    id: "approval-latest-rejected",
    safetyDecisionId: "safety-v1",
    status: "Rejected",
    entityVersion: 1,
    decidedAt: "2026-09-25T09:00:00.000Z",
    createdAt: "2026-09-25T09:00:00.000Z",
  });

  const result = await resolveCurrentPrimarySelection(d1(sql), "boq-1");

  assert.equal(result.status, "PROVISIONAL");
  assert.equal(result.approved, false);
  assert.equal(result.selection, null);
  assert.equal(result.technicalApproval.id, "approval-latest-rejected");
  assert.equal(result.code, "TECHNICAL_APPROVAL_REQUIRED");
  assert.match(result.blocker, /latest durable Technical approval request.*Rejected/i);
});

test("primary-selection-authority fails closed instead of ranking when two current candidates are Approved", async () => {
  const sql = fixture();
  seedRun(sql, {
    id: "run-current",
    boqItemId: "boq-1",
    version: 1,
    candidates: [
      { id: "candidate-1", productId: "product-1", rank: 1 },
      { id: "candidate-2", productId: "product-2", rank: 2 },
    ],
  });
  for (const candidateId of ["candidate-1", "candidate-2"]) {
    seedSafety(sql, { id: `safety-${candidateId}`, boqItemId: "boq-1", candidateId, version: 1 });
    seedApproval(sql, {
      id: `approval-${candidateId}`,
      safetyDecisionId: `safety-${candidateId}`,
      status: "Approved",
      entityVersion: 1,
      decidedAt: "2026-09-25T09:00:00.000Z",
      createdAt: "2026-09-25T09:00:00.000Z",
    });
  }

  const result = await resolveCurrentPrimarySelection(d1(sql), "boq-1");

  assert.equal(result.status, "AMBIGUOUS");
  assert.equal(result.approved, false);
  assert.equal(result.selection, null);
  assert.equal(result.provisionalCandidate, null);
  assert.deepEqual(result.candidateIds, ["candidate-1", "candidate-2"]);
  assert.equal(result.code, "MULTIPLE_TECHNICAL_APPROVALS");
});

test("primary-selection-authority BOM and cost workers consume the one canonical resolver", async () => {
  const bom = await readFile(new URL("../worker/boq-line-bom-api.mjs", import.meta.url), "utf8");
  const cost = await readFile(new URL("../worker/boq-line-cost-api.mjs", import.meta.url), "utf8");

  for (const worker of [bom, cost]) {
    assert.match(worker, /resolveCurrentPrimarySelection/);
    assert.doesNotMatch(worker, /FROM safety_decisions/i);
    assert.doesNotMatch(worker, /FROM safety_approval_requests/i);
  }

  assert.match(bom, /hasPrimaryProduct: selectionAuthority\.approved && Boolean\(product\)/);
  assert.match(cost, /const selection = selectionAuthority\.approved \? selectionAuthority\.selection : null/);
  assert.match(cost, /if \(!bomReady \|\| !selection\)/);
});
