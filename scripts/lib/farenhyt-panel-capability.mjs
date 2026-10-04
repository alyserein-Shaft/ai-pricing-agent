// GOVERNED FARENHYT PANEL CAPABILITY (reusable; NOT Al-Mousa specific).
//
// WHY THIS EXISTS
// ---------------
// A previous right-sizing pass recorded IFP-75HV as
// `expansion = NONE_IN_GOVERNED_EVIDENCE` and then treated that absence as
// technical INADMISSIBILITY for every multi-loop panel. That conflated two
// very different things:
//
//   NO GOVERNED EVIDENCE FOUND   !=   MANUFACTURER DOES NOT SUPPORT
//
// A knowledge gap must never silently reject a technically valid product, and
// it must never silently admit one either. So expansion capability is modelled
// as an explicit three-state fact with its own provenance:
//
//   EXPANSION_SUPPORTED                       manufacturer lists the expander
//   EXPANSION_NOT_SUPPORTED                   manufacturer states no path
//   EXPANSION_CAPABILITY_UNKNOWN              no evidence either way
//
// and, when supported, a SEPARATE independent question about how many:
//
//   MAXIMUM_EXPANSION_COUNT_PROVEN / _NOT_YET_PROVEN
//
// Those are different facts with different confidence. Collapsing them is how a
// panel gets sized with hardware it cannot hold, or rejected for hardware it
// can.
//
// All capability is READ from the governed product knowledge tables. Nothing
// here is Al-Mousa specific and nothing is hard-coded per project.

export const EXPANSION_STATE = Object.freeze({
  SUPPORTED: "EXPANSION_SUPPORTED",
  NOT_SUPPORTED: "EXPANSION_NOT_SUPPORTED",
  UNKNOWN: "EXPANSION_CAPABILITY_UNKNOWN",
  // A first-party source affirms compatibility at a level broad enough to
  // include this panel, while another first-party source for the panel itself
  // states otherwise. This is NOT the same as UNKNOWN, and NOT the same as
  // NOT_SUPPORTED. It is a documented disagreement.
  OFFICIAL_DOCUMENTATION_CONFLICT: "OFFICIAL_DOCUMENTATION_CONFLICT",
});

export const MAXIMUM_STATE = Object.freeze({
  PROVEN: "MAXIMUM_EXPANSION_COUNT_PROVEN",
  NOT_YET_PROVEN: "MAXIMUM_EXPANSION_COUNT_NOT_YET_PROVEN",
});

/**
 * First-party source register. This is MANUFACTURER KNOWLEDGE, keyed by part
 * number, and is reusable by any Farenhyt project. `authority` and `revision`
 * travel with every fact so a downstream reader can always see where a number
 * came from and how old it is.
 */
export const MANUFACTURER_SOURCES = Object.freeze({
  "IFP-75_DS": Object.freeze({
    key: "IFP-75_DS",
    partNumbers: ["IFP-75", "IFP-75B", "IFP-75HV", "IFP-75HVB"],
    document: "Honeywell Farenhyt IFP-75 Series Intelligent Fire Alarm Control Panel with Communicator",
    reference: "351605 Rev C, 3/8/2022",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351605-C.pdf",
    authority: "OFFICIAL_MANUFACTURER",
  }),
  "IFP-2100_DS": Object.freeze({
    key: "IFP-2100_DS",
    partNumbers: ["IFP-2100", "IFP-2100B", "IFP-2100HV", "IFP-2100HVB", "IFP-2100ECS", "IFP-2100ECSHV"],
    document: "Honeywell Farenhyt IFP-2100 / IFP-2100B / RFP-2100 Addressable Fire Alarm Control Panel",
    reference: "351602 Rev C, 04-2022",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351602-C.pdf",
    authority: "OFFICIAL_MANUFACTURER",
  }),
  "IFP-75_MANUAL": Object.freeze({
    key: "IFP-75_MANUAL",
    partNumbers: ["IFP-75", "IFP-75B", "IFP-75HV", "IFP-75HVB"],
    document: "Honeywell Farenhyt IFP-75/IFP-75HV Addressable Fire Alarm Control Panel Installation/Operation Manual",
    reference: "LS10147-001SK-E Rev D, 06/25/2021, ECN 3220",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/moved-ss/IFP-75-Manual.pdf",
    authority: "OFFICIAL_MANUFACTURER",
  }),
  "IFP-2100_ECS_6815_DS": Object.freeze({
    key: "IFP-2100_ECS_6815_DS",
    partNumbers: ["6815", "5815RMK", "5815RMKB", "SK-NIC-KIT", "RPS-1000", "RPS-1000HV", "IFP-2100", "IFP-2100HV"],
    document: "Honeywell Farenhyt 6815 Signaling Line Circuit Expander Data Sheet",
    reference: "current Honeywell-hosted revision (retrieved and inspected 2026-10-01)",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-6815_Datasheet.pdf",
    authority: "OFFICIAL_MANUFACTURER",
  }),
  "IFP-2100_MANUAL": Object.freeze({
    key: "IFP-2100_MANUAL",
    partNumbers: ["IFP-2100", "IFP-2100HV", "IFP-2100ECS", "IFP-2100ECSHV", "6815", "5815XL", "5815RMK"],
    document: "Honeywell Farenhyt IFP-2100/IFP-2100ECS Addressable Fire Alarm Control Panel Manual",
    reference: "LS10143-001SK-E Rev E, 8/29/2022",
    url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/Hbt-Fire-Hbt-Fire-Ls10143-001sk-E-E-Ifp-2100.pdf",
    authority: "OFFICIAL_MANUFACTURER",
  }),
});

