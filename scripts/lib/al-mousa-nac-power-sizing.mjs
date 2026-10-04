// AL MOUSA -- NAC / RPS NOTIFICATION POWER ARCHITECTURE (READ-ONLY SIZING).
//
// WHY THIS EXISTS
// ---------------
// The prior governed NAC evidence (EV-20260930-AL-MOUSA-NAC-CAPACITY-AND-SYNC)
// stopped at a CAMPUS-POOLED aggregate: 9 A x 7 panels = 63 A, deficit
// 41.244 A, ceil(41.244/6) = 7 x RPS-1000HV -- explicitly labelled
// "AGGREGATE_THEORETICAL_MINIMUM / PENDING_BUILDING_NAC_ALLOCATION".
//
// That pooling is not merely imprecise, it is WRONG. Networked panels do not
// share notification output current: spare Flexput amps in the KGS fire command
// room cannot serve a strobe in the Welcome Center. The load must be computed
// and rounded UP PER PHYSICAL PANEL. This module does that and never sums
// across panels to produce a quantity.
//
// WHAT IT REUSES (no parallel implementation)
// -------------------------------------------
//   PHYSICAL_PANEL_SCOPES  scripts/lib/al-mousa-panel-slc-address-budget.mjs
//       -> the seven verified physical panel scopes, each already carrying its
//          own boqBlock / boqStation / mapping authority.
//   boqBlocks              scripts/lib/al-mousa-drawing-boq-reconciliation.mjs
//       -> the governed BOQ block + station-scope split.
//   IFP_2100_CAPACITY      scripts/lib/al-mousa-farenhyt-nac-capacity.mjs
//   RPS_1000_CAPACITY      scripts/lib/al-mousa-farenhyt-nac-capacity.mjs
//       -> the verified panel / power-supply capability facts.
//
// CURRENT DRAW AUTHORITY
// ----------------------
// Per the governing workflow, a current value is only usable when it is a UL
// MAXIMUM from FIRST-PARTY manufacturer documentation, at the right voltage and
// the right protocol (DC vs FWR), at the project-selected setting. A typical or
// nominal figure is not acceptable, and a value with no first-party proposition
// is not acceptable either.
//
// Therefore every current in NOTIFICATION_CURRENT_EVIDENCE must carry its own
// `proposition` naming the document, revision and the setting it supports. The
// resolver REFUSES to use a value whose proposition is absent, and it refuses
// to guess a setting that is not tabulated. It returns a reason instead of a
// number. That is deliberate: a wrong or invented amp figure is worse than an
// explicit gap, because it silently sizes a power supply.

import { IFP_2100_CAPACITY, RPS_1000_CAPACITY } from "./al-mousa-farenhyt-nac-capacity.mjs";

export const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";

/**
 * The three conventional-NAC demand classes, exactly as the BOQ words them.
 * These are CONVENTIONAL: they consume ZERO SLC addresses. The governed
 * classifier (app/domain/fire-alarm-slc-resource-classifier.mjs) treats them as
 * NOT_SLC_FAMILIES, which is also why they are excluded from the 2000-point
 * brand threshold in docs/fire-alarm-brand-and-pre-sales-policy.md section 6.
 */
export const NOTIFICATION_CLASSES = Object.freeze({
  INDOOR_STROBE: Object.freeze({
    key: "indoorStrobe",
    boqDescription: "Loop powered strobes",
    audible: false,
    environment: "INDOOR",
    // The spec says SELECTABLE candela for interiors and is internally
    // inconsistent about the selectable set. The field setting is therefore
    // UNRESOLVED and every interior load is bounded, never guessed.
    candelaSetting: "UNRESOLVED__BOUNDED",
    specCandelaConflict:
      "Spec 28 46 00 Rev 1 states both 'dual settings of either 15/75 cd or 30/120 cd' and " +
      "'field-selectable 15, 30, 60, 75, 110'. Recorded as an OPEN SPEC INCONSISTENCY, not reconciled.",
  }),
  INDOOR_HORN_STROBE: Object.freeze({
    key: "indoorHornStrobe",
    boqDescription: "Loop powered strobes with sounder",
    audible: true,
    environment: "INDOOR",
    candelaSetting: "UNRESOLVED__BOUNDED",
    specCandelaConflict:
      "Interior horn/strobe: selectable sound levels >=2 settings >=4 dB apart in 89-99 dBA @10ft, " +
      "selectable candela. Neither the candela nor the sound setting is fixed by the project.",
  }),
  OUTDOOR_HORN_STROBE: Object.freeze({
    key: "outdoorHornStrobe",
    boqDescription: "Loop powered strobes with sounder (weatherproof)",
    audible: true,
    environment: "OUTDOOR",
    // The spec FIXES the exterior candela, so this class is CONFIGURED, not worst-case.
    candelaSetting: "CONFIGURED_75CD",
    weatherproofRequired: true,
  }),
});

/**
 * UL MAXIMUM current draw evidence, per class, per candela setting, at 24 VDC.
 *
 * A setting whose value is `null` is NOT EVIDENCED. It is never interpolated,
 * never carried from a neighbouring setting, and never replaced by a typical
 * or nominal figure. `null` produces an explicit NOT_COMPUTABLE result.
 */
export const NOTIFICATION_CURRENT_EVIDENCE = Object.freeze({
  indoorStrobe: {
    applianceType: "STROBE_ONLY",
    family: "SpectrAlert Advance indoor strobe, wall/ceiling (System Sensor / Farenhyt SpectrAlert Advance)",
    voltage: "24 VDC nominal (16-33 V DC column)",
    listing: "UL 1971 (strobe)",
    // UL MAXIMUM STROBE CURRENT DRAW (mA RMS), 16-33 Volts DC column, read from
    // the first-party datasheet table "UL Max. Strobe Current Draw (mA RMS)".
    ulMaxCurrentMaByCandelaDc: { 15: 66, "15/75": 77, 30: 94, 75: 158, 95: 181, 110: 202, 115: 210, 135: 228, 150: 246, 177: 281, 185: 286 },
    noSixtyCandela:
      "There is NO 60 cd setting in this datasheet. The printed selectable set is 15, 15/75, 30, 75, 95, " +
      "110, 115 (standard range) and 135, 150, 177, 185 (high range). The project specification's " +
      "'field-selectable 15, 30, 60, 75, 110' therefore names a setting the product line does not offer, " +
      "which is a further manifestation of the recorded spec inconsistency.",
    proposition:
      "UL Max. Strobe Current Draw (mA RMS), 16-33 Volts DC: 15=66, 15/75=77, 30=94, 75=158, 95=181, " +
      "110=202, 115=210, 135=228, 150=246, 177=281, 185=286 -- SpectrAlert Advance Indoor Wall Horns, " +
      "Strobes, Horn Strobes data sheet, Honeywell prod-edam, " +
      "Indoor_Wall_Horns_Strobes_HornStrobes_DataSheet_AVDS1021.pdf",
    evidenceState: "FIRST_PARTY_VERIFIED",
  },
  indoorHornStrobe: {
    // IMPORTANT: for a HORN/STROBE appliance the datasheet table
    // "UL Max. Current Draw (mA RMS), 2-Wire Horn Strobe" IS THE TOTAL appliance
    // current. It must NOT be combined with the separate "UL Max. Horn Current
    // Draw" table, which applies to HORN-ONLY appliances. Adding the two would
    // double-count: at 75 cd the horn/strobe total is 176 mA, not 158 + 69.
    applianceType: "HORN_STROBE_TOTAL",
    family: "SpectrAlert Advance indoor 2-wire horn/strobe (System Sensor / Farenhyt SpectrAlert Advance)",
    voltage: "24 VDC nominal (16-33 V DC column)",
    listing: "UL 1971 and UL 464",
    // UL MAXIMUM CURRENT DRAW (mA RMS), 2-Wire Horn Strobe, DC input, 16-33 Volts.
    // The project mandates Code 3 temporal, so only the TEMPORAL rows apply; the
    // sound VOLUME setting is unresolved and is bounded between Temporal Low and
    // Temporal High.
    ulMaxCurrentMaByCandelaAndVolumeDc: {
      "15|Temporal Low": 66, "15|Temporal High": 79,
      "15/75|Temporal Low": 77, "15/75|Temporal High": 90,
      "30|Temporal Low": 93, "30|Temporal High": 107,
      "75|Temporal Low": 154, "75|Temporal High": 176,
      "95|Temporal Low": 179, "95|Temporal High": 194,
      "110|Temporal Low": 198, "110|Temporal High": 212,
      "115|Temporal Low": 207, "115|Temporal High": 218,
      "135|Temporal Low": 232, "135|Temporal High": 245,
      "150|Temporal Low": 251, "150|Temporal High": 259,
      "177|Temporal Low": 282, "177|Temporal High": 290,
      "185|Temporal Low": 292, "185|Temporal High": 297,
    },
    proposition:
      "UL Max. Current Draw (mA RMS), 2-Wire Horn Strobe, Standard Candela Range, DC Input, 16-33 Volts -- " +
      "Temporal Low: 15=66, 75=154, 110=198; Temporal High: 15=79, 75=176, 110=212 -- SpectrAlert Advance " +
      "Indoor Wall Horns, Strobes, Horn Strobes data sheet, Honeywell prod-edam, " +
      "Indoor_Wall_Horns_Strobes_HornStrobes_DataSheet_AVDS1021.pdf",
    evidenceState: "FIRST_PARTY_VERIFIED",
  },
  outdoorHornStrobe: {
    applianceType: "HORN_STROBE_TOTAL",
    family: "SpectrAlert Advance outdoor weatherproof 2-wire horn/strobe (System Sensor / Farenhyt SpectrAlert Advance)",
    voltage: "24 VDC nominal (16-33 V DC column)",
    listing: "UL 1638 (strobe) and UL 464 (horn)",
    rating: "Weatherproof per NEMA 4X, IP56; rated -40F to 151F",
    // The outdoor datasheet prints the SAME UL maximum current tables as the
    // indoor one, so the spec-fixed 75 cd exterior setting is evidenced directly.
    ulMaxCurrentMaByCandelaAndVolumeDc: {
      "15|Temporal Low": 66, "15|Temporal High": 79,
      "75|Temporal Low": 154, "75|Temporal High": 176,
      "110|Temporal Low": 198, "110|Temporal High": 212,
      "115|Temporal Low": 207, "115|Temporal High": 218,
    },
    proposition:
      "UL Max. Current Draw (mA RMS), 2-Wire Horn Strobe, DC Input, 16-33 Volts: 75 cd Temporal High = 176, " +
      "Temporal Low = 154; 'Weatherproof per NEMA 4X, IP56'; 'Listed to UL 1638 (strobe) and UL 464 (horn)' " +
      "-- SpectrAlert Advance Outdoor Selectable-Output Horns, Strobes, and Horn Strobes data sheet, " +
      "Honeywell prod-edam, OutdoorHorns-Strobes-HornStrobes_DataSheet_A05-0456.pdf",
    evidenceState: "FIRST_PARTY_VERIFIED",
  },
});

