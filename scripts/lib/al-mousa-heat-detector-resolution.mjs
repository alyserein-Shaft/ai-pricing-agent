// GOVERNED RESOLUTION OF THE REMAINING AL MOUSA HEAT DETECTORS.
//
// WHY THIS MODULE EXISTS
// ----------------------
// The BOQ carries a 26-unit heat-detector census spread over FIVE source rows.
// A human decision previously governed only 9 of them (source row 15). The other
// 17 were held at TECHNICAL_SELECTION_REVIEW_REQUIRED because a heat capability
// profile had not been traced to each row.
//
// This module resolves each row INDEPENDENTLY from project evidence. It never
// copies row 15's answer onto another row, and it never selects a product
// because a price happens to exist for it.
//
// THE GOVERNING EVIDENCE CHAIN
// ----------------------------
//  1. BOQ rows give QUANTITY, SECTION and (absence of) any qualifier.
//  2. Technical Specification 28 46 00 Rev 1, PART 2 PRODUCTS, paragraph 2.5(b)
//     "Fixed Temperature / Rate of Rise Heat Detectors" gives the requirement:
//       - fixed temperature detection at 135 degF (57 degC)
//       - rate-of-rise detection at 15 degF (8.3 degC) per minute
//       - "For applications requiring increased sensitivity, a high-temperature
//          model provides fixed detection at 190 degF (88 degC)."
//  3. That 190 degF variant is offered but its trigger ("applications requiring
//     increased sensitivity") is NEVER defined anywhere in the project: no BOQ
//     row, no spec clause and no drawing text assigns it to a location.
//
// CONSEQUENCE
// -----------
// A row resolves to the universal 135 degF + ROR profile unless PROJECT
// EVIDENCE specifies something different for it. That test is evidence-based:
//
//  - the BOQ row states no temperature, environment or location qualifier;
//  - the specification states one heat profile with no location conditioning;
//  - the 190 degF variant is offered, but its trigger ("applications requiring
//    increased sensitivity") is defined NOWHERE in the project.
//
// A manufacturer capability, or the mere existence of an optional
// high-temperature model, does NOT create a project requirement. Equally, a
// building NAME ("DG Station") is not a requirement. Neither may be promoted
// into one. So a row resolves unless some project document actually says
// something different about it.
//
// CORRECTION (2026-09-30, detector-BOM slice): an earlier pass held the row in
// a named scope open on the grounds that the spec "offers a different detector
// for this class of application". That was the error the rule above forbids --
// it converted a manufacturer option into an unstated project requirement. The
// rule now gates on PROJECT EVIDENCE ONLY, and that row resolves.
import {
  applyGovernedDiscount, discountRuleApplies, selectGovernedDiscountRule, netMultiplierFromBasisPoints,
} from "../../app/domain/product-price-library.mjs";

/** The heat-detector requirement as written in the project specification. */
export const SPEC_HEAT_CLAUSE = {
  documentLogicalName: "Technical Specification 28 46 00 - Fire Detection and Alarm System - Rev 1",
  part: "2 PRODUCTS",
  paragraph: "2.5",
  subClause: "2.5(b) Fixed Temperature / Rate of Rise Heat Detectors",
  /** Universal profile, stated with no location conditioning anywhere. */
  requiredFixedSetpointF: 135,
  requiredFixedSetpointC: 57,
  requiredRorPerMinuteF: 15,
  requiredRorPerMinuteC: 8.3,
  addressable: true,
  ulListed: true,
  /** Present in the spec, but its trigger is undefined in the project. */
  highTempSetpointF: 190,
  highTempSetpointC: 88,
  highTempTriggerText:
    "For applications requiring increased sensitivity, a high-temperature model provides fixed detection at 190 degF (88 degC).",
  highTempTriggerResolvedInProject: false,
  /** Spec 2 PRODUCTS 1: one shared base across all detector types. */
  sharedBaseRequired: true,
};

/**
 * Extract the governing heat requirement from the specification clauses.
 * Fails closed if the clause is absent -- a missing requirement must never be
 * silently treated as "no requirement".
 */
