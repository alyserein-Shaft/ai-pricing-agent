#!/usr/bin/env node
// LIVE RECONCILIATION PRECONDITIONS -- read-only. Exits non-zero on a block.
//
// WHAT CHANGED AND WHY (2026-10-03, P0 0019 reconciliation)
// ---------------------------------------------------------
// This check previously counted `requirement_id IS NULL` and reported
// "PRECONDITION BLOCKED: NULL_REQUIREMENT_ID_ROWS = 520", demanding that the
// requirement-intelligence lane "resolve" those rows.
//
// THAT GATE WAS BOTH WRONG AND UNSATISFIABLE.
//
// The canonical XOR source-authority model (migrations 0009/0010/0011) makes a
// NULL requirement_id the DESIGNED representation for a device-identity
// observation: `requirement_source IN ('DrawingDeviceIdentity','BOQDeviceIdentity')`
// with `requirement_id IS NULL` and `device_identity_ref` populated. All 520
// rows are exactly that shape. The correct question is not "how many rows have a
// NULL requirement_id" but "how many rows VIOLATE the source-authority
// invariant".
//
// Measured on canonical D1: raw NULL count = 520; TRUE violation count = 0.
// So the old gate could never be satisfied, while the real risk it was meant to
// catch -- a migration tightening requirement_id to NOT NULL -- went unflagged.
//
// Resolving those 520 rows by writing a requirement_id would FABRICATE a
// technical_requirements foreign key out of a drawing or BOQ identity. That is
// permanently prohibited. This checker therefore never asks for a backfill.
//
// The raw count is still REPORTED, as a diagnostic, because it is a useful
// signal about which rows are device-identity observations. It is not a gate.
//
// THIS FILE IS BOTH A MODULE AND A CLI.
// scripts/delivery-readiness-gate.mjs and scripts/live-reconciliation-proof.mjs
// import helpers from it, so the CLI body MUST NOT run on import. It previously
// did, which made `import()` call process.exit() and take the importing process
// down with it. The CLI is now guarded by import.meta.main-style detection.
//
// Exit codes: 0 all invariants hold, 1 blocked, 2 usage/unreadable.

import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";

/**
 * The XOR source-authority invariant, exactly as migrations 0009/0010/0011
 * declare it in their CHECK constraints.
 *
 * A row is valid when EITHER:
 *   requirement_source = 'Specification'  AND requirement_id IS NOT NULL AND device_identity_ref IS NULL
 * OR:
 *   requirement_source IN ('DrawingDeviceIdentity','BOQDeviceIdentity')
 *                                         AND requirement_id IS NULL        AND device_identity_ref IS NOT NULL
 */
export const XOR_VIOLATION_SQL =
  " NOT ((requirement_source = 'Specification' AND requirement_id IS NOT NULL AND device_identity_ref IS NULL)"
  + " OR (requirement_source IN ('DrawingDeviceIdentity','BOQDeviceIdentity') AND requirement_id IS NULL AND device_identity_ref IS NOT NULL))";

export const NULL_REQUIREMENT_ID_TABLES = [
  "profile_requirement_applicability",
  "requirement_intelligence_facts",
];

/** Open a database strictly read-only. */
export function openReadOnly(dbPath) {
  return new DatabaseSync(dbPath, { readOnly: true });
}

/**
 * Count rows violating the XOR source-authority form, per table.
 * Returns the violation count (the GATE) plus the raw NULL count and the
 * per-source authority split (diagnostics only).
 */
export function countSourceAuthorityViolations(db, table) {
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
  if (!exists) return { table, error: "table-missing", violations: 0, total: 0, rawNullRequirementId: 0, bySource: [] };
  return {
    table,
    total: db.prepare(`SELECT count(*) AS c FROM "${table}"`).get().c,
    rawNullRequirementId: db.prepare(`SELECT count(*) AS c FROM "${table}" WHERE requirement_id IS NULL`).get().c,
    violations: db.prepare(`SELECT count(*) AS c FROM "${table}" WHERE${XOR_VIOLATION_SQL}`).get().c,
    bySource: db.prepare(
      `SELECT COALESCE(requirement_source,'(null)') AS s, count(*) AS c FROM "${table}" GROUP BY 1 ORDER BY c DESC`,
    ).all(),
  };
}

