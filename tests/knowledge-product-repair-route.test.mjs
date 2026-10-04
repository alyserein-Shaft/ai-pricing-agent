import test, { mock } from "node:test";
import assert from "node:assert/strict";

// KN-LINK-FACT-HOTFIX: this file used to install a process-wide
// `globalThis.clean` shim as a workaround for the dead bare `clean(...)` call in
// the POST link branch. That branch now uses the module's own `cleanText`, so
// the shim is removed. As a global it would otherwise have re-masked the same
// defect for every test sharing this process.

// ---------------------------------------------------------------------------
// Auth mock mirroring worker/library-auth.mjs (PERMISSION_RANK +
// LIBRARY_CAPABILITIES + problem()), with a mutable state object so the
// unauthenticated / unauthorized paths are exercisable through the real app
// handler. The real single-user context always yields fullAccess Administrator,
// so only a mock can exercise 401/403.
// ---------------------------------------------------------------------------
const ORG = "organization_bd_shaft_internal_pilot";
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
const authState = {
  error: null,
  actor: {
    id: "route-engineer",
    email: "engineer@example.invalid",
    fullName: "Route Engineer",
    organizationId: ORG,
    permission: "Administrator",
    role: "Administrator",
    fullAccess: true,
  },
};

mock.module("../worker/library-auth.mjs", {
  exports: {
    authenticateLibraryActor: async () =>
      authState.error ? { error: authState.error } : { actor: authState.actor },
    requireLibraryCapability: (actor, capability) =>
      actor?.fullAccess
      || Number(PERMISSION_RANK[actor?.permission || actor?.role] || 0)
        >= Number(PERMISSION_RANK[LIBRARY_CAPABILITIES[capability] ?? "Administrator"] || Infinity)
        ? null
        : {
          status: 403,
          code: "LIBRARY_PERMISSION_DENIED",
          message: `The ${LIBRARY_CAPABILITIES[capability] ?? capability} permission is required for this operation.`,
        },
  },
});

const { handleKnowledgeLibraryApi } = await import("../worker/knowledge-library-api.mjs");
const {
  repairKnowledgeProductLink,
  IDENTITY_REPAIR_LINK_STATE,
  IDENTITY_REPAIR_AUDIT_TYPE,
} = await import("../worker/knowledge-product-repair.mjs");

// ---------------------------------------------------------------------------
// Fixtures (identical to tests/knowledge-product-repair.test.mjs — same Golden
// fact, link, canonical product and dot variant).
// ---------------------------------------------------------------------------
const CANONICAL = "product_0c4c8db3-674b-4564-8249-463c00885317";
const DOT_VARIANT = "product_918ff5e3-2edb-4918-a29d-7ebf37dff322";
const FACT_ID = "knowledgeFact_6dbbd08f-4e40-48b5-8601-e644b2b2c556";
const LINK_ID = "knowledgeLink_a2bc1e97-9287-497e-934b-1d9c2ba83b39";

const stripJs = (value) => String(value ?? "").toUpperCase().replace(/[- _./:]/g, "");

const factRow = (overrides = {}) => ({
  id: FACT_ID,
  organization_id: ORG,
  knowledge_file_id: "knowledgeFile_1",
  fact_type: "Part Number",
  original_value: "IDP-PHOTO-IV",
  normalized_value: "idp-photo-iv",
  attributes: "{}",
  review_status: "Learned",
  ...overrides,
});

const linkRow = (overrides = {}) => ({
  id: LINK_ID,
  organization_id: ORG,
  knowledge_fact_id: FACT_ID,
  part_number: "IDP-PHOTO-IV",
  existing_product_id: null,
  link_state: "New Product Candidate",
  new_information: JSON.stringify({ originalField: "preserved" }),
  created_at: "2026-08-04 13:54:16",
  ...overrides,
});

const productRow = (overrides = {}) => ({
  id: CANONICAL,
  manufacturer_id: "manufacturer_honeywell",
  manufacturer_name: "Honeywell",
  part_number: "IDP-PHOTO-IV",
  normalized_part_number: "IDP-PHOTO-IV",
  description: "Photoelectric smoke detector",
  attributes: JSON.stringify([{ name: "protocol", value: "FlashScan" }]),
  library_scope: "Global Library",
  organization_id: null,
  library_project_id: null,
  identity_status: "Active",
  superseded_by_product_id: null,
  review_status: "Needs Review",
  approved_for_discovery: 0,
  ...overrides,
});

