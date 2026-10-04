// Shared harness for executing the governed `drizzle-active` migration chain.
//
// Every pre-existing migration gate in this repository is a static source check,
// and `tests/migration-baseline-safety.test.mjs` explicitly refuses to open a
// database. That left the active chain unproven as *executable*: a migration can
// satisfy every regex assertion and still fail the moment a real database
// contains rows. This harness applies the actual chain, in journal order, one
// migration per transaction, with foreign-key enforcement switched on, which is
// the shape a production migrator uses.
//
// The database is always a throwaway file in the OS temp directory. No persistent
// artifact, and in particular no Golden D1 database, is ever opened.
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

// tests/helpers/active-chain.mjs -> tests/helpers -> tests -> repository root
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
export const ACTIVE_ROOT = join(ROOT, "drizzle-active");

// Split a migration into executable statements, dropping line comments so a
// mention of a destructive keyword in prose is never mistaken for a statement.
export const statementsOf = (sql) => sql
  .split("--> statement-breakpoint")
  .map((statement) => statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim())
  .filter(Boolean);

export const activeTags = () => JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"))
  .entries.map((entry) => entry.tag);

export const migrationPath = (tag) => join(ACTIVE_ROOT, `${tag}.sql`);

export const openEmptyDatabase = () => {
  const dir = mkdtempSync(join(tmpdir(), "drizzle-active-"));
  const db = new DatabaseSync(join(dir, "chain.sqlite"));
  db.exec("PRAGMA foreign_keys=ON");
  return {
    db,
    dir,
    close: () => { try { db.close(); } catch { /* already closed */ } rmSync(dir, { recursive: true, force: true }); },
  };
};

export const applyTag = (db, tag) => {
  const file = migrationPath(tag);
  if (!existsSync(file)) throw new Error(`active migration ${tag} must exist at ${file}`);
  db.exec("BEGIN");
  try {
    for (const statement of statementsOf(readFileSync(file, "utf8"))) db.exec(statement);
    db.exec("COMMIT");
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* transaction already unwound */ }
    throw new Error(`active migration ${tag} failed to apply: ${error.message}`);
  }
};

export const applyActiveChain = (db) => { for (const tag of activeTags()) applyTag(db, tag); };

// Apply every active migration except `exceptTag`, hand the live database to
// `seed` so it can look like production, then apply the held-back migration.
export const applyChainAround = (exceptTag, seed) => {
  const opened = openEmptyDatabase();
  try {
    for (const tag of activeTags()) {
      if (tag === exceptTag) continue;
      applyTag(opened.db, tag);
    }
    seed?.(opened.db);
    applyTag(opened.db, exceptTag);
  } catch (error) {
    opened.close();
    throw error;
  }
  return opened;
};

export const expectReject = (label, run) => {
  assertThrows(run, `${label} must be rejected`);
};

function assertThrows(run, message) {
  let threw = false;
  try { run(); } catch { threw = true; }
  if (!threw) throw new Error(message);
}
