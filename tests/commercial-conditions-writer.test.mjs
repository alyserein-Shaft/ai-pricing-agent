// Governed writer for commercial_conditions (PRICE_VALIDITY_POLICY).
//
// Proves the already-authorized commercial decision can be persisted through a
// real governed route, and that the EXISTING validity-policy reader then
// honours it -- without changing any policy semantics.
//
// Boundaries deliberately untouched by this suite:
//   * the writer persists a CONDITION only. It never approves a price record,
//     never changes price_records.downstream_use, never creates pricing lines.
//   * VALID_UNTIL_SUPERSEDED still means only "valid_until absent".
//   * explicit expiry, malformed dates, rejection, supersession, Discovery Only
//     and Needs Review all stay blocked.
//
// All persistence proof runs against in-memory SQLite. ZERO live project writes.
import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile } from "node:fs/promises";

import { handleProductPriceLibraryApi } from "../worker/product-price-library-api.mjs";
import { resolvePriceValidityPolicy } from "../worker/commercial-validity-policy.mjs";
import { loadPricingInput } from "../worker/pricing-runtime.mjs";

const GOOD_VERSION = "psv-good";
const OTHER_VERSION = "psv-other";
const SOURCE_ID = "source-1";
const OTHER_SOURCE_ID = "source-2";
const PROJECT_ID = "project-writer";

const REASON = "Authorized company commercial policy: current until superseded.";

