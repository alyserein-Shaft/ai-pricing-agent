/**
 * GOVERNED FIRE ALARM LEGEND CLASS SEMANTICS.
 *
 * This module holds the classification of the Al Mousa legend mappings into the
 * four authority states, and nothing else. It does NOT parse schedules, does not
 * choose SLC address classes, and does not promote anything.
 *
 * WHY THE AUTHORITY IS SPLIT FOUR WAYS
 * The governing legend rows for this project were approved on 2026-09-24 with
 * 98% structural confidence. That approval turns out to be sound for the mapping
 * itself but insufficient on its own, because approval says a human accepted the
 * row -- it does not itself prove the code sits in the same legend cell as the
 * description. So each mapping is re-checked against the current governed native
 * geometry, and only the ones that agree on both axes are usable:
 *
 *   GOVERNED_AND_PROVEN          approved AND column-aligned in native geometry
 *   GOVERNED_BUT_PROVENANCE_WEAK approved, but geometry does not confirm it
 *   CONFLICTED                   approved rows disagree, or one code means two
 *                                different devices on the sheet
 *   UNRESOLVED                   no project evidence defines it
 *
 * ONLY GOVERNED_AND_PROVEN MAY ENTER DETERMINISTIC SCHEDULE SEMANTICS.
 *
 * THE MEASUREMENT BEHIND EACH VERDICT
 * On the ELV legend sheet (2401232-PC-AMS-DR-T-00-ZZZ-002) the legend is a table
 * with a code band at y 945-975 and a description band at y 1025-1040. A code and
 * its description are associated when the description begins at the same x; every
 * approved mapping measured dx between -2 and +1, i.e. exact column alignment.
 *
 * COMPOUND TOKENS
 * Some legend cells stack two letters in one symbol cell (S over D, CE over M, CE
 * over C). Those letters share ONE description, so they are a single compound
 * device, not two independent codes. The letter SET is what geometry proves. The
 * SPELLING is not recoverable from geometry -- on the real sheet "S D" reads top
 * down while "CE C" reads bottom up -- so compounds are matched by letter set and
 * the governed spelling is carried through verbatim.
 *
 * WHY THIS MATTERS. "T" appears 25 times in the BOS schedule. Reading it as a
 * generic letter and guessing would be inventing project topology. Here it is
 * proven: T = FIREMAN TELEPHONE JACK, column-aligned at dx=-1. That is a passive
 * telephone jack with no SLC address, which is materially different from a
 * module address -- misreading it would have put phantom demand on a loop.
 */

export const LEGEND_AUTHORITY_STATES = Object.freeze([
  "GOVERNED_AND_PROVEN",
  "GOVERNED_BUT_PROVENANCE_WEAK",
  "CONFLICTED",
  "UNRESOLVED",
]);

export const LEGEND_SEMANTICS_VERSION = "fire-alarm-legend-class-semantics-1.0.0";

/**
 * The classifications, measured against the governed Al Mousa intake.
 *
 * `governedSpelling` is the approved legend row's abbreviation, carried verbatim.
 * `letterSet` is the geometry-derived key used to locate the legend column.
 * `alignmentDx` is the measured horizontal offset between the code and the start
 * of its description; a proven mapping is within +/-6.
 */