/** Sound-pattern handling. The project mandates Code 3 temporal. */
export const SOUND_PATTERN = Object.freeze({
  fixed: "Temporal",
  reason: "Spec 28 46 00 Rev 1 clause 2 (p18): Code 3 temporal, strobes 1 Hz. The PATTERN is therefore fixed.",
  volumeUnresolved:
    "The spec requires selectable sound levels >=2 settings >=4 dB apart but does not state the field " +
    "setting, so the audible volume is BOUNDED between Temporal Low and Temporal High rather than guessed.",
});

/** Bound the sound-volume setting for a horn/strobe class. */
export const VOLUME_BOUNDS = Object.freeze({ lowest: "Temporal Low", highest: "Temporal High" });

/** Bounding cases required because the interior candela field setting is unresolved. */
export const BOUNDING_CASES = Object.freeze({
  MINIMUM_ALLOWED_SETTING: "MINIMUM_ALLOWED_SETTING",
  WORST_ALLOWED_SETTING: "WORST_ALLOWED_SETTING",
  CONFIGURED_PROJECT_SETTING: "CONFIGURED_PROJECT_SETTING",
});

/** The lowest and highest candela the project spec says an interior unit may be set to. */
export const INTERIOR_CANDELA_BOUNDS = Object.freeze({ lowestEvidenced: 15, highestEvidenced: 110 });

/**
 * Resolve the UL max current for one class at one setting.
 * Fails closed. Never returns a number it cannot attribute to a proposition.
 */
export function resolveUlMaxCurrentMa(classKey, candelaCd, { evidence = NOTIFICATION_CURRENT_EVIDENCE, volume = VOLUME_BOUNDS.highest } = {}) {
  const ev = evidence[classKey];
  if (!ev) return { ok: false, reason: "UNKNOWN_NOTIFICATION_CLASS", classKey };
  if (!ev.proposition) {
    return {
      ok: false,
      reason: "NO_FIRST_PARTY_UL_MAX_CURRENT_PROPOSITION",
      classKey,
      evidenceState: ev.evidenceState,
      detail:
        "No inspected first-party UL maximum current table backs this class. A typical, nominal or " +
        "unattributed figure is not usable for power sizing, so no current is produced.",
    };
  }
  if (ev.applianceType === "STROBE_ONLY") {
    const ma = ev.ulMaxCurrentMaByCandelaDc?.[candelaCd];
    if (ma == null) {
      return {
        ok: false, reason: "SETTING_NOT_TABULATED_IN_FIRST_PARTY_EVIDENCE", classKey, candelaCd,
        availableSettings: Object.keys(ev.ulMaxCurrentMaByCandelaDc ?? {}),
      };
    }
    return { ok: true, ma, candelaCd, volume: null, applianceType: ev.applianceType, proposition: ev.proposition, listing: ev.listing, voltage: ev.voltage };
  }
  // HORN_STROBE_TOTAL: the tabulated figure is already the whole appliance.
  const key = `${candelaCd}|${volume}`;
  const ma = ev.ulMaxCurrentMaByCandelaAndVolumeDc?.[key];
  if (ma == null) {
    return {
      ok: false, reason: "SETTING_NOT_TABULATED_IN_FIRST_PARTY_EVIDENCE", classKey,
      candelaCd, volume, availableSettings: Object.keys(ev.ulMaxCurrentMaByCandelaAndVolumeDc ?? {}),
    };
  }
  return { ok: true, ma, candelaCd, volume, applianceType: ev.applianceType, proposition: ev.proposition, listing: ev.listing, voltage: ev.voltage };
}

/**
 * Notification demand for ONE physical panel, read from the governed BOQ.
 *
 * `blocks` is the output of the governed boqBlocks() splitter. Blocks that
 * cannot be attributed to exactly one building are reported as
 * ATTRIBUTION_AMBIGUOUS_BUT_LOAD_IDENTICAL when every candidate block carries
 * the same quantities -- which is the case for BOYS and GIRLS. That is the
 * honest way to keep going: the NAME mapping stays unresolved while the LOAD
 * stays proven, because the two candidate blocks are quantity-identical.
 */
export function notificationDemandForPanel(scope, blocks) {
  const pick = (rows) => {
    const out = { indoorStrobe: 0, indoorHornStrobe: 0, outdoorHornStrobe: 0, rows: [] };
    for (const r of rows) {
      const d = String(r.description).toLowerCase();
      let cls = null;
      if (d.includes("with sounder (weatherproof)")) cls = "outdoorHornStrobe";
      else if (d.includes("with sounder")) cls = "indoorHornStrobe";
      else if (d.includes("strobe")) cls = "indoorStrobe";
      if (!cls) continue;
      out[cls] += r.quantity;
      out.rows.push({ class: cls, quantity: r.quantity, description: r.description, item: r.item });
    }
    return out;
  };

  // A named station scope (Sub Station / DG Station) is its own block member.
  if (scope.boqStation) {
    for (const b of blocks) {
      const s = b.stations.find((x) => x.scope === scope.boqStation);
      if (s) return { state: "BOQ_STATION_SCOPE", scope: scope.id, source: scope.boqStation, ...pick(s.rows) };
    }
    return { state: "BOQ_STATION_SCOPE_NOT_FOUND", scope: scope.id, source: scope.boqStation };
  }

  if (typeof scope.boqBlock === "number") {
    const b = blocks.find((x) => x.block === scope.boqBlock);
    if (!b) return { state: "BOQ_BLOCK_NOT_FOUND", scope: scope.id, source: scope.boqBlock };
    return { state: "BOQ_BLOCK_SCOPE", scope: scope.id, source: `BOQ block ${scope.boqBlock}`, ...pick(b.rows) };
  }

  // "AMBIGUOUS_2_OR_3": try every candidate and require the loads to agree.
  const candidates = String(scope.boqBlock ?? "").match(/\d+/g)?.map(Number) ?? [];
  const perBlock = candidates.map((n) => {
    const b = blocks.find((x) => x.block === n);
    return b ? { block: n, ...pick(b.rows) } : null;
  }).filter(Boolean);
  if (!perBlock.length) return { state: "BOQ_BLOCK_CANDIDATES_NOT_FOUND", scope: scope.id };
  const sig = (d) => [d.indoorStrobe, d.indoorHornStrobe, d.outdoorHornStrobe].join("/");
  const distinct = [...new Set(perBlock.map(sig))];
  if (distinct.length !== 1) {
    return { state: "ATTRIBUTION_AMBIGUOUS__LOADS_DIFFER", scope: scope.id, candidates: perBlock };
  }
  return {
    state: "ATTRIBUTION_AMBIGUOUS_BUT_LOAD_IDENTICAL",
    scope: scope.id,
    candidateBlocks: candidates,
    note:
      `Blocks ${candidates.join(" and ")} carry identical notification quantities, so the unresolved ` +
      "block-to-building name mapping cannot change this panel's load. The name stays UNRESOLVED; the load is PROVEN.",
    ...pick(perBlock[0].rows),
  };
}

/**
 * Per-panel worst-case alarm current, by class, as an explicit formula.
 * SLC current, SBUS current and panel electronics are DELIBERATELY excluded --
 * they are not notification load and must not be mixed into a NAC power budget.
 */