/**
 * Capability facts to persist. Each carries the ORIGINAL manufacturer wording,
 * the normalized value, and which source establishes it -- so a reviewer can
 * audit the normalization instead of trusting it.
 *
 * `authority` is deliberately the publisher, never this project's opinion.
 */
export const PANEL_CAPABILITY_FACTS = Object.freeze([
  // ---- IFP-75 family (351605 Rev C) ----------------------------------------
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "slc_loop_count", value: 1, original: "Intelligent Signaling Line Circuits: 1" },
  // IFP-75HV: the IFP-75 datasheet (B) states SLC circuits: 1 with no
  // "(expandable)" qualifier, while the 6815's own installation document (A)
  // claims "Farenhyt Series" compatibility while enumerating nothing. The two
  // first-party sources disagree, so this is a CONFLICT -- not a settled
  // NOT_SUPPORTED, and not a silent absence of evidence.
  { partNumber: "IFP-75HV", source: "IFP-75_MANUAL", attribute: "ifp75_manual_6815_mentions", value: 0, original: "IFP-75/IFP-75HV Installation/Operation Manual LS10147-001SK-E Rev D 06/25/2021 ECN 3220 (178 pp): full-text search returns ZERO occurrences of '6815', ZERO of '5815', ZERO of 'SLC expander', ZERO of 'expansion'. The manual therefore contains NO 6815 installation section, NO 6815 programming section, NO supported SLC-expansion architecture, NO maximum expansion count and NO 6815 cabinet-mounting instruction. Presence in a current-draw worksheet cannot even be tested because 6815 does not appear at all." },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "slc_expansion_state", value: EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT, original: "CONFLICT: (A) LS10173-001SK-E:A §1.2 'The 6815 is for use with compatible Honeywell Silent Knight and Farenhyt Series Fire Alarm Control Panels FACP's:' -- affirmative, series-level, colon with NO model ever enumerated, §1.4 defers to the FACP installation manual. (B) 351605:C SYSTEM CAPACITY 'Intelligent Signaling Line Circuits: 1' -- no '(expandable)' qualifier, and SYSTEM EXPANDERS lists only RPS-1000 and 5496, both POWER/NAC expanders; '6815'/'5815'/'RMK' appear ZERO times. Neither document has been reconciled by a Honeywell erratum." },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "slc_expansion_max_count", value: null, original: "NOT YET PROVEN: a maximum cannot be stated while the IFP-75/6815 compatibility state itself is conflicted" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "slc_expansion_max_state", value: MAXIMUM_STATE.NOT_YET_PROVEN, original: "blocked by OFFICIAL_DOCUMENTATION_CONFLICT on slc_expansion_state" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "slc_expansion_authority", value: "NOT_CONFIRMED", original: "NEW_PROJECT_SELECTION_AUTHORITY = NOT_CONFIRMED; an authoritative CURRENT compatibility source explicitly naming the IFP-75 is required before any expansion selection" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "panel_point_capacity_idp_sk", value: 150, original: "The total point capacity for IDP and SK devices is a maximum of 150 points per panel" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "panel_point_capacity_sd", value: 75, original: "Using SD devices, the total point capacity is a maximum of 75 points per panel" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "detectors_per_loop", value: 75, original: "75 System Sensor IDP/SK sensors ... per loop" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "modules_per_loop", value: 75, original: "75 IDP/SK modules ... per loop" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "flexput_circuits", value: 2, original: "Output circuits: 2 (expandable)" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "flexput_circuits_class_a", value: 1, original: "Terminal block provides connections for (two Class B or one Class A) NACs or auxiliary power" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "nac_current_per_circuit_amps", value: 1, original: "Maximum current per circuit: 1 A @ 27.4 VDC" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "panel_total_output_amps", value: 2.5, original: "Total Power Output: 2.5 A max @27.4 VDC" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "network_panel_limit", value: 32, original: "Network support for up to 32 sites" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "sbus_device_limit", value: 16, original: "SBUS Devices: 16 (8 annunciators, 8 LED modules)" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "battery_capacity_ah", value: 14, original: "Battery: Cabinet holds maximum of two 7 AH batteries" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "listing", value: "UL 864 10th Edition", original: "Complies with UL 864 10th Edition" },
  { partNumber: "IFP-75HV", source: "IFP-75_DS", attribute: "ac_input", value: "240 VAC, 50/60 Hz, 1A", original: "AC Power: 120 VAC, 60 Hz, 1.5 A (IFP-75, IFP-75B), 240 VAC, 50/60 Hz, 1A (IFP-75HV, IFP-75HVB)" },

  // ---- IFP-2100 family (351602 Rev C + manual LS10143-001SK-E Rev E) ------
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "slc_loop_count", value: 1, original: "Intelligent Signaling Line Circuits: 1 (expandable)" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "slc_expansion_state", value: EXPANSION_STATE.SUPPORTED, original: "6815: SLC Expander for IDP and SK devices -- listed under SYSTEM EXPANDERS" },
  // ---- IFP-2100 expansion semantics: THREE INDEPENDENT DIMENSIONS ----------
  // A physical/SBUS expander limit is NOT the same concept as a system point
  // ceiling, and neither is a fully-populated loop equivalent. The previous
  // model collapsed them into a single "slc_expansion_max_count = 12", which was
  // derived as 2100/159 = 13 loops = 1 in-build + 12 expanders. That derivation
  // has NO first-party support: LS10143-001SK-E Rev E states only "The number
  // of 6815s is limited by the maximum number of SBUS devices" and never states
  // 12; its 71 occurrences of "12" are section and page numbers. The 6815
  // datasheet states the real figure.
  { partNumber: "IFP-2100HV", source: "IFP-2100_ECS_6815_DS", attribute: "max_sbus_6815_expanders", value: 63, original: "SYSTEM CAPACITY: IFP-2100/ECS FACP supports 63 6815s (but a maximum of 2100 SLC devices per system) -- Honeywell Farenhyt 6815 Signaling Line Circuit Expander Data Sheet" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_MANUAL", attribute: "sbus_device_capacity", value: 63, original: "The system supports a maximum of 63 SBUS devices in any combination. / SBUS devices on a panel are addressed from 1 to 63 ... the actual number is limited by current draw and SBUS bandwidth usage -- LS10143-001SK-E Rev E 8/29/2022 Sec 1.1.1 and 4.16.1" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_MANUAL", attribute: "max_system_slc_points_idp_sk", value: 2100, original: "The maximum number of IDP or SK SLC devices per panel is 2,100. -- LS10143-001SK-E Rev E 8/29/2022 Sec 4.12" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_ECS_6815_DS", attribute: "full_populated_loop_equivalent_at_system_ceiling", value: 13, original: "DERIVED, NOT A MANUFACTURER LIMIT: 2100 system points / 159 points per loop = 13 loop-equivalents (1 in-build + 12 further loops). This is a POINT-CAPACITY arithmetic consequence and must never be read as a maximum physical 6815 count." },
  { partNumber: "IFP-2100HV", source: "IFP-2100_ECS_6815_DS", attribute: "slc_expansion_max_count", value: 63, original: "CORRECTED 2026-10-01 from 12. Prior value 12 was derived from 2100/159 and had no first-party proposition. First-party, 6815 Data Sheet SYSTEM CAPACITY: 'IFP-2100/ECS FACP supports 63 6815s (but a maximum of 2100 SLC devices per system)'. Corroborated by LS10143-001SK-E Rev E Sec 4.12: 'The number of 6815s is limited by the maximum number of SBUS devices.'" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_ECS_6815_DS", attribute: "slc_expansion_max_state", value: MAXIMUM_STATE.PROVEN, original: "PROVEN, and NOT from point arithmetic: the 6815 Data Sheet states \"IFP-2100/ECS FACP supports 63 6815s (but a maximum of 2100 SLC devices per system)\" and LS10143-001SK-E Rev E states \"The number of 6815s is limited by the maximum number of SBUS devices\". The expander maximum is bounded by SBUS (63 addresses), NOT by 2100 points / 159 per loop." },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "panel_point_capacity_idp_sk", value: 2100, original: "Addressable device capacity: 2100 (IDP/SK)" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "panel_point_capacity_sd", value: 2032, original: "or 2032 (SD)" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "detectors_per_loop", value: 159, original: "159 System Sensor IDP/SK sensors ... per loop" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "modules_per_loop", value: 159, original: "159 IDP/SK modules ... per loop" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "flexput_circuits", value: 8, original: "Output circuits: 8 (expandable)" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "flexput_circuits_class_a", value: 4, original: "Terminal block provides connections for (eight Class B or four Class A) NACs or auxiliary power" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "nac_current_per_circuit_amps", value: 3, original: "Maximum current per circuit: 3 A" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "panel_total_output_amps", value: 9, original: "Cannot exceed 9A total for all circuits" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "network_panel_limit", value: 32, original: "up to thirty-two IFP-2100 panels connected" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_MANUAL", attribute: "sbus_device_limit", value: 63, original: "The system supports a maximum of 63 SBUS devices in any combination" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "battery_capacity_ah", value: 36, original: "Battery: Cabinet holds maximum of two 18 AH batteries" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "listing", value: "UL Listing", original: "UL Listing; CSFM (pending)" },
  { partNumber: "IFP-2100HV", source: "IFP-2100_DS", attribute: "ac_input", value: "240VAC, 50/60Hz, 2.8A", original: "AC Power: 120 VAC, 60 Hz, 5A or 240VAC, 50/60Hz, 2.8A" },

  // ---- 6815 SLC expander ---------------------------------------------------
  { partNumber: "6815", source: "IFP-2100_MANUAL", attribute: "device_role", value: "SLC_EXPANDER", original: "6815 SLC EXPANDER -- Each 6815 supports up to 159 IDP/SK sensors and 159 IDP/SK modules" },
  { partNumber: "6815", source: "IFP-2100_MANUAL", attribute: "detectors_per_loop", value: 159, original: "Each 6815 supports up to 159 IDP/SK sensors" },
  { partNumber: "6815", source: "IFP-2100_MANUAL", attribute: "modules_per_loop", value: 159, original: "and 159 IDP/SK modules" },
  { partNumber: "6815", source: "IFP-2100_ECS_6815_DS", attribute: "permissible_mounting", value: "compatible FACP cabinet; 5895XL cabinet; RPS-1000 cabinet; 5815RMK remote mounting kit; SK-NIC-KIT remote mounting kit", original: "You can mount the 6815 in a compatible FACP cabinet, in the 5895XL or RPS-1000 intelligent power module cabinet, or in the SK-NIC-KIT remote mounting kit. / If mounting the 6815 in a 5815RMK or SK-NIC-KIT orientate the 6815 board(s) as shown in Figure 1.1 -- LS10173-001SK-E:A 07/01/2017 Sec 1.4" },
  // Mounting capacity per ENCLOSURE. An expansion REQUIREMENT is a different
  // concept: the BOM allocator must consume these in-enclosure slots FIRST and
  // only then compute remote 5815RMK demand.
  { partNumber: "IFP-2100HV", source: "IFP-2100_ECS_6815_DS", attribute: "mounting_capacity_6815_in_panel_cabinet", value: 2, original: "House up to two 6815s in the IFP-2100/ECS, RFP-2100, IFP-300/ECS, RPS-1000 ... -- 6815 Data Sheet FEATURES & BENEFITS" },
  { partNumber: "RPS-1000HV", source: "IFP-2100_ECS_6815_DS", attribute: "mounting_capacity_6815_in_enclosure", value: 2, original: "RPS-1000: Intelligent Power Module. Cabinet holds two 6815s. -- 6815 Data Sheet ACCESSORIES" },
  { partNumber: "5815RMK", source: "IFP-2100_ECS_6815_DS", attribute: "mounting_capacity_6815_in_enclosure", value: 2, original: "5815RMK: Remote Mounting Kit Cabinet holds two 6815s. Red cabinet / 5815RMKB: ... Black cabinet. -- 6815 Data Sheet ACCESSORIES" },
  { partNumber: "SK-NIC-KIT", source: "IFP-2100_ECS_6815_DS", attribute: "mounting_capacity_6815_in_enclosure", value: 1, original: "SK-NIC-KIT: Remote Mounting Kit Cabinet. holds one 6815. -- 6815 Data Sheet ACCESSORIES" },
  { partNumber: "6815", source: "IFP-2100_ECS_6815_DS", attribute: "compatible_panel_families_enumerated", value: ["IFP-2100/ECS", "IFP-2100/ECSB", "RFP-2100", "RFP-2100B", "IFP-300/ECS", "FP-300/ECSB"], original: "Compatibility: The 6815 is compatible with the following Farenhyt Series FACP's: IFP-2100/ECS; IFP-2100/ECSB; RFP-2100; RFP-2100B; IFP-300/ECS; FP-300/ECSB -- 6815 Data Sheet. IFP-75 is NOT among the enumerated models." },
  { partNumber: "6815", source: "IFP-2100_MANUAL", attribute: "protocol_scope", value: "IDP/SK_ONLY", original: "The 6815 supports System Sensor (IDP/SK) devices only" },
  { partNumber: "6815", source: "IFP-2100_MANUAL", attribute: "worst_case_current_draw_amps", value: 0.078, original: "6815 SLC Loop Expander -- Worst Case Current Draw 0.078 amps" },

  // ---- 5815RMK remote mounting kit ----------------------------------------
  { partNumber: "5815RMK", source: "IFP-2100_MANUAL", attribute: "device_role", value: "REMOTE_MOUNTING_KIT", original: "the 5815RMK remote mounting kit" },
  { partNumber: "5815RMK", source: "IFP-2100_MANUAL", attribute: "loop_cards_per_kit", value: 2, original: "005815RMK -- Remote mounting Kit which accommodates 2 SLC Cards (6815)" },

  // ---- RPS-1000HV ---------------------------------------------------------
  { partNumber: "RPS-1000HV", source: "IFP-2100_DS", attribute: "device_role", value: "POWER_SUPPLY", original: "RPS-1000(HV): 6A power supply with six Flexput circuits and two Form C relays" },
  { partNumber: "RPS-1000HV", source: "IFP-2100_DS", attribute: "output_amps", value: 6, original: "6A power supply" },
  { partNumber: "RPS-1000HV", source: "IFP-2100_DS", attribute: "flexput_circuits", value: 6, original: "with six Flexput circuits" },
  { partNumber: "RPS-1000HV", source: "IFP-2100_MANUAL", attribute: "permissible_mounting", value: "RPS-1000 cabinet", original: "provides additional power, six Flexput circuits, and two Form C relays" },

  // ---- SK-NIC -------------------------------------------------------------
  { partNumber: "SK-NIC", source: "IFP-2100_MANUAL", attribute: "device_role", value: "NETWORK_INTERFACE_CARD", original: "SK-NIC Network Interface Card -- 0.021 amps worst case" },
  { partNumber: "SK-NIC", source: "IFP-2100_MANUAL", attribute: "worst_case_current_draw_amps", value: 0.021, original: "SK-NIC Network Interface Card 0.021 amps" },
]);