/**
 * Backward-compatible diagnostic: raw `requirement_id IS NULL` counts.
 *
 * RETAINED because scripts/delivery-readiness-gate.mjs and
 * scripts/live-reconciliation-proof.mjs import this name. It is a DIAGNOSTIC,
 * never a gate -- see countSourceAuthorityViolations for the real invariant.
 */
export function countNullRequirementIdRows(dbPath) {
  const db = typeof dbPath === "string" ? openReadOnly(dbPath) : dbPath;
  const owns = typeof dbPath === "string";
  const perTable = [];
  let total = 0;
  for (const table of NULL_REQUIREMENT_ID_TABLES) {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    if (!exists) continue;
    const rows = db.prepare(`SELECT count(*) AS c FROM "${table}" WHERE requirement_id IS NULL`).get().c;
    const t = db.prepare(`SELECT count(*) AS c FROM "${table}"`).get().c;
    perTable.push({ table, rows, total: t });
    total += rows;
  }
  if (owns) db.close();
  return { total, perTable };
}

/** Aggregate XOR violations across the source-authority tables. */
export function countSourceAuthorityViolationsAll(dbPath) {
  const db = typeof dbPath === "string" ? openReadOnly(dbPath) : dbPath;
  const owns = typeof dbPath === "string";
  const perTable = [];
  let total = 0;
  for (const table of NULL_REQUIREMENT_ID_TABLES) {
    const r = countSourceAuthorityViolations(db, table);
    if (r.error) continue;
    perTable.push({ table, rows: r.violations, total: r.total, rawNullRequirementId: r.rawNullRequirementId });
    total += r.violations;
  }
  if (owns) db.close();
  return { total, perTable };
}

/**
 * CLI entry point. Runs ONLY when this file is executed directly, never on
 * import by another module.
 */
function runCli(argv) {
  const dbPath = argv[0];
  if (!dbPath) {
    console.error("usage: node scripts/check-live-reconciliation-preconditions.mjs <sqlite>");
    return 2;
  }
  if (!fs.existsSync(dbPath)) {
    console.error(`PRECONDITION ABORTED: database not found: ${dbPath}`);
    return 2;
  }

  const db = openReadOnly(dbPath);
  const checks = [];
  for (const table of NULL_REQUIREMENT_ID_TABLES) {
    const r = countSourceAuthorityViolations(db, table);
    if (r.error) {
      checks.push({ name: "SOURCE_AUTHORITY_INVARIANT", table, blocked: true, rows: null, detail: `table ${r.error}` });
      continue;
    }
    checks.push({
      name: "SOURCE_AUTHORITY_INVARIANT",
      table,
      blocked: r.violations > 0,
      rows: r.violations,
      total: r.total,
      rawNullRequirementId: r.rawNullRequirementId,
      authoritySplit: Object.fromEntries(r.bySource.map((x) => [x.s, x.c])),
      detail: `rows violating the XOR source-authority invariant = ${r.violations}; `
        + `${r.rawNullRequirementId} row(s) carry a NULL requirement_id, which is the DESIGNED representation `
        + `for a device-identity observation and must NOT be backfilled.`,
    });
  }
  db.close();

  const blocked = checks.filter((c) => c.blocked);
  const ok = blocked.length === 0;
  console.log(JSON.stringify({ path: dbPath, checks, ok }, null, 1));

  if (!ok) {
    console.error(`PRECONDITION BLOCKED: ${blocked.length} source-authority violation(s).`);
    console.error("  A row is invalid only when it has BOTH source identities, or NEITHER.");
    console.error("  Do NOT 'resolve' this by writing requirement_id -- that fabricates a");
    console.error("  technical_requirements foreign key from a drawing/BOQ identity.");
    return 1;
  }

  for (const d of checks) {
    if (d.rawNullRequirementId > 0) {
      console.error(`  note: ${d.table} has ${d.rawNullRequirementId} valid device-identity row(s); invariant holds.`);
    }
  }
  console.error("PRECONDITION OK: source-authority invariant holds on every row.");
  return 0;
}

// Run only when executed as the entry point. `process.argv[1]` is this file.
const isDirectInvocation = process.argv[1]
  && (process.argv[1].endsWith("check-live-reconciliation-preconditions.mjs")
    || process.argv[1].endsWith("check-live-reconciliation-preconditions.ts"));

if (isDirectInvocation) {
  process.exit(runCli(process.argv.slice(2)));
}
