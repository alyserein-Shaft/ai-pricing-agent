import test, { mock } from "node:test";
import assert from "node:assert/strict";

// KN-LINK-FACT-HOTFIX: the `globalThis.clean` mask that used to sit here is
// gone. It was behaviourally identical to the module's own `cleanText`, so it
// let the POST link tests pass while the real Worker threw
// `ReferenceError: clean is not defined` -- the mask supplied the right
// behaviour from the wrong source and hid a dead production call. The POST
// tests below now execute the real route with no injected global, which is
// what makes them a regression guard for that defect. Do not reintroduce a
// global shim to make these pass.

// ---------------------------------------------------------------------------
// Auth mock: the real single-user application context always yields a
// fullAccess Administrator, so a 403 LIBRARY_PERMISSION_DENIED path can never
// be reached through the real auth. Mock ONLY the auth module so the denial
// path can be exercised. requireLibraryCapability logic below mirrors
// worker/library-auth.mjs (PERMISSION_RANK + LIBRARY_CAPABILITIES + problem()).
// ---------------------------------------------------------------------------
const TEST_ORG_ID = "org-test";
const mockActorState = {
  actor: {
    id: "op-test-human-1",
    email: "test@example.invalid",
    fullName: "Test User",
    organizationId: TEST_ORG_ID,
    permission: "Administrator",
    role: "Administrator",
    fullAccess: true,
  },
};
const PERMISSION_RANK = {
  "Library Viewer": 10,
  "Library Reviewer": 20,
  "Library Manager": 30,
  Administrator: 40,
};
const LIBRARY_CAPABILITIES = {
  read: "Library Viewer",
  analyze: "Library Reviewer",
  review: "Library Reviewer",
  approve: "Library Manager",
  apply: "Library Manager",
  reverse: "Library Manager",
  link: "Library Manager",
};
mock.module("../worker/library-auth.mjs", {
  exports: {
    authenticateLibraryActor: async () => ({ actor: mockActorState.actor }),
    requireLibraryCapability: (actor, capability) =>
      actor?.fullAccess
      || Number(PERMISSION_RANK[actor?.permission || actor?.role] || 0)
        >= Number(PERMISSION_RANK[LIBRARY_CAPABILITIES[capability]] || Infinity)
        ? null
        : {
          status: 403,
          code: "LIBRARY_PERMISSION_DENIED",
          message: `The ${LIBRARY_CAPABILITIES[capability]} permission is required for this operation.`,
        },
  },
});

const { handleKnowledgeLibraryApi } = await import("../worker/knowledge-library-api.mjs");

// ---------------------------------------------------------------------------
// Read-only mock D1: resolves org + schema check + fact/link rows, and throws
// on ANY mutation API so a write attempt fails the test immediately.
// ---------------------------------------------------------------------------
function makeGetDb({ facts = {}, links = [] } = {}) {
  const calls = { first: [], all: [], run: 0, batch: 0 };
  const db = {
    calls,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              calls.first.push(sql);
              if (sql.includes("FROM organizations")) {
                return { id: args[0], name: "Test Org" };
              }
              if (sql.includes("FROM knowledge_facts")) {
                const fact = facts[args[0]];
                return fact && fact.organization_id === args[1] ? fact : null;
              }
              throw new Error(`Unexpected .first() query in test: ${sql}`);
            },
            async all() {
              calls.all.push({ sql, args });
              if (sql.includes("sqlite_master")) {
                return { results: args.map((name) => ({ name })) };
              }
              if (sql.includes("FROM knowledge_product_links")) {
                assert.ok(
                  !/LIMIT\s+1/i.test(sql),
                  `GET must not use LIMIT 1: ${sql}`,
                );
                const rows = links
                  .filter((row) => row.knowledge_fact_id === args[0] && row.organization_id === args[1])
                  .slice()
                  .sort((a, b) => (
                    a.created_at < b.created_at ? -1
                    : a.created_at > b.created_at ? 1
                    : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
                  ));
                return { results: rows };
              }
              throw new Error(`Unexpected .all() query in test: ${sql}`);
            },
            async run() {
              calls.run += 1;
              throw new Error("Mutation attempted on read-only GET path (.run).");
            },
          };
        },
      };
    },
    async batch() {
      calls.batch += 1;
      throw new Error("Mutation attempted on read-only GET path (.batch).");
    },
  };
  return db;
}

