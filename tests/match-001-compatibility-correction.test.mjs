// MATCH-001 Slice 2 -- governed correction lifecycle for compatibility.
//
// Drives the REAL production route against the REAL active migration chain.
// The critical invariant under test: a relationship previously considered valid
// must be correctable WITHOUT direct database editing, and a corrected
// relationship must stop being current Approved authority for every consumer.

import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleCompatibilityGovernanceApi } from "../worker/compatibility-governance-api.mjs";

const ORG = "organization_bd_shaft_internal_pilot";
const USER = "owner-1";

const env = (db) => ({ DB: db, APP_USER_ID: USER, APP_ORGANIZATION_ID: ORG, APP_ACCESS_MODE: "single-user" });

// A project owned by USER, so project-scoped ownership is exercisable.
const seeded = ({ projectOwnedBy = USER } = {}) => {
  const db = d1(activeChainDatabase());
  db.prepare("INSERT INTO product_manufacturers (id,name,normalized_name,created_by) VALUES (?,?,?,?)")
    .bind("m1", "Honeywell", "HONEYWELL", "seed").run();
  db.prepare("INSERT INTO product_families (id,name,normalized_name) VALUES (?,?,?)")
    .bind("f1", "Series A", "SERIES A").run();
  const product = db.prepare(
    `INSERT INTO library_products
       (id,manufacturer_id,family_id,part_number,normalized_part_number,description,
        identity_status,library_scope,approved_for_discovery,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  product.bind("p-src", "m1", "f1", "SRC-100", "SRC100", "Source", "Active", "Global Library", 1, "seed").run();
  product.bind("p-tgt", "m1", "f1", "TGT-200", "TGT200", "Target", "Active", "Global Library", 1, "seed").run();
  // organizations must exist first: projects.organization_id is a real FK.
  db.prepare("INSERT INTO organizations (id,name) VALUES (?,?)").bind(ORG, "Test Org").run();
  db.prepare("INSERT INTO projects (id,name,organization_id,owner_user_id) VALUES (?,?,?,?)")
    .bind("proj-1", "Project One", ORG, projectOwnedBy).run();
  return db;
};

const seedRelationship = (db, { id = "rel-1", projectId = null } = {}) =>
  db.prepare(
    `INSERT INTO engineering_relationships
       (id,project_id,left_entity_type,left_entity_id,relationship_type,right_entity_type,right_entity_id,
        status,version_number,fact_type,scope_type,confidence,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind(id, projectId, "Product", "p-src", "Compatible With", "Product", "p-tgt",
          "Approved", 1, "Compatibility", projectId ? "Project" : "Global", 90, "seed")
    .run();

const decide = (id, body) =>
  new Request(`http://localhost/api/compatibility/relationships/${encodeURIComponent(id)}/decide`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const REASON = "Manufacturer datasheet revision supersedes this pairing";

// The predicate product-matching-api.mjs:120 and technical-requirement-api.mjs:111 use.
const consumerSeesApproved = async (db, leftId = "p-src") =>
  (await db.prepare(
    `SELECT id FROM engineering_relationships
      WHERE left_entity_type='Product' AND left_entity_id=? AND status='Approved' AND effective_to IS NULL`,
  ).bind(leftId).all()).results;

const technicalRequirementSees = async (db) =>
  (await db.prepare(
    `SELECT id FROM engineering_relationships
      WHERE status IN ('Active','Approved','Confirmed') AND left_entity_id='p-src'`,
  ).all()).results;

const auditRows = async (db) =>
  (await db.prepare("SELECT action, reason, decided_by FROM product_library_decisions ORDER BY rowid").all()).results;

// A) Withdraw works through the route and removes current Approved authority.
test("MATCH-001/2A a withdrawn relationship stops being current Approved authority", async () => {
  const db = seeded();
  seedRelationship(db);
  assert.equal((await consumerSeesApproved(db)).length, 1, "precondition: visible before");

  const response = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "withdraw", reason: REASON }), env(db));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, "Withdrawn");

  const row = (await db.prepare("SELECT status, effective_to, reviewed_by FROM engineering_relationships WHERE id='rel-1'").all()).results[0];
  assert.equal(row.status, "Withdrawn");
  assert.ok(row.effective_to, "withdrawal must set effective_to so the row can never read as current");
  assert.equal(row.reviewed_by, USER, "the deciding actor must be recorded");

  assert.equal((await consumerSeesApproved(db)).length, 0, "the matching consumer must no longer see it");
  assert.equal((await technicalRequirementSees(db)).length, 0, "the requirement-applicability consumer must no longer see it");

  const audit = await auditRows(db);
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, "Compatibility withdraw");
  assert.equal(audit[0].reason, REASON);
  assert.equal(audit[0].decided_by, USER);
});

// B) Reject works and is likewise terminal.
test("MATCH-001/2B a rejected relationship stops being current Approved authority", async () => {
  const db = seeded();
  seedRelationship(db);
  const response = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "reject", reason: REASON }), env(db));
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.status, "Rejected");
  assert.equal((await consumerSeesApproved(db)).length, 0);
  assert.equal((await auditRows(db))[0].action, "Compatibility reject");
});

