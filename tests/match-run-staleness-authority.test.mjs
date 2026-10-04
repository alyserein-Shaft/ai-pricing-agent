import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { matchRunStaleness, currentRun } from "../worker/product-matching-api.mjs";
import { STALE_REQUIREMENT_PROFILE_REASON } from "../worker/requirement-profile-currency.mjs";

// Focused proof of the ONE canonical matchRunStaleness authority in
// worker/product-matching-api.mjs, which three importing consumers depend on
// (worker/ai-presales-agent-tools.mjs, worker/fire-alarm-panel-sizing-api.mjs,
// and the staleness suites) but which had no implementation or export at all.
//
// WHY A LOCAL MINIMAL SCHEMA INSTEAD OF tests/fixtures/active-chain-fixture.mjs
// ---------------------------------------------------------------------
// This contract is decided by exactly two relations -- product_match_runs and
// requirement_profile_versions -- and it reads neither any governed engine
// column (see below) nor any current-evidence view. The canonical chain
// fixture is currently unusable for ANY purpose: `activeChainDatabase()` fails
// on its own with "no such table: main.canonical_evidence_integrity" (a trigger
// in the active migration chain references a table the chain never creates),
// which is a PRE-EXISTING foreign migration-drift failure and not this
// contract's business. Using the fixture would therefore make these tests
// vacuous -- they could never reach the helper at all. The same reason
// tests/requirement-profile-staleness.test.mjs carries its own minimal schema.
//
// WHY input_fingerprint / engine_version / ruleset_version / search_version /
// model_version ARE DELIBERATELY ABSENT FROM THIS SCHEMA
// ---------------------------------------------------------------------
// Not to dodge them: to make the exclusion PROVABLE. Every governed fixture
// seeds those columns as 'engine-1'/'rules-1'/'search-1'/'model-1' while the real
// constants are 'product-matching-engine-1.0.0' / 'matching-rules-2026-08-27-
// family-tier' / ... (app/domain/product-matching-engine.mjs:8-19). A helper that
// compared them would report EVERY run in these tests stale on the very first
// assertion. Reproducing that column shape here with a matching name, and
// asserting freshness, is therefore an executable refutation of the
// ruleset/engine/version-drift interpretation of "staleness" -- which is exactly
// the over-broad implementation this suite exists to prevent.

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  },
});

const schema = `
CREATE TABLE requirement_profile_versions(
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT, version_number INTEGER,
  input_fingerprint TEXT, profile TEXT, readiness_status TEXT, superseded_at TEXT);
CREATE TABLE product_match_runs(
  id TEXT PRIMARY KEY, project_id TEXT, boq_item_id TEXT,
  requirement_profile_version_id TEXT, version_number INTEGER, status TEXT,
  input_fingerprint TEXT, engine_version TEXT, ruleset_version TEXT,
  search_version TEXT, model_version TEXT, superseded_at TEXT);
CREATE UNIQUE INDEX product_match_runs_item_version
  ON product_match_runs(boq_item_id, version_number);
`;