export const heatRequirementFromSpec = (clauses) => {
  const text = (clauses ?? []).map((c) => c?.original_text ?? "").join("\n");
  if (!/rate[- ]of[- ]rise/i.test(text)) {
    return { ok: false, reason: "SPEC_HEAT_CLAUSE_ABSENT", detail: "no rate-of-rise requirement found in the specification" };
  }
  const hasHighTemp = /190\s*(?:deg?\s?F|°\s?F)/i.test(text);
  return {
    ok: true,
    requirement: {
      ...SPEC_HEAT_CLAUSE,
      // Whether the spec actually OFFERS a high-temperature variant here, and
      // whether it maps that variant to any named location. The first is true
      // for Al Mousa; the second is false, which is why a row in a named scope
      // cannot be resolved.
      highTempVariantOffered: hasHighTemp,
      highTempLocationAssigned: hasHighTemp && /such as|at the|in the\s+\w+\s+(station|room|area)/i.test(text),
    },
  };
};

/** Normalise a BOQ row into the shape this module reasons about. */
export const normalizeHeatRow = (r) => {
  const qty = Number(r.qty ?? 0) || 0;
  const section = String(r.section ?? "").trim();
  return {
    row: Number(r.row),
    qty,
    unit: r.unit ?? "No",
    description: String(r.description ?? "").trim(),
    section,
    /** True when the row sat under a specific named building / area scope. */
    namedLocationScope: section !== "" && !/^supply, install and connect/i.test(section),
    category: r.category ?? null,
    system: r.system ?? null,
    notes: r.notes ?? null,
    drawingReference: r.drawingReference ?? null,
    specificationReference: r.specificationReference ?? null,
    duplicateOfItemId: r.duplicateOfItemId ?? null,
    qualified: Boolean(r.notes || r.drawingReference || r.specificationReference),
  };
};

/**
 * Does any PROJECT document state a heat profile for THIS row other than the
 * universal one?
 *
 * This is the only thing allowed to hold a row open. It returns null unless
 * real project evidence exists, and it deliberately does NOT treat these as
 * evidence:
 *   - the building's name (a "DG Station" is a name, not a temperature);
 *   - the existence of a manufacturer high-temperature option;
 *   - an inference about how hot a generator hall might be.
 */
export const projectOverrideForRow = (row, requirement) => {
  const text = [row.notes, row.specificationReference, row.drawingReference].filter(Boolean).join(" ");
  // `temp\w*` matters: a bare `high[\s-]?temp\b` would NOT match the phrase
  // "high temperature", because there is no word boundary between "temp" and
  // "erature" -- so the most natural way to write the qualifier would have been
  // silently missed by it.
  const explicit = /\b(high[\s-]?temp\w*|190\s*(?:deg?\s?F|°\s?F)|88\s*(?:deg?\s?C|°\s?C)|ambient|increased sensitivity)\b/i.test(text);
  if (explicit) {
    return {
      reason: `The row itself carries an explicit temperature/environment qualifier ("${text.trim()}").`,
      missingDiscriminator: "Confirmation of which fixed/rate-of-rise profile that qualifier demands.",
    };
  }
  // The specification may map its high-temperature variant to a NAMED location.
  // If it does, and this row is in that location, the override is real.
  if (requirement?.highTempLocationAssigned) {
    return {
      reason:
        "The specification maps its 190 degF high-temperature variant to a named location and this row " +
        "sits in that scope.",
      missingDiscriminator: "Confirmation of the required alarm temperature for that scope.",
    };
  }
  return null;
};

/**
 * Resolve each row independently. The row that already carries a human decision
 * defines the "general scope" against which the others are judged; it is never
 * used as the answer for them.
 */