export function perPanelAlarmLoad(
  demand,
  { case: boundingCase, evidence = NOTIFICATION_CURRENT_EVIDENCE, interiorCandelaCd = null, interiorVolume: volumeOverride = null } = {},
) {
  const classes = [];
  let total = 0;
  let blocked = false;
  const reasons = [];

  for (const def of Object.values(NOTIFICATION_CLASSES)) {
    // The demand ledger is keyed by the class KEY ("indoorStrobe"), not by the
    // exported constant name. Reading the wrong one silently yields zero demand
    // and would report an empty, "computed" budget.
    const clsKey = def.key;
    const qty = demand[clsKey] ?? 0;
    if (!qty) continue;

    let settingCd;
    if (def.candelaSetting === "CONFIGURED_75CD") {
      settingCd = 75;
    } else if (interiorCandelaCd != null) {
      // An EXPLICIT scenario setting. It must be manufacturer-supported; the
      // resolver fails closed on an unsupported setting rather than coercing it.
      settingCd = interiorCandelaCd;
    } else if (boundingCase === BOUNDING_CASES.MINIMUM_ALLOWED_SETTING) {
      settingCd = INTERIOR_CANDELA_BOUNDS.lowestEvidenced;
    } else {
      settingCd = INTERIOR_CANDELA_BOUNDS.highestEvidenced;
    }

    // A horn/strobe table is the WHOLE appliance current. There is deliberately
    // no additive horn term: adding the separate horn-only table would
    // double-count (at 75 cd the horn/strobe total is 176 mA, not 158 + 69).
    const volume = volumeOverride
      ?? (boundingCase === BOUNDING_CASES.MINIMUM_ALLOWED_SETTING ? VOLUME_BOUNDS.lowest : VOLUME_BOUNDS.highest);
    const r = resolveUlMaxCurrentMa(clsKey, settingCd, { evidence, volume });
    if (!r.ok) {
      blocked = true;
      reasons.push(r);
      classes.push({ clsKey, quantity: qty, settingCandelaCd: settingCd, soundVolume: volume, ulMaxCurrentMa: null, state: r.reason });
      continue;
    }
    const perUnit = r.ma;
    const subtotal = perUnit * qty;
    total += subtotal;
    classes.push({
      clsKey, quantity: qty, settingCandelaCd: settingCd, soundVolume: r.volume,
      applianceType: r.applianceType, ulMaxCurrentMaPerUnit: r.ma, perUnitUlMaxCurrentMa: perUnit,
      subtotalMa: subtotal,
      formula: def.audible
        ? `${qty} x ${r.ma} mA (HORN/STROBE TOTAL at ${settingCd} cd, ${r.volume}) = ${subtotal} mA`
        : `${qty} x ${r.ma} mA (STROBE ONLY at ${settingCd} cd) = ${subtotal} mA`,
    });
  }

  return {
    state: blocked ? "NOT_COMPUTABLE" : "COMPUTED",
    boundingCase: def_or(boundingCase),
    classes,
    totalAlarmCurrentMa: blocked ? null : total,
    totalAlarmCurrentAmps: blocked ? null : Math.round((total / 1000) * 1000) / 1000,
    blockingReasons: reasons,
    excludedFromThisBudget: ["SLC device current", "SBUS current", "panel electronics", "auxiliary loads"],
  };
}
const def_or = (v) => v;

/**
 * Count the explicit NAC circuit annotations on a governed drawing sheet.
 *
 * The Fire Alarm wiring schedule prints one "NAC LOOP" label per notification
 * circuit, positioned as a separate item AFTER the "LOOP-n" SLC labels. This
 * reads that annotation count from the governed drawing assets rather than
 * assuming a number.
 *
 * It returns the count only. It deliberately does NOT claim a per-circuit device
 * allocation: the drawings carry no notification device schedule, so the exact
 * distribution is not authored and must not be fabricated.
 */
export function drawingNacCircuitCount(assetTexts) {
  const n = assetTexts.filter((t) => /NAC\s+LOOP/i.test(String(t))).length;
  return {
    state: n > 0 ? "DRAWING_EXPLICIT" : "NO_NAC_ANNOTATION_FOUND",
    circuits: n,
    note:
      "A single 'NAC LOOP' annotation per panel is a CIRCUIT DESIGNATION, not a device allocation. " +
      "The drawings carry no per-circuit notification device schedule, so an exact device-to-circuit " +
      "distribution is NOT AUTHORED and must not be invented.",
  };
}

/**
 * NAC circuit requirement. The REQUIRED count is the binding maximum of every
 * applicable constraint -- never total amps divided by total panel amps.
 */
export function nacCircuitRequirement({ loadAmps, wiringClass, drawingNacCircuits, syncZoneBreaks = null }) {
  const perCircuit = IFP_2100_CAPACITY.perCircuitLimitAmps;
  const classBCircuits = IFP_2100_CAPACITY.flexputCircuitsClassB;
  const classACircuits = IFP_2100_CAPACITY.flexputCircuitsClassA;

  const byCurrent = loadAmps == null ? null : Math.ceil(loadAmps / perCircuit);
  const byTopology = wiringClass === "CLASS_A" ? classACircuits : classBCircuits;
  const applicable = [byCurrent, drawingNacCircuits].filter((v) => v != null && v > 0);
  const required = applicable.length ? Math.max(...applicable) : 0;

  return {
    state: loadAmps == null ? "NOT_COMPUTABLE" : "COMPUTED",
    byCurrentAmps: byCurrent,
    byTopologyCircuitsAvailable: byTopology,
    drawingExplicitCircuits: drawingNacCircuits,
    syncZoneBreaks,
    requiredCircuits: loadAmps == null ? null : required,
    bindingConstraint: loadAmps == null ? null
      : [byCurrent === required && "CURRENT", drawingNacCircuits === required && "DRAWING_EXPLICIT"]
          .filter(Boolean).join("+") || "TOPOLOGY",
    formula: loadAmps == null ? null
      : `ceil(${loadAmps} A / ${perCircuit} A per circuit) = ${byCurrent}; drawing states ${drawingNacCircuits}; required = max(...) = ${required}`,
    note:
      "Circuit COUNT and CURRENT CAPACITY are independent constraints. A panel may have spare circuits " +
      "and still be power-limited, or ample power and too few circuits.",
  };
}

/**
 * RPS right-sizing. BOTH constraints must pass: the added circuit COUNT and the
 * added CURRENT. Sizing on current alone under-buys circuits; sizing on count
 * alone over-buys power.
 */
export function rpsRightSizing({ nativeCircuitsUsable, nativeUsableAmps, requiredCircuits, requiredAmps }) {
  const needCircuits = Math.max(0, requiredCircuits - nativeCircuitsUsable);
  const needAmps = Math.max(0, Math.round((requiredAmps - nativeUsableAmps) * 1000) / 1000);
  if (needCircuits === 0 && needAmps === 0) {
    return { state: "NATIVE_PANEL_SUFFICIENT", rpsQuantity: 0, needCircuits, needAmps, byCircuit: 0, byCurrent: 0 };
  }
  const byCurrent = needAmps > 0 ? Math.ceil(needAmps / RPS_1000_CAPACITY.usableOutputAmps) : 0;
  const byCircuit = needCircuits > 0 ? Math.ceil(needCircuits / RPS_1000_CAPACITY.flexputCircuits) : 0;
  return {
    state: "RPS_REQUIRED",
    rpsQuantity: Math.max(byCurrent, byCircuit),
    byCircuit,
    byCurrent,
    needCircuits,
    needAmps,
    rule: "quantity = max(byCurrent, byCircuit); BOTH constraints must pass",
  };
}

/**
 * 6815 physical mounting allocation.
 *
 * SLC expansion REQUIREMENT and physical MOUNTING REQUIREMENT are different
 * reasons. An RPS is never added merely to obtain 6815 mounting space unless it
 * is otherwise required for power; conversely, when an RPS IS required for
 * power, its legitimate cabinet slots are consumed before any remote enclosure.
 */
export function mountingAllocation({ required6815, panelSlots, rpsQuantity, rpsSlotsPerCabinet, rpsRequiredForPower }) {
  let remaining = required6815;
  const panelSlotsUsed = Math.min(panelSlots, remaining);
  remaining -= panelSlotsUsed;
  const rpsSlotsAvailable = rpsRequiredForPower ? rpsQuantity * rpsSlotsPerCabinet : 0;
  const rpsSlotsUsed = Math.min(rpsSlotsAvailable, remaining);
  remaining -= rpsSlotsUsed;
  return {
    state: remaining > 0 ? "REMOTE_MOUNTING_REQUIRED" : "FULLY_MOUNTED_IN_EXISTING_ENCLOSURES",
    required6815,
    panelSlots,
    panelSlotsUsed,
    rpsQuantity,
    rpsRequiredForPower,
    rpsSlotsAvailable,
    rpsSlotsUsed,
    remainingUnmounted6815: remaining,
    remoteEnclosures5815RMK: remaining > 0 ? Math.ceil(remaining / 2) : 0,
    rule:
      "Consume panel cabinet slots first, then the slots of RPS cabinets that are ALREADY required for " +
      "power, and only then compute remote 5815RMK demand (2 x 6815 per cabinet).",
    separateReasons: { powerRequirement: rpsRequiredForPower, mountingRequirement: remaining > 0 },
  };
}

/**
 * Voltage-drop readiness. NEVER invents a cable length.
 * Every input is classified so the missing evidence is explicit.
 */