const dotRow = () => productRow({
  id: DOT_VARIANT,
  part_number: "IDP-PHOTO-IV.",
  normalized_part_number: "IDP-PHOTO-IV.",
  identity_status: "Superseded",
  superseded_by_product_id: CANONICAL,
});

// ---------------------------------------------------------------------------
// Mock D1: identical SQL dispatch to the Stage 3F repair test harness, which is
// proven to satisfy every query issued by resolveKnowledgeFactProduct +
// repairKnowledgeProductLink. Throws on any query the safe path should never
// issue, so an unexpected write path fails the test immediately.
// ---------------------------------------------------------------------------
function makeDb({ facts, links, products, conflicts = [], prices, hooks = {} } = {}) {
  const tables = {
    knowledge_facts: facts ?? [factRow()],
    knowledge_product_links: links ?? [linkRow()],
    library_products: products ?? [productRow(), dotRow()],
    product_conflicts: conflicts,
    knowledge_file_events: [],
    knowledge_files: [{ id: "knowledgeFile_1", organization_id: ORG }],
    price_records: prices ?? [{ id: "price_1", product_id: CANONICAL, amount_minor: 100 }],
  };
  const productsById = () => new Map(tables.library_products.map((row) => [row.id, row]));
  const calls = { statements: [], linkUpdates: 0, eventInserts: 0 };
  const snapshot = () => JSON.parse(JSON.stringify(tables));

  const applyFirst = (sql, args) => {
    if (sql.includes("FROM organizations")) return { id: args[0], name: "Test Org" };
    if (sql.includes("FROM knowledge_facts WHERE id=?")) {
      const row = tables.knowledge_facts.find((entry) => entry.id === args[0]);
      return row && row.organization_id === args[1] ? row : null;
    }
    if (sql.includes("JOIN product_manufacturers m ON m.id=p.manufacturer_id")) {
      return productsById().get(args[0]) || null;
    }
    throw new Error(`Unexpected .first(): ${sql}`);
  };

  const applyAll = (sql, args) => {
    if (sql.includes("sqlite_master")) return { results: args.map((name) => ({ name })) };
    if (sql.includes("FROM knowledge_product_links WHERE knowledge_fact_id=?")) {
      return {
        results: tables.knowledge_product_links
          .filter((row) => row.knowledge_fact_id === args[0] && row.organization_id === args[1])
          .slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1)),
      };
    }
    if (sql.includes("FROM knowledge_product_links WHERE id=?")) {
      return { results: tables.knowledge_product_links.filter((row) => row.id === args[0] && row.organization_id === args[1]) };
    }
    if (sql.includes("FROM library_products p")) {
      const partForms = args.slice(0, 3);
      const normForms = args.slice(3, 7);
      const upperForm = args[7];
      const stripForm = args[8];
      const orgId = args[9];
      const projectIds = args.slice(10);
      return {
        results: tables.library_products.filter((row) => {
          const scope = row.library_scope;
          const visible = scope === "Global Library"
            || (scope === "Organization Library" && row.organization_id === orgId)
            || (scope === "Project Library" && projectIds.includes(row.library_project_id));
          if (!visible) return false;
          return partForms.includes(row.part_number)
            || normForms.includes(row.normalized_part_number)
            || String(row.part_number).trim().toUpperCase() === upperForm
            || stripJs(row.part_number) === stripForm;
        }),
      };
    }
    if (sql.includes("FROM product_conflicts")) return { results: tables.product_conflicts };
    throw new Error(`Unexpected .all(): ${sql}`);
  };

  const applyWrite = (sql, args) => {
    if (sql.includes("UPDATE knowledge_product_links")) {
      if (hooks.updateNoopOnce) {
        hooks.updateNoopOnce = false;
        return { meta: { changes: 0 } };
      }
      const [target, state, info, id, orgId, factId, partNumber] = args;
      const row = tables.knowledge_product_links.find((entry) =>
        entry.id === id && entry.organization_id === orgId && entry.knowledge_fact_id === factId
        && entry.existing_product_id === null && entry.link_state === "New Product Candidate"
        && entry.part_number === partNumber);
      if (!row) return { meta: { changes: 0 } };
      row.existing_product_id = target;
      row.link_state = state;
      row.new_information = info;
      calls.linkUpdates += 1;
      return { meta: { changes: 1 } };
    }
    if (sql.includes("INSERT OR IGNORE INTO knowledge_file_events")) {
      if (hooks.failAudit) throw new Error("Simulated audit write failure.");
      const [id] = args;
      if (tables.knowledge_file_events.some((entry) => entry.id === id)) {
        return { meta: { changes: 0 } };
      }
      if (hooks.failAuditAfterUpdate) throw new Error("Simulated audit failure after link update.");
      // Conditional audit: only fires when the guarded UPDATE applied.
      const [linkId, orgId, target] = args.slice(6, 9);
      const applied = tables.knowledge_product_links.some((entry) =>
        entry.id === linkId && entry.organization_id === orgId && entry.existing_product_id === target);
      if (!applied) return { meta: { changes: 0 } };
      tables.knowledge_file_events.push({
        id,
        organization_id: args[1],
        knowledge_file_id: args[2],
        event_type: args[3],
        details: args[4],
        actor_user_id: args[5],
      });
      calls.eventInserts += 1;
      return { meta: { changes: 1 } };
    }
    throw new Error(`Unexpected write: ${sql}`);
  };

  const db = {
    calls,
    tables,
    snapshot,
    hooks,
    prepare(sql) {
      calls.statements.push(sql);
      return {
        bind(...args) {
          return {
            first: () => applyFirst(sql, args),
            all: () => applyAll(sql, args),
            run: () => applyWrite(sql, args),
            _batchExec: () => applyWrite(sql, args),
          };
        },
      };
    },
    async batch(statements) {
      if (hooks.onBeforeBatch) {
        const hook = hooks.onBeforeBatch;
        hooks.onBeforeBatch = null;
        hook();
      }
      return statements.map((statement) => statement._batchExec());
    },
  };
  return db;
}

