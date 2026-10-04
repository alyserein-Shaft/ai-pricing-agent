#!/usr/bin/env node
/**
 * Sprint 1.33 -- real, pre-existing data defect found while proving the
 * Isolator Detector Base's new-project reuse: B224BI-IV and B224BI-WH each
 * carry exactly one "standard" entry --
 *   {"body":"ISO","number":"lator","originalText":"isolator"}
 * -- an obvious parsing artifact from an earlier import that split the word
 * "isolator" into a fake "ISO" body / "lator" number pair. This predates
 * every sprint in this session; it is not a standard of any kind, real or
 * placeholder, so it is removed rather than reinterpreted.
 *
 * Fix: remove only this one garbled entry from each product's standards
 * array (both currently contain nothing else), leaving standards genuinely
 * unresolved for B224BI (its own official documents state only generic
 * "UL Listed" with no citable number -- reported as a real gap, not
 * fabricated).
 *
 * Usage:
 *   node scripts/correct-b224bi-garbled-standard.mjs <db-path> --dry-run
 *   node scripts/correct-b224bi-garbled-standard.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-b224bi-garbled-standard.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const TARGET_PART_NUMBERS = ["B224BI-IV", "B224BI-WH"];
const getProduct = db.prepare("SELECT id, part_number, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let fixed = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const partNumber of TARGET_PART_NUMBERS) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const standards = JSON.parse(product.standards || "[]");
    const garbled = standards.filter((s) => s.body === "ISO" && s.number === "lator" && s.originalText === "isolator");
    if (!garbled.length) { console.log(`SKIP (no garbled entry found): ${partNumber}`); skipped += 1; continue; }
    const cleaned = standards.filter((s) => !(s.body === "ISO" && s.number === "lator" && s.originalText === "isolator"));
    console.log(`${apply ? "REMOVE" : "WOULD REMOVE"}: ${partNumber} -> {"body":"ISO","number":"lator"} (${standards.length} -> ${cleaned.length} standards entries)`);
    if (apply) updateStandards.run(JSON.stringify(cleaned), product.id);
    fixed += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${fixed} product${fixed === 1 ? "" : "s"} cleaned, ${skipped} skipped.`);