/**
 * ELECTRICAL FAMILY grouping. A cabinet colour is not a different panel.
 *
 * The IFP-75 datasheet states the whole range in one sentence -- "The IFP-75
 * and IFP-75HV (red) and the IFP-75B and IFP-75HVB (black)" -- and the ordering
 * block defines "IFP-75HV: same as IFP-75 but with 240VAC input" and "IFP-75HVB:
 * same as IFP-75B but with 240VAC input". So the family shares one capability
 * set, and the variants differ only in cabinet colour and AC input.
 *
 * Without this, a colour variant with no attributes of its own reads as a
 * distinct panel with UNKNOWN capability, which would flood the candidate list
 * with phantom panels and make every one of them "unproven" -- an artefact of
 * the library's shape, not a real engineering state.
 */
export const PANEL_ELECTRICAL_FAMILY = Object.freeze({
  "IFP-75": Object.freeze({ family: "IFP-75", variants: ["IFP-75", "IFP-75B", "IFP-75HV", "IFP-75HVB"], referencePart: "IFP-75HV", original: "The IFP-75 and IFP-75HV (red) and the IFP-75B and the IFP-75HVB (black) are ... direct replacements for the IFP-50 FACP" }),
  "IFP-2100": Object.freeze({ family: "IFP-2100", variants: ["IFP-2100", "IFP-2100B", "IFP-2100HV", "IFP-2100HVB", "IFP-2100ECS", "IFP-2100ECSHV", "IFP-2100ECSHVB"], referencePart: "IFP-2100HV", original: "IFP-2100HV: Farenhyt 2100 point Addressable Fire Panel" }),
});