export const LEGEND_CLASS_AUTHORITY = Object.freeze({
  S: {
    description: "SMOKE DETECTOR",
    state: "GOVERNED_AND_PROVEN",
    governedSpelling: "S",
    letterSet: "S",
    alignmentDx: -0.0000001,
    sourceDocumentId: "doc_5244a162-63b7-47a5-9265-849abca639f5",
    sourcePage: 1,
  },
  H: {
    description: "HEAT DETECTOR",
    state: "GOVERNED_AND_PROVEN",
    governedSpelling: "H",
    letterSet: "H",
    alignmentDx: -1,
    sourceDocumentId: "doc_5244a162-63b7-47a5-9265-849abca639f5",
    sourcePage: 1,
  },
  F: {
    description: "FIRE ALARM MANUAL STATION",
    state: "CONFLICTED",
    governedSpelling: "F",
    letterSet: "F",
    alignmentDx: -0.0000001,
    conflict:
      "The bare code F occupies TWO legend columns on the sheet: x=649 'FIRE ALARM " +
      "MANUAL STATION' and x=668 'FIRE ALARM MANUAL STATION (WEATHER PROOF)'. The " +
      "code alone cannot say which. Two approved rows disagree on the description, " +
      "so neither is usable and no supersession is performed here.",
    sourceDocumentId: "doc_5244a162-63b7-47a5-9265-849abca639f5",
    sourcePage: 1,
  },
  T: {
    description: "FIREMAN TELEPHONE JACK",
    state: "GOVERNED_AND_PROVEN",
    governedSpelling: "T",
    letterSet: "T",
    alignmentDx: -1,
    // A telephone jack is a passive field device: it does not occupy an SLC
    // address. Recorded here so no downstream consumer reads T as a module.
    addressImplication: "NO_SLC_ADDRESS",
    sourceDocumentId: "doc_5244a162-63b7-47a5-9265-849abca639f5",
    sourcePage: 1,
  },
  WP: {
    description: "LOOP POWERED STROBE WITH SOUNDER (WEATHER PROOF TYPE)",
    state: "GOVERNED_AND_PROVEN",
    governedSpelling: "WP",
    letterSet: "WP",
    alignmentDx: 1,
    sourceDocumentId: "doc_5244a162-63b7-47a5-9265-849abca639f5",
    sourcePage: 1,
  },
  // Compound tokens: letters stacked in one symbol cell, one shared description.
  "CE C": {
    description: "INTERFACE MODULE CONTROL",
    state: "GOVERNED_AND_PROVEN",
    governedSpelling: "CE C",
    letterSet: "C+CE",
    alignmentDx: -2,
    compound: true,
    sourceDocumentId: "doc_5244a162-63b7-47a5-9265-849abca639f5",
    sourcePage: 1,
  },
  "CE M": {
    description: "INTERFACE MODULE MONITORING",
    state: "GOVERNED_AND_PROVEN",
    governedSpelling: "CE M",
    letterSet: "CE+M",
    alignmentDx: -1,
    compound: true,
    sourceDocumentId: "doc_5244a162-63b7-47a5-9265-849abca639f5",
    sourcePage: 1,
  },
  "S D": {
    description: "DUCT DETECTOR",
    state: "GOVERNED_AND_PROVEN",
    governedSpelling: "S D",
    letterSet: "D+S",
    alignmentDx: -1,
    compound: true,
    sourceDocumentId: "doc_5244a162-63b7-47a5-9265-849abca639f5",
    sourcePage: 1,
  },
  // Present in the schedules, NOT resolvable from the legend.
  M: {
    description: null,
    state: "GOVERNED_BUT_PROVENANCE_WEAK",
    governedSpelling: "M",
    letterSet: "M",
    note:
      "Bare M appears in schedules 10-25 times. The only legend columns for M are " +
      "compounds (CE M = interface module monitoring) or an unrelated " +
      "'PAGING MICROPHONE'. No approved mapping exists for a bare M, and none is invented.",
  },
  HC: {
    description: null,
    state: "UNRESOLVED",
    governedSpelling: "HC",
    letterSet: null,
    note:
      "HC occurs exactly once (BOS). It is not a legend column on the ELV sheet and " +
      "no project source defines it. Stays UNRESOLVED.",
  },
  CE: {
    description: null,
    state: "UNRESOLVED",
    governedSpelling: "CE",
    letterSet: null,
    note:
      "CE is a schedule class code (11-13 uses per sheet) but is only ever a " +
      "COMPOUND on the legend (CE C, CE M). A bare CE has no legend meaning, so " +
      "it cannot be resolved to a device without inventing one.",
  },
  C: {
    description: null,
    state: "UNRESOLVED",
    governedSpelling: "C",
    letterSet: null,
    note: "Bare C is not a standalone legend column; it appears only inside compounds.",
  },
  D: {
    description: null,
    state: "UNRESOLVED",
    governedSpelling: "D",
    letterSet: null,
    note: "Bare D is not a standalone legend column; it appears only inside 'S D'.",
  },
  // Not fire-alarm device classes at all.
  O: { description: null, state: "UNRESOLVED", note: "O/R pairs appear in the notes block, not the fire alarm schedule." },
  R: { description: null, state: "UNRESOLVED", note: "O/R pairs appear in the notes block, not the fire alarm schedule." },
  SIM: { description: null, state: "UNRESOLVED", note: "SIM is a drawing-layer token with no legend meaning." },
});