// ---------------------------------------------------------------------------
// Isolated fixture DB (in-memory). Mirrors the real canonical DDL exactly.
// ---------------------------------------------------------------------------
const fixture = ({
  versions = [
    { id: GOOD_VERSION, sourceId: SOURCE_ID, approvalState: "Approved", downstreamUse: "Costing", reliability: "Current Internal Reference", supersededAt: null },
    { id: OTHER_VERSION, sourceId: OTHER_SOURCE_ID, approvalState: "Approved", downstreamUse: "Costing", reliability: "Current Internal Reference", supersededAt: null },
  ],
  conditions = [],
} = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE price_source_versions (id TEXT PRIMARY KEY, source_id TEXT, version_number INTEGER, approval_state TEXT, downstream_use TEXT, reliability TEXT, superseded_at TEXT);
    CREATE TABLE commercial_conditions (id text PRIMARY KEY NOT NULL, source_version_id text NOT NULL, condition_type text NOT NULL, value_json text NOT NULL, scope_json text NOT NULL, review_status text NOT NULL DEFAULT 'Needs Review', created_by text NOT NULL, created_at text NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE product_library_decisions (id TEXT PRIMARY KEY NOT NULL, project_id TEXT, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL, previous_value TEXT, new_value TEXT, reason TEXT NOT NULL, decided_by TEXT NOT NULL, decided_role TEXT NOT NULL, decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE price_records (id TEXT PRIMARY KEY NOT NULL, product_id TEXT NOT NULL, source_id TEXT NOT NULL, supplier_id TEXT, project_id TEXT, amount_minor INTEGER, currency TEXT, price_type TEXT, approval_status TEXT, downstream_use TEXT, effective_from TEXT, valid_until TEXT, validity_state TEXT, source_location TEXT, terms TEXT, reviewed_at TEXT, created_at TEXT, status TEXT, superseded_at TEXT);
    -- loadPricingInput support tables
    CREATE TABLE projects (id TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, organization_id TEXT, archived_at TEXT);
    CREATE TABLE pricing_scenarios (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, version_number INTEGER NOT NULL, project_currency TEXT NOT NULL, settings TEXT NOT NULL, deleted_at TEXT, superseded_at TEXT);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT NOT NULL, project_id TEXT NOT NULL, source_document_id TEXT, row_type TEXT, review_status TEXT, approved_for_downstream INTEGER, numeric_quantity REAL, normalized_unit TEXT, updated_at TEXT);
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, boq_item_id TEXT NOT NULL, requirement_profile_version_id TEXT, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT NOT NULL, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE product_match_candidates (id TEXT PRIMARY KEY, match_run_id TEXT NOT NULL, product_id TEXT NOT NULL, review_status TEXT DEFAULT 'Needs Review');
    CREATE TABLE canonical_library_products (id TEXT PRIMARY KEY, requested_product_id TEXT NOT NULL, manufacturer_id TEXT NOT NULL, part_number TEXT, lifecycle_status TEXT);
    CREATE TABLE product_manufacturers (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, candidate_id TEXT NOT NULL, version_number INTEGER NOT NULL, superseded_at TEXT);
    CREATE TABLE safety_approval_requests (id TEXT PRIMARY KEY, safety_decision_id TEXT NOT NULL, approval_type TEXT NOT NULL, status TEXT NOT NULL, decided_at TEXT);
    CREATE TABLE pricing_exchange_rates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, from_currency TEXT, to_currency TEXT, rate TEXT, source TEXT, version_number INTEGER, approval_status TEXT, valid_until TEXT, superseded_at TEXT);
    CREATE TABLE suppliers (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE boq_quantity_source_decisions (id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, source TEXT, selected_quantity REAL, boq_quantity REAL, drawing_quantity REAL, recognition_version_id TEXT, definition_key TEXT, reason TEXT, decided_by TEXT, created_at TEXT);

    INSERT INTO projects VALUES ('${PROJECT_ID}','local-development-user','org',NULL);
    INSERT INTO documents VALUES ('doc-current','${PROJECT_ID}','doc-version-current',NULL,NULL);
    INSERT INTO document_versions (id, document_id) VALUES ('doc-version-current','doc-current');
    INSERT INTO pricing_scenarios VALUES ('sc','${PROJECT_ID}',1,'SAR','{}',NULL,NULL);
    INSERT INTO boq_extraction_versions VALUES ('boq-v','doc-current','doc-version-current',1,'Completed',NULL);
    INSERT INTO boq_items VALUES ('boq-current','boq-v','${PROJECT_ID}','doc-current','BOQ Item','Approved',1,1,'EA','2026-08-10T12:00:00Z');
    INSERT INTO product_manufacturers VALUES ('mfr-1','Honeywell');
    INSERT INTO canonical_library_products VALUES ('product-1','product-1','mfr-1','IFP-2100HV','Active');
    INSERT INTO requirement_profile_versions VALUES ('prof','boq-current',1,NULL);
    INSERT INTO product_match_runs VALUES ('run','${PROJECT_ID}','boq-current','prof',1,NULL);
    INSERT INTO product_match_candidates (id, match_run_id, product_id) VALUES ('cand','run','product-1');
    INSERT INTO safety_decisions VALUES ('sd','cand',1,NULL);
    INSERT INTO safety_approval_requests VALUES ('ta','sd','Technical','Approved','2026-08-10T12:10:00Z');
  `);
  const insVersion = raw.prepare("INSERT INTO price_source_versions VALUES (?,?,?,?,?,?,?)");
  for (const v of versions)
    insVersion.run(v.id, v.sourceId, 1, v.approvalState, v.downstreamUse, v.reliability, v.supersededAt);
  const insCond = raw.prepare("INSERT INTO commercial_conditions VALUES (?,?,?,?,?,?,?,?)");
  conditions.forEach((c, i) =>
    insCond.run(c.id || `cond-${i}`, c.sourceVersionId, c.conditionType ?? "PRICE_VALIDITY_POLICY", JSON.stringify(c.value ?? { policy: "VALID_UNTIL_SUPERSEDED" }), "{}", c.reviewStatus ?? "Approved", c.createdBy ?? "seed", c.createdAt ?? `2026-08-0${i + 1}T00:00:00Z`),
  );

  const operation = (sql, args = []) => ({
    first: async () => raw.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...args) }),
    run: async () => raw.prepare(sql).run(...args),
  });
  const DB = {
    prepare(sql) {
      return { ...operation(sql), bind: (...args) => operation(sql, args) };
    },
    async batch(statements) {
      return statements;
    },
  };
  const env = { DB, APP_ACCESS_MODE: "single-user", APP_USER_ID: "omair-primary", APP_USER_NAME: "Omair", APP_ORGANIZATION_ID: "org" };
  return { raw, DB, env };
};

const post = (env, sourceVersionId, body) =>
  handleProductPriceLibraryApi(
    new Request(`https://localhost/api/price-source-versions/${sourceVersionId}/conditions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

const validBody = (overrides = {}) => ({ conditionType: "PRICE_VALIDITY_POLICY", value: { policy: "VALID_UNTIL_SUPERSEDED" }, reason: REASON, ...overrides });

// ===========================================================================
// 1. Authorization
// ===========================================================================
test("1. fails closed with no server application context (the reachable unauthorized path in the single-user MVP)", async () => {
  const { raw } = fixture();
  const response = await handleProductPriceLibraryApi(
    new Request(`https://example.com/api/price-source-versions/${GOOD_VERSION}/conditions`, {
      method: "POST",
      body: JSON.stringify(validBody()),
    }),
    { DB: {} },
  );
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, "APPLICATION_CONTEXT_UNAVAILABLE");
  raw.close();
});

test("1b. the route is gated by canGovernGlobal(user.role) before any write", async () => {
  const source = await readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("sourceVersionConditionsMatch"), source.indexOf("const sourceMatch"));
  assert.match(block, /canGovernGlobal\(user\.role\)/, "must use the existing governance role check");
  assert.ok(block.indexOf("canGovernGlobal") < block.indexOf("INSERT INTO commercial_conditions"), "auth must precede the write");
  assert.match(block, /LIBRARY_ROLE_REQUIRED/);
});

