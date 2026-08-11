import assert from "node:assert/strict";
import test from "node:test";
import { authenticateLibraryActor, hasLibraryCapability } from "../worker/library-auth.mjs";

const configured = { APP_ACCESS_MODE: "single-user", APP_USER_ID: "local-development-user", APP_USER_EMAIL: "local@development.invalid", APP_ORGANIZATION_ID: "organization_bd_shaft_internal_pilot", DB: {} };

test("production requests fail closed when server application context is absent", async () => {
  const result = await authenticateLibraryActor(new Request("https://app.example/api/identity-resolution/rulesets/active"), { DB: {} });
  assert.equal(result.error.status, 503);
  assert.equal(result.error.code, "APPLICATION_CONTEXT_UNAVAILABLE");
});

test("client identity, role and organization headers cannot impersonate or elevate", async () => {
  const request = new Request("https://app.example/api/identity-resolution/rulesets/active", { headers: { "x-user-id": "attacker", "x-user-role": "Administrator", "oai-authenticated-user-id": "attacker", "oai-authenticated-user-role": "Administrator", "x-organization-id": "organization_attacker" } });
  const result = await authenticateLibraryActor(request, configured);
  assert.equal(result.actor.id, "local-development-user");
  assert.equal(result.actor.organizationId, "organization_bd_shaft_internal_pilot");
  assert.equal(result.actor.permission, "Administrator");
});

test("durable permission hierarchy remains for the future RBAC phase", () => {
  assert.equal(hasLibraryCapability("Library Viewer", "read"), true);
  assert.equal(hasLibraryCapability("Library Viewer", "review"), false);
  assert.equal(hasLibraryCapability("Library Reviewer", "review"), true);
  assert.equal(hasLibraryCapability("Library Reviewer", "apply"), false);
  assert.equal(hasLibraryCapability("Library Manager", "apply"), true);
  assert.equal(hasLibraryCapability("Administrator", "reverse"), true);
});

test("configured context is deterministic across requests", async () => {
  const first = await authenticateLibraryActor(new Request("https://app.example/a"), configured);
  const second = await authenticateLibraryActor(new Request("https://app.example/b", { headers: { "x-user-id": "other" } }), configured);
  assert.deepEqual(second.actor, first.actor);
});

test("authorization storage absence still fails closed", async () => {
  const unavailable = await authenticateLibraryActor(new Request("https://app.example/a"), { ...configured, DB: null });
  assert.equal(unavailable.error.status, 503);
});

test.skip("FUTURE-RBAC: disabled user grants are rejected", () => {});
test.skip("FUTURE-RBAC: revoked sessions and grants take effect immediately", () => {});
