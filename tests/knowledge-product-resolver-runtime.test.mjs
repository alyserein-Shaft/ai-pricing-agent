import test, { mock } from "node:test";
import assert from "node:assert/strict";

import {
  comparisonPartNumber,
  searchPartNumberKey,
} from "../app/domain/knowledge-product-identity-resolver.mjs";

// Auth mock: real single-user context is always fullAccess, so the 403 path is
// unreachable without it. requireLibraryCapability mirrors worker/library-auth.mjs.
const TEST_ORG_ID = "organization_bd_shaft_internal_pilot";
const mockActorState = {
  actor: {
    id: "test-user",
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

const CANONICAL = "product_0c4c8db3-674b-4564-8249-463c00885317";
const DOT_VARIANT = "product_918ff5e3-2edb-4918-a29d-7ebf37dff322";
const FACT_ID = "knowledgeFact_6dbbd08f-4e40-48b5-8601-e644b2b2c556";

// Mirrors the SQL punctuation-strip set in the adapter discovery query.
const stripJs = (value) => String(value ?? "").toUpperCase().replace(/[- _./:]/g, "");

const factRow = (overrides = {}) => ({
  id: FACT_ID,
  organization_id: TEST_ORG_ID,
  knowledge_file_id: "knowledgeFile_1",
  fact_type: "Part Number",
  original_value: "IDP-PHOTO-IV",
  normalized_value: "idp-photo-iv",
  attributes: "{}",
  ...overrides,
});

const linkRow = (overrides = {}) => ({
  id: "knowledgeLink_a2bc1e97-9287-497e-934b-1d9c2ba83b39",
  organization_id: TEST_ORG_ID,
  knowledge_fact_id: FACT_ID,
  part_number: "IDP-PHOTO-IV",
  existing_product_id: null,
  link_state: "New Product Candidate",
  new_information: "{}",
  created_at: "2026-08-04 13:54:16",
  ...overrides,
});

const productRow = (overrides = {}) => ({
  id: "product_test-1",
  manufacturer_id: "manufacturer_honeywell",
  manufacturer_name: "Honeywell",
  part_number: "IDP-PHOTO-IV",
  normalized_part_number: "IDP-PHOTO-IV",
  description: "Photoelectric smoke detector",
  library_scope: "Global Library",
  organization_id: null,
  library_project_id: null,
  identity_status: "Active",
  superseded_by_product_id: null,
  ...overrides,
});

function makeDb({ facts = [], links = [], products = [], conflicts = [] } = {}) {
  // Fail fast on camelCase impostor keys: DB rows use snake_case columns.
  for (const row of products) {
    for (const key of ["libraryScope", "organizationId", "identityStatus", "libraryProjectId", "existingProductId"]) {
      assert.ok(!(key in row), `product fixture must use snake_case columns, found ${key}`);
    }
  }
  for (const row of links) {
    for (const key of ["existingProductId", "linkState", "knowledgeFactId"]) {
      assert.ok(!(key in row), `link fixture must use snake_case columns, found ${key}`);
    }
  }
  const calls = { run: 0, batch: 0, statements: [] };
  const productsById = new Map(products.map((row) => [row.id, row]));
  const db = {
    calls,
    prepare(sql) {
      calls.statements.push(sql);
      return {
        bind(...args) {
          return {
            async first() {
              if (sql.includes("FROM organizations")) return { id: args[0], name: "Test Org" };
              if (sql.includes("FROM knowledge_facts WHERE id=?")) {
                const row = facts.find((entry) => entry.id === args[0]);
                return row && row.organization_id === args[1] ? row : null;
              }
              if (sql.includes("JOIN product_manufacturers m ON m.id=p.manufacturer_id")) {
                return productsById.get(args[0]) || null;
              }
              throw new Error(`Unexpected .first() query in test: ${sql}`);
            },
            async all() {
              if (sql.includes("sqlite_master")) return { results: args.map((name) => ({ name })) };
              if (sql.includes("FROM knowledge_product_links")) {
                return {
                  results: links
                    .filter((row) => row.knowledge_fact_id === args[0] && row.organization_id === args[1])
                    .slice()
                    .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
                };
              }
              if (sql.includes("FROM library_products p")) {
                // The adapter binds: original, comparison, lowerComparison,
                // comparison, searchKey, lowerComparison, lowerSearchKey,
                // comparison(UPPER-TRIM), searchKey(stripped), then scope args.
                const partForms = args.slice(0, 3);
                const normForms = args.slice(3, 7);
                const upperForm = args[7];
                const stripForm = args[8];
                const scopeArgs = args.slice(9);
                const orgId = scopeArgs[0];
                const projectIds = scopeArgs.slice(1);
                return {
                  results: products.filter((row) => {
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
              if (sql.includes("FROM product_conflicts")) {
                return { results: conflicts };
              }
              throw new Error(`Unexpected .all() query in test: ${sql}`);
            },
            async run() {
              calls.run += 1;
              throw new Error("Mutation attempted on read-only resolve path (.run).");
            },
          };
        },
      };
    },
    async batch() {
      calls.batch += 1;
      throw new Error("Mutation attempted on read-only resolve path (.batch).");
    },
  };
  return db;
}

const goldenDb = (overrides = {}) => makeDb({
  facts: [factRow()],
  links: [linkRow()],
  products: [
    productRow({ id: CANONICAL }),
    productRow({
      id: DOT_VARIANT,
      part_number: "IDP-PHOTO-IV.",
      normalized_part_number: "IDP-PHOTO-IV.",
      identity_status: "Superseded",
      superseded_by_product_id: CANONICAL,
    }),
  ],
  conflicts: [],
  ...overrides,
});

const getResolve = (factId = FACT_ID) => new Request(
  `http://localhost/api/knowledge/resolve/fact/${encodeURIComponent(factId)}`,
  { method: "GET" },
);

const resolveBody = async (db, factId) => {
  const response = await handleKnowledgeLibraryApi(getResolve(factId), { DB: db });
  return { response, body: await response.json(), db };
};

// T1: golden runtime-shaped data.
test("T1 golden live shape resolves REPAIRABLE_NEW_PRODUCT_CANDIDATE", async () => {
  const { response, body, db } = await resolveBody(goldenDb());
  assert.equal(response.status, 200);
  assert.equal(body.factId, FACT_ID);
  assert.equal(body.decision.outcome, "REPAIRABLE_NEW_PRODUCT_CANDIDATE");
  assert.equal(body.decision.selectedTarget, CANONICAL);
  assert.equal(body.decision.engineerReviewRequired, false);
  assert.equal(body.decision.evidence.manufacturerBasis, "UNKNOWN_SINGLETON");
  assert.equal(body.links.length, 1);
  assert.equal(body.links[0].id, "knowledgeLink_a2bc1e97-9287-497e-934b-1d9c2ba83b39");
  assert.equal(db.calls.run, 0);
  assert.equal(db.calls.batch, 0);
});

// T2: Global Library product visible to an organization fact.
test("T2 Global Library candidate is visible to an organization Knowledge Fact", async () => {
  const { body } = await resolveBody(goldenDb());
  const entry = body.decision.candidatesConsidered.find((row) => row.productId === CANONICAL);
  assert.ok(entry, "canonical product must be among considered candidates");
  assert.equal(entry.visible, true);
  assert.equal(entry.comparisonEqual, true);
});

// T3: other-organization product invisible.
test("T3 other-organization Product is invisible", async () => {
  const { body } = await resolveBody(goldenDb({
    products: [
      productRow({
        id: "product_org-b-1",
        library_scope: "Organization Library",
        organization_id: "org-other",
      }),
    ],
  }));
  assert.equal(body.decision.outcome, "NO_TARGET");
  assert.equal(body.decision.candidatesConsidered.length, 0);
});

// T4: lowercase/uppercase stored-normalization mismatch no longer misses.
test("T4 proven case mismatch is fixed at discovery, not by equating formats", async () => {
  const db = goldenDb();
  const { body } = await resolveBody(db);
  const entry = body.decision.candidatesConsidered.find((row) => row.productId === CANONICAL);
  assert.ok(entry && entry.comparisonEqual, "uppercase-stored product must match lowercase-derived comparison");
  const discoverySql = db.calls.statements.find((sql) => sql.includes("FROM library_products p"));
  assert.ok(discoverySql.includes("UPPER(TRIM(p.part_number))"), "discovery must fold case explicitly in SQL");
  assert.ok(!discoverySql.includes("f.normalized_value"), "adapter must not equate fact/product stored normalizations");
});

// T5: search-key-only punctuation candidate stays non-deterministic.
test("T5 dot-variant-only Active candidate remains ambiguous", async () => {
  const { body } = await resolveBody(goldenDb({
    products: [productRow({ id: DOT_VARIANT, part_number: "IDP-PHOTO-IV.", normalized_part_number: "IDP-PHOTO-IV." })],
  }));
  assert.equal(body.decision.outcome, "AMBIGUOUS_TARGET");
  assert.equal(body.decision.selectedTarget, null);
  assert.equal(body.decision.engineerReviewRequired, true);
});

// T6: superseded comparison match pre-resolves to canonical Active.
test("T6 superseded match pre-resolves through the canonical chain", async () => {
  const { body } = await resolveBody(goldenDb({
    facts: [factRow({ manufacturer: null, attributes: JSON.stringify({ manufacturer: "Honeywell" }) })],
    links: [],
    products: [
      productRow({
        id: "product_old-1",
        identity_status: "Superseded",
        superseded_by_product_id: CANONICAL,
      }),
      productRow({ id: CANONICAL }),
    ],
  }));
  assert.equal(body.decision.outcome, "EXACT_UNIQUE_TARGET");
  assert.equal(body.decision.selectedTarget, CANONICAL);
  assert.ok(body.decision.reasonCodes.includes("CANONICAL_CONVERGENCE"));
});

// T7: distinct canonical candidates stay ambiguous with no winner.
test("T7 two distinct canonical targets stay ambiguous", async () => {
  const { body } = await resolveBody(goldenDb({
    products: [
      productRow({ id: "product_h-1", manufacturer_name: "Honeywell" }),
      productRow({ id: "product_b-1", manufacturer_name: "Bosch" }),
    ],
  }));
  assert.equal(body.decision.outcome, "AMBIGUOUS_TARGET");
  assert.equal(body.decision.selectedTarget, null);
});

// T8: multiple persisted links.
test("T8 multiple persisted links short-circuit to MULTIPLE_EXISTING_LINKS", async () => {
  const { body } = await resolveBody(goldenDb({
    links: [linkRow({ id: "knowledgeLink_1" }), linkRow({ id: "knowledgeLink_2" })],
  }));
  assert.equal(body.decision.outcome, "MULTIPLE_EXISTING_LINKS");
  assert.equal(body.decision.selectedTarget, null);
  assert.equal(body.decision.engineerReviewRequired, true);
});

// T9: existing correct target.
test("T9 stored canonical target resolves ALREADY_LINKED", async () => {
  const { body } = await resolveBody(goldenDb({
    links: [linkRow({ existing_product_id: CANONICAL, link_state: "Existing Product — Additive Learning Only" })],
  }));
  assert.equal(body.decision.outcome, "ALREADY_LINKED");
  assert.equal(body.decision.selectedTarget, CANONICAL);
});

// T10: existing different target.
test("T10 stored different target resolves EXISTING_LINK_CONFLICT", async () => {
  const { body } = await resolveBody(goldenDb({
    links: [linkRow({ existing_product_id: "product_other-1", link_state: "Existing Product — Additive Learning Only" })],
  }));
  assert.equal(body.decision.outcome, "EXISTING_LINK_CONFLICT");
  assert.equal(body.decision.engineerReviewRequired, true);
});

// T11: broken canonical chain.
test("T11 superseded row with missing successor resolves BROKEN_CANONICAL_CHAIN", async () => {
  const { body } = await resolveBody(goldenDb({
    products: [
      productRow({
        id: "product_broken-1",
        identity_status: "Superseded",
        superseded_by_product_id: "product_missing-1",
      }),
    ],
  }));
  assert.equal(body.decision.outcome, "BROKEN_CANONICAL_CHAIN");
  assert.equal(body.decision.selectedTarget, null);
});

// T12: technical family/attributes cannot upgrade ambiguous identity.
test("T12 rich technical context does not rescue manufacturer ambiguity", async () => {
  const { body } = await resolveBody(goldenDb({
    products: [
      productRow({ id: "product_h-1", manufacturer_name: "Honeywell", description: "Photoelectric detector, Series X, EN54" }),
      productRow({ id: "product_b-1", manufacturer_name: "Bosch", description: "Photoelectric detector, Series X, EN54" }),
    ],
  }));
  assert.equal(body.decision.outcome, "AMBIGUOUS_TARGET");
  assert.equal(body.decision.selectedTarget, null);
  for (const entry of body.decision.candidatesConsidered) {
    assert.ok(!("family" in entry) && !("attributes" in entry) && !("description" in entry));
  }
});

// T13: brand cannot substitute for manufacturer.
test("T13 brand-only fact evidence stays manufacturer-unknown", async () => {
  const { body } = await resolveBody(goldenDb({
    facts: [factRow({ attributes: JSON.stringify({ brand: "Honeywell", family: "Detectors" }) })],
  }));
  assert.equal(body.decision.evidence.factManufacturer, null);
  assert.equal(body.decision.evidence.manufacturerBasis, "UNKNOWN_SINGLETON");
  assert.equal(body.decision.outcome, "REPAIRABLE_NEW_PRODUCT_CANDIDATE");
});

// T14: zero writes across resolve paths.
test("T14 resolve GET performs zero writes on every path", async () => {
  for (const db of [goldenDb(), goldenDb({ facts: [] })]) {
    const response = await handleKnowledgeLibraryApi(getResolve(), { DB: db });
    await response.json();
    assert.equal(db.calls.run, 0);
    assert.equal(db.calls.batch, 0);
  }
});

// T15: cross-org fact uses established not-found behavior.
test("T15 cross-organization fact returns 404 KNOWLEDGE_FACT_NOT_FOUND", async () => {
  const { response, body, db } = await resolveBody(
    goldenDb({ facts: [factRow({ organization_id: "org-other" })] }),
  );
  assert.equal(response.status, 404);
  assert.equal(body.error.code, "KNOWLEDGE_FACT_NOT_FOUND");
  assert.ok(!("decision" in body));
  assert.equal(db.calls.run, 0);
  assert.equal(db.calls.batch, 0);
});

// Representation sanity: adapter discovery forms follow Stage 3C semantics.
test("discovery forms derive comparison and search key without equating formats", () => {
  assert.equal(comparisonPartNumber("idp-photo-iv"), "IDP-PHOTO-IV");
  assert.equal(searchPartNumberKey("IDP-PHOTO-IV"), "IDPPHOTOIV");
  assert.equal(searchPartNumberKey("IDP-PHOTO-IV."), "IDPPHOTOIV");
});
