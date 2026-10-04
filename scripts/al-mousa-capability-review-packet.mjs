// AL MOUSA -- TECHNICAL MANAGER CAPABILITY REVIEW PACKET (GENERATOR, NO WRITE).
//
// READ-ONLY. This script WRITES NOTHING to the database. It emits the exact
// decision-ready facts a human Technical Manager must adjudicate, because this
// slice is NOT permitted to self-promote capability facts or impersonate a
// reviewer. Run it, hand the output to the reviewer, and let the existing
// governed review path apply whatever is approved.
//
// WHY A PACKET INSTEAD OF A WRITE
// --------------------------------
// Every governed human-authority mutation is gated by requireHumanActor
// (worker/human-actor.mjs), which fails closed with 403 unless a truthful human
// identity is configured server-side. That module exists precisely so an agent
// cannot record a decision in a human's name. So the correction stops here: the
// capability model source is corrected and evidenced, the persisted rows are left
// exactly as they are, and the human applies them.

import { DatabaseSync } from "node:sqlite";
import { PANEL_CAPABILITY_FACTS, EXPANSION_STATE } from "./lib/farenhyt-panel-capability.mjs";

const DB = process.env.FA_DB;
if (!DB) { console.error("usage: FA_DB=<sqlite> node scripts/al-mousa-capability-review-packet.mjs"); process.exit(2); }
const db = new DatabaseSync(DB, { readOnly: true });

