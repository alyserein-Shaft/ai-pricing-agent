#!/usr/bin/env node
// CRITICAL SCHEMA ASSERTIONS -- explicit pre/post structural checks.
//
// WHY THIS EXISTS
// ---------------
// scripts/check-migration-destructive-ddl.mjs is a DESTRUCTION guard: it fails
// closed on DROP TABLE, DROP COLUMN, NOT NULL tightening and CHECK loss. It is
// NOT a correctness proof. Measured gap: the repaired 0019 passed the guard
// with exit 0 while silently dropping profile_applicability_device_identity_idx
// -- the partial UNIQUE index that is the ONLY thing preventing duplicate
// drawing-sourced applicability rows, because SQLite treats NULLs as DISTINCT
// inside a UNIQUE index. An existing test caught it; the guard did not.
//
// So a green destructive guard is necessary but not sufficient. These assertions
// pin the structures that must be present BEFORE and AFTER the 0014/0019/0020
// delta, and the final rehearsal runs them on both sides. Omitting any one of
// them must fail the rehearsal.
//
// WHAT IS ASSERTED
//   * profile_applicability_device_identity_idx -- the load-bearing partial
//     UNIQUE index from 0009. Without it, duplicate device-identity rows are
//     admitted. This is the index the guard missed.
//   * profile_applicability_requirement_idx and profile_applicability_status_idx
//   * requirement_intelligence_profile_key_idx and requirement_intelligence_review_idx
//   * the two XOR CHECK constraints on both source-authority tables, by NAME,
//     because drizzle snapshots record checkConstraints: {} and will neither
//     regenerate nor preserve them
//   * requirement_source + device_identity_ref columns present, requirement_id
//     NULLABLE (the repaired contract)
//   * drawing_quantity_claims current-expression uniqueness index
//     (drawing_quantity_claims_current_identity_idx) -- SQL-only, because
//     drizzle cannot express COALESCE
//   * drawing_quantity_claims_project_head_idx, drawing_quantity_claims_class_idx
//   * all eight drawing_quantity_claims triggers (supersession + immutability +
//     domain-invariant insert guards)
//   * foreign keys: applicability/facts -> technical_requirements,
//     drawing_quantity_claims -> projects/documents/document_versions/self
//
// Read-only. Usage:
//   node scripts/check-critical-schema-assertions.mjs <sqlite> [--expect-0020]
// With --expect-0020 the drawing-quantity assertions are required; without it
// drawing_quantity_claims must be ABSENT (pre-reconciliation state).

import { DatabaseSync } from "node:sqlite";

const [dbPath, flag] = process.argv.slice(2);
if (!dbPath) { console.error("usage: node scripts/check-critical-schema-assertions.mjs <sqlite> [--expect-0020]"); process.exit(3); }
const expect0020 = flag === "--expect-0020";

const db = new DatabaseSync(dbPath, { readOnly: true });
const fail = [];
const ok = (cond, label, detail = "") => {
  console.log(`  ${cond ? "OK  " : "FAIL"} ${label}${detail ? "  " + detail : ""}`);
  if (!cond) fail.push(label);
};

const indexesOf = (table) => db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=?").all(table);
const triggersOf = (table) => db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name=?").all(table).map((r) => r.name);
const tableSql = (table) => (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table)?.sql || "");
const columnsOf = (table) => db.prepare(`PRAGMA table_info("${table}")`).all().map((c) => c.name);

console.log("CRITICAL SCHEMA ASSERTIONS");
console.log(`  database   : ${dbPath}`);
console.log(`  0020 expected: ${expect0020}`);
console.log("-".repeat(92));

// --- 1. source-authority indexes (the ones 0009/0010 established) ------------
console.log("-- source-authority indexes (0009/0010 contract)");
{
  const idx = indexesOf("profile_requirement_applicability").map((r) => r.name);
  ok(idx.includes("profile_applicability_requirement_idx"), "profile_applicability_requirement_idx present", idx.join(", "));
  ok(idx.includes("profile_applicability_device_identity_idx"), "profile_applicability_device_identity_idx present (the partial UNIQUE the guard missed)");
  ok(idx.includes("profile_applicability_status_idx"), "profile_applicability_status_idx present");

  // The device-identity index MUST be partial on device_identity_ref, or it is
  // not the index 0009 created.
  const partial = indexesOf("profile_requirement_applicability")
    .find((r) => r.name === "profile_applicability_device_identity_idx");
  ok(!!partial && /WHERE/i.test(partial.sql || "") && /device_identity_ref/i.test(partial.sql || ""),
    "device_identity_idx is partial on device_identity_ref", (partial?.sql || "").replace(/\s+/g, " ").slice(0, 130));

  const fidx = indexesOf("requirement_intelligence_facts").map((r) => r.name);
  ok(fidx.includes("requirement_intelligence_profile_key_idx"), "requirement_intelligence_profile_key_idx present");
  ok(fidx.includes("requirement_intelligence_review_idx"), "requirement_intelligence_review_idx present");
}

