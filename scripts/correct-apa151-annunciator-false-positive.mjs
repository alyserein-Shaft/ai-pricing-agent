#!/usr/bin/env node
/**
 * Sprint 1.39 -- removes a real, existing misclassification found while
 * enriching Annunciator: APA151 ("Annunciator with piezo, alarm and power
 * LED's.") is classified as a full Annunciator, the same family as the
 * RA-2000/RA-2000GRAY panel-level LCD remote annunciators -- but APA151 is
 * actually a small, device-level remote indicator accessory for InnovairFlex
 * duct detectors (named alongside RTS151/M02-04-00/etc. in the D4120/DNR
 * duct detector datasheets' own "Accessories" ordering tables, Sprint
 * 1.36), not a standalone facility annunciator panel. Unlike the LENS
 * lens/WTP/STI1210D shape (an accessory naming a DIFFERENT device category it
 * accompanies), APA151 genuinely calls ITSELF an "annunciator" in its own
 * text -- a real semantic mismatch between a small duct-detector indicator
 * and a full building-level annunciator panel, not a phrase collision the
 * classifier could resolve on text alone. Handled the same documented,
 * human-reviewed way as every other false positive this session: a
 * correction script, not a classifier guard.
 *
 * Sets family_id back to NULL (unclassified) rather than guessing a
 * different family -- APA151 remains a genuine duct-detector accessory
 * with no dedicated family declared today (see the Duct Detector family's
 * own accessory list, Sprint 1.36).
 *
 * Idempotent: skips if family_id is already NULL.
 *
 * Usage:
 *   node scripts/correct-apa151-annunciator-false-positive.mjs <db-path> --dry-run
 *   node scripts/correct-apa151-annunciator-false-positive.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-apa151-annunciator-false-positive.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const getProduct = db.prepare(`
  SELECT lp.id, lp.part_number, lp.description, lp.family_id, f.name currentFamilyName
  FROM library_products lp
  LEFT JOIN product_families f ON f.id = lp.family_id
  WHERE lp.identity_status = 'Active' AND lp.part_number = 'APA151'
`);
const clearFamily = db.prepare("UPDATE library_products SET family_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let cleared = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  const product = getProduct.get();
  if (!product) throw new Error("Product not found: APA151");
  if (!product.family_id) { console.log("SKIP (already unclassified): APA151"); skipped += 1; }
  else if (product.currentFamilyName !== "Annunciator") { console.log(`SKIP (not currently Annunciator, re-check manually): APA151 -> ${product.currentFamilyName}`); skipped += 1; }
  else {
    console.log(`${apply ? "CLEAR" : "WOULD CLEAR"}: APA151 | "${product.description}" | Annunciator -> (none)`);
    if (apply) clearFamily.run(product.id);
    cleared += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${cleared} product${cleared === 1 ? "" : "s"} ${apply ? "cleared" : "would be cleared"} back to unclassified, ${skipped} skipped.`);