const getRequest = (factId) => new Request(
  `http://localhost/api/knowledge/link/fact/${encodeURIComponent(factId)}`,
  { method: "GET" },
);

const assertNoMutations = (db, label) => {
  assert.equal(db.calls.run, 0, `${label}: .run() must never be called`);
  assert.equal(db.calls.batch, 0, `${label}: .batch() must never be called`);
};

const FACT_ID = "knowledgeFact_test-2c";
const factRow = (overrides = {}) => ({
  id: FACT_ID,
  organization_id: TEST_ORG_ID,
  ...overrides,
});
const linkRow = (id, partNumber, productId, createdAt) => ({
  id,
  organization_id: TEST_ORG_ID,
  knowledge_fact_id: FACT_ID,
  part_number: partNumber,
  existing_product_id: productId,
  link_state: productId ? "Existing Product — Additive Learning Only" : "New Product Candidate",
  new_information: JSON.stringify({ sourceType: "Supplier Quotation" }),
  created_at: createdAt,
});

// GET-1 — zero links
test("GET /api/knowledge/link/fact/:factId with no persisted links returns UNLINKED", async () => {
  const db = makeGetDb({ facts: { [FACT_ID]: factRow() }, links: [] });
  const response = await handleKnowledgeLibraryApi(getRequest(FACT_ID), { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    factId: FACT_ID,
    linked: false,
    linkCount: 0,
    multipleLinks: false,
    state: "UNLINKED",
    links: [],
  });
  assertNoMutations(db, "GET-1");
});

