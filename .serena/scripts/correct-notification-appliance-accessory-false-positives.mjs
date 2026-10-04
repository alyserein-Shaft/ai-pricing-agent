#!/usr/bin/env node
/**
 * Sprint 1.38 -- removes twelve real, existing misclassifications found
 * while auditing the standalone Strobe/Sounder/Speaker families: eight
 * strobe-lens attachments (LENS-A/AC/B/BC/G/GC/R/RC, "Wall/Ceiling Strobe
 * Lens Attachment, <color>") and four weatherproof plate/cover accessories
 * (STI1210D "Horn Strobe Cover, surface mount", WTP/WTPW "Weatherproof
 * plate, for use with horns, strobes, and horn strobes", WTP-SPW
 * "Weatherproof plate, for use with speakers and speaker strobes") were all
 * classified as if they were notification devices, solely because their own
 * descriptions contain the literal phrase "strobe" or "horn strobe"/
 * "speaker strobe" naming the device category they physically attach to or
 * protect -- none of them is itself a strobe, horn, or speaker.
 *
 * This is the exact same false-positive shape this project has always
 * handled as a documented, per-part-number reviewer exclusion at the
 * correction script's own invocation (Sprint 1.16/1.20), never a
 * classifier-level special case -- see the test "a plate/cover accessory
 * that only mentions Horn/Strobe devices is a documented correction-script
 * exclusion, not a classifier guard" in fire-alarm-taxonomy-integration.test.mjs,
 * which exists specifically so STI1210D and the WTP* plates keep resolving
 * to their real (device-side) family under classifyFireAlarmFamilyFromText,
 * and are excluded only here, by direct human review, never by narrowing
 * the shared classifier. A classifier-level guard for this exact shape was
 * tried and reverted this same sprint after it broke that test.
 *
 * Sets family_id back to NULL (unclassified) rather than guessing a
 * different family -- these are genuine accessories (a color lens
 * attachment, a physical cover, and weatherproofing plates) with no
 * dedicated "notification appliance accessory" family declared today.
 *
 * Idempotent: skips a product whose family_id is already NULL.
 *
 * Usage:
 *   node scripts/correct-notification-appliance-accessory-false-positives.mjs <db-path> --dry-run
 *   node scripts/correct-notification-appliance-accessory-false-positives.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-notification-appliance-accessory-false-positives.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const TARGETS = [
  "LENS-A", "LENS-AC", "LENS-B", "LENS-BC", "LENS-G", "LENS-GC", "LENS-R", "LENS-RC",
  "STI1210D", "WTP", "WTP-SPW", "WTPW",
];

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
  for (const partNumber of TARGETS) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    if (!product.family_id) { console.log(`SKIP (already unclassified): ${partNumber}`); skipped += 1; continue; }
    if (!["Strobe", "Sounder/Strobe", "Speaker/Strobe"].includes(product.currentFamilyName)) { console.log(`SKIP (not currently a notification device family, re-check manually): ${partNumber} -> ${product.currentFamilyName}`); skipped += 1; continue; }
    console.log(`${apply ? "CLEAR" : "WOULD CLEAR"}: ${partNumber} | "${product.description.slice(0, 70)}..." | ${product.currentFamilyName} -> (none)`);
    if (apply) clearFamily.run(product.id);
    cleared += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${cleared} product${cleared === 1 ? "" : "s"} ${apply ? "cleared" : "would be cleared"} back to unclassified, ${skipped} skipped.`);
