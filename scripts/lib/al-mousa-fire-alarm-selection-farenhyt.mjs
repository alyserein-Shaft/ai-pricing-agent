// AL MOUSA -- FARENHYT DETAILED INTERNAL SELECTION MAP.
//
// This is the INTERNAL technical selection layer. It resolves each canonical
// commercial BOM line to an exact Farenhyt orderable P/N, or records precisely
// why it cannot be resolved internally.
//
// It does NOT replace the canonical commercial BOM. Quantities, roles and
// pending states stay owned by scripts/lib/al-mousa-fire-alarm-commercial-bom.mjs.
// The NOTIFIER identities recorded there are PRESERVED as the technical
// benchmark / technically valid alternative; this file adds the selected
// Farenhyt identity per line, it does not erase the other.
//
// EVIDENCE BASIS
// Every description below is taken verbatim from governed project data:
//   - library_products.description  (the governed product master)
//   - knowledge_files/FA-RFQ-Farenhyt.xlsx  (supplier RFQ schedule)
// Product descriptions are NOT inferred from the model name.

export const PRICE_SOURCE_FILE = "KSA Honeywell Farenhyt Series Price List -2023.xlsx";

/**
 * Exact Farenhyt selection per canonical requirement.
 *
 * selection:
 *   EXACT_SELECTION               an orderable Farenhyt P/N confirmed by governed evidence
 *   TECHNICAL_SELECTION_REVIEW_REQUIRED   a requirement with no device selected
 *   CONFIGURATION_ASSUMPTION_REQUIRED     family settled, a configuration discriminator is missing
 *   QUANTITY_TOPOLOGY_REQUIRED            quantity is controlled by an absent design
 */