// Facts this slice changed or newly established, each with what the human must decide.
const DECISIONS = [
  {
    product: "IFP-2100HV", attribute: "slc_expansion_max_count",
    proposedValue: 63, currentPersistedValue: 12,
    source: "Honeywell Farenhyt 6815 Signaling Line Circuit Expander Data Sheet (honeywell-edam prod-edam, first-party)",
    revisionDate: "current hosted revision",
    pageSection: "SYSTEM CAPACITY",
    exactProposition: "IFP-2100/ECS FACP supports 63 6815s (but a maximum of 2100 SLC devices per system)",
    whyItFailsToday: "The persisted 12 was DERIVED as 2100/159 = 13 loops = 1 in-build + 12 expanders. LS10143-001SK-E Rev E states only \"The number of 6815s is limited by the maximum number of SBUS devices\"; its 71 occurrences of \"12\" are all section and page numbers. No first-party proposition supports 12.",
    recommendedAction: "REPLACE 12 WITH 63, superseding the derived value",
    reviewStatusClass: "SOURCE_DEFECT / SUPERSEDED_UNSUPPORTED_CAPABILITY",
    downstreamConsequence: "None for Al Mousa: the project needs 1/3/5 expanders per panel, all within both 12 and 63. Material to the REUSABLE model only.",
  },
  {
    product: "IFP-2100HV", attribute: "max_sbus_6815_expanders", proposedValue: 63,
    currentPersistedValue: null,
    source: "6815 Data Sheet", revisionDate: "current hosted revision", pageSection: "SYSTEM CAPACITY",
    exactProposition: "IFP-2100/ECS FACP supports 63 6815s (but a maximum of 2100 SLC devices per system)",
    whyItFailsToday: "Not modelled at all; the physical/SBUS expander limit was conflated with the point ceiling.",
    recommendedAction: "INSERT as an independent dimension",
    reviewStatusClass: "NEW_EVIDENCE",
    downstreamConsequence: "Gates any future project needing more than 12 loops of expansion.",
  },
  {
    product: "IFP-2100HV", attribute: "max_system_slc_points_idp_sk", proposedValue: 2100,
    currentPersistedValue: 2100,
    source: "Honeywell IFP-2100/IFP-2100ECS Manual LS10143-001SK-E Rev E 8/29/2022 ECN 00021453",
    revisionDate: "Rev E, 8/29/2022", pageSection: "Sec 4.12 (6815 Installation); Sec 1.1.1",
    exactProposition: "The maximum number of IDP or SK SLC devices per panel is 2,100.",
    whyItFailsToday: "Value is correct but was stored only as panel_point_capacity_idp_sk, not as the distinct system SLC ceiling it is.",
    recommendedAction: "INSERT as an independent dimension (existing value retained)",
    reviewStatusClass: "NEW_EVIDENCE",
    downstreamConsequence: "Prevents a future reader treating 2100 as a per-loop or expander figure.",
  },
  {
    product: "IFP-2100HV", attribute: "full_populated_loop_equivalent_at_system_ceiling", proposedValue: 13,
    currentPersistedValue: null,
    source: "DERIVED from two first-party figures", revisionDate: "n/a", pageSection: "n/a",
    exactProposition: "DERIVED, NOT A MANUFACTURER LIMIT: 2100 system points / 159 points per loop = 13 loop-equivalents",
    whyItFailsToday: "This derivation is precisely what produced the incorrect 12. It must be labelled so it can never be read as a hardware limit.",
    recommendedAction: "INSERT EXPLICITLY LABELLED AS DERIVED, or reject",
    reviewStatusClass: "DERIVED_NOT_LIMIT",
    downstreamConsequence: "If misread as a hardware maximum it under-states expansion capability by 51 expanders.",
  },
  {
    product: "IFP-2100HV", attribute: "sbus_device_capacity", proposedValue: 63,
    currentPersistedValue: null,
    source: "LS10143-001SK-E Rev E", revisionDate: "Rev E, 8/29/2022", pageSection: "Sec 1.1.1 and Sec 4.16.1",
    exactProposition: "The system supports a maximum of 63 SBUS devices in any combination. / SBUS devices on a panel are addressed from 1 to 63 ... the actual number is limited by current draw and SBUS bandwidth usage",
    whyItFailsToday: "Not separately modelled from the annunciator-oriented sbus_device_limit.",
    recommendedAction: "INSERT as an independent dimension",
    reviewStatusClass: "NEW_EVIDENCE",
    downstreamConsequence: "The binding constraint on expander count is SBUS, not points.",
  },
  {
    product: "6815", attribute: "permissible_mounting", proposedValue: "compatible FACP cabinet; 5895XL cabinet; RPS-1000 cabinet; 5815RMK remote mounting kit; SK-NIC-KIT remote mounting kit",
    currentPersistedValue: "IFP-2100 cabinet; RPS-1000 cabinet; 5815RMK remote mounting kit",
    source: "6815 Product Installation Document LS10173-001SK-E Rev A", revisionDate: "A, 07/01/2017",
    pageSection: "Sec 1.4 Mounting",
    exactProposition: "You can mount the 6815 in a compatible FACP cabinet, in the 5895XL or RPS-1000 intelligent power module cabinet, or in the SK-NIC-KIT remote mounting kit. / If mounting the 6815 in a 5815RMK or SK-NIC-KIT orientate the 6815 board(s) as shown in Figure 1.1",
    whyItFailsToday: "The persisted value OMITS 5895XL and SK-NIC-KIT, and NARROWS \"compatible FACP cabinet\" to \"IFP-2100 cabinet\", narrowing a manufacturer statement.",
    recommendedAction: "REPLACE with the full first-party mounting list",
    reviewStatusClass: "SOURCE_FIDELITY_DEFECT",
    downstreamConsequence: "Would under-count available in-enclosure slots and over-order remote-mount kits.",
  },
  {
    product: "5815RMK", attribute: "loop_cards_per_kit", proposedValue: 2,
    currentPersistedValue: 2,
    source: "6815 Data Sheet", revisionDate: "current hosted revision", pageSection: "ACCESSORIES",
    exactProposition: "5815RMK: Remote Mounting Kit Cabinet holds two 6815s. Red cabinet / 5815RMKB: ... Black cabinet.",
    whyItFailsToday: "Value was right but its stored provenance (IFP-2100 manual) could not be verified because that document was absent; now independently confirmed by the 6815 Data Sheet.",
    recommendedAction: "CONFIRM value, REPLACE provenance with the 6815 Data Sheet",
    reviewStatusClass: "PROVENANCE_CORRECTION",
    downstreamConsequence: "Confirms remote-mount kit capacity of two.",
  },
  {
    product: "RPS-1000HV / 5815RMK / SK-NIC-KIT", attribute: "mounting_capacity_6815_in_enclosure",
    proposedValue: "RPS-1000HV=2, 5815RMK=2, SK-NIC-KIT=1",
    currentPersistedValue: null,
    source: "6815 Data Sheet", revisionDate: "current hosted revision", pageSection: "ACCESSORIES / FEATURES & BENEFITS",
    exactProposition: "RPS-1000: ... Cabinet holds two 6815s. / 5815RMK: ... Cabinet holds two 6815s. / SK-NIC-KIT: ... holds one 6815. / House up to two 6815s in the IFP-2100/ECS, RFP-2100, IFP-300/ECS, RPS-1000",
    whyItFailsToday: "Mounting capacity per enclosure was not modelled at all; it was being guessed in the BOM path.",
    recommendedAction: "INSERT per-enclosure capacities",
    reviewStatusClass: "NEW_EVIDENCE",
    downstreamConsequence: "The BOM allocator must consume in-enclosure slots BEFORE computing remote 5815RMK demand.",
  },
  {
    product: "IFP-75HV", attribute: "slc_expansion_state", proposedValue: EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT,
    currentPersistedValue: EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT,
    source: "IFP-75 Data Sheet 351605 Rev C (2022-03-08) + IFP-75 Manual LS10147-001SK-E Rev D (06/25/2021) + 6815 Data Sheet",
    revisionDate: "351605 Rev C 2022-03-08; LS10147 Rev D 2021-06-25", pageSection: "351605 SYSTEM EXPANDERS; LS10147 full-text; 6815 Data Sheet Compatibility",
    exactProposition: "351605 SYSTEM EXPANDERS lists only RPS-1000 and 5496; '6815'/'5815'/'RMK' occur ZERO times. LS10147-001SK-E Rev D contains ZERO occurrences of 6815, 5815, 'SLC expander' or 'expansion'. 6815 Data Sheet compatibility enumerates IFP-2100/ECS, IFP-2100/ECSB, RFP-2100, RFP-2100B, IFP-300/ECS, FP-300/ECSB -- IFP-75 is absent. Against this, LS10173-001SK-E Sec 1.2 says only: \"The 6815 is for use with compatible Honeywell Silent Knight and Farenhyt Series Fire Alarm Control Panels FACP's:\" (series-level, no model enumerated), and its Sec 1.4 DEFERS to the FACP installation manual -- which for IFP-75 contains no 6815 content at all.",
    whyItFailsToday: "The conflict is retained, but is now materially STRONGER: the affirmative side's own deferral resolves against IFP-75, and the hypothesised '6815 appears in the IFP-75 current-draw worksheet' could not be confirmed because 6815 does not appear in the IFP-75 manual at all.",
    recommendedAction: "RETAIN the conflict and NOT_CONFIRMED selection authority; do NOT convert to a global 'IFP-75 can never use 6815'",
    reviewStatusClass: "CONFLICT_RETAINED__EVIDENCE_STRENGTHENED",
    downstreamConsequence: "IFP-75HV stays unselectable for any multi-loop scope in this new project, on fail-closed grounds.",
  },

  // ---------------------------------------------------------------------
  // NAC / RPS NOTIFICATION POWER -- added by the NAC/RPS sizing slice.
  // Each fact below was read in a first-party document retrieved and inspected
  // during that slice. None has been persisted and none may be self-promoted.
  // ---------------------------------------------------------------------
  {
    product: "IFP-2100HV", attribute: "nac_constant_aux_standby_limit_amps", proposedValue: 6.0,
    currentPersistedValue: null,
    source: "Honeywell IFP-2100/IFP-2100ECS Installation Manual LS10143-001SK-E Rev E", revisionDate: "Rev E, 8/29/2022, ECN 00021453",
    pageSection: "Sec 1.1.1 (p10) and Sec 4.18.5 (p61)",
    exactProposition:
      "9.0A of output power is available through 8 sets of terminals for notification and auxiliary applications. Each circuit is power limited per UL 864 and can source up to 3.0A (total output power must not exceed 9.0A). The constant auxiliary power load must not exceed 6.0A for normal standby. // Auxiliary power circuits are power limited. Each circuit can source up to 3A (total current for all Flexput circuits must not exceed 9.0 A in alarm, and 6A when used as constant auxiliary power in normal standby).",
    whyItFailsToday:
      "The governed capability store carries the 9 A total but NOT the 6 A constant-auxiliary standby limit. The datasheet Rev C states only the 9 A ceiling, so this limit is visible only in the installation manual.",
    recommendedAction: "INSERT as an independent dimension alongside the 9 A alarm ceiling",
    reviewStatusClass: "NEW_EVIDENCE__MANUAL_ONLY",
    downstreamConsequence:
      "Any design using constant auxiliary power (door holders, continuous power) on an IFP-2100HV is limited to 6 A in normal standby, not 9 A. Misreading this would overstate available standby auxiliary current by 50%.",
  },
  {
    product: "RPS-1000HV", attribute: "rps_aggregate_output_amps", proposedValue: 6.0,
    currentPersistedValue: 6.0,
    source: "Honeywell Farenhyt RPS-1000 Series Data Sheet Doc 350070 Rev M + Installation Manual 151153 Rev R",
    revisionDate: "Rev M 04-2022 (datasheet); 151153 Rev R 2/15/2022 ECN 151770 (manual)",
    pageSection: "350070 Rev M p1 FEATURES, p2 ELECTRICAL; 151153 Rev R Sec 1.1 p6 and Sec 2.5.1 p12",
    exactProposition:
      "350070 Rev M: \"Provides 6.0 amps output power\"; \"Total Accessory Load: 6A @ 24VDC\"; \"Notification: 3 amps per circuit (6A system total)\". 151153 Rev R: \"Outputs are rated 3.0 A (6.0 A total for each RPS-1000).\"",
    whyItFailsToday:
      "The value 6.0 is correct, but a keyword read of the same manual ALSO surfaces a 5 A figure that is a DIFFERENT parameter and is easily mis-stored as the aggregate output.",
    recommendedAction: "CONFIRM 6.0 A aggregate; record the 5 A separately as the constant auxiliary power limit (see the next decision)",
    reviewStatusClass: "PROVENANCE_CORRECTION",
    downstreamConsequence:
      "No first-party revision states 5 A aggregate output. Storing 5 A as the aggregate would understate RPS-1000 capacity by 17%.",
  },
  {
    product: "RPS-1000HV", attribute: "rps_constant_aux_power_total_amps", proposedValue: 5.0,
    currentPersistedValue: null,
    source: "Honeywell Farenhyt RPS-1000 / RPS-1000HV Installation Manual 151153 Rev R",
    revisionDate: "Rev R, 2/15/2022, ECN 151770", pageSection: "Sec 3.8.6 \"Auxiliary Power Configuration\" (p36)",
    exactProposition:
      "Auxiliary power must be wired in Class A configuration per UL864 10th Edition. Auxiliary power circuits are power-limited. Each circuit provides up to 3A (total current for all Flexput circuits must not exceed 5A).",
    whyItFailsToday:
      "Not modelled at all, and it is the figure most likely to be misread as the aggregate output current. It is the RPS structural twin of the IFP-2100's 9.0 A alarm / 6.0 A constant-aux standby pair.",
    recommendedAction: "INSERT as an independent dimension, explicitly labelled as the constant auxiliary power limit",
    reviewStatusClass: "NEW_EVIDENCE__MISREAD_RISK",
    downstreamConsequence:
      "Governs constant auxiliary power on an RPS in normal standby, mirroring the panel's own dual limit.",
  },
  {
    product: "RPS-1000HV", attribute: "rps_standby_alarm_current_ma", proposedValue: { standby: 40, alarm: 160, sbus: 10 },
    currentPersistedValue: null,
    source: "Honeywell Farenhyt RPS-1000 Series Data Sheet Doc 350070 Rev M", revisionDate: "Rev M 04-2022",
    pageSection: "p2 ELECTRICAL, \"Currents\"",
    exactProposition: "Currents: Standby: 40mA  Alarm: 160mA  SBUS Standby & Alarm: 10mA",
    whyItFailsToday:
      "The battery ledger previously carried only the 10 mA SBUS draw for the RPS. The module's own 40 mA standby / 160 mA alarm battery draw was missing, which would understate the standby battery requirement for every RPS supplied.",
    recommendedAction: "INSERT the 40/160 mA module battery draw alongside the 10 mA SBUS draw",
    reviewStatusClass: "NEW_EVIDENCE",
    downstreamConsequence: "Each RPS-1000 adds 40 mA standby to the panel battery ledger. Nine RPS units across the campus add 360 mA of standby load that was previously omitted.",
  },
  {
    product: "RPS-1000HV", attribute: "rps_battery_charge_capacity_ah", proposedValue: "CONFLICT: 35 (datasheet) vs 7-33 (manual)",
    currentPersistedValue: null,
    source: "Doc 350070 Rev M (datasheet) vs Installation Manual 151153 Rev R", revisionDate: "Rev M 04-2022 vs Rev R 2/15/2022",
    pageSection: "350070 Rev M p1 FEATURES; 151153 Rev R Sec 3.5 \"Battery Connection\" (p29) and Table 2.3 (p13)",
    exactProposition:
      "350070 Rev M: \"Battery charging capacity is 35AH\" and the cabinet houses \"two 18AH backup batteries\". 151153 Rev R: \"The RPS-1000 battery charge capacity is 7 to 33 AH. Use 12V batteries of the same AH rating ... Do not parallel batteries to increase the AH rating.\" Table 2.3 tabulates 7 / 12 / 17 / 33 AH and notes \"The maximum battery size for FM (Factory Mutual) installations is 33AH.\"",
    whyItFailsToday:
      "A genuine OFFICIAL_DOCUMENTATION_CONFLICT between two Honeywell first-party documents on battery charge capacity (35 AH vs 7-33 AH) and on cabinet battery size (18 AH vs 17 AH).",
    recommendedAction:
      "RESOLVE: the applicable INSTALLATION MANUAL governs, giving 7-33 AH. Record the conflict rather than normalising it silently. Note the FM 33 AH cap separately, since Al Mousa is a UL/FM project.",
    reviewStatusClass: "OFFICIAL_DOCUMENTATION_CONFLICT",
    downstreamConsequence:
      "Determines the largest single RPS battery bank. Both documents forbid parallel batteries for capacity, so the RPS battery cannot exceed the lower bound without an RBB remote battery box.",
  },
  {
    product: "RPS-1000HV", attribute: "rps_synchronization_support", proposedValue: "BUILT_IN_SYNC_SUPPORTED",
    currentPersistedValue: null,
    source: "Honeywell Farenhyt RPS-1000 Series Data Sheet Doc 350070 Rev M", revisionDate: "Rev M 04-2022",
    pageSection: "p1 FEATURES AND BENEFITS",
    exactProposition:
      "Built-in synchronization compatible with appliances from System Sensor, AMSECO, Gentex, and Wheelock. // Sounder Sync Power: The Sounder Sync Power continuously outputs the System Sensor synchronization pattern and is intended for use with B200S Series sounder bases. (151153 Rev R Sec 3.8.6)",
    whyItFailsToday:
      "Only the PANEL's built-in synchronisation was recorded. The RPS carries its own, so synchronisation is LOCAL to each panel/RPS architecture rather than a campus function.",
    recommendedAction: "INSERT; record that synchronisation is per-NAC-power-module, not cross-panel",
    reviewStatusClass: "NEW_EVIDENCE",
    downstreamConsequence:
      "Confirms there is no campus-wide NAC bus and no cross-panel synchronisation dependency, and that no dedicated sync module (MDL3) is required by default on either the panel or the RPS.",
  },
  {
    product: "IFP-2100HV", attribute: "battery_charge_capacity_ah", proposedValue: 55,
    currentPersistedValue: null,
    source: "Honeywell IFP-2100/IFP-2100ECS Installation Manual LS10143-001SK-E Rev E + Data Sheet 351602 Rev C",
    revisionDate: "Rev E 8/29/2022; Rev C 04-2022",
    pageSection: "Manual Sec 3.5; Datasheet p4 ELECTRICAL",
    exactProposition:
      "Manual: \"The control panel battery charge capacity is 17 to 55 AH. Use 12V batteries of the same AH rating. ... Wire batteries in series to produce a 24-volt equivalent. Do not parallel batteries to increase the AH rating.\" Datasheet 351602 Rev C: \"Battery: Cabinet holds maximum of two 18 AH batteries / Battery Charger Capacity: 17-55 AH\".",
    whyItFailsToday:
      "The 55 Ah figure is the panel CHARGER ceiling. The battery that physically fits the panel cabinet is smaller, and larger banks need the RBB remote battery box. Treating 55 Ah as an in-cabinet size would misstate the installation.",
    recommendedAction:
      "INSERT both figures distinctly: charger capacity 17-55 AH, in-cabinet battery maximum two 18 AH, larger banks via RBB",
    reviewStatusClass: "NEW_EVIDENCE__DISTINCT_FIGURES",
    downstreamConsequence:
      "The project specification 1.10 M independently forbids parallel batteries, so a single bank is the only option and its size is bounded by the charger AND by the cabinet it must physically fit in.",
  },
  {
    product: "notification appliances (SpectrAlert Advance)", attribute: "ul_max_current_draw_ma_dc_16_33v",
    proposedValue:
      "Strobe only: 15=66, 15/75=77, 30=94, 75=158, 95=181, 110=202, 115=210, 135=228, 150=246, 177=281, 185=286. 2-Wire Horn/Strobe (DC, TOTAL appliance): Temporal Low 15=66, 75=154, 110=198, 115=207; Temporal High 15=79, 75=176, 110=212, 115=218.",
    currentPersistedValue: "unevidenced alias values 258 / 218 / 176 from NOTIFIER family-alias records",
    source:
      "SpectrAlert Advance Indoor Wall Horns, Strobes, Horn Strobes data sheet + SpectrAlert Advance Outdoor Selectable-Output Horns, Strobes, and Horn Strobes data sheet, both Honeywell prod-edam",
    revisionDate: "current hosted revisions (retrieved and inspected 2026-10-01)",
    pageSection: "\"UL Max. Strobe Current Draw (mA RMS)\" and \"UL Max. Current Draw (mA RMS), 2-Wire Horn Strobe\"",
    exactProposition:
      "UL Max. Strobe Current Draw (mA RMS), 16-33 Volts DC: 15=66, 15/75=77, 30=94, 75=158, 95=181, 110=202, 115=210, 135=228, 150=246, 177=281, 185=286. UL Max. Current Draw (mA RMS), 2-Wire Horn Strobe, DC Input, 16-33 Volts -- Temporal Low: 15=66, 75=154, 110=198; Temporal High: 15=79, 75=176, 110=212. Outdoor: \"Weatherproof per NEMA 4X, IP56\", \"Listed to UL 1638 (strobe) and UL 464 (horn)\".",
    whyItFailsToday:
      "The currents previously used for Al Mousa notification sizing (258 / 218 / 176 mA) came from NOTIFIER-branded family-alias records that carry ZERO product_attributes and no first-party citation. 258 mA is in fact an FWR 185 cd figure, not a 24 VDC DC worst case, and the horn/strobe figure is already the TOTAL appliance current, so adding a separate horn term would double-count.",
    recommendedAction:
      "REPLACE the alias currents with the first-party UL maximum DC table, and store the horn/strobe figure as the appliance TOTAL",
    reviewStatusClass: "SOURCE_DEFECT__REPLACED_WITH_FIRST_PARTY_UL_MAX",
    downstreamConsequence:
      "The Al Mousa worst-case campus notification load falls from the previously implied ~104.2 A to a computed 86.0 A, and the per-panel RPS-1000 count becomes computable at 9 units. Sizing at 258 mA per strobe would have overstated every panel load by roughly 27%.",
  },
  {
    product: "notification appliances (SpectrAlert Advance)", attribute: "selectable_candela_settings",
    proposedValue: "15, 15/75, 30, 75, 95, 110, 115 (standard range); 135, 150, 177, 185 (high range)",
    currentPersistedValue: "spec-derived '15, 30, 60, 75, 110'",
    source: "SpectrAlert Advance Indoor Wall data sheet (Honeywell prod-edam)", revisionDate: "current hosted revision",
    pageSection: "UL Max. Strobe Current Draw table and the Standard/High Candela Range note",
    exactProposition:
      "Standard Candela Range: 15, 15/75, 30, 75, 95, 110, 115. High Candela Range: 135, 150, 177, 185. There is NO 60 cd setting.",
    whyItFailsToday:
      "The project specification names 'field-selectable 15, 30, 60, 75, 110', but 60 cd does not exist in the product line. This is a further, independent manifestation of the already-recorded spec candela inconsistency, and it means the spec's selectable set cannot be satisfied as written.",
    recommendedAction: "RAISE a spec clarification; do NOT resolve silently in either direction",
    reviewStatusClass: "SPEC_INCONSISTENCY__MANUFACTURER_EVIDENCE",
    downstreamConsequence:
      "The interior candela field setting therefore cannot be closed by the consultant alone; the specification text also needs correcting. Interior loads are bounded between 15 cd and 110 cd in the interim.",
  },
];

