#!/usr/bin/env node
/**
 * Sprint 1.32 -- brings the Honeywell/Farenhyt Sounder/Strobe (33 active
 * SKUs) and Speaker/Strobe (19 active SKUs) families from
 * CLASSIFIED_BUT_SHALLOW to reusable technical readiness using eight
 * official System Sensor/Honeywell documents, each applied only to the
 * exact SKUs it explicitly names in its own ordering-information table (or,
 * for the 4-wire wall manual, its own "For use with the following models"
 * line) -- never inferred from a PN suffix alone.
 *
 * DOC_WALL_L      Honeywell Farenhyt "L-Series Indoor Horns, Strobes, and
 *   Horn Strobes" (Doc 351574, Rev B, 02/18). Wall Horn Strobes ordering
 *   table explicitly names P2RL, P2WL, P2GRL, P2GWL, P2RL-P, P2WL-P,
 *   P2RL-SP, P2WL-SP.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-351574-L-Series_Horns_HornStrobes_Wall.pdf
 * DOC_CEIL_L      System Sensor "Indoor Selectable-Output Strobes and Horn
 *   Strobes for Ceiling Applications" (Doc AVDS868-02, 12/01/17). Ordering
 *   table explicitly names PC2RL, PC2WL, PC4RL, PC4WL.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Strbs_HrnStrbs_Ceiling_DataSheet_AVDS868.pdf
 * DOC_4WIRE_WALL  System Sensor "Selectable Output Four-wire Horn Strobes --
 *   Wall Mount" installation manual (Doc I56-6515-002, 10/02/18). Its own
 *   "For use with the following models" line names P4RL, P4WL specifically
 *   -- and cites UL 464 (horn, public mode) / UL 1638 (strobe, public mode),
 *   NOT UL 1971, a real and deliberate difference from the 2-wire L-Series
 *   general doc that must not be collapsed together.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/L-Series_4-Wire_HrnStrbs_Wall_I56-6515.pdf
 * DOC_OUTDOOR_HS  System Sensor "Outdoor Selectable-Output Horns, Strobes,
 *   and Horn Strobes" (SpectrAlert Advance, Doc A05-0456-002, 11/09).
 *   Ordering table explicitly names P2RK, P2RHK, P2WK, P2WHK, P4RK, P4WK,
 *   P2RHK-120 (wall) and PC2RK, PC2RHK, PC2WK, PC2WHK (ceiling; PC4WK/
 *   PC4WHK are named too but are not active catalog SKUs here). Its own
 *   ordering notes state "Add -P... for plain housing" and "Add -R... for
 *   weatherproof replacement device", which is how -P/-R/-120 variants are
 *   resolved here -- the document's own text, not an inferred suffix rule.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/OutdoorHorns-Strobes-HornStrobes_DataSheet_A05-0456.pdf
 * DOC_LF          System Sensor "Indoor Selectable-Output Low Frequency
 *   Sounders and Low Frequency Sounder Strobes" (Doc AVDS910-02, 11/02/20).
 *   Ordering table explicitly names P2RL-LF, P2WL-LF (wall sounder strobe).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Lw-Frqncy-Sndrs-Sndr-Strbs_Data-Sheet_AVDS910.pdf
 * DOC_WALL_SPK_OUT  System Sensor "Outdoor, Selectable-Output Speaker
 *   Strobes and Dual-Voltage Evacuation Speakers for Wall Applications"
 *   (Doc AVDS1131/AVDS11301, 09/12). Ordering table explicitly names SPRK,
 *   SPRK-R, SPSRK, SPSRK-P, SPSRK-R, SPSWK, SPSWK-P, SPSWK-CLR-ALERT.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Outdoor_Wall_Speakers_SpeakerStrobes_DataSheet_AVDS1131.pdf
 * DOC_CEIL_SPK_OUT  System Sensor "Outdoor, Selectable-Output Speaker
 *   Strobes and Dual-Voltage Evacuation Speakers for Ceiling Applications"
 *   (Doc AVDS009/AVDS00901, 03/12). Ordering table explicitly names SPSCWK,
 *   SPSCWHK, SPSCWHK-P, SPSCWK-CLRALERT.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Outdoor_Ceiling_Speakers_SpeakerStrobes_DataSheet_AVDS009.pdf
 * DOC_WALL_SPK_L  System Sensor "Indoor Selectable-Output Speaker Strobes
 *   and Dual Voltage Evacuation Speakers for Wall Applications" (Doc
 *   AVDS867-03, 6/6/19). Ordering table explicitly names SPSRL, SPSRL-P,
 *   SPSWL, SPSWL-ALERT, SPSWL-CLR-ALERT.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Speakers_Strobes_Wall_DataSheet_AVDS867.pdf
 * DOC_CEIL_SPK_L  System Sensor "Indoor Selectable-Output Speaker Strobes
 *   and Dual Voltage Evacuation Speakers for Ceiling Applications" (Doc
 *   AVDS866-03, 3/23/18). Ordering table explicitly names SPSCRL, SPSCWL,
 *   SPSCWL-P, SPSCWL-CLR-ALERT.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Spkrs_SpkrStrobes_Ceiling_DataSheet_AVDS866.pdf
 * DOC_TILE        System Sensor "Drop-In Ceiling Speaker and Speaker Strobe
 *   for Life Safety Applications" (Doc AVDS908-03, 06/28/22). Ordering
 *   table explicitly names SPSCWL-TILE.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/HBT-Fire-AVDS908-03.pdf
 *
 * Kept genuinely distinct per the task:
 * - Indoor L-Series vs Outdoor SpectrAlert Advance ("K" suffix) are
 *   different product lines with different agency listings and different
 *   physical (weatherproof) ratings -- never merged.
 * - Wall vs Ceiling mounting are different SKUs with different candela
 *   ranges (wall: 15/30/75/95/110/135/185; ceiling: 15/30/75/95/115/150/177)
 *   and different backbox part numbers -- never merged.
 * - Horn/Strobe vs Low-Frequency Sounder/Strobe vs Speaker/Strobe are kept
 *   as distinct device_type values with their own frequency/output facts.
 * - 4-wire wall horn strobes (P4RL/P4WL) get their OWN standards citation
 *   (UL 464 horn / UL 1638 strobe, both public mode) from their own manual,
 *   not the 2-wire wall doc's UL 1971/UL 464 pairing.
 *
 * Two non-canonical catalog rows (SYS-HS, SYS-HS-C) are generic distributor
 * price-list descriptions ("System Sensor Horn cum Strobe, Wall/Ceiling,
 * Red, Standard Candela"), not real Honeywell/System Sensor part numbers --
 * no official document names them, so only the device_type/indoor_outdoor/
 * mounting facts directly evidenced by their OWN description text are
 * applied; no manufacturer standards, candela, voltage, or backbox facts are
 * asserted for them.
 *
 * Deliberately NOT structured (real, reported gaps):
 * - Compact wall back box (SBBGRL/SBBGWL) for P2GWL -- named in Doc 351574
 *   but no such product exists in this catalog; only the standard SBBWL
 *   exists, which is NOT the correct compact-model backbox, so no accessory
 *   relationship is added for P2GWL.
 * - Metal weatherproof back box (MWBB/MWBBW/MWBBCW) for the outdoor K-series
 *   -- named in the outdoor docs as an optional upgrade, but no such product
 *   exists in this catalog.
 * - Trim rings (TR-2/TR-2W/TRC-2/TRC-2W) -- out of this sprint's accessory
 *   scope (optional cosmetic accessories, not backbox/mounting requirements)
 *   and TRC-2W does not exist in the catalog regardless.
 *
 * Usage:
 *   node scripts/seed-sounder-speaker-strobe-family-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-sounder-speaker-strobe-family-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-sounder-speaker-strobe-family-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const DOC_WALL_L = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"L-Series Indoor Horns, Strobes, and Horn Strobes\" (Doc 351574, Rev B, 02/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-351574-L-Series_Horns_HornStrobes_Wall.pdf" };
const DOC_CEIL_L = { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor \"Indoor Selectable-Output Strobes and Horn Strobes for Ceiling Applications\" (Doc AVDS868-02, 12/01/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Strbs_HrnStrbs_Ceiling_DataSheet_AVDS868.pdf" };
const DOC_4WIRE_WALL = { sourceType: "Manufacturer Official Installation Manual", sourceId: "System Sensor \"Selectable Output Four-wire Horn Strobes -- Wall Mount\" (Doc I56-6515-002, 10/02/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/L-Series_4-Wire_HrnStrbs_Wall_I56-6515.pdf" };
const DOC_OUTDOOR_HS = { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor SpectrAlert Advance \"Outdoor Selectable-Output Horns, Strobes, and Horn Strobes\" (Doc A05-0456-002, 11/09)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/OutdoorHorns-Strobes-HornStrobes_DataSheet_A05-0456.pdf" };
const DOC_LF = { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor \"Indoor Selectable-Output Low Frequency Sounders and Low Frequency Sounder Strobes\" (Doc AVDS910-02, 11/02/20)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Lw-Frqncy-Sndrs-Sndr-Strbs_Data-Sheet_AVDS910.pdf" };
const DOC_WALL_SPK_OUT = { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor SpectrAlert Advance \"Outdoor, Selectable-Output Speaker Strobes and Dual-Voltage Evacuation Speakers for Wall Applications\" (Doc AVDS1131, 09/12)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Outdoor_Wall_Speakers_SpeakerStrobes_DataSheet_AVDS1131.pdf" };
const DOC_CEIL_SPK_OUT = { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor SpectrAlert Advance \"Outdoor, Selectable-Output Speaker Strobes and Dual-Voltage Evacuation Speakers for Ceiling Applications\" (Doc AVDS009, 03/12)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/Outdoor_Ceiling_Speakers_SpeakerStrobes_DataSheet_AVDS009.pdf" };
const DOC_WALL_SPK_L = { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor \"Indoor Selectable-Output Speaker Strobes and Dual Voltage Evacuation Speakers for Wall Applications\" (Doc AVDS867-03, 6/6/19)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Speakers_Strobes_Wall_DataSheet_AVDS867.pdf" };
const DOC_CEIL_SPK_L = { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor \"Indoor Selectable-Output Speaker Strobes and Dual Voltage Evacuation Speakers for Ceiling Applications\" (Doc AVDS866-03, 3/23/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/L-Series_Spkrs_SpkrStrobes_Ceiling_DataSheet_AVDS866.pdf" };
const DOC_TILE = { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor \"Drop-In Ceiling Speaker and Speaker Strobe for Life Safety Applications\" (Doc AVDS908-03, 06/28/22)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/HBT-Fire-AVDS908-03.pdf" };

const fact = (name, value, { operator = "Equal", page, section, doc, confidence = 90, sourceText } = {}) => ({
  name, operator, normalizedValue: value, confidence,
  ...(sourceText ? { sourceText } : {}),
  source: { sourceType: doc.sourceType, sourceId: doc.sourceId, url: doc.url, page, section },
});
const VOLT_2432 = (doc, page) => fact("operating_voltage_range", "8-17.5V (12V nominal) or 16-33V (24V nominal), regulated DC or FWR", { operator: "Informational", doc, page, section: "Electrical/Operating Specifications" });
const SYNC = (doc, page) => fact("synchronization", "Compatible with System Sensor synchronization protocol (Sync•Circuit MDL3 module)", { doc, page, section: "Features" });
const FLASH = (doc, page) => fact("flash_rate", "1 Hz", { doc, page, section: "Electrical Specifications", sourceText: "Strobe Flash Rate: 1 flash per second" });

const GROUPS = [
  {
    key: "wall_horn_strobe_L",
    skus: ["P2RL", "P2WL", "P2GWL", "P2RL-P", "P2WL-P", "P2RL-SP"],
    attrs: (doc) => [
      fact("device_type", "Horn/Strobe", { doc, page: 1, section: "Product Description" }),
      fact("indoor_outdoor", "Indoor", { doc, page: 2, section: "General" }),
      fact("mounting", "Wall", { doc, page: 1, section: "Features & Benefits", sourceText: "Listed for wall mounting only" }),
      fact("candela_rating", "15, 30, 75, 95, 110, 135, 185 cd", { operator: "Informational", doc, page: 2, section: "General" }),
      FLASH(doc, 2),
      VOLT_2432(doc, 2),
      fact("sound_output", "Horn rated at 88+ dBA at 16 volts", { operator: "Informational", doc, page: 1, section: "Features & Benefits" }),
      SYNC(doc, 1),
      fact("backbox_requirement", "Standard 2x4x1-7/8in, 4x4x1.5in, 4in octagon, or double-gang back box (compact models: single-gang 2x4x1-7/8in)", { operator: "Informational", doc, page: 2, section: "General" }),
    ],
    standards: [{ body: "UL", number: "1971" }, { body: "UL", number: "464" }],
    doc: DOC_WALL_L,
    backbox: { red: "SBBRL", white: "SBBWL", compactGapNote: "P2GWL (compact) requires SBBGWL, which does not exist in this catalog -- only the standard SBBWL exists and is not the correct compact backbox, so no accessory relationship is added for P2GWL." },
  },
  {
    key: "ceiling_horn_strobe_L",
    skus: ["PC2RL", "PC2WL", "PC4RL", "PC4WL"],
    attrs: (doc) => [
      fact("device_type", "Horn/Strobe", { doc, page: 1, section: "Product Description" }),
      fact("indoor_outdoor", "Indoor", { doc, page: 2, section: "General" }),
      fact("mounting", "Ceiling", { doc, page: 1, section: "Features", sourceText: "Listed for ceiling mounting only" }),
      fact("candela_rating", "15, 30, 75, 95, 115, 150, 177 cd", { operator: "Informational", doc, page: 2, section: "General" }),
      FLASH(doc, 2),
      VOLT_2432(doc, 2),
      fact("sound_output", "Horn rated at 88+ dBA at 16 volts", { operator: "Informational", doc, page: 1, section: "Features" }),
      SYNC(doc, 1),
      fact("backbox_requirement", "Standard 4x4x1.5in, 4in octagon, or double-gang back box (2-wire also single-gang 2x4x1-7/8in)", { operator: "Informational", doc, page: 2, section: "General" }),
    ],
    standards: [{ body: "UL", number: "1971" }, { body: "UL", number: "464" }, { body: "UL", number: "S5512" }, { body: "UL", number: "S4011" }, { body: "CSFM", number: "7125-1653:0504" }, { body: "CSFM", number: "7135-1653:0503" }],
    doc: DOC_CEIL_L,
    backbox: { red: "SBBCRL", white: "SBBCWL" },
  },
  {
    key: "wall_horn_strobe_4wire",
    skus: ["P4RL", "P4WL"],
    attrs: (doc) => [
      fact("device_type", "Horn/Strobe (4-Wire)", { doc, page: 1, section: "General Description" }),
      fact("indoor_outdoor", "Indoor", { doc, page: 1, section: "General Description", sourceText: "Intended for indoor applications and approved for wall mount installations only." }),
      fact("mounting", "Wall", { doc, page: 1, section: "General Description" }),
      fact("candela_rating", "15, 30, 75, 95, 110, 135, 185 cd", { operator: "Informational", doc, page: 2, section: "Available Candela Settings" }),
      FLASH(doc, 1, ),
      VOLT_2432(doc, 1),
      fact("sound_output", "Up to 90 dBA reverberant (Non-Temporal High, 16-33V DC)", { operator: "Informational", doc, page: 2, section: "Table 4: Horn Current Draw and Sound Output" }),
      SYNC(doc, 1),
      fact("backbox_requirement", "4x4x1.5in, double-gang, or 4in octagon back box; SBBRL/WL surface mount back box for standard horn strobes", { operator: "Informational", doc, page: 1, section: "Mounting Box Options" }),
    ],
    standards: [{ body: "UL", number: "464" }, { body: "UL", number: "1638" }],
    doc: DOC_4WIRE_WALL,
    backbox: { red: "SBBRL", white: "SBBWL" },
  },
  {
    key: "wall_horn_strobe_lf",
    skus: ["P2RL-LF", "P2WL-LF"],
    attrs: (doc) => [
      fact("device_type", "Low-Frequency Sounder/Strobe", { doc, page: 1, section: "Product Description" }),
      fact("indoor_outdoor", "Indoor", { doc, page: 2, section: "General" }),
      fact("mounting", "Wall", { doc, page: 2, section: "General" }),
      fact("candela_rating", "15, 30, 75, 95, 110, 135, 185 cd", { operator: "Informational", doc, page: 2, section: "General" }),
      FLASH(doc, 2),
      fact("frequency", "520 Hz", { operator: "Informational", doc, page: 1, section: "Features", sourceText: "520 Hz ± 10% square wave tone, NFPA compliance" }),
      VOLT_2432(doc, 2),
      fact("sound_output", "Up to 80 dBA reverberant (Continuous High, 16-33V)", { operator: "Informational", doc, page: 3, section: "UL Current Draw and Sound Output Data" }),
      SYNC(doc, 1),
      fact("backbox_requirement", "Standard 4x4x1.5in, 4in octagon, or double-gang back box (2-wire also single-gang 2x4x1-7/8in); SBBRL/WL surface mount back box", { operator: "Informational", doc, page: 2, section: "General" }),
    ],
    standards: [{ body: "UL", number: "1971" }, { body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "CSFM", number: "7125-1653:0517" }],
    doc: DOC_LF,
    backbox: { red: "SBBRL", white: "SBBWL" },
  },
  {
    key: "outdoor_horn_strobe",
    skus: ["P2RHK", "P2RHK-120", "P2RHK-P", "P2RK", "P2RK-P", "P2RK-R", "P2WHK", "P2WHK-P", "P2WK", "P2WK-P", "P4RK", "P4RK-R", "P4WK", "PC2RHK", "PC2RK", "PC2WHK", "PC2WK"],
    attrs: (doc) => [
      fact("device_type", "Horn/Strobe", { doc, page: 2, section: "Architect/Engineer Specifications" }),
      fact("indoor_outdoor", "Outdoor (weatherproof, NEMA 4X/IP56)", { doc, page: 1, section: "Features" }),
      fact("candela_rating", "Standard cd: 15, 15/75, 30, 75, 95, 110, 115; High cd: 135, 150, 177, 185", { operator: "Informational", doc, page: 2, section: "General" }),
      FLASH(doc, 2),
      VOLT_2432(doc, 2),
      fact("sound_output", "Up to 93 dBA reverberant / 101 dBA anechoic (Coded High, 16-33V, 24V nominal)", { operator: "Informational", doc, page: 3, section: "Horn and Horn Strobe Output (dBA)" }),
      SYNC(doc, 1),
      fact("backbox_requirement", "Weatherproof back box included with device; optional metal weatherproof back box available separately (not in this catalog)", { operator: "Informational", doc, page: 1, section: "General" }),
    ],
    standards: [{ body: "UL", number: "1971" }, { body: "UL", number: "464" }, { body: "UL", number: "S4011" }, { body: "UL", number: "S3593" }, { body: "MEA", number: "452-05-E" }, { body: "CSFM", number: "7125-1653:188" }],
    doc: DOC_OUTDOOR_HS,
    mountingBySku: { P2RHK: "Wall", "P2RHK-120": "Wall", "P2RHK-P": "Wall", P2RK: "Wall", "P2RK-P": "Wall", "P2RK-R": "Wall", P2WHK: "Wall", "P2WHK-P": "Wall", P2WK: "Wall", "P2WK-P": "Wall", P4RK: "Wall", "P4RK-R": "Wall", P4WK: "Wall", PC2RHK: "Ceiling", PC2RK: "Ceiling", PC2WHK: "Ceiling", PC2WK: "Ceiling" },
  },
  {
    key: "wall_speaker_strobe_outdoor",
    skus: ["SPSRK", "SPSRK-R", "SPSWK", "SPSWK-CLR-ALERT", "SPSWK-P"],
    attrs: (doc) => [
      fact("device_type", "Speaker/Strobe", { doc, page: 2, section: "Speaker Strobe Combination" }),
      fact("indoor_outdoor", "Outdoor (weatherproof, NEMA 4X/IP56)", { doc, page: 1, section: "Features" }),
      fact("mounting", "Wall", { doc, page: 1, section: "Title" }),
      fact("candela_rating", "Standard cd: 15, 15/75, 30, 75, 95, 110, 115", { operator: "Informational", doc, page: 2, section: "Speaker Strobe Combination" }),
      FLASH(doc, 2),
      fact("frequency_range", "400-4000 Hz", { operator: "Informational", doc, page: 2, section: "Speaker" }),
      fact("power_taps", "1/4 W, 1/2 W, 1 W, 2 W", { operator: "Informational", doc, page: 2, section: "Electrical/Operating Specifications" }),
      VOLT_2432(doc, 2),
      fact("sound_output", "Outdoor Speaker/Strobe: 89 dBA (2W) / 86 (1W) / 83 (1/2W) / 80 (1/4W) UL Reverberant @10ft", { operator: "Informational", doc, page: 3, section: "Sound Output" }),
      SYNC(doc, 2),
      fact("backbox_requirement", "Weatherproof back box included with device; optional metal weatherproof back box (MWBBW/MWBB) available separately (not in this catalog)", { operator: "Informational", doc, page: 1, section: "General" }),
    ],
    standards: [{ body: "UL", number: "1638" }, { body: "UL", number: "1480" }, { body: "UL", number: "S4048" }],
    doc: DOC_WALL_SPK_OUT,
  },
  {
    key: "ceiling_speaker_strobe_outdoor",
    skus: ["SPSCWHK", "SPSCWK", "SPSCWK-CLR-ALERT"],
    attrs: (doc) => [
      fact("device_type", "Speaker/Strobe", { doc, page: 2, section: "Speaker Strobe Combination" }),
      fact("indoor_outdoor", "Outdoor (weatherproof, NEMA 4X/IP56)", { doc, page: 1, section: "Features" }),
      fact("mounting", "Ceiling", { doc, page: 1, section: "Title" }),
      fact("candela_rating", "Standard cd: 15, 15/75, 30, 75, 95, 110, 115; High cd (SPSCWHK): 135, 150, 177, 185", { operator: "Informational", doc, page: 2, section: "Speaker Strobe Combination" }),
      FLASH(doc, 2),
      fact("frequency_range", "400-4000 Hz", { operator: "Informational", doc, page: 2, section: "Speaker" }),
      fact("power_taps", "1/4 W, 1/2 W, 1 W, 2 W", { operator: "Informational", doc, page: 2, section: "Electrical/Operating Specifications" }),
      VOLT_2432(doc, 2),
      fact("sound_output", "Outdoor Speaker/Strobe: 89 dBA (2W) / 86 (1W) / 83 (1/2W) / 80 (1/4W) UL Reverberant @10ft", { operator: "Informational", doc, page: 3, section: "Sound Output" }),
      SYNC(doc, 2),
      fact("backbox_requirement", "Weatherproof back box included with device; optional metal weatherproof back box (MWBBCW) available separately (not in this catalog)", { operator: "Informational", doc, page: 1, section: "General" }),
    ],
    standards: [{ body: "UL", number: "1638" }, { body: "UL", number: "1480" }, { body: "UL", number: "S4048" }],
    doc: DOC_CEIL_SPK_OUT,
  },
  {
    key: "wall_speaker_strobe_L",
    skus: ["SPSRL", "SPSRL-P", "SPSWL", "SPSWL-ALERT", "SPSWL-CLR-ALERT", "SPSWL-P"],
    attrs: (doc) => [
      fact("device_type", "Speaker/Strobe", { doc, page: 2, section: "Speaker Strobe Combination" }),
      fact("indoor_outdoor", "Indoor", { doc, page: 2, section: "General" }),
      fact("mounting", "Wall", { doc, page: 1, section: "Title" }),
      fact("candela_rating", "15, 30, 75, 95, 110, 135, 185 cd", { operator: "Informational", doc, page: 2, section: "General" }),
      FLASH(doc, 2),
      fact("frequency_range", "400-4000 Hz", { operator: "Informational", doc, page: 2, section: "Speaker" }),
      fact("power_taps", "1/4 W, 1/2 W, 1 W, 2 W", { operator: "Informational", doc, page: 2, section: "Electrical/Operating Specifications" }),
      VOLT_2432(doc, 2),
      fact("sound_output", "Speaker Strobe: 86 dBA (2W) / 83 (1W) / 80 (1/2W) / 77 (1/4W) UL Reverberant @10ft", { operator: "Informational", doc, page: 3, section: "Sound Output Speaker Strobe" }),
      SYNC(doc, 1),
      fact("backbox_requirement", "4x4x2-1/8in back box; SBBSPRL/WL surface mount back box for speakers and speaker strobes", { operator: "Informational", doc, page: 2, section: "General" }),
    ],
    standards: [{ body: "UL", number: "1480" }, { body: "UL", number: "1971" }, { body: "UL", number: "S4048" }, { body: "CSFM", number: "7320-1653:0505" }],
    doc: DOC_WALL_SPK_L,
    backbox: { red: "SBBSPRL", white: "SBBSPWL" },
  },
  {
    key: "ceiling_speaker_strobe_L",
    skus: ["SPSCRL", "SPSCWL", "SPSCWL-CLR-ALERT", "SPSCWL-P"],
    attrs: (doc) => [
      fact("device_type", "Speaker/Strobe", { doc, page: 2, section: "Speaker Strobe combination" }),
      fact("indoor_outdoor", "Indoor", { doc, page: 2, section: "General" }),
      fact("mounting", "Ceiling", { doc, page: 1, section: "Title" }),
      fact("candela_rating", "15, 30, 75, 95, 115, 150, 177 cd", { operator: "Informational", doc, page: 2, section: "General" }),
      FLASH(doc, 2),
      fact("frequency_range", "400-4000 Hz", { operator: "Informational", doc, page: 2, section: "Speaker" }),
      fact("power_taps", "1/4 W, 1/2 W, 1 W, 2 W", { operator: "Informational", doc, page: 2, section: "Electrical/Operating Specifications" }),
      VOLT_2432(doc, 2),
      fact("sound_output", "Ceiling Speaker Strobe: 86 dBA (2W) / 83 (1W) / 80 (1/2W) / 77 (1/4W) UL Reverberant @10ft", { operator: "Informational", doc, page: 3, section: "Ceiling-Mount Speaker Strobe Sound Output" }),
      SYNC(doc, 1),
      fact("backbox_requirement", "4x4x2-1/8in back box, no extension ring required; SBBCRL/WL surface mount back box", { operator: "Informational", doc, page: 2, section: "General" }),
    ],
    standards: [{ body: "UL", number: "1480" }, { body: "UL", number: "1971" }, { body: "UL", number: "S4048" }, { body: "CSFM", number: "7320-1653:0505" }],
    doc: DOC_CEIL_SPK_L,
    backbox: { red: "SBBCRL", white: "SBBCWL" },
  },
  {
    key: "ceiling_speaker_strobe_tile",
    skus: ["SPSCWL-TILE"],
    attrs: (doc) => [
      fact("device_type", "Speaker/Strobe (Drop-In Ceiling Tile)", { doc, page: 1, section: "Features" }),
      fact("indoor_outdoor", "Indoor", { doc, page: 2, section: "General" }),
      fact("mounting", "Ceiling Tile Drop-In (2ft x 2ft opening)", { doc, page: 1, section: "Features" }),
      fact("candela_rating", "15, 30, 75, 95, 115, 150, 177 cd", { operator: "Informational", doc, page: 2, section: "General" }),
      FLASH(doc, 2),
      fact("frequency_range", "400-4000 Hz", { operator: "Informational", doc, page: 2, section: "Speaker" }),
      fact("power_taps", "1/4 W, 1/2 W, 1 W, 2 W", { operator: "Informational", doc, page: 2, section: "Electrical Specifications" }),
      VOLT_2432(doc, 2),
      fact("sound_output", "Ceiling-Mount Speaker: 86 dBA (2W) / 83 (1W) / 79 (1/2W) / 77 (1/4W) UL Reverberant @10ft", { operator: "Informational", doc, page: 3, section: "Ceiling-Mount Speaker Sound Output" }),
      SYNC(doc, 1),
      fact("backbox_requirement", "Integrated turn-key assembly; no separate back box, extension ring, or support bracket required", { operator: "Informational", doc, page: 1, section: "L-Series makes installation easy" }),
    ],
    standards: [{ body: "UL", number: "1480" }, { body: "UL", number: "1971" }, { body: "UL", number: "2043" }, { body: "UL", number: "S4048" }, { body: "CSFM", number: "7320-1653:0521" }],
    doc: DOC_TILE,
  },
];

const GENERIC_PN_GROUP = {
  key: "generic_non_canonical",
  entries: [
    { partNumber: "SYS-HS", device_type: "Horn/Strobe", mounting: "Wall" },
    { partNumber: "SYS-HS-C", device_type: "Horn/Strobe", mounting: "Ceiling" },
  ],
};

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, 'Compatible Backbox', 'One per device', '[]', 0, 1, ?, 88, 'Approved', 'sprint-1.32-sounder-speaker-strobe-seed')");
const existingAccessory = db.prepare("SELECT 1 FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND deleted_at IS NULL AND superseded_at IS NULL");

let attrsAdded = 0, attrsSkipped = 0, stdsAdded = 0, stdsSkipped = 0, accAdded = 0, accSkipped = 0, accGaps = [];

function applyAttrs(partNumber, attrs) {
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
  return product;
}

function applyStandards(partNumber, stds, doc) {
  const product = getProduct.get(partNumber);
  if (!product) throw new Error(`Product not found: ${partNumber}`);
  const existing = JSON.parse(product.standards || "[]");
  const existingKeys = new Set(existing.map((e) => `${norm(e.body)}:${norm(e.number)}`));
  const toAdd = stds.filter((s) => !existingKeys.has(`${norm(s.body)}:${norm(s.number)}`));
  for (const s of stds.filter((s) => existingKeys.has(`${norm(s.body)}:${norm(s.number)}`))) { console.log(`SKIP (already present): ${partNumber} -> ${s.body} ${s.number}`); stdsSkipped += 1; }
  if (toAdd.length) {
    const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, status: "Verified", confidence: 90, source: { sourceType: doc.sourceType, sourceId: doc.sourceId, url: doc.url } }));
    for (const s of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${s.body} ${s.number}`);
    if (apply) updateStandards.run(JSON.stringify([...existing, ...appended]), product.id);
    stdsAdded += appended.length;
  }
}

function applyBackbox(partNumber, accessoryPartNumber, doc) {
  const product = getProduct.get(partNumber);
  if (!product) throw new Error(`Product not found: ${partNumber}`);
  const accessory = getProduct.get(accessoryPartNumber);
  if (!accessory) throw new Error(`Backbox product not found: ${accessoryPartNumber}`);
  if (existingAccessory.get(product.id, accessory.id)) { console.log(`SKIP (already present): ${partNumber} -> ${accessoryPartNumber}`); accSkipped += 1; return; }
  console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> Compatible Backbox: ${accessoryPartNumber}`);
  if (apply) insertAccessory.run(id("productaccessory"), product.id, accessory.id, JSON.stringify([{ sourceType: doc.sourceType, sourceId: doc.sourceId, url: doc.url }]));
  accAdded += 1;
}

if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const group of GROUPS) {
    const attrs = group.attrs(group.doc);
    for (const sku of group.skus) {
      let skuAttrs = attrs;
      if (group.mountingBySku) skuAttrs = [...attrs, fact("mounting", group.mountingBySku[sku], { doc: group.doc, page: 4, section: "Ordering Information" })];
      applyAttrs(sku, skuAttrs);
      applyStandards(sku, group.standards, group.doc);
    }
  }

  // Backbox relationships -- explicit color-matched, per group, skipping known gaps.
  const wallL = GROUPS.find((g) => g.key === "wall_horn_strobe_L");
  applyBackbox("P2RL", "SBBRL", wallL.doc);
  applyBackbox("P2WL", "SBBWL", wallL.doc);
  applyBackbox("P2RL-P", "SBBRL", wallL.doc);
  applyBackbox("P2WL-P", "SBBWL", wallL.doc);
  applyBackbox("P2RL-SP", "SBBRL", wallL.doc);
  console.log("GAP (reported, not applied): P2GWL requires compact backbox SBBGWL, which does not exist in this catalog -- no accessory relationship added.");
  accGaps.push("P2GWL -> SBBGWL (compact wall surface mount back box) not in catalog");

  const ceilL = GROUPS.find((g) => g.key === "ceiling_horn_strobe_L");
  applyBackbox("PC2RL", "SBBCRL", ceilL.doc);
  applyBackbox("PC2WL", "SBBCWL", ceilL.doc);
  applyBackbox("PC4RL", "SBBCRL", ceilL.doc);
  applyBackbox("PC4WL", "SBBCWL", ceilL.doc);

  const wire4 = GROUPS.find((g) => g.key === "wall_horn_strobe_4wire");
  applyBackbox("P4RL", "SBBRL", wire4.doc);
  applyBackbox("P4WL", "SBBWL", wire4.doc);

  const lf = GROUPS.find((g) => g.key === "wall_horn_strobe_lf");
  applyBackbox("P2RL-LF", "SBBRL", lf.doc);
  applyBackbox("P2WL-LF", "SBBWL", lf.doc);

  console.log("GAP (reported, not applied): outdoor K-series ship with an included weatherproof back box (not a separate catalog product); optional metal weatherproof upgrade (MWBB/MWBBW/MWBBCW) not in catalog -- no accessory relationship added for the 17 outdoor horn/strobe SKUs or the 8 outdoor speaker/strobe SKUs.");
  accGaps.push("Outdoor K-series (25 SKUs) -> MWBB/MWBBW/MWBBCW metal weatherproof back box upgrade not in catalog");

  const wallSpkL = GROUPS.find((g) => g.key === "wall_speaker_strobe_L");
  applyBackbox("SPSRL", "SBBSPRL", wallSpkL.doc);
  applyBackbox("SPSRL-P", "SBBSPRL", wallSpkL.doc);
  applyBackbox("SPSWL", "SBBSPWL", wallSpkL.doc);
  applyBackbox("SPSWL-ALERT", "SBBSPWL", wallSpkL.doc);
  applyBackbox("SPSWL-CLR-ALERT", "SBBSPWL", wallSpkL.doc);
  applyBackbox("SPSWL-P", "SBBSPWL", wallSpkL.doc);

  const ceilSpkL = GROUPS.find((g) => g.key === "ceiling_speaker_strobe_L");
  applyBackbox("SPSCRL", "SBBCRL", ceilSpkL.doc);
  applyBackbox("SPSCWL", "SBBCWL", ceilSpkL.doc);
  applyBackbox("SPSCWL-CLR-ALERT", "SBBCWL", ceilSpkL.doc);
  applyBackbox("SPSCWL-P", "SBBCWL", ceilSpkL.doc);

  // Generic, non-canonical distributor part numbers: description-evidenced facts only.
  for (const entry of GENERIC_PN_GROUP.entries) {
    const attrs = [
      { name: "device_type", operator: "Equal", normalizedValue: entry.device_type, confidence: 70, source: { sourceType: "Product's Own Catalog Description", sourceId: "KSA Honeywell Farenhyt Series Price List", note: "Non-canonical distributor part number; no official Honeywell/System Sensor document names this exact PN. Facts limited to what the product's own description states." } },
      { name: "mounting", operator: "Equal", normalizedValue: entry.mounting, confidence: 70, source: { sourceType: "Product's Own Catalog Description", sourceId: "KSA Honeywell Farenhyt Series Price List" } },
    ];
    applyAttrs(entry.partNumber, attrs);
  }

  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} attributes (${attrsSkipped} skipped); ${stdsAdded} standards (${stdsSkipped} skipped); ${accAdded} backbox relationships (${accSkipped} skipped).`);
console.log(`Reported gaps (not applied, no catalog match):\n - ${accGaps.join("\n - ")}`);
console.log("SYS-HS / SYS-HS-C: generic non-canonical distributor part numbers -- only device_type/mounting facts applied from their own description text; no standards, candela, voltage, or backbox facts asserted.");