// GET-2 — exactly one link
test("GET /api/knowledge/link/fact/:factId with one persisted link returns LINKED with the exact row", async () => {
  const stored = linkRow("knowledgeLink_1", "IDP-PHOTO-IV", "product_1", "2026-09-01T00:00:00.000Z");
  const db = makeGetDb({ facts: { [FACT_ID]: factRow() }, links: [stored] });
  const response = await handleKnowledgeLibraryApi(getRequest(FACT_ID), { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.factId, FACT_ID);
  assert.equal(body.linked, true);
  assert.equal(body.linkCount, 1);
  assert.equal(body.multipleLinks, false);
  assert.equal(body.state, "LINKED");
  assert.equal(body.links.length, 1);
  assert.deepEqual(body.links[0], {
    id: "knowledgeLink_1",
    organizationId: TEST_ORG_ID,
    knowledgeFactId: FACT_ID,
    partNumber: "IDP-PHOTO-IV",
    existingProductId: "product_1",
    linkState: "Existing Product — Additive Learning Only",
    newInformation: { sourceType: "Supplier Quotation" },
    createdAt: "2026-09-01T00:00:00.000Z",
  });
  assertNoMutations(db, "GET-2");
});

// GET-3 — multiple persisted links (same fact, different part_number/product)
test("GET /api/knowledge/link/fact/:factId with multiple persisted links returns ALL rows as MULTIPLE_EXISTING_LINKS", async () => {
  const newer = linkRow("knowledgeLink_b", "IDP-PHOTO-IV-B", "product_2", "2026-09-02T00:00:00.000Z");
  const older = linkRow("knowledgeLink_a", "IDP-PHOTO-IV", "product_1", "2026-09-01T00:00:00.000Z");
  // Store out of order to prove the endpoint enforces deterministic ordering.
  const db = makeGetDb({ facts: { [FACT_ID]: factRow() }, links: [newer, older] });
  const response = await handleKnowledgeLibraryApi(getRequest(FACT_ID), { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.factId, FACT_ID);
  assert.equal(body.linked, true);
  assert.equal(body.linkCount, 2);
  assert.equal(body.multipleLinks, true);
  assert.equal(body.state, "MULTIPLE_EXISTING_LINKS");
  assert.equal(body.links.length, 2);
  assert.deepEqual(
    body.links.map((row) => row.id),
    ["knowledgeLink_a", "knowledgeLink_b"],
    "all persisted rows returned in ORDER BY created_at ASC, id ASC; no winner selected",
  );
  assert.equal(body.links[0].existingProductId, "product_1");
  assert.equal(body.links[1].existingProductId, "product_2");
  assertNoMutations(db, "GET-3");
});

// GET-4 — missing fact
test("GET /api/knowledge/link/fact/:factId for a missing fact returns 404 KNOWLEDGE_FACT_NOT_FOUND", async () => {
  const db = makeGetDb({ facts: {}, links: [] });
  const response = await handleKnowledgeLibraryApi(getRequest("knowledgeFact_missing"), { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.code, "KNOWLEDGE_FACT_NOT_FOUND");
  assertNoMutations(db, "GET-4");
});

// GET-5 — cross-organization fact discloses nothing
test("GET /api/knowledge/link/fact/:factId for another organization's fact returns the same 404 without link disclosure", async () => {
  const otherOrgLink = {
    ...linkRow("knowledgeLink_x", "IDP-PHOTO-IV", "product_9", "2026-09-01T00:00:00.000Z"),
    organization_id: "org-other",
  };
  const db = makeGetDb({
    facts: { [FACT_ID]: factRow({ organization_id: "org-other" }) },
    links: [otherOrgLink],
  });
  const response = await handleKnowledgeLibraryApi(getRequest(FACT_ID), { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const body = await response.json();
  assert.equal(response.status, 404);
  assert.equal(body.error.code, "KNOWLEDGE_FACT_NOT_FOUND");
  assert.ok(!("links" in body), "cross-org 404 must not disclose links");
  assert.ok(!("linkCount" in body), "cross-org 404 must not disclose link count");
  assertNoMutations(db, "GET-5");
});

// GET-6 — read permission denied
test("GET /api/knowledge/link/fact/:factId without read capability returns 403 LIBRARY_PERMISSION_DENIED", async () => {
  const previous = mockActorState.actor;
  mockActorState.actor = {
    ...previous,
    permission: "No Access",
    role: "No Access",
    fullAccess: false,
  };
  try {
    const db = makeGetDb({ facts: { [FACT_ID]: factRow() }, links: [] });
    const response = await handleKnowledgeLibraryApi(getRequest(FACT_ID), { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, "LIBRARY_PERMISSION_DENIED");
    assertNoMutations(db, "GET-6");
  } finally {
    mockActorState.actor = previous;
  }
});

// GET-7 — zero mutations across every GET outcome
test("GET /api/knowledge/link/fact/:factId performs zero mutations on every path", async () => {
  const db = makeGetDb({
    facts: { [FACT_ID]: factRow() },
    links: [linkRow("knowledgeLink_1", "IDP-PHOTO-IV", "product_1", "2026-09-01T00:00:00.000Z")],
  });
  for (const factId of [FACT_ID, "knowledgeFact_missing"]) {
    const response = await handleKnowledgeLibraryApi(getRequest(factId), { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
    await response.json();
  }
  assertNoMutations(db, "GET-7");
  const mutationStatements = db.calls.all
    .map((call) => call.sql)
    .filter((sql) => /INSERT|UPDATE|DELETE/i.test(sql));
  assert.deepEqual(mutationStatements, [], "GET must issue read-only SELECT statements only");
});

// GET-8a — existing POST behavior unchanged (fact-not-found derives factId from URL)
test("POST /api/knowledge/link/fact/:factId derives factId from the URL (linkMatch[1]), not the unrelated promoteMatch scope", async () => {
  const TEST_FACT_ID = "knowledgeFact_test-1234";
  const factLookupCalls = [];
  let writeAttempted = false;

  const mockDb = {
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM organizations")) {
                return { id: args[0], name: "Test Org" };
              }
              if (sql.includes("FROM knowledge_facts WHERE id=?")) {
                factLookupCalls.push(args);
                // Intentionally "not found" so the handler returns 404
                // before any write statement is ever constructed.
                return null;
              }
              throw new Error(`Unexpected .first() query in test: ${sql}`);
            },
            async all() {
              if (sql.includes("sqlite_master")) {
                return { results: args.map((name) => ({ name })) };
              }
              throw new Error(`Unexpected .all() query in test: ${sql}`);
            },
            async run() {
              throw new Error(`Unexpected .run() query in test: ${sql}`);
            },
          };
        },
      };
    },
    async batch() {
      writeAttempted = true;
      throw new Error("No write should occur for this test's fact-not-found path.");
    },
  };

  const request = new Request(`http://localhost/api/knowledge/link/fact/${encodeURIComponent(TEST_FACT_ID)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: "Confirmed via governed specification review", productId: "product_test-1" }),
  });

  const response = await handleKnowledgeLibraryApi(request, { DB: mockDb, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const body = await response.json();

  assert.equal(response.status, 404, `expected 404 KNOWLEDGE_FACT_NOT_FOUND, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.error.code, "KNOWLEDGE_FACT_NOT_FOUND");

  assert.equal(factLookupCalls.length, 1, "the knowledge_facts lookup must run exactly once");
  assert.equal(factLookupCalls[0][0], TEST_FACT_ID, "factId bound to the fact lookup must come from the URL's linkMatch[1], not an out-of-scope identifier");

  assert.equal(writeAttempted, false, "no database write may occur on this path");
});

// GET-8b — existing POST conflict/idempotency semantics preserved
test("POST /api/knowledge/link/fact/:factId keeps conflict vs idempotent semantics and performs no writes on either", async () => {
  const makePostDb = (existingProductId) => {
    let writeAttempted = false;
    const fact = {
      id: FACT_ID,
      organization_id: TEST_ORG_ID,
      knowledge_file_id: "knowledgeFile_1",
      fact_type: "Part Number",
      review_status: "Reviewed",
      original_value: "IDP-PHOTO-IV",
      normalized_value: "IDP-PHOTO-IV",
    };
    const db = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              async first() {
                if (sql.includes("FROM organizations")) return { id: args[0], name: "Test Org" };
                if (sql.includes("FROM knowledge_facts WHERE id=?")) return fact;
                if (sql.includes("FROM library_products WHERE id=?")) {
                  return { id: "product_1", organization_id: TEST_ORG_ID, library_scope: "Organization Library", part_number: "IDP-PHOTO-IV" };
                }
                if (sql.includes("COUNT(DISTINCT")) return { count: 1 };
                if (sql.includes("FROM knowledge_product_links WHERE knowledge_fact_id=?")) {
                  return { id: "knowledgeLink_1", existing_product_id: existingProductId };
                }
                throw new Error(`Unexpected .first() query in test: ${sql}`);
              },
              async all() {
                if (sql.includes("sqlite_master")) return { results: args.map((name) => ({ name })) };
                throw new Error(`Unexpected .all() query in test: ${sql}`);
              },
              async run() {
                throw new Error(`Unexpected .run() query in test: ${sql}`);
              },
            };
          },
        };
      },
      async batch() {
        writeAttempted = true;
        throw new Error("No write should occur on conflict/idempotent POST paths.");
      },
      wasWriteAttempted: () => writeAttempted,
    };
    return db;
  };
  const postRequest = () => new Request(
    `http://localhost/api/knowledge/link/fact/${encodeURIComponent(FACT_ID)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: "Confirmed via governed specification review", productId: "product_1" }),
    },
  );

  const conflictDb = makePostDb("product_other");
  const conflict = await handleKnowledgeLibraryApi(postRequest(), { DB: conflictDb, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const conflictBody = await conflict.json();
  assert.equal(conflict.status, 409);
  assert.equal(conflictBody.error.code, "EXISTING_LINK_CONFLICT");
  assert.equal(conflictDb.wasWriteAttempted(), false);

  const idempotentDb = makePostDb("product_1");
  const idempotent = await handleKnowledgeLibraryApi(postRequest(), { DB: idempotentDb, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const idempotentBody = await idempotent.json();
  assert.equal(idempotent.status, 200);
  assert.equal(idempotentBody.idempotent, true);
  assert.equal(idempotentBody.status, "Linked");
  assert.equal(idempotentDb.wasWriteAttempted(), false);
});

// ---------------------------------------------------------------------------
// KN-LINK-FACT-HOTFIX regression guard: the governed SUCCESS path.
//
// Every pre-existing POST test here returns before the write (404 / 409 /
// idempotent 200), so nothing proved that the branch reached by a real link
// decision actually works. That branch is exactly where the repaired
// cleanText(body.reason) value is persisted into the audit event, so the
// defect fix and the audit payload are asserted together here.
// ---------------------------------------------------------------------------
test("POST /api/knowledge/link/fact/:factId on the governed success path links the product, writes the audit event, and persists the TRIMMED reason", async () => {
  const statements = [];
  const batches = [];
  const fact = {
    id: FACT_ID,
    organization_id: TEST_ORG_ID,
    knowledge_file_id: "knowledgeFile_1",
    fact_type: "Part Number",
    review_status: "Reviewed",
    original_value: "IDP-PHOTO-IV",
    normalized_value: "IDP-PHOTO-IV",
  };
  const db = {
    prepare(sql) {
      return {
        bind(...args) {
          const record = { sql, args };
          // The route hands these prepared statements straight to batch(), so
          // they must carry their own sql/args for assertion.
          return {
            sql,
            args,
            async first() {
              if (sql.includes("FROM organizations")) return { id: args[0], name: "Test Org" };
              if (sql.includes("FROM knowledge_facts WHERE id=?")) return fact;
              if (sql.includes("FROM library_products WHERE id=?")) {
                return { id: "product_1", organization_id: TEST_ORG_ID, library_scope: "Organization Library", part_number: "IDP-PHOTO-IV" };
              }
              if (sql.includes("COUNT(DISTINCT")) return { count: 1 };
              if (sql.includes("FROM knowledge_product_links WHERE knowledge_fact_id=?")) return null;
              throw new Error(`Unexpected .first() query in test: ${sql}`);
            },
            async all() {
              if (sql.includes("sqlite_master")) return { results: args.map((name) => ({ name })) };
              throw new Error(`Unexpected .all() query in test: ${sql}`);
            },
            async run() {
              statements.push(record);
              return { success: true };
            },
          };
        },
      };
    },
    async batch(rows) {
      batches.push(rows);
      for (const row of rows) statements.push({ sql: row.sql, args: row.args });
      return rows.map(() => ({ success: true }));
    },
  };

  // Padded on both sides: the audit event must record the trimmed value, which
  // is what cleanText provides and what the removed global shim used to fake.
  const request = new Request(
    `http://localhost/api/knowledge/link/fact/${encodeURIComponent(FACT_ID)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        reason: "   Confirmed via governed specification review   ",
        productId: "  product_1  ",
      }),
    },
  );

  const response = await handleKnowledgeLibraryApi(request, { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
  const body = await response.json();

  assert.equal(response.status, 200, `expected 200, got ${response.status}: ${JSON.stringify(body)}`);
  assert.equal(body.status, "Linked");
  assert.equal(body.itemId, FACT_ID);
  assert.equal(body.kind, "fact");
  // A first-time link is not idempotent; only a repeat against the same product is.
  assert.equal(body.idempotent, undefined, "a new link must not be reported as idempotent");

  // Exactly one atomic batch: the link row and its audit event.
  assert.equal(batches.length, 1, "the link and its audit event must be written in ONE batch");

  const linkInsert = batches[0].find((row) => row.sql.includes("INSERT INTO knowledge_product_links"));
  const eventInsert = batches[0].find((row) => row.sql.includes("INSERT INTO knowledge_file_events"));
  assert.ok(linkInsert, "knowledge_product_links insert must be present");
  assert.ok(eventInsert, "knowledge_file_events insert must be present");
  assert.equal(batches[0].length, 2, "no statement beyond the link and its audit event");

  // Ownership: the link is written for the ACTOR'S organization, and is bound
  // to the fact's own source file for the audit trail.
  assert.equal(linkInsert.args[1], TEST_ORG_ID, "link must be scoped to the actor's organization");
  assert.equal(linkInsert.args[2], FACT_ID, "link must point at the fact from the URL");
  assert.equal(linkInsert.args[3], "IDP-PHOTO-IV", "link records the fact's original value");
  assert.equal(linkInsert.args[4], "product_1", "trimmed productId must be the bound target");

  // Audit/event behaviour: the event references the fact's source file and
  // carries the TRIMMED reason plus actor attribution.
  assert.equal(eventInsert.args[1], TEST_ORG_ID, "event must be scoped to the actor's organization");
  assert.equal(eventInsert.args[2], "knowledgeFile_1", "event must reference the fact's source file");
  assert.equal(eventInsert.args[3], "Knowledge Product Link Decision");
  const details = JSON.parse(eventInsert.args[4]);
  assert.equal(details.reason, "Confirmed via governed specification review", "audit reason must be trimmed");
  assert.equal(details.factId, FACT_ID);
  assert.equal(details.productId, "product_1");
  assert.equal(details.actorId, "op-test-human-1");
  assert.equal(eventInsert.args[5], "op-test-human-1", "event must attribute the acting user");

  // No stray writes outside the batch.
  assert.equal(
    statements.filter((row) => /INSERT|UPDATE|DELETE/i.test(row.sql)).length,
    2,
    "exactly two writes total: the link and its audit event",
  );
});

