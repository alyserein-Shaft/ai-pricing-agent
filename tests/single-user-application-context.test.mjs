import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { applicationActor, resolveApplicationContext } from "../worker/application-context.mjs";
import { authenticateLibraryActor, requireLibraryCapability } from "../worker/library-auth.mjs";

const configured = {
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "local-development-user",
  APP_USER_EMAIL: "local@development.invalid",
  APP_ORGANIZATION_ID: "organization_bd_shaft_internal_pilot",
};

test("forged identity and role headers cannot change the server application actor", async () => {
  const request = new Request("https://pricing.internal/api/test", {
    headers: {
      "x-user-id": "attacker-user",
      "x-user-role": "Super Administrator",
      "oai-authenticated-user-id": "attacker-user",
      "oai-authenticated-user-role": "Administrator",
    },
  });
  const result = await resolveApplicationContext(request, configured);
  assert.equal(result.context.userId, "local-development-user");
  assert.equal(result.context.organizationId, "organization_bd_shaft_internal_pilot");
  assert.equal(applicationActor(result.context).permission, "Administrator");
});

test("non-local requests fail closed without explicit server configuration", async () => {
  const result = await resolveApplicationContext(new Request("https://pricing.internal/api/test", {
    headers: { "x-user-id": "local-development-user" },
  }), {});
  assert.equal(result.error?.status, 503);
  assert.equal(result.error?.code, "APPLICATION_CONTEXT_UNAVAILABLE");
});

test("localhost receives only the controlled MVP defaults", async () => {
  const result = await resolveApplicationContext(new Request("http://localhost:5173/api/test", {
    headers: { "x-user-id": "attacker-user", "x-user-role": "Administrator" },
  }), {});
  assert.deepEqual(
    { userId: result.context.userId, organizationId: result.context.organizationId, fullAccess: result.context.fullAccess },
    { userId: "local-development-user", organizationId: "organization_bd_shaft_internal_pilot", fullAccess: true },
  );
});

test("library authorization delegates to the same context and keeps explicit action gates", async () => {
  const result = await authenticateLibraryActor(
    new Request("https://pricing.internal/api/library", { headers: { "x-user-id": "attacker-user" } }),
    { ...configured, DB: {} },
  );
  assert.equal(result.actor.id, "local-development-user");
  assert.equal(result.actor.organizationId, "organization_bd_shaft_internal_pilot");
  assert.equal(requireLibraryCapability(result.actor, "apply"), null);

  const matching = await readFile(new URL("../app/domain/product-matching-engine.mjs", import.meta.url), "utf8");
  const pricing = await readFile(new URL("../app/domain/pricing-engine.mjs", import.meta.url), "utf8");
  assert.match(matching, /approval|review/i);
  assert.match(pricing, /approval|approved/i);
});

test("critical business APIs do not read caller-controlled x-user headers", async () => {
  const files = [
    "document-api.mjs", "classification-api.mjs", "boq-extraction-api.mjs",
    "specification-extraction-api.mjs", "technical-requirement-api.mjs",
    "product-matching-api.mjs", "confidence-safety-api.mjs", "pricing-api.mjs",
    "review-workflow-api.mjs", "excel-export-api.mjs", "case-study-learning-api.mjs",
    "project-pricing-learning-api.mjs", "knowledge-library-api.mjs",
    "product-identity-api.mjs", "identity-resolution-api.mjs", "dashboard-api.mjs",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../worker/${file}`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /x-user-(?:id|role)/i, file);
  }
});

test("drawing and discovery APIs use central context with organization scope", async () => {
  const files = [
    "drawing-intake-api.mjs", "drawing-structural-parser-api.mjs",
    "drawing-structural-review-api.mjs", "drawing-symbol-recognition-api.mjs",
    "drawing-legend-geometry-api.mjs", "symbol-cell-segmentation-api.mjs",
    "symbol-signature-matching-api.mjs", "occurrence-spatial-clustering-api.mjs",
    "engineering-discovery-api.mjs",
  ];
  for (const file of files) {
    const source = await readFile(new URL(`../worker/${file}`, import.meta.url), "utf8");
    assert.match(source, /resolveApplicationContext/, file);
    assert.match(source, /organization_id/, file);
    assert.doesNotMatch(source, /oai-authenticated-user-(?:id|role)|x-user-(?:id|role)/, file);
  }
});