/**
 * NAC CONDUCTOR EVIDENCE.
 *
 * CORRECTION to an earlier conclusion in this same workstream. The previous
 * slice inferred a 2.5 mm2 NAC conductor from the spatial adjacency of the text
 * "2 X 2.5 sq.mm CWZ FIRE RESISTANT CABLE" and the token "NAC LOOP" on the WLC
 * and AMS-002 sheets. That inference is now SUPERSEDED by the drawing's own
 * explicit cable schedule, which says the opposite for the notification circuits.
 *
 * Because the two disagree, the conductor size is carried as an UNRESOLVED
 * DISCREPANCY rather than silently corrected in either direction: 1.5 mm2 and
 * 2.5 mm2 differ by roughly 2.8x in conductor resistance, so voltage drop
 * readiness genuinely turns on which is correct.
 */
export const NAC_CONDUCTOR_EVIDENCE = Object.freeze({
  scheduleStatement:
    "FIRE ALARM CABLE DETAILS: 1.5sq.mm. CWZ CABLE FOR FIRE ALARM CIRCUIT / 1.5sq.mm. CWZ CABLE FOR LOOP " +
    "POWERED STROBES AND SOUNDERS / 2.5sq.mm, CWZ CABLE FOR FIRE ALARM EVACUATION SYSTEM",
  scheduleSource: "Fire Alarm general notes, drawing 2401232-PC-AMS-DR-T-00-ZZZ-002",
  scheduleSaysNotificationSqMm: 1.5,
  scheduleSaysEvacuationSqMm: 2.5,
  networkDiagramSays: "2.5MM TWO CORE CWZ CATEGORY FIRE RATED COPPER CABLE",
  networkDiagramSource: "Overall Fire Alarm Panel Network Diagram, drawing 2401232-PC-AMS-DR-T-93-ZZZ-001",
  conductorMaterial: "COPPER",
  conductorMaterialProposition:
    "\"2.5MM TWO CORE CWZ CATEGORY FIRE RATED COPPER CABLE\" -- the material is stated as COPPER on the " +
    "network diagram, and the cable-schedule code C/W/Z denotes the fire-resistance classes, not the conductor.",
  state: "DISCREPANCY__NOT_SILENTLY_RESOLVED",
  discrepancy:
    "The explicit cable schedule assigns 1.5 sq.mm to the notification (loop powered strobes and sounders) " +
    "circuits and 2.5 sq.mm to the EVACUATION system, while the network diagram annotates 2.5 mm2 two-core " +
    "copper adjacent to a NAC LOOP callout. The schedule is the more specific statement about the notification " +
    "circuits, so 1.5 sq.mm is the better-supported value, but the contradiction is recorded and the " +
    "consultant should confirm it.",
  effectOnVoltageDrop:
    "MATERIAL but not computed. 1.5 mm2 and 2.5 mm2 differ by about 2.8x in loop resistance, so the conductor " +
    "size is a first-order voltage-drop input. Route length is still absent, so voltage drop remains NOT " +
    "COMPUTABLE regardless of which size is confirmed.",
  supersededEarlierConclusion:
    "The previous slice's 'NAC = 2 X 2.5 sq.mm' reading came from a spatial-adjacency inference on a single " +
    "sheet and is superseded by the explicit cable schedule above.",
});

/**
 * BATTERY POWER-SOURCE LEDGER.
 *
 * The audit requirement is that every powered load belongs to EXACTLY ONE
 * battery-backed supply. Two failure modes must be rejected outright:
 *
 *   DOUBLE_POWER_ASSIGNMENT -- the same load counted in two banks
 *   UNASSIGNED_POWER_LOAD   -- a load in neither bank
 *
 * The governing rule is that PHYSICAL MOUNTING LOCATION DOES NOT DETERMINE
 * ELECTRICAL OWNERSHIP. A 6815 expander may be bolted inside an RPS-1000
 * cabinet, but a 6815 is an SBUS device: it is powered from the SBUS power of
 * the panel it is wired to, and its current lands on THAT panel's battery. An
 * enclosure that physically holds a board does not thereby supply it.
 */
export const POWER_SOURCE = Object.freeze({
  IFP_PANEL_BANK: "IFP_PANEL_BANK",
  RPS_BANK: "RPS_BANK",
});

export const POWER_OWNERSHIP_RULE = Object.freeze({
  principle: "ELECTRICAL_TERMINAL_PAIR_DETERMINES_OWNERSHIP__NOT_PHYSICAL_CABINET",
  statement:
    "Battery ownership is determined by WHICH TERMINAL PAIR the device is wired to -- the manufacturer's " +
    "wiring architecture -- and NEVER by which cabinet the device is physically bolted into.",
  decisiveText:
    "IFP-2100 manual 151153-analogue: 'RPS-1000 Terminals 30-33 are used only for connection RPS-1000 to " +
    "the FACP or to the controlling RPS-1000. Use RPS-1000 Terminals 16-19 to connect other SBUS modules " +
    "(SLC expanders, annunciators, 5824) and to daisy-chain RPS-1000 modules.' (RPS-1000 installation " +
    "manual 151153 Rev R). The RPS-1000 terminal table rates terminals 18/19 'SBUS power 24 VDC 1.0 A' but " +
    "terminals 32/33 'MAIN RPS-1000 SBUS power (from FACP) 24 VDC 10 mA' -- so an upstream SBUS feed can " +
    "only carry 10 mA and cannot power a 78 mA expander.",
  workedExample:
    "A 6815 SLC Expander carries 78 mA standby and alarm and has no local supply. The SAME 78 mA row appears " +
    "in BOTH the IFP-2100 current-draw worksheet (Table 3.2) and the RPS-1000 current-draw worksheet (Table " +
    "2.4). That is the manufacturer's own accounting: the expander is charged to the battery of the unit " +
    "whose SBUS OUT it is wired to -- the PANEL bank if wired to the panel's SBUS 1/2 OUT, or the RPS-1000 " +
    "bank if wired to RPS terminals 16-19. A 6815 physically mounted in an RPS-1000 cabinet and wired to that " +
    "RPS-1000 is therefore an RPS load; the same board wired to the panel is a panel load. The cabinet is not " +
    "the signal.",
  nacRule:
    "Notification load is owned by whichever Flexput output actually sources it. The panel sources up to its " +
    "9 A native total; the remainder is sourced by the RPS units. Load sourced by an RPS must not also appear " +
    "in the parent panel's battery bank.",
  wiringDecisionIsUnprovenForThisProject:
    "The governed drawings show the campus PANEL NETWORK (fibre between FACPs and the MFACP) but do NOT show " +
    "6815 SBUS wiring, so whether each expander is wired to its panel or to an RPS-1000 is NOT EVIDENCED. " +
    "Both wirings are therefore computed and reported. This is a design decision still to be made, and it " +
    "moves current between banks without necessarily changing the selected battery size.",
  rejected: Object.freeze([
    "DOUBLE_POWER_ASSIGNMENT", "UNASSIGNED_POWER_LOAD",
    "POWER_LOAD_ASSIGNED_TO_OTHER_BANK", "PHYSICAL_MOUNTING_MISTAKEN_FOR_POWER_OWNERSHIP",
  ]),
  wiringOwnership:
    "Each row may declare ownerByWiring -- the supply the manufacturer wiring connects it to. It is compared " +
    "against the bank the load is booked into, and a disagreement is reported as " +
    "PHYSICAL_MOUNTING_MISTAKEN_FOR_POWER_OWNERSHIP rather than silently accepted.",
  deviceOwners: Object.freeze({
    "6815 SLC expander": "DEPENDS_ON_TERMINAL_PAIR__PANEL_OR_RPS",
    "SK-NIC": POWER_SOURCE.IFP_PANEL_BANK,
    "RPS-1000 own output circuits": POWER_SOURCE.RPS_BANK,
  }),
});

const REJECTED_OWNERSHIP_CODES = Object.freeze([
  "UNASSIGNED_POWER_LOAD", "DOUBLE_POWER_ASSIGNMENT", "POWER_LOAD_ASSIGNED_TO_OTHER_BANK",
  "PHYSICAL_MOUNTING_MISTAKEN_FOR_POWER_OWNERSHIP",
]);

/**
 * Build one enclosure's ledger from explicit rows and audit ownership.
 * A row MUST name exactly one powerSource; a row with none is a defect, not a
 * silently ignored entry.
 */