// C) Refusals: unknown action, missing/short reason, unknown relationship.
test("MATCH-001/2C invalid action, missing reason and unknown relationship are refused", async () => {
  const db = seeded();
  seedRelationship(db);

  const badAction = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "delete", reason: REASON }), env(db));
  assert.equal(badAction.status, 422);
  assert.equal((await badAction.json()).error.code, "COMPATIBILITY_DECISION_INVALID");

  const noReason = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "withdraw" }), env(db));
  assert.equal(noReason.status, 422);
  assert.equal((await noReason.json()).error.code, "COMPATIBILITY_DECISION_REASON_REQUIRED");

  const shortReason = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "withdraw", reason: "no" }), env(db));
  assert.equal(shortReason.status, 422);

  const missing = await handleCompatibilityGovernanceApi(decide("does-not-exist", { action: "withdraw", reason: REASON }), env(db));
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "COMPATIBILITY_RELATIONSHIP_NOT_FOUND");

  // Nothing was written by any refusal.
  assert.equal((await consumerSeesApproved(db)).length, 1, "a refused decision must not change the relationship");
  assert.equal((await auditRows(db)).length, 0, "a refused decision must not write an audit row");
});

// D) Idempotency: repeating the same decision is a no-op, not a second write.
test("MATCH-001/2D repeating a decision is idempotent and does not duplicate the audit", async () => {
  const db = seeded();
  seedRelationship(db);
  const first = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "withdraw", reason: REASON }), env(db));
  assert.equal(first.status, 200);

  const second = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "withdraw", reason: REASON }), env(db));
  const secondBody = await second.json();
  assert.equal(second.status, 200);
  assert.equal(secondBody.idempotent, true);

  assert.equal((await auditRows(db)).length, 1, "a repeat must not append a second audit row");
});

// E) A terminal relationship cannot be re-decided into a different terminal state.
test("MATCH-001/2E a relationship already corrected cannot be re-decided", async () => {
  const db = seeded();
  seedRelationship(db);
  await handleCompatibilityGovernanceApi(decide("rel-1", { action: "withdraw", reason: REASON }), env(db));

  const second = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "reject", reason: REASON }), env(db));
  const body = await second.json();
  assert.equal(second.status, 409);
  assert.equal(body.error.code, "COMPATIBILITY_DECISION_NOT_ALLOWED");
  assert.equal(body.currentStatus, "Withdrawn");
  assert.equal((await auditRows(db)).length, 1, "the refused second decision must not write");
});

// F) Project ownership: a project-scoped relationship may only be corrected by
//    that project's owner.
test("MATCH-001/2F a project-scoped relationship requires that project's owner", async () => {
  const db = seeded({ projectOwnedBy: "someone-else" });
  seedRelationship(db, { projectId: "proj-1" });

  const denied = await handleCompatibilityGovernanceApi(decide("rel-1", { action: "withdraw", reason: REASON }), env(db));
  const deniedBody = await denied.json();
  assert.equal(denied.status, 403);
  assert.equal(deniedBody.error.code, "PROJECT_AUTHORITY_REQUIRED");
  assert.equal((await consumerSeesApproved(db)).length, 1, "a denied correction must change nothing");
  assert.equal((await auditRows(db)).length, 0);
});

// G) Supersession is a composition, not a new state: withdraw the old, then
//    auto-confirm the replacement through the Slice 1 route.
test("MATCH-001/2G a superseded pairing is replaced by withdraw + re-confirm, with no invented status", async () => {
  const db = seeded();
  seedRelationship(db, { id: "rel-old" });

  // While the old statement stands, the authority refuses a second Approved row.
  const blocked = await handleCompatibilityGovernanceApi(
    new Request("http://localhost/api/compatibility/relationships/auto-confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceProductId: "p-src",
        targetProductId: "p-tgt",
        relationshipType: "Compatible With",
        evidenceClassification: "EXPLICIT_EXACT",
        evidenceJson: JSON.stringify({ doc: "DS-SRC-100 Rev D" }),
        sourceDocumentNumber: "DS-SRC-100",
        sourceDocumentRevision: "Rev D",
      }),
    }),
    env(db),
  );
  assert.equal(blocked.status, 200, "the duplicate gate reports idempotency while the old row stands");
  assert.equal((await blocked.json()).idempotent, true);

  // Withdraw it, then the replacement can be governed.
  await handleCompatibilityGovernanceApi(decide("rel-old", { action: "withdraw", reason: REASON }), env(db));

  const replaced = await handleCompatibilityGovernanceApi(
    new Request("http://localhost/api/compatibility/relationships/auto-confirm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceProductId: "p-src",
        targetProductId: "p-tgt",
        relationshipType: "Compatible With",
        evidenceClassification: "EXPLICIT_EXACT",
        evidenceJson: JSON.stringify({ doc: "DS-SRC-100 Rev D" }),
        sourceDocumentNumber: "DS-SRC-100",
        sourceDocumentRevision: "Rev D",
      }),
    }),
    env(db),
  );
  const replacedBody = await replaced.json();
  assert.equal(replaced.status, 201, JSON.stringify(replacedBody));

  // The authority mints its own relationship id, so assert the status SET: the
  // old statement is Withdrawn and exactly one new statement is Approved. No
  // 'Superseded' status was invented for this transition.
  const statuses = (await db.prepare("SELECT status FROM engineering_relationships ORDER BY rowid").all()).results
    .map((row) => row.status)
    .sort();
  assert.deepEqual(statuses, ["Approved", "Withdrawn"], "old withdrawn, replacement approved, no invented status");
  assert.equal((await consumerSeesApproved(db)).length, 1, "exactly one current Approved relationship remains");
});

// H) Method guard on the decision route.
test("MATCH-001/2H the decision route refuses non-POST", async () => {
  const db = seeded();
  seedRelationship(db);
  const response = await handleCompatibilityGovernanceApi(
    new Request("http://localhost/api/compatibility/relationships/rel-1/decide"),
    env(db),
  );
  assert.equal(response.status, 405);
  assert.equal((await consumerSeesApproved(db)).length, 1, "a method refusal must change nothing");
});
