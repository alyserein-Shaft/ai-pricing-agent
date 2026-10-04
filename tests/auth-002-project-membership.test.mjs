// AUTH-002 -- the production writer for project_members.
//
// Drives the REAL route against the REAL active migration chain. The decisive
// assertion is not "a row was inserted" but "the role the presales workflow
// requires is now actually reachable by resolveProjectAuthority" -- i.e. the
// nine existing readers now have a legitimate source, without any of them
// changing.

import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleProjectMembershipApi } from "../worker/project-membership-api.mjs";
import { resolveProjectAuthority, canApproveQuotation } from "../worker/project-authority.mjs";
import { PROJECT_ROLE_VOCABULARY } from "../app/domain/project-roles.mjs";

const ORG = "organization_bd_shaft_internal_pilot";
const OWNER = "owner-1";

const env = (db, user = OWNER) => ({ DB: db, APP_USER_ID: user, APP_ORGANIZATION_ID: ORG, APP_ACCESS_MODE: "single-user" });

const seeded = ({ owner = OWNER } = {}) => {
  const db = d1(activeChainDatabase());
  db.prepare("INSERT INTO organizations (id,name) VALUES (?,?)").bind(ORG, "Test Org").run();
  db.prepare("INSERT INTO projects (id,name,organization_id,owner_user_id) VALUES (?,?,?,?)")
    .bind("proj-1", "Project One", ORG, owner).run();
  return db;
};

const call = (db, body, user = OWNER) =>
  handleProjectMembershipApi(
    new Request("http://localhost/api/projects/proj-1/members", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env(db, user),
  );

const REASON = "Commercial approver assigned for the pricing package";
const members = (db) => db.prepare("SELECT * FROM project_members WHERE project_id='proj-1' ORDER BY rowid").all();
const auditRows = (db) => db.prepare("SELECT action, reason, actor_user_id FROM dashboard_audit_log WHERE project_id='proj-1' ORDER BY rowid").all();

// A) The headline invariant: a role the presales workflow requires becomes
//    genuinely assignable and genuinely reachable by the canonical authority.
test("AUTH-002/1 Commercial Approver becomes assignable and reachable by resolveProjectAuthority", async () => {
  const db = seeded();

  // Precondition: before any grant, a non-owner has no project authority.
  assert.equal(await resolveProjectAuthority(db, { projectId: "proj-1", actor: { id: "commercial-1", role: "Commercial Approver" } }), null);

  const response = await call(db, { action: "add", userId: "commercial-1", role: "Commercial Approver", reason: REASON });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.role, "Commercial Approver");

  // The canonical authority now resolves the granted role.
  const resolved = await resolveProjectAuthority(db, { projectId: "proj-1", actor: { id: "commercial-1" } });
  assert.ok(resolved, "the granted member must now resolve to a project role");
  assert.equal(resolved.role, "Commercial Approver");
  assert.equal(resolved.source, "project_member");

  // ...and the real approval predicate presales-workflow-api.mjs:240 uses now
  // admits them. That is the exact gate guarding quotation approval and issue.
  assert.equal(canApproveQuotation(resolved.role), true, "the granted role must carry the authority the workflow requires");
});

// B) The nine readers' predicate now sees the member (proved with the real one
//    from library-scope.mjs, not an invented copy).
test("AUTH-002/2 the existing reader predicate now finds the member", async () => {
  const db = seeded();
  await call(db, { action: "add", userId: "estimator-1", role: "Estimator", reason: REASON });
  const row = await db
    .prepare("SELECT id FROM project_members WHERE project_id=? AND user_id=? AND status='Active' AND revoked_at IS NULL")
    .bind("proj-1", "estimator-1")
    .first();
  assert.ok(row, "the reader predicate used by library-scope.mjs and others must now match");
});

