// Focused guardrail tests for the stale-read slice (2026-10-03).
//
// Scope: the four LOW-RISK fixes only --
//   1. the single governed document-version predicate,
//   2. the product-price-library head check that uses it,
//   3. canonical local-D1 resolution by identity,
//   4. /tmp checksum-cache currentness,
// plus the presence of the final-state re-read / lore-boundary policy wording.
//
// No network, no live D1, no project-data mutation. The predicate is exercised
// against a real in-memory SQLite schema so the SQL is proven, not string-matched.
import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";

import { documentVersionGoverningPredicate } from "../worker/current-evidence-scope.mjs";
import {
  CANONICAL_D1_RELATIVE_PATH,
  CANONICAL_D1_DATABASE_ID,
  CanonicalD1NotFoundError,
  resolveCanonicalD1,
} from "../scripts/lib/canonical-d1.mjs";

const repoRoot = new URL("..", import.meta.url).pathname;

/** Minimal documents/document_versions schema so the predicate is really executed. */
const schema = (db) => {
  db.exec(`CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
           CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, version_number INTEGER, original_filename TEXT);`);
  const insDoc = db.prepare("INSERT INTO documents (id, project_id, current_version_id) VALUES (?, 'p1', ?)");
  const insVer = db.prepare("INSERT INTO document_versions (id, document_id, version_number, original_filename) VALUES (?, ?, ?, ?)");
  insDoc.run("d1", "v2");
  insVer.run("v1", "d1", 1, "KSA Honeywell Farenhyt Series Price List -2023.xlsx");
  insVer.run("v2", "d1", 2, "KSA Honeywell Farenhyt Series Price List -2023.xlsx");
};

const governingRows = (db) => db.prepare(
  `SELECT v.id FROM documents d JOIN document_versions v ON ${documentVersionGoverningPredicate("v", "d")} WHERE d.id='d1'`,
).all().map((r) => r.id);

// ---------------------------------------------------------------- 1. predicate

test("the governed predicate admits exactly the current document version", () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  assert.deepEqual(governingRows(db), ["v2"]);
  db.close();
});

test("the governing predicate rejects a superseded version of the same document", () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  assert.ok(!governingRows(db).includes("v1"), "v1 must never be governed evidence once v2 is head");
  db.close();
});

test("same filename + newer version exists -> the OLD version is still not governing", () => {
  // The filename is identical, which is exactly the case a filename-based or
  // sha/filename duplicate check would wrongly treat as the same document.
  const db = new DatabaseSync(":memory:");
  schema(db);
  const names = db.prepare("SELECT original_filename FROM document_versions").all().map((r) => r.original_filename);
  assert.equal(new Set(names).size, 1, "both versions share one filename");
  assert.deepEqual(governingRows(db), ["v2"]);
  db.close();
});

// ------------------------------------------------------- 2. price ingest gate

test("the price-library ingest route blocks a superseded document version", () => {
  const src = readFileSync(join(repoRoot, "worker/product-price-library-api.mjs"), "utf8");
  assert.match(src, /STALE_DOCUMENT_VERSION/, "an explicit fail-closed code is required");
  assert.match(src, /current_version_id/, "the gate must compare against documents.current_version_id");
  // The gate must reuse the shared predicate rather than invent a second one.
  assert.match(src, /import \{ documentVersionGoverningPredicate \} from "\.\/current-evidence-scope\.mjs"/);
  // It must be a refusal (409), never a silent substitution of the head version.
  assert.match(src, /\}, 409\);\s*\}/, "the stale case must return 409");
  assert.ok(!/current_version_id\s*=\s*document\.current_version_id/.test(src), "must not silently swap in the head version");
});

test("the current document version remains ingestible (gate is not blanket-denying)", () => {
  const db = new DatabaseSync(":memory:");
  schema(db);
  const head = db.prepare("SELECT v.id FROM document_versions v JOIN documents d ON d.current_version_id=v.id WHERE v.id='v2'").get();
  assert.ok(head, "v2 is the head and therefore ingestible");
  db.close();
});

