#!/usr/bin/env node
/**
 * Sprint 1.35 -- brings the Honeywell/Farenhyt Multi-Criteria Detector
 * (IDP-FIRE-CO, IDP-PTIR) and Carbon Monoxide Detector (CO1224T/CO1224TR)
 * families to reusable technical readiness using three official documents,
 * each applied only to the exact SKUs it names, while keeping the
 * addressable multi-criteria devices and the standalone conventional CO
 * detector strictly, structurally distinct.
 *
 * DOC_FIRE_CO  Honeywell Farenhyt "IDP-FIRE-CO-W and IDP-FIRE-CO-IV: Multi-
 *   Criteria Fire/CO Detector" (Doc FH-62002, Rev C, 02/20). Its own
 *   "Ordering Information" names both SKUs and their shared "Bases" list;
 *   its own Technical Specifications give real CO alarm thresholds, UL 268
 *   7th Ed / UL 521 / UL 2075 standards, and UL S6173 / CSFM 7272-0559:0517
 *   listing numbers. Notably, this document does NOT publish a fixed
 *   compatible-FACP list (unlike IDP-PHOTO/IDP-HEAT/every module in this
 *   catalog) -- left unresolved rather than copied from an unrelated
 *   product's list.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-FIRE-CO-IV-Datasheet.pdf
 * DOC_PTIR    Honeywell Farenhyt "IDP-PTIR-W and IDP-PTIR-IV: Multi-Criteria
 *   Photo/Thermal/Infrared Detector" (Doc FH-62009, Rev A, 05/19). Same
 *   "Bases" list as DOC_FIRE_CO (both wired from the same PDF ordering
 *   template) -- but its own Standards section states ONLY "UL 268 7th
 *   Edition" as the fire standard, and its own body text separately adds
 *   "UL 521 listing requirements" -- it never mentions UL 2075 anywhere,
 *   because IDP-PTIR has no CO sensor at all (photo/thermal/infrared only).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-FH_62009.pdf
 * DOC_CO1224  System Sensor "CO1224T/CO1224TR: Carbon Monoxide Detector"
 *   installation manual (Doc I56-3111-012, 10/28). Explicitly states this
 *   is a CONVENTIONAL, non-addressable, 12/24VDC device wired to a
 *   dedicated non-fire zone on a generic "UL Listed Fire/Burg Control
 *   Panel" -- never an SLC/IDP addressable point, and explicitly forbidden
 *   by NFPA 720 9.6.7/9.6.7.2 from sharing a zone with fire-initiating
 *   devices. Its own installation steps name the CO-PLATE replacement
 *   plate as its own accessory (used with CO1224T specifically, to retrofit
 *   a square CO1224T onto an existing round-detector mounting footprint --
 *   CO-PLATE's own catalog description confirms: "Use when replacing round
 *   CO detectors with the CO1224T").
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/CO1224T_TR_Manual_I56-3111.pdf
 *
 * Kept strictly distinct per the task:
 * - addressing: IDP-FIRE-CO/IDP-PTIR = "Addressable" (SLC loop, one address
 *   per device, Isolator Load Rating spec); CO1224T/CO1224TR = "Conventional"
 *   (hardwired non-fire zone, never SLC/IDP).
 * - sensing_technologies: IDP-FIRE-CO = 4 sensors including CO; IDP-PTIR = 3
 *   sensors, NO CO; CO1224T/CO1224TR = CO only, explicitly NOT smoke/fire
 *   capable (its own manual: "NOT designed to detect smoke, fire or any gas
 *   other than carbon monoxide").
 * - co_alarm_thresholds: IDP-FIRE-CO's own doc gives 3 threshold rows
 *   (70/150/400ppm); CO1224T/CO1224TR's own manual gives 4 rows (adds a
 *   30ppm/30-day row) -- never merged or copied between them.
 * - standards: UL 2075 only ever asserted on the two devices whose own
 *   document actually names it (IDP-FIRE-CO, CO1224T/CO1224TR) -- never on
 *   IDP-PTIR.
 * - compatible_panel_families: deliberately NOT asserted for IDP-FIRE-CO/
 *   IDP-PTIR -- their own document has no such list (unlike every other IDP
 *   product in this catalog), so none is fabricated.
 *
 * Usage:
 *   node scripts/seed-multi-criteria-co-detector-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-multi-criteria-co-detector-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-multi-criteria-co-detector-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const DOC_FIRE_CO = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"IDP-FIRE-CO-W and IDP-FIRE-CO-IV: Multi-Criteria Fire/CO Detector\" (Doc FH-62002, Rev C, 02/20)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-FIRE-CO-IV-Datasheet.pdf" };
const DOC_PTIR = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"IDP-PTIR-W and IDP-PTIR-IV: Multi-Criteria Photo/Thermal/Infrared Detector\" (Doc FH-62009, Rev A, 05/19)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-FH_62009.pdf" };
const DOC_CO1224 = { sourceType: "Manufacturer Official Installation Manual", sourceId: "System Sensor \"CO1224T/CO1224TR: Carbon Monoxide Detector\" (Doc I56-3111-012, 10/28)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/CO1224T_TR_Manual_I56-3111.pdf" };

const fact = (name, value, { operator = "Equal", page = 1, section, srcDoc, confidence = 90, sourceText } = {}) => ({
  name, operator, normalizedValue: value, confidence,
  ...(sourceText ? { sourceText } : {}),
  source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url, page, section },
});

const PRODUCT_ATTRIBUTES = {
  "IDP-FIRE-CO-IV": [
    fact("addressing", "Addressable", { srcDoc: DOC_FIRE_CO, section: "Product Description", sourceText: "Uses only one address on the SLC loop" }),
    fact("sensing_technologies", "Photoelectric Smoke + Electrochemical CO + Infrared Light/Flame + Thermal (135°F Fixed)", { srcDoc: DOC_FIRE_CO, section: "Features and Benefits" }),
    fact("protocol", "IDP", { srcDoc: DOC_FIRE_CO, section: "Features and Benefits", sourceText: "Uses only one address on the SLC loop" }),
    fact("co_alarm_thresholds", "70±5ppm: 60-240min; 150±5ppm: 10-50min; 400±10ppm: 4-15min (per UL 2075, tested to UL 2034 sensitivity limits)", { operator: "Informational", srcDoc: DOC_FIRE_CO, page: 3, section: "CO Monitoring UL Standard Reference" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_FIRE_CO, page: 3, section: "Electrical" }),
    fact("detector_base_requirement", "Requires separate base (Base Not Included); recommended B200S series intelligent sounder base (generates Temp 3 for fire / Temp 4 for CO)", { operator: "Informational", srcDoc: DOC_FIRE_CO, page: 1, section: "Product Description" }),
    fact("isolator_load_rating", "0.0063", { operator: "Informational", srcDoc: DOC_FIRE_CO, page: 3, section: "Electrical" }),
  ],
  "IDP-FIRE-CO-W": [
    fact("addressing", "Addressable", { srcDoc: DOC_FIRE_CO, section: "Product Description", sourceText: "Uses only one address on the SLC loop" }),
    fact("sensing_technologies", "Photoelectric Smoke + Electrochemical CO + Infrared Light/Flame + Thermal (135°F Fixed)", { srcDoc: DOC_FIRE_CO, section: "Features and Benefits" }),
    fact("protocol", "IDP", { srcDoc: DOC_FIRE_CO, section: "Features and Benefits", sourceText: "Uses only one address on the SLC loop" }),
    fact("co_alarm_thresholds", "70±5ppm: 60-240min; 150±5ppm: 10-50min; 400±10ppm: 4-15min (per UL 2075, tested to UL 2034 sensitivity limits)", { operator: "Informational", srcDoc: DOC_FIRE_CO, page: 3, section: "CO Monitoring UL Standard Reference" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_FIRE_CO, page: 3, section: "Electrical" }),
    fact("detector_base_requirement", "Requires separate base (Base Not Included); recommended B200S series intelligent sounder base (generates Temp 3 for fire / Temp 4 for CO)", { operator: "Informational", srcDoc: DOC_FIRE_CO, page: 1, section: "Product Description" }),
    fact("isolator_load_rating", "0.0063", { operator: "Informational", srcDoc: DOC_FIRE_CO, page: 3, section: "Electrical" }),
  ],
  "IDP-PTIR-IV": [
    fact("addressing", "Addressable", { srcDoc: DOC_PTIR, section: "General Description", sourceText: "Rotary address switches; Analog communications" }),
    fact("sensing_technologies", "Photoelectric Smoke + Thermal (135°F Fixed) + Infrared -- no CO sensing", { srcDoc: DOC_PTIR, section: "General Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_PTIR, section: "Features & Benefits", sourceText: "Analog communications; Isolator Load Rating" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_PTIR, page: 2, section: "Electrical Specifications" }),
    fact("detector_base_requirement", "Requires separate base (own doc lists compatible bases in Ordering Information)", { operator: "Informational", srcDoc: DOC_PTIR, page: 2, section: "Ordering Information" }),
    fact("isolator_load_rating", "0.0063", { operator: "Informational", srcDoc: DOC_PTIR, page: 2, section: "Electrical Specifications" }),
  ],
  "IDP-PTIR-W": [
    fact("addressing", "Addressable", { srcDoc: DOC_PTIR, section: "General Description", sourceText: "Rotary address switches; Analog communications" }),
    fact("sensing_technologies", "Photoelectric Smoke + Thermal (135°F Fixed) + Infrared -- no CO sensing", { srcDoc: DOC_PTIR, section: "General Description" }),
    fact("protocol", "IDP", { srcDoc: DOC_PTIR, section: "Features & Benefits", sourceText: "Analog communications; Isolator Load Rating" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_PTIR, page: 2, section: "Electrical Specifications" }),
    fact("detector_base_requirement", "Requires separate base (own doc lists compatible bases in Ordering Information)", { operator: "Informational", srcDoc: DOC_PTIR, page: 2, section: "Ordering Information" }),
    fact("isolator_load_rating", "0.0063", { operator: "Informational", srcDoc: DOC_PTIR, page: 2, section: "Electrical Specifications" }),
  ],
  "CO1224T": [
    fact("addressing", "Conventional", { srcDoc: DOC_CO1224, page: 4, section: "Caution / Installation Requirements", sourceText: "Different than System Sensor conventional 4-wire smoke detectors...Connect to a non-resettable power supply...Connect to a non-fire zone" }),
    fact("sensing_technologies", "Electrochemical CO only -- NOT designed to detect smoke, fire, or any gas other than carbon monoxide", { srcDoc: DOC_CO1224, page: 3, section: "Caution" }),
    fact("co_alarm_thresholds", "30±3ppm: no alarm within 30 days; 70±5ppm: 60-240min; 150±5ppm: 10-50min; 400±10ppm: 4-15min (per UL 2075, tested to UL 2034 sensitivity limits)", { operator: "Informational", srcDoc: DOC_CO1224, page: 3, section: "Alarm Thresholds" }),
    fact("operating_voltage_range", "12/24 VDC nominal (10-33 VDC range)", { operator: "Informational", srcDoc: DOC_CO1224, page: 1, section: "Electrical Specifications" }),
    fact("alarm_trouble_behavior", "Alarm relay Form C; trouble relay Form A (mandatory per UL 2075 17.1.1 -- trouble signal required on open circuit, ground fault, sensor removal, or cell end-of-life); local sounder Temp 4 pattern, 85dBA min at 10ft; 10-year CO cell life", { operator: "Informational", srcDoc: DOC_CO1224, page: 1, section: "General Description" }),
    fact("wiring_zone_requirement", "Must be wired to a dedicated non-fire zone; must NOT share a zone with smoke detectors or other fire/intrusion initiating devices (NFPA 720 9.6.7, 9.6.7.2)", { srcDoc: DOC_CO1224, page: 4, section: "Caution / Installation Requirements" }),
  ],
  "CO1224TR": [
    fact("addressing", "Conventional", { srcDoc: DOC_CO1224, page: 4, section: "Caution / Installation Requirements", sourceText: "Different than System Sensor conventional 4-wire smoke detectors...Connect to a non-resettable power supply...Connect to a non-fire zone" }),
    fact("sensing_technologies", "Electrochemical CO only -- NOT designed to detect smoke, fire, or any gas other than carbon monoxide", { srcDoc: DOC_CO1224, page: 3, section: "Caution" }),
    fact("co_alarm_thresholds", "30±3ppm: no alarm within 30 days; 70±5ppm: 60-240min; 150±5ppm: 10-50min; 400±10ppm: 4-15min (per UL 2075, tested to UL 2034 sensitivity limits)", { operator: "Informational", srcDoc: DOC_CO1224, page: 3, section: "Alarm Thresholds" }),
    fact("operating_voltage_range", "12/24 VDC nominal (10-33 VDC range)", { operator: "Informational", srcDoc: DOC_CO1224, page: 1, section: "Electrical Specifications" }),
    fact("alarm_trouble_behavior", "Alarm relay Form C; trouble relay Form A (mandatory per UL 2075 17.1.1 -- trouble signal required on open circuit, ground fault, sensor removal, or cell end-of-life); local sounder Temp 4 pattern, 85dBA min at 10ft; 10-year CO cell life", { operator: "Informational", srcDoc: DOC_CO1224, page: 1, section: "General Description" }),
    fact("wiring_zone_requirement", "Must be wired to a dedicated non-fire zone; must NOT share a zone with smoke detectors or other fire/intrusion initiating devices (NFPA 720 9.6.7, 9.6.7.2)", { srcDoc: DOC_CO1224, page: 4, section: "Caution / Installation Requirements" }),
  ],
};

const STANDARDS = {
  "IDP-FIRE-CO-IV": [{ body: "UL", number: "268 7th Edition" }, { body: "UL", number: "521" }, { body: "UL", number: "2075" }, { body: "UL", number: "S6173" }, { body: "CSFM", number: "7272-0559:0517" }, { body: "FM", number: "Approved" }],
  "IDP-FIRE-CO-W": [{ body: "UL", number: "268 7th Edition" }, { body: "UL", number: "521" }, { body: "UL", number: "2075" }, { body: "UL", number: "S6173" }, { body: "CSFM", number: "7272-0559:0517" }, { body: "FM", number: "Approved" }],
  "IDP-PTIR-IV": [{ body: "UL", number: "268 7th Edition" }, { body: "UL", number: "521" }, { body: "UL", number: "S6173" }, { body: "CSFM", number: "7272-0559:0517" }, { body: "FM", number: "Approved" }],
  "IDP-PTIR-W": [{ body: "UL", number: "268 7th Edition" }, { body: "UL", number: "521" }, { body: "UL", number: "S6173" }, { body: "CSFM", number: "7272-0559:0517" }, { body: "FM", number: "Approved" }],
};
const STANDARDS_DOC = { "IDP-FIRE-CO-IV": DOC_FIRE_CO, "IDP-FIRE-CO-W": DOC_FIRE_CO, "IDP-PTIR-IV": DOC_PTIR, "IDP-PTIR-W": DOC_PTIR };

const SHARED_BASES_W = ["B300-6", "B501-WHITE", "B200S-WH", "B200S-LF-WH", "B224BI-WH", "B224RB-WH"];
const SHARED_BASES_IV = ["B300-6-IV", "B501-IV", "B200S-IV", "B200S-LF-IV", "B224BI-IV", "B224RB-IV"];
const ACCESSORIES = [
  ...SHARED_BASES_W.map((base) => ["IDP-FIRE-CO-W", base, /^B200S/.test(base) ? "Sounding Base" : "Compatible Base", DOC_FIRE_CO]),
  ...SHARED_BASES_IV.map((base) => ["IDP-FIRE-CO-IV", base, /^B200S/.test(base) ? "Sounding Base" : "Compatible Base", DOC_FIRE_CO]),
  ...SHARED_BASES_W.map((base) => ["IDP-PTIR-W", base, /^B200S/.test(base) ? "Sounding Base" : "Compatible Base", DOC_PTIR]),
  ...SHARED_BASES_IV.map((base) => ["IDP-PTIR-IV", base, /^B200S/.test(base) ? "Sounding Base" : "Compatible Base", DOC_PTIR]),
  ["CO1224T", "CO-PLATE", "Compatible Replacement Plate", DOC_CO1224],
];
// B501-BL is a listed base option in both docs, but no black IDP-FIRE-CO/IDP-PTIR SKU exists to pair it with -- attribute only, no accessory relationship (mirrors the same honest gap already reported for IDP-PHOTO in Sprint 1.33).

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, ?, 'One per detector', '[]', 0, 1, ?, 90, 'Approved', 'sprint-1.35-multi-criteria-co-seed')");
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
      const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, status: "Verified", confidence: 90, source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url } }));
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
console.log("Unresolved: compatible_panel_families NOT asserted for IDP-FIRE-CO/IDP-PTIR (their own document publishes no fixed FACP list -- 'consult factory'); B501-BL base option has no black IDP-FIRE-CO/IDP-PTIR SKU to pair with (attribute-only, no accessory link, mirroring the same gap already reported for IDP-PHOTO).");