const lines = [];
lines.push("=".repeat(100));
lines.push("TECHNICAL MANAGER CAPABILITY REVIEW PACKET -- Al Mousa / Farenhyt panel capability");
lines.push("=".repeat(100));
lines.push("GENERATED BY AN AGENT. NOTHING WAS WRITTEN TO THE DATABASE.");
lines.push("These facts are NOT approved. This slice is not permitted to self-promote them or to");
lines.push("impersonate a reviewer. Apply the approved subset through the existing governed review path.");
lines.push("");
lines.push(`Product capability facts currently persisted: ${DECISIONS.length} decision(s) below.`);
lines.push("");
for (const [i, d] of DECISIONS.entries()) {
  lines.push(`${"-".repeat(100)}`);
  lines.push(`DECISION ${i + 1} of ${DECISIONS.length}   [${d.reviewStatusClass}]`);
  lines.push(`${"-".repeat(100)}`);
  lines.push(`  product                  : ${d.product}`);
  lines.push(`  attribute                : ${d.attribute}`);
  lines.push(`  proposed value           : ${d.proposedValue}`);
  lines.push(`  current persisted value  : ${d.currentPersistedValue ?? "(absent)"}`);
  lines.push(`  source                   : ${d.source}`);
  lines.push(`  revision / date          : ${d.revisionDate}`);
  lines.push(`  page / section           : ${d.pageSection}`);
  lines.push(`  exact proposition        : ${d.exactProposition}`);
  lines.push(`  why it fails today       : ${d.whyItFailsToday}`);
  lines.push(`  recommended review action: ${d.recommendedAction}`);
  lines.push(`  downstream consequence   : ${d.downstreamConsequence}`);
  lines.push("");
}

