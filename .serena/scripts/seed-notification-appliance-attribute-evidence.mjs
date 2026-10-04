#!/usr/bin/env node
/**
 * Sprint 1.24 -- closes the remaining Product Knowledge attribute gaps for
 * the notification-appliance candidates that Sprint 1.23's family/matching
 * precision fix correctly surfaced as the real Top-1/Top-3 for items
 * 30/32/33 (P4WK, P2RHK, P2RL-LF -- Sounder/Strobe family; SPSRK, SPSWL,
 * SPSWL-ALERT -- Speaker/Strobe family). Every value below is taken
 * verbatim from an official System Sensor (Honeywell) datasheet that
 * EXPLICITLY names the exact part number in its own ordering table --
 * never inferred from family similarity, never a bulk catalog backfill:
 *
 * - "Outdoor Selectable-Output Horns, Strobes, and Horn Strobes"
 *   (System Sensor SpectrAlert Advance, Doc A05-0456-002, 11/09) --
 *   explicitly lists P4WK and P2RHK in its Ordering Information table.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/OutdoorHorns-Strobes-HornStrobes_DataSheet_A05-0456.pdf
 *   - p.2 "Horn Strobe Combination": "flashing at 1 Hz over the strobe's
 *     entire operating voltage range"
 *   - p.1 "Universal mounting plate for wall- and ceiling-mount units";
 *     p.2 General: "A universal mounting plate shall be used for mounting
 *     ceiling and wall products"
 *   - p.4 Ordering Information: P4WK = "4-Wire Horn Strobe, Standard cd,
 *     White, Outdoor"; P2RHK = "2-Wire Horn Strobe, High cd, Red, Outdoor";
 *     "Standard cd" = 15,15/75,30,75,95,110,115; "High cd" =
 *     135,150,177,185.
 *
 * - "Indoor Selectable-Output Low Frequency Sounders and Low Frequency
 *   Sounder Strobes" (System Sensor L-Series, Doc AVDS910-02, 11/02/2020)
 *   -- explicitly lists P2RL-LF in its Ordering Information table.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Lw-Frqncy-Sndrs-Sndr-Strbs_Data-Sheet_AVDS910.pdf
 *   - p.2: "Strobe Flash Rate: 1 flash per second"; "Frequency Range: 520
 *     Hz +/- 10%"; General: "A universal mounting plate shall be used for
 *     mounting products."
 *   - p.4 Ordering Information: P2RL-LF = "LF Sounder Strobe, Wall"; Wall
 *     candela settings 15,30,75,95,110,135,185.
 *
 * - "SpectrAlert Advance Outdoor Speaker and Speaker Strobe Specifications"
 *   (System Sensor, Doc AVDS1130-1, 09/12) -- explicitly lists SPSRK in its
 *   Ordering Information table.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Outdoor_Wall_Speakers_SpeakerStrobes_DataSheet_AVDS1131.pdf
 *   - p.2: "Strobe Flash Rate: 1 flash per second"; "Frequency Range: 400
 *     to 4,000 Hz"; "Power: 1/4, 1/2, 1, 2 watts"; General: "A universal
 *     mounting plate shall be used for mounting ceiling and wall products."
 *   - p.3 Sound Output, UL Reverberant dBA @ 10 ft, Outdoor Speaker/Strobe:
 *     2W=89, 1W=86, 1/2W=83, 1/4W=80.
 *   - p.4 Ordering Information: SPSRK = "Outdoor Speaker Strobe, Standard
 *     cd"; Standard cd = 15,15/75,30,75,95,110,115.
 *
 * - "Indoor Selectable-Output Speaker Strobes and Dual Voltage Evacuation
 *   Speakers for Wall Applications" (System Sensor L-Series, Doc
 *   AVDS867-03, 6/6/2019) -- explicitly lists SPSWL and SPSWL-ALERT in its
 *   own Ordering Information table (a DIFFERENT product line from SPSRK's
 *   SpectrAlert Advance outdoor family -- deliberately not conflated).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Speakers_Strobes_Wall_DataSheet_AVDS867.pdf
 *   - p.2: "Strobe Flash Rate: 1 flash per second"; "Frequency Range: 400
 *     to 4,000 Hz3" (520 Hz +/-10% tone capability is a SEPARATE optional
 *     mode, not this fact); "Power: 1/4, 1/2, 1, 2 watts"; General: "A
 *     universal mounting plate shall be used for mounting ceiling and wall
 *     products."
 *   - p.3 Sound Output Speaker Strobe, UL Reverberant dBA @ 10 ft: 1/4W=77,
 *     1/2W=80, 1W=83, 2W=86.
 *   - p.4 Ordering Information: candela settings 15,30,75,95,110,135,185
 *     (a genuinely different set from the outdoor SpectrAlert Advance
 *     line -- kept separate, never merged).
 *
 * Two requirement-side facts are ALSO structured here (requirement_attributes),
 * extending Sprint 1.21's own flash_rate precedent for requirement_389, now
 * that real product-side evidence exists to compare against:
 *   - requirement_397 ("...combined on a single mounting plate") ->
 *     mounting_plate = "Universal Mounting Plate" (Equal). Every one of the
 *     six candidates above genuinely uses this exact universal/single
 *     mounting plate design per their own datasheet, so this is a safe,
 *     non-range, non-list categorical fact.
 *   - requirement_387 ("...produce a sound level of 82 dBA at 10 feet when
 *     set at the 1/2 watt tap") -> sound_output = 82 dB (Minimum -- an
 *     audibility floor, the standard engineering reading of a "shall
 *     produce X dBA" clause). Deliberately Minimum, not Equal: a louder
 *     device is not a defect.
 * Deliberately NOT structured (would risk a subtly wrong comparison, exactly
 * the concern Sprint 1.21 raised for this same clause):
 *   - requirement_387's frequency range ("125 to 12,000 Hertz") -- this
 *     engine's compareAttribute only supports a single value + operator,
 *     not a two-sided range-encloses-range comparison; inventing a
 *     min/max attribute pair now would be a new, untested comparison shape.
 *     The real, evidenced product frequency ranges (400-4,000 Hz for every
 *     candidate here) are recorded as INFORMATIONAL product attributes only
 *     (frequency_range), never wired to a required value.
 *   - requirement_387's "four taps rated 1/4 to 2 watts" -- compareAttribute's
 *     list operators (Includes/All Of) do unsafe substring matching on
 *     numeric fragments ("1", "2") that would trivially pass against almost
 *     any string. Recorded as an informational product attribute
 *     (power_taps) only.
 *   - candela ("as shown") -- requirement_389 itself is drawing-dependent,
 *     never a fixed required value (Sprint 1.21's own reasoning, unchanged).
 *     Recorded as an informational product attribute (candela_rating) only.
 *
 * Idempotent: skips a product attribute whose name is already present on
 * that product, and a requirement attribute whose name is already present
 * on that requirement. Never overwrites or removes an existing entry.
 *
 * Usage:
 *   node scripts/seed-notification-appliance-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-notification-appliance-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-notification-appliance-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();

const REQ_387 = "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_387";
const REQ_397 = "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_397";

const HORN_STROBE_DOC = { sourceId: "System Sensor SpectrAlert Advance -- \"Outdoor Selectable-Output Horns, Strobes, and Horn Strobes\" (Doc A05-0456-002, 11/09)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/OutdoorHorns-Strobes-HornStrobes_DataSheet_A05-0456.pdf" };
const LF_SOUNDER_STROBE_DOC = { sourceId: "System Sensor L-Series -- \"Indoor Selectable-Output Low Frequency Sounders and Low Frequency Sounder Strobes\" (Doc AVDS910-02, 11/02/2020)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Lw-Frqncy-Sndrs-Sndr-Strbs_Data-Sheet_AVDS910.pdf" };
const OUTDOOR_SPEAKER_STROBE_DOC = { sourceId: "System Sensor SpectrAlert Advance -- \"Outdoor Speaker and Speaker Strobe Specifications\" (Doc AVDS1130-1, 09/12)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Outdoor_Wall_Speakers_SpeakerStrobes_DataSheet_AVDS1131.pdf" };
const L_SERIES_SPEAKER_STROBE_DOC = { sourceId: "System Sensor L-Series -- \"Indoor Selectable-Output Speaker Strobes and Dual Voltage Evacuation Speakers for Wall Applications\" (Doc AVDS867-03, 6/6/2019)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Speakers_Strobes_Wall_DataSheet_AVDS867.pdf" };

// PRODUCT-side attribute evidence, keyed by real catalog part number.
const PRODUCT_ATTRIBUTES = [
  { partNumber: "P4WK", doc: HORN_STROBE_DOC, entries: [
    { name: "flash_rate", operator: "Equal", originalValue: "flashing at 1 Hz over the strobe's entire operating voltage range", normalizedValue: "1 Hz", confidence: 95, page: 2, section: "Horn Strobe Combination" },
    { name: "mounting_plate", operator: "Equal", originalValue: "A universal mounting plate shall be used for mounting ceiling and wall products.", normalizedValue: "Universal Mounting Plate", confidence: 90, page: 2, section: "General" },
    { name: "candela_rating", operator: "Informational", originalValue: "\"Standard cd\" refers to strobes that include 15, 15/75, 30, 75, 95, 110, and 115 candela settings.", normalizedValue: "15, 15/75, 30, 75, 95, 110, 115 cd (Standard)", confidence: 90, page: 4, section: "Ordering Information" },
  ] },
  { partNumber: "P2RHK", doc: HORN_STROBE_DOC, entries: [
    { name: "flash_rate", operator: "Equal", originalValue: "flashing at 1 Hz over the strobe's entire operating voltage range", normalizedValue: "1 Hz", confidence: 95, page: 2, section: "Horn Strobe Combination" },
    { name: "mounting_plate", operator: "Equal", originalValue: "A universal mounting plate shall be used for mounting ceiling and wall products.", normalizedValue: "Universal Mounting Plate", confidence: 90, page: 2, section: "General" },
    { name: "candela_rating", operator: "Informational", originalValue: "\"High cd\" refers to strobes that include 135, 150, 177, and 185 candela settings.", normalizedValue: "135, 150, 177, 185 cd (High)", confidence: 90, page: 4, section: "Ordering Information" },
  ] },
  { partNumber: "P2RL-LF", doc: LF_SOUNDER_STROBE_DOC, entries: [
    { name: "flash_rate", operator: "Equal", originalValue: "Strobe Flash Rate: 1 flash per second", normalizedValue: "1 Hz", confidence: 95, page: 2, section: "Physical/Electrical Specifications" },
    { name: "mounting_plate", operator: "Equal", originalValue: "A universal mounting plate shall be used for mounting products.", normalizedValue: "Universal Mounting Plate", confidence: 90, page: 2, section: "General" },
    { name: "candela_rating", operator: "Informational", originalValue: "Wall units: 15, 30, 75, 95, 110, 135, and 185.", normalizedValue: "15, 30, 75, 95, 110, 135, 185 cd", confidence: 90, page: 2, section: "General" },
    { name: "frequency", operator: "Informational", originalValue: "Frequency Range: 520 Hz +/- 10%", normalizedValue: "520 Hz", confidence: 90, page: 2, section: "Physical/Electrical Specifications" },
  ] },
  { partNumber: "SPSRK", doc: OUTDOOR_SPEAKER_STROBE_DOC, entries: [
    { name: "flash_rate", operator: "Equal", originalValue: "Strobe Flash Rate: 1 flash per second", normalizedValue: "1 Hz", confidence: 95, page: 2, section: "Electrical/Operating Specifications" },
    { name: "mounting_plate", operator: "Equal", originalValue: "A universal mounting plate shall be used for mounting ceiling and wall products.", normalizedValue: "Universal Mounting Plate", confidence: 90, page: 2, section: "General" },
    { name: "sound_output", operator: "Equal", originalValue: "UL Reverberant dBA @ 10 ft, Outdoor Speaker/Strobe, 1/2 W tap: 83 dBA", normalizedValue: 83, normalizedUnit: "dB", confidence: 90, page: 3, section: "Sound Output" },
    { name: "frequency_range", operator: "Informational", originalValue: "Frequency Range: 400 to 4,000 Hz", normalizedValue: "400-4000 Hz", confidence: 90, page: 2, section: "Electrical/Operating Specifications" },
    { name: "power_taps", operator: "Informational", originalValue: "Power: 1/4, 1/2, 1, 2 watts", normalizedValue: "1/4 W, 1/2 W, 1 W, 2 W", confidence: 90, page: 2, section: "Electrical/Operating Specifications" },
    { name: "candela_rating", operator: "Informational", originalValue: "SPSRK = Outdoor Speaker Strobe, Standard cd; Standard cd = 15,15/75,30,75,95,110,115.", normalizedValue: "15, 15/75, 30, 75, 95, 110, 115 cd (Standard)", confidence: 90, page: 4, section: "Ordering Information" },
  ] },
  { partNumber: "SPSWL", doc: L_SERIES_SPEAKER_STROBE_DOC, entries: [
    { name: "flash_rate", operator: "Equal", originalValue: "Strobe Flash Rate: 1 flash per second", normalizedValue: "1 Hz", confidence: 95, page: 2, section: "Electrical/Operating Specifications" },
    { name: "mounting_plate", operator: "Equal", originalValue: "A universal mounting plate shall be used for mounting ceiling and wall products.", normalizedValue: "Universal Mounting Plate", confidence: 90, page: 2, section: "General" },
    { name: "sound_output", operator: "Equal", originalValue: "Sound Output Speaker Strobe, UL Reverberant dBA @ 10 ft, 1/2 W tap: 80 dBA", normalizedValue: 80, normalizedUnit: "dB", confidence: 90, page: 3, section: "Sound Output" },
    { name: "frequency_range", operator: "Informational", originalValue: "Frequency Range: 400 to 4,000 Hz", normalizedValue: "400-4000 Hz", confidence: 90, page: 2, section: "Electrical/Operating Specifications" },
    { name: "power_taps", operator: "Informational", originalValue: "Power: 1/4, 1/2, 1, 2 watts", normalizedValue: "1/4 W, 1/2 W, 1 W, 2 W", confidence: 90, page: 2, section: "Electrical/Operating Specifications" },
    { name: "candela_rating", operator: "Informational", originalValue: "Field selectable candela settings on wall units: 15, 30, 75, 95, 110, 135, 185.", normalizedValue: "15, 30, 75, 95, 110, 135, 185 cd", confidence: 90, page: 1, section: "Features" },
  ] },
  { partNumber: "SPSWL-ALERT", doc: L_SERIES_SPEAKER_STROBE_DOC, entries: [
    { name: "flash_rate", operator: "Equal", originalValue: "Strobe Flash Rate: 1 flash per second", normalizedValue: "1 Hz", confidence: 95, page: 2, section: "Electrical/Operating Specifications" },
    { name: "mounting_plate", operator: "Equal", originalValue: "A universal mounting plate shall be used for mounting ceiling and wall products.", normalizedValue: "Universal Mounting Plate", confidence: 90, page: 2, section: "General" },
    { name: "sound_output", operator: "Equal", originalValue: "Sound Output Speaker Strobe, UL Reverberant dBA @ 10 ft, 1/2 W tap: 80 dBA", normalizedValue: 80, normalizedUnit: "dB", confidence: 90, page: 3, section: "Sound Output" },
    { name: "frequency_range", operator: "Informational", originalValue: "Frequency Range: 400 to 4,000 Hz", normalizedValue: "400-4000 Hz", confidence: 90, page: 2, section: "Electrical/Operating Specifications" },
    { name: "power_taps", operator: "Informational", originalValue: "Power: 1/4, 1/2, 1, 2 watts", normalizedValue: "1/4 W, 1/2 W, 1 W, 2 W", confidence: 90, page: 2, section: "Electrical/Operating Specifications" },
    { name: "candela_rating", operator: "Informational", originalValue: "Field selectable candela settings on wall units: 15, 30, 75, 95, 110, 135, 185.", normalizedValue: "15, 30, 75, 95, 110, 135, 185 cd", confidence: 90, page: 1, section: "Features" },
  ] },
];

// REQUIREMENT-side attribute evidence -- see file header for why only these
// two facts (of req_387/397's several facts) are structured this sprint.
const REQUIREMENT_ATTRIBUTES = [
  { requirementId: REQ_397, name: "mounting_plate", operator: "Equal", originalValue: "combined on a single mounting plate", normalizedValue: "Universal Mounting Plate", normalizedUnit: null, confidence: 85 },
  { requirementId: REQ_387, name: "sound_output", operator: "Minimum", originalValue: "produce a sound level of 82 dBA at 10 feet when set at the 1/2 watt tap", normalizedValue: 82, normalizedUnit: "dB", confidence: 85 },
];

const getProductByPartNumber = db.prepare("SELECT id, part_number, attributes FROM library_products WHERE part_number = ?");
const updateProductAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const getRequirement = db.prepare("SELECT source_location FROM technical_requirements WHERE id = ?");
const getExistingReqAttrs = db.prepare("SELECT name FROM requirement_attributes WHERE requirement_id = ?");
const insertReqAttr = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?)");

let productsChanged = 0, productAttrsAppended = 0, productAttrsSkipped = 0, reqAttrsInserted = 0, reqAttrsSkipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const { partNumber, doc, entries } of PRODUCT_ATTRIBUTES) {
    const product = getProductByPartNumber.get(partNumber);
    if (!product) throw new Error(`Product not found in catalog: ${partNumber}`);
    const existing = JSON.parse(product.attributes || "[]");
    const existingNames = new Set(existing.map((entry) => norm(entry.name)));
    const toAppend = entries.filter((entry) => !existingNames.has(norm(entry.name)));
    productAttrsSkipped += entries.length - toAppend.length;
    for (const entry of entries.filter((entry) => existingNames.has(norm(entry.name)))) console.log(`SKIP (already present): ${partNumber} -> ${entry.name}`);
    if (!toAppend.length) continue;
    const appended = toAppend.map((entry) => ({
      name: entry.name, operator: entry.operator,
      originalValue: entry.originalValue, normalizedValue: entry.normalizedValue,
      ...(entry.normalizedUnit ? { normalizedUnit: entry.normalizedUnit } : {}),
      confidence: entry.confidence,
      source: { sourceType: "Manufacturer Official Datasheet", sourceId: doc.sourceId, url: doc.url, page: entry.page, section: entry.section },
    }));
    for (const entry of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${entry.name} = ${JSON.stringify(entry.normalizedValue)}${entry.normalizedUnit ? ` ${entry.normalizedUnit}` : ""}`);
    if (apply) updateProductAttributes.run(JSON.stringify([...existing, ...appended]), product.id);
    productsChanged += 1;
    productAttrsAppended += appended.length;
  }

  for (const entry of REQUIREMENT_ATTRIBUTES) {
    const requirement = getRequirement.get(entry.requirementId);
    if (!requirement) throw new Error(`Requirement not found: ${entry.requirementId}`);
    const existingNames = (getExistingReqAttrs.all(entry.requirementId) || []).map((row) => norm(row.name));
    const label = `${entry.requirementId} -> ${entry.name} = ${JSON.stringify(entry.normalizedValue)}${entry.normalizedUnit ? ` ${entry.normalizedUnit}` : ""}`;
    if (existingNames.includes(norm(entry.name))) { console.log(`SKIP (already present): ${label}`); reqAttrsSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_attributes: ${label}`);
    if (apply) {
      const id = `${entry.requirementId}_attribute_${entry.name}`;
      insertReqAttr.run(id, entry.requirementId, entry.name, entry.operator, entry.originalValue, JSON.stringify(entry.normalizedValue), entry.normalizedUnit || null, entry.confidence, requirement.source_location);
    }
    reqAttrsInserted += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${productsChanged} product${productsChanged === 1 ? "" : "s"} touched, ${productAttrsAppended} product attribute${productAttrsAppended === 1 ? "" : "s"} ${apply ? "inserted" : "would be inserted"} (${productAttrsSkipped} already present, skipped); ${reqAttrsInserted} requirement attribute${reqAttrsInserted === 1 ? "" : "s"} ${apply ? "inserted" : "would be inserted"} (${reqAttrsSkipped} already present, skipped).`);