export const FARENHYT_SELECTION = [
  // ---------------- DETECTION ----------------
  {
    key: "smoke",
    requirement: "Addressable photoelectric smoke detector (above/below ceiling, on slab)",
    pn: "IDP-PHOTO-IV",
    family: "Intelligent Addressable Photoelectric Smoke Detector (Ivory Color)",
    base: "B501-IV",
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "library_products: 'Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) (Base Not Included)'. Base not included, so B501-IV is a required separate line.",
    note: "Governed description states BASE NOT INCLUDED. The base is priced on its own line.",
  },
  {
    key: "heatRor",
    requirement: "Addressable heat detector, rate-of-rise 15F/min with 135F fixed setpoint",
    pn: "IDP-HEAT-ROR-IV",
    family: "Intelligent Addressable Fixed temperature and rate-of-rise thermal detector",
    base: "B501-IV",
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence:
      "library_products description reads 'Intelligent Addressable Fixed temperature and rate-of rise the...' -- the part is a COMBINATION fixed+ROR device.",
    correction:
      "CORRECTION: an earlier preliminary pass carried IDP-HEAT-IV. That part is described as " +
      "'Intelligent Addressable Thermal Detector Fixed Temp 135 (Base Not Included)' -- FIXED ONLY. " +
      "It cannot satisfy the governed Al Mousa requirement of rate-of-rise at 15F/min " +
      "(spec 28 46 00 clause 5 features c) and y)). IDP-HEAT-ROR-IV is the correct selection.",
    note: "Satisfies the combined spec profile: 135F/57C fixed setpoint AND 15F/8.3C per minute ROR.",
  },
  {
    key: "heatBalance",
    requirement: "Remaining heat detectors from the BOQ census",
    pn: null,
    family: null,
    base: null,
    confidence: "NONE",
    selection: "TECHNICAL_SELECTION_REVIEW_REQUIRED",
    evidence: "No governed per-row device assignment exists for these units.",
    note:
      "The census is 26 across FOUR further BOQ rows (63=6, 107=8, 148=1, 203=2), none flagged as a " +
      "duplicate. The specification states ONE heat capability profile and contains no quantity split " +
      "and no location conditioning, so the same profile would apply -- but that is an inference, not " +
      "evidence. Quantity stays visible and costed at the same assumed device as a REVIEW item.",
  },
  {
    key: "combined",
    requirement: "Addressable combined smoke + thermal detector",
    pn: "IDP-PHOTO-T-IV",
    family: "Intelligent Addressable Photoelectric Smoke Detector with Thermal (135F/57C)",
    base: "B501-IV",
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "library_products: 'Intelligent Addressable Photoelectric Smoke Detector with Thermal ...'. Base not included.",
  },

  // ---------------- DUCT ----------------
  {
    key: "ductHead",
    requirement: "Addressable detector head for duct detection",
    pn: "IDP-PHOTO-R-IV",
    family: "Intelligent Photoelectric Replacement Smoke Detector, remote test capable, for DNR(W) duct housing",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence:
      "library_products DNR/DNRW detector_base_requirement: 'Detector head sold separately; requires " +
      "IDP-PHOTO-R (remote-test capable) sensor -- see IDP-PHOTO-R's own manual'. IDP-PHOTO-R-IV is described " +
      "'Intelligent Photoelectric Replacement Smoke Detector remote test capable, for use with DNR (W) duct " +
      "smoke detector', device_type 'Photoelectric Smoke Sensor, Remote-Test Capable (Duct Application)'.",
    correction:
      "CORRECTION: an earlier Farenhyt pass carried IDP-PHOTO-IV for the duct heads. That part is the CEILING " +
      "photoelectric detector ('Base Not Included', B501-IV compatible family 'IDP-Photo'), not the duct part. " +
      "Governed evidence names IDP-PHOTO-R as the head required by the DNR/DNRW housing, and the NOTIFIER " +
      "basis already selected the parallel R-variant head (FSP-951R-IV). Using the ceiling part here also " +
      "wrongly implied a B501-IV base per duct location.",
    note:
      "ONE address per assembly, carried by the head. The housing is SLC_HOUSING with address_consumption 0, " +
      "and needs NO B501-IV base -- its own evidence says base_required = No. Spec 2 PRODUCTS 4 (p14) requires " +
      "duct testing to be possible 'locally via magnetic switch or remotely', which the R-variant satisfies.",
  },
  {
    key: "ductHousing",
    requirement: "Duct detector housing (indoor)",
    pn: "DNR",
    family: "Honeywell DNR InnovairFlex intelligent non-relay photoelectric duct detector housing",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "FA-RFQ-Farenhyt: 'InnovairFlex intelligent duct detector, non-relay, does not include head'.",
  },
  {
    key: "ductHousingWp",
    requirement: "Duct detector housing (weatherproof)",
    pn: "DNRW",
    family: "Honeywell DNRW watertight intelligent non-relay duct detector housing",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "library_products: 'Honeywell DNRW watertight intelligent non-relay photoelectric ...'.",
    note: "P/N is settled. QUANTITY depends on which of the 45 locations are wet-exposed, which is unscheduled.",
  },
  {
    key: "ductTube",
    requirement: "Duct sampling tube",
    pn: "ST-10",
    family: "Detector sampling tube, 8-10 ft ducts",
    base: null,
    confidence: "MEDIUM",
    selection: "CONFIGURATION_ASSUMPTION_REQUIRED",
    evidence: "library_products: 'Detector sampling tube, 8-10' ducts'.",
    note:
      "ST-10 is evidenced for 8-10 ft ducts ONLY. Duct widths are not scheduled, so the correct tube " +
      "length per location is NOT established. Quantity 45 is an ASSUMPTION that all locations suit " +
      "ST-10. Alternative sizes (DST1 1ft / DST1.5 1.5ft) exist as separate priced parts.",
  },
  {
    key: "ductTest",
    requirement: "Duct detector remote test / response indication",
    pn: "RI/007C",
    family: "Response Indicator",
    base: null,
    confidence: "LOW",
    selection: "CONFIGURATION_ASSUMPTION_REQUIRED",
    evidence: "FA-RFQ-Farenhyt lists RI/007C 'Response Indicator (Non UL)'. RTS151KEY is an alternative in the 2026 KSA list.",
    note: "Corpus entry is explicitly '(Non UL)'. Whether a non-UL response indicator satisfies the tender's " +
      "mandatory UL-listing requirement must be checked before it is committed. Raised, not silently accepted.",
  },

  // ---------------- INITIATING / INTERFACE ----------------
  {
    key: "pull",
    requirement: "Manual pull station (interior + weatherproof)",
    pn: "IDP-PULL-DA",
    family: "Intelligent Addressable Pull Station, Dual Action, Key Reset",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "library_products: 'Intelligent Addressable Pull Station, Dual Action, Key Reset'.",
    note:
      "DISCREPANCY RECORDED: the FA-RFQ-Farenhyt schedule describes IDP-PULL-DA as 'Single Action, Key Reset', " +
      "while the governed library_products master says 'Dual Action, Key Reset'. The governed product master " +
      "is treated as authoritative. Single vs dual action is an accessibility-relevant discriminator and is " +
      "flagged for confirmation rather than silently chosen.",
  },
  {
    key: "monitor",
    requirement: "Interface module monitor (monitored inputs)",
    pn: "IDP-MONITOR",
    family: "Intelligent Addressable Monitor Module, Supervised, Single Contact",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "library_products: 'Intelligent Addressable Monitor Module, Supervised, Single Contact'.",
  },
  {
    key: "doorContact",
    requirement: "Door contact interface",
    pn: "IDP-MINIMON",
    family: "Intelligent Addressable Mini Monitor Module, Supervised, Single Contact",
    base: null,
    confidence: "MEDIUM",
    selection: "CONFIGURATION_ASSUMPTION_REQUIRED",
    evidence: "Both IDP-MONITOR and IDP-MINIMON exist in governed product data. A door contact is a supervised dry-contact input.",
    note:
      "ASSUMPTION: the MINI monitor is provisionally selected for door contacts on backbox-space grounds. " +
      "IDP-MONITOR is the full-size equivalent and is a valid governed alternative. This is an engineering " +
      "choice, flagged, not a settled fact.",
  },
  {
    key: "control",
    requirement: "Interface module control (control outputs)",
    pn: "IDP-CONTROL",
    family: "Intelligent Addressable Supervised Control Module",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "library_products: 'Intelligent Addressable Supervised Control Module'.",
  },
  {
    key: "detectorBase",
    requirement: "Detector mounting base for all addressable detectors",
    pn: "B501-IV",
    family: '4" standard flangeless mounting base (Ivory Color)',
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "library_products: '4\" standard flangeless mounting base (Ivory Color)'. Every selected detector is base-not-included.",
    note: "Previously absent from the commercial BOM entirely. Now represented as its own priced line.",
  },

  // ---------------- PANELS / LOOPS / NETWORK ----------------
  {
    key: "panel",
    requirement: "Fire alarm control panel (1 campus MFACP + 6 building FACP)",
    pn: "IFP-2100HV",
    family: "Farenhyt 2100-point addressable FACP, UL Listed and FM Approved, 8 on-board Flexput NAC circuits",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence:
      "library_products + FA-RFQ-Farenhyt: 2100 points, 159 detectors and 159 modules per SLC loop, 1 loop card inbuild, " +
      "expandable via 5815RMK (2 x 6815), 8 on-board Flexput circuits, UL Listing AND FM Approved.",
    note: "UL Listed + FM Approved satisfies the tender's mandatory requirement that every component be UL listed under a single manufacturer.",
  },
  {
    key: "loopCard",
    requirement: "SLC loop expansion cards",
    pn: "6815",
    family: "SLC Loop Expander, 159 detectors and 159 modules",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "FA-RFQ-Farenhyt: 'SLC Loop Expander which supports 159 Detectors and 159 Modules'.",
  },
  {
    key: "loopKit",
    requirement: "Remote mounting kit holding loop cards",
    pn: "5815RMK",
    family: "Remote Mounting Kit Cabinet holds two 6815s",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "FA-RFQ-Farenhyt: 'Remote Mounting Kit Cabinet holds two 6815s. Red cabinet'.",
  },
  {
    key: "networkCard",
    requirement: "Panel network interface",
    pn: "SK-NIC",
    family: "Network Interface Card",
    base: null,
    confidence: "MEDIUM",
    selection: "CONFIGURATION_ASSUMPTION_REQUIRED",
    evidence: "FA-RFQ-Farenhyt lists SK-NIC 'Network Interface Card'.",
    note: "Whether copper or fibre networking is required is not stated by the project evidence. SK-NIC plus optional SK-FSL assumed.",
  },

  // ---------------- FIREFIGHTER TELEPHONE ----------------
  {
    key: "ftJack",
    requirement: "Firefighter telephone jack",
    pn: "FFT-FPJ",
    family: "Fire Fighter Phone Jack (passive, single gang)",
    base: null,
    confidence: "HIGH",
    selection: "EXACT_SELECTION",
    evidence: "library_products: 'Fire Fighter Phone Jack'. The comparable part is a PASSIVE device drawing no current.",
    note: "73 jacks. PASSIVE -- consumes ZERO SLC addresses. Must never be converted into interface-module quantity.",
  },
  {
    key: "ftInterface",
    requirement: "Firephone telephone circuit interface module",
    pn: null,
    family: null,
    base: null,
    confidence: "NONE",
    selection: "QUANTITY_TOPOLOGY_REQUIRED",
    evidence: "No telephone circuit designators exist on any project drawing.",
    note: "Quantity derives from CIRCUIT TOPOLOGY. 73 jacks does NOT imply 73 modules and does NOT imply 37 modules. Line kept visible; quantity deliberately NOT fabricated.",
  },
  {
    key: "ftPanel",
    requirement: "Fireman telephone control panel",
    pn: "IFP-FFT",
    family: "Farenhyt Fire Fighter Telephone Control Panel",
    base: null,
    confidence: "MEDIUM",
    selection: "EXACT_SELECTION",
    evidence: "library_products: 'Farenhyt Fire Fighter Telephone Control Panel'.",
    note: "P/N settled. Quantity is topology-driven and not derivable yet.",
  },
  {
    key: "ftHandset",
    requirement: "Firefighter remote handset",
    pn: "FFT-RHS",
    family: "Remote Handset",
    base: null,
    confidence: "MEDIUM",
    selection: "QUANTITY_TOPOLOGY_REQUIRED",
    evidence: "library_products: 'Remote Handset'.",
    note:
      "P/N is settled. QUANTITY is open and is deliberately NOT fabricated: the handset count " +
      "follows the firefighter telephone system architecture (circuits, phones per circuit), " +
      "which has not been issued. It is not derivable from the 73 jack count.",
  },
  {
    key: "ftCabinet",
    requirement: "Firefighter handset storage cabinet",
    pn: "FFT-HSC",
    family: "Fire Fighters Handset Cabinet. Holds up to 10 remote handsets",
    base: null,
    confidence: "MEDIUM",
    selection: "QUANTITY_TOPOLOGY_REQUIRED",
    evidence: "library_products states the cabinet holds up to 10 handsets, which bounds cabinet count once handset count is known.",
    note:
      "P/N is settled. QUANTITY is open: the cabinet count is bounded by the handset count " +
      "(up to 10 handsets per cabinet) but the handset count is itself topology-driven. " +
      "Not fabricated from the 73 jack count.",
  },

  // ---------------- NOTIFICATION (conventional NAC, zero SLC addresses) ------
  // "Loop powered strobe" is a BOQ LABEL, not a device topology. Prior governed
  // evidence rejected the NOTIFIER loop-powered FS-AV range (rated ">1cd", no
  // selectable duty, no outdoor variant), so all three groups are conventional
  // NAC appliances. The FAMILIES are resolved; the exact P/N is not, because the
  // project never states mounting, body colour or wire count -- each of which is
  // a different SKU, not a field setting.
  //
  // PRICE-SOURCE CORRECTION. The previous candidate codes (SRLED / SGRLED /
  // SWLED / SCRLED / SCWLED / P2RLED / P2GRLED / P2GRKLED / P2GWKLED /
  // SGWKLED) came from the GW-FCI "Price Book 2026 - 827F". Three findings:
  //   1. Those identities carry costing_eligible = 0 in product_identity_prices,
  //      so they are not costing-eligible on their own terms;
  //   2. that book is Gamewell/FCI, a DIFFERENT in-house brand -- wrong brand
  //      for a 1,894-point Farenhyt project (<= 2,000);
  //   3. SRLED and P2RLED have NO price record in it at all.
  // Applying the governed Farenhyt discount rule to Gamewell-book records would
  // be a brand-scope violation, so the candidates are re-pointed at the
  // Farenhyt-listed SpectrAlert Advance equivalents, which ARE Farenhyt-branded
  // and priced from that rule's own source. The prior disposition is retained,
  // not deleted. No commercial rate is stated here on purpose: the technical
  // selection layer carries no pricing figures at all.
  {
    key: "notifIndoorStrobe",
    requirement: "Indoor strobe (conventional NAC)",
    pn: null,
    candidates: ["SRL", "SRL-SP", "SWL", "SWL-P", "SCRL", "SGRL", "SYS-ST", "SYS-ST-C"],
    family: "System Sensor SpectrAlert Advance indoor strobe, Farenhyt in-house part numbers",
    base: null,
    confidence: "FAMILY",
    selection: "CONFIGURATION_ASSUMPTION_REQUIRED",
    evidence:
      "BOQ 'Loop powered strobes' x324. Spec 28 46 00 Rev 1, 2 PRODUCTS clause 4 (p18, Interior AV): xenon strobes " +
      "behind clear lenses with the word FIRE displayed and selectable candela output. Clause 2 (p18): Code 3 " +
      "temporal, 1 Hz flash. Clause p16: UL 1971 / UL 1638. Prices: SRL 154, SCRL 136, SWL 163, SGRL 128 USD, " +
      "all from the 2023 Farenhyt list.",
    supersededCandidates: "SRLED/SGRLED/SWLED/SCRLED/SCWLED (GW-FCI 2026 book, costing_eligible=0)",
    note:
      "FAMILY RESOLVED, EXACT P/N NOT. Missing: wall vs ceiling mounting, body colour, 2-wire vs 4-wire -- each " +
      "a different SKU. The interior candela VALUE is additionally design-dependent (product supports selectable " +
      "output, but no room-by-room photometric schedule exists), so PRODUCT P/N RESOLVED and FINAL CANDELA " +
      "SETTING PENDING are separate states. Body colour is INFERRED red because System Sensor carries FIRE on the " +
      "red body and ALERT on the white; the spec fixes the marking, not the colour.",
  },
  {
    key: "notifIndoorHornStrobe",
    requirement: "Indoor horn/strobe (conventional NAC)",
    pn: null,
    candidates: ["P2RL", "P2RL-SP", "PC2RL", "SYS-HS", "SYS-HS-C"],
    family: "System Sensor SpectrAlert Advance indoor horn/strobe, Farenhyt in-house part numbers",
    base: null,
    confidence: "FAMILY",
    selection: "CONFIGURATION_ASSUMPTION_REQUIRED",
    evidence:
      "BOQ 'Loop powered strobes with sounder' x14. Spec 2 PRODUCTS clause 4 (p18, Interior AV): selectable sound " +
      "levels with at least two settings separated by >= 4 dB in the 89-99 dBA range at 10 ft on axis; selectable " +
      "candela output. Clause p16: UL 464 / UL 1971. Prices: P2RL 168, PC2RL 176, SYS-HS 139 USD.",
    supersededCandidates: "P2RLED/P2GRLED (GW-FCI 2026 book, costing_eligible=0)",
    note:
      "FAMILY RESOLVED, EXACT P/N NOT SELECTED. Kept STRICTLY SEPARATE from the strobe-only group -- the 14 " +
      "horn/strobes are never merged into the 324 strobes. Same open discriminators as the strobe group: wall " +
      "vs ceiling mounting, body colour, 2-wire vs 4-wire. Volume/tone field setting is design-dependent, and " +
      "the interior candela VALUE is additionally design-dependent (FINAL CANDELA SETTING PENDING, separate " +
      "from PRODUCT P/N).",
  },
  {
    key: "notifOutdoor",
    requirement: "Exterior weatherproof horn/strobe (conventional NAC)",
    pn: null,
    candidates: ["P2RK", "P4RK", "P4WK", "P2RHK-P", "P2WK", "PC2RK", "PC2RHK"],
    family: "System Sensor SpectrAlert Advance outdoor horn/strobe, Farenhyt in-house part numbers",
    base: null,
    confidence: "FAMILY",
    selection: "CONFIGURATION_ASSUMPTION_REQUIRED",
    evidence:
      "BOQ 'Loop powered strobes with sounder (weatherproof)' x100. Drawing legend, review_status Approved: " +
      "'WP - LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)'. Spec 2 PRODUCTS clause 3 (p18, Exterior AV): " +
      "horn >= 85 dBA at 10 ft on axis, 75 candela xenon strobes behind protruding clear lenses with FIRE marked, " +
      "installed on approved back boxes, exterior units weather-resistant and suitable for outdoor use. " +
      "Prices: P2RK 247, PC2RK 246, P2WK 234 USD.",
    supersededCandidates: "P2GRKLED/P2GWKLED/SGWKLED (GW-FCI 2026 book; unsuffixed codes priced inconsistently)",
    note:
      "FAMILY RESOLVED, EXACT P/N NOT SELECTED. 75 cd is SPEC-FIXED here, unlike the interior groups. That " +
      "EXCLUDES the high-candela outdoor parts (P2RHK / PC2RHK at 135/150/177/185 cd), which cannot deliver " +
      "75 cd and are therefore inadmissible. Only parts listed for outdoor/wet use in their own right are " +
      "admitted -- an indoor part plus a weatherproof backbox is NOT equivalent to a complete rated assembly. " +
      "Wall vs ceiling mounting and 2-wire vs 4-wire remain unresolved discriminators.",
  },

  // ---------------- POWER / ACCESSORIES ----------------
  {
    key: "distributedPower",
    requirement: "Notification appliance power beyond panel on-board circuits",
    pn: null,
    candidates: ["RPS-1000HV"],
    family: "Honeywell Farenhyt intelligent remote power supply, 240 VAC, 6 A",
    base: null,
    confidence: "CAPABILITY_VERIFIED_QUANTITY_PENDING",
    selection: "AGGREGATE_MINIMUM_ONLY",
    evidence:
      "Honeywell Farenhyt RPS-1000 Data Sheet, Doc 350070 Rev M (04-2022): 'Provides 6.0 amps output power. " +
      "Uses Flexput I/O circuits, 3A each... Total Accessory Load: 6A @ 24VDC... Notification: 3 amps per " +
      "circuit (6A system total)'. Compatibility list explicitly includes IFP-2100HV. Six onboard Flexput " +
      "circuits and two Form C relays. RPS-1000HV is the 240 VAC variant matching the IFP-2100HV supply.",
    correction:
      "CORRECTION: an earlier pass carried pn = 'RPS-1000HV' at MEDIUM confidence with no capacity basis. " +
      "Manufacturer capacity is now verified, but the QUANTITY is still not a selection: the verified figures " +
      "yield an AGGREGATE_THEORETICAL_MINIMUM only (ceil(aggregate deficit / 6 A)).",
    note:
      "CAPABILITY IS NOT A QUANTITY. The aggregate floor is computed campus-wide, but the notification load " +
      "is split across 7 physically separate buildings and spare output on one panel cannot serve another. " +
      "FINAL_QUANTITY = PENDING_BUILDING_NAC_ALLOCATION. Per-building distribution can only INCREASE the " +
      "installed count above the aggregate floor, never reduce it.",
  },
  {
    key: "annunciator",
    requirement: "Display remote annunciator",
    pn: "RA-2000",
    family: "4 x 40 (160 Character Display) Remote Annunciator",
    base: null,
    confidence: "LOW",
    selection: "CONFIGURATION_ASSUMPTION_REQUIRED",
    evidence: "FA-RFQ-Farenhyt lists RA-2000. Whether the project requires one per building is not stated by project evidence.",
    note: "P/N settled; quantity not established by evidence.",
  },
];

export const SELECTION_BY_KEY = Object.freeze(
  Object.fromEntries(FARENHYT_SELECTION.map((s) => [s.key, s])),
);