const repairPost = (factId, body = {}) => new Request(
  `http://localhost/api/knowledge/facts/${encodeURIComponent(factId)}/links`,
  {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "repair", expectedLinkId: LINK_ID, expectedTarget: CANONICAL, reason: "Golden fact resolves uniquely to this canonical product", ...body }),
  },
);

const OK_REASON = "Golden fact resolves uniquely to this canonical product";

const resetAuth = () => {
  authState.error = null;
  authState.actor = {
    id: "route-engineer",
    email: "engineer@example.invalid",
    fullName: "Route Engineer",
    organizationId: ORG,
    permission: "Administrator",
    role: "Administrator",
    fullAccess: true,
  };
};

const auditOf = (db) => db.tables.knowledge_file_events.find(
  (entry) => entry.event_type === IDENTITY_REPAIR_AUDIT_TYPE,
);

// ---------------------------------------------------------------------------
// RT-1 — authorized single-fact REPAIRABLE request calls repairKnowledgeProductLink
// exactly once and returns REPAIRED with trusted-org + actor propagation.
// Covers plan items 1, 2, 4, 5, 7, 8.
// ---------------------------------------------------------------------------
test("RT-1 REPAIRED: route calls repair exactly once with org from context, actor propagated, fields passed through", async () => {
  resetAuth();
  const db = makeDb();
  const before = db.snapshot();
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();

  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.status, "repaired");
  assert.equal(body.linkId, LINK_ID);
  assert.equal(body.target, CANONICAL);
  assert.equal(body.technicalSuitabilityEvaluated, false);
  assert.equal(body.writes.linkWrites, 1, "single guarded UPDATE");
  assert.equal(body.writes.auditWrites, 1, "single audit INSERT");

  // Exactly one repair write pair executed (2 write statements total).
  const writes = db.calls.statements.filter((sql) => /^\s*(UPDATE|INSERT)/i.test(sql));
  assert.equal(writes.length, 2, `unexpected write statements: ${JSON.stringify(writes)}`);
  assert.ok(writes[0].includes("UPDATE knowledge_product_links"));
  assert.ok(writes[1].includes("INSERT OR IGNORE INTO knowledge_file_events"));
  assert.ok(writes[0].includes("AND organization_id=?"), "org bound from trusted context into guarded UPDATE");

  // Link row repaired in place; audit carries the authenticated actor.
  assert.equal(db.calls.linkUpdates, 1);
  const row = db.tables.knowledge_product_links.find((r) => r.id === LINK_ID);
  assert.equal(row.existing_product_id, CANONICAL);
  assert.equal(row.link_state, IDENTITY_REPAIR_LINK_STATE);
  const info = JSON.parse(row.new_information);
  assert.equal(info.identityRepair.actor.id, "route-engineer", "authenticated actor propagated");
  assert.equal(info.identityRepair.actor.role, "Administrator");
  assert.equal(info.identityRepair.actor.context, "knowledge-fact-link-repair");
  assert.equal(info.identityRepair.previousLinkState, "New Product Candidate");
  assert.equal(info.identityRepair.previousExistingProductId, null);
  assert.equal(info.identityRepair.canonicalProductId, CANONICAL);
  assert.equal(info.originalField, "preserved", "prior new_information preserved");

  const audit = auditOf(db);
  assert.ok(audit, "audit event written");
  assert.equal(audit.actor_user_id, "route-engineer");
  const details = JSON.parse(audit.details);
  assert.equal(details.knowledgeFactId, FACT_ID);
  assert.equal(details.linkId, LINK_ID);
  assert.equal(details.canonicalTarget, CANONICAL);
  assert.equal(details.safety.technicalEvaluation, "NOT_PERFORMED");

  // Governed scope: fact review / product state untouched.
  const after = db.snapshot();
  assert.deepEqual(after.knowledge_facts, before.knowledge_facts);
  assert.deepEqual(after.library_products, before.library_products);
  assert.deepEqual(after.price_records, before.price_records);
});