// ---------------------------------------------------------------------------
// KN-LINK-FACT-HOTFIX: the link route's guard clauses were unproved by any
// suite (KNOWLEDGE_FACT_WRONG_TYPE, KNOWLEDGE_FACT_NOT_REVIEWED,
// PART_NUMBER_MISMATCH and PRODUCT_NOT_FOUND appear in no test). Each is a
// governance or authority gate on a write route, so they are asserted here as
// one table. Every case must fail BEFORE any write.
// ---------------------------------------------------------------------------
test("POST /api/knowledge/link/fact/:factId enforces its governance and authority gates before writing", async () => {
  const BASE_FACT = {
    id: FACT_ID,
    organization_id: TEST_ORG_ID,
    knowledge_file_id: "knowledgeFile_1",
    fact_type: "Part Number",
    review_status: "Reviewed",
    original_value: "IDP-PHOTO-IV",
    normalized_value: "IDP-PHOTO-IV",
  };
  const BASE_PRODUCT = {
    id: "product_1",
    organization_id: TEST_ORG_ID,
      // KN-SCOPE-1: the route validates product visibility with the resolver's
      // shared scope authority, so a realistic product row carries its scope.
      library_scope: "Organization Library",
    part_number: "IDP-PHOTO-IV",
  };

  const runCase = async ({ fact, product, actor, expectStatus, expectCode, body }) => {
    let writeAttempted = false;
    const db = {
      prepare(sql) {
        return {
          bind(...args) {
            return {
              sql,
              args,
              async first() {
                if (sql.includes("FROM organizations")) return { id: args[0], name: "Test Org" };
                if (sql.includes("FROM knowledge_facts WHERE id=?")) {
                  // Faithful to the real predicate `WHERE id=? AND
                  // organization_id=?`: a fact belonging to another
                  // organization must resolve to null, which is what makes the
                  // cross-organization case a 404 rather than a disclosure.
                  if (!fact || fact.organization_id !== args[1]) return null;
                  return fact;
                }
                if (sql.includes("FROM library_products WHERE id=?")) {
                  // KN-SCOPE-1: the route now looks the product up BY ID and
                  // validates visibility with the shared scope authority in
                  // route code, so this mock returns the row as stored. A
                  // cross-organization or out-of-scope row is refused there
                  // (asserted below) rather than by the WHERE clause.
                  return product || null;
                }
                if (sql.includes("COUNT(DISTINCT")) return { count: 1 };
                if (sql.includes("FROM knowledge_product_links WHERE knowledge_fact_id=?")) return null;
                throw new Error(`Unexpected .first() query in test: ${sql}`);
              },
              async all() {
                if (sql.includes("sqlite_master")) return { results: args.map((name) => ({ name })) };
                throw new Error(`Unexpected .all() query in test: ${sql}`);
              },
              async run() {
                writeAttempted = true;
                return { success: true };
              },
            };
          },
        };
      },
      async batch() {
        writeAttempted = true;
        return [];
      },
    };

    const previous = mockActorState.actor;
    if (actor) mockActorState.actor = actor;
    try {
      const request = new Request(
        `http://localhost/api/knowledge/link/fact/${encodeURIComponent(FACT_ID)}`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            reason: "Confirmed via governed specification review",
            productId: "product_1",
            ...body,
          }),
        },
      );
      const response = await handleKnowledgeLibraryApi(request, { DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "user-a", APP_ORGANIZATION_ID: TEST_ORG_ID, APP_HUMAN_ID: "op-test-human-1", APP_HUMAN_NAME: "Test Knowledge Reviewer" });
      const payload = await response.json();
      assert.equal(response.status, expectStatus, `${expectCode}: got ${response.status} ${JSON.stringify(payload)}`);
      assert.equal(payload.error?.code, expectCode, `expected ${expectCode}, got ${JSON.stringify(payload)}`);
      assert.equal(writeAttempted, false, `${expectCode}: must be refused before any write`);
    } finally {
      mockActorState.actor = previous;
    }
  };

  // Review/governance gates on the fact itself.
  await runCase({
    fact: { ...BASE_FACT, fact_type: "Price" },
    product: BASE_PRODUCT,
    expectStatus: 400,
    expectCode: "KNOWLEDGE_FACT_WRONG_TYPE",
  });
  await runCase({
    fact: { ...BASE_FACT, review_status: "Needs Review" },
    product: BASE_PRODUCT,
    expectStatus: 400,
    expectCode: "KNOWLEDGE_FACT_NOT_REVIEWED",
  });

  // Ownership gates: neither the fact nor the product may be another org's.
  await runCase({
    fact: { ...BASE_FACT, organization_id: "org-other" },
    product: BASE_PRODUCT,
    expectStatus: 404,
    expectCode: "KNOWLEDGE_FACT_NOT_FOUND",
  });
  await runCase({
    fact: BASE_FACT,
    product: null,
    expectStatus: 404,
    expectCode: "PRODUCT_NOT_FOUND",
  });

  // KN-SCOPE-1: a product that exists but belongs to another organization is
  // refused as not found, so existence is never disclosed across the org
  // boundary. A Global Library product IS visible and must be linkable --
  // before this repair the `WHERE organization_id=?` filter made every Global
  // Library product (i.e. the entire live catalogue) unreachable.
  await runCase({
    fact: BASE_FACT,
    product: { ...BASE_PRODUCT, organization_id: "org-other" },
    expectStatus: 404,
    expectCode: "PRODUCT_NOT_FOUND",
  });
  await runCase({
    fact: BASE_FACT,
    // Reaches the part-number gate, so it is visible: an invisible product
    // answers 404 before any identity comparison happens.
    product: { ...BASE_PRODUCT, organization_id: null, library_scope: "Global Library", part_number: "SOMETHING-ELSE" },
    expectStatus: 400,
    expectCode: "PART_NUMBER_MISMATCH",
  });

  // Product authority: the target product must actually carry the fact's part
  // number, or the link would assert a false product identity.
  await runCase({
    fact: BASE_FACT,
    product: { ...BASE_PRODUCT, part_number: "SOMETHING-ELSE" },
    expectStatus: 400,
    expectCode: "PART_NUMBER_MISMATCH",
  });

  // Reason governance still applies, and is evaluated on the TRIMMED value, so
  // a whitespace-padded reason must not be treated as substantive.
  await runCase({
    fact: BASE_FACT,
    product: BASE_PRODUCT,
    body: { reason: "    " },
    expectStatus: 422,
    expectCode: "REASON_REQUIRED",
  });
  await runCase({
    fact: BASE_FACT,
    product: BASE_PRODUCT,
    body: { reason: "  ab  " },
    expectStatus: 422,
    expectCode: "REASON_REASON_REQUIRED",
  });
  await runCase({
    fact: BASE_FACT,
    product: BASE_PRODUCT,
    body: { productId: "   " },
    expectStatus: 422,
    expectCode: "PRODUCT_ID_REQUIRED",
  });

  // Capability gate on the write itself.
  await runCase({
    fact: BASE_FACT,
    product: BASE_PRODUCT,
    actor: { id: "op-test-human-1", email: "t@example.invalid", fullName: "T", organizationId: TEST_ORG_ID, permission: "No Access", role: "No Access", fullAccess: false },
    expectStatus: 403,
    expectCode: "LIBRARY_PERMISSION_DENIED",
  });
});