// ===========================================================================
// 2-4. Request validation
// ===========================================================================
test("2. invalid conditionType -> rejected", async () => {
  const { raw, env } = fixture();
  const r = await post(env, GOOD_VERSION, validBody({ conditionType: "SOMETHING_ELSE" }));
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, "CONDITION_TYPE_NOT_SUPPORTED");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 0);
  raw.close();
});

test("3. invalid policy value -> rejected", async () => {
  const { raw, env } = fixture();
  const r = await post(env, GOOD_VERSION, validBody({ value: { policy: "ALLOW_EXPIRED" } }));
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, "CONDITION_POLICY_NOT_SUPPORTED");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 0);
  raw.close();
});

test("4. short reason -> rejected", async () => {
  const { raw, env } = fixture();
  const r = await post(env, GOOD_VERSION, validBody({ reason: "too short" }));
  assert.equal(r.status, 422);
  assert.equal((await r.json()).error.code, "REVIEW_REASON_REQUIRED");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 0);
  raw.close();
});

// ===========================================================================
// 5-9. Target source-version gates
// ===========================================================================
test("5. missing source version -> rejected", async () => {
  const { raw, env } = fixture();
  const r = await post(env, "psv-does-not-exist", validBody());
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error.code, "PRICE_SOURCE_VERSION_NOT_FOUND");
  raw.close();
});

test("6. non-Approved source version -> rejected", async () => {
  const { raw, env } = fixture({ versions: [{ id: GOOD_VERSION, sourceId: SOURCE_ID, approvalState: "Needs Review", downstreamUse: "Costing", reliability: "Current Internal Reference", supersededAt: null }] });
  const r = await post(env, GOOD_VERSION, validBody());
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "PRICE_SOURCE_VERSION_NOT_APPROVED");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 0);
  raw.close();
});

test("7. non-Costing source version -> rejected", async () => {
  const { raw, env } = fixture({ versions: [{ id: GOOD_VERSION, sourceId: SOURCE_ID, approvalState: "Approved", downstreamUse: "Discovery Only", reliability: "Current Internal Reference", supersededAt: null }] });
  const r = await post(env, GOOD_VERSION, validBody());
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "PRICE_SOURCE_VERSION_NOT_COSTING");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 0);
  raw.close();
});

test("8. non-current/historical source version -> rejected", async () => {
  const { raw, env } = fixture({ versions: [{ id: GOOD_VERSION, sourceId: SOURCE_ID, approvalState: "Approved", downstreamUse: "Costing", reliability: "Historical Reference", supersededAt: null }] });
  const r = await post(env, GOOD_VERSION, validBody());
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "PRICE_SOURCE_VERSION_NOT_CURRENT_REFERENCE");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 0);
  raw.close();
});

test("9. superseded source version -> rejected", async () => {
  const { raw, env } = fixture({ versions: [{ id: GOOD_VERSION, sourceId: SOURCE_ID, approvalState: "Approved", downstreamUse: "Costing", reliability: "Current Internal Reference", supersededAt: "2026-09-01T00:00:00Z" }] });
  const r = await post(env, GOOD_VERSION, validBody());
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "PRICE_SOURCE_VERSION_SUPERSEDED");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 0);
  raw.close();
});

