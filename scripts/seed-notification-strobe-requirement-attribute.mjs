#!/usr/bin/env node
/**
 * Sprint 1.21 -- structured attribute extraction for requirement_389
 * ("Strobes shall be rated 15, 30, 60, 75, 110, or 177 candela as shown for
 * proper illuminance, with a 1 Hertz flash rate, Xenon flash tube, white
 * body, clear Lexan lens with red "FIRE" or international fire symbol
 * lettering, capable of being synchronized, and capable of wall or ceiling
 * mounting."), now confirmed-linked to items 30/32/33 (Sounder/Strobe and
 * Speaker/Strobe).
 *
 * Only ONE fact in this clause is safely, unambiguously structurable without
 * inventing specificity the clause itself doesn't provide:
 *   - flash_rate = "1 Hz" -- a single fixed value, no ambiguity.
 * Deliberately NOT extracted:
 *   - candela_rating -- the clause itself says "as shown" (drawing-dependent,
 *     one of six values); picking any single value would fabricate a
 *     specificity this clause does not commit to for this BOQ line.
 *   - mounting_type -- "capable of wall OR ceiling" is a capability
 *     (supports either), not a single required value our attribute model
 *     represents; forcing one would risk wrongly rejecting a compliant unit.
 * The frequency-range/dBA facts in requirement_387 (Speakers) and the
 * "single mounting plate" fact in requirement_397 are likewise left
 * unstructured this sprint -- both need range/unit handling or a governed
 * attribute name that doesn't yet exist, and inventing either now risks a
 * subtly wrong comparison rather than an honest "Missing Product Data" gate.
 *
 * Writes into the EXISTING requirement_attributes table only (no schema
 * change), the same structure Sprint 0.9/1.9's scripts already used. Does
 * NOT touch any library_products catalog data -- whether current candidate
 * products carry a matching flash_rate value is a separate, honestly
 * reported Product Knowledge gap, not addressed here.
 *
 * Idempotent: skips a requirement that already has a flash_rate attribute
 * entry. Never overwrites or removes an existing entry.
 *
 * Usage:
 *   node scripts/seed-notification-strobe-requirement-attribute.mjs <db-path> --dry-run
 *   node scripts/seed-notification-strobe-requirement-attribute.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-notification-strobe-requirement-attribute.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();

const REQ_389 = "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_389";

const REQUIREMENT_ATTRIBUTES = [
  {
    requirementId: REQ_389, name: "flash_rate", operator: "Equal",
    originalValue: "1 Hertz flash rate", normalizedValue: "1 Hz",
    confidence: 85,
  },
];

const getRequirement = db.prepare("SELECT source_location FROM technical_requirements WHERE id = ?");
const getExistingAttrs = db.prepare("SELECT name FROM requirement_attributes WHERE requirement_id = ?");
const insertReqAttr = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)");

let inserted = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const entry of REQUIREMENT_ATTRIBUTES) {
    const requirement = getRequirement.get(entry.requirementId);
    if (!requirement) throw new Error(`Requirement not found: ${entry.requirementId}`);
    const existing = (getExistingAttrs.all(entry.requirementId) || []).map((row) => norm(row.name));
    const label = `${entry.requirementId} -> ${entry.name} = "${entry.normalizedValue}"`;
    if (existing.includes(norm(entry.name))) { console.log(`SKIP (already present): ${label}`); skipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_attributes: ${label}`);
    if (apply) {
      const id = `${entry.requirementId}_attribute_${entry.name}`;
      insertReqAttr.run(id, entry.requirementId, entry.name, entry.operator, entry.originalValue, JSON.stringify(entry.normalizedValue), entry.confidence, requirement.source_location);
    }
    inserted += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} attribute entr${inserted === 1 ? "y" : "ies"} ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped).`);