// ---------------------------------------------------------------------------
// RT-2 — caller cannot override organization scope: an evil body.organizationId
// is ignored; the repair still happens inside the trusted auth org.
// Covers plan item 3.
// ---------------------------------------------------------------------------
test("RT-2 body organizationId is ignored; trusted auth org governs the repair", async () => {
  resetAuth();
  const db = makeDb();
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID, { organizationId: "org-evil", existing_product_id: "product_evil", link_state: "Wrong State" }), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  const row = db.tables.knowledge_product_links.find((r) => r.id === LINK_ID);
  assert.equal(row.organization_id, ORG, "link row still in trusted org");
  assert.equal(row.existing_product_id, CANONICAL, "evil existing_product_id never used");
  assert.equal(row.link_state, IDENTITY_REPAIR_LINK_STATE, "evil link_state never used");
  assert.equal(db.calls.linkUpdates, 1);
});

// ---------------------------------------------------------------------------
// RT-3 — expectedTarget is a cross-check only: a mismatched expectedLinkId or
// expectedTarget is refused with zero writes. Covers plan item 5, 6, 21, 22.
// ---------------------------------------------------------------------------
test("RT-3 wrong expectedLinkId / expectedTarget / missing fields refuse before persistence", async () => {
  resetAuth();
  {
    const db = makeDb();
    const res = await handleKnowledgeLibraryApi(repairPost(FACT_ID, { expectedLinkId: "knowledgeLink_wrong" }), { DB: db });
    const body = await res.json();
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(body.ok, false);
    assert.equal(body.refusalReason, "LINK_ID_MISMATCH");
    assert.equal(db.calls.linkUpdates, 0);
    assert.equal(db.calls.eventInserts, 0);
  }
  {
    const db = makeDb();
    const res = await handleKnowledgeLibraryApi(repairPost(FACT_ID, { expectedTarget: "product_wrong" }), { DB: db });
    const body = await res.json();
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(body.ok, false);
    assert.equal(body.refusalReason, "TARGET_MISMATCH");
    assert.equal(db.calls.linkUpdates, 0);
  }
  {
    const db = makeDb();
    const res = await handleKnowledgeLibraryApi(repairPost(FACT_ID, { expectedLinkId: "" }), { DB: db });
    const body = await res.json();
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(body.error.code, "EXPECTED_LINK_ID_REQUIRED");
    assert.equal(db.calls.linkUpdates, 0);
    assert.equal(db.calls.eventInserts, 0);
  }
  {
    const db = makeDb();
    const res = await handleKnowledgeLibraryApi(repairPost(FACT_ID, { expectedTarget: "" }), { DB: db });
    const body = await res.json();
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(body.error.code, "EXPECTED_TARGET_REQUIRED");
    assert.equal(db.calls.linkUpdates, 0);
  }
});