export function buildPowerSourceLedger({ panelId, bank, rows }) {
  const withTotals = rows.map((r) => {
    const q = r.quantity ?? 0;
    const st = r.standbyPerDeviceMa == null ? null : r.standbyPerDeviceMa * q;
    const al = r.alarmPerDeviceMa == null ? null : r.alarmPerDeviceMa * q;
    return { ...r, standbyTotalMa: st, alarmTotalMa: al };
  });

  const findings = [];
  for (const r of withTotals) {
    if (!r.powerSource) {
      findings.push({ code: "UNASSIGNED_POWER_LOAD", panelId, label: r.label });
    } else if (r.powerSource !== bank) {
      findings.push({ code: "POWER_LOAD_ASSIGNED_TO_OTHER_BANK", panelId, label: r.label, declared: r.powerSource, bank });
    }
    // A row may declare the WIRING owner independently of where it is booked. If
    // the booking disagrees with the wiring, the cabinet it sits in has been
    // mistaken for its power source.
    if (r.ownerByWiring && r.ownerByWiring !== r.powerSource) {
      findings.push({
        code: "PHYSICAL_MOUNTING_MISTAKEN_FOR_POWER_OWNERSHIP",
        panelId, label: r.label, declared: r.powerSource, ownerByWiring: r.ownerByWiring,
        physicalMountedIn: r.physicalMountedIn ?? null,
      });
    }
    if (r.standbyPerDeviceMa == null || r.alarmPerDeviceMa == null) {
      findings.push({ code: "UNEVIDENCED_DEVICE_CURRENT", panelId, label: r.label });
    }
  }

  // A duplicated label inside one bank is the signature of a double assignment.
  const seen = new Map();
  for (const r of withTotals) {
    if (seen.has(r.label)) findings.push({ code: "DOUBLE_POWER_ASSIGNMENT", panelId, label: r.label, bank });
    seen.set(r.label, true);
  }

  const complete = withTotals.filter((r) => r.standbyTotalMa != null && r.alarmTotalMa != null);
  const incomplete = withTotals.filter((r) => r.standbyTotalMa == null || r.alarmTotalMa == null);
  // The FLOOR sums only rows whose current is evidenced. It is always available,
  // so an unevidenced row degrades the result instead of erasing it.
  const standbyFloorMa = complete.reduce((a, r) => a + r.standbyTotalMa, 0);
  const alarmFloorMa = complete.reduce((a, r) => a + r.alarmTotalMa, 0);
  const standbyTotalMa = incomplete.length ? null : standbyFloorMa;
  const alarmTotalMa = incomplete.length ? null : alarmFloorMa;

  return {
    panelId, bank,
    rows: withTotals,
    standbyTotalMa, alarmTotalMa, standbyFloorMa, alarmFloorMa,
    incompleteRows: incomplete.map((r) => r.label),
    findings,
    state: findings.some((f) => REJECTED_OWNERSHIP_CODES.includes(f.code))
      ? "OWNERSHIP_VIOLATION" : "OWNERSHIP_VERIFIED",
    caseIsFloor: incomplete.length > 0,
    caseNote: incomplete.length > 0
      ? "At least one row has no evidenced current, so this bank is a FLOOR that can only be revised upward."
      : "Every row carries an evidenced current.",
  };
}

/**
 * Audit ownership across every bank. A NAC load that is sourced by an RPS must
 * be absent from the panel bank, and a load must not appear in two banks.
 */
export function auditPowerOwnership(ledgers) {
  const findings = [];
  for (const l of ledgers) findings.push(...l.findings);

  // Cross-bank check: any row label appearing in more than one bank.
  const byLabel = new Map();
  for (const l of ledgers) {
    for (const r of l.rows) {
      if (!byLabel.has(r.loadKey)) byLabel.set(r.loadKey, []);
      byLabel.get(r.loadKey).push({ bank: l.bank, panelId: l.panelId, rpsSourced: r.rpsSourced === true });
    }
  }
  for (const [loadKey, where] of byLabel) {
    const panels = new Set(where.map((w) => w.panelId));
    if (where.length > 1 && panels.size === 1) {
      findings.push({ code: "DOUBLE_POWER_ASSIGNMENT", loadKey, where });
    }
  }
  // Any RPS-sourced load that also sits in a panel bank on the same panel.
  for (const [loadKey, where] of byLabel) {
    if (where.some((w) => w.rpsSourced) && where.length > 1) {
      findings.push({ code: "RPS_SOURCED_LOAD_PRESENT_IN_PANEL_BANK", loadKey, where });
    }
  }
  return {
    state: findings.length ? "OWNERSHIP_VIOLATION" : "OWNERSHIP_VERIFIED",
    findings,
    checkedBanks: ledgers.length,
  };
}

/**
 * Battery amp-hour for ONE independently powered enclosure, using the
 * MANUFACTURER'S OWN A-J worksheet method.
 *
 * Two readings are produced, never silently merged:
 *
 *   LITERAL_SINGLE_LINE_D  -- line D is a single total and both G and I derive
 *                            from it, exactly as printed. Conservative, and for
 *                            a system with real notification load it can exceed
 *                            the enclosure's own charger ceiling.
 *   TWO_CONDITION          -- line G ("Total standby AH") and line I ("Total
 *                            alarm AH") are separately labelled, so each uses
 *                            the current for its own condition. This is the
 *                            physically meaningful reading and is the one
 *                            compared against the charger ceiling.
 *
 * The derating factor is the manual's explicit 1.25 for the IFP-2100 worksheet.
 * The RPS-1000 worksheets carry NO derating row, so none is applied there.
 */
export function batteryAhForEnclosure({
  enclosureId, standbyLoadMa, alarmLoadMa, standbyHours, alarmMinutes,
  enclosureType = "IFP_2100", marginPct = null,
}) {
  if (standbyLoadMa == null || alarmLoadMa == null) {
    return {
      enclosureId, state: "NOT_COMPUTABLE",
      missing: [standbyLoadMa == null ? "standby load" : null, alarmLoadMa == null ? "alarm load" : null].filter(Boolean),
      pooled: false,
    };
  }
  const alarmHours = alarmMinutes / 60;               // 30 min -> exactly 0.5 h
  // The RPS-1000 worksheets carry no derating row, so none is applied there.
  // Otherwise the manufacturer's own 1.25 is used unless the project states its
  // own margin, in which case the project value governs.
  const factor = enclosureType === "RPS_1000"
    ? 1
    : (marginPct != null ? 1 + marginPct / 100 : BATTERY_WORKSHEET_METHOD.deratingFactor);

  const standbyAh = (standbyLoadMa / 1000) * standbyHours;   // line E(standby) x line F
  const alarmAh = (alarmLoadMa / 1000) * alarmHours;         // line E(alarm)   x line H
  const requiredAh = (standbyAh + alarmAh) * factor;         // line J, then derating

  return {
    enclosureId, state: "COMPUTED", pooled: false, enclosureType,
    standbyLoadMa, alarmLoadMa, standbyHours, alarmMinutes, alarmHours,
    standbyMah: standbyLoadMa * standbyHours,
    alarmMah: alarmLoadMa * alarmHours,
    totalMah: standbyLoadMa * standbyHours + alarmLoadMa * alarmHours,
    standbyAh: round3(standbyAh), alarmAh: round3(alarmAh),
    factor,
    factorNote: enclosureType === "RPS_1000"
      ? "no derating row exists in the RPS-1000 worksheets, so no factor is applied and none is inherited from the IFP-2100"
      : `factor ${factor} (${marginPct != null ? `project ${marginPct}% margin` : "manufacturer Derating Factor 1.25"}), applied ONCE`,
    requiredAh: round3(requiredAh),
    rawAh: round3(requiredAh),
    method: "TWO_CONDITION_COLUMNS",
    methodAuthority: BATTERY_WORKSHEET_METHOD.requiredFormula,
    formula:
      `standby ${(standbyLoadMa / 1000).toFixed(3)} A x ${standbyHours} h = ${round3(standbyAh)} A.h  (line G); ` +
      `alarm ${(alarmLoadMa / 1000).toFixed(3)} A x ${alarmHours} h = ${round3(alarmAh)} A.h  (line I); ` +
      `sum ${round3(standbyAh + alarmAh)} A.h (line J) x ${factor} = ${round3(requiredAh)} Ah`,
    unitNote:
      "The standby and alarm terms are computed from SEPARATE worksheet columns, each in ampere-hours, and " +
      "summed before the derating factor is applied once. Tables 3.5 / 3.6 must then not be treated as if the " +
      "factor were still outstanding, because it is already built into their milliamp values.",
    rejectedAlternative: {
      name: "LITERAL_SINGLE_LINE_D",
      classification: "PDF_TEXT_EXTRACTION_ARTEFACT",
      engineeringValid: false,
      note:
        "An earlier version of this module computed an alternative that applied one worst-case total current " +
        "to BOTH the standby and the alarm term, producing a figure no enclosure charger could support. The " +
        "rendered worksheet shows two separate value columns, so that reading was this module's own " +
        "text-extraction error and is retained only as a parser regression marker.",
    },
  };
}

const round3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Is the unresolved RPS-1000 7-33 AH vs 35 AH / 17 AH vs 18 AH first-party
 * conflict material HERE? Required Ah is computed FIRST, then compared.
 */
export function rpsBatteryConflictMateriality(enclosureResults, { lowerBoundAh, upperBoundAh }) {
  const reqs = enclosureResults.filter((r) => r.state === "COMPUTED").map((r) => r.requiredAh);
  if (!reqs.length) {
    return { state: "NOT_DETERMINABLE", rpsBatteryCapacityConflict: "NOT_DETERMINABLE", reason: "no RPS battery requirement could be computed" };
  }
  const maxReq = Math.max(...reqs);
  if (maxReq < lowerBoundAh) {
    return {
      state: "NON_MATERIAL_TO_CURRENT_PROJECT",
      rpsBatteryCapacityConflict: "NON_MATERIAL_TO_CURRENT_PROJECT",
      maxRequiredAh: maxReq, lowerBoundAh, upperBoundAh,
      reasoning:
        `The largest RPS-1000 battery requirement computed for Al Mousa is ${maxReq} Ah, below the LOWER of the ` +
        `two conflicting first-party bounds (${lowerBoundAh} Ah installation manual / ${upperBoundAh} Ah ` +
        "datasheet). Neither bound is approached, so the unresolved conflict cannot change the RPS battery " +
        "selection for this project. It is RETAINED for future projects, not discarded.",
    };
  }
  return {
    state: "MATERIAL__BLOCKING",
    rpsBatteryCapacityConflict: "MATERIAL__BLOCKING",
    maxRequiredAh: maxReq, lowerBoundAh, upperBoundAh,
    reasoning:
      `The largest RPS-1000 requirement (${maxReq} Ah) reaches or exceeds the lower conflicting bound ` +
      `(${lowerBoundAh} Ah), so which first-party figure applies materially changes the RPS battery.`,
  };
}