// ===========================================================================
// 10-13. Successful persistence, state, identity, audit
// ===========================================================================
test("10/11/12. valid request -> exactly one Approved condition with creator identity preserved", async () => {
  const { raw, env } = fixture();
  const r = await post(env, GOOD_VERSION, validBody());
  assert.equal(r.status, 201);
  const body = await r.json();
  assert.equal(body.reviewStatus, "Approved");
  assert.equal(body.createdBy, "omair-primary");
  assert.equal(body.idempotent, false);
  assert.equal(body.approvedPrices, 0, "the writer approves no price");
  assert.equal(body.downstreamUseChanged, false, "the writer changes no downstream use");

  const rows = raw.prepare("SELECT * FROM commercial_conditions").all();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.source_version_id, GOOD_VERSION);
  assert.equal(row.condition_type, "PRICE_VALIDITY_POLICY");
  assert.equal(row.review_status, "Approved");
  assert.equal(row.created_by, "omair-primary");
  assert.deepEqual(JSON.parse(row.value_json), { policy: "VALID_UNTIL_SUPERSEDED" });
  assert.ok(row.created_at, "created_at populated by the schema default");
  raw.close();
});

test("13. a decision() audit row is created identifying actor, entity, target, action and reason", async () => {
  const { raw, env } = fixture();
  const created = await (await post(env, GOOD_VERSION, validBody())).json();
  const audit = raw.prepare("SELECT * FROM product_library_decisions WHERE entity_id=?").get(created.conditionId);
  assert.ok(audit, "audit row must exist for the condition");
  assert.equal(audit.entity_type, "Commercial Condition");
  assert.equal(audit.action, "Approved");
  assert.equal(audit.decided_by, "omair-primary");
  assert.equal(audit.reason, REASON);
  const next = JSON.parse(audit.new_value);
  assert.equal(next.sourceVersionId, GOOD_VERSION);
  assert.equal(next.reviewStatus, "Approved");
  assert.deepEqual(next.value, { policy: "VALID_UNTIL_SUPERSEDED" });
  raw.close();
});

// ===========================================================================
// 14. Existing reader compatibility -- unchanged semantics
// ===========================================================================
test("14. the EXISTING resolvePriceValidityPolicy reader recognises the newly persisted condition", async () => {
  const { raw, DB, env } = fixture();
  assert.equal((await resolvePriceValidityPolicy(DB, [SOURCE_ID])).allows, false, "before: no policy");
  await post(env, GOOD_VERSION, validBody());
  const after = await resolvePriceValidityPolicy(DB, [SOURCE_ID]);
  assert.equal(after.allows, true);
  assert.equal(after.policy, "VALID_UNTIL_SUPERSEDED");
  assert.deepEqual(after.sourceVersionIds, [GOOD_VERSION]);
  raw.close();
});

// ===========================================================================
// 19. Wrong source version cannot borrow
// ===========================================================================
test("19. a condition on one source version is NOT borrowed by another", async () => {
  const { raw, DB, env } = fixture();
  await post(env, GOOD_VERSION, validBody());
  assert.equal((await resolvePriceValidityPolicy(DB, [OTHER_SOURCE_ID])).allows, false, "the sibling source must not inherit authority");
  assert.equal((await resolvePriceValidityPolicy(DB, [SOURCE_ID])).allows, true);
  raw.close();
});

// ===========================================================================
// 20-21. Duplicate / conflict
// ===========================================================================
test("20. an identical current approved condition is idempotent -- no duplicate authority", async () => {
  const { raw, env } = fixture();
  const first = await (await post(env, GOOD_VERSION, validBody())).json();
  const second = await post(env, GOOD_VERSION, validBody());
  assert.equal(second.status, 200);
  const again = await second.json();
  assert.equal(again.idempotent, true);
  assert.equal(again.duplicateAction, "EXISTING_APPROVED_CONDITION_RETAINED");
  assert.equal(again.conditionId, first.conditionId, "same governed row returned");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 1, "still exactly one row");
  raw.close();
});

test("21. a conflicting current condition fails closed and is never silently replaced", async () => {
  const { raw, env } = fixture({
    conditions: [{ id: "cond-existing", sourceVersionId: GOOD_VERSION, value: { policy: "SOMETHING_ELSE" }, reviewStatus: "Approved" }],
  });
  const r = await post(env, GOOD_VERSION, validBody());
  assert.equal(r.status, 409);
  const err = (await r.json()).error;
  assert.equal(err.code, "CONDITION_CONFLICT");
  assert.equal(err.currentCondition.conditionId, "cond-existing");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 1, "nothing written");
  assert.equal(raw.prepare("SELECT value_json FROM commercial_conditions WHERE id='cond-existing'").get().value_json, JSON.stringify({ policy: "SOMETHING_ELSE" }), "existing row untouched");
  raw.close();
});