/** The electrical family a part number belongs to, or null. */
export function familyFor(partNumber) {
  for (const entry of Object.values(PANEL_ELECTRICAL_FAMILY)) {
    if (entry.variants.includes(partNumber)) return entry.family;
  }
  return null;
}

/**
 * IFP-75 / 6815 FIRST-PARTY DOCUMENTATION CONFLICT.
 *
 * Sources, all official Honeywell:
 *
 *  A. 6815 SLC Expander, Product Installation Document LS10173-001SK-E Rev A
 *     (07/01/2017), §1.2 Compatibility, verbatim:
 *       "The 6815 is for use with compatible Honeywell Silent Knight and
 *        Farenhyt Series Fire Alarm Control Panels FACP's:"
 *     The sentence ends in a COLON and the document then proceeds directly to
 *     §1.3 Specifications -- no panel model is ever enumerated. "Farenhyt
 *     Series" includes the IFP-75 line. §1.4 NOTE: "For compatibility,
 *     programming and more information see FACP installation manual."
 *
 *  B. IFP-75 Series datasheet 351605 Rev C (3/8/2022):
 *     "Intelligent Signaling Line Circuits: 1" -- printed WITHOUT the
 *     "(expandable)" qualifier that IFP-2100 carries -- and a SYSTEM EXPANDERS
 *     list containing only RPS-1000 and 5496, both POWER/NAC expanders. No SLC
 *     expander is listed, and "6815"/"5815"/"RMK" appear zero times.
 *
 *  C. IFP-2100 Series datasheet 351602 Rev C (04-2022):
 *     "Intelligent Signaling Line Circuits: 1 (expandable)" and
 *     "6815: SLC Expander for IDP and SK devices".
 *
 *  D. IFP-2100/IFP-2100ECS Installation Manual LS10143-001SK-E Rev E
 *     (8/29/2022), §4.12: "Mount the 6815 in the IFP-2100 cabinet, the
 *     RPS-1000 cabinet, or the 5815RMK remote mounting kit." -- names IFP-2100
 *     specifically and does not mention the IFP-75.
 *
 * WHY THIS IS A CONFLICT AND NOT MERELY A KNOWLEDGE GAP
 * ---------------------------------------------------
 * A is affirmative and series-level. It is not silent about the 6815: it names
 * the Farenhyt Series as a compatible family. B and D are model-specific and
 * exclude IFP-75. A therefore contradicts B/D on their face.
 *
 * WHY IT IS NEVER RESOLVED SILENTLY HERE
 * --------------------------------------
 * A itself defers authority to the panel's own installation manual, which on
 * that rule points at B/D. That deference is a REASON to prefer B/D, not proof
 * that no Honeywell erratum reconciles them, and no such erratum was located.
 * Resolving this by document preference would be exactly the silent collapse
 * this slice is forbidden to perform.
 *
 * CONSEQUENCE FOR PROCUREMENT
 * --------------------------
 * A conflicted state may not authorise expansion hardware. Until an
 * authoritative CURRENT compatibility source explicitly permits 6815 on the
 * IFP-75, right-sizing must not select IFP-75 expansion hardware -- but it must
 * equally not record a global manufacturer fact that the IFP-75 can never take
 * a 6815.
 */