/** Codes whose meaning may drive deterministic schedule semantics. */
export const PROVEN_LEGEND_CLASSES = Object.freeze(
  Object.keys(LEGEND_CLASS_AUTHORITY).filter(
    (code) => LEGEND_CLASS_AUTHORITY[code].state === "GOVERNED_AND_PROVEN",
  ),
);

/** Codes observed in schedules that remain unresolved, conflicted, or weak. */
export const UNRESOLVED_LEGEND_CLASSES = Object.freeze(
  Object.keys(LEGEND_CLASS_AUTHORITY).filter(
    (code) => LEGEND_CLASS_AUTHORITY[code].state !== "GOVERNED_AND_PROVEN",
  ),
);

/**
 * The classification of one schedule class code, for a governed consumer.
 *
 * Returns a decision plus an explicit `usableForScheduleSemantics` flag so a
 * caller cannot accidentally treat a conflicted or unresolved code as a device.
 */
export const classifyLegendClass = (code) => {
  const key = String(code ?? "").trim().toUpperCase();
  const entry = LEGEND_CLASS_AUTHORITY[key];
  if (!entry) {
    return {
      code: key,
      state: "UNRESOLVED",
      description: null,
      usableForScheduleSemantics: false,
      reason: "This code is not in the governed legend authority for this project.",
      semanticsVersion: LEGEND_SEMANTICS_VERSION,
    };
  }
  return {
    code: key,
    state: entry.state,
    description: entry.description,
    usableForScheduleSemantics: entry.state === "GOVERNED_AND_PROVEN",
    compound: Boolean(entry.compound),
    addressImplication: entry.addressImplication ?? null,
    reason: entry.note ?? entry.conflict ?? null,
    sourceDocumentId: entry.sourceDocumentId ?? null,
    sourcePage: entry.sourcePage ?? null,
    semanticsVersion: LEGEND_SEMANTICS_VERSION,
  };
};

/**
 * Match a raw schedule token against the governed vocabulary, longest first.
 *
 * Compound tokens must be matched before their component letters, or "CE C" would
 * be read as bare CE followed by bare C and resolve to the wrong device (or to
 * nothing at all). A token is only matched whole: "CEILING" is not CE, and
 * "SIM" is not S followed by IM.
 */
export const matchGovernedLegendToken = (rawToken) => {
  const text = String(rawToken ?? "").trim().toUpperCase();
  if (!text) return null;
  const candidates = Object.keys(LEGEND_CLASS_AUTHORITY).sort((a, b) => b.length - a.length);
  for (const candidate of candidates) {
    if (candidate !== text) continue;
    const result = classifyLegendClass(candidate);
    return result.usableForScheduleSemantics ? result : null;
  }
  return null;
};

/**
 * Split a raw class cell into the governed tokens it represents.
 *
 * Only compounds that are themselves proven are split. An unproven compound
 * yields the cell as UNRESOLVED rather than being decomposed into bare letters,
 * because decomposing it would invent meanings for CE, C, M and D.
 */
export const classifyScheduleClassCell = (rawCell) => {
  const text = String(rawCell ?? "").trim().toUpperCase();
  if (!text) return { cell: rawCell, tokens: [], state: "UNRESOLVED", reason: "Empty cell." };

  // Whole-cell match against a proven token (covers compounds like "CE C").
  const whole = matchGovernedLegendToken(text);
  if (whole) {
    return { cell: rawCell, tokens: [whole], state: "GOVERNED_AND_PROVEN", reason: null };
  }

  const entry = LEGEND_CLASS_AUTHORITY[text];
  if (entry) {
    return {
      cell: rawCell,
      tokens: [],
      state: entry.state,
      reason: entry.note ?? entry.conflict ?? `Code is ${entry.state}; not usable as a device.`,
    };
  }

  return {
    cell: rawCell,
    tokens: [],
    state: "UNRESOLVED",
    reason: "This cell does not match any governed legend token for this project.",
  };
};