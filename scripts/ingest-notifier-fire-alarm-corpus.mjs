#!/usr/bin/env node
/**
 * NOTIFIER / INSPIRE CORPUS INGESTION -- governed manufacturer evidence for the
 * Al Mousa School — Clean Golden Run Fire Alarm scope.
 *
 * This ingests ONLY the NOTIFIER families that project's governed device
 * population actually requires. It is not a catalogue dump.
 *
 * IDENTITY MODEL (per GOLDEN-7A3B/7A3B1, enforced by tests):
 *   manufacturer = Honeywell      (NOTIFIER is a Honeywell BRAND, never an
 *   brand        = Notifier         ecosystem and never a manufacturer name)
 *   ecosystem    = NOTIFIER        (resolved by the governed ecosystem decision)
 * Matching, pricing and identity key on manufacturer + part number, never brand.
 *
 * EVIDENCE. Every attribute below is transcribed from a Tier-1 Honeywell /
 * NOTIFIER primary document and carries that document on the attribute itself.
 * Where a document does not state a value, the attribute is NOT written. No
 * value is inferred from a part-number suffix, a sibling model, or a reseller.
 *
 *   DOC_PANEL   DN-62112  N16e / N16x Fire Alarm Control Panel data sheet
 *   DOC_LOOP    SLM-318 Signaling Loop Module data sheet + install LS10243
 *   DOC_SMOKE   DN-60977  FSP-951 Series Addressable Photoelectric Smoke Detectors
 *   DOC_HEAT    DN-60975  FST-951 Series Intelligent Addressable Heat Detectors
 *   DOC_SELFT   DN-62046  Self-Test Series (FSP-951-SELFT / -T-SELFT / FST-951-SELFT)
 *   DOC_BASES   DN-60054  Intelligent Bases (B300-6 / B501 / B224BI / B224RB)
 *   DOC_MODS    HCE-DOC-02-040 Rev B  FMM-1/FMM-101/FZM-1/FCM-1/FRM-1
 *   DOC_MCP     DN-6726   NBG-12LX Addressable Manual Pull Station
 *   DOC_SLCM    51253 Rev U9  SLC Wiring Manual (per-loop limits, protocol use)
 *
 * LIFECYCLE / AVAILABILITY (see app/domain/product-lifecycle-authority.mjs):
 * Manufacturer evidence states US lifecycle only. It is recorded as evidence and
 * is NEVER an exclusion. `Unverified` for KSA/regional availability is recorded
 * as Unverified, which by policy neither warns nor blocks.
 *
 * NOT DELIBERATELY INGESTED (and why):
 *   - ISO-X / ISO-XA: the manufacturer datasheet scopes it to NFS-3030/640 and
 *     the AFP/AM2020 CLIP range. N16 applicability is NOT evidenced, so no N16
 *     compatibility is claimed. Isolation is covered by the B224BI isolator
 *     base instead.
 *   - XP6/XP10 high-density modules, duct housings, voice/ECS, network
 *     hardware: no current Al Mousa BOQ line demands them.
 *   - B501 is NOT created. The part number already exists in the catalogue as a
 *     Honeywell base; the NOTIFIER compatible-base relationship is added to the
 *     existing identity rather than duplicating it.
 *
 * Usage:
 *   node scripts/ingest-notifier-fire-alarm-corpus.mjs <db-path> --dry-run
 *   node scripts/ingest-notifier-fire-alarm-corpus.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) {
  throw new Error("Usage: ingest-notifier-fire-alarm-corpus.mjs <db-path> --dry-run|--apply");
}
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const CREATED_BY = "notifier-corpus-ingestion";

// ---------------------------------------------------------------------------
// Evidence documents (Tier 1, manufacturer primary).
// ---------------------------------------------------------------------------
const DOC = {
  panel: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"N16e N16x Fire Alarm Control Panel\" Data Sheet DN-62112", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/notifier-us/hon-ba-fire-dn-62112.pdf" },
  loop: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"SLM-318 Signaling Loop Module\" (N16 Series) + installation document LS10243-000NF-E", url: "https://buildings.honeywell.com/us/en/products/by-category/fire-life-safety/control-panels/accessories-and-parts/loop-expander-cards/inspire-n16-loop-module" },
  smoke: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"FSP-951 Series Addressable Photoelectric Smoke Detectors\" DN-60977", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/notifier-us/hon-ba-fire-dn-60977.pdf" },
  heat: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"FST-951 Series Intelligent Addressable Heat Detectors\" DN-60975", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/notifier-us/hon-ba-fire-dn-60975.pdf" },
  selft: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"Self-Test Series Intelligent Detectors\" (FSP-951-SELFT / FSP-951T-SELFT / FST-951-SELFT) DN-62046", url: "https://www.foxvalleyfire.com/wp-content/uploads/2022/08/NOTIFIER-FST-951-SELFT-Self-Test-Thermal-Heat-Detector-Data-Sheet-DN-62046.pdf" },
  bases: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"Intelligent Bases\" DN-60054 (B300-6 / B501 / B224BI / B224RB product line information)", url: "https://www.honeywellbuildings.in/assets/datasheet/fire/notifier/detector/B501-WHITE_B200S-WH_B200S-LF-WH_B224BI-WH.PDF" },
  mods: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"FMM-1, FMM-101, FZM-1, FCM-1, FRM-1 Series Monitor, Interface Control & Relay Modules\" HCE-DOC-02-040 Rev B", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/HCE-DOC-02-040-FlashScan-Modules-RevB-v5.pdf" },
  mcp: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"NBG-12LX Addressable Manual Pull Station\" DN-6726", url: "https://ecommercemedia.blob.core.windows.net/websiteassets/TechSheets/DS-NF-NBG-12LX.pdf" },
  slcm: { sourceType: "Manufacturer Technical Manual", sourceId: "Honeywell NOTIFIER \"SLC Wiring Manual\" 51253 Rev U9, sections 1.5.2 (protocol use), 1.7 (SLC capacity), 1.6 (devices)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/wiring-manuals/hbt-fire-51253-U9.pdf" },
  // The FST-951 INSTALLATION MANUAL is the document that states the STANDARD.
  // DN-60975 (the datasheet) only ever names UL LISTING file numbers, and its
  // "Designed to meet UL 268 7th Edition" line is a copy-paste carry-over from
  // the FSP-951 smoke datasheet -- UL 268 is the SMOKE standard, so it cannot
  // be the standard for a heat detector. I56-6522-000 states plainly:
  // "UL 521 listed for Heat Detectors" and "designed to provide open area
  // protection with 50-foot spacing capability as approved by UL 521".
  heatInstall: { sourceType: "Manufacturer Technical Manual", sourceId: "Honeywell NOTIFIER \"FST-951, FST-951-IV, FST-951R, FST-951R-IV, FST-951H, FST-951H-IV Intelligent Programmable Temperature Sensors\" Installation and Maintenance Instructions I56-6522-000", url: "https://fpssa.com.ar/uploads/archivos/Manuales/Notifier/FST-951/FST-951%20%20%20%20I56-6522.pdf" },
  // Duct detector housings. The "NON-RELAY" and "requires photoelectric smoke
  // detector (sold separately)" language is what establishes that the housing
  // carries no address of its own.
  ductHousing: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell \"DNR and DNRW Intelligent Photoelectric Duct Smoke Detectors\" (DNR-Datasheet) + \"DNR(A) and DNRW Intelligent Photoelectric Duct Detectors\" DN-60429", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/DNR-Datasheet.pdf" },
  ductManual: { sourceType: "Manufacturer Technical Manual", sourceId: "Honeywell NOTIFIER \"DNRW Duct Smoke Detector Manual\" I56-3371", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/user-manuals/DNRW_Manual_I56-3371.pdf" },
  // Firefighter telephone. DN-60779 is the NFC-FFT system datasheet: it names
  // the N-FPJ remote phone jack and shows that the jack sits on the telephone
  // circuit, supervised separately from the FACP device addressing.
  fft: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"FirstCommand Fire Fighter Telephone\" NFC-FFT Emergency Voice Evacuation DN-60779", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/notifier-us/hon-ba-fire-dn-60779.pdf" },
  // FTM-1 is the ADDRESSABLE firephone interface. Honeywell product catalogue:
  // "monitor and control a circuit with up to two firefighter phones",
  // "Direct-dial entry of FlashScan address from 1 to 159", "Internal circuitry
  // and relay powered directly by 2-wire SLC loop", "UL Listed: S635".
  ftm: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell \"FTM-1(A) Fire Phone Control Module\" (FlashScan mode only) product datasheet", url: "https://buildings.honeywell.com/us/en/products/by-category/fire-life-safety/i-o-modules/specialty-modules/ftm-1-a-fire-phone-control-module-flashscan-mode-only" },
  // Conventional NAC notification appliances. The candela tables and the UL
  // maximum current draws are the load basis for the NAC assessment.
  av: { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor \"SpectrAlert Advance Selectable Output Notification Appliances\" DN-7087:C1", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-DN-7087.pdf" },
  avOutdoor: { sourceType: "Manufacturer Official Datasheet", sourceId: "System Sensor \"SpectrAlert Advance Outdoor Selectable-Output Horns, Strobes and Horn/Strobes\" A05-0456", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/OutdoorHorns-Strobes-HornStrobes_DataSheet_A05-0456.pdf" },
  // The addressable loop-powered AV range, retained as the EVALUATED AND
  // REJECTED alternative so the architecture decision stays re-testable.
  avLoop: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"Addressable Loop Powered AV Devices\" (FS-WSO / FS-BSO / FS-WST / FS-WSS / FS-BSS)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/HON-Notifier-Datasheet-AV-Device.pdf" },
  // The PMB-AUX supply datasheet is the authority for NAC output current. This
  // is where the corrected 1.5 A per NAC figure comes from.
  pmb: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"PMB-AUX/PMB-AUX-RTO Power Supplies for the N16 Series FACP\" DN-62116", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-DN-62116.pdf" },
  // INSPIRE Version 11 launch guide: persona licence table, PMB counts per
  // persona, and the N16-XUPG -> N16-XUPG2 transition.
  v11: { sourceType: "Manufacturer Official Document", sourceId: "Honeywell NOTIFIER \"NOTIFIER INSPIRE Version 11.0 Launch Guide\" (UL listed documents) -- Panel Licensing V11.0 and Above", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/ul-listed-documents/notifier-inspire/hon-ba-fire-notifier-inspire-version-11-0-launch-guide.pdf" },
  remotePsu: { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell NOTIFIER \"FCPS-24S6 & FCPS-24S8 Series Remote Power Supplies\" DN-6927", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-DN-6927.pdf" },
  // The project's own stated per-circuit output capability. Recorded as a
  // project requirement, NOT as a hardware capability.
  project: { sourceType: "Project Tender Specification", sourceId: "Al Mousa School specification, fire alarm clause: 'each of the four output circuits can be individually programmed as a notification appliance circuit or for general purpose 24 vdc power providing up to 2.5 amps per circuit'", url: null },
};

const attr = (name, value, doc, section, extra = {}) => ({
  name,
  value,
  origin: "EXTRACTED",
  confidence: 92,
  extractionMethod: "manual-research-official-documentation",
  sourceText: extra.sourceText || `${name}: ${value}`,
  source: { ...doc, section },
  ...extra,
});

const volt = (name, op, v, doc, section) => ({ name, operator: op, originalValue: `${v}VDC`, parsedValue: v, originalUnit: "V", normalizedValue: v, normalizedUnit: "V", confidence: 94, sourceText: `Operating Voltage: 15-32VDC`, source: { ...doc, section } });

// ---------------------------------------------------------------------------
// PRODUCTS
// ---------------------------------------------------------------------------
// protocol values are exact manufacturer tokens: FlashScan / CLIP / IDP.
const PRODUCTS = [
  // ---- PLATFORM -----------------------------------------------------------
  {
    partNumber: "N16e",
    family: "Fire Alarm Control Panel",
    description: "NOTIFIER INSPIRE N16e intelligent addressable Fire Alarm Control Panel, chassis mounted, 10-inch touchscreen, 4 NACs, one PMB power supply, one SLM-318 loop included",
    lifecycle: "CURRENT",
    doc: DOC.panel,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.panel, "General"),
      attr("protocol", "FlashScan", DOC.panel, "Specifications"),
      attr("addressing", "Addressable", DOC.panel, "General"),
      attr("native_slc_loops", 3, DOC.panel, "SYSTEM CAPACITY -- Intelligent Signaling Line Circuits, N16e: 1 expandable to 3"),
      attr("max_slc_loops", 3, DOC.panel, "SYSTEM CAPACITY -- N16e: 1 expandable to 3"),
      attr("detectors_per_loop", 159, DOC.panel, "SYSTEM CAPACITY -- Intelligent detectors: 159 per loop"),
      attr("modules_per_loop", 159, DOC.panel, "SYSTEM CAPACITY -- Addressable monitor/control modules: 159 per loop"),
      attr("addressable_devices_per_loop", 318, DOC.panel, "SYSTEM CAPACITY -- 159 detectors + 159 modules per loop"),
      attr("addressable_devices_per_facp", 954, DOC.panel, "SYSTEM CAPACITY -- 3 loops x 318 devices"),
      attr("system_point_ceiling", 954, DOC.panel, "SYSTEM CAPACITY -- maximum intelligent addressable devices"),
      attr("nac_circuits", 4, DOC.panel, "General -- four notification appliance circuits, Class A or B"),
      // ---- NAC OUTPUT CAPACITY: corrected 2026-09-30 -----------------------
      // CORRECTION. An earlier pass recorded 2.5 A per NAC circuit. That was
      // WRONG, and the origin of the error is worth recording: 2.5 A is the
      // panel's PRIMARY AC INPUT rating at 120 V
      //   "PMB-AUX(-RTO) : 120VAC 50/60 Hz 2.5A, 240VAC 50/60 Hz, 1.25A"
      // under ELECTRICAL SPECIFICATIONS -> Primary Input Power.
      // An AC input current was read as a DC output capacity. The two are
      // unrelated quantities and must never be conflated.
      //
      // The manufacturer capability is per the PMB-AUX datasheet DN-62116:
      //   "NAC outputs (power-limited) : ... 1.5A Special Applications Class A/B
      //    Aux Power, UZC"
      // and the total per supply is the "6.0 A power supply" of DN-62112.
      attr("nac_amps_per_circuit", 1.5, DOC.pmb, "SPECIFICATIONS -- NAC outputs (power-limited): '1.5A Special Applications Class A/B Aux Power'"),
      attr("nac_amps_per_circuit_entity", "MANUFACTURER_CAPABILITY", DOC.pmb, "SPECIFICATIONS -- 1.5A is the stated N16/PMB-AUX NAC output limit"),
      attr("ac_input_amps_120v", 2.5, DOC.panel, "ELECTRICAL SPECIFICATIONS -- Primary Input Power: 'PMB-AUX(-RTO): 120VAC 50/60 Hz 2.5A, 240VAC 50/60 Hz, 1.25A'"),
      attr("ac_input_entity", "AC_INPUT_NOT_NAC_CAPACITY", DOC.panel, "ELECTRICAL SPECIFICATIONS -- Primary Input Power. This figure is the supply's input current and must NOT be used as a NAC output capacity."),
      attr("pmb_total_nac_amps", 6.0, DOC.panel, "FEATURES -- '6.0 A power supply with customizable outputs'; PMB-AUX is an 'Auxiliary power supply, 6 amps'"),
      attr("pmb_aux_outputs_amps_each", 1.5, DOC.pmb, "FEATURES -- 'Secondary Power Auxiliary Outputs: 24V @ 1.5A each'"),
      // The project specification's "2.5 amps per circuit" clause, and what it
      // actually means. CORRECTED 2026-09-30: an earlier pass recorded this as an
      // UNRESOLVED_CONFLICT against the N16 hardware. That was over-stated, and
      // reading the full clause shows why.
      //
      // The clause is item (k) of a product-description list for a SEPARATE
      // ADDRESSABLE POWER SUPPLY under specification article 10.0, not a
      // requirement on the N16 control unit. The surrounding items identify the
      // product: (b) "it supplies 0.5 amps of auxiliary 24 VDC power", (c) "It
      // features four individually ADDRESSABLE notification appliance circuits",
      // (f) "Connection from the fire alarm control panel (FACP) to the power
      // supply is made via the signaling line circuit (SLC)... Supplies lacking
      // intelligent interface capabilities are not suitable replacements", (g)
      // supervision reporting "its address to the FACP over the SLC".
      //
      // So the 2.5 A describes the output rating of that addressable remote
      // supply. The N16's internal PMB is a different class of device (6 A total,
      // 1.5 A per NAC) and is NOT the product the clause describes. There is
      // therefore no requirement that the N16 base PMB deliver 2.5 A per NAC.
      attr("project_requested_amps_per_circuit", 2.5, DOC.project, "Al Mousa specification article 10.0, item (k): 'Each of the four output circuits can be individually programmed as a notification appliance circuit or for general purpose 24 VDC power, providing up to 2.5 amps per circuit.'"),
      attr("project_requested_entity", "PROJECT_DESCRIBES_A_SEPARATE_ADDRESSABLE_POWER_SUPPLY_NOT_THE_N16_PMB", DOC.project, "Al Mousa specification article 10.0 items (b), (c), (f), (g) identify an individually addressable remote power supply reporting to the FACP over the SLC"),
      attr("project_clause_semantics", "RESOLVED_AS_C -- the clause is a product-description statement about a separate addressable power supply, and a stated ceiling ('providing UP TO 2.5 amps per circuit') on that supply's output circuits. It is not a mandatory obligation on the selected N16 control unit, and it is not a requirement that an N16 NAC deliver 2.5 A. The requirement's own classification is Informational with approved_for_downstream=0 and review_status='Needs Review'. If the design ever needs more than 1.5 A on an individual NAC, it is satisfied by the separate addressable supply of article 10.0, not by the N16 PMB.", DOC.project, "Al Mousa specification article 10.0, item (k), read with items (b), (c), (f) and (g)"),
      attr("capability_conflict", "RESOLVED_NO_CONFLICT_AGAINST_THE_N16 -- an earlier pass recorded an unresolved conflict here. Reading the full clause shows the 2.5 A describes a separate ADDRESSABLE REMOTE POWER SUPPLY (article 10.0), not the N16's internal PMB. The N16 PMB capability of 1.5 A per NAC / 6.0 A per PMB is therefore not in conflict with this clause. What IS still open is the SELECTION and QUANTITY of that remote addressable supply, which remain PENDING_PER_BUILDING_NOTIFICATION_ALLOCATION.", DOC.project, "Al Mousa specification article 10.0 read in full"),
      attr("remote_supply_path", "Separate ADDRESSABLE remote power supply per specification article 10.0 (individually addressable NACs reporting to the FACP over the SLC, 12-200 Ah charger, 2.5 A per output circuit). NOTIFIER's governed candidates for NAC expansion are the FCPS-24S6 / FCPS-24S8 (DN-6927): 3.0 A maximum per circuit, 6.0 A (S6) or 8.0 A (S8) full-load, UL 864 NAC-expander mode, System Sensor / Wheelock / Gentex Commander 2 synchronisation. Selection and quantity both require circuit-level load data.", DOC.remotePsu, "General -- 'primary applications include Notification Appliance (NAC) expansion'"),
      // ---- PERSONA AND POWER-SUPPLY COUNTS (INSPIRE V11 launch guide) -----
      attr("n16e_persona_pmb_count", 1, DOC.v11, "Licensable Features per panel -- 'Number of Power Supplies: N16E Persona Base 1'"),
      attr("n16x_persona_pmb_count_max", 3, DOC.v11, "Licensable Features per panel -- 'Number of Power Supplies: N16X Persona Base 1, Maximum 3'"),
      // ---- UPGRADE LICENCE: current new-order SKU --------------------------
      attr("persona_upgrade_license_current", "N16-XUPG2", DOC.v11, "Panel Licensing V11.0 and Above -- 'NEW UPGRADE LICENSE WITH ADDED FUNCTIONALITY ... For all new orders recommended to use N16-XUPG2'"),
      attr("persona_upgrade_license_legacy", "N16-XUPG", DOC.v11, "Panel Licensing V11.0 and Above -- 'N16-XUPG is being phased out over next 6 months. Existing N16-XUPG in your CLSS accounts can still be used on V11.0 panels'"),
      attr("persona_upgrade_license_commercial_rule", "New procurement uses N16-XUPG2. N16-XUPG is a LEGACY alternative, available only from existing CLSS accounts. Historical N16-XUPG evidence is retained and is not deleted.", DOC.v11, "Panel Licensing V11.0 and Above"),
      attr("xupg2_added_functionality", "Support for up to ten loops; support for up to 3 PMBs; Agent Releasing zones (multiples of 10, max 50); Water Releasing zones (multiples of 10, max 100)", DOC.v11, "NEW UPGRADE LICENSE WITH ADDED FUNCTIONALITY -- N16-XUPG2"),
      attr("remote_supply_path", "FCPS-24S6 / FCPS-24S8 remote power supplies (NOTIFIER, DN-6927) for NAC expansion beyond internal PMB capacity: 3.0 A maximum per circuit; 6.0 A (S6) or 8.0 A (S8) full-load output; UL 864 NAC-expander mode; System Sensor / Wheelock / Gentex Commander 2 synchronisation. Quantity requires circuit-level load data.", DOC.remotePsu, "General -- 'primary applications include Notification Appliance (NAC) expansion'"),
      // ---- CAUSE AND EFFECT / SUPERVISORY EVENT PROGRAMMING ----------------
      // The Al Mousa specification requires "duct detector activation must
      // trigger only a supervisory alarm and not initiate evacuation unless a
      // confirmed fire is detected". That is a PROGRAMMING obligation on the
      // control unit, NOT a property of the duct detector housing. It is
      // recorded here, on the panel that must implement it, so that the
      // obligation travels with the product that discharges it.
      //
      // It is deliberately NOT inferred from the duct housing being "non-relay".
      // A non-relay housing means the device has no relay contact of its own;
      // whether the panel reports the alarm or a supervisory signal is a
      // separate, programmable decision made at the FACP.
      attr("cause_and_effect_programmable", "Yes", DOC.panel, "FEATURES -- 'Programmable Cause / Effect on Outputs'; 'Field programmable with VeriFire Tools'"),
      attr("logic_equation_capacity", 2000, DOC.panel, "FEATURES -- 'Up to 2000 powerful Boolean logic equations'"),
      attr("supports_non_alarm_points", "Yes", DOC.panel, "FEATURES -- 'Non-alarm points for lower priority functions'"),
      attr("supervisory_is_a_first_class_event", "Yes", DOC.panel, "FEATURES -- history filters sort 'all events, alarms only, troubles only, supervisory only, other/security events'"),
      attr("per_device_event_class_programmable", "Yes", DOC.panel, "FEATURES -- 'Sub-addressing for multi criteria devices supports independent configuration of individual elements... allowing to generate separate alarm/supervisory/non-fire/no event for each element'; 'Labeled programmable supervisory events'"),
      attr("duct_supervisory_requirement", "PROGRAMMING_REQUIRED -- the FACP must be programmed so that duct detector activation annunciates as SUPERVISORY and does not initiate evacuation or notification, per the Al Mousa specification. This is a site cause-and-effect setting, NOT a product attribute and NOT implied by the non-relay housing.", DOC.panel, "FEATURES -- programmable event class and cause/effect; N16 Installation and Programming Manual LS10239-000NF-E section 4.7 'Programming Supervisory' and section 3.3.16 'Detector Point Programming'"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.panel, "General"),
      attr("power_supply_type", "PMB-AUX(-RTO)", DOC.panel, "ELECTRICAL SPECIFICATIONS -- Primary Input Power"),
      attr("programmable_software_zones", 2000, DOC.panel, "SYSTEM CAPACITY -- Programmable software zones: over 2000"),
      attr("network_nodes_per_network", 200, DOC.panel, "Network options -- high-speed network up to 200 nodes"),
      attr("listing", "UL/ULC S635", DOC.panel, "Listings and Approvals"),
      attr("standard_compliance", "UL 864 10th Edition", DOC.slcm, "1.2 UL 864 Compliance -- N16 certified to comply with UL 864 10th Edition"),
    ],
  },
  {
    partNumber: "SLM-318",
    family: "Loop Expander Module",
    description: "NOTIFIER INSPIRE SLM-318 Signaling Loop Module, plug-in SLC expansion card for the N16 Series, factory FlashScan, Self-Test capable",
    lifecycle: "CURRENT",
    doc: DOC.loop,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.loop, "Overview"),
      attr("protocol", "FlashScan", DOC.loop, "Overview -- comes factory programmed in FlashScan protocol"),
      attr("detectors_per_loop", 159, DOC.loop, "Features -- 159 detectors and 159 modules per SLM-318"),
      attr("modules_per_loop", 159, DOC.loop, "Features -- 159 detectors and 159 modules per SLM-318"),
      attr("addressable_devices_per_loop", 318, DOC.loop, "Features -- 159 detectors + 159 modules = 318 intelligent addressable devices per SLM-318"),
      attr("address_type", "Addressable", DOC.loop, "General"),
      attr("max_cards_per_panel", 10, DOC.loop, "Overview -- supports up to ten SLM-318 cards"),
      attr("class_b_loop_length_ft", 12500, DOC.loop, "Features -- up to 12,500 feet (3,810 m) on a Class B SLC loop, 12 AWG"),
      attr("loop_resistance_ohms_max", 50, DOC.slcm, "2.2 Two-Wire SLC Class B -- 50 ohms for SLM-318/N16"),
      attr("self_test_support", "Supported", DOC.loop, "Features -- support Self-Test Series intelligent devices"),
      attr("loop_resistance_ohms_max_with_self_test", 35, DOC.slcm, "2.2 -- 35 ohms for current SLM-318 (CLP-2PCB) with self-test detectors installed"),
      attr("clip_license_required", "Yes", DOC.loop, "Overview -- activate CLIP protocol support on all connected loops by adding a CLIP license to the N16 panel"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.loop, "Overview -- provides additional SLC loops on the N16 Series"),
      attr("listing", "UL/ULC S635; FM FM23FPUS0095; CSFM 7165-0028:0516", DOC.loop, "Certifications"),
      attr("standard_compliance", "UL 864 10th Edition", DOC.slcm, "1.2 UL 864 Compliance"),
    ],
  },
  {
    // N16x is a licensed PERSONA on N16e hardware, not a purchasable model.
    // Recorded so the identity is not invented, and so the loop ceiling is
    // available for sizing without a consumer ever trying to order it.
    partNumber: "N16x",
    family: "Fire Alarm Control Panel",
    description: "NOTIFIER INSPIRE N16x -- ten-loop licensed persona enabled on N16e hardware by the one-time N16-XUPG licence. Not a separately purchasable model.",
    lifecycle: "CURRENT",
    doc: DOC.panel,
    reviewStatus: "Needs Review",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.panel, "General"),
      attr("protocol", "FlashScan", DOC.panel, "Specifications"),
      attr("addressing", "Addressable", DOC.panel, "General"),
      attr("persona_of", "N16e", DOC.panel, "N16x configuration -- ten-loop persona"),
      attr("persona_licence", "N16-XUPG", DOC.panel, "N16x configuration -- upgrade licence"),
      attr("purchasable_model", "No", DOC.panel, "N16x configuration -- licensed persona, not an orderable model"),
      attr("native_slc_loops", 10, DOC.panel, "SYSTEM CAPACITY -- N16x: 1 expandable to 10"),
      attr("max_slc_loops", 10, DOC.panel, "SYSTEM CAPACITY -- N16x: 1 expandable to 10"),
      attr("detectors_per_loop", 159, DOC.panel, "SYSTEM CAPACITY -- Intelligent detectors: 159 per loop"),
      attr("modules_per_loop", 159, DOC.panel, "SYSTEM CAPACITY -- Addressable monitor/control modules: 159 per loop"),
      attr("addressable_devices_per_loop", 318, DOC.panel, "SYSTEM CAPACITY -- per loop"),
      attr("addressable_devices_per_facp", 3180, DOC.panel, "General -- up to 10 SLM-318 modules for up to 3,180 intelligent addressable devices"),
      attr("system_point_ceiling", 3180, DOC.panel, "General -- 3,180 intelligent addressable devices"),
      attr("programmable_software_zones", 2000, DOC.panel, "SYSTEM CAPACITY -- Programmable software zones: over 2000"),
      attr("network_nodes_per_network", 200, DOC.panel, "Network options -- high-speed network up to 200 nodes"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.panel, "General"),
      attr("listing", "UL/ULC S635", DOC.panel, "Listings and Approvals"),
      attr("standard_compliance", "UL 864 10th Edition", DOC.slcm, "1.2 UL 864 Compliance"),
    ],
  },

  // ---- SMOKE --------------------------------------------------------------
  {
    partNumber: "FSP-951-IV",
    family: "Addressable Smoke Detector",
    description: "Notifier FSP-951-IV intelligent addressable photoelectric smoke detector, ivory, FlashScan and CLIP protocol",
    lifecycle: "CURRENT",
    doc: DOC.smoke,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.smoke, "Product Line Information"),
      attr("protocol", "FlashScan", DOC.smoke, "Product Line Information -- -IV suffix indicates CLIP and FlashScan device"),
      attr("clip_protocol_support", "Yes", DOC.smoke, "Product Line Information -- -IV suffix indicates CLIP and FlashScan device"),
      attr("addressing", "Addressable", DOC.smoke, "ADDRESSING"),
      attr("address_type", "Addressable", DOC.smoke, "ADDRESSING"),
      attr("detection_principle", "Photoelectric", DOC.smoke, "Features"),
      attr("device_role", "SLC_FIELD_DEVICE", DOC.smoke, "Two-wire SLC loop connection"),
      attr("address_consumption", 1, DOC.smoke, "ADDRESSING -- rotary, decimal addressing"),
      attr("flashscan_address_max", 159, DOC.smoke, "ADDRESSING -- 1-159 on FlashScan systems"),
      attr("clip_address_max", 99, DOC.smoke, "ADDRESSING -- 01-99 on CLIP systems"),
      volt("Voltage", "Minimum", 15, DOC.smoke, "SPECIFICATIONS"),
      volt("Voltage", "Maximum", 32, DOC.smoke, "SPECIFICATIONS"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.8 Intelligent Detectors"),
      attr("base_required", "Yes", DOC.smoke, "SLC LOOP -- unit uses base for wiring"),
      attr("listing", "UL 268 7th Edition", DOC.smoke, "Features -- designed to meet UL268 7th Edition"),
      attr("standard_compliance", "UL 268 7th Edition", DOC.smoke, "Features"),
    ],
  },
  {
    partNumber: "FSP-951T-IV",
    family: "Addressable Smoke Detector",
    description: "Notifier FSP-951T-IV intelligent addressable photoelectric smoke detector with built-in 135 degrees F fixed-temperature thermal device, FlashScan and CLIP",
    lifecycle: "CURRENT",
    doc: DOC.smoke,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.smoke, "Product Line Information"),
      attr("protocol", "FlashScan", DOC.smoke, "Product Line Information"),
      attr("clip_protocol_support", "Yes", DOC.smoke, "Product Line Information -- -IV suffix"),
      attr("addressing", "Addressable", DOC.smoke, "ADDRESSING"),
      attr("address_type", "Addressable", DOC.smoke, "ADDRESSING"),
      attr("detection_principle", "Photoelectric and Fixed Temperature", DOC.smoke, "Product Line Information -- same as FSP-951 but includes a built-in 135 degrees F (57C) fixed-temperature thermal device"),
      attr("device_role", "SLC_FIELD_DEVICE", DOC.smoke, "Two-wire SLC loop connection"),
      attr("address_consumption", 1, DOC.smoke, "ADDRESSING"),
      attr("fixed_temperature_setpoint", "135°F", DOC.smoke, "Product Line Information"),
      volt("Voltage", "Minimum", 15, DOC.smoke, "SPECIFICATIONS"),
      volt("Voltage", "Maximum", 32, DOC.smoke, "SPECIFICATIONS"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.8 Intelligent Detectors"),
      attr("base_required", "Yes", DOC.smoke, "SLC LOOP -- unit uses base for wiring"),
      attr("standard_compliance", "UL 268 7th Edition", DOC.smoke, "Features"),
    ],
  },

  // ---- HEAT ---------------------------------------------------------------
  {
    // CORRECTED 2026-09-30. An earlier ingestion gave FST-951-IV a
    // rate_of_rise_sensitivity attribute. DN-60975 states the opposite:
    //   "FST-951-IV: Ivory, low-profile intelligent 135 deg F FIXED THERMAL
    //    SENSOR, FlashScan and CLIP"
    //   "FST-951R-IV: Ivory, low-profile intelligent RATE-OF-RISE FIXED THERMAL
    //    SENSOR, FlashScan and CLIP"
    //   "Rate-of-rise model (FST-951R), 15 deg F (8.3 deg C) per minute"
    // FST-951-IV therefore has NO rate-of-rise function. The ROR attribute is
    // removed rather than softened, and the ROR-capable model is FST-951R-IV.
    partNumber: "FST-951-IV",
    family: "Addressable Heat Detector",
    description: "Notifier FST-951-IV intelligent addressable 135 degrees F FIXED thermal sensor, ivory, FlashScan and CLIP. Fixed temperature only; NO rate-of-rise function.",
    lifecycle: "CURRENT",
    doc: DOC.heat,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.heat, "General"),
      attr("protocol", "FlashScan", DOC.heat, "General"),
      attr("clip_protocol_support", "Yes", DOC.heat, "General"),
      attr("addressing", "Addressable", DOC.heat, "General"),
      attr("address_type", "Addressable", DOC.heat, "General"),
      attr("detection_principle", "Fixed Temperature", DOC.heat, "Product Line Information -- 'FST-951-IV: Ivory, low-profile intelligent 135F fixed thermal sensor, FlashScan and CLIP'"),
      attr("device_role", "SLC_FIELD_DEVICE", DOC.heat, "General"),
      attr("address_consumption", 1, DOC.heat, "ADDRESSING"),
      attr("fixed_temperature_setpoint", "135°F", DOC.heat, "Product Line Information -- FST-951-IV factory preset to 135F (57C)"),
      attr("rate_of_rise_supported", "No", DOC.heat, "Product Line Information -- the rate-of-rise model is the distinct FST-951R; FST-951-IV is the fixed temperature model"),
      volt("Voltage", "Minimum", 15, DOC.heat, "Electrical specifications -- Voltage range 15-32 volts DC peak"),
      volt("Voltage", "Maximum", 32, DOC.heat, "Electrical specifications -- Voltage range 15-32 volts DC peak"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.8 Intelligent Detectors"),
      attr("base_required", "Yes", DOC.heat, "General -- unit uses base for wiring"),
      // UL 521 is the STANDARD (Honeywell I56-6522-000: "UL 521 listed for Heat
      // Detectors"). S2101 / S747 are LISTING file identifiers, retained both,
      // scoped to their own datasheet revision. See FST-951R-IV for the full note.
      attr("standard_compliance", "UL 521", DOC.heatInstall, "SPECIFICATIONS -- 'UL 521 listed for Heat Detectors'; '50-foot spacing capability as approved by UL 521'"),
      attr("ul_listing_file", "S2101", DOC.heat, "Listings and Approvals (DN-60975 Rev A, 4/23/2018) -- 'UL/ULC Listing: S2101'"),
      attr("ul_listing_file_revised", "S747", DOC.heat, "Listings and Approvals (DN-60975 Rev B, 6/26/2019) -- 'UL/ULC Listing: S747'"),
      attr("ul_listing_entity_type", "LISTING_FILE_IDENTIFIER_NOT_A_STANDARD", DOC.heat, "Listings and Approvals"),
    ],
  },
  {
    // The rate-of-rise variant. This is the model that satisfies the Al Mousa
    // clause "c) Rate-of-rise detection at 15F (8.3C) per minute" TOGETHER with
    // "d) Factory-set fixed temperature at 135F (57C)" on an addressable device
    // that is "f) Compatible with Flash Scan and CLIP protocol systems".
    partNumber: "FST-951R-IV",
    family: "Addressable Heat Detector",
    description: "Notifier FST-951R-IV intelligent addressable rate-of-rise fixed thermal sensor, ivory, FlashScan and CLIP. 135F fixed plus 15F per minute rate-of-rise. THE rate-of-rise model of the FST-951 series.",
    lifecycle: "CURRENT",
    doc: DOC.heat,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.heat, "Product Line Information"),
      attr("protocol", "FlashScan", DOC.heat, "Product Line Information"),
      attr("clip_protocol_support", "Yes", DOC.heat, "Product Line Information -- -IV suffix indicates CLIP and FlashScan device"),
      attr("addressing", "Addressable", DOC.heat, "ADDRESSING -- Addressable by device; rotary, decimal addressing (1-99 on CLIP systems, 1-159 on FlashScan systems)"),
      attr("address_type", "Addressable", DOC.heat, "ADDRESSING"),
      attr("detection_principle", "Rate-of-Rise and Fixed Temperature", DOC.heat, "Product Line Information -- 'FST-951R-IV: Ivory, low-profile intelligent rate-of-rise fixed thermal sensor, FlashScan and CLIP'"),
      attr("device_role", "SLC_FIELD_DEVICE", DOC.heat, "General"),
      attr("address_consumption", 1, DOC.heat, "ADDRESSING"),
      attr("fixed_temperature_setpoint", "135°F", DOC.heat, "Thermal ratings -- fixed-temperature set point 135F (57C)"),
      attr("rate_of_rise_sensitivity", "15°F/min", DOC.heatInstall, "SPECIFICATIONS -- 'Rate-of Rise Detection: Responds to greater than 15F/minute or 135F (8.3C/minute or 57C)'"),
      attr("rate_of_rise_supported", "Yes", DOC.heatInstall, "GENERAL DESCRIPTION -- 'FST-951R and FST-951R-IV will default to a 135F fixed heat detector and rate-of-rise'"),
      volt("Voltage", "Minimum", 15, DOC.heat, "Electrical specifications -- Voltage range 15-32 volts DC peak"),
      volt("Voltage", "Maximum", 32, DOC.heat, "Electrical specifications -- Voltage range 15-32 volts DC peak"),
      attr("flashscan_address_max", 159, DOC.heat, "ADDRESSING -- 1-159 on FlashScan systems"),
      attr("clip_address_max", 99, DOC.heat, "ADDRESSING -- 1-99 on CLIP systems"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.8 Intelligent Detectors"),
      attr("base_required", "Yes", DOC.heat, "General -- unit uses base for wiring"),
      // ---- STANDARD vs LISTING: the distinction the datasheet blurs -------
      // DN-60975 never names a standard for this series; it names UL LISTING
      // file numbers. Its "Designed to meet UL 268 7th Edition" line is a
      // copy-paste carry-over from the FSP-951 SMOKE datasheet -- UL 268 is the
      // smoke standard, so it cannot be the standard for a heat detector. The
      // STANDARD comes from the installation manual.
      attr("standard_compliance", "UL 521", DOC.heatInstall, "SPECIFICATIONS -- 'UL 521 listed for Heat Detectors'; '50-foot spacing capability as approved by UL 521'"),
      // S2101 and S747 are BOTH UL LISTING FILE identifiers for the SAME FST-951
      // series, differing only by datasheet revision. Both are retained, each
      // scoped to its own document revision, because choosing one arbitrarily
      // would discard real manufacturer evidence. Neither is a standard, and
      // neither is written into the product `standards` field.
      attr("ul_listing_file", "S2101", DOC.heat, "Listings and Approvals (DN-60975 Rev A, 4/23/2018) -- 'UL/ULC Listing: S2101'"),
      attr("ul_listing_file_revised", "S747", DOC.heat, "Listings and Approvals (DN-60975 Rev B, 6/26/2019) -- 'UL/ULC Listing: S747'"),
      attr("ul_listing_revision_note", "DN-60975 Rev A (4/23/2018) states UL/ULC Listing S2101; DN-60975 Rev B (6/26/2019) states UL/ULC Listing S747 for the same FST-951 series. Both are retained as source/revision-scoped LISTING evidence. Both are listing FILE identifiers, NOT standards. The governing standard is UL 521.", DOC.heat, "Listings and Approvals"),
      attr("ul_listing_entity_type", "LISTING_FILE_IDENTIFIER_NOT_A_STANDARD", DOC.heat, "Listings and Approvals"),
    ],
  },
  {
    partNumber: "FST-951H-IV",
    family: "Addressable Heat Detector",
    description: "Notifier FST-951H-IV intelligent addressable 190 degrees F high-temperature heat detector, ivory, FlashScan and CLIP. ALTERNATIVE/REFERENCE ONLY -- the governed Al Mousa decision is 9 standard ambient and 0 high-temperature.",
    lifecycle: "CURRENT",
    doc: DOC.heat,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.heat, "General"),
      attr("protocol", "FlashScan", DOC.heat, "General"),
      attr("clip_protocol_support", "Yes", DOC.heat, "General"),
      attr("addressing", "Addressable", DOC.heat, "General"),
      attr("address_type", "Addressable", DOC.heat, "General"),
      attr("detection_principle", "Fixed High Temperature", DOC.heat, "General -- 190F/88C fixed high-temperature"),
      attr("device_role", "SLC_FIELD_DEVICE", DOC.heat, "General"),
      attr("address_consumption", 1, DOC.heat, "ADDRESSING"),
      attr("fixed_temperature_setpoint", "190°F", DOC.heat, "Thermal ratings -- 190F/88C fixed high temperature"),
      volt("Voltage", "Minimum", 15, DOC.heat, "Electrical ratings"),
      volt("Voltage", "Maximum", 32, DOC.heat, "Electrical ratings"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.8 Intelligent Detectors"),
      attr("base_required", "Yes", DOC.heat, "General"),
      // Sourced to the installation manual like the rest of the series, so the
      // whole FST-951 family agrees on WHICH standard it is listed to. The
      // previous "UL 521 7th Edition" carried an edition claim that the
      // manufacturer's own document does not make.
      attr("standard_compliance", "UL 521", DOC.heatInstall, "SPECIFICATIONS -- 'UL 521 listed for Heat Detectors'"),
      attr("ul_listing_file", "S2101", DOC.heat, "Listings and Approvals (DN-60975 Rev A, 4/23/2018) -- 'UL/ULC Listing: S2101'"),
      attr("ul_listing_file_revised", "S747", DOC.heat, "Listings and Approvals (DN-60975 Rev B, 6/26/2019) -- 'UL/ULC Listing: S747'"),
      attr("ul_listing_entity_type", "LISTING_FILE_IDENTIFIER_NOT_A_STANDARD", DOC.heat, "Listings and Approvals"),
    ],
  },

  // ---- DUCT DETECTOR ASSEMBLY ---------------------------------------------
  // The Al Mousa specification governs this assembly in three clauses:
  //   "UL 268A 4th Edition 2009 -- UL Standard for Safety: Smoke Detectors for
  //    Duct Application"
  //   "The air duct smoke detector shall be an intelligent NON RELAY
  //    photoelectric type with either an indoor or NEMA4 watertight enclosure
  //    for outdoor use"
  //   "Duct detector activation must trigger only a SUPERVISORY alarm and not
  //    initiate evacuation unless a confirmed fire is detected"
  // "Intelligent non-relay photoelectric" is the exact Honeywell description of
  // the DNR / DNRW housings, and "supervisory only" is exactly what a non-relay
  // housing does. The addressable element is the plug-in head, so the assembly
  // is ONE detector-side address and the housing is NOT a second point.
  {
    partNumber: "FSP-951R-IV",
    family: "Duct Detector",
    description: "Notifier FSP-951R-IV intelligent addressable photoelectric smoke detector, remote test capable, ivory, for use with DNR/DNRW duct detector housings. FlashScan and CLIP. THE addressable element of an addressable duct detector.",
    lifecycle: "CURRENT",
    doc: DOC.smoke,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.smoke, "General"),
      attr("protocol", "FlashScan", DOC.smoke, "Product Line Information"),
      attr("clip_protocol_support", "Yes", DOC.smoke, "Product Line Information -- '-IV' suffix indicates CLIP and FlashScan device"),
      attr("addressing", "Addressable", DOC.smoke, "ADDRESSING -- Addressable by device; rotary, decimal addressing (1-99 on CLIP systems, 1-159 on FlashScan systems)"),
      attr("address_type", "Addressable", DOC.smoke, "ADDRESSING"),
      attr("detection_principle", "Photoelectric", DOC.smoke, "Product Line Information -- 'FSP-951R-IV: Ivory, low-profile intelligent photoelectric sensor, remote test capable, for use with DNR/DNRW'"),
      attr("device_role", "SLC_FIELD_DEVICE", DOC.smoke, "General"),
      // THE decisive attribute. "Each FSP-951 Series detector uses one of the
      // panel's addresses (total limit is panel dependent) on the NOTIFIER SLC."
      attr("address_consumption", 1, DOC.smoke, "Operation -- each FSP-951 Series detector uses one of the panel's addresses on the NOTIFIER SLC"),
      attr("address_resource_class", "DETECTOR", DOC.smoke, "Operation -- the head is an addressable detector point on the SLC"),
      attr("remote_test_capable", "Yes", DOC.smoke, "Features -- remote test feature from the panel"),
      attr("required_housing", "DNR or DNRW", DOC.smoke, "Product Line Information -- 'for use with DNR/DNRW'"),
      // ---- NON-RELAY HOUSING  vs  SUPERVISORY EVENT CLASSIFICATION --------
      // These are two DIFFERENT things and must never be conflated.
      //
      // (1) non-relay is a HOUSING property: the DNR/DNRW has no addressable
      //     relay of its own, so it cannot switch anything locally. It says
      //     nothing about how the FACP annunciates the alarm.
      //
      // (2) supervisory classification is a SYSTEM PROGRAMMING decision made at
      //     the control unit, by cause-and-effect configuration. The Al Mousa
      //     specification requires it explicitly: "duct detector activation must
      //     trigger only a supervisory alarm and not initiate evacuation unless
      //     a confirmed fire is detected."
      //
      // The panel that discharges that obligation is the N16e, which is
      // programmable for exactly this. The obligation is therefore recorded on
      // the PANEL, not asserted here as a property of the detector.
      attr("housing_relay_type", "Non-relay", DOC.ductHousing, "Product Line Information -- the DNR/DNRW is an 'intelligent non-relay' housing, so it has no addressable relay of its own"),
      attr("non_relay_implies_supervisory", "NO -- a non-relay housing means the device cannot switch a local relay; it does NOT determine whether the FACP annunciates the alarm or a supervisory signal. That is a programmable cause-and-effect decision, discharged by the N16 control unit. See the N16 panel's duct_supervisory_requirement.", DOC.ductHousing, "Product Line Information -- 'non-relay' describes the housing's lack of an addressable relay output only"),
      attr("velocity_range", "0-4000 ft/min (0-1219 m/min), suitable for installation in ducts", DOC.smoke, "SPECIFICATIONS -- UL/ULC Listed Velocity Range: 0-4000 ft/min (1219.2 m/min), suitable for installation in ducts"),
      attr("operating_temperature_in_housing", "-4F to 158F (-20C to 70C)", DOC.smoke, "SPECIFICATIONS -- FSP-951R Series installed in DNR/DNRW, -4F to 158F"),
      volt("Voltage", "Minimum", 15, DOC.smoke, "SPECIFICATIONS -- Voltage range 15-32 volts DC peak"),
      volt("Voltage", "Maximum", 32, DOC.smoke, "SPECIFICATIONS -- Voltage range 15-32 volts DC peak"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.8 Intelligent Detectors"),
      attr("base_required", "No", DOC.ductHousing, "Product Line Information -- the head mounts directly in the DNR/DNRW housing, not in a separate detector base"),
      // UL 268A is the standard the PROJECT names for duct detectors, verbatim:
      // "UL 268A 4th Edition 2009 -- UL Standard for Safety: Smoke Detectors for
      // Duct Application". It is distinct from UL 268 (general smoke detectors),
      // which governs the FSP-951 ceiling series.
      attr("standard_compliance", "UL 268A", DOC.ductHousing, "Listings and Agency Listings -- the Al Mousa specification names UL 268A 4th Edition 2009, UL Standard for Safety: Smoke Detectors for Duct Application, as the duct detector standard"),
      attr("ul_listing_entity_type", "STANDARD", DOC.ductHousing, "Listings and Agency Listings"),
    ],
  },
  {
    // NON-RELAY. This is the whole point of the housing and the reason the
    // project asks for a "non relay" duct detector.
    partNumber: "DNR",
    family: "Duct Detector Housing",
    description: "Honeywell DNR InnovairFlex intelligent non-relay photoelectric low-flow duct smoke detector housing, indoor. Requires a photoelectric smoke detector (sold separately). MECHANICAL HOUSING -- no SLC address.",
    lifecycle: "CURRENT",
    doc: DOC.ductHousing,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "Honeywell NOTIFIER", DOC.ductHousing, "General"),
      attr("device_role", "SLC_HOUSING", DOC.ductHousing, "Product Line Information -- intelligent NON-RELAY housing"),
      // ZERO, and the reason must be recorded: the housing performs no
      // addressable function. The address belongs to the FSP-951R head.
      attr("address_consumption", 0, DOC.ductHousing, "Product Line Information -- 'Requires photoelectric smoke detector (SOLD SEPARATELY)'; a non-relay housing has no addressable element of its own"),
      attr("address_resource_class", "NONE", DOC.ductHousing, "Product Line Information -- non-relay housing"),
      attr("relay_type", "Non-relay", DOC.ductHousing, "Product Line Information -- 'Intelligent non-relay photoelectric low flow smoke detector housing'"),
      attr("enclosure_rating", "Indoor (non-watertight); use DNRW where NEMA-4 is required", DOC.ductHousing, "Product Line Information -- DNRW is the watertight NEMA-4 variant"),
      attr("required_detector", "FSP-951R-IV", DOC.ductHousing, "Product Line Information -- requires photoelectric smoke detector, sold separately; the remote-test-capable FSP-951R variant is the intended head"),
      attr("base_required", "No", DOC.ductHousing, "General -- the head installs in the housing"),
      attr("velocity_range", "0-4000 ft/min (0-1219 m/min) with the FSP-951R head", DOC.smoke, "SPECIFICATIONS -- UL/ULC Listed Velocity Range 0-4000 ft/min"),
      attr("standard_compliance", "UL 268A", DOC.ductHousing, "Listings and Agency Listings -- duct detector standard per the Al Mousa specification"),
      attr("sampling_tube_required", "Yes -- DST1 or DST1.5 metal sampling tube with P48-21-00 end cap, sized to duct width", DOC.ductHousing, "ACCESSORIES -- DST1 duct width up to 1 ft (0.3m); DST1.5 duct widths up to 1 ft-2 ft (0.3-0.6 m); P48-21-00 end cap for metal sampling tubes"),
    ],
  },
  {
    partNumber: "DNRW",
    family: "Duct Detector Housing",
    description: "Honeywell DNRW watertight intelligent non-relay photoelectric low-flow duct smoke detector housing, NEMA-4 rated, for outdoor/wet exposure. Requires a photoelectric smoke detector (sold separately). MECHANICAL HOUSING -- no SLC address.",
    lifecycle: "CURRENT",
    doc: DOC.ductHousing,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "Honeywell NOTIFIER", DOC.ductHousing, "General"),
      attr("device_role", "SLC_HOUSING", DOC.ductHousing, "Product Line Information -- intelligent NON-RELAY housing"),
      attr("address_consumption", 0, DOC.ductHousing, "Product Line Information -- 'Requires photoelectric smoke detector (SOLD SEPARATELY)'; a non-relay housing has no addressable element of its own"),
      attr("address_resource_class", "NONE", DOC.ductHousing, "Product Line Information -- non-relay housing"),
      attr("relay_type", "Non-relay", DOC.ductHousing, "Product Line Information -- 'Watertight intelligent non-relay photoelectric low flow duct smoke detector housing'"),
      attr("enclosure_rating", "NEMA-4 watertight, UV resistant", DOC.ductHousing, "General -- NEMA-4 rating, watertight and UV resistant for extreme environments"),
      attr("required_detector", "FSP-951R-IV", DOC.ductHousing, "Product Line Information -- requires photoelectric smoke detector, sold separately"),
      attr("base_required", "No", DOC.ductHousing, "General -- the head installs in the housing"),
      // Recorded so nobody later mistakes the housing for a second SLC point.
      attr("optional_addon_module", "The housing CAN accommodate a relay or control module (sold separately) -- this is an ADD-ON, not part of the duct detector quantity", DOC.ductManual, "11.2 ADDITIONAL MODULE OPTION -- 'The DNRW can also accommodate a relay or control module (sold separately) within the power board side of the housing'"),
      attr("standard_compliance", "UL 268A", DOC.ductHousing, "Listings and Agency Listings -- duct detector standard per the Al Mousa specification"),
      attr("sampling_tube_required", "Yes -- DST1 or DST1.5 metal sampling tube with P48-21-00 end cap, sized to duct width", DOC.ductHousing, "ACCESSORIES -- DST1 duct width up to 1 ft (0.3m); DST1.5 duct widths up to 1 ft-2 ft (0.3-0.6 m); P48-21-00 end cap for metal sampling tubes"),
    ],
  },
  {
    partNumber: "DST1",
    family: "Sampling Tube",
    description: "Honeywell DST1 metal sampling tube for duct detectors, for duct widths up to 1 ft (0.3 m). Mechanical -- no SLC address.",
    lifecycle: "CURRENT",
    doc: DOC.ductHousing,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "Honeywell NOTIFIER", DOC.ductHousing, "ACCESSORIES"),
      attr("device_role", "MECHANICAL_ACCESSORY", DOC.ductHousing, "ACCESSORIES"),
      attr("address_consumption", 0, DOC.ductHousing, "ACCESSORIES -- a sampling tube is passive ductwork, it cannot occupy an SLC address"),
      attr("address_resource_class", "NONE", DOC.ductHousing, "ACCESSORIES"),
      attr("duct_width_range", "up to 1 ft (0.3 m)", DOC.ductHousing, "ACCESSORIES -- DST1: metal sampling tube duct width up to 1 ft (0.3m)"),
    ],
  },
  {
    partNumber: "DST1.5",
    family: "Sampling Tube",
    description: "Honeywell DST1.5 metal sampling tube for duct detectors, for duct widths 1 ft to 2 ft (0.3 m to 0.6 m). Mechanical -- no SLC address.",
    lifecycle: "CURRENT",
    doc: DOC.ductHousing,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "Honeywell NOTIFIER", DOC.ductHousing, "ACCESSORIES"),
      attr("device_role", "MECHANICAL_ACCESSORY", DOC.ductHousing, "ACCESSORIES"),
      attr("address_consumption", 0, DOC.ductHousing, "ACCESSORIES -- a sampling tube is passive ductwork, it cannot occupy an SLC address"),
      attr("address_resource_class", "NONE", DOC.ductHousing, "ACCESSORIES"),
      attr("duct_width_range", "1 ft to 2 ft (0.3 m to 0.6 m)", DOC.ductHousing, "ACCESSORIES -- DST1.5: metal sampling tube duct widths up to 1 ft - 2 ft (0.3 - 0.6 m)"),
    ],
  },
  {
    partNumber: "RTS151",
    family: "Remote Test Station",
    description: "Honeywell RTS151 remote test station for duct smoke detectors, used with a remote-test-capable head such as the FSP-951R. Wired to the DNR/DNRW RA+/OUT+ terminals -- NOT to the SLC, so it consumes no SLC address.",
    lifecycle: "CURRENT",
    doc: DOC.ductHousing,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "Honeywell NOTIFIER", DOC.ductHousing, "ACCESSORIES"),
      attr("device_role", "MECHANICAL_ACCESSORY", DOC.ductManual, "11.1 REMOTE TEST USING SENSOR WITH REMOTE TEST CAPABILITY -- the RTS151/RTS151KEY wire to the sensor RA+/RTS+/OUT+ terminals, not to the SLC"),
      // Provenance matters here: the remote test station looks SLC-like because
      // it is a two-wire field device, but it terminates at the duct housing, not
      // on the signaling line circuit.
      attr("address_consumption", 0, DOC.ductManual, "11.1 -- wired to the DNRW sensor remote-test terminals (RA+, RA-, RTS+, RTS-), not to the SLC"),
      attr("address_resource_class", "NONE", DOC.ductManual, "11.1 -- connected to the duct detector housing, not the SLC"),
      attr("requires_remote_test_capable_detector", "Yes", DOC.ductManual, "11.1 -- RTS151/RTS151KEY using sensor with remote test capability"),
    ],
  },

  // ---- NOTIFICATION APPLIANCES --------------------------------------------
  // ARCHITECTURE DECISION 2026-09-30, taken on project evidence.
  //
  // The BOQ and the drawing legend both label these lines "LOOP POWERED
  // STROBE(S)". Read alone that wording suggests an addressable SLC device. It
  // CANNOT be the specified product, on two independent grounds:
  //
  //   (a) CANDELA. The Al Mousa specification requires "field selectable
  //       candela options of 15 30 60 75 and 110" cd. The only Honeywell /
  //       NOTIFIER addressable loop-powered AV range is the FS-AV family
  //       (FS-WSO / FS-BSO / FS-WST / FS-WSS / FS-BSS), whose datasheet states
  //       "STROBE FLASH INTENSITY N/A >1cd". A >1 cd device cannot satisfy a
  //       mandatory 15-110 cd requirement. That range is therefore NOT MATCHED,
  //       and is recorded below as evaluated-and-rejected so the decision stays
  //       re-testable rather than merely asserted.
  //
  //   (b) WEATHERPROOF. 100 of the units are weatherproof exterior appliances
  //       and the specification requires exterior horns to deliver "a minimum
  //       sound level of 85 dBA measured 10 feet from the source on axis". The
  //       FS-AV range has no outdoor variant.
  //
  // Every other project signal agrees: a Class A NAC topology ("notification
  // appliance circuits (NACs) must be configured so that no single fault or cut
  // causes failure across multiple zones"), four Class A/B NAC outputs on the
  // N16 power supply at 2.5 A each, a drawn "NAC LOOP" at every panel, and a
  // mandatory synchronisation requirement. That is the CONVENTIONAL NAC
  // architecture.
  //
  // The specified class is therefore System Sensor SpectrAlert Advance, the
  // conventional NAC appliance range Honeywell supplies and that the N16
  // Class A/B outputs drive directly. The "loop powered" BOQ/legend wording is
  // treated as a legacy line label, NOT as a topology claim, and the conflict
  // is recorded rather than silently reconciled.
  {
    partNumber: "SD",
    family: "Strobe",
    description: "System Sensor SpectrAlert Advance indoor strobe, conventional NAC notification appliance, 24 V, field-selectable candela 15/15-75/30/75/95/110/115/135/150/177/185 cd, driven from the N16 Class A/B NAC output. Selected for the 324 'Loop powered strobes' line once the loop-powered label is set aside.",
    lifecycle: "CURRENT",
    doc: DOC.av,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "System Sensor (Honeywell)", DOC.av, "General -- System Sensor SpectrAlert Advance selectable-output notification appliances"),
      attr("device_role", "NAC_NOTIFICATION_APPLIANCE", DOC.av, "General -- wired as a primary-signaling notification appliance on a NAC"),
      attr("topology", "CONVENTIONAL_NAC", DOC.av, "General -- the notification appliance circuit wiring shall terminate at the universal mounting plate; the device is driven by the NAC output, not the SLC"),
      attr("addressing", "Non-addressable", DOC.av, "General -- a conventional NAC appliance is not an SLC device; it is supervised by the NAC, not by device addressing"),
      attr("address_consumption", 0, DOC.av, "General -- consumes no SLC address, and that is a consequence of being a NAC device, not an unexplained exception"),
      attr("address_resource_class", "NONE", DOC.av, "General -- not a signaling line circuit device"),
      attr("supply_voltage", "24 VDC nominal (also 12 V); automatic selection at 15 and 15/75 cd", DOC.av, "General -- 'Automatic selection of 12 or 24 volt operation at 15 and 15/75 candela'"),
      attr("candela_settings_cd", "15, 15/75, 30, 75, 95, 110, 115, 135, 150, 177, 185", DOC.av, "General -- 'eleven field-selectable candela settings for wall and ceiling strobes and horn/strobes' by rear-mounted slide switch"),
      attr("listing", "UL 1971 and CAN/ULC S526; approved for fire protective service", DOC.av, "Architect/Engineer Specification -- 'The strobe shall be a System Sensor SpectrAlert Advance Model _______ listed to UL 1971'"),
      attr("flash_rate", "1 Hz over the entire operating voltage range", DOC.av, "Architect/Engineer Specification -- 'flashing at 1Hz over the strobe's entire operating voltage range'"),
      attr("ada_compliant", "Yes", DOC.av, "Architect/Engineer Specification -- comply with ADA requirements for visible signaling appliances"),
      attr("mounting", "Standard 4x4x1.5 in back box, 4 in octagon, or double-gang; universal mounting plate for wall and ceiling", DOC.av, "Engineering Specifications"),
      attr("synchronization", "Compatible with the System Sensor synchronization protocol; MDL3 Sync-Circuit module where used", DOC.av, "Architect/Engineer Specification -- 'the strobe and the Sync-Circuit Module MDL3 accessory, if used, shall be powered from a non-coded notification appliance circuit output'"),
      attr("tolerated_synccircuit_input", "24 V rated NAC outputs shall operate between 16.5 and 33 volts", DOC.av, "Architect/Engineer Specification"),
      attr("tamper_resistance", "Shorting spring on the mounting plate opens the circuit if the device is removed", DOC.av, "Architect/Engineer Specification"),
      attr("current_draw_24v_ma_rms", "15cd=66, 15/75cd=77, 30cd=94, 75cd=158, 95cd=181, 110cd=202, 115cd=205, 135cd=207, 150cd=220, 177cd=251, 185cd=258", DOC.av, "UL Max. Strobe Current Draw (mA RMS) -- 16-33 Volts DC FWR"),
      attr("worst_case_current_ma", 258, DOC.av, "UL Max. Strobe Current Draw (mA RMS) -- 185 cd at 16-33 Volts is the highest published figure"),
      attr("weatherproof", "No -- indoor unit; outdoor duty requires the K-suffix NEMA 4X version", DOC.av, "General -- outdoor products carry the K suffix and are listed to UL 1638"),
      // ---- IDENTITY GOVERNANCE: this is a FAMILY, not an orderable P/N -----
      // CORRECTION 2026-09-30. "SD" is a FAMILY ALIAS used in the engineering
      // narrative. It is NOT a System Sensor orderable part number and must
      // never be sent to the Price Library as one. The orderable SpectrAlert
      // Advance models are distinguished by strobe vs horn/strobe, indoor vs
      // outdoor, standard vs high candela, wall vs ceiling, colour, and 2-wire
      // vs 4-wire. The project evidence does not fix all of those, so the
      // exact commercial P/N is PENDING while the family stays matched.
      attr("is_manufacturable_part_number", "NO -- FAMILY ALIAS ONLY. 'SD' is descriptive shorthand, not a manufacturer orderable code.", DOC.av, "General -- orderable SpectrAlert Advance models are SR / SRH / SRK / SRHK and their white, ceiling and P2Rv2 / L-Series variants"),
      attr("commercial_part_number_status", "PENDING_TECHNICAL_SELECTION", DOC.av, "General -- wall vs ceiling, colour (red/white) and the exact candela variant are not fixed by the project evidence"),
      attr("orderable_candidates", "Indoor strobe: SR (standard candela, red), SRH (high candela, red), SRK (outdoor NEMA 4X, red, standard), SRHK (outdoor, high candela), plus white equivalents (SW / SWH / SWK / SWHK) and the P2Rv2 and L-Series successors. Selection depends on wall vs ceiling, colour, 2-wire vs 4-wire, and the required candela range.", DOC.av, "General -- SpectrAlert Advance selectable-output strobes"),
      attr("n16_compatibility_evidence", "Driven from the N16 Class A/B NAC output. The N16 NACs 'support selectable System Sensor, Wheelock, and Gentex strobe synchronization', so System Sensor appliances are an explicitly supported NAC load.", DOC.panel, "FEATURES -- NACs support selectable System Sensor, Wheelock, and Gentex strobe synchronization"),
    ],
  },
  {
    partNumber: "SHD",
    family: "Speaker/Strobe",
    description: "System Sensor SpectrAlert Advance indoor horn/strobe (audible sounder with strobe), conventional NAC notification appliance, 24 V, field-selectable candela and horn tone/volume. Selected for the 14 'Loop powered strobes with sounder' line.",
    lifecycle: "CURRENT",
    doc: DOC.av,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "System Sensor (Honeywell)", DOC.av, "General -- System Sensor SpectrAlert Advance selectable-output notification appliances"),
      attr("device_role", "NAC_NOTIFICATION_APPLIANCE", DOC.av, "General -- wired as a primary-signaling notification appliance on a NAC"),
      attr("topology", "CONVENTIONAL_NAC", DOC.av, "General -- the notification appliance circuit wiring shall terminate at the universal mounting plate"),
      attr("addressing", "Non-addressable", DOC.av, "General -- conventional NAC appliance"),
      attr("address_consumption", 0, DOC.av, "General -- consumes no SLC address"),
      attr("address_resource_class", "NONE", DOC.av, "General -- not an SLC device"),
      attr("supply_voltage", "24 VDC nominal (also 12 V)", DOC.av, "General -- automatic selection of 12 or 24 volt operation at 15 and 15/75 candela"),
      attr("candela_settings_cd", "15, 15/75, 30, 75, 95, 110, 115, 135, 150, 177, 185", DOC.av, "General -- eleven field-selectable candela settings"),
      attr("horn_sound_output_dba", "88+ dBA at 16 volts outdoor; indoor selectable by rotary switch with three volume selections", DOC.av, "General -- 'Horn rated at 88+ dBA at 16 volts'; 'Rotary switch for horn tone and three volume selections'"),
      attr("tone_selection", "Rotary switch; multiple horn tones, high/medium/low volume", DOC.av, "General -- satisfies the Al Mousa multi-tone and selectable-sound-level requirements"),
      attr("temporal_pattern", "Temporal patterns available, satisfying the project Code 3 requirement", DOC.av, "General -- selectable horn tones and sound patterns"),
      attr("listing", "UL 1971 and UL 464; CAN/ULC S526; approved for fire protective service", DOC.av, "Architect/Engineer Specification -- 'The horn/strobe shall be a System Sensor SpectrAlert Advance Model _______ listed to UL 1971 and UL 464'"),
      attr("synchronization", "Compatible with the System Sensor synchronization protocol; MDL3 Sync-Circuit module where used", DOC.av, "Architect/Engineer Specification"),
      attr("mounting", "Standard 4x4x1.5 in back box, 4 in octagon, or double-gang; wall and ceiling", DOC.av, "Engineering Specifications"),
      attr("current_draw_24v_ma_rms", "15cd=79, 15/75cd=90, 30cd=107, 75cd=176, 95cd=194, 110cd=212, 115cd=218 (two-wire horn/strobe, temporal high, 16-33 V)", DOC.av, "UL Max. Current Draw (mA RMS), 2-Wire Horn Strobe, Standard Candela Range (15-115 cd)"),
      attr("worst_case_current_ma", 218, DOC.av, "UL Max. Current Draw -- 115 cd temporal high at 16-33 Volts"),
      attr("weatherproof", "No -- indoor unit", DOC.av, "General -- outdoor products carry the K suffix"),
      attr("is_manufacturable_part_number", "NO -- FAMILY ALIAS ONLY. 'SHD' is descriptive shorthand, not a manufacturer orderable code.", DOC.av, "General -- orderable horn/strobe models are SHS (indoor, red), SHK / SHHK (outdoor), plus white, ceiling and P2Rv2 / L-Series variants"),
      attr("commercial_part_number_status", "PENDING_TECHNICAL_SELECTION", DOC.av, "General -- wall vs ceiling, colour and the candela variant are not fixed by the project evidence"),
      attr("orderable_candidates", "Indoor horn/strobe: SHS (standard candela, red), with high-candela and white (SHSW) variants; outdoor: SHK / SHHK. Also the P2Rv2 and L-Series successors. Selection depends on wall vs ceiling, colour, 2-wire vs 4-wire, and the required candela range.", DOC.av, "General -- SpectrAlert Advance selectable-output horn/strobes"),
      attr("n16_compatibility_evidence", "Driven from the N16 Class A/B NAC output, with System Sensor synchronisation explicitly supported.", DOC.panel, "FEATURES -- NACs support selectable System Sensor, Wheelock, and Gentex strobe synchronization"),
    ],
  },
  {
    partNumber: "SHDK",
    family: "Speaker/Strobe",
    description: "System Sensor SpectrAlert Advance OUTDOOR horn/strobe, conventional NAC notification appliance, NEMA 4X / IP56 weatherproof, -40F to 151F, listed UL 1638 (strobe) and UL 464 (horn). Selected for the 100 'Loop powered strobes with sounder (weatherproof)' line.",
    lifecycle: "CURRENT",
    doc: DOC.avOutdoor,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "System Sensor (Honeywell)", DOC.avOutdoor, "General -- SpectrAlert Advance outdoor horns, strobes and horn strobes"),
      attr("device_role", "NAC_NOTIFICATION_APPLIANCE", DOC.avOutdoor, "General -- wired to the universal mounting plate on a weatherproof back box"),
      attr("topology", "CONVENTIONAL_NAC", DOC.avOutdoor, "General -- the notification appliance circuit wiring shall terminate at the universal mounting plate"),
      attr("addressing", "Non-addressable", DOC.avOutdoor, "General -- conventional NAC appliance"),
      attr("address_consumption", 0, DOC.avOutdoor, "General -- consumes no SLC address"),
      attr("address_resource_class", "NONE", DOC.avOutdoor, "General -- not an SLC device"),
      attr("weatherproof", "Yes -- NEMA 4X, IP56; rated -40F to 151F", DOC.avOutdoor, "Features -- 'Weatherproof per NEMA 4X, IP56'; 'Rated from -40F to 151F'"),
      attr("listing", "UL 1638 (strobe) and UL 464 (horn); approved for fire protective service", DOC.avOutdoor, "Features -- 'Listed to UL 1638 (strobe) and UL 464 (horn)'"),
      attr("candela_settings_cd", "15, 15/75, 30, 75, 95, 110, 115, 135, 150, 177, 185", DOC.avOutdoor, "Features -- field-selectable candela settings"),
      attr("horn_sound_output_dba", "88+ dBA at 16 volts, exceeding the project minimum of 85 dBA at 10 ft for exterior horns", DOC.avOutdoor, "Features -- 'Horn rated at 88+ dBA at 16 volts'"),
      attr("tone_selection", "Rotary switch for horn tone and three volume selections", DOC.avOutdoor, "Features"),
      attr("supply_voltage", "24 VDC nominal; automatic selection of 12 or 24 V at 15 and 15/75 cd", DOC.avOutdoor, "Features"),
      attr("synchronization", "Compatible with System Sensor synchronization protocol and legacy SpectrAlert products", DOC.avOutdoor, "Features"),
      attr("mounting", "Weatherproof back box; universal mounting plate for ceiling and wall", DOC.avOutdoor, "General -- 'shall mount to a weatherproof back box'"),
      attr("current_draw_24v_ma_rms", "Two-wire horn/strobe, temporal high, 16-33 V: 15cd=79, 15/75cd=90, 30cd=107, 75cd=176, 95cd=194, 110cd=212, 115cd=218", DOC.avOutdoor, "UL Max. Current Draw (mA RMS), 2-Wire Horn Strobe, Standard Candela Range"),
      attr("worst_case_current_ma", 218, DOC.avOutdoor, "UL Max. Current Draw -- 115 cd temporal high at 16-33 Volts"),
      attr("is_manufacturable_part_number", "NO -- FAMILY ALIAS ONLY. 'SHDK' is descriptive shorthand, not a manufacturer orderable code.", DOC.avOutdoor, "General -- the K suffix denoting outdoor is part of the ORDERABLE code, e.g. SRK / SRHK / SHK, not an appended alias"),
      attr("commercial_part_number_status", "PENDING_TECHNICAL_SELECTION", DOC.avOutdoor, "General -- the outdoor horn/strobe family is technically matched, but the exact orderable code depends on colour and candela variant"),
      attr("orderable_candidates", "Outdoor horn/strobe: SHK (standard candela, red), SHHK (high candela); outdoor strobe SRK / SRHK; white equivalents SWHK / SWK / SHWK as applicable; plus P2Rv2 and L-Series successors. Selection depends on colour and the required candela range.", DOC.avOutdoor, "General -- SpectrAlert Advance outdoor products, K suffix = UL 1638, NEMA 4X"),
      attr("n16_compatibility_evidence", "Driven from the N16 Class A/B NAC output, with System Sensor synchronisation explicitly supported.", DOC.panel, "FEATURES -- NACs support selectable System Sensor, Wheelock, and Gentex strobe synchronization"),
    ],
  },
  {
    // EVALUATED AND REJECTED. Recorded so the decision is re-testable rather
    // than merely asserted, in the same way the Self-Test family was retained.
    partNumber: "FS-WSS",
    family: "Speaker/Strobe",
    description: "NOTIFIER FS-WSS addressable FlashScan loop-powered wall mount sounder and strobe. EVALUATED AND REJECTED for this project: strobe output is '>1 cd' against a mandatory field-selectable 15-110 cd requirement, and no outdoor/weatherproof variant exists for the 100 exterior units.",
    lifecycle: "CURRENT",
    doc: DOC.avLoop,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.avLoop, "General -- Notifier range of intelligent, FlashScan, loop powered, AV devices"),
      attr("protocol", "FlashScan", DOC.avLoop, "Features -- 'Flashscan protocol'"),
      attr("addressing", "Addressable", DOC.avLoop, "Features -- 'Up to 159 addresses are available via two rotary selector switches'"),
      attr("device_role", "SLC_FIELD_DEVICE", DOC.avLoop, "Features -- 'These devices receive their power from the loop, and can be controlled via the Notifier communication protocol'"),
      // It IS an addressable SLC device -- which is exactly why it cannot be the
      // answer here. Choosing it would put 438 points back into the SLC census
      // and invalidate the drawn loop topology.
      attr("address_consumption", 1, DOC.avLoop, "Features -- 'Up to 159 addresses are available via two rotary selector switches'"),
      attr("address_resource_class", "DETECTOR_OR_MODULE", DOC.avLoop, "Features -- a FlashScan SLC device addressed by rotary switch"),
      attr("topology", "ADDRESSABLE_LOOP_POWERED", DOC.avLoop, "Features -- 'Powered from SLC'; 'These devices receive their power from the loop'"),
      attr("supply_voltage", "DC24V (15V-32V)", DOC.avLoop, "Electrical Specifications -- 'SUPPLY VOLTAGE: (NON-ISOLATION) DC24V (DC15V ~ DC32V)'"),
      attr("quiescent_current_ma", 0.4, DOC.avLoop, "Electrical Specifications -- 'QUIESCENT CURRENT <400uA'"),
      attr("alarm_current_ma", 11, DOC.avLoop, "Electrical Specifications -- '<11mA High volume, 24VDC' for sounder plus strobe at the highest setting"),
      attr("strobe_flash_intensity_cd", ">1 cd", DOC.avLoop, "Electrical Specifications -- 'STROBE FLASH INTENSITY N/A >1cd'"),
      attr("max_quantity_per_loop", "66 high volume / 100 low volume", DOC.avLoop, "Electrical Specifications -- 'MAXIMUM QUANTITY PER LOOP 66 high volume / 100 low volume'"),
      attr("sound_output_dba", "90-95 dBA range depending on tone and volume selection", DOC.avLoop, "Electrical Specifications"),
      attr("synchronization", "Synchronisation of sounder/strobe", DOC.avLoop, "Features -- 'Synchronisation of sounder/strobe'"),
      attr("base_required", "B501AUS / B501AUS-IV universal addressable detector base", DOC.avLoop, "General -- 'Notifier's intelligent AV devices fit into the B501AUS base'"),
      // THE DISQUALIFIER, as a first-class governed fact.
      attr("project_fit_verdict", "REJECTED_FOR_AL_MOUSA -- the strobe is rated '>1cd' while the Al Mousa specification mandates field-selectable 15/30/60/75/110 cd. The FS-AV range also has no outdoor/weatherproof variant for the 100 exterior units. It is therefore NOT matched and NOT entered into the SLC census.", DOC.avLoop, "Electrical Specifications -- 'STROBE FLASH INTENSITY N/A >1cd'"),
    ],
  },

  // ---- FIREFIGHTER TELEPHONE ----------------------------------------------
  // The Al Mousa specification requires:
  //   Mandatory: "the fire fighter's telephone system must be INTEGRATED WITH
  //              THE FIRE ALARM SYSTEM and made by the same manufacturer"
  //   Mandatory: the plate "must clearly display the marking fire fighters
  //              telephone and fit ANY STANDARD SINGLE GANG box"
  //   Preferred: "connections to remote phones should be provided through
  //              ADDRESSABLE MODULES and bussed audio lines or hardwired
  //              connections"
  //   Preferred: "the telephone system should be distributed across the fire
  //              alarm network with each section connected to network control
  //              panels"
  // Together these establish a FACP-INTEGRATED, module-based firefighter
  // telephone architecture on bussed Style Y/Z telephone circuits -- which is
  // the FTM-1 topology -- and NOT a standalone phone system with its own SLC.
  // The JACK itself is a passive single-gang field device and is NOT an SLC point.
  {
    partNumber: "N-FPJ",
    family: "Fireman Telephone Jack",
    description: "Notifier N-FPJ Remote Phone Jack for the firefighter telephone system. Mounts to a standard single-gang electrical box and provides a plug-in location for the FHS-F handset. PASSIVE -- it occupies NO SLC address.",
    lifecycle: "CURRENT",
    doc: DOC.fft,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.fft, "General"),
      attr("device_role", "TELEPHONE_CIRCUIT_DEVICE", DOC.fft, "General -- N-FPJ is a Remote Phone Jack that provides a plug-in location for the FHS-F handset"),
      // ZERO SLC addresses. The jack is a passive termination on the bussed
      // telephone circuit. Annunciation and supervision come from the SEPARATE
      // addressable Firephone Control Module on the same telephone circuit.
      attr("address_consumption", 0, DOC.fft, "General -- N-FPJ is a phone jack on the firefighter telephone circuit, not an SLC device"),
      attr("address_resource_class", "NONE", DOC.fft, "General -- a passive remote phone jack is not a signaling line circuit point"),
      attr("passive", "Yes", DOC.fft, "General -- the jack provides a plug-in location only; it performs no addressable function"),
      attr("mounting", "Standard single-gang electrical box", DOC.fft, "General -- Remote Phone Jack which mounts to a single-gang electrical box"),
      attr("handset_compatible", "FHS-F", DOC.fft, "General -- provides a plug-in location for the FHS-F fire fighter handset"),
      attr("circuit_type", "Firefighter telephone circuit (NFPA Style Y or Style Z when supervised by an FTM-1)", DOC.ftm, "Features and Benefits -- FTM-1 supports either NFPA Style Y or Style Z fault tolerant telephone circuits"),
      // Explicit anti-inference. The FTM-1 quantity follows the telephone
      // CIRCUIT count. It is NOT derivable from the jack count.
      //
      // CORRECTION 2026-09-30: an earlier pass asserted a "lower bound" of
      // CEILING(73 jacks / 2 phones per circuit) = 37 modules. That was
      // withdrawn as unsound. The manufacturer wording is that an FTM-1
      // "monitors and controls a circuit of up to two firefighter phones" --
      // two phones is the CAPACITY of a circuit, not the number of jacks on it.
      // A jack is a passive connection point; any number of jacks may sit on
      // one supervised circuit, and a single connected handset is not a
      // simultaneously-connected pair. Deriving a module count from jack count
      // therefore manufactures a topology the project never specified.
      //
      // The Al Mousa drawings were searched for telephone circuit designators
      // and circuit schedules; none exist. The only telephone cable note is
      // "1 PAIR TELEPHONE CABLE FOR EACH FIREMAN TELEPHONE JACK", which
      // describes the drop to each jack and implies nothing about circuit
      // grouping. The quantity is therefore PENDING.
      attr("addressable_interface", "FTM-1", DOC.ftm, "Overview -- the FTM-1 is the addressable firephone control module for firefighter telephone circuits"),
      attr("ftm1_quantity_basis", "TELEPHONE_CIRCUIT_COUNT", DOC.ftm, "Overview -- the FTM-1 serves a telephone circuit, so its quantity follows the number of supervised telephone circuits, not the number of jacks"),
      attr("ftm1_quantity_status", "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY", DOC.ftm, "Overview -- the Al Mousa drawings contain no telephone circuit designators, circuit schedule, or module-to-circuit assignment, so the circuit count is not established and the quantity cannot be computed"),
      attr("jack_count_is_not_circuit_count", "Yes", DOC.fft, "General -- the N-FPJ 'provides a plug-in location for the FHS-F'; any number of jacks may share one supervised telephone circuit, so jack quantity does not determine circuit or module quantity"),
      attr("standard_compliance", "UL 864", DOC.fft, "Governing standard -- the firefighter telephone system is part of the fire alarm control unit standard; the Al Mousa specification requires 'compliance [to] ANSI UL 864'"),
    ],
  },
  {
    partNumber: "FTM-1",
    family: "Firephone Control Module",
    description: "Notifier FTM-1 addressable firephone control module, FlashScan mode. Monitors and controls a firefighter telephone circuit of up to two phones. ONE SLC module address per module; the module count follows the telephone circuit count, not the jack count.",
    lifecycle: "CURRENT",
    doc: DOC.ftm,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.ftm, "Overview"),
      attr("protocol", "FlashScan", DOC.ftm, "Overview -- FTM-1(A) fire phone control modules with FlashScan mode only"),
      attr("addressing", "Addressable", DOC.ftm, "Features and Benefits -- 'Direct-dial entry of FlashScan address from 1 to 159'"),
      attr("address_type", "Addressable", DOC.ftm, "Features and Benefits -- direct-dial FlashScan address 1 to 159"),
      attr("device_role", "SLC_MODULE", DOC.ftm, "Features and Benefits -- 'Internal circuitry and relay powered directly by 2-wire SLC loop'; an addressable module"),
      attr("address_consumption", 1, DOC.ftm, "Features and Benefits -- one direct-dial FlashScan address per module"),
      attr("address_resource_class", "MODULE", DOC.ftm, "Features and Benefits -- the module is addressed on the SLC module address space"),
      attr("function", "Firephone control module", DOC.ftm, "Overview -- connects firefighter telephones to the fire alarm control panel telephone circuit"),
      attr("phones_per_circuit", 2, DOC.ftm, "Overview -- 'monitor and control a circuit with up to two firefighter phones'"),
      // The "two phones" figure is the CAPACITY of one circuit, not the number
      // of jacks on it, and it is therefore not a conversion factor for the
      // jack count. CORRECTION 2026-09-30: an earlier pass derived
      // CEILING(73/2) = 37 FTM-1 modules from it. That was unsound and has been
      // withdrawn. The quantity follows the telephone circuit count, which the
      // Al Mousa drawings do not establish.
      attr("ftm1_quantity_basis", "TELEPHONE_CIRCUIT_COUNT", DOC.ftm, "Overview -- the FTM-1 serves a telephone circuit, so its quantity follows the number of supervised telephone circuits"),
      attr("ftm1_quantity_status", "PENDING_TELEPHONE_CIRCUIT_TOPOLOGY", DOC.ftm, "Overview -- no telephone circuit designators, circuit schedule or module-to-circuit assignment exist in the Al Mousa drawings; the only telephone note is '1 PAIR TELEPHONE CABLE FOR EACH FIREMAN TELEPHONE JACK', which describes the drop to each jack and implies nothing about circuit grouping"),
      attr("jack_count_is_not_circuit_count", "Yes", DOC.ftm, "Overview -- any number of N-FPJ jacks may share one supervised telephone circuit, so jack quantity does not determine circuit or module quantity"),
      attr("circuit_type", "NFPA Style Y or Style Z (fault tolerant)", DOC.ftm, "Features and Benefits -- 'Supports either NFPA Style Y or Style Z (fault tolerant) telephone circuits'"),
      attr("flashscan_address_max", 159, DOC.ftm, "Features and Benefits -- direct-dial entry of FlashScan address from 1 to 159"),
      volt("Voltage", "Minimum", 15, DOC.ftm, "Specifications -- Voltage: 15 to 32 V"),
      volt("Voltage", "Maximum", 32, DOC.ftm, "Specifications -- Voltage: 15 to 32 V"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6 SLC Devices -- the FTM-1 is an SLC module on the FACP loop"),
      // S635 is a LISTING identifier, kept out of `standards` for the same
      // reason S2101/S747 are.
      attr("ul_listing_file", "S635", DOC.ftm, "Certifications -- 'UL Listed: S635'"),
      attr("ul_listing_entity_type", "LISTING_FILE_IDENTIFIER_NOT_A_STANDARD", DOC.ftm, "Certifications"),
      attr("standard_compliance", "UL 864", DOC.fft, "Governing standard -- the firefighter telephone system is part of the fire alarm control unit standard; the Al Mousa specification requires 'compliance [to] ANSI UL 864'"),
    ],
  },

  // ---- SELF-TEST (comparison candidates; NOT auto-preferred) ---------------
  ...["FSP-951-SELFT", "FSP-951T-SELFT", "FST-951-SELFT"].map((pn) => ({
    partNumber: pn,
    family: pn.startsWith("FST") ? "Addressable Heat Detector" : "Addressable Smoke Detector",
    description: `Notifier ${pn} intelligent addressable self-test detector. FlashScan protocol only, N16 only, UL applications only.`,
    lifecycle: "CURRENT",
    doc: DOC.selft,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.selft, "General"),
      attr("protocol", "FlashScan", DOC.selft, "Product Line Information -- FlashScan only"),
      attr("clip_protocol_support", "No", DOC.selft, "Product Line Information -- FlashScan only"),
      attr("self_test_capability", "Yes", DOC.selft, "Self-Test Operation"),
      attr("addressing", "Addressable", DOC.selft, "General"),
      attr("address_type", "Addressable", DOC.selft, "General"),
      attr("device_role", "SLC_FIELD_DEVICE", DOC.selft, "General"),
      attr("address_consumption", 1, DOC.selft, "Point ID capability"),
      attr("panel_restriction", "N16 only", DOC.selft, "Product Line Information -- N16 only, UL applications only"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.selft, "Product Line Information"),
      attr("base_required", "Yes", DOC.selft, "Intelligent Bases"),
      ...(pn === "FST-951-SELFT"
        ? [
            attr("detection_principle", "Programmable Thermal", DOC.selft, "General"),
            attr("fixed_temperature_setpoint", "Programmable 135°F / 190°F", DOC.selft, "General -- programmable as either a 135F fixed temperature sensor, a rate of rise and 135F fixed temperature sensor or a 190F high temperature sensor through the FACP"),
            attr("rate_of_rise_sensitivity", "15°F/min", DOC.selft, "Thermal ratings -- rate-of-rise detection 15F (8.3C) per minute"),
            attr("standard_compliance", "UL 521 7th Edition", DOC.selft, "UL Listed Velocity Range"),
          ]
        : [
            attr("detection_principle", "Photoelectric", DOC.selft, "General"),
            ...(pn === "FSP-951T-SELFT" ? [attr("fixed_temperature_setpoint", "135°F", DOC.selft, "General -- dual electronic thermistors add 135F fixed temperature thermal sensing")] : []),
            attr("standard_compliance", "UL 268 7th Edition", DOC.selft, "General"),
          ]),
    ],
  })),

  // ---- MODULES ------------------------------------------------------------
  {
    partNumber: "FMM-1",
    family: "Monitor Module",
    description: "Notifier FMM-1 intelligent addressable monitor module, supervises a two-wire or four-wire fault-tolerant Initiating Device Circuit of dry-contact devices",
    lifecycle: "CURRENT",
    doc: DOC.mods,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.mods, "FMM-1 Monitor Module"),
      attr("protocol", "FlashScan", DOC.mods, "FMM-1 Monitor Module"),
      attr("clip_protocol_support", "Yes", DOC.mods, "FMM-1 Monitor Module -- FlashScan and CLIP"),
      attr("module_type", "Monitor Module", DOC.mods, "FMM-1 Monitor Module"),
      attr("device_role", "SLC_MODULE", DOC.mods, "FMM-1 Monitor Module"),
      attr("addressing", "Addressable", DOC.mods, "FMM-1 Monitor Module"),
      attr("address_type", "Addressable", DOC.mods, "FMM-1 Monitor Module"),
      attr("address_consumption", 1, DOC.mods, "FMM-1 Monitor Module -- each FMM-1 uses one of the available module addresses"),
      attr("flashscan_address_max", 159, DOC.mods, "FMM-1 Monitor Module -- 01-159 on FlashScan loops"),
      attr("clip_address_max", 99, DOC.mods, "FMM-1 Monitor Module -- 01-99 on CLIP loops"),
      attr("monitored_circuits", 1, DOC.mods, "FMM-1 Monitor Module"),
      attr("supervised_input_capability", "Style B (Class B) and Style D (Class A) IDC", DOC.mods, "FMM-1 Monitor Module"),
      volt("Voltage", "Minimum", 15, DOC.mods, "FMM-1 Monitor Module"),
      volt("Voltage", "Maximum", 32, DOC.mods, "FMM-1 Monitor Module"),
      attr("mounting_requirement", "4 inch square x 2-1/8 inch deep box, or SMB500 surface mount box", DOC.mods, "FMM-1 and FZM-1 modules mount directly to a standard 4 inch square box"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.1 Monitor/Zone Interface Module"),
      attr("standard_compliance", "UL 864 10th Edition", DOC.slcm, "1.2 UL 864 Compliance"),
    ],
  },
  {
    partNumber: "FCM-1",
    family: "Control Module",
    description: "Notifier FCM-1 intelligent addressable control module, provides a supervised Notification Appliance Circuit for horns, strobes, speakers",
    lifecycle: "CURRENT",
    doc: DOC.mods,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("protocol", "FlashScan", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("clip_protocol_support", "Yes", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("module_type", "Control Module", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("device_role", "SLC_MODULE", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("addressing", "Addressable", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("address_consumption", 1, DOC.mods, "Each FCM-1 uses one of 159 possible module addresses"),
      attr("flashscan_address_max", 159, DOC.mods, "Direct-dial entry of address 01-159 for FlashScan loops"),
      attr("clip_address_max", 99, DOC.mods, "01-99 for CLIP mode loops"),
      attr("nac_class_b_max_current_a", 3, DOC.mods, "Max NAC Current Ratings: for class B wiring system, the current rating is 3A"),
      attr("nac_class_a_max_current_a", 2, DOC.mods, "for class A wiring system the current rating is 2A"),
      attr("external_power_required", "Yes", DOC.mods, "FCM-1 is used to switch 24 VDC audible/visual power, high-level audio"),
      attr("mounting_requirement", "4 inch square x 2-1/8 inch deep box, or SMB500; CB500 barrier where power-limited and non-power-limited wiring share a box", DOC.mods, "FCM-1 and FRM-1 Construction"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.2 Control Modules"),
      attr("standard_compliance", "UL 864 10th Edition", DOC.slcm, "1.2 UL 864 Compliance"),
    ],
  },
  {
    partNumber: "FRM-1",
    family: "Relay Module",
    description: "Notifier FRM-1 intelligent addressable relay module, two sets of Form-C dry contacts for door holders, AHU shutdown, four-wire detector power reset",
    lifecycle: "CURRENT",
    doc: DOC.mods,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("protocol", "FlashScan", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("clip_protocol_support", "Yes", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("module_type", "Relay Module", DOC.mods, "FRM-1 provides two Form-C dry contacts"),
      attr("device_role", "SLC_MODULE", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("addressing", "Addressable", DOC.mods, "FCM-1 & FRM-1 Control and Relay Module"),
      attr("address_consumption", 1, DOC.mods, "Each FRM-1 uses one of 159 possible module addresses"),
      attr("relay_contacts", "2 x Form-C", DOC.mods, "The FRM-1 provides two Form-C dry contacts that switch together"),
      attr("relay_circuit_supervised", "No", DOC.mods, "Circuit connections to the relay contacts are not supervised by the module"),
      attr("mounting_requirement", "4 inch square x 2-1/8 inch deep box, or SMB500; CB500 barrier", DOC.mods, "FCM-1 and FRM-1 Construction"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.4 Relay"),
      attr("standard_compliance", "UL 864 10th Edition", DOC.slcm, "1.2 UL 864 Compliance"),
    ],
  },
  {
    partNumber: "FMM-101",
    family: "Monitor Module",
    description: "Notifier FMM-101 miniature intelligent addressable monitor module, single-gang box behind the monitored device",
    lifecycle: "CURRENT",
    doc: DOC.mods,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("protocol", "FlashScan", DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("clip_protocol_support", "Yes", DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("module_type", "Monitor Module", DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("device_role", "SLC_MODULE", DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("addressing", "Addressable", DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("address_consumption", 1, DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("supervised_input_capability", "Style B (Class B) IDC only", DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("mounting_requirement", "single-gang junction box, directly behind the monitored device", DOC.mods, "FMM-101 Mini Monitor Module"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.slcm, "1.6.1 Monitor/Zone Interface Module"),
      attr("standard_compliance", "UL 864 10th Edition", DOC.slcm, "1.2 UL 864 Compliance"),
    ],
  },

  // ---- MANUAL STATION -----------------------------------------------------
  {
    partNumber: "NBG-12LX",
    family: "Pull Station",
    description: "Notifier NBG-12LX dual-action addressable manual pull station, key-lock reset, automatic FlashScan and CLIP operation",
    lifecycle: "CURRENT",
    doc: DOC.mcp,
    reviewStatus: "Reviewed",
    attributes: [
      attr("ecosystem", "NOTIFIER", DOC.mcp, "Description"),
      attr("protocol", "FlashScan", DOC.mcp, "Description -- automatically operate in either FlashScan or CLIP mode"),
      attr("clip_protocol_support", "Yes", DOC.mcp, "Description -- automatically operate in either FlashScan or CLIP mode"),
      attr("addressing", "Addressable", DOC.mcp, "Description -- provides the control panel with one addressable alarm initiating input"),
      attr("address_type", "Addressable", DOC.mcp, "Description"),
      // CORRECTED 2026-09-30: the SLC role is MODULE, not field device.
      // DN-6726 installation manual: "The addressable module is housed inside the
      // pull station." The programming note classifies it as "an Alarm
      // Initiating Module of software type 'mpul'". Its address therefore comes
      // from the MODULE address resource, not the detector resource.
      attr("device_role", "SLC_MODULE", DOC.mcp, "Description -- the addressable module is housed inside the pull station; NBG-12LX is an Alarm Initiating Module of software type 'mpul'"),
      attr("software_type", "mpul", DOC.mcp, "Software Note -- the NBG-12LX is an Alarm Initiating Module of software type 'mpul'"),
      attr("address_consumption", 1, DOC.mcp, "Setting the NBG-12LX Address -- one addressable alarm initiating input"),
      attr("address_resource_class", "MODULE", DOC.mcp, "Description -- the addressable element is a module housed inside the pull station"),
      attr("flashscan_address_max", 159, DOC.mcp, "Up to 159 NBG-12LX stations per loop on FlashScan protocol loops"),
      attr("clip_address_max", 99, DOC.mcp, "Up to 99 NBG-12LX stations per loop on CLIP protocol loops"),
      attr("operation_type", "Dual-action, key-lock reset", DOC.mcp, "Description"),
      volt("Voltage", "Minimum", 15, DOC.mcp, "Ratings -- Normal Operating Voltage 24 VDC"),
      volt("Voltage", "Maximum", 32, DOC.mcp, "Ratings -- Normal Operating Voltage 24 VDC"),
      attr("mounting_requirement", "semi-flush to single-gang, double-gang or 4 inch square box; or surface mount to SB-10 / SB-I/O backbox", DOC.mcp, "Installation"),
      attr("compatible_panel_family", "NOTIFIER INSPIRE N16 Series", DOC.mcp, "Description -- compatible with all Notifier intelligent panels"),
      attr("standard_compliance", "UL 38; ULC S528", DOC.mcp, "Description -- Conforms to ANSI/UL Standard 38 and ULC Standard S528"),
    ],
  },

  // ---- BASES --------------------------------------------------------------
  {
    partNumber: "B300-6",
    family: "Detector Base",
    description: "Notifier B300-6 6 inch white standard flanged low-profile plug-in intelligent detector mounting base",
    lifecycle: "CURRENT",
    doc: DOC.bases,
    reviewStatus: "Reviewed",
    existing: true, // already present as a Honeywell base; enrich, never duplicate
    attributes: [
      attr("base_type", "Standard 6 inch flanged", DOC.bases, "B300-6"),
      attr("ecosystem", "NOTIFIER", DOC.bases, "B300-6"),
      attr("base_diameter_in", 6.1, DOC.bases, "B300-6"),
      volt("Voltage", "Minimum", 15, DOC.bases, "FOR B300-6 SERIES BASES: Operating voltage 15 to 32 VDC"),
      volt("Voltage", "Maximum", 32, DOC.bases, "FOR B300-6 SERIES BASES: Operating voltage 15 to 32 VDC"),
      attr("standard_compliance", "UL 268", DOC.bases, "Listings"),
    ],
  },
  {
    partNumber: "B224BI-IV",
    family: "Detector Base",
    description: "Notifier B224BI-IV ivory intelligent detector isolator base, isolates the section of the SLC loop containing a short circuit",
    lifecycle: "CURRENT",
    doc: DOC.bases,
    reviewStatus: "Reviewed",
    attributes: [
      attr("base_type", "Isolator base", DOC.bases, "B224BI-IV -- ivory isolator detector base"),
      attr("ecosystem", "NOTIFIER", DOC.bases, "B224BI-IV"),
      attr("isolator_capability", "Yes", DOC.bases, "Isolator bases allow the SLC loop to operate under fault conditions created from a short circuit"),
      volt("Voltage", "Minimum", 15, DOC.bases, "FOR B300-6 SERIES BASES: Operating voltage 15 to 32 VDC"),
      volt("Voltage", "Maximum", 32, DOC.bases, "FOR B300-6 SERIES BASES: Operating voltage 15 to 32 VDC"),
    ],
  },
  {
    partNumber: "B224RB-IV",
    family: "Detector Base",
    description: "Notifier B224RB-IV ivory intelligent detector relay base, Form-C relay contacts",
    lifecycle: "CURRENT",
    doc: DOC.bases,
    reviewStatus: "Reviewed",
    attributes: [
      attr("base_type", "Relay base", DOC.bases, "B224RB-IV -- ivory relay base"),
      attr("ecosystem", "NOTIFIER", DOC.bases, "B224RB-IV"),
      attr("relay_capability", "Form C", DOC.bases, "B224RB relay base"),
      volt("Voltage", "Minimum", 15, DOC.bases, "FOR B300-6 SERIES BASES: Operating voltage 15 to 32 VDC"),
      volt("Voltage", "Maximum", 32, DOC.bases, "FOR B300-6 SERIES BASES: Operating voltage 15 to 32 VDC"),
    ],
  },
];

// Detector -> compatible base relationships. B501 is intentionally absent: the
// part number already exists in the catalogue and is not duplicated here.
const DETECTOR_BASES = [
  "FSP-951-IV", "FSP-951T-IV", "FST-951-IV", "FST-951R-IV", "FST-951H-IV",
  "FSP-951-SELFT", "FSP-951T-SELFT", "FST-951-SELFT",
].flatMap((pn) => [
  { partNumber: pn, accessoryPartNumber: "B300-6", relationshipType: "Compatible Base", quantityRule: "One per detector" },
  { partNumber: pn, accessoryPartNumber: "B224BI-IV", relationshipType: "Compatible Base", quantityRule: "One per detector", condition: "Isolated loop section required" },
  { partNumber: pn, accessoryPartNumber: "B224RB-IV", relationshipType: "Compatible Base", quantityRule: "One per detector", condition: "Local relay output required at the detector position" },
]);

// ASSEMBLY relationships. These record REQUIRED companions, and -- critically --
// record the address consequence, because the failure mode this prevents is
// counting a mechanical part as a second SLC point.
//
//   Duct detector assembly = 1 address, not 2.
//     The HOUSING (DNR / DNRW) "Requires photoelectric smoke detector (sold
//     separately)" and is explicitly NON-RELAY, so it has no addressable
//     element. The address is carried by the FSP-951R head. The sampling tube
//     and remote test station are mechanical / housing-wired accessories.
//   Firefighter telephone = the JACK is passive; the ADDRESSABLE interface is
//     the module, and the module count follows the telephone CIRCUIT count.
//     Recording "one FTM-1 per N-FPJ" would manufacture a topology the project
//     never specified and the manufacturer never states.
const ASSEMBLY = [
  { partNumber: "DNR", accessoryPartNumber: "FSP-951R-IV", relationshipType: "Requires Compatible Detector", quantityRule: "One per housing; the head is sold separately and carries the single SLC address", included: 0 },
  { partNumber: "DNR", accessoryPartNumber: "DST1", relationshipType: "Requires Sampling Tube", quantityRule: "One per housing, sized to duct width; DST1.5 for ducts 1-2 ft wide", included: 0 },
  { partNumber: "DNRW", accessoryPartNumber: "FSP-951R-IV", relationshipType: "Requires Compatible Detector", quantityRule: "One per housing; the head is sold separately and carries the single SLC address", included: 0 },
  { partNumber: "DNRW", accessoryPartNumber: "DST1", relationshipType: "Requires Sampling Tube", quantityRule: "One per housing, sized to duct width; DST1.5 for ducts 1-2 ft wide", included: 0 },
  { partNumber: "N-FPJ", accessoryPartNumber: "FTM-1", relationshipType: "Requires Addressable Firephone Interface", quantityRule: "One FTM-1 per supervised firefighter telephone CIRCUIT, not per jack. An FTM-1 controls a bussed Style Y/Z circuit; any number of N-FPJ jacks may share that circuit, so neither the jack count nor the 'up to two phones per circuit' capacity determines the module count. QUANTITY IS PENDING_INPUT (PENDING_TELEPHONE_CIRCUIT_TOPOLOGY).", included: 0 },
];

// Device -> panel/loop-interface compatibility. Brand equality alone is never
// compatibility evidence: each row names the exact loop interface and protocol.
//
// TWO rows per device, because the chain has two links and both are separately
// evidenced:
//   device -> SLM-318   the loop interface the device physically connects to
//   device -> N16e      the control unit the device is listed against
// Together these ARE the ecosystem proof. Neither row is a shortcut for the
// other, and neither asserts anything about a product that was not consulted.
// Only genuine SLC-addressed devices belong here. DNR / DNRW / DST1 / RTS151 /
// N-FPJ are deliberately ABSENT: they are housings, mechanical accessories and
// passive telephone jacks that occupy no address, so asserting SLC-loop
// compatibility for them would manufacture a relationship the manufacturer
// does not make.
const DEVICES = ["FSP-951-IV", "FSP-951T-IV", "FSP-951R-IV", "FST-951-IV", "FST-951R-IV", "FST-951H-IV", "FSP-951-SELFT", "FSP-951T-SELFT", "FST-951-SELFT", "FMM-1", "FMM-101", "FCM-1", "FRM-1", "FTM-1", "NBG-12LX"];
const PANEL_COMPAT = [
  ...DEVICES.map((pn) => ({ partNumber: pn, target: "SLM-318", requiredProtocol: "FlashScan", conditions: JSON.stringify({ link: "loop-interface", loopInterface: "SLM-318", panelFamily: "NOTIFIER INSPIRE N16 Series", clipLicenseRequired: false }) })),
  ...DEVICES.map((pn) => ({ partNumber: pn, target: "N16e", requiredProtocol: "FlashScan", conditions: JSON.stringify({ link: "control-unit", loopInterface: "SLM-318", panelFamily: "NOTIFIER INSPIRE N16 Series", ecosystem: "NOTIFIER", clipLicenseRequired: false }) })),
];

// ---------------------------------------------------------------------------
// WRITE
// ---------------------------------------------------------------------------
const log = (...a) => console.log(...a);
let productsAdded = 0, productsEnriched = 0, attrsAdded = 0, accAdded = 0, compatAdded = 0, brandsAdded = 0, familiesAdded = 0, discoveryApproved = 0, standardsAdded = 0, attrsRemoved = 0, skipped = 0;

// Matches worker/product-auto-review.mjs so the audit row is attributable.
const PRODUCT_AUTO_REVIEW_ACTOR = "system-product-auto-review";

const manufacturer = db.prepare("SELECT id, name FROM product_manufacturers WHERE lower(name)=lower(?)").get("Honeywell");
if (!manufacturer) throw new Error("HONEYWELL_MANUFACTURER_MISSING: the catalogue must have Honeywell as the manufacturer; NOTIFIER is a brand, not a manufacturer.");
const MFR_ID = manufacturer.id;

const getBrand = db.prepare("SELECT id, name FROM product_brands WHERE manufacturer_id=? AND lower(normalized_name)=lower(?)");
const insertBrand = db.prepare("INSERT INTO product_brands (id, manufacturer_id, name, normalized_name, status, created_at) VALUES (?, ?, ?, ?, 'Needs Review', CURRENT_TIMESTAMP)");
const getFamily = db.prepare("SELECT id, name FROM product_families WHERE brand_id=? AND lower(normalized_name)=lower(?)");
const insertFamily = db.prepare("INSERT INTO product_families (id, brand_id, parent_family_id, name, normalized_name, engineering_domain, review_status, created_at) VALUES (?, ?, NULL, ?, ?, ?, 'Needs Review', CURRENT_TIMESTAMP)");
const getProduct = db.prepare("SELECT id, part_number, attributes FROM library_products WHERE part_number=? AND identity_status='Active'");
// `approved_for_discovery` is deliberately 0. Discovery approval is a separate
// governed HUMAN review outcome; ingesting manufacturer evidence never grants it.
const insertProduct = db.prepare("INSERT INTO library_products (id, manufacturer_id, brand_id, family_id, part_number, normalized_part_number, description, lifecycle_status, country_of_origin, attributes, standards, review_status, approved_for_discovery, created_by, created_at, updated_at, identity_status, identity_version, library_scope, product_role) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'Active',1,'Global Library','Primary Equipment')");
const updateProduct = db.prepare("UPDATE library_products SET description=?, attributes=?, lifecycle_status=?, review_status=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
const getAccessory = db.prepare("SELECT 1 FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND relationship_type=? AND deleted_at IS NULL AND superseded_at IS NULL");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, scope, condition_json, included, separately_priced, source_id, evidence_json, confidence, review_status, version_number, created_by) VALUES (?,?,?,?,?,'Global Library',?,0,1,?,?,92,'Approved',1,?)");
const getCompat = db.prepare("SELECT 1 FROM product_compatibility WHERE source_product_id=? AND target_product_id=? AND relationship_type=? AND deleted_at IS NULL AND superseded_at IS NULL");

// Facts a PREVIOUS run of this script emitted that the current manufacturer
// evidence does NOT support. A re-run removes them instead of preserving them.
// This is how a corrected ingestion stays idempotent AND self-correcting.
const ATTR_CORRECTIONS = {
  "FST-951-IV": {
    retired: ["rate_of_rise_sensitivity", "standard_compliance"],
    why: "Two separate errors. (1) DN-60975 Product Line Information: 'FST-951-IV: Ivory, low-profile intelligent 135F FIXED THERMAL SENSOR' -- the rate-of-rise model is the distinct FST-951R / FST-951R-IV, so ROR was asserted in error. (2) 'UL/ULC Listing S2101' was recorded as a product STANDARD; S2101 is a UL listing file identifier, not a standard. The heat-detector standard is UL 521 per Honeywell I56-6522-000.",
  },
  "FST-951R-IV": {
    retired: ["standard_compliance", "ul_listing_file"],
    why: "An earlier run recorded 'UL/ULC Listing S2101' as a product STANDARD. S2101 is a UL LISTING FILE identifier, not a standard. The standard for a heat detector is UL 521, stated by Honeywell installation manual I56-6522-000: 'UL 521 listed for Heat Detectors' and '50-foot spacing capability as approved by UL 521'. The listing is now recorded as a revision-scoped listing attribute, not a standard.",
  },
};
const insertCompat = db.prepare("INSERT INTO product_compatibility (id, source_product_id, target_product_id, target_family_id, relationship_type, conditions_json, exceptions_json, required_firmware, required_protocol, source_id, evidence_json, confidence, review_status, version_number, created_by) VALUES (?,?,?,NULL,'Compatible With',?,'[]',NULL,?,?,?,92,'Approved',1,?)");

if (apply) db.exec("BEGIN IMMEDIATE");
try {
  let brand = getBrand.get(MFR_ID, "NOTIFIER");
  if (!brand) {
    brand = { id: id("brand"), name: "Notifier" };
    if (apply) insertBrand.run(brand.id, MFR_ID, "Notifier", "NOTIFIER");
    brandsAdded += 1;
    log(`${apply ? "INSERT" : "WOULD INSERT"}: product_brands Notifier (manufacturer Honeywell)`);
  }
  const BRAND_ID = brand.id;

  const familyIds = new Map();
  for (const name of [...new Set(PRODUCTS.map((p) => p.family))]) {
    let fam = getFamily.get(BRAND_ID, name);
    if (!fam) {
      fam = { id: id("family"), name };
      if (apply) insertFamily.run(fam.id, BRAND_ID, name, name, "Fire Alarm");
      familiesAdded += 1;
      log(`${apply ? "INSERT" : "WOULD INSERT"}: product_families ${name}`);
    }
    familyIds.set(name, fam.id);
  }

  const productIds = new Map();
  for (const p of PRODUCTS) {
    const existing = getProduct.get(p.partNumber);
    let pid;
    if (existing) {
      pid = existing.id;
      const current = (() => { try { return JSON.parse(existing.attributes || "[]"); } catch { return []; } })();
      // CORRECTION SAFETY. A re-run must be able to REPLACE and REMOVE a fact
      // the evidence no longer supports, not only add facts. An earlier
      // ingestion gave FST-951-IV a rate_of_rise_sensitivity attribute AND a
      // "Fixed Temperature and Rate-of-Rise" detection_principle that DN-60975
      // does not support; a plain additive merge would preserve both forever.
      //
      // Reconciliation order per attribute name:
      //   name in current evidence      -> REPLACE the value with the current one
      //   name retired AND NOT in evidence -> REMOVE entirely
      //   name only in the store, not owned by this product's table -> KEEP
      //     (it came from another source and this script must not touch it)
      //
      // The "AND NOT in evidence" clause is essential. A name can appear in
      // ATTR_CORRECTIONS.retired because an EARLIER run asserted it wrongly, and
      // then be legitimately re-asserted in the corrected evidence table (for
      // example `standard_compliance`, first recorded as the bogus "UL 2101"
      // and now correctly recorded as "UL 521"). Retiring it unconditionally
      // would delete the corrected fact and the append pass below would skip it,
      // because the name was still present in the store -- losing it forever.
      // A correction therefore only ever removes a claim the evidence ABANDONS.
      const RETIRED = ATTR_CORRECTIONS[p.partNumber]?.retired || [];
      const evidenceNames = new Set(p.attributes.map((a) => a.name));
      const retiredSet = new Set(RETIRED.filter((n) => !evidenceNames.has(n)));
      const merged = [];
      let attrsChanged = 0;
      for (const existingAttr of current) {
        if (retiredSet.has(existingAttr.name)) { attrsRemoved += 1; attrsChanged += 1; continue; }
        if (evidenceNames.has(existingAttr.name)) {
          const fresh = p.attributes.find((a) => a.name === existingAttr.name);
          if (JSON.stringify(fresh) !== JSON.stringify(existingAttr)) { merged.push(fresh); attrsChanged += 1; continue; }
        }
        merged.push(existingAttr);
      }
      const mergedNames = new Set(merged.map((a) => a.name));
      for (const a of p.attributes) if (!mergedNames.has(a.name)) { merged.push(a); attrsAdded += 1; attrsChanged += 1; }
      if (retiredSet.size) log(`${apply ? "RECONCILE" : "WOULD RECONCILE"}: ${p.partNumber} -- removing unsupported attribute(s) ${[...retiredSet].join(", ")} (${ATTR_CORRECTIONS[p.partNumber].why})`);
      if (attrsChanged > 0) {
        if (apply) updateProduct.run(p.description, JSON.stringify(merged), p.lifecycle, p.reviewStatus, pid);
        log(`${apply ? "UPDATE" : "WOULD UPDATE"}: ${p.partNumber} (${attrsChanged} attribute change(s) reconciled against current manufacturer evidence)`);
        productsEnriched += 1;
      } else { skipped += 1; }
      if (!familyIds.get(p.family)) continue;
    } else {
      pid = id("product");
      if (apply) {
        insertProduct.run(
          pid, MFR_ID, BRAND_ID, familyIds.get(p.family) || null, p.partNumber, p.partNumber.toUpperCase(),
          p.description, p.lifecycle, "USA", JSON.stringify(p.attributes), "[]", p.reviewStatus, CREATED_BY,
        );
      }
      productsAdded += 1;
      log(`${apply ? "INSERT" : "WOULD INSERT"}: library_products ${p.partNumber} [${p.family}] ${p.attributes.length} attributes`);
    }
    productIds.set(p.partNumber, pid);
  }

  for (const rel of DETECTOR_BASES) {
    const source = productIds.get(rel.partNumber);
    const target = productIds.get(rel.accessoryPartNumber);
    if (!source || !target) continue;
    if (getAccessory.get(source, target, rel.relationshipType)) continue;
    if (apply) {
      insertAccessory.run(id("acc"), source, target, rel.relationshipType, rel.quantityRule,
        JSON.stringify(rel.condition ? [rel.condition] : []), p0(rel.accessoryPartNumber),
        JSON.stringify({ manufacturer: "Honeywell", brand: "Notifier", ecosystem: "NOTIFIER", source: p0(rel.accessoryPartNumber) }), CREATED_BY);
    }
    accAdded += 1;
    log(`${apply ? "INSERT" : "WOULD INSERT"}: product_accessories ${rel.partNumber} -> ${rel.accessoryPartNumber} (${rel.relationshipType}${rel.condition ? `, condition: ${rel.condition}` : ""})`);
  }

  for (const rel of ASSEMBLY) {
    const source = productIds.get(rel.partNumber);
    const target = productIds.get(rel.accessoryPartNumber);
    if (!source || !target) { log(`SKIP assembly: unresolved product id for ${rel.partNumber} -> ${rel.accessoryPartNumber}`); continue; }
    if (getAccessory.get(source, target, rel.relationshipType)) continue;
    if (apply) {
      insertAccessory.run(id("acc"), source, target, rel.relationshipType, rel.quantityRule,
        "[]", p0(rel.accessoryPartNumber),
        JSON.stringify({ manufacturer: "Honeywell", brand: "Notifier", ecosystem: "NOTIFIER", source: p0(rel.accessoryPartNumber) }), CREATED_BY);
    }
    accAdded += 1;
    log(`${apply ? "INSERT" : "WOULD INSERT"}: product_accessories ${rel.partNumber} -> ${rel.accessoryPartNumber} (${rel.relationshipType}; ${rel.quantityRule})`);
  }

  for (const rel of PANEL_COMPAT) {
    const source = productIds.get(rel.partNumber);
    const target = productIds.get(rel.target);
    if (!source || !target) { log(`SKIP compat: unresolved product id for ${rel.partNumber} -> ${rel.target}`); continue; }
    const relationshipType = "Compatible With";
    if (getCompat.get(source, target, relationshipType)) { skipped += 1; continue; }
    if (apply) {
      insertCompat.run(id("compat"), source, target, rel.conditions, rel.requiredProtocol,
        "Honeywell NOTIFIER SLC Wiring Manual 51253 Rev U9",
        JSON.stringify({ ecosystem: "NOTIFIER", loopInterface: "SLM-318", panelFamily: "NOTIFIER INSPIRE N16 Series", evidence: "Manufacturer: device is a two-wire SLC loop device supported on the N16 Series via the SLM-318 Signaling Loop Module." }),
        CREATED_BY);
    }
    compatAdded += 1;
    log(`${apply ? "INSERT" : "WOULD INSERT"}: product_compatibility ${rel.partNumber} -> ${rel.target} (Compatible With, required_protocol=${rel.requiredProtocol})`);
  }

  // -------------------------------------------------------------------------
  // Standards/listings. The manufacturer datasheets state these explicitly in
  // their own Listings sections, so they are transcribed, not inferred:
  //   FSP-951 series -> UL 268 7th Edition (Features: "Designed to meet UL268 7th Edition")
  //   FST-951 series -> UL 521 7th Edition (the heat-detector listing)
  //   SLM-318 / N16  -> UL 864 10th Edition (SLC Wiring Manual 1.2, UL listing LS10234)
  //   NBG-12LX       -> UL 38 (the manual-station listing)
  // Written to library_products.standards, the same JSON column the matching
  // engine reads. A product is only ever given a standard its own document
  // names; UL never implies FM and EN54 never implies LPCB.
  // -------------------------------------------------------------------------
  // Every entry carries its `source`, because the matching engine treats a bare
  // listing claim as "Claimed Compliant" and only a sourced one as "Verified
  // Compliant" (TM7). A number without a document is not evidence, so the
  // document travels with it.
  const ul = (number, doc, section) => ({ body: "UL", number, source: { sourceType: doc.sourceType, sourceId: doc.sourceId, url: doc.url, section } });
  const STANDARDS = {
    "FSP-951-IV": [ul("268", DOC.smoke, "Features -- Designed to meet UL268 7th Edition")],
    "FSP-951T-IV": [ul("268", DOC.smoke, "Features -- Designed to meet UL268 7th Edition")],
    // UL 521 is the STANDARD for a heat detector; S2101 and S747 are LISTING
    // file identifiers and must never appear in this table. An earlier version
    // of this script put "UL 2101" here, which was a category error: S2101 is a
    // UL listing file, not a published standard.
    "FST-951-IV": [ul("521", DOC.heatInstall, "SPECIFICATIONS -- 'UL 521 listed for Heat Detectors'")],
    "FST-951R-IV": [ul("521", DOC.heatInstall, "SPECIFICATIONS -- 'UL 521 listed for Heat Detectors'")],
    "FST-951H-IV": [ul("521", DOC.heatInstall, "SPECIFICATIONS -- 'UL 521 listed for Heat Detectors'")],
    "FSP-951-SELFT": [ul("268", DOC.selft, "General -- UL 268 smoke detector listing")],
    "FSP-951T-SELFT": [ul("268", DOC.selft, "General -- UL 268 smoke detector listing")],
    "FST-951-SELFT": [ul("521", DOC.selft, "UL Listed Velocity Range")],
    "N16e": [ul("864", DOC.slcm, "1.2 UL 864 Compliance -- N16 certified to comply with UL 864 10th Edition; UL listing document LS10234-051NF-E")],
    "N16x": [ul("864", DOC.slcm, "1.2 UL 864 Compliance -- UL listing document LS10234-051NF-E")],
    "SLM-318": [ul("864", DOC.slcm, "1.2 UL 864 Compliance -- installation document LS10243-000NF-E")],
    "FMM-1": [ul("864", DOC.slcm, "1.2 UL 864 Compliance")],
    "FMM-101": [ul("864", DOC.slcm, "1.2 UL 864 Compliance")],
    "FCM-1": [ul("864", DOC.slcm, "1.2 UL 864 Compliance")],
    "FRM-1": [ul("864", DOC.slcm, "1.2 UL 864 Compliance")],
    "NBG-12LX": [ul("38", DOC.mcp, "Description -- Conforms to ANSI/UL Standard 38 and ULC Standard S528")],
    // UL 268A is the duct-detector standard, and the Al Mousa specification
    // names it verbatim: "UL 268A 4th Edition 2009 -- UL Standard for Safety:
    // Smoke Detectors for Duct Application". It is NOT UL 268, which governs
    // the general (ceiling) smoke detectors.
    "FSP-951R-IV": [ul("268A", DOC.ductHousing, "Listings and Agency Listings -- UL 268A is the standard for smoke detectors for duct application, per the Al Mousa specification")],
    "DNR": [ul("268A", DOC.ductHousing, "Listings and Agency Listings -- UL 268A is the standard for smoke detectors for duct application, per the Al Mousa specification")],
    "DNRW": [ul("268A", DOC.ductHousing, "Listings and Agency Listings -- UL 268A is the standard for smoke detectors for duct application, per the Al Mousa specification")],
    // The firefighter telephone system is part of the fire alarm control unit
    // and is governed by UL 864. S635 (FTM-1) and S3511 (FFT-FPJ) are LISTING
    // identifiers, not standards, and are recorded as attributes only.
    "FTM-1": [ul("864", DOC.fft, "Governing standard -- the firefighter telephone system is part of the fire alarm control unit standard; the Al Mousa specification requires 'compliance [to] ANSI UL 864'")],
    "N-FPJ": [ul("864", DOC.fft, "Governing standard -- the firefighter telephone system is part of the fire alarm control unit standard; the Al Mousa specification requires 'compliance [to] ANSI UL 864'")],
  };
  const updateStandards = db.prepare("UPDATE library_products SET standards=?, updated_at=CURRENT_TIMESTAMP WHERE id=?");
  for (const p of PRODUCTS) {
    const pid = productIds.get(p.partNumber);
    const rows = STANDARDS[p.partNumber];
    if (!pid || !rows) continue;
    if (apply) updateStandards.run(JSON.stringify(rows), pid);
    standardsAdded += rows.length;
    log(`${apply ? "STANDARDS" : "WOULD SET STANDARDS"}: ${p.partNumber} -> ${rows.map((r) => `${r.body} ${r.number}`).join(", ")}`);
  }

  // -------------------------------------------------------------------------
  // Discovery approval -- through the EXISTING governed policy, not by hand.
  //
  // worker/product-auto-review.mjs `autoApproveDiscovery` is the sanctioned
  // mechanism. Its own gate is `review_status === 'Reviewed'`; ingestion sets
  // that from the manufacturer evidence, so the policy is satisfied. The same
  // audit row and the same `decided_by`/`decided_role` are written here, so
  // nothing is approved silently. `N16x` stays unapproved: it is a licensed
  // persona, not an orderable product, and must never become discoverable.
  // -------------------------------------------------------------------------
  const getDecisionCount = db.prepare("SELECT COUNT(*) c FROM product_library_decisions WHERE entity_id=? AND action='Auto-Approve Discovery'");
  const approveDiscovery = db.prepare("UPDATE library_products SET approved_for_discovery=1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND review_status='Reviewed' AND approved_for_discovery=0");
  const insertLibDecision = db.prepare("INSERT INTO product_library_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, decided_by, decided_role, decided_at) VALUES (?, NULL, 'library_products', ?, 'Auto-Approve Discovery', 'Not Approved', 'Approved', ?, ?, 'System', CURRENT_TIMESTAMP)");
  const DISCOVERY_REASON = `Auto-approved for discovery by policy: manufacturer evidence ingested from Tier-1 NOTIFIER/Honeywell primary documentation (see product_attributes provenance). Approval makes the product technically discoverable for matching; it is NOT a price, availability or Consultant-approval decision.`;

  for (const p of PRODUCTS) {
    if (p.partNumber === "N16x") {
      if (apply && productIds.has("N16x")) {
        const pid = productIds.get("N16x");
        db.prepare("UPDATE library_products SET approved_for_discovery=0, updated_at=CURRENT_TIMESTAMP WHERE id=?").run(pid);
        log(`DISCOVERY: N16x withheld -- licensed persona, not an orderable product`);
      }
      continue;
    }
    const pid = productIds.get(p.partNumber);
    if (!pid) continue;
    if (getDecisionCount.get(pid).c > 0) { skipped += 1; continue; }
    if (p.reviewStatus !== "Reviewed") {
      log(`DISCOVERY: ${p.partNumber} withheld -- review_status=${p.reviewStatus} does not satisfy the governed auto-approval gate`);
      continue;
    }
    if (apply) {
      approveDiscovery.run(pid);
      insertLibDecision.run(id("libdecision"), pid, DISCOVERY_REASON, PRODUCT_AUTO_REVIEW_ACTOR);
    }
    discoveryApproved += 1;
    log(`${apply ? "APPROVE" : "WOULD APPROVE"}: ${p.partNumber} for discovery (governed auto-approval policy, audited)`);
  }

  if (apply) db.exec("COMMIT");
  log(`\nSUMMARY products_added=${productsAdded} products_enriched=${productsEnriched} products_unchanged=${skipped} attributes_added=${attrsAdded} attributes_removed=${attrsRemoved} brands=${brandsAdded} families=${familiesAdded} accessories=${accAdded} compatibility=${compatAdded} standards=${standardsAdded} discovery_approved=${discoveryApproved}`);
} catch (error) {
  if (apply) db.exec("ROLLBACK");
  console.error(`FAILED and rolled back: ${error.message}`);
  process.exit(1);
}

function p0(pn) {
  const p = PRODUCTS.find((x) => x.partNumber === pn);
  return p ? p.doc.sourceId : "Honeywell NOTIFIER";
}
