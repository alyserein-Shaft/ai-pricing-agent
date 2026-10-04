// GOVERNED AL MOUSA NOTIFICATION APPLIANCE RESOLUTION.
//
// Start from PROJECT evidence (BOQ + Technical Specification 28 46 00 Rev 1 +
// drawing legend), then match to the governed Farenhyt catalogue. Manufacturer
// capability is never allowed to create a project requirement, and a building
// convention is never allowed to stand in for a project requirement.
//
// WHAT PROJECT EVIDENCE ACTUALLY SAYS
// ------------------------------------
// BOQ (sheet MECH RFQ) gives three DISTINCT lines, and the drawing legend
// confirms a distinct approved symbol "WP - LOOP POWERED STROBE WITH SOUNDER
// (WEATHER PROOF TYPE)":
//   324  "Loop powered strobes"                                -> strobe only
//    14  "Loop powered strobes with sounder"                   -> horn + strobe
//   100  "Loop powered strobes with sounder (weatherproof)"   -> horn + strobe, outdoor
// The "loop powered" wording is a BOQ label, NOT a device topology. Prior
// governed evidence (EV-20260930-NOTIFICATION-AND-PANEL-ARCHITECTURE) rejected
// the NOTIFIER loop-powered FS-AV range -- it is rated ">1cd" with no selectable
// duty and has no outdoor variant for the 100 exterior units -- so all three
// groups are CONVENTIONAL NAC appliances and consume ZERO SLC addresses.
//
// SPEC CLAUSES THAT BIND
// -----------------------
//  2 PRODUCTS clause 3 (p18, Exterior): horns >= 85 dBA @ 10 ft on axis; visual
//    devices "75 candela xenon strobes behind protruding clear lenses, with FIRE
//    marked on the appliance"; installed on approved back boxes; exterior units
//    weather-resistant and suitable for outdoor use.
//  2 PRODUCTS clause 4 (p18, Interior): selectable sound levels, >= 2 settings
//    >= 4 dB apart in 89-99 dBA @ 10 ft; xenon strobes behind clear lenses with
//    the word FIRE displayed; SELECTABLE candela output.
//  2 PRODUCTS clause 2 (p18): Code 3 temporal pattern; strobes flash at 1 Hz.
//  2 PRODUCTS clause (p16): listed to UL 1638 for indoor AND outdoor; strobes
//    synchronised per NFPA photosensitive-epilepsy guidance when two or more
//    visual appliances share a field of view.
//  2 PRODUCTS clause (p20): "Built-in synchronization is provided for certain
//    notification appliances on each circuit, eliminating the need for extra
//    synchronization modules."
//
// SPEC INCONSISTENCY RECORDED, NOT PAPERED OVER
// ---------------------------------------------
// The candela ranges are not internally consistent: one clause states "dual
// settings of either 15/75 cd or 30/120 cd" while another states field-selectable
// 15, 30, 60, 75, 110. This does NOT block family selection, because every
// candidate family offers 75 cd and field-selectable output, which satisfies both
// the exterior 75 cd requirement and the interior selectable requirement. It is
// recorded as an open spec question rather than silently reconciled.
//
// WHAT PROJECT EVIDENCE DOES *NOT* SAY
// ------------------------------------
//  - wall vs ceiling mounting: absent from BOQ, spec and the only approved
//    notification drawing symbol.
//  - body colour: the spec fixes the LENS MARKING ("FIRE"), not the body colour.
//  - 2-wire vs 4-wire: not stated; conventional NAC practice is 2-wire.
//  - a room-by-room candela schedule: absent, so the interior FIELD SETTING is
//    design-dependent even once the product is chosen.
// None of these may be invented.
export const NOTIFICATION_EVIDENCE = {
  boqSource: "BOQ.xlsx sheet MECH RFQ rows 35/37/39, 86/88/90, 129/131/133, 172/174/176, 193, 207, 223",
  specDocument: "Technical Specification 28 46 00 - Fire Detection and Alarm System - Rev 1",
  drawingSymbol: "WP - LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE), review_status Approved",
  alarmPattern: "Code 3 temporal; strobes 1 Hz",
  syncRequiredBy: "NFPA photosensitive-epilepsy guidance when 2+ visual appliances share a field of view",
  builtInSyncNote:
    "Spec p20 states built-in synchronisation is provided on certain circuits, eliminating extra sync modules. " +
    "That text is not IFP-2100HV-specific and no IFP-2100HV sync evidence exists in the governed library, so " +
    "whether a dedicated module is required is UNRESOLVED and none is added.",
  candelaConflict:
    "Spec states both 'dual settings of either 15/75 cd or 30/120 cd' and 'field-selectable 15, 30, 60, 75, 110'. " +
    "Both are satisfiable by the candidate families; recorded as an open spec inconsistency.",
};

