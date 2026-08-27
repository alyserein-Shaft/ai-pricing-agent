#!/usr/bin/env node
/**
 * Sprint 1.33 -- brings the Honeywell/Farenhyt Detector Base, Sounder Base,
 * and Isolator Base families from CLASSIFIED_BUT_SHALLOW (or, for Sounder
 * Base, un-audited) to reusable technical readiness, and completes
 * detector-to-base accessory evidence for the Addressable Smoke Detector
 * (IDP-PHOTO/IDP-PHOTO-T) and Addressable Heat Detector (IDP-HEAT family)
 * families using six official documents, each applied only to the SKUs it
 * explicitly names in its own Compatibility/Ordering Information section.
 *
 * DOC_IDP_PHOTO   Honeywell Farenhyt "IDP-PHOTO-W Series: Intelligent
 *   Plug-in Photoelectric Smoke Detectors" (Doc 351629, Rev A, 04/18). Its
 *   own "ORDERING INFORMATION" / "INTELLIGENT BASES" section explicitly
 *   names IDP-PHOTO-W/IV, IDP-PHOTO-T-W/IV and states "Detectors must be
 *   mounted to one of the Intelligent Bases listed below": B300-6/-IV,
 *   B501-WHITE/-IV/-BL, B200S-WH/-IV, B200SR-WH/-IV, B200S-LF-WH/-IV,
 *   B200SR-LF/-LF-IV, B224RB-WH/-IV, B224BI-WH/-IV.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_PHOTO_W_Datasheet.pdf
 * DOC_B200S       Honeywell Farenhyt "Intelligent Sounder Bases
 *   B200S/B200S-LF" (Doc 351564, Rev C, 08/17). Its own "Compatibility"
 *   section explicitly names IDP-Photo, IDP-Photo-T, IDP-Acclimate,
 *   IDP-Heat, IDP-Heat-ROR, IDP-Heat-HT, IDP-FIRE-CO.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-B200S_B200S_LF_Datasheet.pdf
 * DOC_B200SR      Honeywell Farenhyt "Intelligent Sounder Bases
 *   B200SR/B200SR-LF" (Doc 350266, Rev F, 08/17). Its own "Compatibility"
 *   section explicitly names IDP-Photo, IDP-Photo-T, IDP-Acclimate,
 *   IDP-Heat, IDP-Heat-ROR, IDP-Heat-HT -- deliberately NOT IDP-FIRE-CO,
 *   a real difference from DOC_B200S that must not be collapsed together.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-B200SR_B200SRLF_Datasheet.pdf
 * DOC_B224BI      Honeywell Farenhyt/Silent Knight "B224BI" datasheet (P/N
 *   350298, Rev E). Its own "Compatibility" section explicitly names
 *   IDP-Photo, IDP-Photo-T, IDP-Acclimate, IDP-Ion, IDP-Heat, IDP-Heat-ROR,
 *   IDP-Heat-HT.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDPssb224bi_spec.pdf
 * DOC_B224BI_MAN  System Sensor "B224BI-WH, B224BI-IV Plug-in Isolator
 *   Detector Base" installation manual (Doc I56-3736-005, 02/01/18) --
 *   supplies the base's own electrical/physical specifications (isolation
 *   current, standby current, mounting) not repeated in DOC_B224BI.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/B224BI_Manual_I56-3736.pdf
 * DOC_B224RB_MAN  System Sensor "B224RB-WH, B224RB-IV Plug-in Relay
 *   Detector Base" installation manual (Doc I56-3737-006, 02/01/18) --
 *   supplies relay characteristics (Form C, 2-coil latching, short/long
 *   delay) and electrical specifications. Does not itself name compatible
 *   detector families (that comes from DOC_IDP_PHOTO's own ordering
 *   section, which explicitly lists B224RB-WH/IV as a required base).
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/moved-ss/B224RB_Manual_I56-3737.pdf
 * DOC_B501BH3     Notifier "B501BH-3 Intelligent Sounder Base" datasheet
 *   (DC-201401-N, 04/04/14). Its own "Ordering Information" explicitly
 *   states the B501BH-3CH/B501BH-3/WCH are "used with Notifier intelligent
 *   detectors" and lists only Notifier-brand detector models (FSC-851,
 *   FSI-851, FSP-851, FSP-851T, FST-851, FST-851R, FST-851H, FAPT-851,
 *   FSL-751, SDX-751CH, FDX-551CH) -- NONE of which are IDP-series/Farenhyt
 *   detectors and NONE of which exist anywhere in this catalog. This is
 *   exactly the "same manufacturer, different ecosystem" trap the task
 *   warns against: B501BH-3-S/B501BH-3/W-S are real, valid sounder bases,
 *   but for a detector line this catalog does not carry -- no accessory
 *   relationship is added linking them to any IDP-Photo/IDP-Heat SKU.
 *   https://www.champmarketing.com/images/catalog_images/champ-marketing_datashhet_notifier_b501bh-3_intelligent-sounder-base.pdf
 *
 * Kept genuinely distinct per the task:
 * - Standard detector base (B300-6/B501), sounder base (B200S/B200S-LF),
 *   retrofit sounder base (B200SR/B200SR-LF), isolator base (B224BI), and
 *   relay base (B224RB) each get their own base_type value and their own
 *   evidenced capability facts -- never merged or cross-applied.
 * - B200S's compatible-detector list (7 families, including IDP-FIRE-CO)
 *   is kept distinct from B200SR's (6 families, no IDP-FIRE-CO) -- each
 *   base's accessory relationships are added only to the SKUs its own
 *   document names.
 * - The Notifier-ecosystem B501BH-3-S/B501BH-3/W-S sounder bases are never
 *   linked to any Farenhyt/IDP detector, despite sharing the Honeywell
 *   umbrella and a superficially similar "sounder base" role.
 *
 * Deliberately NOT structured (real, reported gaps):
 * - B500BI (catalog description: "Isolator Base UL (Ivory)") could not be
 *   confidently matched to any official document under this exact part
 *   number -- the closest candidates found (Honeywell/System Sensor
 *   B224BI, a US 6" IDP-series isolator base, and the European B500-series
 *   analogue base family's own "B524IEFT-1" short-circuit isolator base)
 *   are both differently-named products in different ecosystems. No
 *   attributes, standards, or accessory relationships are asserted for
 *   B500BI; it is reported as an unresolved catalog-naming ambiguity.
 * - B501BH-3-S/B501BH-3/W-S: standards/base_type/sounder_capability are
 *   structured from their own official Notifier datasheet, but NO detector
 *   compatibility relationship is added (see above) -- reported as an
 *   orphaned base with no compatible detector in this catalog.
 *
 * Usage:
 *   node scripts/seed-detector-sounder-base-family-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-detector-sounder-base-family-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-detector-sounder-base-family-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const DOC_IDP_PHOTO = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"IDP-PHOTO-W Series: Intelligent Plug-in Photoelectric Smoke Detectors\" (Doc 351629, Rev A, 04/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_PHOTO_W_Datasheet.pdf" };
const DOC_B200S = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"Intelligent Sounder Bases B200S/B200S-LF\" (Doc 351564, Rev C, 08/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-B200S_B200S_LF_Datasheet.pdf" };
const DOC_B200SR = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"Intelligent Sounder Bases B200SR/B200SR-LF\" (Doc 350266, Rev F, 08/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-B200SR_B200SRLF_Datasheet.pdf" };
const DOC_B224BI = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt/Silent Knight \"B224BI\" (P/N 350298, Rev E)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDPssb224bi_spec.pdf" };
const DOC_B224BI_MAN = { sourceType: "Manufacturer Official Installation Manual", sourceId: "System Sensor \"B224BI-WH, B224BI-IV Plug-in Isolator Detector Base\" (Doc I56-3736-005, 02/01/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/B224BI_Manual_I56-3736.pdf" };
const DOC_B224RB_MAN = { sourceType: "Manufacturer Official Installation Manual", sourceId: "System Sensor \"B224RB-WH, B224RB-IV Plug-in Relay Detector Base\" (Doc I56-3737-006, 02/01/18)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/moved-ss/B224RB_Manual_I56-3737.pdf" };
const DOC_B501BH3 = { sourceType: "Manufacturer Official Datasheet", sourceId: "Notifier \"B501BH-3 Intelligent Sounder Base\" (Doc DC-201401-N, 04/04/14)", url: "https://www.champmarketing.com/images/catalog_images/champ-marketing_datashhet_notifier_b501bh-3_intelligent-sounder-base.pdf" };

const fact = (name, value, { operator = "Equal", page, section, doc, confidence = 90, sourceText } = {}) => ({
  name, operator, normalizedValue: value, confidence,
  ...(sourceText ? { sourceText } : {}),
  source: { sourceType: doc.sourceType, sourceId: doc.sourceId, url: doc.url, page, section },
});

const IDP_HEAT_COMPAT = ["IDP-Heat", "IDP-Heat-ROR", "IDP-Heat-HT"];
const IDP_PHOTO_COMPAT = ["IDP-Photo", "IDP-Photo-T", "IDP-Acclimate"];

// ---- Product attribute plan, keyed by part number ----
const PRODUCT_ATTRIBUTES = {
  // Standard detector bases -- not in the governed Detector Base family, but genuine base products this sprint documents for accessory-relationship purposes.
  "B300-6": [fact("base_type", "Standard Detector Base (Flanged Low-Profile)", { doc: DOC_IDP_PHOTO, page: 2, section: "Intelligent Bases" }), fact("compatible_detector_families", IDP_PHOTO_COMPAT.join(", "), { operator: "Informational", doc: DOC_IDP_PHOTO, page: 2, section: "Ordering Information" })],
  "B300-6-IV": [fact("base_type", "Standard Detector Base (Flanged Low-Profile)", { doc: DOC_IDP_PHOTO, page: 2, section: "Intelligent Bases" }), fact("compatible_detector_families", IDP_PHOTO_COMPAT.join(", "), { operator: "Informational", doc: DOC_IDP_PHOTO, page: 2, section: "Ordering Information" })],
  "B501-IV": [fact("base_type", "Standard Detector Base (European Flangeless)", { doc: DOC_IDP_PHOTO, page: 2, section: "Intelligent Bases" }), fact("compatible_detector_families", [...IDP_PHOTO_COMPAT, ...IDP_HEAT_COMPAT].join(", "), { operator: "Informational", doc: DOC_IDP_PHOTO, page: 2, section: "Ordering Information" })],
  "B501-WHITE": [fact("base_type", "Standard Detector Base (European Flangeless)", { doc: DOC_IDP_PHOTO, page: 2, section: "Intelligent Bases" }), fact("compatible_detector_families", [...IDP_PHOTO_COMPAT, ...IDP_HEAT_COMPAT].join(", "), { operator: "Informational", doc: DOC_IDP_PHOTO, page: 2, section: "Ordering Information" })],
  "B501-BL": [fact("base_type", "Standard Detector Base (European Flangeless)", { doc: DOC_IDP_PHOTO, page: 2, section: "Intelligent Bases" }), fact("color_variant", "Black", { operator: "Informational", doc: DOC_IDP_PHOTO, page: 2, section: "Intelligent Bases", sourceText: "B501-BL: Black, standard European flangeless mounting base." })],
  // Isolator detector base (Detector Base family).
  "B224BI-IV": [
    fact("base_type", "Isolator Detector Base", { doc: DOC_B224BI, page: 1, section: "Product Description" }),
    fact("isolator_capability", "Isolates up to 25 IDP-series devices between each B224BI; automatically restores the loop when the short circuit is corrected", { doc: DOC_B224BI, page: 1, section: "Features" }),
    fact("compatible_detector_families", [...IDP_PHOTO_COMPAT, "IDP-Ion", ...IDP_HEAT_COMPAT].join(", "), { operator: "Informational", doc: DOC_B224BI, page: 1, section: "Compatibility" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", doc: DOC_B224BI_MAN, page: 1, section: "Specifications" }),
    fact("mounting_requirement", "4in square, 4in octagon, 3.5in octagon, single-gang, or double-gang junction box", { operator: "Informational", doc: DOC_B224BI_MAN, page: 1, section: "Mounting" }),
  ],
  "B224BI-WH": [
    fact("base_type", "Isolator Detector Base", { doc: DOC_B224BI, page: 1, section: "Product Description" }),
    fact("isolator_capability", "Isolates up to 25 IDP-series devices between each B224BI; automatically restores the loop when the short circuit is corrected", { doc: DOC_B224BI, page: 1, section: "Features" }),
    fact("compatible_detector_families", [...IDP_PHOTO_COMPAT, "IDP-Ion", ...IDP_HEAT_COMPAT].join(", "), { operator: "Informational", doc: DOC_B224BI, page: 1, section: "Compatibility" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", doc: DOC_B224BI_MAN, page: 1, section: "Specifications" }),
    fact("mounting_requirement", "4in square, 4in octagon, 3.5in octagon, single-gang, or double-gang junction box", { operator: "Informational", doc: DOC_B224BI_MAN, page: 1, section: "Mounting" }),
  ],
  // Relay detector base -- no governed family; structured for accessory-relationship completeness only.
  "B224RB-IV": [
    fact("base_type", "Relay Detector Base", { doc: DOC_B224RB_MAN, page: 1, section: "General Information" }),
    fact("relay_capability", "Form C 2-coil latching relay; selectable short delay (60-100ms) or long delay (6-10s)", { doc: DOC_B224RB_MAN, page: 1, section: "Relay Characteristics" }),
    fact("compatible_detector_families", IDP_PHOTO_COMPAT.join(", "), { operator: "Informational", doc: DOC_IDP_PHOTO, page: 2, section: "Ordering Information" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", doc: DOC_B224RB_MAN, page: 1, section: "Specifications" }),
    fact("mounting_requirement", "4in square, 4in octagon, 3.5in octagon, single-gang, or double-gang junction box", { operator: "Informational", doc: DOC_B224RB_MAN, page: 1, section: "Mounting" }),
  ],
  "B224RB-WH": [
    fact("base_type", "Relay Detector Base", { doc: DOC_B224RB_MAN, page: 1, section: "General Information" }),
    fact("relay_capability", "Form C 2-coil latching relay; selectable short delay (60-100ms) or long delay (6-10s)", { doc: DOC_B224RB_MAN, page: 1, section: "Relay Characteristics" }),
    fact("compatible_detector_families", IDP_PHOTO_COMPAT.join(", "), { operator: "Informational", doc: DOC_IDP_PHOTO, page: 2, section: "Ordering Information" }),
    fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", doc: DOC_B224RB_MAN, page: 1, section: "Specifications" }),
    fact("mounting_requirement", "4in square, 4in octagon, 3.5in octagon, single-gang, or double-gang junction box", { operator: "Informational", doc: DOC_B224RB_MAN, page: 1, section: "Mounting" }),
  ],
  // Sounder bases (B200S/B200S-LF).
  ...Object.fromEntries(["B200S-IV", "B200S-WH"].map((pn) => [pn, [
    fact("base_type", "Sounder Base", { doc: DOC_B200S, page: 1, section: "Product Description" }),
    fact("sounder_capability", "High or low volume; Continuous, ANSI Temporal 3, ANSI Temporal 4, March Time tones; custom tone with some FACPs", { doc: DOC_B200S, page: 1, section: "Product Description" }),
    fact("compatible_detector_families", [...IDP_PHOTO_COMPAT, ...IDP_HEAT_COMPAT, "IDP-FIRE-CO"].join(", "), { operator: "Informational", doc: DOC_B200S, page: 1, section: "Compatibility" }),
    fact("operating_voltage_range", "Aux power 16-33VDC (VFWR); SLC 15-32VDC", { operator: "Informational", doc: DOC_B200S, page: 2, section: "Electrical Ratings" }),
    fact("sound_output", "Greater than 85 dBA minimum, UL reverberant room at 10 feet, 24 Volts continuous tone", { operator: "Informational", doc: DOC_B200S, page: 2, section: "Sound Output" }),
    fact("mounting_requirement", "4in square, 4in octagon, 3.5in octagon, single-gang, or double-gang junction box", { operator: "Informational", doc: DOC_B200S, page: 1, section: "Installation" }),
  ]])),
  ...Object.fromEntries(["B200S-LF-IV", "B200S-LF-WH"].map((pn) => [pn, [
    fact("base_type", "Low-Frequency Sounder Base", { doc: DOC_B200S, page: 1, section: "Product Description" }),
    fact("sounder_capability", "520 Hz +/- 10% square wave tone, meets NFPA 72 sleeping space requirement", { doc: DOC_B200S, page: 1, section: "Features & Benefits" }),
    fact("compatible_detector_families", [...IDP_PHOTO_COMPAT, ...IDP_HEAT_COMPAT, "IDP-FIRE-CO"].join(", "), { operator: "Informational", doc: DOC_B200S, page: 1, section: "Compatibility" }),
    fact("operating_voltage_range", "Aux power 16-33VDC (VFWR); SLC 15-32VDC", { operator: "Informational", doc: DOC_B200S, page: 2, section: "Electrical Ratings" }),
    fact("mounting_requirement", "4in square, 4in octagon, 3.5in octagon, single-gang, or double-gang junction box", { operator: "Informational", doc: DOC_B200S, page: 1, section: "Installation" }),
  ]])),
  // Retrofit sounder bases (B200SR/B200SR-LF).
  ...Object.fromEntries(["B200SR-IV", "B200SR-WH"].map((pn) => [pn, [
    fact("base_type", "Retrofit Sounder Base", { doc: DOC_B200SR, page: 1, section: "Product Description" }),
    fact("sounder_capability", "ANSI Temporal 3 or Continuous tone, selectable via jumper", { doc: DOC_B200SR, page: 1, section: "Product Description" }),
    fact("compatible_detector_families", [...IDP_PHOTO_COMPAT, ...IDP_HEAT_COMPAT].join(", "), { operator: "Informational", doc: DOC_B200SR, page: 1, section: "Compatibility" }),
    fact("retrofit_compatibility", "Fully compatible with existing B501BH-Series sounder base installations", { operator: "Informational", doc: DOC_B200SR, page: 1, section: "Product Description" }),
    fact("operating_voltage_range", "External supply 16-33VDC (VFWR); SLC 15-32VDC", { operator: "Informational", doc: DOC_B200SR, page: 2, section: "Electrical Ratings" }),
  ]])),
  ...Object.fromEntries(["B200SR-LF-IV", "B200SR-LF-WH"].map((pn) => [pn, [
    fact("base_type", "Retrofit Low-Frequency Sounder Base", { doc: DOC_B200SR, page: 1, section: "Product Description" }),
    fact("sounder_capability", "520 Hz +/- 10% square wave tone, meets NFPA 72 sleeping space requirement", { doc: DOC_B200SR, page: 1, section: "Product Description" }),
    fact("compatible_detector_families", [...IDP_PHOTO_COMPAT, ...IDP_HEAT_COMPAT].join(", "), { operator: "Informational", doc: DOC_B200SR, page: 1, section: "Compatibility" }),
    fact("retrofit_compatibility", "Fully compatible with existing B501BH-Series sounder base installations", { operator: "Informational", doc: DOC_B200SR, page: 1, section: "Product Description" }),
    fact("operating_voltage_range", "External supply 16-33VDC (VFWR); SLC 15-32VDC", { operator: "Informational", doc: DOC_B200SR, page: 2, section: "Electrical Ratings" }),
  ]])),
  // Notifier-ecosystem sounder base -- orphaned in this catalog, no IDP compatibility.
  "B501BH-3-S": [
    fact("base_type", "Sounder Base", { doc: DOC_B501BH3, page: 1, section: "General" }),
    fact("sounder_capability", "ANSI Temporal 3 or continuous tone via toggle switch; high or low volume with or without gradient tone", { doc: DOC_B501BH3, page: 1, section: "General" }),
    fact("compatible_detector_families", "FSC-851, FSI-851, FSP-851, FSP-851T, FST-851, FST-851R, FST-851H, FAPT-851, FSL-751, SDX-751, FDX-551 (Notifier intelligent detectors -- none of these exist in this catalog; NOT compatible with IDP-series/Farenhyt detectors)", { operator: "Informational", confidence: 92, doc: DOC_B501BH3, page: 1, section: "Ordering Information" }),
    fact("operating_voltage_range", "External supply 16-33VDC; SLC 15-32VDC", { operator: "Informational", doc: DOC_B501BH3, page: 1, section: "Specifications" }),
    fact("sound_output", "High volume: >75dBA anechoic @10ft, 16V; Low volume: 45-75dBA anechoic @10ft, 16V", { operator: "Informational", doc: DOC_B501BH3, page: 1, section: "Sound Output" }),
  ],
  "B501BH-3/W-S": [
    fact("base_type", "Sounder Base", { doc: DOC_B501BH3, page: 1, section: "General" }),
    fact("sounder_capability", "ANSI Temporal 3 or continuous tone via toggle switch; high or low volume with or without gradient tone", { doc: DOC_B501BH3, page: 1, section: "General" }),
    fact("compatible_detector_families", "FSC-851, FSI-851, FSP-851, FSP-851T, FST-851, FST-851R, FST-851H, FAPT-851, FSL-751, SDX-751, FDX-551 (Notifier intelligent detectors -- none of these exist in this catalog; NOT compatible with IDP-series/Farenhyt detectors)", { operator: "Informational", confidence: 92, doc: DOC_B501BH3, page: 1, section: "Ordering Information" }),
    fact("operating_voltage_range", "External supply 16-33VDC; SLC 15-32VDC", { operator: "Informational", doc: DOC_B501BH3, page: 1, section: "Specifications" }),
    fact("sound_output", "High volume: >75dBA anechoic @10ft, 16V; Low volume: 45-75dBA anechoic @10ft, 16V", { operator: "Informational", doc: DOC_B501BH3, page: 1, section: "Sound Output" }),
  ],
};

const STANDARDS = {
  "B224BI-IV": [], "B224BI-WH": [], // "UL Listed" stated with no citable number -- left unresolved.
  "B200S-IV": [{ body: "UL", number: "268" }, { body: "UL", number: "464" }],
  "B200S-WH": [{ body: "UL", number: "268" }, { body: "UL", number: "464" }],
  "B200S-LF-IV": [{ body: "UL", number: "268" }, { body: "UL", number: "464" }],
  "B200S-LF-WH": [{ body: "UL", number: "268" }, { body: "UL", number: "464" }],
  "B200SR-IV": [{ body: "UL", number: "268" }, { body: "UL", number: "464" }, { body: "MEA", number: "457-99-E Vol. V" }],
  "B200SR-WH": [{ body: "UL", number: "268" }, { body: "UL", number: "464" }, { body: "MEA", number: "457-99-E Vol. V" }],
  "B200SR-LF-IV": [{ body: "UL", number: "268" }, { body: "UL", number: "464" }, { body: "MEA", number: "457-99-E Vol. V" }],
  "B200SR-LF-WH": [{ body: "UL", number: "268" }, { body: "UL", number: "464" }, { body: "MEA", number: "457-99-E Vol. V" }],
};
const STANDARDS_DOC = { "B200S-IV": DOC_B200S, "B200S-WH": DOC_B200S, "B200S-LF-IV": DOC_B200S, "B200S-LF-WH": DOC_B200S, "B200SR-IV": DOC_B200SR, "B200SR-WH": DOC_B200SR, "B200SR-LF-IV": DOC_B200SR, "B200SR-LF-WH": DOC_B200SR };

// ---- Accessory relationships: [detectorPN, accessoryPN, relationshipType, doc] ----
const ACCESSORIES = [
  // IDP-PHOTO / IDP-PHOTO-T <-> standard/relay/isolator bases (DOC_IDP_PHOTO's own ordering section).
  ...["IDP-PHOTO-W", "IDP-PHOTO-T-W"].flatMap((pn) => ["B300-6", "B501-WHITE", "B224RB-WH", "B224BI-WH"].map((base) => [pn, base, "Compatible Base", DOC_IDP_PHOTO])),
  ...["IDP-PHOTO-IV", "IDP-PHOTO-T-IV"].flatMap((pn) => ["B300-6-IV", "B501-IV", "B224RB-IV", "B224BI-IV"].map((base) => [pn, base, "Compatible Base", DOC_IDP_PHOTO])),
  // IDP-PHOTO / IDP-PHOTO-T <-> sounder bases (DOC_IDP_PHOTO's own ordering section names these; DOC_B200S/DOC_B200SR corroborate compatibility).
  ...["IDP-PHOTO-W", "IDP-PHOTO-T-W"].flatMap((pn) => ["B200S-WH", "B200SR-WH", "B200S-LF-WH", "B200SR-LF-WH"].map((base) => [pn, base, "Sounding Base", DOC_IDP_PHOTO])),
  ...["IDP-PHOTO-IV", "IDP-PHOTO-T-IV"].flatMap((pn) => ["B200S-IV", "B200SR-IV", "B200S-LF-IV", "B200SR-LF-IV"].map((base) => [pn, base, "Sounding Base", DOC_IDP_PHOTO])),
  // IDP-HEAT family <-> B200S/B200S-LF sounder bases: new evidence this sprint (DOC_B200S names IDP-Heat/IDP-Heat-ROR/IDP-Heat-HT explicitly; B200SR was already linked in Sprint 1.30).
  ...["IDP-HEAT-IV", "IDP-HEAT-ROR-IV", "IDP-HEAT-HT-IV"].flatMap((pn) => ["B200S-IV", "B200S-LF-IV"].map((base) => [pn, base, "Sounding Base", DOC_B200S])),
  ...["IDP-HEAT-W", "IDP-HEAT-ROR-W", "IDP-HEAT-HT-W"].flatMap((pn) => ["B200S-WH", "B200S-LF-WH"].map((base) => [pn, base, "Sounding Base", DOC_B200S])),
];

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, ?, 'One per detector', '[]', 0, 1, ?, 90, 'Approved', 'sprint-1.33-detector-sounder-base-seed')");
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
    if (!stds.length) continue;
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.standards || "[]");
    const existingKeys = new Set(existing.map((e) => `${norm(e.body)}:${norm(e.number)}`));
    const toAdd = stds.filter((s) => !existingKeys.has(`${norm(s.body)}:${norm(s.number)}`));
    for (const s of stds.filter((s) => existingKeys.has(`${norm(s.body)}:${norm(s.number)}`))) { console.log(`SKIP (already present): ${partNumber} -> ${s.body} ${s.number}`); stdsSkipped += 1; }
    if (toAdd.length) {
      const doc = STANDARDS_DOC[partNumber];
      const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, status: "Verified", confidence: 88, source: { sourceType: doc.sourceType, sourceId: doc.sourceId, url: doc.url } }));
      for (const s of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${s.body} ${s.number}`);
      if (apply) updateStandards.run(JSON.stringify([...existing, ...appended]), product.id);
      stdsAdded += appended.length;
    }
  }

  for (const [detectorPN, accessoryPN, relationshipType, doc] of ACCESSORIES) {
    const product = getProduct.get(detectorPN);
    if (!product) throw new Error(`Product not found: ${detectorPN}`);
    const accessory = getProduct.get(accessoryPN);
    if (!accessory) throw new Error(`Accessory product not found: ${accessoryPN}`);
    if (existingAccessory.get(product.id, accessory.id)) { console.log(`SKIP (already present): ${detectorPN} -> ${accessoryPN}`); accSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${detectorPN} -> ${relationshipType}: ${accessoryPN}`);
    if (apply) insertAccessory.run(id("productaccessory"), product.id, accessory.id, relationshipType, JSON.stringify([{ sourceType: doc.sourceType, sourceId: doc.sourceId, url: doc.url }]));
    accAdded += 1;
  }

  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} attributes (${attrsSkipped} skipped); ${stdsAdded} standards (${stdsSkipped} skipped); ${accAdded} accessory relationships (${accSkipped} skipped).`);
console.log("Unresolved/reported gaps: B500BI (no confident official-document match under this exact PN -- no attributes/standards/accessories asserted); B501BH-3-S/B501BH-3/W-S (Notifier-ecosystem sounder bases, no compatible detector in this catalog -- attributes/standards structured but zero accessory relationships added); B224BI standards left unresolved (source doc states only generic 'UL Listed' with no citable number).");