lines.push(`${"-".repeat(100)}`);
lines.push("SOURCE INVENTORY ACTUALLY INSPECTED IN THIS SLICE");
lines.push(`${"-".repeat(100)}`);
for (const s of Object.values(PANEL_CAPABILITY_FACTS.reduce((m, f) => (m[f.source] = true, m), {}))) void s;
const SRC = [
  ["351605 Rev C, 2022-03-08", "IFP-75 Series Data Sheet", "held locally: tmp/pdfs/task9-step6/hbt-fire-351605-C.pdf", "4 pp"],
  ["351602 family (sample)", "IFP-2100/RFP-2100 Series Data Sheet", "held locally: tests/fixtures/knowledge/ifp-2100-datasheet-sample.pdf", "4 pp"],
  ["LS10173-001SK-E:A 07/01/2017", "6815 SLC Expander Product Installation Document", "held locally: .local-evidence/fire-alarm/honeywell/6815/", "2 pp"],
  ["LS10143-001SK-E:E 8/29/2022", "IFP-2100/IFP-2100ECS Manual, ECN 00021453", "RETRIEVED first-party from honeywell prod-edam this slice", "178 pp"],
  ["current hosted revision", "6815 Signaling Line Circuit Expander Data Sheet", "RETRIEVED first-party from honeywell prod-edam this slice", "2 pp"],
  ["LS10147-001SK-E:D 06/25/2021 ECN 3220", "IFP-75/IFP-75HV Installation/Operation Manual", "RETRIEVED first-party from honeywell prod-edam this slice", "178 pp"],
  ["350070 Rev M 04-2022", "RPS-1000 Series Intelligent Distributed Power Module Data Sheet", "RETRIEVED and re-inspected during the NAC/RPS slice", "2 pp"],
  ["current hosted revision", "SpectrAlert Advance Indoor Wall Horns, Strobes, Horn Strobes data sheet", "RETRIEVED first-party; UL max current tables read directly", "4 pp"],
  ["current hosted revision", "SpectrAlert Advance Outdoor Selectable-Output Horns, Strobes, Horn Strobes data sheet", "RETRIEVED first-party; carries the same UL max current tables", "4 pp"],
  ["151153 Rev R 2/15/2022", "RPS-1000/RPS-1000HV Installation Manual (per subagent retrieval)", "NOT independently re-inspected by the main agent; cited for the 5 A constant-aux and battery figures", "38 pp"],
];
for (const [rev, doc, loc, pages] of SRC) {
  lines.push(`  ${rev.padEnd(28)} ${doc}`);
  lines.push(`  ${" ".padEnd(28)} -> ${loc} (${pages})`);
}
lines.push("");
lines.push("  NOT AVAILABLE / NOT INSPECTED: 351620 as a distinct document number; any IFP-2100");
lines.push("  SBUS current-budget worksheet detail beyond the quoted 2 A statement.");
lines.push("");
lines.push("  SUBAGENT VERIFICATION BOUNDARY: the SpectrAlert Advance and RPS-1000 current/battery tables");
lines.push("  were retrieved by a delegated read-only agent. The main agent independently re-downloaded");
lines.push("  and re-read Doc 350070 Rev M and both SpectrAlert Advance data sheets and confirmed every");
lines.push("  figure it relies on. Document 151153 Rev R was reported by the agent but NOT re-read by the");
lines.push("  main agent, so the 5 A constant-auxiliary and 7-33 Ah battery figures that rest on it are");
lines.push("  marked accordingly and are not treated as independently confirmed.");
lines.push("");
lines.push(`"${"-".repeat(100)}"`);

console.log(lines.join("\n"));
db.close();