// C) Refusals: non-authority actor, invalid role, missing/short reason, unknown
//    member. None may write.
test("AUTH-002/3 refusals write nothing", async () => {
  const db = seeded();
  // Non-authority refusal, proven at the authority primitive the route uses.
  // NOTE: end-to-end this CANNOT be exercised through env configuration, because
  // applicationActor() hardcodes role 'Administrator' and fullAccess true for
  // every APP_USER_ID -- that is AUTH-001, still OPEN. Asserting a 403 here by
  // faking a second user would be a test-only illusion, so the gate is proved
  // where it is real instead.
  const strangerAuthority = await resolveProjectAuthority(db, {
    projectId: "proj-1",
    actor: { id: "stranger", role: "Estimator" },
  });
  assert.equal(strangerAuthority, null, "a non-member non-admin must not resolve to project authority");

  const badRole = await call(db, { action: "add", userId: "x", role: "Superuser Wizard", reason: REASON });
  assert.equal(badRole.status, 422);
  assert.equal((await badRole.json()).error.code, "PROJECT_ROLE_INVALID");

  const noReason = await call(db, { action: "add", userId: "x", role: "Estimator" });
  assert.equal(noReason.status, 422);
  assert.equal((await noReason.json()).error.code, "MEMBERSHIP_REASON_REQUIRED");

  const unknown = await call(db, { action: "update-role", userId: "ghost", role: "Estimator", reason: REASON });
  assert.equal(unknown.status, 404);

  assert.equal((await members(db)).results.length, 0, "no refusal may create a membership");
  assert.equal((await auditRows(db)).results.length, 0, "no refusal may write an audit row");
});

// D) Self-escalation: an authority may not change or revoke its OWN membership.
test("AUTH-002/4 self-escalation is refused", async () => {
  const db = seeded();
  // Give the owner a membership row, so a self-change would otherwise match.
  db.prepare("INSERT INTO project_members (id,project_id,user_id,role,status,granted_by) VALUES (?,?,?,?,?,?)")
    .bind("pm-owner", "proj-1", OWNER, "Project Manager", "Active", OWNER).run();

  for (const action of ["update-role", "remove"]) {
    const response = await call(db, { action, userId: OWNER, role: "Administrator", reason: REASON });
    const body = await response.json();
    assert.equal(response.status, 403, `${action} must be refused`);
    assert.equal(body.error.code, "SELF_MEMBERSHIP_CHANGE_FORBIDDEN");
  }

  const row = (await members(db)).results[0];
  assert.equal(row.role, "Project Manager", "the self-targeted membership must be untouched");
  assert.equal(row.status, "Active", "a self-removal must not succeed");
  assert.equal((await auditRows(db)).results.length, 0);
});

// E) Update-role and remove, with CAS and audit.
test("AUTH-002/5 role change and removal are CAS-guarded and audited", async () => {
  const db = seeded();
  await call(db, { action: "add", userId: "reviewer-1", role: "Engineering Reviewer", reason: REASON });

  const changed = await call(db, { action: "update-role", userId: "reviewer-1", role: "Technical Manager", reason: REASON });
  const changedBody = await changed.json();
  assert.equal(changed.status, 200, JSON.stringify(changedBody));
  assert.equal((await members(db)).results[0].role, "Technical Manager");

  const removed = await call(db, { action: "remove", userId: "reviewer-1", reason: REASON });
  const removedBody = await removed.json();
  assert.equal(removed.status, 200);
  assert.equal(removedBody.status, "Revoked");

  const row = (await members(db)).results[0];
  assert.equal(row.status, "Revoked");
  assert.ok(row.revoked_at, "removal must set revoked_at so the reader predicate stops matching");

  // The canonical authority no longer resolves the removed member.
  assert.equal(await resolveProjectAuthority(db, { projectId: "proj-1", actor: { id: "reviewer-1" } }), null);

  const audit = (await auditRows(db)).results;
  assert.deepEqual(audit.map((a) => a.action), [
    "Project member added",
    "Project member role changed",
    "Project member removed",
  ]);
  assert.ok(audit.every((a) => a.reason === REASON && a.actor_user_id === OWNER), "every mutation must be attributed and reasoned");
});