test("21b. a non-approved current condition also fails closed rather than being overwritten", async () => {
  const { raw, env } = fixture({
    conditions: [{ id: "cond-pending", sourceVersionId: GOOD_VERSION, value: { policy: "SOMETHING_ELSE" }, reviewStatus: "Needs Review" }],
  });
  const r = await post(env, GOOD_VERSION, validBody());
  assert.equal(r.status, 409);
  assert.equal((await r.json()).error.code, "CONDITION_CONFLICT");
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM commercial_conditions").get().n, 1);
  raw.close();
});

// ===========================================================================
// 15-18 + 12b. Downstream gates remain intact after persistence
// ===========================================================================
const seedPrice = (raw, { validUntil = null, effectiveFrom = "1st March 2023", approvalStatus = "Approved", downstreamUse = "Costing" }) => {
  raw.prepare("DELETE FROM price_records").run();
  raw.prepare("INSERT INTO price_records VALUES ('price-1','product-1','source-1',NULL,NULL,678700,'USD','Manufacturer List Price',?,?,?,?,'Historical — Validity End Missing','{}','{}',NULL,'2026-08-10T12:00:00Z',NULL,NULL)")
    .run(approvalStatus, downstreamUse, effectiveFrom, validUntil);
};

const priceEligibility = async (raw, DB) => {
  const input = await loadPricingInput(DB, {
    projectId: PROJECT_ID, boqItemId: "boq-current", candidateId: "cand",
    scenario: { id: "sc", version_number: 1, project_currency: "SAR", settings: "{}" },
    body: { selectedPriceSourceId: "price-1", discounts: [], costComponents: [], sellingRule: { method: "Markup", rate: 0, minimumMargin: 0 }, customerDiscount: { percentage: 0 }, vatRule: { rate: 0 } },
  });
  return input.safetyDecision.priceEligibility;
};

test("12b/14b. after persistence, a MISSING validity date becomes temporally usable", async () => {
  const { raw, DB, env } = fixture();
  seedPrice(raw, { validUntil: null });
  await post(env, GOOD_VERSION, validBody());
  assert.equal(await priceEligibility(raw, DB), "Eligible for Price Approval");
  raw.close();
});

test("15. an EXPLICIT expired price remains blocked after persistence", async () => {
  const { raw, DB, env } = fixture();
  await post(env, GOOD_VERSION, validBody());
  seedPrice(raw, { validUntil: "2020-01-01" });
  assert.equal(await priceEligibility(raw, DB), "Price Approval Disabled");
  raw.close();
});

test("16. MALFORMED dates remain blocked after persistence", async () => {
  for (const o of [{ validUntil: "garbage" }, { validUntil: null, effectiveFrom: "not a date" }]) {
    const { raw, DB, env } = fixture();
    await post(env, GOOD_VERSION, validBody());
    seedPrice(raw, o);
    assert.equal(await priceEligibility(raw, DB), "Price Approval Disabled", `must stay blocked: ${JSON.stringify(o)}`);
    raw.close();
  }
});

test("17. a Discovery Only price remains blocked after persistence", async () => {
  const { raw, DB, env } = fixture();
  await post(env, GOOD_VERSION, validBody());
  seedPrice(raw, { validUntil: null, downstreamUse: "Discovery Only" });
  assert.equal(await priceEligibility(raw, DB), "Price Approval Disabled");
  raw.close();
});

test("18. a Needs Review price remains blocked after persistence", async () => {
  const { raw, DB, env } = fixture();
  await post(env, GOOD_VERSION, validBody());
  seedPrice(raw, { validUntil: null, approvalStatus: "Needs Review" });
  assert.equal(await priceEligibility(raw, DB), "Price Approval Disabled");
  raw.close();
});

