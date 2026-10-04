#!/usr/bin/env node
/**
 * Apply migration 0021 (drawing_quantity_expected_scope) to the LOCAL dev D1.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT "AD-HOC DDL"
 * ----------------------------------------------------
 * This repository has NO configured migration runner for its active chain.
 * `scripts/apply-0080-onboarding-d-contact-title.mjs` documents that state
 * authoritatively:
 *
 *   "This repo has no configured migration runner for its drizzle/*.sql files
 *    ... no d1_migrations ledger table exists in the DB; `wrangler d1
 *    migrations apply` is not wired into any npm script. This is a legacy
 *    out-of-band recovery tool, not the active migration authority. The active
 *    chain is drizzle-active/; the established precedent ... visible in this
 *    DB's own directory ... is: take a verified timestamped backup, then apply
 *    the migration's own SQL directly against the local file inside one
 *    transaction, with end-state assertions before commit."
 *
 * Independently re-verified for this run: wrangler 4.92.0 is UNAUTHENTICATED
 * (`Failed to fetch auth token: 400`), the live database carries NO
 * `d1_migrations` ledger table, and `scripts/setup-golden-e2e.sh` -- the only
 * `d1 migrations apply` caller in the repo -- points at the LEGACY `drizzle/`
 * directory against a SEPARATE state dir and also seeds data, so it is an e2e
 * harness, not the live-project authority.
 *
 * So this script follows the documented precedent EXACTLY, and adds nothing to
 * it: a verified backup, the migration's OWN unmodified SQL, one transaction,
 * and end-state assertions before commit. It executes no hand-written DDL.
 *
 * 0021 is ADDITIVE ONLY: two new tables, and it touches no existing table,
 * column, row or index.
 *
 * Usage:
 *   node scripts/apply-0021-drawing-quantity-expected-scope.mjs <db> --verify
 *   node scripts/apply-0021-drawing-quantity-expected-scope.mjs <db> --apply --backup <file.sqlite>
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = join(ROOT, "drizzle-active", "0021_drawing_quantity_expected_scope.sql");

const [dbPath, mode, ...rest] = process.argv.slice(2);
if (!dbPath || !["--verify", "--apply"].includes(mode)) {
  throw new Error("Usage: <db> --verify | <db> --apply --backup <file.sqlite>");
}
const backupArg = rest.indexOf("--backup");
const backupPath = backupArg >= 0 ? rest[backupArg + 1] : null;
const apply = mode === "--apply";
if (apply && !backupPath) throw new Error("--apply requires --backup <verified pre-migration backup>");

const fail = (code, detail) => { const e = new Error(`${code}: ${detail}`); e.code = code; throw e; };
const sha256 = (p) => createHash("sha256").update(readFileSync(p)).digest("hex");

const EXPECTED_TABLES = ["drawing_quantity_expected_scope", "drawing_quantity_expected_scope_events"];
const EXPECTED_TRIGGERS = [
  "drawing_quantity_expected_scope_review_status_guard",
  "drawing_quantity_expected_scope_no_quantity_guard",
  "drawing_quantity_expected_scope_approval_attribution_guard",
  "drawing_quantity_expected_scope_supersede_only_update",
  "drawing_quantity_expected_scope_supersede_once",
  "drawing_quantity_expected_scope_immutable_delete",
  "drawing_quantity_expected_scope_events_immutable_delete",
];
const EXPECTED_INDEXES = [
  "drawing_quantity_expected_scope_current_identity_idx",
  "drawing_quantity_expected_scope_project_head_idx",
  "drawing_quantity_expected_scope_class_idx",
  "drawing_quantity_expected_scope_events_scope_idx",
];
// The structural guarantee that expected scope is not a quantity.
const FORBIDDEN_COLUMNS = ["quantity", "printed_total", "component_total", "count", "total", "occurrence_count"];

const sql = readFileSync(MIGRATION, "utf8");
if (!/CREATE TABLE drawing_quantity_expected_scope/.test(sql)) fail("MIGRATION_UNREADABLE", "0021 does not declare its table");

console.log("0021 migration :", MIGRATION);
console.log("  bytes        :", statSync(MIGRATION).size);
console.log("  sha256       :", sha256(MIGRATION));
console.log("target database:", dbPath);
console.log("mode           :", mode);

const db = new DatabaseSync(dbPath, { readOnly: !apply });
db.exec("PRAGMA busy_timeout = 20000");
if (apply) db.exec("PRAGMA foreign_keys = ON");

const one = (s, ...a) => db.prepare(s).get(...a);
const all = (s, ...a) => db.prepare(s).all(...a);

const preIntegrity = all("PRAGMA quick_check").map((r) => Object.values(r)[0]);
if (preIntegrity.length !== 1 || preIntegrity[0] !== "ok") fail("PRE_INTEGRITY_FAILED", JSON.stringify(preIntegrity));
console.log("pre  quick_check:", preIntegrity[0], "| fk violations:", all("PRAGMA foreign_key_check").length);

const existing = all(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN (?,?)",
  ...EXPECTED_TABLES,
);
const alreadyApplied = existing.length === EXPECTED_TABLES.length;
console.log("already applied :", alreadyApplied);

if (mode === "--verify") {
  console.log(JSON.stringify({ preIntegrity, alreadyApplied, verified: true }, null, 2));
  db.close();
  process.exit(0);
}

if (alreadyApplied) {
  console.log("0021 is already applied; nothing to do (idempotent no-op).");
  db.close();
  process.exit(0);
}

// --- verified backup via VACUUM INTO (consistent even under WAL) ------------
// A missing backup file is the NORMAL case; only a pre-existing one is a refusal.
if (existsSync(backupPath) && statSync(backupPath).size > 0) {
  fail("BACKUP_EXISTS", `${backupPath} already exists`);
}
db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
const bQuick = new DatabaseSync(backupPath, { readOnly: true });
const bIntegrity = bQuick.prepare("PRAGMA quick_check").get();
const bTables = bQuick.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c;
bQuick.close();
if (Object.values(bIntegrity)[0] !== "ok") fail("BACKUP_INTEGRITY_FAILED", JSON.stringify(bIntegrity));
console.log(`backup         : ${backupPath} (${bTables} tables, quick_check ok, sha256 ${sha256(backupPath).slice(0, 16)}...)`);

// --- one transaction: the migration's own SQL ------------------------------
db.exec("BEGIN IMMEDIATE");
try {
  db.exec(sql);
  // End-state assertions BEFORE commit.
  for (const t of EXPECTED_TABLES) {
    if (!one("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t)) fail("ASSERT_TABLE_MISSING", t);
  }
  for (const t of EXPECTED_TRIGGERS) {
    if (!one("SELECT name FROM sqlite_master WHERE type='trigger' AND name=?", t)) fail("ASSERT_TRIGGER_MISSING", t);
  }
  for (const i of EXPECTED_INDEXES) {
    if (!one("SELECT name FROM sqlite_master WHERE type='index' AND name=?", i)) fail("ASSERT_INDEX_MISSING", i);
  }
  const cols = all("SELECT name FROM pragma_table_info('drawing_quantity_expected_scope')").map((r) => r.name);
  for (const forbidden of FORBIDDEN_COLUMNS) {
    if (cols.includes(forbidden)) fail("ASSERT_QUANTITY_COLUMN_PRESENT", `scope authority must carry no ${forbidden}`);
  }
  // The pre-existing 0020 authority must be untouched.
  const t0020 = one("SELECT count(*) c FROM sqlite_master WHERE type='trigger' AND tbl_name='drawing_quantity_claims'").c;
  if (t0020 !== 8) fail("ASSERT_0020_TRIGGERS_CHANGED", `expected 8, found ${t0020}`);
  const claims = one("SELECT count(*) c FROM drawing_quantity_claims").c;
  console.log("pre-commit assertions: 2 tables, 7 triggers, 4 indexes, no quantity column, 0020 triggers =", t0020, "| quantity claims =", claims);
  db.exec("COMMIT");
} catch (error) {
  try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
  fail("APPLY_FAILED_AND_ROLLED_BACK", `${error.message} (database unchanged; backup at ${backupPath})`);
}

const postQuick = all("PRAGMA quick_check").map((r) => Object.values(r)[0]);
const fkAfter = all("PRAGMA foreign_key_check").length;
const trigCount = one("SELECT count(*) c FROM sqlite_master WHERE type='trigger' AND tbl_name LIKE 'drawing_quantity_expected_scope%'").c;
const idxCount = one("SELECT count(*) c FROM sqlite_master WHERE type='index' AND name LIKE 'drawing_quantity_expected_scope%'").c;

console.log("post quick_check:", postQuick[0], "| fk violations:", fkAfter);
console.log(`applied: tables=2 triggers=${trigCount} indexes=${idxCount}`);
db.close();

console.log(JSON.stringify({
  applied: true,
  migrationSha256: sha256(MIGRATION),
  backup: backupPath,
  preQuickCheck: preIntegrity[0],
  postQuickCheck: postQuick[0],
  foreignKeyViolationsAfter: fkAfter,
  triggers: trigCount,
  indexes: idxCount,

}, null, 2));