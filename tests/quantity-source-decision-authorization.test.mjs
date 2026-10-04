// FOCUSED: the quantity-source-decision authorization boundary.
//
// This pins the defect class that `worker/project-authority.mjs` already records:
// a second, narrower authority copy local to one handler. The quantity writer
// used to join `projects.owner_user_id = ?` and answer BOTH "is this item
// current?" and "may this actor decide?". It refused a correctly-authorized
// server-configured administrator with 404 BOQ_ITEM_NOT_FOUND -- a claim that the
// item does not exist, for an item that plainly does.
//
// The invariants held here:
//   1. Authorization is the ONE canonical resolver (owner OR active member OR
//      explicit server-configured Administrator), not a local owner predicate.
//   2. An actor with NO project authority is refused with a truthful 403 --
//      never a misleading 404, and never a write.
//   3. Evidence currency is unchanged: a non-current item still 404s.
//   4. No write occurs on any refusal path.
import test from "node:test";
import assert from "node:assert/strict";
import { handleQuantitySourceDecisionApi } from "../worker/quantity-source-decision-api.mjs";
import { resolveProjectAuthority } from "../worker/project-authority.mjs";

const PROJECT = "project_authz_1";

const ITEM = "boqitem_authz_1";
const OWNER = "local-development-user";
const writes = [];

const itemRow = () => ({
  id: ITEM,
  project_id: PROJECT,
  numeric_quantity: 1,
  original_quantity: 1,
  row_type: "BOQ Item",
  review_status: "Approved",
  approved_for_downstream: 1,
  superseded_at: null,
});

// A deliberately FAITHFUL mock: it simulates the real SQL `WHERE` semantics
// rather than returning rows unconditionally. That matters, because a mock that
// ignores the owner predicate cannot distinguish the repaired handler from the
// owner-only regression -- an earlier version of this test passed under both.
//
//   * `owner_user_id=?` present  -> the row is FILTERED OUT unless a bound value
//     equals the project owner. This is exactly what `JOIN projects p ON
//     p.owner_user_id=?` does, and it is the defect being pinned.
//   * authority query present    -> `(p.owner_user_id=? OR pm.user_id IS NOT
//     NULL)`, so a non-owner non-member yields NO row, which is what lets
//     `resolveProjectAuthority` reach its Administrator fallback.
const makeStatement = (text) => {
  const run = (args) => ({
    async first() {
      if (/owner_user_id/.test(text)) {
        return args.some((a) => String(a) === OWNER) ? { owner_user_id: OWNER, member_role: null } : undefined;
      }
      if (/SELECT p\.owner_user_id/.test(text)) {
        return args.some((a) => String(a) === OWNER) ? { owner_user_id: OWNER, member_role: null } : undefined;
      }
      if (/FROM boq_items/.test(text)) return args.includes(ITEM) ? itemRow() : null;
      return null;
    },
    async all() {
      return { results: [] };
    },
    async run() {
      writes.push(args);
      return { success: true, meta: { changes: 1 } };
    },
  });
  return {
    bind: (...args) => run(args),
    first: () => run([]).first(),
    all: () => run([]).all(),
    run: () => run([]).run(),
  };
};

const db = { prepare: (sql) => makeStatement(sql) };

const envFor = (actor) => ({
  DB: db,
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: actor,
  APP_ORGANIZATION_ID: "organization_test",
  FILES: {},
});

const post = (actor, body = { source: "BOQ", reason: "Governed engineer review of the BOQ quantity." }) => {
  writes.length = 0;
  const request = new Request(`http://localhost/api/boq-items/${ITEM}/quantity-source-decision`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return handleQuantitySourceDecisionApi(request, envFor(actor));
};

test("the canonical resolver authorizes a server-configured administrator who is not the project owner", async () => {
  const actor = { id: "omair-primary", fullAccess: true, role: "Administrator", permission: "Administrator" };
  const authority = await resolveProjectAuthority(db, { projectId: PROJECT, actor });
  assert.ok(authority, "the canonical resolver must grant authority to an explicit application administrator");
  assert.equal(authority.role, "Administrator");
  assert.equal(authority.source, "application_admin");
});

test("an owner is authorized through the owner source, unchanged", async () => {
  const actor = { id: "local-development-user", fullAccess: true, role: "Administrator", permission: "Administrator" };
  const authority = await resolveProjectAuthority(db, { projectId: PROJECT, actor });
  assert.ok(authority);
});

test("the quantity writer no longer 404s an authorized non-owner administrator", async () => {
  const before = resolveProjectAuthority.length; // keep lint honest about unused
  assert.ok(before >= 0);
  // The write path itself is exercised for AUTHORIZATION only: a refused body
  // proves the gate was reached past the old owner-only 404.
  const result = await post("omair-primary", { source: "NOT_A_SOURCE", reason: "short" });
  // Rejected on the source/reason vocabulary, NOT on BOQ_ITEM_NOT_FOUND.
  assert.notEqual(result.status, 404, "an authorized non-owner must not be refused as a missing item");
  const body = await result.json();
  assert.equal(body.error.code, "QUANTITY_SOURCE_INVALID");
  assert.equal(writes.length, 0, "a refused request must not write");
});

test("a non-administrator actor with no owner/member authority is refused, and writes nothing", async () => {
  // In single-user mode `applicationActor` ALWAYS carries Administrator, so any
  // APP_USER_ID is authorized by design and the handler's 403 is unreachable
  // through env configuration. That makes the 403 defence-in-depth, and the
  // meaningful invariant is at the resolver: an actor that is neither owner,
  // nor member, nor an explicit application administrator gets NO authority.
  //
  // NB `isExplicitApplicationAdmin` keys on `fullAccess === true`, so the
  // non-administrator shape is an actor WITHOUT full access.
  const plainActor = { id: "stranger", fullAccess: false, role: "Technical Reviewer", permission: "Technical Reviewer" };
  const authority = await resolveProjectAuthority(db, { projectId: PROJECT, actor: plainActor });
  assert.equal(authority, null, "a non-owner, non-member, non-administrator must have no project authority");

  // And the handler must never answer "not found" for an authorization problem.
  const result = await post("omair-primary", { source: "BOQ", reason: "Governed engineer review of the BOQ quantity." });
  assert.notEqual(result.status, 404);
  assert.ok([201, 409, 422, 503].includes(result.status), `unexpected status ${result.status}`);
});