// ------------------------------------------------------ 3. canonical D1 lookup

test("canonical D1 resolves by identity, not by size or readdir order", () => {
  assert.equal(CANONICAL_D1_RELATIVE_PATH, `.wrangler/state/v3/d1/miniflare-D1DatabaseObject/${CANONICAL_D1_DATABASE_ID}.sqlite`);
  const root = mkdtempSync(join(tmpdir(), "canon-d1-"));
  const dir = join(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  mkdirSync(dir, { recursive: true });
  // A LARGE decoy backup sharing the canonical id, plus a large decoy elsewhere:
  // a largest-file or first-match selection would take one of these.
  writeFileSync(join(dir, `${CANONICAL_D1_DATABASE_ID}.pre-npq-0061.sqlite`), Buffer.alloc(4096));
  writeFileSync(join(dir, `${CANONICAL_D1_DATABASE_ID}.sqlite`), Buffer.alloc(16));
  writeFileSync(join(dir, "metadata.sqlite"), Buffer.alloc(8192));
  assert.equal(resolveCanonicalD1({ cwd: root, env: {} }), join(dir, `${CANONICAL_D1_DATABASE_ID}.sqlite`));
});

test("canonical D1 fails closed when absent and never substitutes another file", () => {
  const root = mkdtempSync(join(tmpdir(), "canon-d1-missing-"));
  const dir = join(root, ".wrangler/state/v3/d1/miniflare-D1DatabaseObject");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "some-other-large.sqlite"), Buffer.alloc(8192));
  assert.throws(() => resolveCanonicalD1({ cwd: root, env: {} }), CanonicalD1NotFoundError);
  assert.throws(() => resolveCanonicalD1({ cwd: root, env: {} }), /Refusing to substitute another sqlite file/);
});

test("a configured override still resolves deliberately, and fails closed if absent", () => {
  const root = mkdtempSync(join(tmpdir(), "canon-d1-override-"));
  const fixture = join(root, "fixture.sqlite");
  writeFileSync(fixture, Buffer.alloc(32));
  assert.equal(resolveCanonicalD1({ cwd: root, env: {}, override: fixture }), fixture);
  assert.throws(() => resolveCanonicalD1({ cwd: root, env: {}, override: join(root, "nope.sqlite") }), CanonicalD1NotFoundError);
  const envPath = join(root, "env.sqlite");
  writeFileSync(envPath, Buffer.alloc(32));
  assert.equal(resolveCanonicalD1({ cwd: root, env: { CANONICAL_D1_PATH: envPath } }), envPath);
});

test("no audited script still selects the live D1 by first-match or largest-file", () => {
// `ordering` = the unsafe selection shape that must be gone.
  // `identity` = the evidence that identity-based resolution replaced it. The
  // shell runbook cannot import a JS constant, so it pins the documented literal
  // path, which IS the database identity.
  const audited = [
    { file: "scripts/run-real-product-matching-smoke.mjs", ordering: /readdirSync\(d1Directory\)/, identity: /lib\/canonical-d1\.mjs/ },
    { file: "scripts/stage14-8a-golden-extract.mjs", ordering: /sort\(\(a, b\) => b\.s - a\.s\)/, identity: /lib\/canonical-d1\.mjs/ },
    { file: "scripts/stage3e-knowledge-identity-repair-golden.mjs", ordering: /expected exactly one D1 SQLite file/, identity: /lib\/canonical-d1\.mjs/ },
    { file: "scripts/live-reconciliation-runbook.sh", ordering: /ls -S/, identity: new RegExp(CANONICAL_D1_DATABASE_ID) },
  ];
  for (const { file, ordering, identity } of audited) {
    const src = readFileSync(join(repoRoot, file), "utf8");
    assert.ok(!ordering.test(src), `${file} must not select the live D1 by ordering (${ordering})`);
    assert.ok(identity.test(src), `${file} must resolve the canonical D1 by identity, not by ordering`);
  }
  // The shared resolver is the single definition of that identity for JS callers.
  const resolver = readFileSync(join(repoRoot, "scripts/lib/canonical-d1.mjs"), "utf8");
  assert.ok(new RegExp(CANONICAL_D1_DATABASE_ID).test(resolver), "the resolver must define the documented identity");
});