// ---------------------------------------------------------------------------
// RT-4 — governed reason validation happens before persistence.
// Covers plan item 23.
// ---------------------------------------------------------------------------
test("RT-4 missing/too-short reason rejected before persistence", async () => {
  resetAuth();
  for (const reason of ["", "x", OK_REASON.slice(0, 4)]) {
    const db = makeDb();
    const res = await handleKnowledgeLibraryApi(repairPost(FACT_ID, { reason }), { DB: db });
    const body = await res.json();
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(body.error.code, "KNOWLEDGE_REPAIR_REASON_REQUIRED");
    assert.equal(db.calls.linkUpdates, 0);
    assert.equal(db.calls.eventInserts, 0);
  }
});

// ---------------------------------------------------------------------------
// RT-5 — REPAIRED response contains no affirmative technical/commercial claims.
// Covers plan item 9 + engineering safety boundary.
// ---------------------------------------------------------------------------
test("RT-5 REPAIRED response has no affirmative suitability/approval claims", async () => {
  resetAuth();
  const db = makeDb();
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 200);
  const serialized = JSON.stringify(body);
  assert.match(serialized, /"technicalSuitabilityEvaluated":false/);
  assert.doesNotMatch(serialized, /\bFACP\b/i);
  assert.doesNotMatch(serialized, /\bSLC\b/i);
  assert.doesNotMatch(serialized, /\bcompatible\b/i);
  assert.doesNotMatch(serialized, /\bcompliant\b/i);
  assert.doesNotMatch(serialized, /\bcertified\b/i);
  assert.doesNotMatch(serialized, /"approved":true/i);
  assert.doesNotMatch(serialized, /pricing-ready|costing-ready/i);
});

// ---------------------------------------------------------------------------
// RT-6 — second identical invocation is idempotent: ALREADY_LINKED, zero extra
// writes, zero duplicate audit. Covers plan items 10, 11.
// ---------------------------------------------------------------------------
test("RT-6 immediate retry: ALREADY_LINKED, no additional mutation, no duplicate audit", async () => {
  resetAuth();
  const db = makeDb();
  const first = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  assert.equal(first.status, 200, JSON.stringify(await first.json()));

  const second = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await second.json();
  assert.equal(second.status, 200, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.status, "already-linked");
  assert.equal(body.idempotent, true);
  assert.equal(body.target, CANONICAL);
  assert.equal(body.technicalSuitabilityEvaluated, false);
  assert.equal(body.writes.linkWrites, 0);
  assert.equal(body.writes.auditWrites, 0);

  assert.equal(db.calls.linkUpdates, 1, "no second link write");
  assert.equal(db.calls.eventInserts, 1, "no duplicate audit");
  assert.equal(db.tables.knowledge_product_links.length, 1, "link count unchanged");
  assert.equal(
    db.tables.knowledge_file_events.filter((e) => e.event_type === IDENTITY_REPAIR_AUDIT_TYPE).length,
    1,
    "exactly one audit row",
  );
});

// ---------------------------------------------------------------------------
// RT-7 — different stored target surfaces EXISTING_LINK_CONFLICT with
// engineerReviewRequired=true, both targets, and zero overwrite.
// Covers plan items 12, 13.
// ---------------------------------------------------------------------------
test("RT-7 different stored target -> 409 EXISTING_LINK_CONFLICT, engineer review, no overwrite", async () => {
  resetAuth();
  const stored = "product_competitor-1";
  const db = makeDb({ links: [linkRow({ existing_product_id: stored, link_state: IDENTITY_REPAIR_LINK_STATE })] });
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 409, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.equal(body.status, "conflict");
  assert.equal(body.engineerReviewRequired, true);
  assert.equal(body.storedTarget, stored);
  assert.equal(body.proposedTarget, CANONICAL);
  assert.equal(db.tables.knowledge_product_links[0].existing_product_id, stored, "competitor target never overwritten");
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
});

// ---------------------------------------------------------------------------
// RT-8 — ambiguous / multiple / broken / search-key-only never report success.
// Covers plan items 14, 15, 16, 17.
// ---------------------------------------------------------------------------
test("RT-8 AMBIGUOUS_TARGET -> 422, no repair, no writes", async () => {
  resetAuth();
  const db = makeDb({ products: [
    productRow({ id: "product_h-1", manufacturer_name: "Honeywell" }),
    productRow({ id: "product_b-1", manufacturer_name: "Bosch" }),
  ] });
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.equal(body.status, "ambiguous-target");
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
});