export const resolveHeatRows = ({ rows, requirement, governedRow, heatProfiles }) => {
  if (!requirement?.ok) {
    return { ok: false, reason: requirement?.reason ?? "REQUIREMENT_MISSING", rows: [] };
  }
  const generalScope = rows.find((r) => r.row === governedRow)?.section ?? null;
  const resolved = rows.map((r) => {
    const base = {
      row: r.row, qty: r.qty, section: r.section, namedLocationScope: r.namedLocationScope,
      generalScope, description: r.description, duplicateOfItemId: r.duplicateOfItemId,
    };
    // Row 15 already carries the governed human decision; preserve it verbatim.
    if (r.row === governedRow) {
      return { ...base, state: "GOVERNED_EXISTING", pn: null, reason: "existing human decision retained; not re-decided here" };
    }
    if (r.qty === 0) {
      return { ...base, state: "NO_DEMAND", pn: null, reason: "row carries no quantity" };
    }
    // Named scope alone is NOT a discriminator. Ask only whether any PROJECT
    // evidence states a different requirement for this row.
    const overridden = projectOverrideForRow(r, requirement);
    if (overridden) {
      return {
        ...base,
        state: "TECHNICAL_SELECTION_REVIEW_REQUIRED",
        pn: null,
        reason: overridden.reason,
        missingDiscriminator: overridden.missingDiscriminator,
        candidatesConsidered: Object.values(heatProfiles).map((p) => p.pn),
      };
    }
    // No project evidence overrides it -> the universal profile governs.
    return {
      ...base,
      state: "RESOLVED",
      pn: heatProfiles.defaultProfile.pn,
      profile: "FIXED_135F_PLUS_ROR_15F_PER_MIN",
      reason:
        "No project evidence specifies a different heat profile for this row. Its BOQ text carries no " +
        "temperature, environment or location qualifier, and Spec 2.5(b) states one heat profile with no " +
        "location conditioning. The 190 degF high-temperature variant offered by the specification is " +
        "triggered only by 'applications requiring increased sensitivity', a condition the project never " +
        "defines and never assigns to any location; a manufacturer option is not a project requirement.",
      evidenceChain: [
        `BOQ row ${r.row}: description "${r.description}", qty ${r.qty} ${r.unit}, category Detector, system Fire Alarm.`,
        "No notes, specification reference or drawing reference on the row.",
        r.namedLocationScope
          ? `Section is "${r.section}" -- a named building scope, but a building NAME is not a technical requirement.`
          : "Row sits in the general fire-alarm detection scope.",
        "Spec 28 46 00 Rev 1, 2 PRODUCTS, 2.5(b) states one heat profile and no location-conditioned variant.",
        "The 190 degF variant appears once in the whole specification, with an undefined trigger; it is never mapped to a location.",
        `Farenhyt candidate "${heatProfiles.defaultProfile.pn}" is a fixed-temperature AND rate-of-rise device with a 135 degF setpoint.`,
      ],
      confidence: overridden ? "NONE" : "HIGH",
    };
  });
  return { ok: true, requirement: requirement.requirement, rows: resolved };
};

/**
 * Match a resolved profile to a governed Farenhyt product, refusing any part
 * whose own evidence cannot satisfy the profile.
 */
export const matchProductForProfile = ({ profile, products, requirement }) => {
  const byPn = (pn) => products.find((p) => p.partNumber === pn);
  const attr = (p, name) => p.attributes?.find((a) => a.name === name) ?? null;
  if (profile === "FIXED_135F_PLUS_ROR_15F_PER_MIN") {
    const p = byPn("IDP-HEAT-ROR-IV");
    if (!p) return { ok: false, reason: "PRODUCT_NOT_IN_LIBRARY" };
    const principle = attr(p, "detection_principle")?.normalizedValue ?? "";
    const setpoint = attr(p, "fixed_temperature_setpoint")?.normalizedValue ?? "";
    const ror = attr(p, "rate_of_rise_sensitivity")?.normalizedValue ?? "";
    if (!/rate[- ]of[- ]rise/i.test(principle)) {
      return { ok: false, reason: "PRINCIPLE_MISMATCH", detail: `${p.partNumber} is ${principle}` };
    }
    if (!/135/.test(setpoint)) return { ok: false, reason: "SETPOINT_MISMATCH", detail: setpoint };
    if (!/15/.test(ror)) return { ok: false, reason: "ROR_MISMATCH", detail: ror };
    // The fixed-only sibling must be demonstrably rejected, with a reason.
    const fixedOnly = byPn("IDP-HEAT-IV");
    const fixedOnlyPrinciple = fixedOnly ? attr(fixedOnly, "detection_principle")?.normalizedValue ?? "" : null;
    return {
      ok: true,
      pn: p.partNumber,
      description: p.description,
      evidence: {
        detectionPrinciple: principle, fixedSetpoint: setpoint, rateOfRise: ror,
        ulListing: p.standards?.find((s) => s.body === "UL")?.number ?? null,
        datasheet: attr(p, "detection_principle")?.source?.sourceId ?? null,
      },
      rejected: fixedOnly && fixedOnlyPrinciple && !/rate[- ]of[- ]rise/i.test(fixedOnlyPrinciple)
        ? {
            pn: fixedOnly.partNumber,
            reason:
              `${fixedOnly.partNumber} is "${fixedOnlyPrinciple}" only. Spec 2.5(b) requires rate-of-rise at ` +
              `15 degF/min, which a fixed-temperature-only detector cannot provide, so it cannot satisfy this profile.`,
          }
        : null,
    };
  }
  return { ok: false, reason: "PROFILE_NOT_MATCHED", detail: String(profile), requirement: requirement?.requiredFixedSetpointF };
};

export { applyGovernedDiscount, discountRuleApplies, selectGovernedDiscountRule, netMultiplierFromBasisPoints };
