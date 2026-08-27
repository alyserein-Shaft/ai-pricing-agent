#!/usr/bin/env node
/**
 * Fire Alarm E2E fix (Product Knowledge gap closure) -- real Central Kitchen
 * - Makkah gap: of the Beam Detector family's four active SKUs, three
 * (OSI-R-SS, 6500RE, 6500RSE) already carry device_type + addressing +
 * beam_range + remote_test_capability, correctly distinguishing conventional
 * vs addressable, reflective-imaging vs reflective-IR, and range/test
 * installation type. Only OSI-RI-FH was missing beam_range and
 * remote_test_capability, and its existing device_type/addressing facts cited
 * OSI-R-SS's own document (Doc BMDS904) -- the CONVENTIONAL reflective-imaging
 * sibling, an odd source for an "Intelligent" (addressable) device.
 *
 * A better, already-cached official document exists for the correct
 * platform: System Sensor "OSI-RI-SS, OSI-RI-AP: Intelligent Reflective
 * Imaging Beam Smoke Detectors" (Doc BMDS907-04, 10/13/2022) -- the
 * INTELLIGENT/addressable "OSI-RI-" reflective imaging platform OSI-RI-FH's
 * own part number actually belongs to (shared prefix, addressable variant),
 * unlike OSI-R-SS's conventional "OSI-R-" platform. This document does NOT
 * name "OSI-RI-FH" explicitly (checked: "FH" does not appear anywhere in it)
 * -- so this remains a shared-platform inference, not a confirmed exact-SKU
 * match, and the existing confidence level (70) and its honest caveat are
 * preserved, not inflated. What changes is citing the platform-correct
 * document instead of the wrong (conventional) one, and adding two facts
 * this document actually states for the shared OSI-RI optical platform:
 *
 * - Protection Range: "16 ft to 328 ft (5 m to 100 m)" (identical span to
 *   OSI-R-SS's own recorded beam_range -- the same physical optics/reflector
 *   platform).
 * - Test/Reset Features: "Local alarm test switch, local alarm reset
 *   switch, Remote test and reset switch (Compatible with RTS151 and
 *   RTS151KEY(-A) test stations), OSID-R test filter" plus "Built-in imager
 *   heater is standard" -- matching OSI-R-SS's own recorded
 *   remote_test_capability almost verbatim.
 *
 * Per explicit instruction, protocol and standards are deliberately NOT
 * added for OSI-RI-FH: this document mentions only generic "SLC loop"
 * current-draw limits, never confirming IDP or any other specific protocol,
 * and lists no UL/CSFM/MEA listing for the -FH variant specifically -- both
 * remain genuine, reported, unresolved gaps.
 *
 * No other attribute, no other family, and no other SKU is touched.
 *
 * Idempotent: skips if beam_range/remote_test_capability are already present,
 * and only re-points the existing device_type/addressing source citation if
 * it is still the old OSI-R-SS document reference.
 *
 * Usage:
 *   node scripts/seed-osi-ri-fh-beam-detector-attributes.mjs <db-path> --dry-run
 *   node scripts/seed-osi-ri-fh-beam-detector-attributes.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-osi-ri-fh-beam-detector-attributes.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();
const PART_NUMBER = "OSI-RI-FH";

const DOC = {
  sourceType: "Manufacturer Official Datasheet",
  sourceId: "System Sensor \"OSI-RI-SS, OSI-RI-AP: Intelligent Reflective Imaging Beam Smoke Detectors\" (Doc BMDS907-04, 10/13/2022)",
  url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/BMDS907.pdf",
};
const CAVEAT_SECTION = "(inferred from the shared OSI-RI intelligent reflective-imaging beam platform; no document specific to the -FH Farenhyt variant located this sprint)";
const OLD_SOURCE_ID_FRAGMENT = "OSI-R-SS, OSI-RA-SS";

const NEW_ATTRIBUTES = [
  { name: "beam_range", operator: "Informational", normalizedValue: "16-328 ft (5-100m)", confidence: 70, sourceText: "Protection Range 16 ft to 328 ft (5 m to 100 m)" },
  { name: "remote_test_capability", operator: "Informational", normalizedValue: "Local alarm test/reset switch; remote test and reset switch compatible with RTS151 and RTS151KEY(-A) test stations; OSID-R test filter; built-in imager heater standard", confidence: 70, sourceText: "Test/Reset Features: Local alarm test switch, local alarm reset switch, Remote test and reset switch (Compatible with RTS151 and RTS151KEY(-A) test stations), OSID-R test filter." },
];

const getProduct = db.prepare("SELECT id, part_number, attributes FROM library_products WHERE part_number = ? AND identity_status = 'Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let added = 0, skipped = 0, recited = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  const product = getProduct.get(PART_NUMBER);
  if (!product) throw new Error(`Product not found: ${PART_NUMBER}`);
  let attributes = JSON.parse(product.attributes || "[]");

  // Re-point the existing device_type/addressing citations to the
  // platform-correct intelligent OSI-RI document, without changing their
  // values or confidence.
  attributes = attributes.map((entry) => {
    if (!["device_type", "addressing"].includes(norm(entry.name))) return entry;
    if (!String(entry.source?.sourceId || "").includes(OLD_SOURCE_ID_FRAGMENT)) return entry;
    console.log(`${apply ? "RE-CITE" : "WOULD RE-CITE"}: ${PART_NUMBER} -> ${entry.name} (source: OSI-R-SS conventional doc -> OSI-RI-SS/AP intelligent doc)`);
    recited += 1;
    return { ...entry, source: { ...entry.source, sourceId: DOC.sourceId, url: DOC.url, section: CAVEAT_SECTION } };
  });

  const existingNames = new Set(attributes.map((entry) => norm(entry.name)));
  for (const fact of NEW_ATTRIBUTES) {
    if (existingNames.has(norm(fact.name))) { console.log(`SKIP (already present): ${PART_NUMBER} -> ${fact.name}`); skipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${PART_NUMBER} -> ${fact.name} = ${JSON.stringify(fact.normalizedValue)}`);
    attributes.push({ name: fact.name, operator: fact.operator, normalizedValue: fact.normalizedValue, confidence: fact.confidence, sourceText: fact.sourceText, source: { sourceType: DOC.sourceType, sourceId: DOC.sourceId, url: DOC.url, page: 2, section: CAVEAT_SECTION } });
    added += 1;
  }

  if (apply) updateAttributes.run(JSON.stringify(attributes), product.id);
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${added} attribute${added === 1 ? "" : "s"} added, ${recited} re-cited to the platform-correct document, ${skipped} skipped.`);
