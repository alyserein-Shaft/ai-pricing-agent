#!/usr/bin/env node
/**
 * Sprint 1.33 -- removes a real, existing misclassification found while
 * auditing the Detector Base family: seven genuine DETECTOR HEAD products
 * (2151-CH, 2351/EC, 2351TEM, 5151-CH, 5351E, JTWB-BCD-5151EIS,
 * JTY-GD-2151EIS) were already assigned family_id = Detector Base, solely
 * because their own descriptions name their required companion base
 * ("...Plugin Detector Base part is B401-SS", "...Plug-in Detector Base is
 * B401-CH") to tell the buyer which base to pair with -- never as a claim
 * that they themselves are a base.
 *
 * classifyFireAlarmFamilyFromText now correctly excludes all seven (see the
 * isBaseReferenceMention guard added to fire-alarm-taxonomy.mjs this same
 * sprint) -- but the existing correct-farenhyt-family-classification.mjs
 * script only ever ADDS or CHANGES a family_id when the classifier
 * confidently proposes a *different* one; it deliberately skips when the
 * classifier returns null, so it cannot remove a stale, now-disproven
 * classification on its own. This is a narrow, one-time, manually-reviewed
 * removal for exactly these seven already-identified false positives.
 *
 * Sets family_id back to NULL (unclassified) rather than guessing a
 * different family. Three of the seven now yield a confident classifier
 * proposal of their own (2351TEM/5151-CH/5351E -> Addressable Heat
 * Detector), but assigning detector-family classifications is a separate,
 * out-of-scope task from this sprint's Detector Base/Sounder Base focus --
 * reported honestly rather than acted on unilaterally.
 *
 * Idempotent: skips a product whose family_id is already NULL.
 *
 * Usage:
 *   node scripts/correct-detector-base-family-false-positives.mjs <db-path> --dry-run
 *   node scripts/correct-detector-base-family-false-positives.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { classifyFireAlarmFamilyFromText } from "../app/domain/fire-alarm-taxonomy.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-detector-base-family-false-positives.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const TARGET_PART_NUMBERS = ["2151-CH", "2351/EC", "2351TEM", "5151-CH", "5351E", "JTWB-BCD-5151EIS", "JTY-GD-2151EIS"];

const getProduct = db.prepare(`
  SELECT lp.id, lp.part_number, lp.description, lp.family_id, f.name currentFamilyName
  FROM library_products lp
  LEFT JOIN product_families f ON f.id = lp.family_id
  WHERE lp.identity_status = 'Active' AND lp.part_number = ?
`);
const clearFamily = db.prepare("UPDATE library_products SET family_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let cleared = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const partNumber of TARGET_PART_NUMBERS) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    if (!product.family_id) { console.log(`SKIP (already unclassified): ${partNumber}`); skipped += 1; continue; }
    if (product.currentFamilyName !== "Detector Base") { console.log(`SKIP (not currently Detector Base, re-check manually): ${partNumber} -> ${product.currentFamilyName}`); skipped += 1; continue; }
    const reclassified = classifyFireAlarmFamilyFromText(product.description);
    console.log(`${apply ? "CLEAR" : "WOULD CLEAR"}: ${partNumber} | "${product.description.slice(0, 70)}..." | Detector Base -> (none)${reclassified ? ` [classifier now proposes ${reclassified.family} -- not applied, out of this sprint's scope]` : ""}`);
    if (apply) clearFamily.run(product.id);
    cleared += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${cleared} product${cleared === 1 ? "" : "s"} ${apply ? "cleared" : "would be cleared"} back to unclassified, ${skipped} skipped.`);
