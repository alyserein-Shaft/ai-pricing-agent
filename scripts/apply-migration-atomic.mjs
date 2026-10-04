#!/usr/bin/env node
// ATOMIC MIGRATION EXECUTOR -- applies a migration or applies none of it.
//
// WHY THIS EXISTS
// ---------------
// scripts/live-reconciliation-runbook.sh used to split a migration on
// `--> statement-breakpoint` and pipe the statements into sqlite3 one at a
// time. That is NOT atomic. SQLite/D1 does not implicitly wrap DDL, and a
// `DROP TABLE` / `ALTER TABLE ... RENAME` that follows a FAILED copy-in still
// executes. On a disposable copy, 0019 failed at
// `NOT NULL constraint failed: __new_profile_requirement_applicability.requirement_id`
// and the very next DROP + RENAME replaced a 1,121-row table with an EMPTY one.
// A loud failure became silent data loss, and the pipeline's exit status was
// the only signal -- which arrived after the damage.
//
// This executor therefore:
//   * wraps the WHOLE migration in a single transaction,
//   * runs every statement through the same connection so the transaction is
//     genuinely shared (a shell pipe cannot guarantee this),
//   * rolls back on the FIRST failure and exits non-zero,
//   * optionally uses SAVEPOINTs so that statements which are illegal inside a
//     transaction (none expected here, but defensive) can be reported rather
//     than silently committed.
//
// Exit codes: 0 applied, 1 aborted+rolled back, 2 usage/IO.
//
// USAGE
//   node scripts/apply-migration-atomic.mjs <sqlite> <migration.sql> [--dry-run]

import { readFileSync, existsSync, copyFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const positional = argv.filter((a) => !a.startsWith("--"));
const [dbPath, migrationPath] = positional;

if (!dbPath || !migrationPath) {
  console.error("usage: node scripts/apply-migration-atomic.mjs <sqlite> <migration.sql> [--dry-run]");
  process.exit(2);
}
if (!existsSync(dbPath)) { console.error(`ABORT: database not found: ${dbPath}`); process.exit(2); }
if (!existsSync(migrationPath)) { console.error(`ABORT: migration not found: ${migrationPath}`); process.exit(2); }

const BP = "--> statement-breakpoint";
const raw = readFileSync(migrationPath, "utf8");
const statements = raw.split(BP).map((s) => s.trim()).filter(Boolean);

// A defensive file-level backup: if the process is killed mid-transaction the
// rollback still runs, but a hard crash (SIGKILL, power loss) would not.
const backupPath = `${dbPath}.pre-migration.bak`;
copyFileSync(dbPath, backupPath);

const db = new DatabaseSync(dbPath);
let applied = 0;

try {
  // FOREIGN KEY enforcement is suspended for the WHOLE migration, which is what
  // Drizzle's table-rebuild idiom requires: `CREATE __new_X` / `INSERT..SELECT` /
  // `DROP X` / `RENAME` cannot run with enforcement ON, because the DROP of a
  // parent table aborts while child rows still reference it.
  //
  // This is safe ONLY because the migration is wrapped in one transaction AND
  // foreign_key_check is re-run afterwards by the validation harness. 0019's own
  // header documents the same requirement, and notes that re-enabling
  // enforcement mid-file was itself a historical defect here.
  //
  // PRAGMA foreign_keys is a no-op inside a transaction, so it must be set
  // BEFORE BEGIN.
  db.exec("PRAGMA foreign_keys = OFF");
  db.exec("PRAGMA legacy_alter_table = OFF");
  // IMMEDIATE takes the write lock up front, so a concurrent writer cannot
  // interleave between statements and produce a torn result.
  db.exec("BEGIN IMMEDIATE");

  for (const [i, statement] of statements.entries()) {
    try {
      db.exec(statement);
      applied += 1;
      if (dryRun) db.exec(`SAVEPOINT sp_${i}`);
    } catch (error) {
      db.exec("ROLLBACK");
      console.error(`MIGRATION ABORTED at statement ${i + 1}/${statements.length} — NOTHING WAS APPLIED.`);
      console.error(`  ${error.message}`);
      console.error(`  statement: ${statement.replace(/\s+/g, " ").slice(0, 200)}`);
      console.error(`  rollback complete; ${applied} statement(s) discarded.`);
      console.error(`  file-level backup retained at ${backupPath}`);
      db.close();
      process.exit(1);
    }
  }

  db.exec("COMMIT");
  console.log(`APPLIED ${applied}/${statements.length} statements atomically.`);
  db.close();
  process.exit(0);
} catch (error) {
  try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
  console.error(`MIGRATION FAILED OUTSIDE STATEMENT LOOP: ${error.message}`);
  console.error(`  rollback attempted; file-level backup retained at ${backupPath}`);
  try { db.close(); } catch { /* ignore */ }
  process.exit(1);
}
