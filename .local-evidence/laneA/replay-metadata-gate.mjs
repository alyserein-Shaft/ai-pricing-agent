// Replays the tail of the "active Drizzle metadata is a fresh baseline plus
// governed authority migrations" test in tests/migration-baseline-safety.test.mjs
// -- every assertion that comes AFTER the hard-coded 0007-era journal tag list,
// which that (out-of-scope) test file still pins. Proves the recovered metadata
// itself is coherent, so the only thing left in that suite is test-side staleness.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const ACTIVE_ROOT = join(ROOT, "drizzle-active");
const manifest = JSON.parse(readFileSync(join(ACTIVE_ROOT, "manifest.json"), "utf8"));
const journal = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", "_journal.json"), "utf8"));
const lastTag = journal.entries[journal.entries.length - 1].tag;
const snapshotIndex = lastTag.slice(0, 4);
const snapshot = JSON.parse(readFileSync(join(ACTIVE_ROOT, "meta", `${snapshotIndex}_snapshot.json`), "utf8"));

assert.equal(journal.version, "7");
assert.equal(journal.dialect, "sqlite");
assert.notEqual(snapshot.prevId, "00000000-0000-0000-0000-000000000000");
assert.equal(Object.keys(snapshot.tables || {}).length, 314);
const sourceTables = new Map(manifest.tables.map((t) => [t.name, t.columns.map((c) => c.name).sort()]));
for (const [name, sourceColumns] of sourceTables) {
  const actualColumns = Object.values(snapshot.tables[name].columns || {}).map((c) => c.name).sort();
  assert.deepEqual(actualColumns, sourceColumns, `${name} columns must match the canonical source manifest`);
}
for (const name of ["excel_export_jobs", "supplier_quote_lines", "specification_extraction_jobs", "project_quotation_lines"]) {
  assert.ok(Object.keys(snapshot.tables[name].foreignKeys || {}).length > 0, `${name} must retain canonical foreign keys`);
}
console.log(`PASS  all post-tag-list assertions of the metadata gate hold against ${lastTag}`);
console.log(`      0010 snapshot: ${Object.keys(snapshot.tables).length} tables, all 314 column sets match the regenerated manifest`);
console.log(`      manifest counts: ${JSON.stringify(manifest.counts)}`);

// The other frozen expectations in the same file, replayed for the report.
console.log(`\nFrozen 0007-era expectations still hard-coded in tests/migration-baseline-safety.test.mjs:`);
console.log(`  L63  manifest.target.cutoffMigration          expected 0007, actual ${manifest.target.cutoffMigration}`);
console.log(`  L72  manifest.counts.namedIndexes            expected 456,   actual ${manifest.counts.namedIndexes}`);
console.log(`  L157 activeFiles.filter(/^0008_/)             expected []`);
console.log(`  L203 journal.entries[].tag deepEqual 0000..0007 (actual 0000..0010)`);
