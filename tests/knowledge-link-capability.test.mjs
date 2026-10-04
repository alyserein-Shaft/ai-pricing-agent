import test, { mock } from "node:test";
import assert from "node:assert/strict";

// KN-LINK-GATE: the `link` capability did not exist in LIBRARY_CAPABILITIES,
// so every link/manual-link route denied with 403 unconditionally (rank >=
// Infinity). These tests pin the repaired gate at two levels:
//   Part A: the REAL gate functions (no mocks) over the role matrix.
//   Part B: the REAL route handlers with only actor identity stubbed (the gate
//           itself is production code) over a minimal mock DB.
import {
  LIBRARY_CAPABILITIES,
  hasLibraryCapability,
  requireLibraryCapability,
} from "../worker/library-auth.mjs";

// ---------------------------------------------------------------------------
// Part A: real gate matrix.
// ---------------------------------------------------------------------------
test("link capability exists and requires Library Manager", () => {
  assert.equal(LIBRARY_CAPABILITIES.link, "Library Manager");
});

test("link gate matrix over roles (real gate, no mocks)", () => {
  assert.equal(hasLibraryCapability("Library Viewer", "link"), false);
  assert.equal(hasLibraryCapability("Library Reviewer", "link"), false);
  assert.equal(hasLibraryCapability("Library Manager", "link"), true);
  assert.equal(hasLibraryCapability("Administrator", "link"), true);
});

test("unknown permission, missing actor, and spoofed roles are denied link", () => {
  assert.equal(hasLibraryCapability("Superuser", "link"), false);
  assert.equal(hasLibraryCapability(undefined, "link"), false);
  assert.equal(hasLibraryCapability("Administrator ", "link"), false);
  assert.equal(hasLibraryCapability("administrator", "link"), false);
  const denied = requireLibraryCapability({ permission: "Library Reviewer" }, "link");
  assert.equal(denied?.status, 403);
  assert.equal(denied?.code, "LIBRARY_PERMISSION_DENIED");
  assert.match(denied?.message || "", /Library Manager/);
});

test("nonexistent capability can never deadlock-or-open a route", () => {
  // A capability missing from the map must deny (Infinity), never allow and
  // never throw: routes stay fail-closed even if a capability name is retired.
  for (const permission of ["Library Viewer", "Library Reviewer", "Library Manager", "Administrator"]) {
    const denied = requireLibraryCapability({ permission }, "no-such-capability");
    assert.equal(denied?.status, 403, `${permission} must be denied an unknown capability`);
  }
  assert.equal(hasLibraryCapability("Administrator", "no-such-capability"), false);
});

test("pre-existing capabilities are unchanged by the link repair", () => {
  assert.deepEqual({ ...LIBRARY_CAPABILITIES }, {
    read: "Library Viewer",
    analyze: "Library Reviewer",
    review: "Library Reviewer",
    approve: "Library Manager",
    apply: "Library Manager",
    reverse: "Library Manager",
    link: "Library Manager",
  });
});

// ---------------------------------------------------------------------------
// Part B: route-level, real gate + stubbed actor identity + minimal mock DB.
// ---------------------------------------------------------------------------
const ORG = "organization_bd_shaft_internal_pilot";
const actorState = { error: null, actor: null };
const viewer = { id: "viewer-1", permission: "Library Viewer", role: "Library Viewer", organizationId: ORG };
const reviewer = { id: "reviewer-1", permission: "Library Reviewer", role: "Library Reviewer", organizationId: ORG };
const manager = { id: "manager-1", permission: "Library Manager", role: "Library Manager", organizationId: ORG };
const spoofed = { id: "spoof-1", permission: "Administrator ", role: "Administrator ", organizationId: ORG };

mock.module("../worker/library-auth.mjs", {
  exports: {
    // Only identity is stubbed: single-user production can only produce
    // Administrator, so restricted roles are exercisable solely through a stub.
    // The gate itself (requireLibraryCapability) is the REAL production code.
    authenticateLibraryActor: async () =>
      actorState.error ? { error: actorState.error } : { actor: actorState.actor },
    requireLibraryCapability,
    hasLibraryCapability,
    LIBRARY_CAPABILITIES,
  },
});

