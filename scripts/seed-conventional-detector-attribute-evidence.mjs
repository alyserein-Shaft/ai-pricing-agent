#!/usr/bin/env node
/**
 * Sprint 1.37 -- brings the newly-classified Conventional Detector family
 * (10 SKUs: 2151, 2151-CH, 2151T, 2351/EC, 2351TEM, 5151, 5151-CH, 5351E,
 * JTY-GD-2151EIS, JTWB-BCD-5151EIS) to reusable technical readiness using
 * four official documents, each applied only to the exact SKUs it names or
 * (for the Series 300 siblings) explicitly identifies as sharing the same
 * architecture.
 *
 * DOC_1151_2151  Fire-Lite/System Sensor "1151 and 2151: Low-Profile
 *   Plug-In Photoelectric and Ionization Smoke Detectors" (Doc DF-51483,
 *   6/30/98). Explicitly conventional ("Section: Conventional Initiating
 *   Devices"). Names B401 as one of four compatible adapter bases.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/df-51483.pdf
 * DOC_5151  System Sensor "5151 Plug-In Heat Detector" installation manual
 *   (Doc I56-5151-001, SS-400-011). Explicitly "conventional 2-wire thermal
 *   detector." Fixed 135°F / 15°F/min rate-of-rise, UL 521, FM 3210 RTI FAST.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/5151_Manual_I56-5151.pdf
 * DOC_2351EC  System Sensor "2351EC: Conventional Photoelectric Smoke
 *   Detector" datasheet (Doc DS2351EC-15, 2015). Its own "Other Devices in
 *   range" line explicitly names 2351TEM and 5351E as siblings sharing this
 *   Series 300 conventional platform -- the shared architecture facts
 *   (conventional, 8-30VDC, B401-family base compatibility) are applied to
 *   all three, but 2351EC's own specific EN54-7:2000/LPCB/CE-0832
 *   certificate number is NOT copied onto 2351TEM/5351E without their own
 *   confirmation.
 *   https://www.honeywellbuildings.in/uploads/fire_safety/product/doc/16068035772351EC.pdf
 * DOC_EIS  System Sensor "JTY-GD-2151EIS Photoelectric / JTWB-BCD-5151EIS
 *   Thermal: Intrinsically Safe Detectors" combined datasheet (Doc
 *   S2-1525-002_B). Both explicitly "conventional" per their own General
 *   Description; Exia II CT6 intrinsic safety rating; "for use with 2-wire
 *   control panels via interface module" (generic, panel-agnostic -- never
 *   Farenhyt-specific). JTWB-BCD-5151EIS's own sensitivity (63°C fixed /
 *   10°C/min rate-of-rise) is genuinely different from 5151's (135°F/57°C,
 *   15°F/min) and kept distinct, not merged.
 *   https://www.honeywellbuildings.in/assets/datasheet/fire/sensor/2151EIS_5151EIS.pdf
 *
 * Kept genuinely distinct per the task:
 * - Every product here is CONVENTIONAL, never addressable -- confirmed
 *   individually by each product line's own official document, not assumed
 *   from the absence of an "IDP" prefix.
 * - Smoke-only (2151, 2151-CH, 2351/EC, JTY-GD-2151EIS) vs heat-only (5151,
 *   5151-CH, 5351E, JTWB-BCD-5151EIS) vs photo+thermal combo (2151T,
 *   2351TEM) are kept as distinct sensing_principle/device_type values.
 * - 2151/5151 (100-Series/400-Series base numbering, B401-compatible) vs
 *   the EIS intrinsically-safe sub-line (own Exia II CT6 rating, its own
 *   B401 compatibility confirmed independently) are never conflated.
 * - The Series 300 (2351EC/2351TEM/5351E) EN54 certificate number is only
 *   ever asserted on 2351EC itself.
 *
 * Real, evidenced base-compatibility mapping (never inferred from mechanical
 * fit alone): India-sourced EN-54 SKUs (2351/EC, 2351TEM, 5351E) pair with
 * "B401." (this catalog's own India-made base row); China-sourced SKUs
 * (2151-CH, 5151-CH) pair with "B401-SS" (this catalog's own China-made base
 * row); the bare/unspecified-origin SKUs (2151, 5151) and the EIS line (whose
 * own ordering table names bare "B401") pair with plain "B401".
 *
 * Deliberately NOT structured (real, reported gaps):
 * - 2151T requires a "B100 Series Base" per its own catalog description, but
 *   no B100LP/B110LP/B112LP/B114LP/B116LP product exists anywhere in this
 *   catalog -- no accessory relationship added.
 * - 5151 (bare) requires a "B400 series base" per its own catalog
 *   description, but no B400-series product exists in this catalog either --
 *   no accessory relationship added.
 * - JTY-GD-2151EIS/JTWB-BCD-5151EIS's own ordering table shows no UL/FM
 *   listing checkmark for the detectors themselves (only for the B401 base)
 *   -- detector-level standards left unresolved rather than fabricated.
 *
 * Usage:
 *   node scripts/seed-conventional-detector-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-conventional-detector-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-conventional-detector-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const doc = (sourceId, url) => ({ sourceType: "Manufacturer Official Datasheet", sourceId, url });
const DOC_1151_2151 = doc("Fire-Lite/System Sensor \"1151 and 2151: Low-Profile Plug-In Photoelectric and Ionization Smoke Detectors\" (Doc DF-51483, 6/30/98)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/df-51483.pdf");
const DOC_5151 = { sourceType: "Manufacturer Official Installation Manual", sourceId: "System Sensor \"5151 Plug-In Heat Detector\" (Doc I56-5151-001 / SS-400-011)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/5151_Manual_I56-5151.pdf" };
const DOC_2351EC = doc("System Sensor \"2351EC: Conventional Photoelectric Smoke Detector\" (Doc DS2351EC-15, 2015)", "https://www.honeywellbuildings.in/uploads/fire_safety/product/doc/16068035772351EC.pdf");
const DOC_EIS = doc("System Sensor \"JTY-GD-2151EIS Photoelectric / JTWB-BCD-5151EIS Thermal: Intrinsically Safe Detectors\" (Doc S2-1525-002_B)", "https://www.honeywellbuildings.in/assets/datasheet/fire/sensor/2151EIS_5151EIS.pdf");

const fact = (name, value, { operator = "Equal", page = 1, section, srcDoc, confidence = 88, sourceText } = {}) => ({
  name, operator, normalizedValue: value, confidence,
  ...(sourceText ? { sourceText } : {}),
  source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url, page, section },
});

const PRODUCT_ATTRIBUTES = {
  "2151": [
    fact("device_type", "Low-Profile Plug-In Photoelectric Smoke Detector Head", { srcDoc: DOC_1151_2151, section: "General" }),
    fact("addressing", "Conventional", { srcDoc: DOC_1151_2151, section: "Title", sourceText: "Section: Conventional Initiating Devices" }),
    fact("sensing_principle", "Photoelectric", { srcDoc: DOC_1151_2151, section: "Construction and Operation" }),
    fact("standby_current", "85 µA", { operator: "Informational", srcDoc: DOC_1151_2151, section: "General Specifications" }),
    fact("air_velocity_range", "0-3000 ft/min (0-914.4 m/min)", { operator: "Informational", srcDoc: DOC_1151_2151, section: "General Specifications" }),
    fact("detector_base_requirement", "Requires B100LP Series base (B110LP/B110RLP/B112LP/B114LP/B116LP) or B401", { operator: "Informational", srcDoc: DOC_1151_2151, page: 2, section: "Mounting Base Selection Guide" }),
  ],
  "2151-CH": [
    fact("device_type", "Low-Profile Plug-In Photoelectric Smoke Detector Head", { srcDoc: DOC_1151_2151, section: "General" }),
    fact("addressing", "Conventional", { srcDoc: DOC_1151_2151, section: "Title", sourceText: "Section: Conventional Initiating Devices" }),
    fact("sensing_principle", "Photoelectric", { srcDoc: DOC_1151_2151, section: "Construction and Operation" }),
    fact("standby_current", "85 µA", { operator: "Informational", srcDoc: DOC_1151_2151, section: "General Specifications" }),
    fact("air_velocity_range", "0-3000 ft/min (0-914.4 m/min)", { operator: "Informational", srcDoc: DOC_1151_2151, section: "General Specifications" }),
    fact("detector_base_requirement", "Requires B401 series base (China-sourced variant pairs with B401-SS)", { operator: "Informational", confidence: 75, srcDoc: DOC_1151_2151, page: 2, section: "Mounting Base Selection Guide" }),
  ],
  "2151T": [
    fact("device_type", "Low-Profile Plug-In Photoelectric + Thermal Combination Smoke Detector Head", { operator: "Informational", confidence: 70, srcDoc: DOC_1151_2151, section: "(own catalog description; no dedicated 2151T datasheet located this sprint)" }),
    fact("addressing", "Conventional", { operator: "Informational", confidence: 70, srcDoc: DOC_1151_2151, section: "(inferred from shared 100-Series product line; not independently confirmed for this exact combo variant)" }),
    fact("sensing_principle", "Photoelectric + Thermal", { operator: "Informational", confidence: 70, srcDoc: DOC_1151_2151, section: "(own catalog description)" }),
    fact("detector_base_requirement", "Requires B100 Series Base (no matching B1xxLP product exists in this catalog)", { operator: "Informational", confidence: 75, srcDoc: DOC_1151_2151, section: "(own catalog description)" }),
  ],
  "5151": [
    fact("device_type", "Plug-In Heat Detector (Fixed + Rate-of-Rise)", { srcDoc: DOC_5151, section: "General Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_5151, section: "General Description", sourceText: "conventional 2-wire thermal detector" }),
    fact("sensing_principle", "Thermistor -- 135°F (57°C) Fixed or 15°F/min Rate-of-Rise", { srcDoc: DOC_5151, section: "General Description" }),
    fact("operating_voltage_range", "8.5-35 VDC", { operator: "Informational", srcDoc: DOC_5151, section: "Specifications" }),
    fact("standby_current", "80 µA @ 24VDC", { operator: "Informational", srcDoc: DOC_5151, section: "Specifications" }),
    fact("alarm_current", "10 mA min, 130 mA max (must be limited by control panel)", { operator: "Informational", srcDoc: DOC_5151, section: "Specifications" }),
    fact("alarm_trouble_behavior", "Latching alarm, reset only by momentary power interruption; LEDs off indicates trouble (sensitivity outside listed limit)", { operator: "Informational", srcDoc: DOC_5151, section: "General Description" }),
    fact("detector_base_requirement", "Requires B400 series base (no matching B4xx heat-detector base product exists in this catalog)", { operator: "Informational", confidence: 75, srcDoc: DOC_5151, section: "(own catalog description)" }),
  ],
  "5151-CH": [
    fact("device_type", "Plug-In Heat Detector (Fixed + Rate-of-Rise)", { srcDoc: DOC_5151, section: "General Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_5151, section: "General Description", sourceText: "conventional 2-wire thermal detector" }),
    fact("sensing_principle", "Thermistor -- 135°F (57°C) Fixed or 15°F/min Rate-of-Rise", { srcDoc: DOC_5151, section: "General Description" }),
    fact("operating_voltage_range", "8.5-35 VDC", { operator: "Informational", srcDoc: DOC_5151, section: "Specifications" }),
    fact("standby_current", "80 µA @ 24VDC", { operator: "Informational", srcDoc: DOC_5151, section: "Specifications" }),
    fact("alarm_current", "10 mA min, 130 mA max (must be limited by control panel)", { operator: "Informational", srcDoc: DOC_5151, section: "Specifications" }),
    fact("alarm_trouble_behavior", "Latching alarm, reset only by momentary power interruption; LEDs off indicates trouble (sensitivity outside listed limit)", { operator: "Informational", srcDoc: DOC_5151, section: "General Description" }),
    fact("detector_base_requirement", "Requires B401-SS series base (per own catalog China-sourced designation)", { operator: "Informational", confidence: 75, srcDoc: DOC_5151, section: "(own catalog description)" }),
  ],
  "2351/EC": [
    fact("device_type", "Series 300 Conventional Photoelectric Smoke Detector", { srcDoc: DOC_2351EC, section: "Overview" }),
    fact("addressing", "Conventional", { srcDoc: DOC_2351EC, section: "Title" }),
    fact("sensing_principle", "Photoelectric", { srcDoc: DOC_2351EC, section: "Description" }),
    fact("operating_voltage_range", "8-30 VDC (Nominal 12/24VDC)", { operator: "Informational", srcDoc: DOC_2351EC, page: 2, section: "Electrical Specifications" }),
    fact("standby_current", "50 µA @ 24VDC (LED no blink)", { operator: "Informational", srcDoc: DOC_2351EC, page: 2, section: "Electrical Specifications" }),
    fact("alarm_current", "80 mA @ 24VDC max (limited by panel)", { operator: "Informational", srcDoc: DOC_2351EC, page: 2, section: "Electrical Specifications" }),
    fact("detector_base_requirement", "Backward compatible with Series 100 bases; B401 family (Standard/SD/R/RSD/RM/DG/DGR/DGSD), B312NL/B312RL/B324RL relay bases", { operator: "Informational", srcDoc: DOC_2351EC, page: 2, section: "Product Range" }),
    fact("product_line_siblings", "2351TEM, 4351E, 5351E, 535ITE (same Series 300 platform per this document's own Product Range)", { operator: "Informational", srcDoc: DOC_2351EC, page: 2, section: "Product Range" }),
  ],
  "2351TEM": [
    fact("device_type", "Series 300 Conventional Photoelectric + Heat Combination Detector", { operator: "Informational", confidence: 82, srcDoc: DOC_2351EC, page: 2, section: "Product Range (named as a sibling device in this range)" }),
    fact("addressing", "Conventional", { operator: "Informational", confidence: 82, srcDoc: DOC_2351EC, page: 2, section: "Product Range (shared Series 300 architecture)" }),
    fact("sensing_principle", "Photoelectric + Thermal", { operator: "Informational", confidence: 75, srcDoc: DOC_2351EC, section: "(own catalog description)" }),
    fact("operating_voltage_range", "8-30 VDC (Nominal 12/24VDC)", { operator: "Informational", confidence: 82, srcDoc: DOC_2351EC, page: 2, section: "Product Range (shared Series 300 electrical class)" }),
    fact("detector_base_requirement", "Requires B401. series base (India-sourced designation); backward compatible with Series 100 bases per shared Series 300 platform", { operator: "Informational", confidence: 80, srcDoc: DOC_2351EC, page: 2, section: "Product Range" }),
  ],
  "5351E": [
    fact("device_type", "Series 300 Conventional Heat Detector", { operator: "Informational", confidence: 82, srcDoc: DOC_2351EC, page: 2, section: "Product Range (named as a sibling device in this range)" }),
    fact("addressing", "Conventional", { operator: "Informational", confidence: 82, srcDoc: DOC_2351EC, page: 2, section: "Product Range (shared Series 300 architecture)" }),
    fact("sensing_principle", "Thermal", { operator: "Informational", confidence: 75, srcDoc: DOC_2351EC, section: "(own catalog description)" }),
    fact("operating_voltage_range", "8-30 VDC (Nominal 12/24VDC)", { operator: "Informational", confidence: 82, srcDoc: DOC_2351EC, page: 2, section: "Product Range (shared Series 300 electrical class)" }),
    fact("detector_base_requirement", "Requires B401. series base (India-sourced designation); backward compatible with Series 100 bases per shared Series 300 platform", { operator: "Informational", confidence: 80, srcDoc: DOC_2351EC, page: 2, section: "Product Range" }),
  ],
  "JTY-GD-2151EIS": [
    fact("device_type", "Conventional Intrinsically Safe Photoelectric Smoke Detector", { srcDoc: DOC_EIS, section: "General Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_EIS, section: "General Description", sourceText: "Model JTY-GD-2151EIS is a conventional intrinsically safe photoelectric smoke detector" }),
    fact("sensing_principle", "Photoelectric", { srcDoc: DOC_EIS, section: "General Description" }),
    fact("operating_voltage_range", "8.5-28 VDC", { operator: "Informational", srcDoc: DOC_EIS, page: 2, section: "Specifications" }),
    fact("intrinsic_safety_rating", "Exia II CT6", { srcDoc: DOC_EIS, section: "Features" }),
    fact("panel_compatibility_note", "For use with 2-wire control panels via interface module (generic, panel-agnostic -- no Farenhyt-specific compatibility list found)", { operator: "Informational", srcDoc: DOC_EIS, section: "General Description" }),
    fact("alarm_trouble_behavior", "Latches on in alarm; reset by momentary power interruption; tested via internal reed switch with test magnet", { operator: "Informational", srcDoc: DOC_EIS, section: "General Description" }),
    fact("detector_base_requirement", "Requires B401 plug-in detector base", { operator: "Informational", srcDoc: DOC_EIS, page: 2, section: "Ordering Information" }),
  ],
  "JTWB-BCD-5151EIS": [
    fact("device_type", "Conventional 2-Wire Intrinsically Safe Thermal Detector", { srcDoc: DOC_EIS, section: "General Description" }),
    fact("addressing", "Conventional", { srcDoc: DOC_EIS, section: "General Description", sourceText: "Model JTWB-BCD-5151EIS is a conventional 2-wire intrinsically safe thermal detector" }),
    fact("sensing_principle", "Thermistor -- 63°C Fixed or 10°C/min Rate-of-Rise", { srcDoc: DOC_EIS, page: 2, section: "Specifications" }),
    fact("operating_voltage_range", "8.5-28 VDC", { operator: "Informational", srcDoc: DOC_EIS, page: 2, section: "Specifications" }),
    fact("intrinsic_safety_rating", "Exia II CT6", { srcDoc: DOC_EIS, section: "Features" }),
    fact("panel_compatibility_note", "For use with 2-wire control panels via interface module (generic, panel-agnostic -- no Farenhyt-specific compatibility list found)", { operator: "Informational", srcDoc: DOC_EIS, section: "General Description" }),
    fact("alarm_trouble_behavior", "Red LEDs blink every 5s in standby, latch on in alarm, stop blinking in fault", { operator: "Informational", srcDoc: DOC_EIS, section: "General Description" }),
    fact("detector_base_requirement", "Requires B401 plug-in detector base", { operator: "Informational", srcDoc: DOC_EIS, page: 2, section: "Ordering Information" }),
  ],
};

const STANDARDS = {
  "2151": [{ body: "UL", number: "268" }, { body: "UL", number: "S911" }, { body: "CSFM", number: "7272-1209:159" }, { body: "MEA", number: "205-94-E" }],
  "2151-CH": [{ body: "UL", number: "268" }],
  "2351/EC": [{ body: "EN", number: "54-7:2000 Amendment 1" }],
  "5151": [{ body: "UL", number: "521" }, { body: "FM", number: "3210" }],
  "5151-CH": [{ body: "UL", number: "521" }, { body: "FM", number: "3210" }],
};
const STANDARDS_DOC = { "2151": DOC_1151_2151, "2151-CH": DOC_1151_2151, "2351/EC": DOC_2351EC, "5151": DOC_5151, "5151-CH": DOC_5151 };

const ACCESSORIES = [
  ["2151", "B401", "Compatible Base", DOC_1151_2151],
  ["2151-CH", "B401-SS", "Compatible Base", DOC_1151_2151],
  ["2351/EC", "B401.", "Compatible Base", DOC_2351EC],
  ["2351TEM", "B401.", "Compatible Base", DOC_2351EC],
  ["5351E", "B401.", "Compatible Base", DOC_2351EC],
  ["5151-CH", "B401-SS", "Compatible Base", DOC_5151],
  ["JTY-GD-2151EIS", "B401", "Compatible Base", DOC_EIS],
  ["JTWB-BCD-5151EIS", "B401", "Compatible Base", DOC_EIS],
];

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, ?, 'One per detector', '[]', 0, 1, ?, 82, 'Approved', 'sprint-1.37-conventional-detector-seed')");
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
      const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, status: "Verified", confidence: 85, source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url } }));
      for (const s of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${s.body} ${s.number}`);
      if (apply) updateStandards.run(JSON.stringify([...existing, ...appended]), product.id);
      stdsAdded += appended.length;
    }
  }

  for (const [detectorPN, accessoryPN, relationshipType, srcDoc] of ACCESSORIES) {
    const product = getProduct.get(detectorPN);
    if (!product) throw new Error(`Product not found: ${detectorPN}`);
    const accessory = getProduct.get(accessoryPN);
    if (!accessory) throw new Error(`Accessory product not found: ${accessoryPN}`);
    if (existingAccessory.get(product.id, accessory.id)) { console.log(`SKIP (already present): ${detectorPN} -> ${accessoryPN}`); accSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${detectorPN} -> ${relationshipType}: ${accessoryPN}`);
    if (apply) insertAccessory.run(id("productaccessory"), product.id, accessory.id, relationshipType, JSON.stringify([{ sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url }]));
    accAdded += 1;
  }

  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} attributes (${attrsSkipped} skipped); ${stdsAdded} standards (${stdsSkipped} skipped); ${accAdded} accessory relationships (${accSkipped} skipped).`);
console.log("Unresolved: 2151T (no dedicated datasheet, no matching B100LP base product); 5151 bare (no matching B400-series base product); JTY-GD-2151EIS/JTWB-BCD-5151EIS detector-level standards (ordering table shows no UL/FM checkmark for the detectors themselves, only for the B401 base -- left unresolved rather than fabricated); 2351TEM/5351E's own specific EN54 certificate number (only 2351EC's own number is confirmed -- shared architecture facts applied at reduced confidence, not the exact certificate).");
