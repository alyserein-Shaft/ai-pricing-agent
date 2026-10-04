#!/usr/bin/env node
/**
 * Sprint 1.25 -- closes the Product Knowledge evidence gap for Opera item
 * 36's actual Top-1 candidate, IDP-HEAT-ROR-IV, against its two confirmed
 * requirements (req_345, req_346).
 *
 * req_345 ("Heat detector heads shall include combination rate-of-rise and
 * rate compensated fixed temperature sensing, two levels of rate-of-rise
 * sensitivity selectable at the panel, and an independent 135 degrees F
 * fixed temperature set point.") bundles several distinct technical claims.
 * Only the two that are explicitly, literally stated by official Honeywell
 * documentation for this exact part number are structured here:
 *   - detection_principle = "Fixed Temperature and Rate-of-Rise"
 *   - fixed_temperature_setpoint = "135°F"
 * Deliberately NOT structured (not literally stated by any source checked,
 * so asserting them would be inference, not evidence):
 *   - "rate COMPENSATED" specifically (the sources describe a combination
 *     fixed-temperature + rate-of-rise thermistor sensor, never using the
 *     word "compensated")
 *   - "two levels of rate-of-rise sensitivity selectable at the panel" (the
 *     sources only describe generic FACP-programmable sensitivity, common to
 *     every IDP thermal detector, never a specific "two levels" claim)
 * These two remain an accepted, honestly-reported gap in req_345's own
 * unstructured fallback -- exactly Sprint 1.21's own established pattern for
 * partial requirement structuring (see requirement_389's flash_rate).
 *
 * req_346 ("Heat detector heads shall be self-restoring.") is NOT structured
 * at all. Three official Honeywell/Silent Knight documents were checked --
 * none states this fact explicitly for this device. Asserting it anyway
 * would be exactly the kind of inference (from device technology/PN suffix)
 * this task explicitly forbids. Left as a genuine, reported, unresolved
 * requirement.
 *
 * Sources (both explicitly name IDP-HEAT-ROR-IV or IDP-HEAT-ROR by name --
 * never inferred from the "-ROR-IV" suffix alone):
 * - Honeywell Farenhyt "IDP-HEAT/IDP-HEAT-HT/IDP-HEAT-ROR -- Intelligent
 *   Thermal and Rate of Rise Thermal Detectors" (Doc 350285, Rev H, 12/17):
 *   "IDP-Heat-ROR is a fixed temperature and rate-of-rise thermal detector
 *   that uses a thermistor sensing circuit to produce 135ºF (57ºC) thermal
 *   protection" (p.1); "THERMAL RATINGS -- IDP-Heat-ROR: Rate-of-rise
 *   detection 15ºF/min (9ºC/min)" (p.2).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Farenhyt-120425/hon-ba-fire-350285-heat-heat-ht.pdf
 * - Honeywell Farenhyt "IDP-HEAT-W Series -- Intelligent Thermal Detector"
 *   (Doc 351630, Rev A, 04/18): Ordering Information explicitly names
 *   "IDP-HEAT-ROR-IV: Same as IDP-HEAT-ROR-W, but in Ivory" (p.2, the same
 *   color-only variant relationship this project's own catalog already
 *   documents for every IDP-HEAT SKU); "Rate-of-Rise Detection: Responds to
 *   greater than 15°F/minute or 135°F (8.3°C/minute or 57°C)" (p.3).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_HEAT_W_Datasheet.pdf
 *
 * Idempotent: skips an attribute name already present. Never overwrites or
 * removes an existing entry.
 *
 * Usage:
 *   node scripts/seed-idp-heat-ror-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-idp-heat-ror-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-idp-heat-ror-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();

const REQ_345 = "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_345";
const PART_NUMBER = "IDP-HEAT-ROR-IV";

const DOC_A = { sourceId: "Honeywell Farenhyt -- \"IDP-HEAT/IDP-HEAT-HT/IDP-HEAT-ROR: Intelligent Thermal and Rate of Rise Thermal Detectors\" (Doc 350285, Rev H, 12/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Farenhyt-120425/hon-ba-fire-350285-heat-heat-ht.pdf" };
const DOC_B = { sourceId: "Honeywell Farenhyt -- \"IDP-HEAT-W Series: Intelligent Thermal Detector\" (Doc 351630, Rev A, 04/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_HEAT_W_Datasheet.pdf" };

const PRODUCT_ATTRIBUTES = [
  { name: "detection_principle", operator: "Equal", originalValue: "IDP-Heat-ROR is a fixed temperature and rate-of-rise thermal detector that uses a thermistor sensing circuit to produce 135ºF (57ºC) thermal protection.", normalizedValue: "Fixed Temperature and Rate-of-Rise", confidence: 90, doc: DOC_A, page: 1, section: "Product Description" },
  { name: "fixed_temperature_setpoint", operator: "Equal", originalValue: "Rate-of-Rise Detection: Responds to greater than 15°F/minute or 135°F (8.3°C/minute or 57°C)", normalizedValue: "135°F", confidence: 90, doc: DOC_B, page: 3, section: "Environmental" },
  { name: "rate_of_rise_sensitivity", operator: "Informational", originalValue: "THERMAL RATINGS -- IDP-Heat-ROR: Rate-of-rise detection 15ºF/min (9ºC/min)", normalizedValue: "15°F/min", confidence: 90, doc: DOC_A, page: 2, section: "Thermal Ratings" },
];

// Mirrors requirement_389's flash_rate precedent: no unit field, since this
// engine's UNIT_DEFINITIONS has no Temperature family at all -- setting one
// would make compareAttribute try (and fail) unit conversion instead of a
// direct value comparison.
const REQUIREMENT_ATTRIBUTES = [
  { requirementId: REQ_345, name: "detection_principle", operator: "Equal", originalValue: "combination rate-of-rise and rate compensated fixed temperature sensing", normalizedValue: "Fixed Temperature and Rate-of-Rise", confidence: 80 },
  { requirementId: REQ_345, name: "fixed_temperature_setpoint", operator: "Equal", originalValue: "an independent 135 degrees F fixed temperature set point", normalizedValue: "135°F", confidence: 85 },
];

const getProductByPartNumber = db.prepare("SELECT id, part_number, attributes FROM library_products WHERE part_number = ?");
const updateProductAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const getRequirement = db.prepare("SELECT source_location FROM technical_requirements WHERE id = ?");
const getExistingReqAttrs = db.prepare("SELECT name FROM requirement_attributes WHERE requirement_id = ?");
const insertReqAttr = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)");

let productAttrsAppended = 0, productAttrsSkipped = 0, reqAttrsInserted = 0, reqAttrsSkipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  const product = getProductByPartNumber.get(PART_NUMBER);
  if (!product) throw new Error(`Product not found in catalog: ${PART_NUMBER}`);
  const existing = JSON.parse(product.attributes || "[]");
  const existingNames = new Set(existing.map((entry) => norm(entry.name)));
  const toAppend = PRODUCT_ATTRIBUTES.filter((entry) => !existingNames.has(norm(entry.name)));
  for (const entry of PRODUCT_ATTRIBUTES.filter((entry) => existingNames.has(norm(entry.name)))) { console.log(`SKIP (already present): ${PART_NUMBER} -> ${entry.name}`); productAttrsSkipped += 1; }
  if (toAppend.length) {
    const appended = toAppend.map((entry) => ({
      name: entry.name, operator: entry.operator, originalValue: entry.originalValue, normalizedValue: entry.normalizedValue, confidence: entry.confidence,
      source: { sourceType: "Manufacturer Official Datasheet", sourceId: entry.doc.sourceId, url: entry.doc.url, page: entry.page, section: entry.section },
    }));
    for (const entry of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${PART_NUMBER} -> ${entry.name} = ${JSON.stringify(entry.normalizedValue)}`);
    if (apply) updateProductAttributes.run(JSON.stringify([...existing, ...appended]), product.id);
    productAttrsAppended += appended.length;
  }

  for (const entry of REQUIREMENT_ATTRIBUTES) {
    const requirement = getRequirement.get(entry.requirementId);
    if (!requirement) throw new Error(`Requirement not found: ${entry.requirementId}`);
    const existingReqNames = (getExistingReqAttrs.all(entry.requirementId) || []).map((row) => norm(row.name));
    const label = `${entry.requirementId} -> ${entry.name} = ${JSON.stringify(entry.normalizedValue)}`;
    if (existingReqNames.includes(norm(entry.name))) { console.log(`SKIP (already present): ${label}`); reqAttrsSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_attributes: ${label}`);
    if (apply) {
      const id = `${entry.requirementId}_attribute_${entry.name}`;
      insertReqAttr.run(id, entry.requirementId, entry.name, entry.operator, entry.originalValue, JSON.stringify(entry.normalizedValue), entry.confidence, requirement.source_location);
    }
    reqAttrsInserted += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${productAttrsAppended} product attribute${productAttrsAppended === 1 ? "" : "s"} ${apply ? "inserted" : "would be inserted"} on ${PART_NUMBER} (${productAttrsSkipped} already present, skipped); ${reqAttrsInserted} requirement attribute${reqAttrsInserted === 1 ? "" : "s"} ${apply ? "inserted" : "would be inserted"} (${reqAttrsSkipped} already present, skipped). requirement_346 (self-restoring) left unstructured -- no official source checked states this fact explicitly.`);
