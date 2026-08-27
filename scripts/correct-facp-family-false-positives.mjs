#!/usr/bin/env node
/**
 * Sprint 1.28 -- removes a real, existing misclassification found while
 * auditing the Fire Alarm Control Panel family: three genuine ACCESSORY
 * products (SK-NIC-KIT, MNS-CONTROL8, MNS-CONTROL16) were already assigned
 * family_id = Fire Alarm Control Panel, solely because their own
 * descriptions reference the bare "FACP" abbreviation as an external device
 * they work with ("...outside of the FACP cabinet", "FACP interface for
 * LED arrays..."), never as a claim that they themselves are one.
 *
 * classifyFireAlarmFamilyFromText now correctly returns null for all three
 * (see the isFacpReferenceMention guard added to fire-alarm-taxonomy.mjs
 * this same sprint) -- but the existing correct-farenhyt-family-classification.mjs
 * script only ever ADDS or CHANGES a family_id when the classifier
 * confidently proposes a *different* one; it deliberately skips when the
 * classifier returns null, so it cannot remove a stale, now-disproven
 * classification on its own. This is a narrow, one-time, manually-reviewed
 * removal for exactly these three already-identified false positives --
 * not a general "unclassify anything the classifier no longer confirms"
 * mechanism, which would be far too broad a change to make unreviewed.
 *
 * Sets family_id back to NULL (unclassified) rather than guessing a
 * different family -- these are real accessories with no dedicated
 * accessory family declared for "FACP LED-array interface"/"NIC mounting
 * kit" concepts today.
 *
 * Idempotent: skips a product whose family_id is already NULL.
 *
 * Usage:
 *   node scripts/correct-facp-family-false-positives.mjs <db-path> --dry-run
 *   node scripts/correct-facp-family-false-positives.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { classifyFireAlarmFamilyFromText } from "../app/domain/fire-alarm-taxonomy.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-facp-family-false-positives.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const TARGET_PART_NUMBERS = ["SK-NIC-KIT", "MNS-CONTROL8", "MNS-CONTROL16"];

const getProduct = db.prepare(`
  SELECT lp.id, lp.part_number, lp.description, lp.family_id, f.name currentFamilyName
  FROM library_products lp
  JOIN product_manufacturers pm ON pm.id = lp.manufacturer_id
  LEFT JOIN product_families f ON f.id = lp.family_id
  WHERE pm.normalized_name = 'HONEYWELL' AND lp.identity_status = 'Active' AND lp.part_number = ?
`);
const clearFamily = db.prepare("UPDATE library_products SET family_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let cleared = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const partNumber of TARGET_PART_NUMBERS) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    if (!product.family_id) { console.log(`SKIP (already unclassified): ${partNumber}`); skipped += 1; continue; }
    if (product.currentFamilyName !== "Fire Alarm Control Panel") { console.log(`SKIP (not currently Fire Alarm Control Panel, re-check manually): ${partNumber} -> ${product.currentFamilyName}`); skipped += 1; continue; }
    const reclassified = classifyFireAlarmFamilyFromText(product.description);
    if (reclassified) { console.log(`SKIP (classifier now confidently proposes a real family -- use the standard correction script instead): ${partNumber} -> ${reclassified.family}`); skipped += 1; continue; }
    console.log(`${apply ? "CLEAR" : "WOULD CLEAR"}: ${partNumber} | "${product.description.slice(0, 70)}..." | Fire Alarm Control Panel -> (none)`);
    if (apply) clearFamily.run(product.id);
    cleared += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${cleared} product${cleared === 1 ? "" : "s"} ${apply ? "cleared" : "would be cleared"} back to unclassified, ${skipped} skipped.`);