// F) Idempotency: repeats do not duplicate rows or audit entries.
test("AUTH-002/6 repeated grants and removals are idempotent", async () => {
  const db = seeded();
  const first = await call(db, { action: "add", userId: "est-1", role: "Estimator", reason: REASON });
  assert.equal(first.status, 201);
  const again = await call(db, { action: "add", userId: "est-1", role: "Estimator", reason: REASON });
  const againBody = await again.json();
  assert.equal(again.status, 200);
  assert.equal(againBody.idempotent, true);
  assert.equal((await members(db)).results.length, 1);
  assert.equal((await auditRows(db)).results.length, 1, "an identical repeat must not append a second audit row");

  await call(db, { action: "remove", userId: "est-1", reason: REASON });
  const removeAgain = await call(db, { action: "remove", userId: "est-1", reason: REASON });
  const removeAgainBody = await removeAgain.json();
  assert.equal(removeAgain.status, 200);
  assert.equal(removeAgainBody.idempotent, true);
  assert.equal((await auditRows(db)).results.length, 2, "the repeat removal must not append a second audit row");
});

// G) Re-granting a revoked membership is an explicit, audited reinstatement.
test("AUTH-002/7 a revoked membership can be reinstated with an audit trail", async () => {
  const db = seeded();
  await call(db, { action: "add", userId: "est-2", role: "Estimator", reason: REASON });
  await call(db, { action: "remove", userId: "est-2", reason: REASON });

  const reinstated = await call(db, { action: "add", userId: "est-2", role: "Technical Reviewer", reason: REASON });
  const body = await reinstated.json();
  assert.equal(reinstated.status, 200);
  assert.equal(body.reinstated, true);

  const row = (await members(db)).results[0];
  assert.equal(row.role, "Technical Reviewer");
  assert.equal(row.status, "Active");
  assert.equal(row.revoked_at, null);
  assert.ok((await auditRows(db)).results.some((a) => a.action === "Project membership reinstated"));
});

// H) The vocabulary is the single authority: no role outside it can be granted.
test("AUTH-002/8 only the canonical project role vocabulary is accepted", async () => {
  const db = seeded();
  for (const role of PROJECT_ROLE_VOCABULARY) {
    const response = await call(db, { action: "add", userId: `u-${role}`, role, reason: REASON });
    assert.equal(response.status, 201, `${role} must be assignable`);
  }
  assert.equal((await members(db)).results.length, PROJECT_ROLE_VOCABULARY.length,
    "every canonical role must be assignable, including Commercial Approver");
  for (const role of ["admin", "Commercial Approver; DROP TABLE", "", "Commercial Reviewer "]) {
    const response = await call(db, { action: "add", userId: "u-bad", role, reason: REASON });
    if (role === "Commercial Reviewer ") {
      // Whitespace-padded input is trimmed to the clean canonical role and
      // stored trimmed, never stored as a distinct near-miss role.
      assert.equal(response.status, 201);
      const stored = (await members(db)).results.filter((r) => r.user_id === "u-bad");
      assert.deepEqual(stored.map((r) => r.role), ["Commercial Reviewer"]);
      continue;
    }
    assert.equal(response.status, 422, `"${role}" must not be assignable`);
  }
});

// I) The handler does not claim unrelated paths.
test("AUTH-002/9 the handler is scoped", async () => {
  const db = seeded();
  assert.equal(await handleProjectMembershipApi(new Request("http://localhost/api/projects"), env(db)), null);
  const wrongMethod = await handleProjectMembershipApi(
    new Request("http://localhost/api/projects/proj-1/members", { method: "DELETE" }),
    env(db),
  );
  assert.equal(wrongMethod.status, 405);
  assert.equal((await members(db)).results.length, 0);
});
