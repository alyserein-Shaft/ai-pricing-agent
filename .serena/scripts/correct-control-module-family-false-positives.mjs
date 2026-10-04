#!/usr/bin/env node
/**
 * Sprint 1.34 -- removes a real, existing misclassification found while
 * auditing Modules and Interfaces: CB500 ("Control module barrier, required
 * by UL to separate power limited and non power limited wiring in
 * modules") was already assigned family_id = Control Module, solely because
 * its own description contains the bare "control module" phrase as a
 * reference to the device category it accompanies -- CB500 is Honeywell's
 * own "CB500 Wiring Barrier", a physical junction-box divider accessory with
 * no input/output function of its own, never a control module itself.
 *
 * classifyFireAlarmFamilyFromText now correctly returns null for CB500 (see
 * the isControlModuleBarrierMention guard added to fire-alarm-taxonomy.mjs
 * this same sprint) -- but the existing correct-farenhyt-family-
 * classification.mjs script only ever ADDS or CHANGES a family_id when the
 * classifier confidently proposes a *different* one; it deliberately skips
 * when the classifier returns null, so it cannot remove a stale, now-
 * disproven classification on its own. This is a narrow, one-time,
 * manually-reviewed removal for exactly this one already-identified false
 * positive.
 *
 * Sets family_id back to NULL (unclassified) rather than guessing a
 * different family -- CB500 is a genuine accessory with no dedicated
 * "module barrier"/"wiring accessory" family declared today.
 *
 * Idempotent: skips if family_id is already NULL.
 *
 * Usage:
 *   node scripts/correct-control-module-family-false-positives.mjs <db-path> --dry-run
 *   node scripts/correct-control-module-family-false-positives.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { classifyFireAlarmFamilyFromText } from "../app/domain/fire-alarm-taxonomy.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-control-module-family-false-positives.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const getProduct = db.prepare(`
  SELECT lp.id, lp.part_number, lp.description, lp.family_id, f.name currentFamilyName
  FROM library_products lp
  LEFT JOIN product_families f ON f.id = lp.family_id
  WHERE lp.identity_status = 'Active' AND lp.part_number = 'CB500'
`);

const clearFamily = db.prepare("UPDATE library_products SET family_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let cleared = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  const product = getProduct.get();
  if (!product) throw new Error("Product not found: CB500");
  if (!product.family_id) { console.log("SKIP (already unclassified): CB500"); skipped += 1; }
  else if (product.currentFamilyName !== "Control Module") { console.log(`SKIP (not currently Control Module, re-check manually): CB500 -> ${product.currentFamilyName}`); skipped += 1; }
  else {
    const reclassified = classifyFireAlarmFamilyFromText(product.description);
    console.log(`${apply ? "CLEAR" : "WOULD CLEAR"}: CB500 | "${product.description.slice(0, 70)}..." | Control Module -> (none)${reclassified ? ` [classifier now proposes ${reclassified.family} -- not applied, needs human review]` : ""}`);
    if (apply) clearFamily.run(product.id);
    cleared += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${cleared} product${cleared === 1 ? "" : "s"} ${apply ? "cleared" : "would be cleared"} back to unclassified, ${skipped} skipped.`);
