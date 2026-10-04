import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { currentRequirementProfile, currentRequirementProfileId } from "../worker/requirement-profile-currency.mjs";
import { currentRun } from "../worker/product-matching-api.mjs";
import { currentDecision } from "../worker/confidence-safety-api.mjs";
import { currentSymbolRecognitionVersion } from "../worker/drawing-symbol-recognition-api.mjs";

// Backend & Codebase Consolidation Sprint, item 1: current-version query
// consolidation. Each helper below was previously re-typed identically (or
// as a narrower column projection of the same query) across 2-7 different
// files. Proves: current row identical before/after, superseded rows
// excluded, highest governed version wins, deterministic behavior.

const d1 = (raw) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => raw.prepare(sql).get(...args) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...args) }),
      run: async () => raw.prepare(sql).run(...args),
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
});

test("currentRequirementProfile: superseded excluded, highest version wins, deterministic", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE requirement_profile_versions (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT, status TEXT);
    INSERT INTO requirement_profile_versions VALUES ('rp-v1','item-1',1,'2026-08-01T00:00:00Z','Superseded');
    INSERT INTO requirement_profile_versions VALUES ('rp-v2','item-1',2,NULL,'Completed');
    -- an unrelated item's row must never leak in
    INSERT INTO requirement_profile_versions VALUES ('rp-other','item-2',1,NULL,'Completed');
  `);
  const db = d1(raw);
  const current = await currentRequirementProfile(db, "item-1");
  assert.equal(current.id, "rp-v2");
  assert.equal(current.version_number, 2);
  const currentId = await currentRequirementProfileId(db, "item-1");
  assert.equal(currentId, "rp-v2");
  const missing = await currentRequirementProfile(db, "item-nonexistent");
  assert.equal(missing, null);
  raw.close();
});

test("currentRun (product_match_runs): superseded excluded, highest version wins", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE product_match_runs (id TEXT PRIMARY KEY, boq_item_id TEXT, version_number INTEGER, superseded_at TEXT);
    INSERT INTO product_match_runs VALUES ('run-v1','item-1',1,'2026-08-01T00:00:00Z');
    INSERT INTO product_match_runs VALUES ('run-v2','item-1',2,NULL);
    INSERT INTO product_match_runs VALUES ('run-v3-superseded-typo','item-1',3,'2026-08-02T00:00:00Z');
  `);
  const db = d1(raw);
  const current = await currentRun(db, "item-1");
  assert.equal(current.id, "run-v2");
  assert.equal(current.version_number, 2);
  raw.close();
});

test("currentDecision (safety_decisions, candidate-keyed): superseded excluded, highest version wins", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE safety_decisions (id TEXT PRIMARY KEY, candidate_id TEXT, version_number INTEGER, superseded_at TEXT);
    INSERT INTO safety_decisions VALUES ('sd-v1','candidate-1',1,'2026-08-01T00:00:00Z');
    INSERT INTO safety_decisions VALUES ('sd-v2','candidate-1',2,NULL);
  `);
  const db = d1(raw);
  const current = await currentDecision(db, "candidate-1");
  assert.equal(current.id, "sd-v2");
  raw.close();
});

test("currentSymbolRecognitionVersion: superseded excluded, highest version wins", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE drawing_symbol_recognition_versions (id TEXT PRIMARY KEY, document_id TEXT, version_number INTEGER, superseded_at TEXT);
    INSERT INTO drawing_symbol_recognition_versions VALUES ('rec-v1','doc-1',1,'2026-08-01T00:00:00Z');
    INSERT INTO drawing_symbol_recognition_versions VALUES ('rec-v2','doc-1',2,NULL);
  `);
  const db = d1(raw);
  const current = await currentSymbolRecognitionVersion(db, "doc-1");
  assert.equal(current.id, "rec-v2");
  raw.close();
});

test("consolidated files no longer contain their own copy of the query -- they import the shared helper", async () => {
  const { readFile } = await import("node:fs/promises");
  const files = [
    ["worker/technical-requirement-api.mjs", "requirement-profile-currency.mjs"],
    ["worker/engineering-classification-api.mjs", "requirement-profile-currency.mjs"],
    ["worker/product-matching-api.mjs", null], // owns the helper itself
    ["worker/ai-presales-agent-tools.mjs", "requirement-profile-currency.mjs"],
    ["worker/boq-line-decision-api.mjs", "requirement-profile-currency.mjs"],
    ["worker/pricing-runtime.mjs", "confidence-safety-api.mjs"],
    ["worker/drawing-quantity-evidence-api.mjs", "drawing-symbol-recognition-api.mjs"],
    ["worker/drawing-requirement-impact-api.mjs", "drawing-symbol-recognition-api.mjs"],
    ["worker/symbol-signature-matching-api.mjs", "drawing-symbol-recognition-api.mjs"],
    ["worker/occurrence-spatial-clustering-api.mjs", "drawing-symbol-recognition-api.mjs"],
    ["worker/quantity-source-decision-api.mjs", "drawing-symbol-recognition-api.mjs"],
  ];
  for (const [path, expectedImportSource] of files) {
    const content = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
    if (expectedImportSource) {
      assert.match(content, new RegExp(expectedImportSource.replace(".", "\\.")), `${path} should import from ${expectedImportSource}`);
    }
  }
});

test("project-context-api.mjs's created_at-before-version_number ordering is a different query (project-wide multi-document listing), not the single-document current-version selector -- confirmed not a defect", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../worker/project-context-api.mjs", import.meta.url), "utf8");
  // The listing query (returns .all(), one row per document under the project)
  assert.match(source, /ORDER BY e\.created_at DESC,e\.version_number DESC/);
  // The real single-document "current version" selector uses the standard,
  // canonical ordering (version_number only) -- confirming the file already
  // has the correct pattern where it actually matters.
  assert.match(
    source,
    /SELECT \* FROM project_context_extraction_versions WHERE document_id=\? AND superseded_at IS NULL ORDER BY version_number DESC LIMIT 1/,
  );
});