// --- 2. XOR CHECK constraints, by exact name --------------------------------
console.log("-- XOR CHECK constraints (hand-authored; snapshots record none)");
{
  const expected = {
    profile_requirement_applicability: ["profile_applicability_authority_class_ck", "profile_applicability_exactly_one_source_ck"],
    requirement_intelligence_facts: ["requirement_intelligence_authority_class_ck", "requirement_intelligence_exactly_one_source_ck"],
  };
  for (const [table, names] of Object.entries(expected)) {
    const sql = tableSql(table);
    for (const name of names) {
      ok(sql.includes(name), `${table}.${name} declared`);
    }
    // The CHECK body must express the XOR form, not requirement_id NOT NULL.
    ok(!/requirement_id.\s+text\s+NOT NULL/i.test(sql), `${table}: requirement_id is NOT declared NOT NULL`);
  }
}

// --- 3. XOR columns -----------------------------------------------------------
console.log("-- XOR authority columns");
{
  for (const table of ["profile_requirement_applicability", "requirement_intelligence_facts"]) {
    const cols = columnsOf(table);
    ok(cols.includes("requirement_source"), `${table}.requirement_source present`);
    ok(cols.includes("device_identity_ref"), `${table}.device_identity_ref present`);
    ok(cols.includes("requirement_id"), `${table}.requirement_id present`);
  }
}

// --- 4. drawing quantity authority -------------------------------------------
console.log("-- drawing quantity authority (0020)");
{
  const exists = !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='drawing_quantity_claims'").get();
  if (!expect0020) {
    ok(!exists, "drawing_quantity_claims ABSENT (pre-reconciliation state)");
  } else {
    ok(exists, "drawing_quantity_claims present");
    if (exists) {
      const idx = indexesOf("drawing_quantity_claims").map((r) => r.name);
      ok(idx.includes("drawing_quantity_claims_current_identity_idx"), "current-expression uniqueness index present (COALESCE null-safety)");
      const exprIdx = indexesOf("drawing_quantity_claims").find((r) => r.name === "drawing_quantity_claims_current_identity_idx");
      ok(!!exprIdx && /COALESCE/i.test(exprIdx.sql || ""), "uniqueness index uses COALESCE (NULL-safe)", (exprIdx?.sql || "").replace(/\s+/g, " ").slice(0, 140));
      ok(idx.includes("drawing_quantity_claims_project_head_idx"), "project_head_idx present");
      ok(idx.includes("drawing_quantity_claims_class_idx"), "class_idx present");

      const trg = triggersOf("drawing_quantity_claims");
      ok(trg.length >= 8, "all eight governance triggers present", `${trg.length} triggers: ${trg.join(", ")}`);
      ok(trg.some((t) => /supersede/i.test(t)), "supersession trigger present");
      ok(trg.some((t) => /immutable|append_only|delete/i.test(t)), "immutability/append-only trigger present");

      const fks = db.prepare(`PRAGMA foreign_key_list("drawing_quantity_claims")`).all().map((r) => r.table);
      for (const parent of ["projects", "documents", "document_versions", "drawing_quantity_claims"]) {
        ok(fks.includes(parent), `FK to ${parent}`, fks.join(", "));
      }
    }
  }
}

// --- 5. source-authority foreign keys ----------------------------------------
console.log("-- source-authority foreign keys");
{
  for (const table of ["profile_requirement_applicability", "requirement_intelligence_facts"]) {
    const fks = db.prepare(`PRAGMA foreign_key_list("${table}")`).all().map((r) => r.table);
    ok(fks.includes("technical_requirements"), `${table} FK to technical_requirements`);
    ok(fks.includes("requirement_profile_versions"), `${table} FK to requirement_profile_versions`);
  }
}

console.log("-".repeat(92));
console.log(fail.length === 0 ? "CRITICAL SCHEMA ASSERTIONS: PASS" : `CRITICAL SCHEMA ASSERTIONS: FAIL (${fail.length})`);
db.close();
process.exit(fail.length ? 1 : 0);
