#!/usr/bin/env node
/**
 * Sprint 1.31 -- brings the Honeywell/Farenhyt Addressable Heat Detector
 * family from CLASSIFIED_BUT_SHALLOW to reusable technical readiness using
 * three official documents, each of which explicitly names every SKU it is
 * applied to here (never inferred from PN suffix alone):
 *
 * DOC_A: Honeywell Farenhyt "IDP-HEAT/IDP-HEAT-HT/IDP-HEAT-ROR -- Intelligent
 *   Thermal and Rate of Rise Thermal Detectors" (Doc 350285, Rev H, 12/17).
 *   Explicitly names all three bare technology variants and states, in one
 *   sentence, that "The IDP-HEAT, IDP-HEAT-HT, and IDP-HEAT-ROR are
 *   compatible with the following IDP series bases: B210LP, B501, B224BI,
 *   B224RB, B200SR" and "...compatible with the following Farenhyt Series
 *   FACPs: IFP-2100/IFP-2100ECS/RFP-2100, IFP-2000/IFP-2000ECS/RPS-2000,
 *   IFP-1000/IFP-1000ECS, IFP-300/IFP-300ECS, IFP-100/IFP-100ECS, IFP-75,
 *   IFP-50" -- and gives per-variant thermal ratings and one shared
 *   electrical rating table ("Operating Voltage: 15-32VDC").
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Farenhyt-120425/hon-ba-fire-350285-heat-heat-ht.pdf
 * DOC_B: Honeywell Farenhyt "IDP-HEAT-W Series -- Intelligent Thermal
 *   Detector" (Doc 351630, Rev A, 04/18). Its own Ordering Information
 *   section names IDP-HEAT-W/-IV, IDP-HEAT-ROR-W/-IV, and IDP-HEAT-HT-W/-IV
 *   individually by exact part number, and its Agency Listings section
 *   gives real, citable numbers: "UL listed: S2101" and "CSFM:
 *   7270-0559:0511" -- used here instead of the vague "UL Listing"/"FM
 *   Approved" placeholders already on file for these SKUs (which are left
 *   untouched, not treated as resolved).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_HEAT_W_Datasheet.pdf
 * DOC_C: Honeywell Farenhyt "WIDP-PHOTO, WIDP-ACCLIMATE, WIDP-HEAT-ROR,
 *   WIDP-HEAT -- SWIFT Wireless Detectors" (Doc 350615, Rev B, 10/18).
 *   Names WIDP-HEAT individually: "Intelligent wireless fixed-temperature
 *   (135°) heat detector. Requires one B210W base for installation." Its
 *   own Agency Listings section ("apply to the basic intelligent wireless
 *   detectors") gives "UL Listed: S6173 & S6228" and "CSFM:
 *   7254-0559:0509, 7272-0559:0506".
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-350615-B.pdf
 *
 * Kept genuinely distinct, per the task:
 * - Fixed-temperature (IDP-HEAT-IV/W), rate-of-rise (IDP-HEAT-ROR-IV/W), and
 *   high-temperature (IDP-HEAT-HT-IV/W) each get only the facts DOC_A states
 *   for that specific variant -- never cross-applied.
 * - WIDP-HEAT (wireless) gets its own base (B210W, not the wired bases) and
 *   its own standards from DOC_C, not DOC_A/DOC_B. No "Compatible With the
 *   control unit" relationship is added for it: unlike the wired SKUs, it
 *   reaches the FACP indirectly through a WIDP-WGI gateway, a materially
 *   different connection this session has not evidenced in enough detail
 *   to assert the same direct-SLC compatibility fact.
 * - Accessory bases are added matching each SKU's own color (IV -> the IV
 *   base, W -> the WHITE base), mirroring the existing IDP-HEAT-ROR-IV /
 *   B501-IV precedent rather than cross-linking every color combination.
 *
 * Deliberately NOT structured:
 * - protocol for WIDP-HEAT: it reaches the panel through a wireless mesh and
 *   gateway, not a direct fixed SLC protocol assignment; left unresolved.
 * - Any UL 521 citation for WIDP-HEAT: DOC_C's own "STANDARDS AND CODES"
 *   section names UL 864 and UL 268 for the SWIFT detector line generally,
 *   never UL 521 -- asserting it anyway would be inferring from the fact
 *   it is a heat detector, not from what the document actually states.
 * - B210LP base relationships: DOC_A names B210LP as compatible, but no
 *   B210LP product exists anywhere in this catalog to link to -- a real,
 *   reported catalog gap, not fabricated.
 *
 * Usage:
 *   node scripts/seed-heat-detector-family-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-heat-detector-family-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-heat-detector-family-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const DOC_A = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"IDP-HEAT/IDP-HEAT-HT/IDP-HEAT-ROR: Intelligent Thermal and Rate of Rise Thermal Detectors\" (Doc 350285, Rev H, 12/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Farenhyt-120425/hon-ba-fire-350285-heat-heat-ht.pdf" };
const DOC_B = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"IDP-HEAT-W Series: Intelligent Thermal Detector\" (Doc 351630, Rev A, 04/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_HEAT_W_Datasheet.pdf" };
const DOC_C = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"WIDP-PHOTO, WIDP-ACCLIMATE, WIDP-HEAT-ROR, WIDP-HEAT: SWIFT Wireless Detectors\" (Doc 350615, Rev B, 10/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-350615-B.pdf" };

const VOLTAGE_MIN = { name: "Voltage", operator: "Minimum", originalValue: "15VDC", parsedValue: 15, originalUnit: "V", normalizedValue: 15, normalizedUnit: "V", confidence: 94 };
const VOLTAGE_MAX = { name: "Voltage", operator: "Maximum", originalValue: "32VDC", parsedValue: 32, originalUnit: "V", normalizedValue: 32, normalizedUnit: "V", confidence: 94 };
const PROTOCOL = { name: "protocol", value: "IDP", origin: "EXTRACTED", confidence: 92, sourceText: "For use with Honeywell Farenhyt series fire alarm control panels (FACPs)... IDP series bases", extractionMethod: "manual-research-official-documentation", source: { ...DOC_A, page: 1, section: "Product Description / Compatibility" } };

const FIXED = { name: "detection_principle", value: "Fixed Temperature", origin: "EXTRACTED", confidence: 92, sourceText: "IDP-Heat is a fixed temperature thermal detector that uses a thermistor sensing circuit to produce 135ºF (57ºC) fixed thermal detection.", extractionMethod: "manual-research-official-documentation", source: { ...DOC_A, page: 1, section: "Product Description" } };
const FIXED_SETPOINT = { name: "fixed_temperature_setpoint", value: "135°F", origin: "EXTRACTED", confidence: 94, sourceText: "IDP-Heat: Fixed temperature setpoint 135ºF (57ºC)", extractionMethod: "manual-research-official-documentation", source: { ...DOC_A, page: 2, section: "Thermal Ratings" } };
const ROR = { name: "detection_principle", value: "Fixed Temperature and Rate-of-Rise", origin: "EXTRACTED", confidence: 92, sourceText: "IDP-Heat-ROR is a fixed temperature and rate-of-rise thermal detector that uses a thermistor sensing circuit to produce 135ºF (57ºC) thermal protection.", extractionMethod: "manual-research-official-documentation", source: { ...DOC_A, page: 1, section: "Product Description" } };
const ROR_SETPOINT = { name: "fixed_temperature_setpoint", value: "135°F", origin: "EXTRACTED", confidence: 94, sourceText: "IDP-Heat-ROR: Rate-of-rise detection 15ºF/min (9ºC/min)", extractionMethod: "manual-research-official-documentation", source: { ...DOC_A, page: 2, section: "Thermal Ratings" } };
const ROR_SENSITIVITY = { name: "rate_of_rise_sensitivity", value: "15°F/min", origin: "EXTRACTED", confidence: 94, sourceText: "IDP-Heat-ROR: Rate-of-rise detection 15ºF/min (9ºC/min)", extractionMethod: "manual-research-official-documentation", source: { ...DOC_A, page: 2, section: "Thermal Ratings" } };
const HT = { name: "detection_principle", value: "Variable High Temperature", origin: "EXTRACTED", confidence: 92, sourceText: "IDP-Heat-HT is a variable high temperature detector that provides high temperature detection at 135ºF – 190ºF (57ºC – 88ºC).", extractionMethod: "manual-research-official-documentation", source: { ...DOC_A, page: 1, section: "Product Description" } };
const HT_RANGE = { name: "high_temperature_range", value: "135°F-190°F", origin: "EXTRACTED", confidence: 94, sourceText: "IDP-Heat-HT: High temperature heat 135ºF – 190ºF (57ºC – 88ºC)", extractionMethod: "manual-research-official-documentation", source: { ...DOC_A, page: 2, section: "Thermal Ratings" } };

const WIDP_FIXED = { name: "detection_principle", value: "Fixed Temperature", origin: "EXTRACTED", confidence: 92, sourceText: "WIDP-HEAT: Intelligent wireless fixed-temperature (135°) heat detector.", extractionMethod: "manual-research-official-documentation", source: { ...DOC_C, page: 2, section: "SWIFT Components and Ordering Information" } };
const WIDP_SETPOINT = { name: "fixed_temperature_setpoint", value: "135°F", origin: "EXTRACTED", confidence: 94, sourceText: "Thermal Ratings: Fixed Temperature Set Point: 135°F (57°C)", extractionMethod: "manual-research-official-documentation", source: { ...DOC_C, page: 3, section: "Physical / Operating" } };

const PRODUCT_ATTRIBUTES = {
  "IDP-HEAT-IV": [FIXED, FIXED_SETPOINT, VOLTAGE_MIN, VOLTAGE_MAX, PROTOCOL],
  "IDP-HEAT-W": [FIXED, FIXED_SETPOINT, VOLTAGE_MIN, VOLTAGE_MAX, PROTOCOL],
  "IDP-HEAT-ROR-IV": [VOLTAGE_MIN, VOLTAGE_MAX, PROTOCOL],
  "IDP-HEAT-ROR-W": [ROR, ROR_SETPOINT, ROR_SENSITIVITY, VOLTAGE_MIN, VOLTAGE_MAX, PROTOCOL],
  "IDP-HEAT-HT-IV": [HT, HT_RANGE, VOLTAGE_MIN, VOLTAGE_MAX, PROTOCOL],
  "IDP-HEAT-HT-W": [HT, HT_RANGE, VOLTAGE_MIN, VOLTAGE_MAX, PROTOCOL],
  "WIDP-HEAT": [WIDP_FIXED, WIDP_SETPOINT],
};

const STANDARDS = {
  "IDP-HEAT-IV": [{ body: "UL", number: "S2101", originalText: "UL listed: S2101", page: 3, section: "Agency Listings and Approvals", doc: DOC_B }, { body: "CSFM", number: "7270-0559:0511", originalText: "CSFM: 7270-0559:0511", page: 3, section: "Agency Listings and Approvals", doc: DOC_B }],
  "IDP-HEAT-W": null, // mirrored below
  "IDP-HEAT-ROR-IV": null,
  "IDP-HEAT-ROR-W": null,
  "IDP-HEAT-HT-IV": null,
  "IDP-HEAT-HT-W": null,
  "WIDP-HEAT": [{ body: "UL", number: "S6173", originalText: "UL Listed: S6173 & S6228", page: 3, section: "Agency Listings and Approvals", doc: DOC_C }, { body: "UL", number: "S6228", originalText: "UL Listed: S6173 & S6228", page: 3, section: "Agency Listings and Approvals", doc: DOC_C }, { body: "CSFM", number: "7254-0559:0509", originalText: "CSFM: 7254-0559:0509, 7272-0559:0506", page: 3, section: "Agency Listings and Approvals", doc: DOC_C }, { body: "CSFM", number: "7272-0559:0506", originalText: "CSFM: 7254-0559:0509, 7272-0559:0506", page: 3, section: "Agency Listings and Approvals", doc: DOC_C }],
};
for (const pn of ["IDP-HEAT-W", "IDP-HEAT-ROR-IV", "IDP-HEAT-ROR-W", "IDP-HEAT-HT-IV", "IDP-HEAT-HT-W"]) STANDARDS[pn] = STANDARDS["IDP-HEAT-IV"];

const WIRED_IV = ["IDP-HEAT-IV", "IDP-HEAT-ROR-IV", "IDP-HEAT-HT-IV"];
const WIRED_W = ["IDP-HEAT-W", "IDP-HEAT-ROR-W", "IDP-HEAT-HT-W"];
const BASES_IV = ["B501-IV", "B224BI-IV", "B224RB-IV", "B200SR-IV"];
const BASES_W = ["B501-WHITE", "B224BI-WH", "B224RB-WH", "B200SR-WH"];
const ACCESSORIES = [
  ...WIRED_IV.flatMap((pn) => BASES_IV.map((base) => ({ partNumber: pn, accessoryPartNumber: base, doc: DOC_A }))),
  ...WIRED_W.flatMap((pn) => BASES_W.map((base) => ({ partNumber: pn, accessoryPartNumber: base, doc: DOC_A }))),
  { partNumber: "WIDP-HEAT", accessoryPartNumber: "B210W", doc: DOC_C },
];

const COMPATIBILITY_TARGETS = ["IDP-HEAT-IV", "IDP-HEAT-W", "IDP-HEAT-ROR-W", "IDP-HEAT-HT-IV", "IDP-HEAT-HT-W"]; // IDP-HEAT-ROR-IV already has it

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, 'Compatible Base', 'One per detector', '[]', 0, 1, ?, 92, 'Approved', 'sprint-1.31-heat-detector-family-seed')");
const existingAccessory = db.prepare("SELECT 1 FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND deleted_at IS NULL AND superseded_at IS NULL");
const existingRelationship = db.prepare("SELECT 1 FROM engineering_relationships WHERE left_entity_type='Product' AND left_entity_id=? AND relationship_type='Compatible With' AND status='Approved'");
const insertFact = db.prepare("INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, model_version) VALUES (?, NULL, 'Product', ?, 'Compatible With Control Unit', ?, 'Object', 'Compatible With', 'Manufacturer Rule', 'Product', ?, 'Approved', 96, 'engineering-knowledge-1.0.0')");
const insertRelationship = db.prepare("INSERT INTO engineering_relationships (id, project_id, left_entity_type, left_entity_id, relationship_type, right_entity_type, right_entity_id, conditions, exceptions, fact_type, scope_type, scope_id, provenance_fact_id, confidence, status, created_by) VALUES (?, NULL, 'Product', ?, 'Compatible With', 'System', 'the control unit', ?, '[]', 'Manufacturer Rule', 'Product', ?, ?, 96, 'Approved', 'sprint-1.31-heat-detector-family-seed')");

let attrsAdded = 0, attrsSkipped = 0, stdsAdded = 0, stdsSkipped = 0, accAdded = 0, accSkipped = 0, compatAdded = 0, compatSkipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const [partNumber, attrs] of Object.entries(PRODUCT_ATTRIBUTES)) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.attributes || "[]");
    const existingNames = new Set(existing.map((e) => norm(e.name)));
    const toAdd = attrs.filter((a) => !existingNames.has(norm(a.name)));
    for (const a of attrs.filter((a) => existingNames.has(norm(a.name)))) { console.log(`SKIP (already present): ${partNumber} -> ${a.name}${a.operator ? " " + a.operator : ""}`); attrsSkipped += 1; }
    if (toAdd.length) {
      for (const a of toAdd) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${a.name}${a.operator ? " " + a.operator : ""} = ${JSON.stringify(a.value ?? a.normalizedValue)}`);
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
      const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, originalText: s.originalText, status: "Verified", confidence: 95, source: { sourceType: s.doc.sourceType, sourceId: s.doc.sourceId, url: s.doc.url, page: s.page, section: s.section } }));
      for (const s of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${s.body} ${s.number}`);
      if (apply) updateStandards.run(JSON.stringify([...existing, ...appended]), product.id);
      stdsAdded += appended.length;
    }
  }

  for (const a of ACCESSORIES) {
    const product = getProduct.get(a.partNumber);
    if (!product) throw new Error(`Product not found: ${a.partNumber}`);
    const accessory = getProduct.get(a.accessoryPartNumber);
    if (!accessory) throw new Error(`Accessory product not found: ${a.accessoryPartNumber}`);
    if (existingAccessory.get(product.id, accessory.id)) { console.log(`SKIP (already present): ${a.partNumber} -> ${a.accessoryPartNumber}`); accSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${a.partNumber} -> Compatible Base: ${a.accessoryPartNumber}`);
    if (apply) insertAccessory.run(id("productaccessory"), product.id, accessory.id, JSON.stringify([{ sourceType: a.doc.sourceType, sourceId: a.doc.sourceId, url: a.doc.url }]));
    accAdded += 1;
  }

  for (const partNumber of COMPATIBILITY_TARGETS) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    if (existingRelationship.get(product.id)) { console.log(`SKIP (already present): ${partNumber} -> Compatible With the control unit`); compatSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> Compatible With the control unit`);
    if (apply) {
      const factId = id("fact_farenhyt_compat");
      const value = JSON.stringify({ targetRole: "the control unit", panelFamily: "Honeywell Farenhyt IFP-2100/RFP-2100 Series", protocol: "IDP (Intelligent Device Protocol) SLC loop", note: "Explicitly named in the IDP-HEAT/IDP-HEAT-HT/IDP-HEAT-ROR datasheet's own Compatibility section (Doc 350285, p.2)." });
      insertFact.run(factId, product.id, value, product.id);
      insertRelationship.run(id("relationship"), product.id, JSON.stringify([{ type: "documented_evidence", panelFamily: "IFP-2100/RFP-2100 Series", protocol: "IDP", note: "Doc 350285 p.2 Compatibility section." }]), product.id, factId);
    }
    compatAdded += 1;
  }

  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} attributes (${attrsSkipped} skipped); ${stdsAdded} standards (${stdsSkipped} skipped); ${accAdded} accessory relationships (${accSkipped} skipped); ${compatAdded} FACP compatibility relationships (${compatSkipped} skipped). B210LP base and WIDP-HEAT protocol left unresolved (no catalog match / no direct-SLC evidence).`);
