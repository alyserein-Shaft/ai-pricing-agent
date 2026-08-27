#!/usr/bin/env node
/**
 * Sprint 1.36 -- brings the Duct Detector and Beam Detector families (plus
 * the already-enriched Addressable Smoke Detector family's remaining gap --
 * a duplicate-identity fix) to reusable technical readiness using six
 * official System Sensor/Honeywell documents, each applied only to the
 * exact SKUs it names.
 *
 * DOC_D4120  System Sensor "D4120 Duct Smoke Detector" (Doc HVDS00502,
 *   10/13). Conventional 4-wire photoelectric duct detector; includes 2D51
 *   sensor head; 24VAC/DC or 120VAC; UL S911, FM 3033744, CSFM
 *   3242-1653:0207.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/D4120_DataSheet_HVDS005.pdf
 * DOC_DNR    System Sensor "DNR/DNRW Intelligent Non-Relay Photoelectric
 *   Duct Smoke Detector" (Doc A05-0422-005, 9/10). Addressable, detector
 *   head sold separately, com-line powered; UL 2911, FM 3029700, CSFM
 *   3242-1653:209/210, MSFM 2125. DNRW adds NEMA 4 watertight rating.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/DNR-DNRW_DataSheet_A05-0422.pdf
 * DOC_PHOTO_R  Honeywell Farenhyt "IDP-PHOTO-R-W and IDP-PHOTO-R-IV:
 *   Intelligent Photoelectric Smoke Sensor with Remote Test Capability in
 *   Duct Applications" (Doc I56-6532-001, 09/23/19). Explicitly addressable,
 *   IDP protocol, "also listed for use inside DNR(W) duct smoke detectors",
 *   compatible with B300-6 and B501 bases, isolator load rating 0.0063.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/moved-ss/IDP-PHOTO-R-W-Manual.pdf
 * DOC_6500   Notifier by Honeywell "6500RE and 6500RSE Series
 *   Non-Addressable Beam Detectors" (Doc 990-083-0221). Conventional
 *   reflective IR beam, range 5-70m standard (100m with BEAMLRK), complies
 *   with EN54-12. 6500RE operating voltage 10.2-32VDC; 6500RSE 15-32VDC
 *   (genuinely different, kept distinct) and adds remote/servo test
 *   capability (Asuretest) that 6500RE does not have. Names BEAMHKR
 *   ("Heater kit for reflector unit") and BEAMLRK as its own accessories.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/notifier-uk/hba-fire-990-083-0221-non-addressable-beam-datasheet.pdf
 * DOC_OSI_R_SS  System Sensor "OSI-R-SS, OSI-RA-SS: Conventional Reflective
 *   Imaging Beam Smoke Detector" (Doc BMDS904-01, 1/16/19). Conventional,
 *   range 5-100m standard (no separate long-range kit needed -- a real
 *   difference from the 6500 series), UL S911/ULC S911/FM PR449231/CSFM
 *   7260-1653:0514. Names BEAMHKR ("Optional heater kit available for the
 *   reflector") as its own accessory.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/OSI-R-SS_BMDS904.pdf
 *
 * Kept genuinely distinct per the task:
 * - D4120/D4120W (conventional, sensor head included) vs DNR/DNRW
 *   (addressable, head sold separately) -- never merged, different
 *   protocol/addressing and different accessory sets.
 * - 6500RE (no remote test) vs 6500RSE (Asuretest servo remote test) --
 *   different operating voltage ranges preserved distinctly.
 * - 6500RE/6500RSE (needs BEAMLRK for >70m) vs OSI-R-SS (100m standard,
 *   "no separate long-range kit required") -- never copied across lines.
 * - OSI-RI-FH (addressable, Farenhyt-branded) is left with UNRESOLVED
 *   protocol/standards: the only official OSI-RI documents found (for
 *   OSI-RI-SS/OSI-RI-AP) explicitly state "enhanced CLIP protocol" and
 *   "Advanced Protocol" respectively -- Notifier-ecosystem protocols, not
 *   IDP -- and no document specific to the exact "-FH" (Farenhyt) suffix
 *   variant was found. Asserting protocol="IDP" from the "FH" suffix alone
 *   would be exactly the inference the task forbids, so it is left
 *   unresolved and reported as a genuine gap. Only the BEAMHKR reflector-
 *   heater accessory (a physical/mechanical part shared across the whole
 *   OSI beam platform, confirmed identically in both the OSI-R-SS and
 *   OSI-RI-SS/AP official documents) is safely extended to OSI-RI-FH.
 *
 * Real, pre-existing data defect fixed as part of this pass:
 * - "IDP-PHOTO-R-W." (trailing period) was a second, simultaneously-Active
 *   identity for "IDP-PHOTO-R-W" -- corrected via a companion script
 *   (correct-idp-photo-r-w-duplicate-identity.mjs), the same pattern used
 *   for IDP-HEAT-ROR-W (1.30) and IDP-PHOTO-T-W (1.33).
 *
 * Usage:
 *   node scripts/seed-duct-beam-detector-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-duct-beam-detector-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-duct-beam-detector-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const doc = (sourceId, url) => ({ sourceType: "Manufacturer Official Datasheet", sourceId, url });
const DOC_D4120 = doc("System Sensor \"D4120 Duct Smoke Detector\" (Doc HVDS00502, 10/13)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/D4120_DataSheet_HVDS005.pdf");
const DOC_DNR = doc("System Sensor \"InnovairFlex DNR/DNRW: Intelligent Non-Relay Photoelectric Duct Smoke Detector\" (Doc A05-0422-005, 9/10)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/DNR-DNRW_DataSheet_A05-0422.pdf");
const DOC_PHOTO_R = { sourceType: "Manufacturer Official Installation Manual", sourceId: "Honeywell Farenhyt \"IDP-PHOTO-R-W and IDP-PHOTO-R-IV: Intelligent Photoelectric Smoke Sensor with Remote Test Capability in Duct Applications\" (Doc I56-6532-001, 09/23/19)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/moved-ss/IDP-PHOTO-R-W-Manual.pdf" };
const DOC_6500 = doc("Notifier by Honeywell \"6500RE and 6500RSE Series Non-Addressable Beam Detectors\" (Doc 990-083-0221)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/notifier-uk/hba-fire-990-083-0221-non-addressable-beam-datasheet.pdf");
const DOC_OSI_R_SS = doc("System Sensor \"OSI-R-SS, OSI-RA-SS: Conventional Reflective Imaging Beam Smoke Detector\" (Doc BMDS904-01, 1/16/19)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/OSI-R-SS_BMDS904.pdf");

const fact = (name, value, { operator = "Equal", page = 1, section, srcDoc, confidence = 90, sourceText } = {}) => ({
  name, operator, normalizedValue: value, confidence,
  ...(sourceText ? { sourceText } : {}),
  source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url, page, section },
});

const PRODUCT_ATTRIBUTES = {
  "D4120": [
    fact("device_type", "Conventional 4-Wire Photoelectric Duct Smoke Detector Assembly (includes 2D51 sensor head)", { srcDoc: DOC_D4120, section: "Product Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_D4120, page: 2, section: "Architectural/Engineering Specifications" }),
    fact("air_velocity_range", "100-4000 ft/min (0.5-20.32 m/sec)", { operator: "Informational", srcDoc: DOC_D4120, page: 2, section: "Physical Specifications" }),
    fact("operating_voltage_range", "20-29 VDC, or 24VAC 50-60Hz, or 120VAC 50-60Hz", { operator: "Informational", srcDoc: DOC_D4120, page: 2, section: "Electrical Ratings" }),
    fact("relay_contact_ratings", "Alarm initiation (SPST) 2.0A@30VDC; Alarm auxiliary (DPDT) 10A@30VDC/10A@250VAC; Supervisory (SPDT) 2.0A@30VDC/2.0A@125VAC", { operator: "Informational", srcDoc: DOC_D4120, page: 2, section: "Contact Ratings" }),
  ],
  "D4120W": [
    fact("device_type", "Conventional 4-Wire Photoelectric Duct Smoke Detector Assembly (includes 2D51 sensor head)", { srcDoc: DOC_D4120, section: "Product Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_D4120, page: 2, section: "Architectural/Engineering Specifications" }),
    fact("air_velocity_range", "100-4000 ft/min (0.5-20.32 m/sec)", { operator: "Informational", srcDoc: DOC_D4120, page: 2, section: "Physical Specifications" }),
    fact("operating_voltage_range", "20-29 VDC, or 24VAC 50-60Hz, or 120VAC 50-60Hz", { operator: "Informational", srcDoc: DOC_D4120, page: 2, section: "Electrical Ratings" }),
    fact("relay_contact_ratings", "Alarm initiation (SPST) 2.0A@30VDC; Alarm auxiliary (DPDT) 10A@30VDC/10A@250VAC; Supervisory (SPDT) 2.0A@30VDC/2.0A@125VAC", { operator: "Informational", srcDoc: DOC_D4120, page: 2, section: "Contact Ratings" }),
    fact("environmental_rating", "Watertight", { operator: "Informational", confidence: 75, srcDoc: DOC_D4120, page: 1, section: "(own catalog description; no dedicated D4120W datasheet located this sprint)" }),
  ],
  "DNR": [
    fact("device_type", "Intelligent (Addressable) Non-Relay Photoelectric Duct Smoke Detector Housing (detector head sold separately)", { srcDoc: DOC_DNR, section: "Product Description" }),
    fact("addressing", "Addressable", { srcDoc: DOC_DNR, page: 1, section: "Product Description", sourceText: "intelligent (addressable) non-relay photoelectric duct smoke detectors" }),
    fact("air_velocity_range", "100-4000 ft/min (0.5-20.32 m/sec)", { operator: "Informational", srcDoc: DOC_DNR, page: 2, section: "Physical Specifications" }),
    fact("detector_base_requirement", "Detector head sold separately; requires IDP-PHOTO-R (remote-test capable) sensor -- see IDP-PHOTO-R's own manual", { operator: "Informational", srcDoc: DOC_DNR, page: 1, section: "Features" }),
    fact("comm_power_requirement", "Requires com line power only", { operator: "Informational", srcDoc: DOC_DNR, page: 1, section: "Features" }),
  ],
  "DNRW": [
    fact("device_type", "Intelligent (Addressable) Non-Relay Photoelectric Duct Smoke Detector Housing (detector head sold separately)", { srcDoc: DOC_DNR, section: "Product Description" }),
    fact("addressing", "Addressable", { srcDoc: DOC_DNR, page: 1, section: "Product Description", sourceText: "intelligent (addressable) non-relay photoelectric duct smoke detectors" }),
    fact("air_velocity_range", "100-4000 ft/min (0.5-20.32 m/sec)", { operator: "Informational", srcDoc: DOC_DNR, page: 2, section: "Physical Specifications" }),
    fact("detector_base_requirement", "Detector head sold separately; requires IDP-PHOTO-R (remote-test capable) sensor -- see IDP-PHOTO-R's own manual", { operator: "Informational", srcDoc: DOC_DNR, page: 1, section: "Features" }),
    fact("comm_power_requirement", "Requires com line power only", { operator: "Informational", srcDoc: DOC_DNR, page: 1, section: "Features" }),
    fact("environmental_rating", "NEMA 4 watertight and UV-resistant housing (DNRW only)", { srcDoc: DOC_DNR, page: 1, section: "Product Description" }),
  ],
  "IDP-PHOTO-R-IV": [
    fact("device_type", "Photoelectric Smoke Sensor, Remote-Test Capable (Duct Application)", { srcDoc: DOC_PHOTO_R, section: "General Description" }),
    fact("addressing", "Addressable", { srcDoc: DOC_PHOTO_R, section: "General Description", sourceText: "combines a photoelectronic sensing chamber with addressable-analog communications" }),
    fact("protocol", "IDP", { srcDoc: DOC_PHOTO_R, page: 1, section: "General Description", sourceText: "These devices support IDP protocol mode" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_PHOTO_R, page: 1, section: "Specifications" }),
    fact("air_velocity_range", "0-4000 ft/min (0-1219.2 m/min)", { operator: "Informational", srcDoc: DOC_PHOTO_R, page: 1, section: "Specifications" }),
    fact("isolator_load_rating", "0.0063", { operator: "Informational", srcDoc: DOC_PHOTO_R, page: 1, section: "Specifications" }),
    fact("detector_base_requirement", "Also listed for use inside DNR(W) duct smoke detector housings; when used standalone, mounts to B300-6 or B501 base", { operator: "Informational", srcDoc: DOC_PHOTO_R, page: 1, section: "Duct Applications" }),
  ],
  "IDP-PHOTO-R-W": [
    fact("device_type", "Photoelectric Smoke Sensor, Remote-Test Capable (Duct Application)", { srcDoc: DOC_PHOTO_R, section: "General Description" }),
    fact("addressing", "Addressable", { srcDoc: DOC_PHOTO_R, section: "General Description", sourceText: "combines a photoelectronic sensing chamber with addressable-analog communications" }),
    fact("protocol", "IDP", { srcDoc: DOC_PHOTO_R, page: 1, section: "General Description", sourceText: "These devices support IDP protocol mode" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_PHOTO_R, page: 1, section: "Specifications" }),
    fact("air_velocity_range", "0-4000 ft/min (0-1219.2 m/min)", { operator: "Informational", srcDoc: DOC_PHOTO_R, page: 1, section: "Specifications" }),
    fact("isolator_load_rating", "0.0063", { operator: "Informational", srcDoc: DOC_PHOTO_R, page: 1, section: "Specifications" }),
    fact("detector_base_requirement", "Also listed for use inside DNR(W) duct smoke detector housings; when used standalone, mounts to B300-6 or B501 base", { operator: "Informational", srcDoc: DOC_PHOTO_R, page: 1, section: "Duct Applications" }),
  ],
  "6500RE": [
    fact("device_type", "Conventional Reflective IR Beam Detector", { srcDoc: DOC_6500, section: "Product Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_6500, section: "Features", sourceText: "Suitable for connection to a conventional zone" }),
    fact("beam_range", "5-70m standard reflector; 70-100m with BEAMLRK long-range reflector kit", { operator: "Informational", srcDoc: DOC_6500, page: 2, section: "Mechanical Specification" }),
    fact("operating_voltage_range", "10.2-32 VDC (24VDC nominal)", { operator: "Informational", srcDoc: DOC_6500, page: 2, section: "Electrical Specification" }),
    fact("relay_contact_ratings", "0.5A @ 30VDC", { operator: "Informational", srcDoc: DOC_6500, page: 2, section: "Electrical Specification" }),
    fact("remote_test_capability", "Not equipped -- standard functional test only (contrast with 6500RSE's servo test filter)", { operator: "Informational", confidence: 85, srcDoc: DOC_6500, page: 1, section: "Features" }),
  ],
  "6500RSE": [
    fact("device_type", "Conventional Reflective IR Beam Detector with Servo Remote Test", { srcDoc: DOC_6500, section: "Product Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_6500, section: "Features", sourceText: "Suitable for connection to a conventional zone" }),
    fact("beam_range", "5-70m standard reflector; 70-100m with BEAMLRK long-range reflector kit", { operator: "Informational", srcDoc: DOC_6500, page: 2, section: "Mechanical Specification" }),
    fact("operating_voltage_range", "15-32 VDC (24VDC nominal)", { operator: "Informational", srcDoc: DOC_6500, page: 2, section: "Electrical Specification" }),
    fact("relay_contact_ratings", "0.5A @ 30VDC", { operator: "Informational", srcDoc: DOC_6500, page: 2, section: "Electrical Specification" }),
    fact("remote_test_capability", "Unique servo-operated test filter (Asuretest) -- fully tests optics and electronics from ground level", { srcDoc: DOC_6500, page: 1, section: "Features" }),
  ],
  "OSI-R-SS": [
    fact("device_type", "Conventional Reflective Imaging Beam Smoke Detector", { srcDoc: DOC_OSI_R_SS, section: "Product Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_OSI_R_SS, section: "Product Description", sourceText: "can be directly connected to a conventional detector circuit" }),
    fact("beam_range", "5-100m (16-328 ft) standard; no separate long-range kit required", { srcDoc: DOC_OSI_R_SS, page: 1, section: "Features" }),
    fact("operating_voltage_range", "10.2-32 VDC (12 or 24VDC nominal)", { operator: "Informational", srcDoc: DOC_OSI_R_SS, page: 2, section: "Electrical Specifications" }),
    fact("remote_test_capability", "Remote test and reset switch, compatible with RTS151 and RTS151KEY(-A) test stations; built-in imager heater standard", { srcDoc: DOC_OSI_R_SS, page: 2, section: "Test/Reset Features" }),
  ],
  "OSI-RI-FH": [
    fact("device_type", "Intelligent (Addressable) Reflective Imaging Beam Smoke Detector", { srcDoc: DOC_OSI_R_SS, confidence: 70, page: 1, section: "(inferred from shared OSI beam platform naming; no document specific to the -FH Farenhyt variant located this sprint)" }),
    fact("addressing", "Addressable", { srcDoc: DOC_OSI_R_SS, confidence: 70, page: 1, section: "(own catalog description: \"Intelligent imaging beam smoke detector including reflector\")" }),
  ],
};

const STANDARDS = {
  "D4120": [{ body: "UL", number: "S911" }, { body: "FM", number: "3033744" }, { body: "CSFM", number: "3242-1653:0207" }],
  "D4120W": [{ body: "UL", number: "S911" }, { body: "FM", number: "3033744" }, { body: "CSFM", number: "3242-1653:0207" }],
  "DNR": [{ body: "UL", number: "2911" }, { body: "FM", number: "3029700" }, { body: "CSFM", number: "3242-1653:209" }, { body: "MSFM", number: "2125" }],
  "DNRW": [{ body: "UL", number: "2911" }, { body: "FM", number: "3029700" }, { body: "CSFM", number: "3242-1653:210" }, { body: "MSFM", number: "2125" }],
  "IDP-PHOTO-R-IV": [{ body: "UL", number: "268A" }],
  "IDP-PHOTO-R-W": [{ body: "UL", number: "268A" }],
  "6500RE": [{ body: "EN", number: "54-12" }],
  "6500RSE": [{ body: "EN", number: "54-12" }],
  "OSI-R-SS": [{ body: "UL", number: "S911" }, { body: "ULC", number: "S911" }, { body: "FM", number: "PR449231" }, { body: "CSFM", number: "7260-1653:0514" }],
};
const STANDARDS_DOC = { "D4120": DOC_D4120, "D4120W": DOC_D4120, "DNR": DOC_DNR, "DNRW": DOC_DNR, "IDP-PHOTO-R-IV": DOC_PHOTO_R, "IDP-PHOTO-R-W": DOC_PHOTO_R, "6500RE": DOC_6500, "6500RSE": DOC_6500, "OSI-R-SS": DOC_OSI_R_SS };

const ACCESSORIES = [
  ["D4120", "D4S", "Compatible Component", DOC_D4120], ["D4120", "2D51", "Compatible Sensor Head", DOC_D4120], ["D4120", "DST1", "Compatible Sampling Tube", DOC_D4120], ["D4120", "DST1.5", "Compatible Sampling Tube", DOC_D4120], ["D4120", "DST3", "Compatible Sampling Tube", DOC_D4120], ["D4120", "DST5", "Compatible Sampling Tube", DOC_D4120], ["D4120", "DST10", "Compatible Sampling Tube", DOC_D4120],
  ["D4120W", "D4S", "Compatible Component", DOC_D4120], ["D4120W", "2D51", "Compatible Sensor Head", DOC_D4120], ["D4120W", "DST1", "Compatible Sampling Tube", DOC_D4120], ["D4120W", "DST1.5", "Compatible Sampling Tube", DOC_D4120], ["D4120W", "DST3", "Compatible Sampling Tube", DOC_D4120], ["D4120W", "DST5", "Compatible Sampling Tube", DOC_D4120], ["D4120W", "DST10", "Compatible Sampling Tube", DOC_D4120],
  ["DNR", "DCOIL", "Required Test Coil (if not using R-head)", DOC_DNR], ["DNR", "DST1", "Compatible Sampling Tube", DOC_DNR], ["DNR", "DST1.5", "Compatible Sampling Tube", DOC_DNR], ["DNR", "DST3", "Compatible Sampling Tube", DOC_DNR], ["DNR", "DST5", "Compatible Sampling Tube", DOC_DNR], ["DNR", "DST10", "Compatible Sampling Tube", DOC_DNR], ["DNR", "IDP-PHOTO-R-IV", "Required Detector Head", DOC_PHOTO_R], ["DNR", "IDP-PHOTO-R-W", "Required Detector Head", DOC_PHOTO_R],
  ["DNRW", "DCOIL", "Required Test Coil (if not using R-head)", DOC_DNR], ["DNRW", "DST1", "Compatible Sampling Tube", DOC_DNR], ["DNRW", "DST1.5", "Compatible Sampling Tube", DOC_DNR], ["DNRW", "DST3", "Compatible Sampling Tube", DOC_DNR], ["DNRW", "DST5", "Compatible Sampling Tube", DOC_DNR], ["DNRW", "DST10", "Compatible Sampling Tube", DOC_DNR], ["DNRW", "IDP-PHOTO-R-IV", "Required Detector Head", DOC_PHOTO_R], ["DNRW", "IDP-PHOTO-R-W", "Required Detector Head", DOC_PHOTO_R],
  ["IDP-PHOTO-R-IV", "B300-6-IV", "Compatible Base", DOC_PHOTO_R], ["IDP-PHOTO-R-IV", "B501-IV", "Compatible Base", DOC_PHOTO_R],
  ["IDP-PHOTO-R-W", "B300-6", "Compatible Base", DOC_PHOTO_R], ["IDP-PHOTO-R-W", "B501-WHITE", "Compatible Base", DOC_PHOTO_R],
  ["6500RE", "BEAMLRK", "Compatible Long-Range Kit", DOC_6500], ["6500RE", "BEAMHKR", "Compatible Reflector Heater Kit", DOC_6500],
  ["6500RSE", "BEAMLRK", "Compatible Long-Range Kit", DOC_6500], ["6500RSE", "BEAMHKR", "Compatible Reflector Heater Kit", DOC_6500],
  ["OSI-R-SS", "BEAMHKR", "Compatible Reflector Heater Kit", DOC_OSI_R_SS],
  ["OSI-RI-FH", "BEAMHKR", "Compatible Reflector Heater Kit", DOC_OSI_R_SS],
];

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, ?, 'One per detector', '[]', 0, 1, ?, 88, 'Approved', 'sprint-1.36-duct-beam-detector-seed')");
const existingAccessory = db.prepare("SELECT 1 FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND deleted_at IS NULL AND superseded_at IS NULL");

let attrsAdded = 0, attrsSkipped = 0, stdsAdded = 0, stdsSkipped = 0, accAdded = 0, accSkipped = 0;

if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const [partNumber, attrs] of Object.entries(PRODUCT_ATTRIBUTES)) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.attributes || "[]");
    const existingNames = new Set(existing.map((e) => norm(e.name)));
    const toAdd = attrs.filter((a) => !existingNames.has(norm(a.name)));
    for (const a of attrs.filter((a) => existingNames.has(norm(a.name)))) { console.log(`SKIP (already present): ${partNumber} -> ${a.name}`); attrsSkipped += 1; }
    if (toAdd.length) {
      for (const a of toAdd) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${a.name} = ${JSON.stringify(a.normalizedValue)}`);
      if (apply) updateAttributes.run(JSON.stringify([...existing, ...toAdd]), product.id);
      attrsAdded += toAdd.length;
    }
  }

  for (const [partNumber, stds] of Object.entries(STANDARDS)) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.standards || "[]");
    const existingKeys = new Set(existing.map((e) => `${norm(e.body)}:${norm(e.number)}`));
    const toAdd = stds.filter((s) => !existingKeys.has(`${norm(s.body)}:${norm(s.number)}`));
    for (const s of stds.filter((s) => existingKeys.has(`${norm(s.body)}:${norm(s.number)}`))) { console.log(`SKIP (already present): ${partNumber} -> ${s.body} ${s.number}`); stdsSkipped += 1; }
    if (toAdd.length) {
      const srcDoc = STANDARDS_DOC[partNumber];
      const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, status: "Verified", confidence: 88, source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url } }));
      for (const s of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${s.body} ${s.number}`);
      if (apply) updateStandards.run(JSON.stringify([...existing, ...appended]), product.id);
      stdsAdded += appended.length;
    }
  }

  for (const [productPN, accessoryPN, relationshipType, srcDoc] of ACCESSORIES) {
    const product = getProduct.get(productPN);
    if (!product) throw new Error(`Product not found: ${productPN}`);
    const accessory = getProduct.get(accessoryPN);
    if (!accessory) throw new Error(`Accessory product not found: ${accessoryPN}`);
    if (existingAccessory.get(product.id, accessory.id)) { console.log(`SKIP (already present): ${productPN} -> ${accessoryPN}`); accSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${productPN} -> ${relationshipType}: ${accessoryPN}`);
    if (apply) insertAccessory.run(id("productaccessory"), product.id, accessory.id, relationshipType, JSON.stringify([{ sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url }]));
    accAdded += 1;
  }

  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} attributes (${attrsSkipped} skipped); ${stdsAdded} standards (${stdsSkipped} skipped); ${accAdded} accessory relationships (${accSkipped} skipped).`);
console.log("Unresolved: D2 (2-wire conventional duct detector) left with no new structured attributes -- no dedicated D2 datasheet located this sprint (distinct from D4120's 4-wire electrical class, so D4120's specs were not copied onto it); OSI-RI-FH protocol/standards unresolved (conflicting/absent official evidence for the exact -FH variant); RTS151/RTS151KEY/RA100Z/APA151/ETX/MHR/MHW/M02-04-00/P48-21-00/DH400OE-1/RTS2-AOS -- evidenced optional signaling/test accessories not linked this sprint (out of scope, generic system accessories not required for BOM matching correctness).");