// Supersession of a price record is expressed through approval_status (the
// per-record review route) or validity_state (the supplier-price-intake
// supersession path, which deliberately leaves approval_status untouched).
// Both are blocked independently of the validity policy.
test("19b. a superseded price record remains blocked after persistence", async () => {
  for (const [label, row] of [
    ["approval_status='Superseded'", { approvalStatus: "Superseded", validityState: "Superseded" }],
    ["validity_state='Superseded' with approval untouched (supplier-intake shape)", { approvalStatus: "Approved", validityState: "Superseded" }],
  ]) {
    const { raw, DB, env } = fixture();
    await post(env, GOOD_VERSION, validBody());
    raw.prepare("DELETE FROM price_records").run();
    raw.prepare("INSERT INTO price_records VALUES ('price-1','product-1','source-1',NULL,NULL,678700,'USD','Manufacturer List Price',?,'Costing','1st March 2023',NULL,?,'{}','{}',NULL,'2026-08-10T12:00:00Z',NULL,NULL)")
      .run(row.approvalStatus, row.validityState);
    assert.equal(await priceEligibility(raw, DB), "Price Approval Disabled", `must stay blocked: ${label}`);
    raw.close();
  }
});

// price_records has NO superseded_at column in the canonical schema, so the
// fixture must not pretend it does. Supersession authority is approval_status
// plus validity_state; the resolver still honours a superseded_at stamp so a
// mapped source that carries one stays safe.
test("19c. validity_state='Superseded' is now authoritative supersession, and stays distinct from Rejected", async () => {
  const { priceValidity } = await import("../app/domain/pricing-engine.mjs");
  assert.equal(priceValidity({ status: "Superseded", supersededAt: null, validUntil: null }), "Superseded");
  assert.equal(priceValidity({ status: "Superseded", supersededAt: "2026-01-01" }), "Superseded");
  assert.equal(priceValidity({ status: "Rejected", supersededAt: null, validUntil: null }), "Rejected");
  assert.equal(priceValidity({ status: "Current Approved", supersededAt: null, validUntil: null }), "No Validity Provided");
});

// ===========================================================================
// Schema modelling + no drift + no migration
// ===========================================================================
test("db/schema.ts models the existing table exactly, and NO migration was created", async () => {
  const schema = await readFile(new URL("../db/schema.ts", import.meta.url), "utf8");
  assert.match(schema, /sqliteTable\("commercial_conditions"/);
  const decl = schema.slice(schema.indexOf('sqliteTable("commercial_conditions"'), schema.indexOf("export const productLibraryDecisions"));
  for (const col of ["source_version_id", "condition_type", "value_json", "scope_json", "review_status", "created_by", "created_at"]) assert.match(decl, new RegExp(`text\\("${col}"`), `must model ${col}`);
  assert.match(decl, /default\("Needs Review"\)/, "review_status default must match the DDL");
  assert.match(decl, /CURRENT_TIMESTAMP/, "created_at default must match the DDL");
  // no invented columns
  for (const forbidden of ["superseded_at", "approved_by", "valid_until", "version_number"]) assert.doesNotMatch(decl, new RegExp(forbidden), `must not add ${forbidden}`);
});

test("no migration file references commercial_conditions beyond the pre-existing 0014 creation", async () => {
  const fs = await import("node:fs/promises");
  const dir = new URL("../drizzle/", import.meta.url);
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".sql"));
  const hits = [];
  for (const f of files) if ((await fs.readFile(new URL(f, dir), "utf8")).includes("commercial_conditions")) hits.push(f);
  assert.deepEqual(hits, ["0014_task9_fire_alarm_library.sql"], "commercial_conditions must appear in exactly one migration: the pre-existing creation");
});

test("writer gates and reader gates cannot drift (same authority predicate)", async () => {
  const source = await readFile(new URL("../worker/product-price-library-api.mjs", import.meta.url), "utf8");
  const block = source.slice(source.indexOf("sourceVersionConditionsMatch"), source.indexOf("const sourceMatch"));
  for (const gate of ["PRICE_SOURCE_VERSION_NOT_APPROVED", "PRICE_SOURCE_VERSION_NOT_COSTING", "PRICE_SOURCE_VERSION_NOT_CURRENT_REFERENCE", "PRICE_SOURCE_VERSION_SUPERSEDED"]) assert.ok(block.includes(gate), `writer must enforce ${gate}`);
  const reader = await readFile(new URL("../worker/commercial-validity-policy.mjs", import.meta.url), "utf8");
  for (const marker of ["approval_state = 'Approved'", "downstream_use = 'Costing'", "reliability = 'Current Internal Reference'", "superseded_at IS NULL"]) assert.ok(reader.includes(marker), `reader enforces ${marker}`);
});