export const IFP75_6815_CONFLICT = Object.freeze({
  subject: "IFP-75 / IFP-75HV SLC expansion via 6815",
  state: EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT,
  newProjectSelectionAuthority: "NOT_CONFIRMED",
  sources: [
    { key: "A", reference: "LS10173-001SK-E Rev A (07/01/2017) §1.2/§1.4", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/LS10173-001SK-E_Manual_6815.pdf", authority: "OFFICIAL_MANUFACTURER", direction: "AFFIRMS", text: "The 6815 is for use with compatible Honeywell Silent Knight and Farenhyt Series Fire Alarm Control Panels FACP's:", caveat: "the sentence ends in a colon and NO panel model is ever enumerated; §1.4 defers to the FACP installation manual" },
    { key: "B", reference: "351605 Rev C (3/8/2022), SYSTEM CAPACITY + SYSTEM EXPANDERS", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351605-C.pdf", authority: "OFFICIAL_MANUFACTURER", direction: "DENIES", text: "Intelligent Signaling Line Circuits: 1", caveat: "printed without the '(expandable)' qualifier IFP-2100 carries; zero occurrences of 6815/5815/RMK" },
    { key: "C", reference: "351602 Rev C (04-2022), SYSTEM EXPANDERS", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351602-C.pdf", authority: "OFFICIAL_MANUFACTURER", direction: "AFFIRMS_FOR_IFP2100", text: "6815: SLC Expander for IDP and SK devices", caveat: "scope is the IFP-2100 datasheet, not the IFP-75" },
    { key: "D", reference: "LS10143-001SK-E Rev E (8/29/2022) §4.12", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/Hbt-Fire-Hbt-Fire-Ls10143-001sk-E-E-Ifp-2100.pdf", authority: "OFFICIAL_MANUFACTURER", direction: "DENIES_FOR_IFP75", text: "Mount the 6815 in the IFP-2100 cabinet, the RPS-1000 cabinet, or the 5815RMK remote mounting kit.", caveat: "names IFP-2100 specifically; the IFP-75 is not mentioned" },
  ],
  permittedConclusions: [
    "the IFP-75 may not be expanded with 6815 hardware on CURRENT evidence",
    "a global manufacturer fact 'IFP-75 can never support 6815' is NOT established",
  ],
  forbiddenConclusions: [
    "silently prefer one document and record the other as absent",
    "record NOT_SUPPORTED as settled while source A affirmatively claims Farenhyt Series compatibility",
    "authorise 6815 procurement on IFP-75 while the state is conflicted",
  ],
  resolutionRequires: "an authoritative current Honeywell compatibility statement explicitly naming the IFP-75, or a panel-manual revision reconciling 351605 Rev C",
});

/**
 * Heterogeneous panel interop. First-party statement that a network may be
 * built from ANY COMBINATION of these models -- which is exactly why one panel
 * model must never be forced campus-wide.
 */
export const NETWORK_INTEROP_MODELS = Object.freeze([
  "IFP-75", "IFP-300", "IFP-300ECS", "IFP-2100", "IFP-2100ECS", "RFP-2100", "IFP-200", "IFP-2000ECS",
]);

/**
 * Duct-housing nuance, recorded as a compatibility NOTE and deliberately NOT as
 * a selection change.
 *
 * The manufacturer's own accessory listing bundles the DNR/DNRW housings with
 * the IDP-PHOTO-**R** sensors: "DNR/DNRW (non-relay) -- None, included with
 * IDP-PHOTO-R/-W/-IV". That establishes the R-variant as the bundled pairing.
 *
 * It does NOT establish that a non-R IDP-PHOTO can never be used with a DNR
 * housing, because this document is an accessory/CURRENT-DRAW listing and says
 * nothing about exclusivity. Encoding exclusivity here would promote a
 * convenience into a prohibition, so it is recorded as a nuance with both the
 * supporting text and its limits.
 */
export const DUCT_COMPATIBILITY_NOTE = Object.freeze({
  subject: "IDP-PHOTO vs IDP-PHOTO-R in a DNR/DNRW duct housing",
  source: "IFP-2100_MANUAL",
  original: "DNR/DNRW (non-relay) None, included with IDP-PHOTO-R/-W/-IV",
  establishes: "the manufacturer bundles DNR/DNRW with the IDP-PHOTO-R variants",
  doesNotEstablish: "that IDP-PHOTO is INCOMPATIBLE with DNR/DNRW -- the listing states no exclusivity",
  status: "COMPATIBILITY_NUANCE_RECORDED",
  selectionImpact: "NONE_IN_THIS_SLICE",
  forbiddenConclusion: "IDP-PHOTO can never be used with DNR",
});

/**
 * Read a capability bundle for one part number from governed product
 * attributes. Returns null for a value that is genuinely absent -- never 0.
 */


// CANONICAL GOVERNED NAME ALIASES.
//
// The governed promotion path writes the canonical capacity attributes
// (`max_detectors_per_loop`, `max_modules_per_loop`, `max_system_points` -- see
// `app/domain/knowledge-promotion-policy.mjs` HUMAN_CAPACITY_ATTRIBUTES and the
// Path A consumer `worker/fire-alarm-panel-sizing-api.mjs:221-224`). This path
// historically read the older `*_per_loop` names, which governed promotion never
// writes.
//
// The consequence was measured, not theoretical: IFP-2100HV carried Approved
// `max_detectors_per_loop=159` and `max_modules_per_loop=159`, and this path
// still resolved `detectorsPerLoop: null`, so right-sizing emitted
// "detectors per loop not established for IFP-2100HV" and produced
// RIGHT_SIZE_CANDIDATE_AVAILABLE__DEMAND_NOT_PROVEN no matter how complete the
// capacity evidence became.
//
// This is a vocabulary resolution, NOT a change to any sizing formula: the
// canonical value is preferred, the legacy name is still accepted, and the two
// detector/module pools stay SEPARATE (they are distinct manufacturer claims --
// 159 detectors AND 159 modules -- and are never summed into one device count).
const CAPACITY_ATTRIBUTE_ALIASES = Object.freeze({
  detectors_per_loop: "max_detectors_per_loop",
  modules_per_loop: "max_modules_per_loop",
  panel_point_capacity_idp_sk: "max_system_points",
});

export function capabilityFromAttributes(rows) {
  const map = new Map();
  for (const r of rows) map.set(r.attribute_name, r);
  const num = (name) => {
    // Prefer the canonical governed attribute; fall back to the legacy name so
    // nothing that resolved before stops resolving.
    const canonical = CAPACITY_ATTRIBUTE_ALIASES[name];
    const r = map.get(name) ?? (canonical ? map.get(canonical) : undefined);
    if (!r) return null;
    const v = Number(r.normalized_value);
    return Number.isFinite(v) ? v : null;
  };
  // Enumerated model lists are stored as JSON arrays. A list is never coerced to
  // a number and never used as a capacity.
  const list = (name) => {
    const r = map.get(name);
    if (!r) return null;
    try {
      const parsed = JSON.parse(r.normalized_value);
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  };
  const str = (name) => map.get(name)?.normalized_value ?? null;
  const expansion = str("slc_expansion_state");
  const maxCount = num("slc_expansion_max_count");
  const maxState = str("slc_expansion_max_state") ?? (maxCount === null ? null : MAXIMUM_STATE.PROVEN);
  return {
    partNumber: str("part_number") ?? null,
    slcLoopsInBuild: num("slc_loop_count"),
    expansionState: expansion,
    expansionMaxCount: maxCount,
    expansionMaxState: maxState,
    panelPointCapacityIdpSk: num("panel_point_capacity_idp_sk"),
    detectorsPerLoop: num("detectors_per_loop"),
    modulesPerLoop: num("modules_per_loop"),
    flexputCircuits: num("flexput_circuits"),
    flexputCircuitsClassA: num("flexput_circuits_class_a"),
    nacCurrentPerCircuitAmps: num("nac_current_per_circuit_amps"),
    panelTotalOutputAmps: num("panel_total_output_amps"),
    networkPanelLimit: num("network_panel_limit"),
    sbusDeviceLimit: num("sbus_device_limit"),
    // Independent expansion dimensions -- deliberately NOT collapsed.
    sbusDeviceCapacity: num("sbus_device_capacity"),
    maxSbus6815Expanders: num("max_sbus_6815_expanders"),
    maxSystemSlcPointsIdpSk: num("max_system_slc_points_idp_sk"),
    fullPopulatedLoopEquivalent: num("full_populated_loop_equivalent_at_system_ceiling"),
    mountingCapacityInPanelCabinet: num("mounting_capacity_6815_in_panel_cabinet"),
    mountingCapacityInEnclosure: num("mounting_capacity_6815_in_enclosure"),
    compatiblePanelFamiliesEnumerated: list("compatible_panel_families_enumerated"),
    batteryCapacityAh: num("battery_capacity_ah"),
    listing: str("listing"),
    acInput: str("ac_input"),
    // Fields genuinely not established by the documents read.
    unknown: [],
  };
}

/**
 * Decide whether a panel family can host a drawn loop requirement.
 *
 * THE CORRECTED RULE. The previous pass wrote:
 *     if (!cap.expansionMethod && drawnLoops > cap.loopsInBuild) -> reject
 * which turned "we have no evidence" into "the manufacturer does not support".
 *
 * Correct semantics:
 *   EXPANSION_NOT_SUPPORTED  and drawnLoops > in-build -> INADMISSIBLE
 *   EXPANSION_UNKNOWN        and drawnLoops > in-build -> UNPROVEN (NOT a rejection)
 *   EXPANSION_SUPPORTED                               -> admissible, then check the maximum
 */
export function loopAdmissibility({ capability, drawnLoops }) {
  const inBuild = capability.slcLoopsInBuild;
  if (!Number.isInteger(drawnLoops)) {
    return { state: "LOOP_REQUIREMENT_UNKNOWN", admissible: null, reason: "the drawn loop requirement for this panel is not known" };
  }
  if (drawnLoops <= inBuild) {
    return { state: "WITHIN_IN_BUILD_CAPACITY", admissible: true, additionalLoops: 0, reason: `${drawnLoops} loop(s) fit the ${inBuild} in-build SLC` };
  }
  const state = capability.expansionState;
  if (state === EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT) {
    // A conflicted state may not authorise procurement, and may not be
    // recorded as a settled technical exclusion either.
    return {
      state: "CONFLICTED_NO_PROCUREMENT_AUTHORITY",
      admissible: null,
      additionalLoops: drawnLoops - inBuild,
      reason: "first-party sources disagree on whether this panel accepts this expander; expansion hardware cannot be authorised, and a settled NOT_SUPPORTED must not be recorded either",
    };
  }
  if (state === EXPANSION_STATE.NOT_SUPPORTED) {
    return {
      state: "INADMISSIBLE_EXPANSION_NOT_SUPPORTED",
      admissible: false,
      additionalLoops: drawnLoops - inBuild,
      reason: `manufacturer evidence states ${inBuild} SLC and no SLC expander; ${drawnLoops} loops require an expander this panel does not accept`,
    };
  }
  if (state === EXPANSION_STATE.UNKNOWN || !state) {
    return {
      state: "UNPROVEN_EXPANSION_CAPABILITY_UNKNOWN",
      admissible: null,
      additionalLoops: drawnLoops - inBuild,
      reason: "SLC expansion capability is not established by manufacturer evidence; this is a knowledge gap, NOT a technical rejection",
    };
  }
  // SUPPORTED -- now apply the actual maximum, which is a separate question.
  const additional = drawnLoops - inBuild;
  const max = capability.expansionMaxCount;
  if (Number.isInteger(max) && additional > max) {
    return {
      state: "INADMISSIBLE_EXCEEDS_PROVEN_MAXIMUM",
      admissible: false,
      additionalLoops: additional,
      reason: `${additional} expanders required but the proven maximum is ${max}`,
    };
  }
  if (!Number.isInteger(max)) {
    return {
      state: "SUPPORTED_MAXIMUM_NOT_YET_PROVEN",
      admissible: null,
      additionalLoops: additional,
      reason: "expansion is manufacturer-supported but the maximum expander count is not yet proven",
    };
  }
  return { state: "ADMISSIBLE_WITHIN_PROVEN_MAXIMUM", admissible: true, additionalLoops: additional, reason: `${additional} expander(s), within the proven maximum of ${max}` };
}