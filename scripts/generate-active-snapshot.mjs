#!/usr/bin/env node
/**
 * Generate a drizzle snapshot for an ADD-ONLY migration from the live database.
 *
 * Usage: node scripts/generate-active-snapshot.mjs <db> <prevSnapshot> <targetSnapshot>
 *   e.g. ... faaf2b04.sqlite 0021 0022
 *
 * WHY A GENERATOR, AND WHY DERIVED FROM THE LIVE DB
 * A journal entry without its snapshot breaks the active-chain contract that
 * `scripts/check-active-chain-consistency.mjs` enforces (snapshot count vs
 * journal entry count, and newest snapshot index vs newest journal tag). The live
 * database is the authoritative record of what a migration actually produced, so
 * the snapshot is derived from it rather than hand-written; the predecessor's
 * table entries are copied verbatim so no existing table is silently rewritten.
 *
 * PRECEDENT: an index that is UNIQUE over COALESCE(...) expressions is not
 * snapshot-representable and is omitted, exactly as 0020 omits
 * `drawing_quantity_claims_current_identity_idx` while the index still exists in
 * the database.
 *
 * Additive-column migrations only: existing tables are copied unchanged; the new
 * columns are read straight from the live schema, so the emitted entry is
 * regenerated wholesale from `pragma_table_info`.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const META = join(ROOT, "drizzle-active", "meta");
const [dbPath, prevTag, targetTag] = process.argv.slice(2);
if (!dbPath || !prevTag || !targetTag) {
  throw new Error("Usage: <db> <prevSnapshotTag e.g. 0021> <targetSnapshotTag e.g. 0022>");
}

const prev = JSON.parse(readFileSync(join(META, `${prevTag}_snapshot.json`), "utf8"));
const target = join(META, `${targetTag}_snapshot.json`);
if (existsSync(target)) throw new Error(`refusing to overwrite existing ${target}`);

const db = new DatabaseSync(dbPath, { readOnly: true });
const all = (s, ...a) => db.prepare(s).all(...a);

const sqliteTypeToDrizzle = (t) => {
  const s = String(t || "text").toLowerCase();
  if (s.includes("int")) return "integer";
  if (s.includes("real") || s.includes("floa") || s.includes("doub")) return "real";
  if (s.includes("blob")) return "blob";
  return "text";
};

function buildTable(name) {
  const columns = {};
  for (const c of all(`PRAGMA table_info(${name})`)) {
    const col = {
      name: c.name, type: sqliteTypeToDrizzle(c.type),
      primaryKey: c.pk === 1, notNull: c.notnull === 1, autoincrement: false,
    };
    if (c.dflt_value !== null) col.default = c.dflt_value;
    columns[c.name] = col;
  }
  const foreignKeys = {};
  for (const fk of all(`PRAGMA foreign_key_list(${name})`)) {
    const fkName = `${name}_${fk.from}_${fk.table}_${fk.to}_fk`;
    foreignKeys[fkName] = {
      name: fkName, tableFrom: name, tableTo: fk.table,
      columnsFrom: [fk.from], columnsTo: [fk.to ?? "id"],
      onDelete: (fk.on_delete || "NO ACTION").toLowerCase(),
      onUpdate: (fk.on_update || "NO ACTION").toLowerCase(),
    };
  }
  const indexes = {};
  for (const ix of all(
    "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", name,
  )) {
    if (/COALESCE/i.test(ix.sql)) continue; // not snapshot-representable
    const unique = /CREATE UNIQUE INDEX/i.test(ix.sql);
    const cols = (ix.sql.match(/\(([^)]*)\)/)?.[1] ?? "")
      .split(",").map((s) => s.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean);
    const where = ix.sql.match(/WHERE\s+([\s\S]+)$/i)?.[1]?.trim();
    const entry = { name: ix.name, columns: cols, isUnique: unique };
    if (where) entry.where = where;
    indexes[ix.name] = entry;
  }
  return { name, columns, indexes, foreignKeys, compositePrimaryKeys: {}, uniqueConstraints: {}, checkConstraints: {} };
}

// Tables touched by an additive-column migration are re-read from live so the new
// column appears; every other table is copied verbatim from the predecessor.
const touched = ["drawing_quantity_expected_scope"];
for (const t of touched) {
  if (!all("SELECT name FROM sqlite_master WHERE type='table' AND name=?", t).length) {
    throw new Error(`table ${t} is not present in the live database; apply the migration first`);
  }
}

const tables = { ...prev.tables };
for (const t of touched) tables[t] = buildTable(t);

const snap = {
  version: prev.version,
  dialect: prev.dialect,
  id: randomUUID(),
  prevId: prev.id,
  tables,
  views: prev.views,
  enums: prev.enums,
  _meta: prev._meta,
  internal: prev.internal,
};

writeFileSync(target, `${JSON.stringify(snap, null, 2)}\n`);
console.log(`wrote ${target}`);
console.log(`  id=${snap.id} prevId=${snap.prevId}`);
console.log(`  tables ${Object.keys(prev.tables).length} -> ${Object.keys(tables).length}`);
for (const t of touched) {
  const added = Object.keys(tables[t].columns).filter((c) => !(c in prev.tables[t].columns));
  console.log(`  ${t}: ${Object.keys(tables[t].columns).length} cols (new: ${added.join(", ") || "none"}), `
    + `${Object.keys(tables[t].indexes).length} representable indexes`);
}
db.close();