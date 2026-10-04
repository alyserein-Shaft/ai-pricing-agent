#!/usr/bin/env node
/**
 * P2 compatibility pack -- compat-row backfill seed.
 *
 * Runs the governed parseCompatibility (with P2 noun-form + vocabulary
 * typing) over current-v3 Al Mousa requirements and inserts
 * requirement_compatibility rows ONLY for targets typed PROTOCOL by the
 * governed vocabulary. GUARD_* (standards/vendors), AMBIGUOUS (IDP),
 * TOPOLOGY, CIRCUIT_BUS, PANEL_ROLE, and unrecognized targets never
 * become rows. Existing rows are verified, never touched.
 *
 * Rows keep the existing persisted shape (target_item verbatim,
 * relationship_type); semantic type lives in the governed vocabulary +
 * engineering_taxonomy_terms, resolvable at read time. No review-status,
 * policy, link, profile, or matching changes.
 *
 * Usage:
 *   node scripts/seed-p2-compatibility-backfill.mjs <db-path> --dry-run
 *   node scripts/seed-p2-compatibility-backfill.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { parseCompatibility } from "../app/domain/specification-extractor.mjs";
import { isMatchableCompatType } from "../app/domain/compatibility-vocabulary.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-p2-compatibility-backfill.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const V3 = "specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89";
const norm = (value) => String(value ?? "").trim().toLowerCase();

const requirements = db.prepare("SELECT id, original_text, review_status FROM technical_requirements WHERE extraction_version_id = ?").all(V3);
const getExisting = db.prepare("SELECT target_item FROM requirement_compatibility WHERE requirement_id = ?");
const insertCompat = db.prepare("INSERT INTO requirement_compatibility (id, requirement_id, source_item, target_item, relationship_type, conditions, exceptions, mandatory, confidence, review_status) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'Needs Review')");

let inserted = 0, skipped = 0, nonMatchable = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const req of requirements) {
    const found = parseCompatibility(req.original_text || "");
    const existing = (getExisting.all(req.id) || []).map((row) => norm(row.target_item));
    for (const entry of found) {
      const label = `${req.id.slice(-14)} [${req.review_status}] -> "${entry.targetItem}" [${entry.targetType || "UNTYPED"}]`;
      if (!isMatchableCompatType(entry.targetType)) { nonMatchable += 1; continue; }
      if (existing.includes(norm(entry.targetItem))) { skipped += 1; continue; }
      console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_compatibility: ${label}`);
      if (apply) {
        insertCompat.run(`${req.id}_compat_p2_${Buffer.from(entry.targetItem).toString("hex").slice(0, 16)}`, req.id, entry.sourceItem, entry.targetItem, entry.type === "Interface" ? "Interface" : "Compatible With", entry.mandatory ? 1 : 0, entry.confidence || 84);
      }
      inserted += 1;
    }
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} rows ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped), ${nonMatchable} non-matchable targets correctly excluded.`);
db.close();