/** The three demand groups, exactly as the BOQ states them. */
export const NOTIFICATION_GROUPS = [
  {
    key: "notifIndoorStrobe",
    requirement: "Indoor strobe (conventional NAC)",
    boqWording: "Loop powered strobes",
    quantitySource: "strobe",
    audible: false,
    environment: "INDOOR",
    specBinding: "Interior AV signals: xenon strobe, clear lens, FIRE displayed, selectable candela output",
    requiredCandelaCd: null,          // SELECTABLE -- final setting is design-dependent
    weatherproofRequired: false,
    // Colour follows the marking the spec fixes: System Sensor carries FIRE on
    // the RED body and ALERT on the WHITE body, so FIRE implies red. Labelled
    // INFERRED because the spec never names a body colour.
    bodyColour: "RED_INFERRED_FROM_FIRE_MARKING",
    mounting: "UNRESOLVED",
    wiring: "2WIRE_INFERRED_FROM_CONVENTIONAL_NAC",
    candidateSet: ["SRL", "SRL-SP", "SWL", "SWL-P", "SCRL", "SGRL", "SYS-ST", "SYS-ST-C"],
  },
  {
    key: "notifIndoorHornStrobe",
    requirement: "Indoor horn/strobe (conventional NAC)",
    boqWording: "Loop powered strobes with sounder",
    quantitySource: "strobeSounder",
    audible: true,
    environment: "INDOOR",
    specBinding: "Interior AV signals: selectable sound levels >=2 settings >=4 dB apart in 89-99 dBA @10ft; selectable candela",
    requiredCandelaCd: null,
    weatherproofRequired: false,
    bodyColour: "RED_INFERRED_FROM_FIRE_MARKING",
    mounting: "UNRESOLVED",
    wiring: "2WIRE_INFERRED_FROM_CONVENTIONAL_NAC",
    candidateSet: ["P2RL", "P2RL-SP", "P2WHK", "PC2RL", "SYS-HS", "SYS-HS-C"],
  },
  {
    key: "notifOutdoor",
    requirement: "Outdoor weatherproof horn/strobe (conventional NAC)",
    boqWording: "Loop powered strobes with sounder (weatherproof)",
    quantitySource: "strobeWp",
    audible: true,
    environment: "OUTDOOR",
    specBinding:
      "Exterior AV signals: horn >=85 dBA @10ft on axis; 75 candela xenon strobe, clear lens, FIRE marked; " +
      "weather-resistant, outdoor use, approved back box",
    requiredCandelaCd: 75,            // SPEC-CONFIRMED fixed
    weatherproofRequired: true,
    bodyColour: "RED_INFERRED_FROM_FIRE_MARKING",
    mounting: "UNRESOLVED",
    wiring: "2WIRE_INFERRED_FROM_CONVENTIONAL_NAC",
    // Outdoor NEMA 4X horn/strobes only. An indoor part with a weatherproof
    // backbox is NOT equivalent: the listing must cover the complete assembly.
    candidateSet: ["P2RK", "P2RHK", "P4RK", "P4WK", "P2RHK-P", "P2WK", "PC2RK", "PC2RHK"],
  },
];

