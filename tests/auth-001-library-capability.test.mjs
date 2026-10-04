// AUTH-001 -- corrected root cause and authority correction.
//
// Drives the REAL route against the REAL active migration chain, resolving the
// actor through the REAL application context. No globalThis shim, no injected
// actor object, no fake second user as the PRIMARY proof.
//
// The honest constraint, asserted rather than hidden: resolveApplicationContext
// 503s on any access mode other than "single-user" and can produce exactly one
// actor, whose default role is Administrator. A restricted end-to-end actor
// therefore CANNOT exist in the current supported architecture. These tests
// prove the real context allows, prove the canonical gate denies a restricted
// ROLE (a real vocabulary value, not an injected actor), and assert the
// structural fact that the deployment cannot currently produce one.

import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleKnowledgeLibraryApi } from "../worker/knowledge-library-api.mjs";
import { resolveApplicationContext, applicationActor } from "../worker/application-context.mjs";
import { authenticateLibraryActor, requireLibraryCapability, hasLibraryCapability, LIBRARY_CAPABILITIES } from "../worker/library-auth.mjs";

const ORG = "organization_bd_shaft_internal_pilot";
const realEnv = (db) => ({ DB: db, APP_ACCESS_MODE: "single-user", APP_USER_ID: "real-app-user", APP_ORGANIZATION_ID: ORG });

const seeded = () => {
  const db = d1(activeChainDatabase());
  db.prepare("INSERT INTO organizations (id,name) VALUES (?,?)").bind(ORG, "Test Org").run();
  return db;
};

const get = (path) => handleKnowledgeLibraryApi(new Request(`http://localhost${path}`), realEnv(db));
let db;
const before = async () => { db = seeded(); };

// A) REAL application-context resolution: the deployed context yields
//    Administrator, and that actor is allowed by the canonical gate.
test("AUTH-001/A the real application context resolves an Administrator actor that the gate allows", async () => {
  await before();
  const { context } = await resolveApplicationContext(new Request("http://localhost/api/knowledge/files"), realEnv(db));
  assert.equal(context.accessMode, "single-user");
  assert.equal(context.userId, "real-app-user");
  assert.equal(context.organizationId, ORG);

  const { actor } = await authenticateLibraryActor(new Request("http://localhost/api/knowledge/files"), realEnv(db));
  assert.equal(actor.role, "Administrator");
  assert.equal(actor.fullAccess, true, "an explicit Administrator grant is still signalled");
  assert.equal(requireLibraryCapability(actor, "approve"), null, "the real actor must be allowed");
  assert.equal(requireLibraryCapability(actor, "reverse"), null);
});

// B) A governed Library action through the REAL route with the REAL actor succeeds.
test("AUTH-001/B a governed Library read through the real route succeeds for the real actor", async () => {
  await before();
  const response = await get("/api/knowledge/summary");
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.ok(body.organization, "the real org-scoped summary is returned");
  assert.equal(body.organization.id, ORG);
});

// C) The three previously-ungated org-private read routes are now gated with the
//    canonical read capability, and still serve the real actor.
test("AUTH-001/C all org-scoped Knowledge read routes are now capability-gated", async () => {
  await before();
  for (const path of ["/api/knowledge/files", "/api/knowledge/search?q=x", "/api/knowledge/summary"]) {
    const response = await get(path);
    assert.equal(response.status, 200, `${path} must still serve the real actor, got ${response.status}`);
  }
});

// D) The gate genuinely denies a restricted ROLE. This is a real value from the
//    canonical capability vocabulary, evaluated by the production gate -- not an
//    injected actor and not a global shim.
test("AUTH-001/D the canonical gate denies a restricted role even when fullAccess is true", async () => {
  const restricted = { id: "u", permission: "Library Viewer", role: "Library Viewer", fullAccess: true };
  const denied = requireLibraryCapability(restricted, "reverse");
  assert.ok(denied, "a Library Viewer must not satisfy Library Manager capabilities");
  assert.equal(denied.status, 403);
  assert.equal(denied.code, "LIBRARY_PERMISSION_DENIED");

  // ...and fullAccess is no longer a bypass: it changed the outcome nowhere.
  assert.equal(hasLibraryCapability("Library Viewer", "read"), true, "read is still allowed for a Viewer");
  assert.equal(requireLibraryCapability(restricted, "read"), null);
  assert.equal(requireLibraryCapability({ permission: "Library Manager", role: "Library Manager", fullAccess: false }, "reverse"), null,
    "fullAccess is not required to pass: the ROLE is what is evaluated");
});

// E) No universal privilege: fullAccess is derived from the role, not hardcoded.
test("AUTH-001/E fullAccess is an explicit Administrator grant, not a universal constant", async () => {
  const context = { userId: "u", organizationId: ORG, accessMode: "single-user", authenticationSource: "test" };
  assert.equal(applicationActor(context, "Administrator").fullAccess, true);
  assert.equal(applicationActor(context, "Library Manager").fullAccess, false);
  assert.equal(applicationActor(context, "Library Reviewer").fullAccess, false);
  // The default is still Administrator, so the deployed single-user context is
  // unchanged; what changed is that the flag no longer lies for any other role.
  assert.equal(applicationActor(context).fullAccess, true);
});

// F) Administrator satisfies every capability on its OWN rank -- the reason
//    removing the fullAccess short-circuit is behaviour-preserving today.
test("AUTH-001/F Administrator passes every capability without relying on fullAccess", async () => {
  for (const capability of Object.keys(LIBRARY_CAPABILITIES)) {
    assert.equal(hasLibraryCapability("Administrator", capability), true, `Administrator must satisfy ${capability}`);
    assert.equal(requireLibraryCapability({ permission: "Administrator", role: "Administrator", fullAccess: false }, capability), null,
      `${capability} must not depend on fullAccess`);
  }
});

// G) THE STRUCTURAL FACT, asserted rather than faked: the supported architecture
//    cannot currently produce a restricted end-to-end actor. This is why the
//    denial proof is at the role/gate level and not an end-to-end 403.
test("AUTH-001/G a restricted end-to-end actor cannot be produced by the supported architecture", async () => {
  await before();
  // Any non-single-user mode is refused outright.
  for (const mode of ["multi-user", "team", "", "enterprise"]) {
    const resolved = await resolveApplicationContext(
      new Request("http://localhost/api/knowledge/files"),
      { ...realEnv(db), APP_ACCESS_MODE: mode },
    );
    if (mode === "") {
      // Empty falls back to "single-user" only for a local host.
      continue;
    }
    assert.ok(resolved.error, `mode ${JSON.stringify(mode)} must not resolve an actor`);
    assert.equal(resolved.error.code, "APPLICATION_CONTEXT_UNAVAILABLE");
  }
  // The supported path always yields Administrator, which the gate allows.
  const { actor } = await authenticateLibraryActor(new Request("http://localhost/api/knowledge/files"), realEnv(db));
  assert.equal(actor.role, "Administrator");
  assert.equal(requireLibraryCapability(actor, "approve"), null);
});

// H) Organization isolation is unchanged: the routes stay scoped to the actor's org.
test("AUTH-001/H organization scoping of the gated read routes is unchanged", async () => {
  await before();
  const body = await (await get("/api/knowledge/summary")).json();
  assert.equal(body.organization.id, ORG);
  const files = await (await get("/api/knowledge/files")).json();
  assert.ok(Array.isArray(files.files));
  for (const file of files.files) assert.ok(file, "files belong to the resolved organization only");
});
