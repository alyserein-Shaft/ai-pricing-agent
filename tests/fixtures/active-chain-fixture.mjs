/**
 * In-memory database built from the ACTUAL ordered active migration chain.
 *
 * WHY THIS EXISTS
 * ---------------
 * Several worker-level suites used to hand-write a CREATE TABLE list that
 * approximated the schema. That approximation silently drifted: when DOC-R3
 * revision authority added `document_versions.effective_from/effective_to`,
 * `document_supersessions`, and the `newer.document_version_id` leg of the
 * currentness queries, those hand-written fixtures kept compiling and then
 * failed at runtime with "no such table"/"no such column" -- proving nothing
 * about the behaviour they claimed to cover.
 *
 * A fixture built by APPENDING columns to a hand-written list is how that drift
 * happens, and it happens again on the next migration. This helper removes the
 * class of bug instead of the instance: the schema is the real, ordered
 * drizzle-active chain, so a new migration cannot silently invalidate a test
 * fixture, and a test that seeds a row must satisfy the REAL NOT NULL and
 * FOREIGN KEY constraints.
 *
 * HOW THE CHAIN IS READ
 * ---------------------
 * From `drizzle-active/meta/_journal.json` -- the journal IS the ordered chain
 * production applies, so reading it cannot disagree with production order. Each
 * entry's `<tag>.sql` is split on `--> statement-breakpoint` and executed
 * statement by statement, exactly as the D1/Drizzle migration runner does.
 * (Deliberately NOT a `.sort()` of the directory: file-name order is a guess
 * about order, the journal is the recorded order.) A `.sql` file the journal
 * does not record is reported through `unjournaledActiveMigrations()` and a
 * one-time warning, because that is the only way a journal-driven reader can
 * quietly end up a migration behind.
 *
 * MODELLING NOTE -- `batch`
 * ------------------------
 * A single node:sqlite DatabaseSync connection cannot hold two concurrent open
 * write transactions, and D1's `DB.batch()` is awaited inside other awaited
 * `prepare(...).run()` calls by the governed code. A real BEGIN here would
 * therefore either nest-fail or serialize incorrectly. `batch` consequently
 * runs its statements SEQUENTIALLY IN AUTOCOMMIT. That is a real, documented
 * trade-off: an atomicity assertion about a batch is not provable against this
 * helper, and no suite in this repository claims one.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const ACTIVE_ROOT = new URL("../../drizzle-active", import.meta.url).pathname.replace(/\/$/, "");

/** The active migration tags, in the order the journal records them. */
export const activeChainTags = () => {
  const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
  return journal.entries.map((entry) => entry.tag);
};

/**
 * `.sql` files present in drizzle-active that the journal does NOT record.
 *
 * WHY THIS EXISTS, CONCRETELY: the journal is the recorded order, so it -- not a
 * `.sort()` of the directory -- is what this helper applies. But a migration can
 * be added to the directory WITHOUT a journal entry (hand-written addendum, or a
 * `db:generate` stub that a second agent then supersedes). In that state the
 * journal silently applies a chain one migration short of what is on disk, and
 * a fixture that reads like "the real chain" is one migration behind without
 * saying so. That is precisely the drift class this helper exists to remove, so
 * it is detected rather than absorbed. It warns instead of throwing, because
 * during an in-flight migration a loud failure in every unrelated suite is
 * worse than a loud warning; the integration owner resolves the journal.
 */
export const unjournaledActiveMigrations = () => {
  const recorded = new Set(activeChainTags());
  return readdirSync(ACTIVE_ROOT)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => name.replace(/\.sql$/, ""))
    .filter((tag) => !recorded.has(tag))
    .sort();
};

let warned = false;

/** Applies the ordered active migration chain onto an existing DatabaseSync. */
export const applyActiveChain = (db) => {
  const unjournaled = unjournaledActiveMigrations();
  if (unjournaled.length && !warned) {
    warned = true;
    console.warn(
      `[active-chain-fixture] WARNING: drizzle-active holds migration(s) the journal does not record: ${unjournaled.join(", ")}. `
      + "This fixture applies the JOURNAL's chain, so it is one migration behind the files on disk. "
      + "Add the journal entry (or remove the stray file) before trusting these fixtures as the real chain.",
    );
  }
  for (const tag of activeChainTags()) {
    const sql = readFileSync(join(ACTIVE_ROOT, `${tag}.sql`), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
  return db;
};

/**
 * A fresh in-memory database carrying the real active chain.
 *
 * `foreignKeys` defaults to TRUE because the real chain leaves it ON:
 * drizzle-active/0002_governing_source_fk.sql wraps its table rebuild in
 * `PRAGMA foreign_keys=OFF` ... `PRAGMA foreign_keys=ON`, and its own comment
 * records that a no-op-inside-a-transaction pragma "could never work in
 * production" -- so production runs with FK enforcement on. The pragma is
 * re-asserted AFTER the chain is applied, precisely because 0002 would
 * otherwise override whatever the caller asked for.
 *
 * Pass `foreignKeys: false` only where a governed read path is exercised
 * against deliberately non-referential seed evidence; enforcing referential
 * integrity there would fail the seed rather than the behaviour under test.
 */
export const activeChainDatabase = ({ foreignKeys = true } = {}) => {
  const raw = new DatabaseSync(":memory:");
  applyActiveChain(raw);
  raw.exec(`PRAGMA foreign_keys=${foreignKeys ? "ON" : "OFF"}`);
  return raw;
};

/**
 * A D1-shaped adapter over a node:sqlite DatabaseSync.
 *
 * D1 reports write results as `{ meta: { changes, last_insert_rowid } }`;
 * node:sqlite reports them flat. Governed code reads the D1 shape, so BOTH are
 * returned -- some readers in this repository use `result.changes` and others
 * use `result.meta.changes`, and neither form is a lie about the other.
 */
export const d1 = (raw, { onRead, onWrite } = {}) => ({
  prepare(sql) {
    const operation = (args = []) => ({
      first: async () => {
        if (onRead) await onRead(sql, args);
        return raw.prepare(sql).get(...args) ?? null;
      },
      all: async () => {
        if (onRead) await onRead(sql, args);
        return { results: raw.prepare(sql).all(...args) };
      },
      run: async () => {
        if (onWrite) await onWrite(sql, args);
        const result = raw.prepare(sql).run(...args);
        const changes = Number(result.changes || 0);
        return { ...result, changes, meta: { changes, last_insert_rowid: result.lastInsertRowid } };
      },
    });
    return { ...operation(), bind: (...args) => operation(args) };
  },
  // Sequential autocommit -- see the MODELLING NOTE at the top of this file.
  async batch(statements) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  },
});
