#!/usr/bin/env node
/**
 * Sprint 1.36 -- removes three real, existing misclassifications found
 * while auditing Conventional Detector and Beam Detector:
 * - B401 ("Detector mounting base. For conventional detectors.") was
 *   assigned family_id = Conventional Detector, solely because its own
 *   description names the category of detector it accompanies -- B401 is a
 *   mounting base, not a detector itself.
 * - BEAMHKR ("Beam Detector Heater Kit for reflectors...") and STI9625
 *   ("STI Beam detector guard; Use with 6424") were both assigned
 *   family_id = Beam Detector, solely because their own descriptions name
 *   the beam detector they accompany -- both are accessories (a reflector
 *   heater kit and a detector guard/cage), never the detector itself.
 *
 * classifyFireAlarmFamilyFromText now correctly returns null for all three
 * (see the isAccessoryForCategoryMention / isDetectorAccessorySuffixMention
 * guards added to fire-alarm-taxonomy.mjs this same sprint, which also
 * confirmed BEAMLRK/BEAMMMK/BEAMSMK -- three other beam accessory kits --
 * were already correctly unclassified and remain so) -- but the existing
 * correct-farenhyt-family-classification.mjs script only ever ADDS or
 * CHANGES a family_id when the classifier confidently proposes a
 * *different* one; it deliberately skips when the classifier returns null,
 * so it cannot remove a stale, now-disproven classification on its own.
 * This is a narrow, one-time, manually-reviewed removal for exactly these
 * three already-identified false positives.
 *
 * Sets family_id back to NULL (unclassified) rather than guessing a
 * different family -- these are genuine accessories with no dedicated
 * "detector accessory" family declared today.
 *
 * Idempotent: skips a product whose family_id is already NULL.
 *
 * Usage:
 *   node scripts/correct-conventional-beam-detector-family-false-positives.mjs <db-path> --dry-run
 *   node scripts/correct-conventional-beam-detector-family-false-positives.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { classifyFireAlarmFamilyFromText } from "../app/domain/fire-alarm-taxonomy.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: correct-conventional-beam-detector-family-false-positives.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);

const TARGETS = [
  { partNumber: "B401", expectedFamily: "Conventional Detector" },
  { partNumber: "BEAMHKR", expectedFamily: "Beam Detector" },
  { partNumber: "STI9625", expectedFamily: "Beam Detector" },
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
  for (const { partNumber, expectedFamily } of TARGETS) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    if (!product.family_id) { console.log(`SKIP (already unclassified): ${partNumber}`); skipped += 1; continue; }
    if (product.currentFamilyName !== expectedFamily) { console.log(`SKIP (not currently ${expectedFamily}, re-check manually): ${partNumber} -> ${product.currentFamilyName}`); skipped += 1; continue; }
    const reclassified = classifyFireAlarmFamilyFromText(product.description);
    console.log(`${apply ? "CLEAR" : "WOULD CLEAR"}: ${partNumber} | "${product.description.slice(0, 70)}..." | ${expectedFamily} -> (none)${reclassified ? ` [classifier now proposes ${reclassified.family}]` : ""}`);
    if (apply) clearFamily.run(product.id);
    cleared += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${cleared} product${cleared === 1 ? "" : "s"} ${apply ? "cleared" : "would be cleared"} back to unclassified, ${skipped} skipped.`);