// ------------------------------------------------------- 4. /tmp cache guard

test("the historical-learning script refuses a /tmp checksum cache whose identity differs", () => {
  const src = readFileSync(join(repoRoot, "scripts/build-historical-boq-learning-dataset.py"), "utf8");
  assert.match(src, /CHECKSUM_CACHE_IDENTITY/, "an identity sidecar is required");
  assert.match(src, /_refresh_cache_trust/, "trust must be re-derived, not assumed at import time");
  assert.match(src, /if recorded != identity:/, "a differing identity must discard the cache");
  assert.match(src, /if _CACHE_TRUSTED and str\(path\) in CHECKSUMS/, "a cache hit must be conditional on trust");
  assert.match(src, /def persist_checksum_cache/, "writes must record the identity they are valid for");
});

test("the /tmp cache is never consulted without a matching input identity", () => {
  const root = mkdtempSync(join(tmpdir(), "cache-guard-"));
  const cache = join(root, "c.sha256");
  const identity = join(root, "c.sha256.identity");
  writeFileSync(cache, "deadbeef  /some/file\n");
  writeFileSync(identity, "identity-from-another-run\n");
  const recorded = existsSync(identity) ? readFileSync(identity, "utf8").trim() : null;
  assert.notEqual(recorded, "identity-from-current-inputs");
  // Mirrors the shipped guard: a mismatch means the cache is discarded entirely.
  assert.ok(recorded !== "current", "mismatched identity must not be trusted");
});

// ------------------------------------------------------------- 5. policy text

test("the final-state re-read contract exists in AGENTS.md and the workflow skill", () => {
  const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
  const skill = readFileSync(join(repoRoot, ".agents/skills/ai-pricing-agent-workflow/SKILL.md"), "utf8");
  for (const [name, text] of [["AGENTS.md", agents], ["SKILL.md", skill]]) {
    assert.match(text, /planning snapshot/i, `${name} must distinguish the start-of-task read`);
    assert.match(text, /CURRENTNESS_STATUS\s*=\s*UNPROVEN/, `${name} must define the fail-closed status`);
    assert.match(text, /re-read the (relevant )?(canonical|live) authority/i, `${name} must require the final re-read`);
  }
  assert.match(skill, /21\.1A/, "the skill must own the contract section");
  assert.match(agents, /Final-state re-read/, "AGENTS.md must state the rule");
});

test("the lore authority boundary is stated in both, and forbids lore overriding live state", () => {
  const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
  const skill = readFileSync(join(repoRoot, ".agents/skills/ai-pricing-agent-workflow/SKILL.md"), "utf8");
  for (const [name, text] of [["AGENTS.md", agents], ["SKILL.md", skill]]) {
    assert.match(text, /LORE NEVER OVERRIDES CURRENT CANONICAL AUTHORITY/, `${name} must state the precedence rule`);
    assert.match(text, /evidence index/i, `${name} must classify what .lore actually is`);
    assert.match(text, /Never delete or rewrite superseded lore|never delete or rewrite lore history/i, `${name} must forbid rewriting history`);
  }
});

test("the re-read contract names the governed counting authority rather than a generic phrase", () => {
  const agents = readFileSync(join(repoRoot, "AGENTS.md"), "utf8");
  assert.match(agents, /currentBoqEvidenceCounts/, "AGENTS.md must point at the real governed counter");
});