/** Discriminators that must be resolved before an exact P/N may be selected. */
export const EXACT_PN_DISCRIMINATORS = [
  "mounting (wall vs ceiling) -- a different SKU, not a field setting",
  "body colour (red vs white) -- a different SKU",
  "lens marking (FIRE vs plain/blank) -- a different SKU",
  "candela family (multi vs high) -- a different SKU; high-candela units do NOT offer 75 cd",
  "wire count (2-wire vs 4-wire) -- a different SKU",
];

/**
 * Decide whether a group may carry an exact P/N.
 * A missing discriminator blocks the exact P/N; it never blocks the FAMILY.
 */
export const evaluateExactSelection = (group) => {
  const missing = [];
  if (group.mounting === "UNRESOLVED") missing.push("MOUNTING_INPUT_REQUIRED (wall vs ceiling)");
  if (!/CONFIRMED|Spec|spec/i.test(String(group.bodyColour))) missing.push("BODY_COLOUR_INPUT_REQUIRED (red vs white)");
  if (!/CONFIRMED|Spec|spec/i.test(String(group.wiring))) missing.push("WIRE_COUNT_INPUT_REQUIRED (2-wire vs 4-wire)");
  if (group.requiredCandelaCd === null) {
    missing.push("CANDELA_FIELD_SETTING_PENDING (product supports selectable output; per-room value is design-dependent)");
  }
  return missing.length === 0
    ? { status: "EXACT_SELECTION", missing: [] }
    : { status: "CONFIGURATION_ASSUMPTION_REQUIRED", missing };
};

/** Candidate filtering driven by the spec's fixed requirements, never by price. */
export const admissibleCandidates = (group, products) => {
  const byPn = new Map(products.map((p) => [String(p.partNumber).toUpperCase(), p]));
  const out = [];
  for (const pn of group.candidateSet) {
    const p = byPn.get(pn.toUpperCase());
    if (!p) { out.push({ pn, admitted: false, why: "not in the governed library" }); continue; }
    const why = [];
    // Outdoor groups must be listed/rated for outdoor use in their own right.
    if (group.weatherproofRequired) {
      const wp = String(p.description || "").toLowerCase();
      const outdoor = /outdoor|weatherproof|nema|\bk\b/.test(wp) || /outdoor|nema|weatherproof/i.test(JSON.stringify(p.attributes ?? []));
      if (!outdoor) why.push("no governed outdoor/NEMA rating on this part");
    }
    // A part that cannot deliver the spec-required candela is inadmissible.
    if (group.requiredCandelaCd) {
      const attrs = JSON.stringify(p.attributes ?? []);
      const offers = new RegExp(`\\b${group.requiredCandelaCd}\\b`).test(attrs) || new RegExp(`\\b${group.requiredCandelaCd}\\b`).test(String(p.description || ""));
      if (!offers) why.push(`does not offer ${group.requiredCandelaCd} cd`);
    }
    out.push({ pn, admitted: why.length === 0, why: why.join("; ") || null, part: p });
  }
  return out;
};

/**
 * Preliminary NAC current. Where the field setting is unresolved the DESIGN
 * WORST CASE is used and labelled as such; where the spec fixes a candela the
 * value at that setting is used.
 */
export const notificationCurrent = ({ group, quantity, table }) => {
  const cd = group.requiredCandelaCd;
  const mode = cd === null ? "DESIGN_WORST_CASE_CURRENT" : "CONFIGURED_CURRENT";
  const perUnit = cd === null ? table.worstCaseCurrentMa : table.currentByCandelaMa[cd];
  if (perUnit == null) return { ok: false, reason: "NO_GOVERNED_CURRENT_TABLE", pn: table.pn };
  return { ok: true, mode, perUnitCurrentMa: perUnit, quantity, totalCurrentMa: perUnit * quantity, source: table.pn };
};