test("RT-8b MULTIPLE existing links -> 422, no repair, no writes", async () => {
  resetAuth();
  const db = makeDb({ links: [linkRow({ id: "knowledgeLink_1" }), linkRow({ id: "knowledgeLink_2" })] });
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.equal(body.status, "multiple-existing-links");
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
});

test("RT-8c BROKEN canonical chain -> 422, no repair, no writes", async () => {
  resetAuth();
  const db = makeDb({ products: [
    productRow({ id: "product_broken-1", identity_status: "Superseded", superseded_by_product_id: "product_missing-1" }),
  ] });
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.equal(body.status, "broken-canonical-chain");
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
});

test("RT-8d search-key-only candidate -> 422, no repair, no writes", async () => {
  resetAuth();
  const db = makeDb({ products: [
    productRow({ id: DOT_VARIANT, part_number: "IDP-PHOTO-IV.", normalized_part_number: "IDP-PHOTO-IV.", identity_status: "Active", superseded_by_product_id: null }),
  ] });
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 422, JSON.stringify(body));
  assert.equal(body.ok, false);
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
});

// ---------------------------------------------------------------------------
// RT-9 — cross-organization attempt: fact belongs to a different org -> fact is
// invisible and request denied before persistence. Covers plan item 18.
// ---------------------------------------------------------------------------
test("RT-9 cross-organization attempt is denied/invisible (404), zero writes", async () => {
  resetAuth();
  authState.actor.organizationId = "organization_other";
  const db = makeDb();
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 404, JSON.stringify(body));
  assert.equal(body.error.code, "KNOWLEDGE_FACT_NOT_FOUND");
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
});

// ---------------------------------------------------------------------------
// RT-10 — unauthenticated request denied with 401 before any persistence call.
// Covers plan item 19.
// ---------------------------------------------------------------------------
test("RT-10 unauthenticated request -> 401", async () => {
  resetAuth();
  authState.error = { status: 401, code: "AUTH_REQUIRED", message: "Authentication required." };
  const db = makeDb();
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 401, JSON.stringify(body));
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
});

// ---------------------------------------------------------------------------
// RT-11 — unauthorized capability (below Knowledge Librarian for link) -> 403.
// Covers plan item 20.
// ---------------------------------------------------------------------------
test("RT-11 insufficient capability -> 403, zero writes", async () => {
  resetAuth();
  authState.actor = {
    id: "viewer",
    email: "viewer@example.invalid",
    fullName: "Viewer",
    organizationId: ORG,
    permission: "Library Viewer",
    role: "Library Viewer",
    fullAccess: false,
  };
  const db = makeDb();
  const response = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  const body = await response.json();
  assert.equal(response.status, 403, JSON.stringify(body));
  assert.equal(body.error.code, "LIBRARY_PERMISSION_DENIED");
  assert.equal(db.calls.linkUpdates, 0);
  assert.equal(db.calls.eventInserts, 0);
});

// ---------------------------------------------------------------------------
// RT-12 — unsupported action is rejected at the route; routine success creates
// no engineer task/queue artifact. Covers plan item 24.
// ---------------------------------------------------------------------------
test("RT-12 unsupported action rejected; routine success creates no task artifact", async () => {
  resetAuth();
  {
    const db = makeDb();
    const res = await handleKnowledgeLibraryApi(
      new Request(`http://localhost/api/knowledge/facts/${FACT_ID}/links`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", expectedLinkId: LINK_ID, expectedTarget: CANONICAL, reason: OK_REASON }),
      }),
      { DB: db },
    );
    const body = await res.json();
    assert.equal(res.status, 422, JSON.stringify(body));
    assert.equal(body.error.code, "KNOWLEDGE_LINK_ACTION_UNSUPPORTED");
    assert.equal(db.calls.linkUpdates, 0);
  }
  {
    const db = makeDb();
    const res = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
    assert.equal(res.status, 200);
    const writes = db.calls.statements.filter((sql) => /^\s*(UPDATE|INSERT)/i.test(sql));
    assert.equal(writes.length, 2, "only the guarded UPDATE + audit INSERT: no task/queue/notification write");
    for (const sql of writes) {
      assert.ok(!/task|queue|notification|review_item/i.test(sql), `unexpected artifact write: ${sql}`);
    }
    const body = await res.json();
    assert.ok(!("taskId" in body) && !("queueItemId" in body), "no engineer task artifact in response");
  }
});

