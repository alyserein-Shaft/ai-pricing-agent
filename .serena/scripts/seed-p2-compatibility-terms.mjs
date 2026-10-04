#!/usr/bin/env node
/**
 * P2 compatibility pack -- governed vocabulary seed.
 *
 * Mirrors app/domain/compatibility-vocabulary.mjs COMPATIBILITY_VOCABULARY
 * into engineering_taxonomy_terms (Global scope, Active) so the vocabulary
 * is governed data, not just a code constant. Single source of truth
 * remains the module; this script fails loudly on any drift between the
 * table and the module (missing or extra canonical names).
 *
 * No requirement, product, policy, or matching changes.
 *
 * Usage:
 *   node scripts/seed-p2-compatibility-terms.mjs <db-path> --dry-run
 *   node scripts/seed-p2-compatibility-terms.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { COMPATIBILITY_VOCABULARY } from "../app/domain/compatibility-vocabulary.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-p2-compatibility-terms.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const existing = new Map(db.prepare("SELECT canonical_name, term_type FROM engineering_taxonomy_terms WHERE scope_type='Global' AND deleted_at IS NULL").all().map((row) => [row.canonical_name, row.term_type]));
const insertTerm = db.prepare("INSERT INTO engineering_taxonomy_terms (id, parent_id, term_type, canonical_name, display_name, code, synonyms, scope_type, scope_id, version_number, status, created_by) VALUES (?, NULL, ?, ?, ?, NULL, ?, 'Global', NULL, 1, 'Active', ?)");

let inserted = 0, present = 0;
const drift = [];
for (const entry of COMPATIBILITY_VOCABULARY) {
  if (existing.has(entry.term)) {
    if (existing.get(entry.term) !== entry.type) drift.push(`${entry.term}: table=${existing.get(entry.term)} module=${entry.type}`);
    present += 1;
    continue;
  }
  console.log(`${apply ? "INSERT" : "WOULD INSERT"}: engineering_taxonomy_terms: ${entry.term} [${entry.type}]`);
  if (apply) {
    insertTerm.run(`compat-term-${entry.term.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, entry.type, entry.term, entry.term, JSON.stringify(entry.aliases), "system:compatibility-vocabulary-seed");
  }
  inserted += 1;
}
if (drift.length) throw new Error(`Term drift detected (table disagrees with module): ${drift.join("; ")}`);
console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} terms ${apply ? "inserted" : "would be inserted"}, ${present} already present.`);
db.close();
