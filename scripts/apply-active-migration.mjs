#!/usr/bin/env node
/**
 * Apply an additive `drizzle-active` migration to the LOCAL dev D1, using the
 * repository's documented precedent (see apply-0021-...mjs for the full
 * rationale): no migration runner exists for the active chain, so the sanctioned
 * method is a verified timestamped backup, then the migration's OWN unmodified
 * SQL inside one transaction with end-state assertions before commit.
 *
 * Usage: node scripts/apply-active-migration.mjs <db> --apply --backup <f> [--tag 0022_...]
 */
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const [dbPath, mode, ...rest] = process.argv.slice(2);
const tagArg = rest.indexOf("--tag");
const tag = tagArg >= 0 ? rest[tagArg + 1] : null;
const bIdx = rest.indexOf("--backup");
const backupPath = bIdx >= 0 ? rest[bIdx + 1] : null;
if (!dbPath || mode !== "--apply" || !backupPath) {
  throw new Error("Usage: <db> --apply --backup <f> [--tag 0022_...]");
}
if (!tag) throw new Error("--tag is required so the applied file is explicit");

const file = join(ROOT, "drizzle-active", `${tag}.sql`);
const sql = readFileSync(file, "utf8");
const sha = createHash("sha256").update(sql).digest("hex");
console.log(`migration: ${tag}.sql  bytes=${statSync(file).size}  sha256=${sha}`);

const db = new DatabaseSync(dbPath, { readOnly: false });
db.exec("PRAGMA busy_timeout = 20000");
db.exec("PRAGMA foreign_keys = ON");
const one = (s, ...a) => db.prepare(s).get(...a);
const all = (s, ...a) => db.prepare(s).all(...a);

const pre = all("PRAGMA quick_check").map((r) => Object.values(r)[0]);
if (pre.length !== 1 || pre[0] !== "ok") throw new Error(`PRE_INTEGRITY_FAILED ${JSON.stringify(pre)}`);
console.log("pre  quick_check:", pre[0], "| fk:", all("PRAGMA foreign_key_check").length);

if (existsSync(backupPath) && statSync(backupPath).size > 0) throw new Error(`BACKUP_EXISTS ${backupPath}`);
db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
const bq = new DatabaseSync(backupPath, { readOnly: true });
const bOk = Object.values(bq.prepare("PRAGMA quick_check").get())[0];
const bT = bq.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table'").get().c;
bq.close();
if (bOk !== "ok") throw new Error("BACKUP_INTEGRITY_FAILED");
console.log(`backup: ${backupPath} (${bT} tables, ok)`);

db.exec("BEGIN IMMEDIATE");
try {
  db.exec(sql);
  db.exec("COMMIT");
} catch (e) {
  try { db.exec("ROLLBACK"); } catch { /* already rolled */ }
  throw new Error(`APPLY_FAILED_AND_ROLLED_BACK ${e.message}`);
}

const post = all("PRAGMA quick_check").map((r) => Object.values(r)[0]);
console.log("post quick_check:", post[0], "| fk:", all("PRAGMA foreign_key_check").length);
db.close();
console.log("applied:", tag);