// ---------------------------------------------------------------------------
// RT-13 — governance invariants through the route: only the one link row and
// one audit row change; product/fact/price/conflict state byte-identical.
// Covers plan item 25.
// ---------------------------------------------------------------------------
test("RT-13 route repair mutates ONLY link row + audit row; governance state intact", async () => {
  resetAuth();
  const db = makeDb();
  const before = db.snapshot();
  const res = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  assert.equal(res.status, 200);
  const after = db.snapshot();
  assert.deepEqual(after.knowledge_facts, before.knowledge_facts, "fact review state unchanged");
  assert.deepEqual(after.library_products, before.library_products, "product review/discovery/attributes/supersession unchanged");
  assert.deepEqual(after.price_records, before.price_records, "prices/costing unchanged");
  assert.deepEqual(after.product_conflicts, before.product_conflicts, "conflicts unchanged");
  assert.deepEqual(after.knowledge_files, before.knowledge_files, "files unchanged");

  const linkBefore = before.knowledge_product_links[0];
  const linkAfter = after.knowledge_product_links[0];
  assert.equal(linkAfter.id, linkBefore.id);
  assert.notEqual(linkAfter.existing_product_id, linkBefore.existing_product_id);
  assert.notEqual(linkAfter.link_state, linkBefore.link_state);
  assert.notEqual(linkAfter.new_information, linkBefore.new_information);
  assert.equal(
    after.knowledge_product_links.length - before.knowledge_product_links.length,
    0,
    "no link row added/removed",
  );
  assert.equal(
    after.knowledge_file_events.length - before.knowledge_file_events.length,
    1,
    "exactly one audit row added",
  );
});

// ---------------------------------------------------------------------------
// RT-14 — engineering safety regression at the route level: the stored
// identityRepair payload and audit details contain no affirmative technical
// claims (mirror of Stage 3F section 12 through the route path).
// ---------------------------------------------------------------------------
test("RT-14 stored identityRepair + audit contain no affirmative technical claims", async () => {
  resetAuth();
  const db = makeDb();
  const res = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  assert.equal(res.status, 200);
  const link = db.tables.knowledge_product_links[0];
  const audit = auditOf(db);
  const serialized = JSON.stringify([JSON.parse(link.new_information), JSON.parse(audit.details)]);
  assert.match(serialized, /"identityDecisionOnly":true/);
  assert.match(serialized, /"technicalSuitabilityEvaluated":false/);
  assert.match(serialized, /"technicalEvaluation":"NOT_PERFORMED"/);
  assert.match(serialized, /"approvedForDiscovery":false/);
  assert.match(serialized, /"costingEligible":false/);
  assert.doesNotMatch(serialized, /\bFACP\b/i);
  assert.doesNotMatch(serialized, /\bSLC\b/i);
  assert.doesNotMatch(serialized, /\bcompatible\b/i);
  assert.doesNotMatch(serialized, /\bcompliant\b/i);
  assert.doesNotMatch(serialized, /\bcertified\b/i);
  assert.doesNotMatch(serialized, /"approved":true/i);
});

// ---------------------------------------------------------------------------
// RT-15 — the audit INSERT is idempotent under a retry through the route: the
// deterministic audit id (linkId + canonicalTarget) makes duplicates impossible.
// ---------------------------------------------------------------------------
test("RT-15 deterministic audit id prevents duplicate audit across route retries", async () => {
  resetAuth();
  const db = makeDb();
  const first = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  assert.equal(first.status, 200);
  const auditId = auditOf(db).id;
  assert.ok(auditId.includes(LINK_ID) && auditId.includes(CANONICAL));
  const second = await handleKnowledgeLibraryApi(repairPost(FACT_ID), { DB: db });
  assert.equal(second.status, 200);
  const auditRows = db.tables.knowledge_file_events.filter((e) => e.event_type === IDENTITY_REPAIR_AUDIT_TYPE);
  assert.equal(auditRows.length, 1, "no duplicate audit despite retry");
  assert.equal(auditRows[0].id, auditId, "same deterministic audit row");
});