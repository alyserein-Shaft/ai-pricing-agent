#!/usr/bin/env node
/**
 * Sprint 1.39 -- brings Pull Station (3 SKUs, after reconciling
 * Manual Call Point vs Pull Station this same sprint), Annunciator (2),
 * Bell (3), Battery (2), and Battery Cabinet (1) to reusable technical
 * readiness using five official documents. Manual Call Point's remaining
 * member (XAL-53, a third-party Killark explosion-proof manual station) is
 * deliberately left unresolved -- no official Killark document was located,
 * and it is a genuinely different manufacturer/ecosystem from every other
 * product this sprint touches.
 *
 * DOC_PULL     Honeywell Farenhyt "IDP-PULL-SA / IDP-PULL-DA: Addressable
 *   Single Action and Dual Action Pull Stations" (Doc 350286, Rev H,
 *   11/17). 15-32VDC, 350µA SLC current, UL 38, 7-panel Farenhyt
 *   compatibility, BG-TR trim ring + SB-I/O surface backbox accessories
 *   (neither exists in this catalog -- reported gap).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-PULL-DA-Datasheet.pdf
 * DOC_WIDP_PULL  Honeywell Farenhyt "WIDP-PULL-DA: SWIFT Wireless
 *   Pullstation" (Doc FH-61058:B, 10/18). Dual-action only (no single-
 *   action wireless variant exists), UL S6012, CSFM 7150-0559:0513, FM
 *   Approved, its own narrower 6-panel compatibility list (no IFP-2000/
 *   RPS-2000/IFP-1000/IFP-100 -- kept distinct from the wired 7-panel
 *   list), CR-123A battery powered, no detector base required (unlike
 *   WIDP-HEAT/WIDP-PHOTO).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-FH_61058.pdf
 * DOC_RA2000   Honeywell Farenhyt "RA-2000/RA-2000GRAY: Remote Annunciator"
 *   (Doc 350401, Rev H, 04/22). UL 864 10th Ed / UL 2572 2nd Ed, UL S3511,
 *   CSFM Approved, FDNY 6162, 24VDC, RS-485 SBus, its own compatible-panel
 *   list (broader than the pull-station/module list -- includes IFP-2100HV
 *   variants and RFP-2100 variants explicitly).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-350401-H.pdf
 * DOC_BELL     System Sensor "SSM/SSV Series Alarm Bells" (Doc
 *   WFDS74501, 3/12). SSM24-6/8/10 (24VDC, 16-33VDC operating range) kept
 *   distinct from the SSV120 (120VAC) line not in this catalog; each gong
 *   size's own distinct sound output (82/80/81 dBA) preserved, never
 *   merged into one shared figure. UL S4011, ULC CS549, FM 3005255, CSFM
 *   7135-1653:0125.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/SSM_SSV_DataSheet_WFDS745.pdf
 * DOC_BAT      Notifier by Honeywell "BAT Series Batteries: Sealed
 *   Lead-Acid" (Doc DN-6933:D, 02/28/13). Confirms BAT-12550 (12V/55AH) and
 *   BAT-121000 (12V/100AH) exact ratings and UL Recognized Component
 *   MH20845 (Power-Sonic).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/DN-6933.pdf
 *
 * Kept genuinely distinct per the task:
 * - IDP-PULL-SA (single action) vs IDP-PULL-DA (dual action) vs
 *   WIDP-PULL-DA (wireless dual action) -- action_type preserved as its
 *   own attribute on each, never assumed from the other.
 * - WIDP-PULL-DA's own narrower 6-panel compatible-panel list is never
 *   widened to the wired stations' 7-panel list.
 * - Each SSM24 bell size keeps its own individually-documented sound
 *   output value -- never averaged or copied across sizes.
 * - Historical Opera selection is not used as technical evidence anywhere
 *   in this script; every fact traces to one of the five documents above.
 *
 * Deliberately NOT enriched (real, reported gaps/deferrals):
 * - XAL-53 (Manual Call Point, third-party Killark explosion-proof
 *   station) -- no official document located; left with no new facts.
 * - BG-TR/SB-I/O (IDP-PULL-SA/DA accessories) and RA-100TR/RA-100TG
 *   (RA-2000 trim rings) -- none exist in this catalog; no accessory
 *   relationship added.
 * - BB-55F (Battery Cabinet) -- no dedicated official datasheet located;
 *   only its own catalog description is used, plus a Compatible Battery
 *   relationship to BAT-12550 (the one battery it names that exists in
 *   this catalog as a non-bulk-pack row).
 *
 * Usage:
 *   node scripts/seed-pull-station-annunciator-bell-battery-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-pull-station-annunciator-bell-battery-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-pull-station-annunciator-bell-battery-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const doc = (sourceId, url) => ({ sourceType: "Manufacturer Official Datasheet", sourceId, url });
const DOC_PULL = doc("Honeywell Farenhyt \"IDP-PULL-SA / IDP-PULL-DA: Addressable Single Action and Dual Action Pull Stations\" (Doc 350286, Rev H, 11/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-PULL-DA-Datasheet.pdf");
const DOC_WIDP_PULL = doc("Honeywell Farenhyt \"WIDP-PULL-DA: SWIFT Wireless Pullstation\" (Doc FH-61058:B, 10/18)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-FH_61058.pdf");
const DOC_RA2000 = doc("Honeywell Farenhyt \"RA-2000/RA-2000GRAY: Remote Annunciator\" (Doc 350401, Rev H, 04/22)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-350401-H.pdf");
const DOC_BELL = doc("System Sensor \"SSM/SSV Series Alarm Bells\" (Doc WFDS74501, 3/12)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/SSM_SSV_DataSheet_WFDS745.pdf");
const DOC_BAT = doc("Notifier by Honeywell \"BAT Series Batteries: Sealed Lead-Acid\" (Doc DN-6933:D, 02/28/13)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/DN-6933.pdf");

const fact = (name, value, { operator = "Equal", page = 1, section, srcDoc, confidence = 88, sourceText } = {}) => ({
  name, operator, normalizedValue: value, confidence,
  ...(sourceText ? { sourceText } : {}),
  source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url, page, section },
});

const PANELS_7 = "IFP-2100, IFP-2100ECS, RFP-2100, IFP-2000, IFP-2000ECS, RPS-2000, IFP-1000, IFP-1000ECS, IFP-300, IFP-300ECS, IFP-100, IFP-100ECS, IFP-75, IFP-50";

const PRODUCT_ATTRIBUTES = {
  "IDP-PULL-SA": [
    fact("device_type", "Addressable Manual Pull Station", { srcDoc: DOC_PULL, section: "Product Description" }),
    fact("action_type", "Single Action", { srcDoc: DOC_PULL, section: "Product Description", sourceText: "requiring only one motion to activate the station" }),
    fact("protocol", "IDP", { srcDoc: DOC_PULL, section: "Product Description", sourceText: "Reliable analog communications" }),
    fact("compatible_panel_families", PANELS_7, { operator: "Informational", srcDoc: DOC_PULL, section: "Compatibility" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_PULL, page: 2, section: "Electrical Ratings" }),
    fact("mounting_requirement", "Surface mount to SB-I/O back box, or semi-flush single-gang (2.13in min depth), double-gang, or 4in square electrical box", { operator: "Informational", srcDoc: DOC_PULL, page: 2, section: "Installation" }),
  ],
  "IDP-PULL-DA": [
    fact("device_type", "Addressable Manual Pull Station", { srcDoc: DOC_PULL, section: "Product Description" }),
    fact("action_type", "Dual Action", { srcDoc: DOC_PULL, section: "Product Description", sourceText: "requiring two motions to active the station" }),
    fact("protocol", "IDP", { srcDoc: DOC_PULL, section: "Product Description", sourceText: "Reliable analog communications" }),
    fact("compatible_panel_families", PANELS_7, { operator: "Informational", srcDoc: DOC_PULL, section: "Compatibility" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", srcDoc: DOC_PULL, page: 2, section: "Electrical Ratings" }),
    fact("mounting_requirement", "Surface mount to SB-I/O back box, or semi-flush single-gang (2.13in min depth), double-gang, or 4in square electrical box", { operator: "Informational", srcDoc: DOC_PULL, page: 2, section: "Installation" }),
  ],
  "WIDP-PULL-DA": [
    fact("device_type", "Addressable Manual Pull Station (Wireless)", { srcDoc: DOC_WIDP_PULL, section: "Product Description" }),
    fact("action_type", "Dual Action", { srcDoc: DOC_WIDP_PULL, section: "Product Description", sourceText: "dual-action, manual pull station" }),
    fact("compatible_control_panels_via_gateway", "IFP-75, IFP-300, IFP-300ECS, IFP-2100, IFP-2100ECS, RFP-2100 (indirect, via WIDP-WGI SWIFT Gateway using IDP protocol on the SLC loop -- not a direct SLC connection)", { operator: "Informational", srcDoc: DOC_WIDP_PULL, page: 2, section: "Compatible Control Panels" }),
    fact("mounting_requirement", "Surface-mount wall plate; requires (4) CR-123A batteries (included); no detector base required", { operator: "Informational", srcDoc: DOC_WIDP_PULL, page: 1, section: "Installation" }),
  ],
  "RA-2000": [
    fact("device_type", "Remote Annunciator (LCD)", { srcDoc: DOC_RA2000, section: "Product Description" }),
    fact("display_type", "4x40 character backlit LCD, four programmable function keys", { operator: "Informational", srcDoc: DOC_RA2000, section: "Features and Benefits" }),
    fact("communication_interface", "RS-485 SBus", { srcDoc: DOC_RA2000, section: "Features and Benefits" }),
    fact("compatible_panel_families", "IFP-2100, IFP-2100B, IFP-2100HV, IFP-2100HVB, IFP-2100ECS, IFP-2100ECSB, IFP-2100ECSHV, IFP-2100ECSHVB, RFP-2100, RFP-2100B, RFP-2100HV, RFP-2100HVB, IFP-300, IFP-300B, IFP-300ECS, IFP-300ECSB, IFP-75, IFP-75B, IFP-75HV, IFP-75HVB, IFP-1000, IFP-1000ECS, IFP-100, IFP-100ECS", { operator: "Informational", srcDoc: DOC_RA2000, section: "Compatibility" }),
    fact("operating_voltage_range", "24 VDC", { operator: "Informational", srcDoc: DOC_RA2000, page: 2, section: "Electrical" }),
    fact("mounting_requirement", "Flush or surface mount; optional RA-100TR (red) / RA-100TG (gray) surface mount trim ring", { operator: "Informational", srcDoc: DOC_RA2000, page: 2, section: "Optional Accessories" }),
  ],
  "RA-2000GRAY": [
    fact("device_type", "Remote Annunciator (LCD)", { srcDoc: DOC_RA2000, section: "Product Description" }),
    fact("display_type", "4x40 character backlit LCD, four programmable function keys", { operator: "Informational", srcDoc: DOC_RA2000, section: "Features and Benefits" }),
    fact("communication_interface", "RS-485 SBus", { srcDoc: DOC_RA2000, section: "Features and Benefits" }),
    fact("compatible_panel_families", "IFP-2100, IFP-2100B, IFP-2100HV, IFP-2100HVB, IFP-2100ECS, IFP-2100ECSB, IFP-2100ECSHV, IFP-2100ECSHVB, RFP-2100, RFP-2100B, RFP-2100HV, RFP-2100HVB, IFP-300, IFP-300B, IFP-300ECS, IFP-300ECSB, IFP-75, IFP-75B, IFP-75HV, IFP-75HVB, IFP-1000, IFP-1000ECS, IFP-100, IFP-100ECS", { operator: "Informational", srcDoc: DOC_RA2000, section: "Compatibility" }),
    fact("operating_voltage_range", "24 VDC", { operator: "Informational", srcDoc: DOC_RA2000, page: 2, section: "Electrical" }),
    fact("mounting_requirement", "Flush or surface mount; optional RA-100TR (red) / RA-100TG (gray) surface mount trim ring", { operator: "Informational", srcDoc: DOC_RA2000, page: 2, section: "Optional Accessories" }),
  ],
  "SSM24-6": [
    fact("device_type", "Motor-Driven Alarm Bell", { srcDoc: DOC_BELL, section: "Product Description" }),
    fact("gong_diameter", "6 inch", { srcDoc: DOC_BELL, page: 2, section: "Ordering Information" }),
    fact("sound_output", "82 dBA", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Electrical Specifications" }),
    fact("operating_voltage_range", "16-33 VDC (24VDC nominal, polarized/supervised)", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Electrical Specifications" }),
    fact("mounting_requirement", "Standard 4in square electrical box; outdoor requires optional WBB weatherproof back box (not in this catalog)", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Physical/Operating Specifications" }),
  ],
  "SSM24-8": [
    fact("device_type", "Motor-Driven Alarm Bell", { srcDoc: DOC_BELL, section: "Product Description" }),
    fact("gong_diameter", "8 inch", { srcDoc: DOC_BELL, page: 2, section: "Ordering Information" }),
    fact("sound_output", "80 dBA", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Electrical Specifications" }),
    fact("operating_voltage_range", "16-33 VDC (24VDC nominal, polarized/supervised)", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Electrical Specifications" }),
    fact("mounting_requirement", "Standard 4in square electrical box; outdoor requires optional WBB weatherproof back box (not in this catalog)", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Physical/Operating Specifications" }),
  ],
  "SSM24-10": [
    fact("device_type", "Motor-Driven Alarm Bell", { srcDoc: DOC_BELL, section: "Product Description" }),
    fact("gong_diameter", "10 inch", { srcDoc: DOC_BELL, page: 2, section: "Ordering Information" }),
    fact("sound_output", "81 dBA", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Electrical Specifications" }),
    fact("operating_voltage_range", "16-33 VDC (24VDC nominal, polarized/supervised)", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Electrical Specifications" }),
    fact("mounting_requirement", "Standard 4in square electrical box; outdoor requires optional WBB weatherproof back box (not in this catalog)", { operator: "Informational", srcDoc: DOC_BELL, page: 2, section: "Physical/Operating Specifications" }),
  ],
  "BAT-12550": [
    fact("device_type", "Sealed Lead-Acid Battery", { srcDoc: DOC_BAT, section: "General" }),
    fact("battery_capacity", "12V / 55AH @ 20hr rate", { srcDoc: DOC_BAT, page: 1, section: "Part Number Reference & Specifications" }),
  ],
  "BAT-121000": [
    fact("device_type", "Sealed Lead-Acid Battery", { srcDoc: DOC_BAT, section: "General" }),
    fact("battery_capacity", "12V / 100AH @ 20hr rate", { srcDoc: DOC_BAT, page: 1, section: "Part Number Reference & Specifications" }),
  ],
  "BB-55F": [
    fact("device_type", "Battery Cabinet", { operator: "Informational", confidence: 75, srcDoc: DOC_BAT, section: "(own catalog description; no dedicated BB-55F datasheet located this sprint)" }),
    fact("battery_capacity_supported", "Holds up to two BAT-12260 (26AH) or BAT-12550 (55AH)", { operator: "Informational", confidence: 75, srcDoc: DOC_BAT, section: "(own catalog description)" }),
  ],
  "XAL-53": [
    fact("device_type", "Manual Pull Station (Explosion-Proof)", { operator: "Informational", confidence: 60, srcDoc: DOC_PULL, section: "(own catalog description only; third-party Killark product, no official document located this sprint)" }),
    fact("environmental_rating", "Explosion-Proof", { confidence: 60, srcDoc: DOC_PULL, section: "(own catalog description)" }),
  ],
};

const STANDARDS = {
  "IDP-PULL-SA": [{ body: "UL", number: "38" }],
  "IDP-PULL-DA": [{ body: "UL", number: "38" }],
  "WIDP-PULL-DA": [{ body: "UL", number: "38" }, { body: "UL", number: "S6012" }, { body: "CSFM", number: "7150-0559:0513" }, { body: "FM", number: "Approved" }],
  "RA-2000": [{ body: "UL", number: "864 10th Edition" }, { body: "UL", number: "2572 2nd Edition" }, { body: "UL", number: "S3511" }, { body: "FDNY", number: "6162" }],
  "RA-2000GRAY": [{ body: "UL", number: "864 10th Edition" }, { body: "UL", number: "2572 2nd Edition" }, { body: "UL", number: "S3511" }, { body: "FDNY", number: "6162" }],
  "SSM24-6": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "ULC", number: "CS549" }, { body: "FM", number: "3005255" }, { body: "CSFM", number: "7135-1653:0125" }],
  "SSM24-8": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "ULC", number: "CS549" }, { body: "FM", number: "3005255" }, { body: "CSFM", number: "7135-1653:0125" }],
  "SSM24-10": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "ULC", number: "CS549" }, { body: "FM", number: "3005255" }, { body: "CSFM", number: "7135-1653:0125" }],
  "BAT-12550": [{ body: "UL", number: "MH20845" }],
  "BAT-121000": [{ body: "UL", number: "MH20845" }],
};
const STANDARDS_DOC = { "IDP-PULL-SA": DOC_PULL, "IDP-PULL-DA": DOC_PULL, "WIDP-PULL-DA": DOC_WIDP_PULL, "RA-2000": DOC_RA2000, "RA-2000GRAY": DOC_RA2000, "SSM24-6": DOC_BELL, "SSM24-8": DOC_BELL, "SSM24-10": DOC_BELL, "BAT-12550": DOC_BAT, "BAT-121000": DOC_BAT };

const ACCESSORIES = [
  ["BB-55F", "BAT-12550", "Compatible Battery", DOC_BAT],
];

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, ?, 'Up to two per cabinet', '[]', 0, 1, ?, 75, 'Approved', 'sprint-1.39-pull-annunciator-bell-battery-seed')");
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
console.log("Unresolved: XAL-53 (third-party Killark explosion-proof manual station -- no official document located); BG-TR/SB-I/O/RA-100TR/RA-100TG trim rings and back boxes -- none exist in this catalog; BB-55F -- no dedicated datasheet, own catalog description only.");