export function voltageDropReadiness({ panelId, conductorSqMm, conductorMaterial, routeLengthM, deviceOrder, minApplianceVolts, designMarginPct }) {
  const known = [], missing = [];
  if (conductorSqMm != null) known.push(`conductor size ${conductorSqMm} mm2`);
  else missing.push("conductor size");
  if (conductorMaterial) known.push(`material ${conductorMaterial}`); else missing.push("conductor material");
  if (routeLengthM != null) known.push(`route length ${routeLengthM} m`); else missing.push("route/cable length -- NOT stated on any governed drawing sheet; must not be invented or substituted with straight-line distance");
  if (deviceOrder) known.push("device distribution order along the circuit"); else missing.push("per-circuit device distribution order -- no notification device schedule is authored on the drawings");
  if (minApplianceVolts != null) known.push(`minimum appliance voltage ${minApplianceVolts} V`); else missing.push("minimum appliance operating voltage at the end of the circuit");
  if (designMarginPct != null) known.push(`design margin ${designMarginPct}%`); else missing.push("applicable design margin / maximum permitted voltage drop");
  return {
    panelId,
    state: missing.length ? "NOT_COMPUTABLE" : "COMPUTABLE",
    known, missing,
    blocking: missing.length ? missing : null,
    note:
      "Conductor size IS proven by the drawings, so voltage drop is not blocked on it. It is blocked on " +
      "route length, which no governed drawing states. A straight-line building distance is NOT a cable route.",
  };
}

/**
 * Battery input ledger -- per-device currents, all UL values from the
 * FIRST-PARTY IFP-2100/ECS Installation Manual Rev E (LS10143-001SK-E:E,
 * 8/29/2022) Table 3.2 "Current Draw Worksheet for IDP SLC Devices", plus the
 * 6815 Product Installation Document LS10173-001SK-E:A section 1.3.
 *
 * The project REQUIREMENT comes from the project specification, which outranks
 * manufacturer literature in the engineering evidence hierarchy.
 */
export const BATTERY_REQUIREMENT_EVIDENCE = Object.freeze({
  source: "Technical Specification 28 46 00 - Fire Detection and Alarm System - Rev 1, section 1.10 POWER REQUIREMENTS",
  projectId: PROJECT,
  standbyHours: 24,
  alarmMinutes: 30,
  marginPct: 20,
  batteryType: "sealed lead-acid, maintenance-free (1.10 F)",
  parallelBatteriesPermitted: false,
  propositions: Object.freeze({
    standbyAndAlarm: "Battery backups must provide at least 24 hours of supervisory operation followed by 30 minutes of full-load alarm operation, or longer if required by code.",
    margin: "The nominal battery capacity should be rated with a 20% margin.",
    type: "All batteries supplied must be sealed lead-acid and maintenance-free.",
    parallel: "Using multiple batteries connected in parallel to increase capacity is not permitted, as it would compromise supervision of individual battery leads.",
    spareCapacity: "The system's capacity shall fully meet all specified requirements outlined in the Contract Documents and include an additional 20% spare capacity.",
  }),
  manufacturerCorroboration:
    "IFP-2100/ECS Manual Rev E: 'The control panel battery charge capacity is 17 to 55 AH. Use 12V batteries " +
    "of the same AH rating. ... Wire batteries in series to produce a 24-volt equivalent. Do not parallel " +
    "batteries to increase the AH rating.' The manufacturer independently forbids the same parallel solution " +
    "the project specification forbids, so the battery is a SINGLE-BANK capacity problem bounded at 55 Ah.",
});

/**
 * THE MANUFACTURER'S BATTERY WORKSHEET METHOD, read verbatim from
 * LS10143-001SK-E Rev E section 3.5.2 Table 3.2 (Continued) lines A-J.
 *
 *   A  Total System Current
 *   B  Auxiliary Devices Current
 *   C  Notification Appliances Current
 *   D  Total current ratings of all devices in system (line A + line B + C)
 *   E  Total current ratings converted to amperes (line D x 0.001)
 *   F  Number of standby hours
 *   G  Multiply lines E and F.   Total standby AH
 *   H  Alarm sounding period in hours. (For example, 5 minutes = 0.0833 hours)
 *   I  Multiply lines E and H.   Total alarm AH
 *   J  Add lines G and I.
 *   Multiply by the Derating Factor   1.25
 *   Total ampere hours required
 *
 * TWO CONSEQUENCES THAT MATTER, both verified against the printed page:
 *
 * 1. The alarm duration is entered in HOURS and the manual itself demonstrates
 *    converting minutes to hours ("5 minutes = 0.0833 hours"). The project's
 *    30 minutes is therefore a legitimate input as 0.5 h, following the identical
 *    arithmetic. This also means Tables 3.5 / 3.6, which tabulate only 5, 15 and
 *    20 minute columns, are NOT the route for a 30-minute requirement.
 *
 * 2. Line D carries TWO value cells and line E carries TWO ampere cells, one
 *    under the Standby Current column and one under the Alarm Current column.
 *    D and E are therefore computed SEPARATELY for the two conditions, and the
 *    battery is:
 *
 *        RequiredAh = (StandbyCurrent_A x standbyHours + AlarmCurrent_A x alarmHours) x 1.25
 *
 *    An earlier version of this module also carried a "LITERAL_SINGLE_LINE_D"
 *    alternative that applied one worst-case total to BOTH terms. That was a
 *    PDF TEXT-EXTRACTION ARTEFACT of this module's own reading, not a real
 *    alternative: the rendered table shows two distinct columns, and the
 *    artefact produced an ampere-hour figure no charger could support. It is
 *    retained ONLY as a labelled parser regression marker and is never used as an
 *    engineering result.
 */
export const BATTERY_WORKSHEET_METHOD = Object.freeze({
  document: "Honeywell IFP-2100/IFP-2100ECS Installation Manual LS10143-001SK-E Rev E, 8/29/2022, Sec 3.5.2, Table 3.2 (Continued)",
  lines: Object.freeze({
    D: "Total current ratings of all devices in system (line A + line B + C)",
    E: "Total current ratings converted to amperes (line D x 0.001)",
    F: "Number of standby hours",
    G: "Multiply lines E and F.  Total standby AH",
    H: "Alarm sounding period in hours. (For example, 5 minutes = 0.0833 hours)",
    I: "Multiply lines E and H.  Total alarm AH",
    J: "Add lines G and I.",
    derating: "Multiply by the Derating Factor  1.25",
  }),
  columnStructure: {
    header: "Device | # of Devices | Current per Device | Standby Current | Alarm Current",
    lineD: "Total current ratings of all devices in system (line A + line B + C)  -- printed with TWO value cells, 'mA' under Standby Current and 'mA' under Alarm Current",
    lineE: "Total current ratings converted to amperes (line D x 0.001):  -- printed with TWO value cells, 'A' under Standby Current and 'A' under Alarm Current",
    lineG: "Multiply lines E and F.  Total standby AH  -- result cell sits under the STANDBY column",
    lineI: "Multiply lines E and H.  Total alarm AH  -- result cell sits under the ALARM column",
    lineJ: "Add lines G and I.  AH",
    verificationMethod:
      "Confirmed by rendering page 24 of LS10143-001SK-E Rev E to an image and reading the table directly, " +
      "because flattened text extraction collapses the two parallel columns into a single 'A A' token run.",
  },
  literalSingleLineDClassification: "PDF_TEXT_EXTRACTION_ARTEFACT",
  requiredFormula:
    "RequiredAh = (StandbyCurrent_A x standbyHours + AlarmCurrent_A x alarmHours) x DeratingFactor",
  deratingFactor: 1.25,
  deratingNote:
    "The worksheet's explicit factor is 1.25, which is the same 20% derating the manual says is " +
    "'built in' to the Table 3.5 / 3.6 milliamp figures. The two routes are therefore ALTERNATIVE: apply " +
    "1.25 when using the A-J worksheet, and do NOT apply it again when checking against Table 3.5, " +
    "because the derating is already inside those milliamp values.",
  rpsHasNoDeratingRow:
    "The RPS-1000 worksheets in installation manual 151153 Rev R end at line J and carry NO " +
    "'Multiply by the Derating Factor 1.25' row. Porting the IFP-2100 factor into an RPS-1000 " +
    "calculation would add a factor the RPS-1000 manual does not state.",
  rpsTable23Note:
    "RPS-1000 Table 2.3 'Maximum Battery Standby Load' tabulates 7, 12, 17 and 33 Ah for 24 hr standby " +
    "with 5 mins. alarm, and 60 hr standby with 5 mins. alarm, and states 'NOTE: The maximum battery size " +
    "for FM (Factory Mutual) installations is 33AH.'",
  alarmDurationArbitraryHours: true,
  tablesAreNotTheRouteFor30Minutes:
    "Tables 3.5 and 3.6 tabulate only 5, 15 and 20 minute alarm columns. For the project's 30-minute " +
    "requirement the A-J worksheet is the manufacturer-supported route, per its own Line H.",
  replacementInterval: "IT IS RECOMMENDED THAT YOU REPLACE BATTERIES EVERY FIVE YEARS.",
  doNotUndersize:
    "FARENHYT DOES NOT SUPPORT THE USE OF BATTERIES SMALLER THAN THOSE LISTED IN TABLES 3.5 AND 3.6. IF " +
    "YOU USE A BATTERY TOO SMALL FOR THE INSTALLATION, THE SYSTEM COULD OVERLOAD THE BATTERY RESULTING " +
    "IN THE INSTALLATION HAVING LESS THAN THE REQUIRED 24 HOURS STANDBY POWER.",
});

