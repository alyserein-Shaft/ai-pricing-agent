#!/usr/bin/env node
/**
 * ONBOARDING RECOVERY D1 -- apply migration 0080 (contact_title) to the
 * LOCAL dev D1 SQLite file only.
 *
 * Pure DDL: ONE additive, nullable column, no default, no backfill, no
 * business-data write of any kind. This repo has no configured migration
 * runner for its `drizzle/*.sql` files (the Drizzle journal is stale --
 * only 14 of 85 migrations are recorded in drizzle/meta/_journal.json --
 * and no `d1_migrations` ledger table exists in the DB; `wrangler d1
 * migrations apply` is not wired into any npm script). This is a legacy
 * out-of-band recovery tool, not the active migration authority. The active
 * chain is `drizzle-active/`; the established
 * precedent for this exact situation, visible in this DB's own directory
 * (e.g. the "*.pre-npq-0061.sqlite" backup beside migration 0061, which
 * created project_npq_profile_versions itself), is: take a verified
 * timestamped backup, then apply the migration's own SQL directly against
 * the local file inside one transaction, with end-state assertions before
 * commit. This script follows that exact pattern.
 *
 * Usage:
 *   node scripts/apply-0080-onboarding-d-contact-title.mjs <db-path> --verify
 *   node scripts/apply-0080-onboarding-d-contact-title.mjs <db-path> --apply --backup <backup.sqlite>
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const [dbPath, mode, ...rest] = process.argv.slice(2);
if (!dbPath || !["--verify", "--apply"].includes(mode)) throw new Error("Usage: <db-path> --verify | --apply --backup <backup.sqlite>");
const backupPath = rest[0] === "--backup" ? rest[1] : null;
const apply = mode === "--apply";
if (apply && process.env.ALLOW_LEGACY_OUT_OF_BAND_0080 !== "1") {
  throw new Error("LEGACY_0080_APPLY_DISABLED: use the reviewed active migration path; set ALLOW_LEGACY_OUT_OF_BAND_0080=1 only for an explicitly authorized legacy recovery");
}
if (apply && !backupPath) throw new Error("--apply requires --backup <verified pre-migration backup>");

const fail = (code, detail) => { const error = new Error(`${code}: ${detail}`); error.code = code; throw error; };

const db = new DatabaseSync(dbPath, { readOnly: !apply });
db.exec("PRAGMA busy_timeout = 15000");
if (apply) db.exec("PRAGMA foreign_keys = ON");
const one = (sql, ...params) => db.prepare(sql).get(...params);
const all = (sql, ...params) => db.prepare(sql).all(...params);

const hasContactTitle = () => all("PRAGMA table_info(project_npq_profile_versions)").some((c) => c.name === "contact_title");

const BUSINESS_TABLES = ["projects", "project_dashboard_profiles", "project_npq_profile_versions", "project_npq_profile_events"];
const snapshot = () => Object.fromEntries(BUSINESS_TABLES.map((t) => [t, one(`SELECT COUNT(*) n FROM ${t}`).n]));

const preProblems = [];
if (hasContactTitle()) preProblems.push("contact_title already exists -- migration 0080 appears already applied");
const golden = one("SELECT contact_name, contact_email, contact_phone FROM project_npq_profile_versions WHERE project_id=? AND superseded_at IS NULL", "project_c0123d91-c30b-4956-87cb-e473ef53f89d");
if (!golden || golden.contact_name !== "Mr. Ahmad") preProblems.push(`Al Mousa contact_name drifted: ${JSON.stringify(golden)}`);
if (preProblems.length) { console.error(`ONBOARDING_D1_MIGRATION_DRIFT\n - ${preProblems.join("\n - ")}`); process.exit(3); }

console.log(`PRE-APPLY VERIFY OK: contact_title absent, Al Mousa contact_name unchanged ("Mr. Ahmad"), business row counts: ${JSON.stringify(snapshot())}`);
if (!apply) { console.log("Verify only: no write."); db.close(); process.exit(0); }

// ---- backup proof ---------------------------------------------------------------
{
  const size = statSync(backupPath).size;
  const backup = new DatabaseSync(backupPath, { readOnly: true });
  const quick = backup.prepare("PRAGMA quick_check").get();
  const backupHasColumn = backup.prepare("PRAGMA table_info(project_npq_profile_versions)").all().some((c) => c.name === "contact_title");
  if (Object.values(quick)[0] !== "ok" || backupHasColumn) fail("ONBOARDING_D1_BACKUP_INVALID", `quick_check=${Object.values(quick)[0]} backupHasColumn=${backupHasColumn}`);
  const backupCounts = Object.fromEntries(BUSINESS_TABLES.map((t) => [t, backup.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
  backup.close();
  const liveCounts = snapshot();
  if (JSON.stringify(backupCounts) !== JSON.stringify(liveCounts)) fail("ONBOARDING_D1_BACKUP_INVALID", `counts backup=${JSON.stringify(backupCounts)} live=${JSON.stringify(liveCounts)}`);
  console.log(`BACKUP VERIFIED: ${backupPath} (${size} bytes, sha256 ${createHash("sha256").update(readFileSync(backupPath)).digest("hex").slice(0, 16)}..., quick_check ok, counts match live, no contact_title column)`);
}

const before = snapshot();

// ---- ONE transaction, pure DDL only ----------------------------------------------
db.exec("BEGIN IMMEDIATE");
try {
  if (hasContactTitle()) fail("ONBOARDING_D1_MIGRATION_DRIFT", "contact_title appeared between verify and transaction");
  db.exec("ALTER TABLE `project_npq_profile_versions` ADD `contact_title` text");
  // ---- end-state assertions (inside the transaction; failure rolls back) ----
  const columns = all("PRAGMA table_info(project_npq_profile_versions)");
  const column = columns.find((c) => c.name === "contact_title");
  if (!column) fail("ONBOARDING_D1_END_STATE_ASSERT", "contact_title column missing after ALTER TABLE");
  if (column.notnull !== 0) fail("ONBOARDING_D1_END_STATE_ASSERT", "contact_title must be nullable");
  if (column.dflt_value !== null) fail("ONBOARDING_D1_END_STATE_ASSERT", `contact_title must have no default, got ${column.dflt_value}`);
  const after = snapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) fail("ONBOARDING_D1_END_STATE_ASSERT", `business row counts changed: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
  const goldenAfter = one("SELECT contact_name, contact_title FROM project_npq_profile_versions WHERE project_id=? AND superseded_at IS NULL", "project_c0123d91-c30b-4956-87cb-e473ef53f89d");
  if (goldenAfter.contact_name !== "Mr. Ahmad" || goldenAfter.contact_title !== null) fail("ONBOARDING_D1_END_STATE_ASSERT", `Al Mousa row unsafe: ${JSON.stringify(goldenAfter)}`);
  db.exec("COMMIT");
} catch (error) {
  try { db.exec("ROLLBACK"); } catch { /* already rolled back */ }
  console.error(`TRANSACTION ROLLED BACK -- nothing was written. ${error.message}`);
  process.exit(4);
}

const after = snapshot();
console.log(JSON.stringify({
  outcome: { committed: true },
  columnDefinition: all("PRAGMA table_info(project_npq_profile_versions)").find((c) => c.name === "contact_title"),
  businessRowCounts: { before, after },
  alMousa: one("SELECT contact_name, contact_title FROM project_npq_profile_versions WHERE project_id=? AND superseded_at IS NULL", "project_c0123d91-c30b-4956-87cb-e473ef53f89d"),
  integrity_check: Object.values(one("PRAGMA integrity_check"))[0],
}, null, 2));
db.close();