const build = () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO requirement_profile_versions VALUES
      ('v1','p1','boq1',1,'fp-v1','{}','Ready for Matching',NULL);
  `);
  return raw;
};

// Deliberately seeds the governed engine/search identity columns with values
// that are NOT the live MATCH_* constants (see the header note).
const insertRun = (raw, { id, profileVersionId, versionNumber, supersededAt = null }) => {
  raw.prepare(`INSERT INTO product_match_runs
    (id, project_id, boq_item_id, requirement_profile_version_id, version_number, status,
     input_fingerprint, engine_version, ruleset_version, search_version, model_version, superseded_at)
    VALUES (?,'p1','boq1',?,?,'Needs Review','fp-run','engine-1','rules-1','search-1','model-1',?)`)
    .run(id, profileVersionId, versionNumber, supersededAt);
};

const publishProfileV2 = (raw) => {
  raw.prepare("UPDATE requirement_profile_versions SET superseded_at='2026-10-02T09:00:00Z' WHERE id='v1'").run();
  raw.prepare("INSERT INTO requirement_profile_versions VALUES ('v2','p1','boq1',2,'fp-v2','{}','Ready with Warnings',NULL)").run();
};

test("a run bound to the item's current, non-superseded profile is current -- even though its engine/ruleset/search/model identity columns do not match the live MATCH_* constants", async () => {
  const raw = build();
  insertRun(raw, { id: "run1", profileVersionId: "v1", versionNumber: 1 });
  const result = await matchRunStaleness(d1(raw), "boq1", raw.prepare("SELECT * FROM product_match_runs WHERE id='run1'").get());
  assert.equal(result.stale, false);
  assert.equal(result.staleReason, null);
  assert.equal(result.currentProfileVersionId, "v1");
  raw.close();
});

test("requirement-profile version drift is stale: a run bound to the superseded V1 after V2 is published", async () => {
  const raw = build();
  insertRun(raw, { id: "run1", profileVersionId: "v1", versionNumber: 1 });
  publishProfileV2(raw);
  const result = await matchRunStaleness(d1(raw), "boq1", raw.prepare("SELECT * FROM product_match_runs WHERE id='run1'").get());
  assert.equal(result.stale, true);
  assert.equal(result.reason, "REQUIREMENT_PROFILE_CHANGED");
  assert.equal(result.staleReason, STALE_REQUIREMENT_PROFILE_REASON);
  assert.equal(result.currentProfileVersionId, "v2");
  raw.close();
});

test("a superseded match run is stale, even when it is bound to the current profile", async () => {
  const raw = build();
  insertRun(raw, { id: "run-old", profileVersionId: "v1", versionNumber: 1, supersededAt: "2026-10-02T09:05:00Z" });
  const result = await matchRunStaleness(d1(raw), "boq1", raw.prepare("SELECT * FROM product_match_runs WHERE id='run-old'").get());
  assert.equal(result.stale, true, "a superseded run must never be certified as current");
  assert.equal(result.reason, "MATCH_RUN_SUPERSEDED");
  raw.close();
});

test("the invalidated window -- V1 superseded with no replacement yet -- reads stale, not fresh", async () => {
  // The exact pause window tests/specification-approval-profile-freshness.test.mjs:264
  // pins: approval publication commits, regeneration has not published a
  // replacement, so there is NO current profile at all.
  const raw = build();
  insertRun(raw, { id: "run1", profileVersionId: "v1", versionNumber: 1 });
  raw.prepare("UPDATE requirement_profile_versions SET superseded_at='2026-10-02T09:00:00Z' WHERE id='v1'").run();
  const result = await matchRunStaleness(d1(raw), "boq1", raw.prepare("SELECT * FROM product_match_runs WHERE id='run1'").get());
  assert.equal(result.stale, true);
  assert.equal(result.reason, "NO_CURRENT_REQUIREMENT_PROFILE");
  assert.equal(result.currentProfileVersionId, null);
  raw.close();
});

test("a missing run is stale, not fresh and not a crash", async () => {
  const raw = build();
  const result = await matchRunStaleness(d1(raw), "boq1", null);
  assert.equal(result.stale, true);
  assert.equal(result.reason, "MATCH_RUN_NOT_FOUND");
  raw.close();
});

test("recovery: a run re-bound to the new current profile is current again, while the old run stays stale and both remain readable history", async () => {
  const raw = build();
  insertRun(raw, { id: "run1", profileVersionId: "v1", versionNumber: 1 });
  publishProfileV2(raw);
  raw.prepare("UPDATE product_match_runs SET superseded_at='2026-10-02T09:05:00Z' WHERE id='run1'").run();
  insertRun(raw, { id: "run2", profileVersionId: "v2", versionNumber: 2 });
  const DB = d1(raw);

  assert.equal((await matchRunStaleness(DB, "boq1", raw.prepare("SELECT * FROM product_match_runs WHERE id='run1'").get())).stale, true);
  assert.equal((await matchRunStaleness(DB, "boq1", raw.prepare("SELECT * FROM product_match_runs WHERE id='run2'").get())).stale, false);

  // currentRun remains the single authority for WHICH run governs the item --
  // the helper does not duplicate that selection.
  assert.equal((await currentRun(DB, "boq1")).id, "run2");
  // ...and history is never rewritten or deleted by a staleness read.
  const historical = raw.prepare("SELECT requirement_profile_version_id, superseded_at FROM product_match_runs WHERE id='run1'").get();
  assert.equal(historical.requirement_profile_version_id, "v1");
  assert.notEqual(historical.superseded_at, null);
  raw.close();
});

test("the reason string is the single shared constant, never a re-typed literal", async () => {
  const raw = build();
  insertRun(raw, { id: "run1", profileVersionId: "v1", versionNumber: 1 });
  publishProfileV2(raw);
  const result = await matchRunStaleness(d1(raw), "boq1", raw.prepare("SELECT * FROM product_match_runs WHERE id='run1'").get());
  // The ai-presales reader surfaces staleReason verbatim; the sizing handler
  // interpolates it into a governed block message. It must match the UI copy in
  // app/components/workspaces/MatchingWorkspace.tsx ("Requirements changed.
  // Product selection must be re-evaluated.") and the safety route's
  // REQUIREMENT_PROFILE_CHANGED refusal.
  assert.match(result.staleReason, /Re-run product matching/);
  assert.equal(result.staleReason, STALE_REQUIREMENT_PROFILE_REASON);
  raw.close();
});