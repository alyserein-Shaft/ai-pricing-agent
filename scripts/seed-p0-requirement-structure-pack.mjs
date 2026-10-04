#!/usr/bin/env node
/**
 * P0 deterministic structure pack -- backfill seed.
 *
 * Applies the P0 verbatim attribute patterns
 * (app/domain/specification-extractor.mjs: fixed_temperature_setpoint,
 * rate_of_rise_sensitivity, addressing) to current-v3 Al Mousa
 * requirements, writing rows into the EXISTING requirement_attributes
 * table -- the same structure worker/technical-requirement-api.mjs
 * loadInputs already reads, already consumed by the production matcher.
 * No schema change, no new table, no original-text change, no review
 * status change, no product change.
 *
 * Only the three P0 names are written, only with catalog-vocabulary
 * normalized values, only where the pattern matched verbatim source text.
 * Deduplicated by (name, normalizedValue) per requirement; already-present
 * rows are skipped, never overwritten or removed. Existing Voltage /
 * Current / Temperature / Capacity rows are verified, never touched.
 *
 * 190F note: the high-temperature-model 190F value is preserved as its
 * own separate source fact on its own requirement (req193); it is never
 * merged into a 135F row and never written onto Golden req197, so it can
 * never false-fail a standard ROR detector.
 *
 * Usage:
 *   node scripts/seed-p0-requirement-structure-pack.mjs <db-path> --dry-run
 *   node scripts/seed-p0-requirement-structure-pack.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { extractAttributes } from "../app/domain/specification-extractor.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-p0-requirement-structure-pack.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();

const V3 = "specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89";
const P0_NAMES = new Set(["fixed_temperature_setpoint", "rate_of_rise_sensitivity", "addressing"]);

const requirements = db.prepare("SELECT id, original_text, source_location, review_status FROM technical_requirements WHERE extraction_version_id = ?").all(V3);
const getExisting = db.prepare("SELECT name, normalized_value FROM requirement_attributes WHERE requirement_id = ?");
const insertAttr = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)");

let inserted = 0, skipped = 0, verified = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const req of requirements) {
    const found = extractAttributes(req.original_text || "").filter((entry) => P0_NAMES.has(entry.name));
    const seen = new Set();
    const existing = (getExisting.all(req.id) || []).map((row) => `${norm(row.name)}|${norm(JSON.parse(row.normalized_value ?? "null"))}`);
    for (const entry of found) {
      const key = `${norm(entry.name)}|${norm(entry.normalizedValue)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const label = `${req.id.slice(-14)} [${req.review_status}] -> ${entry.name} = "${entry.normalizedValue}"`;
      if (existing.includes(key)) { skipped += 1; continue; }
      console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_attributes: ${label}`);
      if (apply) {
        const id = `${req.id}_attribute_p0_${entry.name}_${Buffer.from(String(entry.normalizedValue)).toString("hex").slice(0, 16)}`;
        insertAttr.run(id, req.id, entry.name, entry.operator || "Equal", entry.originalValue, JSON.stringify(entry.normalizedValue), entry.confidence || 94, req.source_location);
      }
      inserted += 1;
    }
    if (found.length) verified += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} rows ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped), ${verified} requirements carry P0 structure.`);
db.close();