/** RPS-1000 maximum battery standby load, manual 151153 Rev R Table 2.3. */
export const RPS_BATTERY_TABLE = Object.freeze({
  source: "Honeywell Farenhyt RPS-1000/RPS-1000HV Installation Manual 151153 Rev R, 2/15/2022, ECN 151770, Table 2.3",
  caption: "Maximum Battery Standby Load",
  builtInDeratingPct: 20,
  twentyFourHourStandby: Object.freeze({ 7: 270, 12: 475, 17: 685, 33: 1370 }),
  sixtyHourStandby: Object.freeze({ 7: 105, 12: 190, 17: 270, 33: 540 }),
  alarmColumnOnly: "5 mins. Alarm",
  fmMaxAh: 33,
  perUnitBasis:
    "\"For each RPS-1000 in the installation, use this worksheet to determine current requirements during " +
    "the alarm and battery standby operation.\" The RPS-1000 is its own power source: \"The RPS-1000 " +
    "supports its own backup battery and monitors the AC power.\" Each RPS battery is therefore sized " +
    "independently and the panel's battery is absent from the RPS worksheet entirely.",
});

/** Per-device UL currents, mA. `null` means the value was not evidenced. */
export const BATTERY_DEVICE_CURRENT_MA = Object.freeze({
  ifp2100Panel: Object.freeze({ standby: 230, alarm: 415, proposition: "Fire Panel (Current draw from battery) 1 | Standby 230 mA | Alarm: 415 mA -- Table 3.2" }),
  // CLOSED THIS SLICE. The IDP-HEAT-ROR row was never missing: it sits inside a
  // VERTICALLY MERGED 'Current per Device' cell spanning seven rows, so plain
  // text extraction yielded no numbers. Re-extracting by text-matrix coordinates
  // shows the merged cell reading "Standby: 0.3 mA" / "Alarm: 6.5 mA".
  idpHeatRor: Object.freeze({ standby: 0.3, alarm: 6.5, proposition:
    "Table 3.2 merged 'Current per Device' cell spanning IDP-PHOTO / IDP-PHOTO-T / IDP-PHOTO-R / IDP-HEAT / " +
    "IDP-HEAT-HT / IDP-HEAT-ROR / IDP-ACCLIMATE reads 'Standby: 0.3 mA' and 'Alarm: 6.5 mA'. There is NO " +
    "ROR-specific figure; the merged cell is the authority for the IDP-HEAT-ROR row." }),
  // The -IV variant, which is the Al Mousa incumbent, is in the -W/-IV group.
  idpHeatRorIV: Object.freeze({ standby: 0.2, alarm: 4.5, proposition:
    "Table 3.2 (Continued) merged 'Current per Device' cell spanning IDP-PHOTO-W/-IV / IDP-PHOTO-T-W/-IVIV / " +
    "IDP-PHOTO-R-W/-IV / IDP-HEAT-W/-IV / IDP-HEAT-HT-W/-IV / IDP-HEAT-ROR-W/-IV / IDP-PHOTO-CO-W / IDP-CO-W " +
    "reads 'Standby: 0.2 mA' and 'Alarm: 4.5 mA'. Corroborated by IDP-HEAT-W Data Sheet 351630 Rev A: " +
    "'Standby Current (@ 24 VDC): 200UA' and 'Max Current (max.): 4.5mA @ 24VDC'." }),
  idpPhoto: Object.freeze({ standby: 0.2, alarm: 4.5, proposition: "IDP-PHOTO-W/-IV Standby: 0.2 mA Alarm: 4.5 mA -- Table 3.2 (Continued)" }),
  idpMonitor: Object.freeze({ standby: 0.375, alarm: 0.375, proposition: "IDP-MONITOR Standby/Alarm 0.375 mA -- Table 3.2" }),
  idpMonitor2: Object.freeze({ standby: 0.75, alarm: 0.75, proposition: "IDP-MONITOR-2 Standby/Alarm: 0.75 mA -- Table 3.2" }),
  idpControl: Object.freeze({ standby: 2.075, alarm: 6.875, proposition: "IDP-CONTROL SLC Standby 0.375 mA Alarm: 0.375 mA; Aux Pwr Standby 1.7 mA Alarm: 6.5mA -- Table 3.2 (SLC + auxiliary summed)" }),
  idpZone: Object.freeze({ standby: 12.27, alarm: 95.1, proposition: "IDP-ZONE Aux Pwr Standby 12 mA Alarm: 90 mA; SLC Standby: 0.27 mA Alarm: 5.1 mA -- Table 3.2 (SLC + auxiliary summed)" }),
  expander6815: Object.freeze({ standby: 78, alarm: 78, proposition: "Standby Current: 78mA; Alarm Current: 78mA -- LS10173-001SK-E:A 1.3 Specifications" }),
  rps1000: Object.freeze({ standby: 40, alarm: 160, proposition:
    "RPS-1000 Intelligent Power Module (Current draw from battery) 1 | Standby 40 mA | Alarm: 160 mA -- " +
    "manual 151153 Rev R Table 2.4, corroborated by datasheet 350070 Rev M 'Currents: Standby: 40mA Alarm: 160mA'. " +
    "Daisy-chained additional RPS-1000 (7 max.) draw 10 mA standby/alarm." }),
  sbus5496: Object.freeze({ standby: 10, alarm: 10, proposition: "5496 NAC Expander Standby/Alarm (SBUS): 10 mA -- Table 3.2" }),
  ledAnnunciator: Object.freeze({ standby: 35, alarm: 145, proposition: "5865-4 / 5865-3 LED Annunciator Standby: 35 mA Alarm: 145 mA -- Table 3.2" }),
  printer5824: Object.freeze({ standby: 45, alarm: 45, proposition: "5824 Serial/Parallel Module Standby/Alarm: 45 mA -- Table 3.2" }),
  // CLOSED. Two first-party documents give DIFFERENT figures and they are NOT the
  // same parameter, so both are retained and the conservative one is used.
  //   Doc 350286 Rev H, ELECTRICAL RATINGS: "SLC Standby and Alarm Current: 375uA and 5 mA"
  //     -- two separate values: standby 375 uA, alarm 5 mA.
  //   LS10143-001SK-E Rev E, Table 3.2, Addressable SLC Modules:
  //     "IDP-PULL-SA/IDP-PULL-DA  Standby/Alarm  0.3 mA" -- one combined value.
  // The data sheet figure is higher in BOTH conditions, so it is the conservative
  // choice and is used for sizing. The worksheet's single 0.3 mA is retained.
  idpPullStandbyAlarm: Object.freeze({
    standby: 0.375, alarm: 5,
    proposition:
      "Doc 350286 Rev H 11/17, ELECTRICAL RATINGS, page 2: 'Operating Voltage: 15 - 32VDC / SLC Standby and " +
      "Alarm Current: 375uA and 5 mA / Wire Gauge: Up to 12AWG (3.1 mm2)'.",
    worksheetProposition:
      "LS10143-001SK-E Rev E 8/29/2022, Table 3.2 (Continued), Addressable SLC Modules: 'IDP-PULL-SA/IDP-PULL-DA " +
      "Standby/Alarm 0.3 mA'.",
    conflict:
      "OFFICIAL_DOCUMENTATION_CONFLICT -- two current first-party documents disagree, and they do not even " +
      "state the same parameter: the data sheet separates standby (375 uA) from alarm (5 mA) while the panel " +
      "worksheet gives one combined 'Standby/Alarm 0.3 mA'. The data sheet figure is higher in both " +
      "conditions, so it is used as the conservative value and the worksheet figure is retained.",
    conflictClass: "HIGHER_VALUE_USED__BOTH_RETAINED",
    qualifier:
      "Neither document labels the figure typical, nominal, max or maximum. The worksheet section 3.5.1 does " +
      "state that the IFP-2100 worksheet lists WORST CASE current draw, which is the governing basis for a " +
      "battery calculation.",
    compatibility:
      "Doc 350286 Rev H COMPATIBILITY lists 'IFP-2100 / IFP-2100ECS / RFP-2100' among compatible FACPs. It does " +
      "NOT list IFP-2100ECSHV or IFP-2100HV, so IFP-2100HV applicability rests on the panel manual's own " +
      "worksheet, which is written for the IFP-2100/IFP-2100ECS platform including the HV supply variant.",
    excludedByFootnote:
      "Table 3.2 footnote 2: 'Total does not include isolator devices or accessory bases.' The IDP-PULL row " +
      "carries no isolator or accessory-base sub-line, so the value excludes those categories.",
  }),
  // Network interface card, powered from the panel's own regulated DC.
  skNic: Object.freeze({ standby: 21, alarm: 21, proposition:
    "Doc 351622 Rev A 11/17, SK-NIC Technical Specifications, ELECTRICAL: 'Operating Voltage: 24VDC / Standby " +
    "Current: 21mA / Alarm Current: 21mA'. Panel side: LS10143-001SK-E Rev E Table 3.1 terminal P7 'Data | " +
    "Network | Used for SK-NIC | 24 VDC | 21 mA', so it is powered from the PANEL's regulated DC and lands on " +
    "the panel battery during AC loss.", powerSource: POWER_SOURCE.IFP_PANEL_BANK,
    applicability:
      "CONDITIONAL. The IFP-2100 has an integral network port; an SK-NIC is required only where the SK protocol " +
      "is used. Whether an Al Mousa panel carries an SK-NIC is not proven by the governed drawings, so it is " +
      "reported as a conditional addition rather than assumed either way." }),
  notificationAppliance: Object.freeze({ standby: null, alarm: null, proposition: null, note:
    "Notification appliances are CONVENTIONAL NAC. Their ALARM current is owned by whichever Flexput output " +
    "sources it (panel native up to 9 A, remainder by an RPS). Their standby supervision current is not " +
    "evidenced and is reported as a gap." }),
  sbusDeviceGeneric: Object.freeze({ standby: 10, alarm: 10, proposition:
    "Standby/Alarm (SBUS): 10 mA -- Table 3.2. Also cited in the RPS-1000 manual Table 2.4 for the " +
    "daisy-chained additional RPS-1000 (7 max.)." }),
  nacExpander5496: Object.freeze({ standby: 10, alarm: 10, proposition:
    "5496 NAC Expander Standby/Alarm (SBUS): 10 mA -- Table 3.2. The 5496 has its own AC input, battery " +
    "charger and backup battery ('provides its own AC power connection, battery charging circuit, and backup " +
    "battery', Doc 350302 Rev H), so only its 10 mA SBUS presence current lands on the panel budget.", powerSource: POWER_SOURCE.IFP_PANEL_BANK, used: false }),
  powerSupply5495: Object.freeze({ standby: 75, alarm: 205, proposition:
    "5495/5499 Power Supply Standby: 75 mA Alarm: 205 mA -- Table 3.2 (Continued). Filed in the worksheet " +
    "immediately before line C 'Notification Appliances Current', i.e. it is a notification-appliance power " +
    "supply. No first-party 5495/5499 data sheet exists on prod-edam.", powerSource: POWER_SOURCE.IFP_PANEL_BANK, used: false }),
});

