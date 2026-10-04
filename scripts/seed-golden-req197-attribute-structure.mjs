#!/usr/bin/env node
/**
 * Stage 4W -- Golden Requirement 197 structured attribute capture.
 *
 * Requirement 197 (Al Mousa 28 46 00 Rev 1, clause 5, pages 11-14) is a
 * governed, Approved, Confirmed-linked compound Heat Detector clause whose
 * text the production matcher could only evaluate through the generic
 * unstructured "Missing Product Data" fallback: it carries zero
 * requirement_attributes rows, so EVERY candidate failed on structure --
 * including a theoretically correct one. That failure mode masquerades as
 * missing product data when the real defect is missing requirement structure.
 *
 * This script writes into the EXISTING requirement_attributes table (the
 * same structure worker/technical-requirement-api.mjs loadInputs already
 * reads into consolidatedRequirements[].attributes, already consumed by
 * app/domain/product-matching-engine.mjs attributeComparisons). No schema
 * change, no new table, no original-text change, no product change.
 *
 * Captured dimensions (verbatim sub-clauses of Requirement 197, Golden
 * applicability per the authoritative 9xROR/0xHT engineer decision):
 *   addressing                  = Addressable      (clause b.iii.e)
 *   fixed_temperature_setpoint  = 135F             (clause b.iii.d/y)
 *   rate_of_rise_sensitivity    = 15F/min          (clause b.iii.c/y)
 * Attribute names match the governed catalog vocabulary exactly
 * (library_products.attributes on IDP-HEAT-ROR-IV), so comparison is a
 * real evidence check, not a vocabulary invention.
 *
 * Deliberately NOT captured here:
 * - FlashScan/CLIP: already structured via requirement_compatibility
 *   (Compatible With "Flash Scan and CLIP protocol systems"), evaluated on
 *   the Compatibility path. Duplicating them as attributes would double
 *   count one requirement.
 * - two-wire SLC: no product in the current catalog carries connection/
 *   wiring evidence; adding it would fail every candidate (including a
 *   correct one) on structure. Reported as residual, honestly uncovered.
 * - detectorType "Heat Detector": no product-side attribute with that
 *   name exists; family coverage stays at the discovery family-match
 *   stage, the architecture's existing mechanism. Not invented.
 * - highTemperature 190F: NOT_APPLICABLE to the Golden quantity of 9 per
 *   the authoritative engineer decision (0 HT units). Absent by design so
 *   it can never false-fail a standard ROR detector.
 *
 * Idempotent: skips a requirement that already has an attribute entry with
 * the same normalized name. Never overwrites or removes an existing entry.
 *
 * Usage:
 *   node scripts/seed-golden-req197-attribute-structure.mjs <db-path> --dry-run
 *   node scripts/seed-golden-req197-attribute-structure.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-golden-req197-attribute-structure.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();

const REQ_197 = "specjob_2ee1d387-770f-4671-950f-5f3a8f2f5a48_chunk_000001_requirement_197";

const REQUIREMENT_ATTRIBUTES = [
  {
    name: "addressing", operator: "Equal",
    originalValue: "Individually addressable devices",
    normalizedValue: "Addressable", confidence: 95,
  },
  {
    name: "fixed_temperature_setpoint", operator: "Equal",
    originalValue: "Factory-set fixed temperature at 135°F (57°C)",
    normalizedValue: "135°F", confidence: 95,
  },
  {
    name: "rate_of_rise_sensitivity", operator: "Equal",
    originalValue: "Rate-of-rise detection at 15°F (8.3°C) per minute",
    normalizedValue: "15°F/min", confidence: 95,
  },
];

const getRequirement = db.prepare("SELECT source_location FROM technical_requirements WHERE id = ?");
const getExistingAttrs = db.prepare("SELECT name FROM requirement_attributes WHERE requirement_id = ?");
const insertReqAttr = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)");

let inserted = 0, skipped = 0;
const requirement = getRequirement.get(REQ_197);
if (!requirement) throw new Error(`Requirement not found: ${REQ_197}`);
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const entry of REQUIREMENT_ATTRIBUTES) {
    const existing = (getExistingAttrs.all(REQ_197) || []).map((row) => norm(row.name));
    const label = `${REQ_197} -> ${entry.name} = "${entry.normalizedValue}"`;
    if (existing.includes(norm(entry.name))) { console.log(`SKIP (already present): ${label}`); skipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_attributes: ${label}`);
    if (apply) {
      const id = `${REQ_197}_attribute_structured_${entry.name}`;
      insertReqAttr.run(id, REQ_197, entry.name, entry.operator, entry.originalValue, JSON.stringify(entry.normalizedValue), entry.confidence, requirement.source_location);
    }
    inserted += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} attribute entr${inserted === 1 ? "y" : "ies"} ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped).`);
db.close();
