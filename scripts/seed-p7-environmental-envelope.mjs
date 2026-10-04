#!/usr/bin/env node
/**
 * P7 environmental envelope seed -- governed backfill.
 *
 * Persists OPERATING_ENVELOPE facts from
 * app/domain/environmental-semantics.mjs as requirement_attributes rows
 * (canonical temperature_range / humidity_range names). APPLICATION_
 * ENVIRONMENT facts are classified only and NEVER written (no asymmetric
 * comparison exists; a row would corrupt matching). FUNCTIONAL_SETPOINT
 * facts belong to P0 and are skipped. Existing same-name rows (P6
 * humidity, parser Temperature) are verified, never duplicated or
 * overwritten.
 *
 * Usage:
 *   node scripts/seed-p7-environmental-envelope.mjs <db-path> --dry-run
 *   node scripts/seed-p7-environmental-envelope.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { classifyEnvironmentalFacts } from "../app/domain/environmental-semantics.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-p7-environmental-envelope.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const V3 = "specextract_b4b03333-f24e-4b35-976e-2e2f9e681f89";
const norm = (value) => String(value ?? "").trim().toLowerCase();

const requirements = db.prepare("SELECT id, original_text, requirement_category, review_status, source_location FROM technical_requirements WHERE extraction_version_id = ?").all(V3);
const getExisting = db.prepare("SELECT name FROM requirement_attributes WHERE requirement_id = ?");
const insertAttr = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)");

let inserted = 0, skipped = 0, appEnv = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const req of requirements) {
    const facts = classifyEnvironmentalFacts({ text: req.original_text || "", category: req.requirement_category }).filter((fact) => fact.kind === "OPERATING_ENVELOPE");
    appEnv += classifyEnvironmentalFacts({ text: req.original_text || "", category: req.requirement_category }).filter((fact) => fact.kind === "APPLICATION_ENVIRONMENT").length;
    const existing = new Set((getExisting.all(req.id) || []).map((row) => norm(row.name)));
    for (const fact of facts) {
      const label = `${req.id.slice(-14)} [${req.review_status}] -> ${fact.name} ${fact.operator} ${JSON.stringify(fact.value)}`;
      if (existing.has(norm(fact.name))) { skipped += 1; continue; }
      console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_attributes: ${label}`);
      if (apply) {
        insertAttr.run(`${req.id}_attribute_p7_${fact.name}`, req.id, fact.name, fact.operator, fact.originalValue, JSON.stringify(fact.value), 94, req.source_location);
      }
      existing.add(norm(fact.name));
      inserted += 1;
    }
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} envelope rows ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped), ${appEnv} application-environment facts classified-not-written.`);
db.close();
