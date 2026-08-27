#!/usr/bin/env node
/**
 * Sprint 1.38 -- brings the standalone Strobe (23 real SKUs, after removing
 * 12 accessory false positives this same sprint), Sounder (15 SKUs), and
 * Speaker (7 SKUs) families from CLASSIFIED_BUT_SHALLOW to reusable
 * technical readiness by REUSING the exact official documents already
 * fetched and read in Sprint 1.32 (Sounder/Strobe, Speaker/Strobe) -- no
 * new documents were fetched this sprint. Every one of these documents'
 * own ordering-information tables explicitly names the standalone sibling
 * SKUs alongside the combo products already enriched, which is what makes
 * this family-level reuse safe rather than inferred.
 *
 * DOC_WALL_L (351574)      Own "Horns" and (Wall) "Strobes" ordering tables
 *   explicitly name HRL, HWL, HGRL, HGWL (horns) and SRL, SWL, SGRL, SGWL,
 *   SRL-P, SWL-P, SRL-SP (strobes) alongside the P2* horn/strobe combos
 *   already enriched.
 * DOC_CEIL_L (AVDS868)     Own ordering table explicitly names SCRL, SCWL
 *   (ceiling strobes) alongside PC2 and PC4 combos already enriched.
 * DOC_LF (AVDS910)         Own ordering table explicitly names HRL-LF/
 *   HWL-LF (wall), HGRL-LF/HGWL-LF (compact wall), HCRL-LF/HCWL-LF
 *   (ceiling) as standalone Low Frequency Sounders -- a distinct product
 *   line in the SAME document as the LF Sounder Strobe combos already
 *   enriched.
 * DOC_OUTDOOR_HS (A05-0456) Own ordering table explicitly names SRK/SRHK/
 *   SWK/SWHK (wall strobes), SCRK/SCRHK/SCWK/SCWHK (ceiling strobes), and
 *   HRK (horn) alongside the P2*K horn/strobe combos already enriched.
 * DOC_WALL_SPK_L (AVDS867) Own ordering table explicitly names SPWL/SPRL
 *   as "Speaker only" alongside the SPSWL/SPSRL speaker/strobe combos
 *   already enriched.
 * DOC_CEIL_SPK_L (AVDS866) Own ordering table explicitly names SPCWL/SPCRL
 *   as "Speaker only" alongside the SPSCWL/SPSCRL combos already enriched.
 * DOC_WALL_SPK_OUT (AVDS11301) Own ordering table explicitly names SPWK/
 *   SPRK ("Outdoor Speaker, includes plastic weatherproof back box")
 *   alongside the SPSWK/SPSRK combos already enriched.
 * DOC_CEIL_SPK_OUT (AVDS00901) Own ordering table explicitly names SPCWK
 *   ("Outdoor Speaker, includes plastic weatherproof back box") alongside
 *   the SPSCWK/SPSCWHK combos already enriched.
 * DOC_TILE (AVDS908, referenced from Sprint 1.32)  Own UL S4048 listing
 *   table names SPCWL-TILE among the drop-in tile speaker line.
 *
 * Kept genuinely distinct per the task:
 * - Strobe-only, Horn-only, and Speaker-only are each a real, separate
 *   product line from their combo siblings -- their own attributes
 *   (candela/flash rate for strobe; sound output/tone for horn; frequency
 *   range/power taps for speaker) are cited to the SAME document but never
 *   cross-applied between horn/strobe/speaker device types.
 * - Indoor L-Series vs Outdoor SpectrAlert Advance vs Low-Frequency are
 *   kept as distinct product lines with their own standards and voltage
 *   behavior, matching the same distinctions already established for the
 *   combo products in Sprint 1.32.
 * - Bare outdoor strobe standards (UL S3593/CSFM 7300-1653:187) are kept
 *   distinct from the horn-strobe combo's own numbers (S4011/7125-1653:188)
 *   -- never copied from the combo citation.
 * - CHSRL/CHSCRL/CHSWL/CHSCWL (Chime+Strobe combination devices) are NOT
 *   given any candela/flash-rate/standards facts -- no official "Chime"
 *   document was found in Sprint 1.32's collection or this sprint's reuse
 *   pass, so only self-evident device_type/mounting facts are structured,
 *   consistent with "do not infer attributes merely because visually
 *   related to a combo product."
 * - SYS-ST/SYS-ST-C (generic distributor part numbers, same pattern as
 *   SYS-HS from Sprint 1.32) get only description-evidenced facts, no
 *   standards/voltage/candela.
 * - MHR/MHR1/MHW (mini piezo horns) and SCWL-TILE (strobe-only drop-in
 *   tile) have no official document in this session's collection -- left
 *   entirely unresolved beyond their own catalog description, reported as
 *   a genuine gap rather than inferred from the enriched tile speaker or
 *   enriched wall/ceiling horn lines.
 *
 * Real, pre-existing family misclassifications corrected in a companion
 * script this same sprint (correct-notification-appliance-accessory-false-
 * positives.mjs), NOT via a classifier-level guard -- LENS-A/AC/B/BC/G/GC/
 * R/RC (strobe lens color attachments) and STI1210D/WTP/WTP-SPW/WTPW
 * (weatherproof plate/cover accessories) were removed from Strobe. This
 * matches the project's own established, tested convention (see
 * fire-alarm-taxonomy-integration.test.mjs) of handling this exact
 * false-positive shape as a documented correction-script exclusion, never
 * a classifier guard -- a classifier-level attempt was tried and reverted
 * this same sprint after it broke that test.
 *
 * Usage:
 *   node scripts/seed-strobe-sounder-speaker-standalone-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-strobe-sounder-speaker-standalone-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-strobe-sounder-speaker-standalone-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const doc = (sourceId, url) => ({ sourceType: "Manufacturer Official Datasheet", sourceId, url });
const DOC_WALL_L = doc("Honeywell Farenhyt \"L-Series Indoor Horns, Strobes, and Horn Strobes\" (Doc 351574, Rev B, 02/18)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-351574-L-Series_Horns_HornStrobes_Wall.pdf");
const DOC_CEIL_L = doc("System Sensor \"Indoor Selectable-Output Strobes and Horn Strobes for Ceiling Applications\" (Doc AVDS868-02, 12/01/17)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Strbs_HrnStrbs_Ceiling_DataSheet_AVDS868.pdf");
const DOC_LF = doc("System Sensor \"Indoor Selectable-Output Low Frequency Sounders and Low Frequency Sounder Strobes\" (Doc AVDS910-02, 11/02/20)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Lw-Frqncy-Sndrs-Sndr-Strbs_Data-Sheet_AVDS910.pdf");
const DOC_OUTDOOR_HS = doc("System Sensor SpectrAlert Advance \"Outdoor Selectable-Output Horns, Strobes, and Horn Strobes\" (Doc A05-0456-002, 11/09)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/OutdoorHorns-Strobes-HornStrobes_DataSheet_A05-0456.pdf");
const DOC_WALL_SPK_L = doc("System Sensor \"Indoor Selectable-Output Speaker Strobes and Dual Voltage Evacuation Speakers for Wall Applications\" (Doc AVDS867-03, 6/6/19)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Speakers_Strobes_Wall_DataSheet_AVDS867.pdf");
const DOC_CEIL_SPK_L = doc("System Sensor \"Indoor Selectable-Output Speaker Strobes and Dual Voltage Evacuation Speakers for Ceiling Applications\" (Doc AVDS866-03, 3/23/18)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Spkrs_SpkrStrobes_Ceiling_DataSheet_AVDS866.pdf");
const DOC_WALL_SPK_OUT = doc("System Sensor SpectrAlert Advance \"Outdoor, Selectable-Output Speaker Strobes and Dual-Voltage Evacuation Speakers for Wall Applications\" (Doc AVDS1131/AVDS11301, 09/12)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Outdoor_Wall_Speakers_SpeakerStrobes_DataSheet_AVDS1131.pdf");
const DOC_CEIL_SPK_OUT = doc("System Sensor SpectrAlert Advance \"Outdoor, Selectable-Output Speaker Strobes and Dual-Voltage Evacuation Speakers for Ceiling Applications\" (Doc AVDS009/AVDS00901, 03/12)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Outdoor_Ceiling_Speakers_SpeakerStrobes_DataSheet_AVDS009.pdf");
const DOC_TILE = doc("System Sensor \"Drop-In Ceiling Speaker and Speaker Strobe for Life Safety Applications\" (Doc AVDS908-03, 06/28/22)", "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/HBT-Fire-AVDS908-03.pdf");

const fact = (name, value, { operator = "Equal", page = 1, section, srcDoc, confidence = 88, sourceText } = {}) => ({
  name, operator, normalizedValue: value, confidence,
  ...(sourceText ? { sourceText } : {}),
  source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url, page, section },
});

const FLASH = (srcDoc, page = 2) => fact("flash_rate", "1 Hz", { srcDoc, page, section: "Electrical Specifications", sourceText: "Strobe Flash Rate: 1 flash per second" });
const VOLT_2432 = (srcDoc, page = 2) => fact("operating_voltage_range", "8-17.5V (12V nominal) or 16-33V (24V nominal), regulated DC or FWR", { operator: "Informational", srcDoc, page, section: "Electrical/Operating Specifications" });
const SYNC = (srcDoc, page = 1) => fact("synchronization", "Compatible with System Sensor synchronization protocol", { srcDoc, page, section: "Features" });

// -------------------- STROBE (standalone, no horn/speaker) --------------------
const STROBE_ATTRS = {
  indoorWallStrobe: (srcDoc) => [
    fact("device_type", "Strobe (Visual Notification Only)", { srcDoc, section: "Product Description" }),
    fact("indoor_outdoor", "Indoor", { srcDoc, section: "General" }),
    fact("mounting", "Wall", { srcDoc, page: 1, section: "Features" }),
    fact("candela_rating", "15, 30, 75, 95, 110, 135, 185 cd", { operator: "Informational", srcDoc, page: 2, section: "General" }),
    FLASH(srcDoc), VOLT_2432(srcDoc), SYNC(srcDoc),
    fact("backbox_requirement", "Standard 2x4x1-7/8in, 4x4x1.5in, 4in octagon, or double-gang back box", { operator: "Informational", srcDoc, page: 2, section: "General" }),
  ],
  indoorCeilingStrobe: (srcDoc) => [
    fact("device_type", "Strobe (Visual Notification Only)", { srcDoc, section: "Product Description" }),
    fact("indoor_outdoor", "Indoor", { srcDoc, section: "General" }),
    fact("mounting", "Ceiling", { srcDoc, page: 1, section: "Features" }),
    fact("candela_rating", "15, 30, 75, 95, 115, 150, 177 cd", { operator: "Informational", srcDoc, page: 2, section: "General" }),
    FLASH(srcDoc), VOLT_2432(srcDoc), SYNC(srcDoc),
    fact("backbox_requirement", "Standard 4x4x1.5in, 4in octagon, or double-gang back box", { operator: "Informational", srcDoc, page: 2, section: "General" }),
  ],
  outdoorWallStrobe: (srcDoc) => [
    fact("device_type", "Strobe (Visual Notification Only)", { srcDoc, page: 2, section: "Architect/Engineer Specifications" }),
    fact("indoor_outdoor", "Outdoor (weatherproof, NEMA 4X/IP56)", { srcDoc, page: 1, section: "Features" }),
    fact("mounting", "Wall", { srcDoc, page: 4, section: "Ordering Information" }),
    fact("candela_rating", "Standard cd: 15, 15/75, 30, 75, 95, 110, 115", { operator: "Informational", srcDoc, page: 2, section: "General" }),
    FLASH(srcDoc), VOLT_2432(srcDoc), SYNC(srcDoc),
    fact("backbox_requirement", "Weatherproof back box included with device; optional metal weatherproof back box (MWBBW/MWBB) available separately (not in this catalog)", { operator: "Informational", srcDoc, page: 1, section: "General" }),
  ],
  outdoorCeilingStrobe: (srcDoc) => [
    fact("device_type", "Strobe (Visual Notification Only)", { srcDoc, page: 2, section: "Architect/Engineer Specifications" }),
    fact("indoor_outdoor", "Outdoor (weatherproof, NEMA 4X/IP56)", { srcDoc, page: 1, section: "Features" }),
    fact("mounting", "Ceiling", { srcDoc, page: 4, section: "Ordering Information" }),
    fact("candela_rating", "Standard cd: 15, 15/75, 30, 75, 95, 110, 115", { operator: "Informational", srcDoc, page: 2, section: "General" }),
    FLASH(srcDoc), VOLT_2432(srcDoc), SYNC(srcDoc),
    fact("backbox_requirement", "Weatherproof back box included with device; optional metal weatherproof back box (MWBBCW) available separately (not in this catalog)", { operator: "Informational", srcDoc, page: 1, section: "General" }),
  ],
};
const STROBE_PRODUCTS = {
  "SRL": STROBE_ATTRS.indoorWallStrobe(DOC_WALL_L), "SRL-P": STROBE_ATTRS.indoorWallStrobe(DOC_WALL_L), "SRL-SP": STROBE_ATTRS.indoorWallStrobe(DOC_WALL_L),
  "SWL": STROBE_ATTRS.indoorWallStrobe(DOC_WALL_L), "SWL-P": STROBE_ATTRS.indoorWallStrobe(DOC_WALL_L),
  "SGRL": STROBE_ATTRS.indoorWallStrobe(DOC_WALL_L), "SGWL": STROBE_ATTRS.indoorWallStrobe(DOC_WALL_L),
  "SCRL": STROBE_ATTRS.indoorCeilingStrobe(DOC_CEIL_L), "SCWL": STROBE_ATTRS.indoorCeilingStrobe(DOC_CEIL_L),
  "SRK": STROBE_ATTRS.outdoorWallStrobe(DOC_OUTDOOR_HS), "SRK-P": STROBE_ATTRS.outdoorWallStrobe(DOC_OUTDOOR_HS), "SRK-R": STROBE_ATTRS.outdoorWallStrobe(DOC_OUTDOOR_HS),
  "SWK": STROBE_ATTRS.outdoorWallStrobe(DOC_OUTDOOR_HS), "SWK-P": STROBE_ATTRS.outdoorWallStrobe(DOC_OUTDOOR_HS),
  "SCRK": STROBE_ATTRS.outdoorCeilingStrobe(DOC_OUTDOOR_HS), "SCWK": STROBE_ATTRS.outdoorCeilingStrobe(DOC_OUTDOOR_HS),
  "CHSRL": [fact("device_type", "Chime/Strobe Combination", { srcDoc: DOC_WALL_L, confidence: 60, section: "(own catalog description only; no official Chime document located in this session's collection)" }), fact("mounting", "Wall", { srcDoc: DOC_WALL_L, confidence: 60, section: "(own catalog description)" })],
  "CHSWL": [fact("device_type", "Chime/Strobe Combination", { srcDoc: DOC_WALL_L, confidence: 60, section: "(own catalog description only; no official Chime document located in this session's collection)" }), fact("mounting", "Wall", { srcDoc: DOC_WALL_L, confidence: 60, section: "(own catalog description)" })],
  "CHSCRL": [fact("device_type", "Chime/Strobe Combination", { srcDoc: DOC_CEIL_L, confidence: 60, section: "(own catalog description only; no official Chime document located in this session's collection)" }), fact("mounting", "Ceiling", { srcDoc: DOC_CEIL_L, confidence: 60, section: "(own catalog description)" })],
  "CHSCWL": [fact("device_type", "Chime/Strobe Combination", { srcDoc: DOC_CEIL_L, confidence: 60, section: "(own catalog description only; no official Chime document located in this session's collection)" }), fact("mounting", "Ceiling", { srcDoc: DOC_CEIL_L, confidence: 60, section: "(own catalog description)" })],
  "SYS-ST": [fact("device_type", "Strobe (Visual Notification Only)", { srcDoc: DOC_WALL_L, confidence: 70, section: "(non-canonical distributor part number; own description only)" }), fact("mounting", "Wall", { srcDoc: DOC_WALL_L, confidence: 70, section: "(own catalog description)" })],
  "SYS-ST-C": [fact("device_type", "Strobe (Visual Notification Only)", { srcDoc: DOC_CEIL_L, confidence: 70, section: "(non-canonical distributor part number; own description only)" }), fact("mounting", "Ceiling", { srcDoc: DOC_CEIL_L, confidence: 70, section: "(own catalog description)" })],
};
const STROBE_STANDARDS = {
  "SRL": [{ body: "UL", number: "1971" }], "SRL-P": [{ body: "UL", number: "1971" }], "SRL-SP": [{ body: "UL", number: "1971" }],
  "SWL": [{ body: "UL", number: "1971" }], "SWL-P": [{ body: "UL", number: "1971" }],
  "SGRL": [{ body: "UL", number: "1971" }], "SGWL": [{ body: "UL", number: "1971" }],
  "SCRL": [{ body: "UL", number: "1971" }], "SCWL": [{ body: "UL", number: "1971" }],
  "SRK": [{ body: "UL", number: "1971" }, { body: "UL", number: "S3593" }, { body: "MEA", number: "452-05-E" }, { body: "CSFM", number: "7300-1653:187" }],
  "SRK-P": [{ body: "UL", number: "1971" }, { body: "UL", number: "S3593" }, { body: "MEA", number: "452-05-E" }, { body: "CSFM", number: "7300-1653:187" }],
  "SRK-R": [{ body: "UL", number: "1971" }, { body: "UL", number: "S3593" }, { body: "MEA", number: "452-05-E" }, { body: "CSFM", number: "7300-1653:187" }],
  "SWK": [{ body: "UL", number: "1971" }, { body: "UL", number: "S3593" }, { body: "MEA", number: "452-05-E" }, { body: "CSFM", number: "7300-1653:187" }],
  "SWK-P": [{ body: "UL", number: "1971" }, { body: "UL", number: "S3593" }, { body: "MEA", number: "452-05-E" }, { body: "CSFM", number: "7300-1653:187" }],
  "SCRK": [{ body: "UL", number: "1971" }, { body: "UL", number: "S3593" }, { body: "MEA", number: "452-05-E" }, { body: "CSFM", number: "7300-1653:187" }],
  "SCWK": [{ body: "UL", number: "1971" }, { body: "UL", number: "S3593" }, { body: "MEA", number: "452-05-E" }, { body: "CSFM", number: "7300-1653:187" }],
};
const STROBE_STANDARDS_DOC = { "SRL": DOC_WALL_L, "SRL-P": DOC_WALL_L, "SRL-SP": DOC_WALL_L, "SWL": DOC_WALL_L, "SWL-P": DOC_WALL_L, "SGRL": DOC_WALL_L, "SGWL": DOC_WALL_L, "SCRL": DOC_CEIL_L, "SCWL": DOC_CEIL_L, "SRK": DOC_OUTDOOR_HS, "SRK-P": DOC_OUTDOOR_HS, "SRK-R": DOC_OUTDOOR_HS, "SWK": DOC_OUTDOOR_HS, "SWK-P": DOC_OUTDOOR_HS, "SCRK": DOC_OUTDOOR_HS, "SCWK": DOC_OUTDOOR_HS };

// -------------------- SOUNDER (standalone horn, no strobe) --------------------
const SOUNDER_ATTRS = {
  indoorHorn: (srcDoc, mounting) => [
    fact("device_type", "Horn/Sounder (Audible Notification Only)", { srcDoc, section: "Product Description" }),
    fact("indoor_outdoor", "Indoor", { srcDoc, section: "General" }),
    fact("mounting", mounting, { srcDoc, page: 1, section: "Features" }),
    fact("sound_output", "Horn rated at 88+ dBA at 16 volts", { operator: "Informational", srcDoc, page: 1, section: "Features & Benefits" }),
    VOLT_2432(srcDoc), SYNC(srcDoc),
    fact("backbox_requirement", mounting === "Ceiling" ? "Standard 4x4x1.5in, 4in octagon, or double-gang back box" : "Standard 2x4x1-7/8in, 4x4x1.5in, 4in octagon, or double-gang back box", { operator: "Informational", srcDoc, page: 2, section: "General" }),
  ],
  lfSounder: (srcDoc, mounting) => [
    fact("device_type", "Low-Frequency Sounder (Audible Notification Only)", { srcDoc, section: "Product Description" }),
    fact("indoor_outdoor", "Indoor", { srcDoc, page: 2, section: "General" }),
    fact("mounting", mounting, { srcDoc, page: 2, section: "General" }),
    fact("frequency", "520 Hz", { operator: "Informational", srcDoc, page: 1, section: "Features", sourceText: "520 Hz ± 10% square wave tone, NFPA compliance" }),
    fact("sound_output", "Up to 80 dBA reverberant (Continuous High, 16-33V)", { operator: "Informational", srcDoc, page: 3, section: "UL Current Draw and Sound Output Data" }),
    VOLT_2432(srcDoc), SYNC(srcDoc),
    fact("backbox_requirement", mounting === "Ceiling" ? "Standard 4x4x1.5in, 4in octagon, or double-gang back box; SBBCRL/WL surface mount back box" : "Standard 2x4x1-7/8in, 4x4x1.5in, 4in octagon, or double-gang back box; SBBRL/WL surface mount back box", { operator: "Informational", srcDoc, page: 2, section: "General" }),
  ],
  outdoorHorn: (srcDoc) => [
    fact("device_type", "Horn/Sounder (Audible Notification Only)", { srcDoc, page: 2, section: "Architect/Engineer Specifications" }),
    fact("indoor_outdoor", "Outdoor (weatherproof, NEMA 4X/IP56)", { srcDoc, page: 1, section: "Features" }),
    fact("mounting", "Wall", { srcDoc, page: 4, section: "Ordering Information" }),
    fact("sound_output", "Up to 93 dBA reverberant / 101 dBA anechoic (Coded High, 16-33V, 24V nominal)", { operator: "Informational", srcDoc, page: 3, section: "Horn and Horn Strobe Output (dBA)" }),
    VOLT_2432(srcDoc), SYNC(srcDoc),
    fact("backbox_requirement", "Weatherproof back box included with device; optional metal weatherproof back box available separately (not in this catalog)", { operator: "Informational", srcDoc, page: 1, section: "General" }),
  ],
};
const SOUNDER_PRODUCTS = {
  "HRL": SOUNDER_ATTRS.indoorHorn(DOC_WALL_L, "Wall"), "HWL": SOUNDER_ATTRS.indoorHorn(DOC_WALL_L, "Wall"),
  "HGRL": SOUNDER_ATTRS.indoorHorn(DOC_WALL_L, "Wall"), "HGWL": SOUNDER_ATTRS.indoorHorn(DOC_WALL_L, "Wall"),
  "HRL-LF": SOUNDER_ATTRS.lfSounder(DOC_LF, "Wall"), "HWL-LF": SOUNDER_ATTRS.lfSounder(DOC_LF, "Wall"),
  "HGRL-LF": SOUNDER_ATTRS.lfSounder(DOC_LF, "Wall"), "HGWL-LF": SOUNDER_ATTRS.lfSounder(DOC_LF, "Wall"),
  "HCRL-LF": SOUNDER_ATTRS.lfSounder(DOC_LF, "Ceiling"), "HCWL-LF": SOUNDER_ATTRS.lfSounder(DOC_LF, "Ceiling"),
  "HRK": SOUNDER_ATTRS.outdoorHorn(DOC_OUTDOOR_HS), "HRK-R": SOUNDER_ATTRS.outdoorHorn(DOC_OUTDOOR_HS),
  "MHR": [fact("device_type", "Mini Piezo Horn (Audible Notification Only)", { srcDoc: DOC_WALL_L, confidence: 55, section: "(own catalog description only; no official mini-horn document located in this session's collection)" }), fact("operating_voltage_range", "12/24 VDC", { operator: "Informational", srcDoc: DOC_WALL_L, confidence: 55, section: "(own catalog description)" })],
  "MHR1": [fact("device_type", "Mini Piezo Horn (Audible Notification Only)", { srcDoc: DOC_WALL_L, confidence: 55, section: "(own catalog description only; no official mini-horn document located in this session's collection)" })],
  "MHW": [fact("device_type", "Mini Piezo Horn (Audible Notification Only)", { srcDoc: DOC_WALL_L, confidence: 55, section: "(own catalog description only; no official mini-horn document located in this session's collection)" }), fact("operating_voltage_range", "12/24 VDC", { operator: "Informational", srcDoc: DOC_WALL_L, confidence: 55, section: "(own catalog description)" })],
};
const SOUNDER_STANDARDS = {
  "HRL": [{ body: "UL", number: "464" }], "HWL": [{ body: "UL", number: "464" }], "HGRL": [{ body: "UL", number: "464" }], "HGWL": [{ body: "UL", number: "464" }],
  "HRL-LF": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "FM", number: "PR452768" }, { body: "CSFM", number: "7135-1653:0516" }],
  "HWL-LF": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "FM", number: "PR452768" }, { body: "CSFM", number: "7135-1653:0516" }],
  "HGRL-LF": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "FM", number: "PR452768" }, { body: "CSFM", number: "7135-1653:0516" }],
  "HGWL-LF": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "FM", number: "PR452768" }, { body: "CSFM", number: "7135-1653:0516" }],
  "HCRL-LF": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "FM", number: "PR452768" }, { body: "CSFM", number: "7135-1653:0516" }],
  "HCWL-LF": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "FM", number: "PR452768" }, { body: "CSFM", number: "7135-1653:0516" }],
  "HRK": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "CSFM", number: "7135-1653:189" }],
  "HRK-R": [{ body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "CSFM", number: "7135-1653:189" }],
};
const SOUNDER_STANDARDS_DOC = { "HRL": DOC_WALL_L, "HWL": DOC_WALL_L, "HGRL": DOC_WALL_L, "HGWL": DOC_WALL_L, "HRL-LF": DOC_LF, "HWL-LF": DOC_LF, "HGRL-LF": DOC_LF, "HGWL-LF": DOC_LF, "HCRL-LF": DOC_LF, "HCWL-LF": DOC_LF, "HRK": DOC_OUTDOOR_HS, "HRK-R": DOC_OUTDOOR_HS };

// -------------------- SPEAKER (standalone, no strobe) --------------------
const SPEAKER_ATTRS = {
  indoor: (srcDoc, mounting) => [
    fact("device_type", "Speaker (Audible Notification Only)", { srcDoc, section: "Product Description" }),
    fact("indoor_outdoor", "Indoor", { srcDoc, page: 2, section: "General" }),
    fact("mounting", mounting, { srcDoc, page: 1, section: "Title" }),
    fact("frequency_range", "400-4000 Hz", { operator: "Informational", srcDoc, page: 2, section: "Speaker" }),
    fact("power_taps", "1/4 W, 1/2 W, 1 W, 2 W", { operator: "Informational", srcDoc, page: 2, section: "Electrical/Operating Specifications" }),
    fact("sound_output", mounting === "Ceiling" ? "Ceiling-Mount Speaker: 88 dBA (2W) / 85 (1W) / 82 (1/2W) / 79 (1/4W) UL Reverberant @10ft" : "Wall-Mount Speaker: 88 dBA (2W) / 85 (1W) / 82 (1/2W) / 79 (1/4W) UL Reverberant @10ft", { operator: "Informational", srcDoc, page: 3, section: "Sound Output" }),
    fact("operating_voltage_range", "25 or 70.7 Vrms nominal (transformer speaker); 50VDC max supervisory", { operator: "Informational", srcDoc, page: 2, section: "Electrical/Operating Specifications" }),
    SYNC(srcDoc),
    fact("backbox_requirement", "4x4x2-1/8in back box; no extension ring required", { operator: "Informational", srcDoc, page: 2, section: "General" }),
  ],
  outdoor: (srcDoc, mounting) => [
    fact("device_type", "Speaker (Audible Notification Only)", { srcDoc, page: 2, section: "Speaker" }),
    fact("indoor_outdoor", "Outdoor (weatherproof, NEMA 4X/IP56)", { srcDoc, page: 1, section: "Features" }),
    fact("mounting", mounting, { srcDoc, page: 1, section: "Title" }),
    fact("frequency_range", "400-4000 Hz", { operator: "Informational", srcDoc, page: 2, section: "Speaker" }),
    fact("power_taps", "1/4 W, 1/2 W, 1 W, 2 W", { operator: "Informational", srcDoc, page: 2, section: "Electrical/Operating Specifications" }),
    fact("sound_output", "Outdoor Speaker: 90 dBA (2W) / 87 (1W) / 84 (1/2W) / 81 (1/4W) UL Reverberant @10ft", { operator: "Informational", srcDoc, page: 3, section: "Sound Output" }),
    fact("operating_voltage_range", "25 or 70.7 Vrms nominal (transformer speaker); 50VDC max supervisory", { operator: "Informational", srcDoc, page: 2, section: "Electrical/Operating Specifications" }),
    SYNC(srcDoc),
    fact("backbox_requirement", "Weatherproof back box included with device; must remain installed with its weatherproof back box to stay outdoor-approved per UL S4048", { operator: "Informational", srcDoc, page: 2, section: "Speaker" }),
  ],
};
const SPEAKER_PRODUCTS = {
  "SPRL": SPEAKER_ATTRS.indoor(DOC_WALL_SPK_L, "Wall"), "SPWL": SPEAKER_ATTRS.indoor(DOC_WALL_SPK_L, "Wall"),
  "SPCRL": SPEAKER_ATTRS.indoor(DOC_CEIL_SPK_L, "Ceiling"), "SPCWL": SPEAKER_ATTRS.indoor(DOC_CEIL_SPK_L, "Ceiling"),
  "SPWK": SPEAKER_ATTRS.outdoor(DOC_WALL_SPK_OUT, "Wall"), "SPCWK": SPEAKER_ATTRS.outdoor(DOC_CEIL_SPK_OUT, "Ceiling"),
  "SPCWL-TILE": [
    fact("device_type", "Speaker (Drop-In Ceiling Tile, Audible Notification Only)", { srcDoc: DOC_TILE, page: 1, section: "Features" }),
    fact("indoor_outdoor", "Indoor", { srcDoc: DOC_TILE, page: 2, section: "General" }),
    fact("mounting", "Ceiling Tile Drop-In (2ft x 2ft opening)", { srcDoc: DOC_TILE, page: 1, section: "Features" }),
    fact("frequency_range", "400-4000 Hz", { operator: "Informational", srcDoc: DOC_TILE, page: 2, section: "Speaker" }),
    fact("power_taps", "1/4 W, 1/2 W, 1 W, 2 W", { operator: "Informational", srcDoc: DOC_TILE, page: 2, section: "Electrical Specifications" }),
    fact("sound_output", "Ceiling-Mount Speaker: 86 dBA (2W) / 83 (1W) / 79 (1/2W) / 77 (1/4W) UL Reverberant @10ft", { operator: "Informational", srcDoc: DOC_TILE, page: 3, section: "Ceiling-Mount Speaker Sound Output" }),
    fact("backbox_requirement", "Integrated turn-key assembly; no separate back box, extension ring, or support bracket required", { operator: "Informational", srcDoc: DOC_TILE, page: 1, section: "L-Series makes installation easy" }),
  ],
};
const SPEAKER_STANDARDS = {
  "SPRL": [{ body: "UL", number: "1480" }, { body: "UL", number: "S4048" }, { body: "CSFM", number: "7320-1653:0505" }],
  "SPWL": [{ body: "UL", number: "1480" }, { body: "UL", number: "S4048" }, { body: "CSFM", number: "7320-1653:0505" }],
  "SPCRL": [{ body: "UL", number: "1480" }, { body: "UL", number: "S4048" }, { body: "CSFM", number: "7320-1653:0505" }],
  "SPCWL": [{ body: "UL", number: "1480" }, { body: "UL", number: "S4048" }, { body: "CSFM", number: "7320-1653:0505" }],
  "SPWK": [{ body: "UL", number: "S4048" }, { body: "MEA", number: "10-08-E" }, { body: "CSFM", number: "7320-1653:201" }],
  "SPCWK": [{ body: "UL", number: "S4048" }, { body: "MEA", number: "10-08-E" }, { body: "CSFM", number: "7320-1653:201" }],
  "SPCWL-TILE": [{ body: "UL", number: "1480" }, { body: "UL", number: "S4048" }, { body: "CSFM", number: "7320-1653:0521" }],
};
const SPEAKER_STANDARDS_DOC = { "SPRL": DOC_WALL_SPK_L, "SPWL": DOC_WALL_SPK_L, "SPCRL": DOC_CEIL_SPK_L, "SPCWL": DOC_CEIL_SPK_L, "SPWK": DOC_WALL_SPK_OUT, "SPCWK": DOC_CEIL_SPK_OUT, "SPCWL-TILE": DOC_TILE };

// -------------------- Accessories (backbox) --------------------
const ACCESSORIES = [
  ["SRL", "SBBRL", DOC_WALL_L], ["SRL-P", "SBBRL", DOC_WALL_L], ["SRL-SP", "SBBRL", DOC_WALL_L],
  ["SWL", "SBBWL", DOC_WALL_L], ["SWL-P", "SBBWL", DOC_WALL_L],
  ["SCRL", "SBBCRL", DOC_CEIL_L], ["SCWL", "SBBCWL", DOC_CEIL_L],
  ["HRL", "SBBRL", DOC_WALL_L], ["HWL", "SBBWL", DOC_WALL_L],
  ["HRL-LF", "SBBRL", DOC_LF], ["HWL-LF", "SBBWL", DOC_LF],
  ["SPRL", "SBBSPRL", DOC_WALL_SPK_L], ["SPWL", "SBBSPWL", DOC_WALL_SPK_L],
  ["SPCRL", "SBBCRL", DOC_CEIL_SPK_L], ["SPCWL", "SBBCWL", DOC_CEIL_SPK_L],
];
// SGRL/SGWL (compact) and HGRL/HGWL/HGRL-LF/HGWL-LF (compact) require SBBGRL/SBBGWL, which do not exist in this
// catalog -- the same honest gap already reported for P2GWL in Sprint 1.32. No accessory relationship added.

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, 'Compatible Backbox', 'One per device', '[]', 0, 1, ?, 88, 'Approved', 'sprint-1.38-standalone-strobe-sounder-speaker-seed')");
const existingAccessory = db.prepare("SELECT 1 FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND deleted_at IS NULL AND superseded_at IS NULL");

let attrsAdded = 0, attrsSkipped = 0, stdsAdded = 0, stdsSkipped = 0, accAdded = 0, accSkipped = 0;

function applyAttrs(allProducts) {
  for (const [partNumber, attrs] of Object.entries(allProducts)) {
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
}
function applyStandards(allStandards, docMap) {
  for (const [partNumber, stds] of Object.entries(allStandards)) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.standards || "[]");
    const existingKeys = new Set(existing.map((e) => `${norm(e.body)}:${norm(e.number)}`));
    const toAdd = stds.filter((s) => !existingKeys.has(`${norm(s.body)}:${norm(s.number)}`));
    for (const s of stds.filter((s) => existingKeys.has(`${norm(s.body)}:${norm(s.number)}`))) { console.log(`SKIP (already present): ${partNumber} -> ${s.body} ${s.number}`); stdsSkipped += 1; }
    if (toAdd.length) {
      const srcDoc = docMap[partNumber];
      const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, status: "Verified", confidence: 85, source: { sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url } }));
      for (const s of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${s.body} ${s.number}`);
      if (apply) updateStandards.run(JSON.stringify([...existing, ...appended]), product.id);
      stdsAdded += appended.length;
    }
  }
}

if (apply) db.exec("BEGIN IMMEDIATE");
try {
  applyAttrs(STROBE_PRODUCTS);
  applyAttrs(SOUNDER_PRODUCTS);
  applyAttrs(SPEAKER_PRODUCTS);
  applyStandards(STROBE_STANDARDS, STROBE_STANDARDS_DOC);
  applyStandards(SOUNDER_STANDARDS, SOUNDER_STANDARDS_DOC);
  applyStandards(SPEAKER_STANDARDS, SPEAKER_STANDARDS_DOC);

  for (const [productPN, accessoryPN, srcDoc] of ACCESSORIES) {
    const product = getProduct.get(productPN);
    if (!product) throw new Error(`Product not found: ${productPN}`);
    const accessory = getProduct.get(accessoryPN);
    if (!accessory) throw new Error(`Accessory product not found: ${accessoryPN}`);
    if (existingAccessory.get(product.id, accessory.id)) { console.log(`SKIP (already present): ${productPN} -> ${accessoryPN}`); accSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${productPN} -> Compatible Backbox: ${accessoryPN}`);
    if (apply) insertAccessory.run(id("productaccessory"), product.id, accessory.id, JSON.stringify([{ sourceType: srcDoc.sourceType, sourceId: srcDoc.sourceId, url: srcDoc.url }]));
    accAdded += 1;
  }

  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} attributes (${attrsSkipped} skipped); ${stdsAdded} standards (${stdsSkipped} skipped); ${accAdded} accessory relationships (${accSkipped} skipped).`);
console.log("Unresolved: MHR/MHR1/MHW (mini piezo horns) and SCWL-TILE (strobe-only drop-in tile) -- no official document in this session's collection; CHSRL/CHSWL/CHSCRL/CHSCWL (Chime/Strobe combos) -- no official Chime document found, only self-evident device_type/mounting structured; SYS-ST/SYS-ST-C -- generic non-canonical distributor part numbers; SGRL/SGWL/HGRL/HGWL/HGRL-LF/HGWL-LF compact backbox (SBBGRL/SBBGWL) -- not in this catalog, no accessory relationship added.");
