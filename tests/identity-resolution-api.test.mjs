import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { handleIdentityResolutionApi } from "../worker/identity-resolution-api.mjs";

const authMigration = await readFile(new URL("../drizzle/0018_verified_library_authorization.sql", import.meta.url), "utf8");
const authEnv = (permission = "Library Viewer") => {
  const raw = new DatabaseSync(":memory:"); raw.exec(authMigration);
  raw.exec("CREATE TABLE identity_schema_compatibility (component text PRIMARY KEY,schema_version integer,minimum_worker_version integer,maximum_worker_version integer); INSERT INTO identity_schema_compatibility VALUES ('Identity Resolution',23,23,23)");
  raw.prepare("INSERT INTO library_security_principals (user_id,email) VALUES ('u1','u1@example.test')").run();
  raw.prepare("INSERT INTO library_permission_grants (id,user_id,permission,status,granted_by) VALUES ('g1','u1',?,'Active','fixture')").run(permission);
  const DB = { prepare(sql) { const op = (args=[]) => ({ first: async()=>raw.prepare(sql).get(...args), all: async()=>({results:raw.prepare(sql).all(...args)}), run: async()=>raw.prepare(sql).run(...args) }); return {...op(),bind:(...args)=>op(args)}; } };
  return { raw, env: { DB, APP_ACCESS_MODE: "single-user", APP_USER_ID: "local-development-user", APP_USER_EMAIL: "local@development.invalid", APP_ORGANIZATION_ID: "organization_bd_shaft_internal_pilot" } };
};

test("identity API fails closed without configured application context", async () => {
  const fixture = authEnv();
  const response = await handleIdentityResolutionApi(new Request("https://local/api/identity-resolution/rulesets/active"), { DB: fixture.env.DB });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "APPLICATION_CONTEXT_UNAVAILABLE");
  fixture.raw.close();
});

test("ruleset endpoint exposes the deterministic dry-run policy", async () => {
  const fixture = authEnv();
  const request = new Request("https://local/api/identity-resolution/rulesets/active", { headers: { "oai-authenticated-user-id": "u1", "oai-authenticated-user-email": "u1@example.test" } });
  const response = await handleIdentityResolutionApi(request, fixture.env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.safetyPolicy.mergeProducts, false);
  assert.equal(body.rules.at(0).id, "IR-001");
  assert.equal(body.rules.at(-1).id, "IR-160");
  fixture.raw.close();
});

test("analysis APIs remain present beside the separately governed Step 11 operations", async () => {
  const source = await readFile(new URL("../worker/identity-resolution-api.mjs", import.meta.url), "utf8");
  for (const route of ["/analyze", "/conflicts", "/runs/", "/cases/", "/rulesets/"]) assert.ok(source.includes(route));
  assert.doesNotMatch(source, /DELETE\s+FROM\s+library_products|INSERT\s+INTO\s+product_aliases|INSERT\s+INTO\s+product_variants|INSERT\s+INTO\s+product_packages|INSERT\s+INTO\s+product_lifecycle_events|INSERT\s+INTO\s+price_records/i);
  assert.doesNotMatch(source, /bulk[-/]apply|\/merge/);
});

test("migration contains only the six analysis table families and references canonical products read-only", async () => {
  const sql = await readFile(new URL("../drizzle/0015_identity_resolution_analysis.sql", import.meta.url), "utf8");
  for (const table of ["identity_ruleset_versions", "identity_resolution_runs", "identity_resolution_cases", "identity_resolution_candidates", "identity_resolution_proposals", "identity_resolution_rule_traces"]) assert.ok(sql.includes("CREATE TABLE `" + table + "`"));
  assert.doesNotMatch(sql, /ALTER TABLE\s+(library_products|product_aliases|product_variants|product_packages|product_lifecycle_events|price_records)/i);
});