/**
 * BATTERY SELECTION AUTHORITY.
 *
 * Three things are deliberately kept apart, because conflating them is how an
 * installer ends up with a battery that fits the box but cannot carry the load,
 * or a load that is met by a battery the charger cannot charge:
 *
 *   CALCULATED_REQUIRED_AH    -- what the load demands
 *   SUPPORTED_BATTERY_SIZES   -- what the manufacturer lists
 *   BATTERY_ENCLOSURE_CAPACITY-- what physically fits where
 *
 * A box that can physically hold a battery is NOT authority that the battery is
 * valid. A battery larger than the main cabinet is legitimate PROVIDED an
 * accessory enclosure is used; the charger range, not the cabinet, is the sizing
 * constraint.
 */
export const BATTERY_SELECTION_AUTHORITY = Object.freeze({
  iFP2100: Object.freeze({
    chargerCapacityAh: Object.freeze({ min: 17, max: 55 }),
    mainCabinetMaxBatteryAh: 18,
    mainCabinetQuantity: 2,
    supportedSizesAh: Object.freeze([17, 18, 24, 33, 35, 40, 55]),
    accessoryEnclosures: Object.freeze([
      { model: "RBB", holdsUpToAh: 35, role: "Remote Battery Box for banks too large for the main cabinet" },
      { model: "AB-55", holdsUpToAh: 55, role: "Accessory cabinet for banks up to the charger ceiling" },
    ]),
    selectionRule: "Use next size battery with capacity greater than required (worksheet footnote 7).",
    undersizeWarning:
      "FARENHYT DOES NOT SUPPORT THE USE OF BATTERIES SMALLER THAN THOSE LISTED IN TABLES 3.5 AND 3.6. IF " +
      "YOU USE A BATTERY TOO SMALL FOR THE INSTALLATION, THE SYSTEM COULD OVERLOAD THE BATTERY RESULTING " +
      "IN THE INSTALLATION HAVING LESS THAN THE REQUIRED 24 HOURS STANDBY POWER.",
    enclosureIsNotSizingAuthority:
      "The main cabinet physically accepts two 18 Ah batteries, but the CHARGER accepts 17-55 Ah. A selected " +
      "size above 18 Ah is legitimate and requires an RBB or AB-55 accessory enclosure; conversely a battery " +
      "that fits the cabinet is not thereby proven adequate.",
  }),
  bb26: Object.freeze({
    state: "EXISTS_BUT_NOT_AN_IFP_2100_ACCESSORY",
    document: "Honeywell/Silent Knight Doc. 51858, Rev. A, ECN 01-514, 09/14/2001",
    verbatim:
      "The BB-26 Battery Box is designed to house two 12VDC, 26AH batteries. ... The CHG-75 Charger can " +
      "also be housed in the battery box.",
    role: "Passive dead-front backbox that mechanically houses two 12 V / 26 Ah batteries. It has no charger " +
      "and no AC input of its own; the CHG-75 is an optional separate item.",
    notAuthorisedForIFP2100:
      "The string 'BB-26' appears nowhere in the 178-page IFP-2100 installation manual, and no BB-26 entry " +
      "exists in the prod-edam datasheets (5,465 files) or installation-guides (2,366 files) listings. The " +
      "IFP-2100's own accessory lists name only RBB and SK-SCK; AB-55 is named only in the manual's own " +
      "battery-accessory-cabinet section. BB-26 is therefore a LEGACY Silent Knight / Fire-Lite accessory and " +
      "is NOT an authorised IFP-2100 accessory.",
    noSizingDependency: "No battery selection in this model depends on the BB-26.",
  }),
});

/** Manufacturer battery bounds that constrain any computed Ah. */
export const BATTERY_BOUNDS = Object.freeze({
  chargeCapacityMinAh: 17,
  chargeCapacityMaxAh: 55,
  chargerRangeAh: Object.freeze({ min: 12, max: 200, source: "Spec 28 46 00 Rev 1 -- Addressable Charger Power Supply handles battery capacities from 12 to 200 amp hours" }),
  maxBatteryStandbyTableAh: Object.freeze([17, 18, 24, 33, 35, 40, 55]),
  maxStandbyLoadMa: Object.freeze({
    "17": 535, "18": 569, "24": 769, "33": 1070, "35": 1140, "40": 1300, "55": 1800,
  }),
  tableNote:
    "IFP-2100/ECS Manual Rev E Table 3.5 'Maximum Battery Standby Loads for 24 Hour Standby'. The table " +
    "columns cover 5, 15 and 20 minute alarm durations with a built-in 20% derating factor. The PROJECT " +
    "requires 30 minutes of full-load alarm, which is NOT a tabulated column, so the table alone cannot " +
    "certify the project alarm duration.",
  criticalGap:
    "The project requires 30 minutes of FULL-LOAD alarm. The manufacturer table stops at 20 minutes. " +
    "Sizing to 20 minutes and asserting 30-minute compliance would understate the battery.",
});

/**
 * Battery-sizing readiness. Fails closed with an explicit ledger and the exact
 * missing evidence. Never forces a historical battery size.
 */
export function batteryReadiness({ panelId, standbyLoadMa, alarmLoadMa, unresolvedLoads = [] }) {
  const req = BATTERY_REQUIREMENT_EVIDENCE;
  const missing = [];
  if (standbyLoadMa == null) missing.push("panel standby current total (every battery-powered load quantified)");
  if (alarmLoadMa == null) missing.push("panel full-load alarm current total (notification appliance UL max current not evidenced)");
  if (unresolvedLoads.length) missing.push(...unresolvedLoads.map((l) => `unresolved battery load: ${l}`));

  // Battery is bounded above by the panel's own charge capacity, because neither
  // the project nor the manufacturer permits a parallel bank to exceed it.
  const capacityCeilingAh = BATTERY_BOUNDS.chargeCapacityMaxAh;
  return {
    panelId,
    state: missing.length ? "BLOCKED" : "READY",
    requirements: { standbyHours: req.standbyHours, alarmMinutes: req.alarmMinutes, marginPct: req.marginPct, batteryType: req.batteryType },
    standbyLoadMa,
    alarmLoadMa,
    missingEvidence: missing,
    capacityCeilingAh,
    capacityCeilingReason:
      "Single bank only: the project specification 1.10 M and the manufacturer both forbid parallel batteries " +
      `for capacity, so a panel cannot exceed its ${capacityCeilingAh} Ah charge capacity on one bank.`,
    manufacturerTableGap: BATTERY_BOUNDS.criticalGap,
    note:
      "Duration, margin and battery type are PROVEN from the project specification. The final Ah remains " +
      "BLOCKED until every battery load is quantified AND the 30-minute alarm duration is reconciled with " +
      "the manufacturer's 20-minute table column.",
  };
}