const { handleKnowledgeLibraryApi } = await import("../worker/knowledge-library-api.mjs");

const emptyDb = () => {
  const tables = ["knowledge_files", "knowledge_facts", "knowledge_product_links", "knowledge_file_events"];
  const run = async (sql) => {
    if (sql.includes("sqlite_master")) return { results: tables.map((name) => ({ name })) };
    if (sql.includes("FROM organizations")) return { id: ORG, name: "Test Org", status: "Active" };
    return null;
  };
  const op = (sql, args = []) => ({
    first: async () => run(sql, args),
    all: async () => {
      if (sql.includes("sqlite_master")) return run(sql, args);
      return { results: [] };
    },
    run: async () => ({ meta: { changes: 0 } }),
  });
  return {
    prepare: (sql) => ({ ...op(sql), bind: (...args) => op(sql, args) }),
    batch: async () => [],
  };
};

// KN-HUMAN-1: a manual link is a human identity decision, so a route-level
// capability test must also configure a truthful human -- otherwise the route
// refuses on the human gate before the capability gate is reached.
const HUMAN_ENV = {
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "user-a",
  APP_ORGANIZATION_ID: ORG,
  APP_HUMAN_ID: "op-test-human-1",
  APP_HUMAN_NAME: "Test Knowledge Reviewer",
};

const post = (path, body, actor, authError = null, env = {}) => {
  actorState.actor = actor;
  actorState.error = authError;
  return handleKnowledgeLibraryApi(
    new Request(`https://app.example${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    }),
    { ...HUMAN_ENV, ...env, DB: emptyDb() },
  );
};

test("Viewer POST repair is 403 (gate live on repair route)", async () => {
  const response = await post("/api/knowledge/facts/fact-1/links", { action: "repair", expectedLinkId: "l", expectedTarget: "p", reason: "A substantive governed reason for repair." }, viewer);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "LIBRARY_PERMISSION_DENIED");
});

test("Reviewer POST manual-link is 403 (gate live on manual-link route)", async () => {
  const response = await post("/api/knowledge/link/fact/fact-1", { reason: "A substantive governed reason for linking.", productId: "product-1" }, reviewer);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "LIBRARY_PERMISSION_DENIED");
});

test("Manager passes the repair gate (404 fact, not 403)", async () => {
  const response = await post("/api/knowledge/facts/fact-1/links", { action: "repair", expectedLinkId: "l", expectedTarget: "p", reason: "A substantive governed reason for repair." }, manager);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "KNOWLEDGE_FACT_NOT_FOUND");
});

test("without a configured human the manual-link route refuses before the capability gate", async () => {
  const response = await post(
    "/api/knowledge/link/fact/fact-1",
    { reason: "A substantive governed reason for linking.", productId: "product-1" },
    manager,
    null,
    { APP_HUMAN_ID: "", APP_HUMAN_NAME: "" },
  );
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error.code, "HUMAN_ACTOR_NOT_CONFIGURED");
});

test("Manager passes the manual-link gate (404 fact, not 403)", async () => {
  const response = await post("/api/knowledge/link/fact/fact-1", { reason: "A substantive governed reason for linking.", productId: "product-1" }, manager);
  assert.equal(response.status, 404);
  assert.equal((await response.json()).error.code, "KNOWLEDGE_FACT_NOT_FOUND");
});

test("anonymous remains rejected before any link logic", async () => {
  const response = await post("/api/knowledge/facts/fact-1/links", { action: "repair" }, null, { status: 401, code: "UNAUTHENTICATED" });
  assert.equal(response.status, 401);
});

test("spoofed role string gains no linking rights", async () => {
  const response = await post("/api/knowledge/facts/fact-1/links", { action: "repair", expectedLinkId: "l", expectedTarget: "p", reason: "A substantive governed reason for repair." }, spoofed);
  assert.equal(response.status, 403);
});
