// GOVERNED DETECTOR-BASE CENSUS -- derived from evidence, never from a total.
//
// WHY THIS EXISTS
// ---------------
// The B501-IV quantity was previously derived as an arithmetic expression
// (smoke + heat + combined + duct). That is wrong twice over:
//
//   1. It counted the 45 duct detector HEADS as if they needed a B501-IV.
//      A duct head is installed INSIDE a DNR/DNRW housing. Governed evidence:
//        - DNR/DNRW `base_required` = "No"
//        - DNR/DNRW `device_role` = "SLC_HOUSING", `address_consumption` = "0"
//        - B501-IV `compatible_detector_families` lists IDP-Photo, IDP-Photo-T,
//          IDP-Acclimate, IDP-Heat, IDP-Heat-ROR, IDP-Heat-HT -- and contains
//          NO duct-housing family
//        - IDP-PHOTO-R-IV `detector_base_requirement`: "Also listed for use
//          inside DNR(W) duct smoke detector housings; WHEN USED STANDALONE,
//          mounts to B300-6 or B501 base"
//      The base condition is explicitly conditional on standalone use. A duct
//      head is not standalone.
//
//   2. It omitted the 2 heat detectors whose product is not yet chosen. But
//      B501-IV's compatible list covers BOTH DG Station heat candidates
//      (IDP-Heat-ROR and IDP-Heat-HT), so an unresolved heat IDENTITY does not
//      make the base quantity unresolved.
//
// BASE ARCHITECTURE (project evidence)
// ------------------------------------
// Specification 28 46 00 Rev 1, PART 2 PRODUCTS, paragraph 1: "All types should
// use the same base, allowing easy replacement of detector heads without
// rewiring." Every IDP head is also described "Base Not Included".
//
// Therefore: one B501-IV per SPOT addressable detector head; none for a head
// installed in a duct housing.
export const SPOT_BASE_PN = "B501-IV";

/** Every addressable detector line, with how it is mounted and whether it needs the base. */
export const DETECTOR_MOUNTING = [
  {
    key: "smoke", pn: "IDP-PHOTO-IV", application: "Spot / ceiling smoke detector",
    quantitySource: "smoke", usesBase: true,
    evidence:
      "library_products description 'Intelligent Addressable Photoelectric Smoke Detector (Ivory Color) " +
      "(Base Not Included)'; B501-IV compatible_detector_families includes 'IDP-Photo'.",
  },
  {
    key: "heatRor", pn: "IDP-HEAT-ROR-IV", application: "Spot heat detector, fixed 135F + ROR 15F/min",
    quantitySource: "heatTotal", usesBase: true,
    evidence:
      "B501-IV compatible_detector_families includes 'IDP-Heat-ROR'; description 'Intelligent Addressable " +
      "Fixed temperature and rate-of rise thermal detector ... (Base Not Included)'.",
  },
  {
    key: "heatCandidate", pn: null, application: "Spot heat detector, product identity not yet chosen",
    quantitySource: null, usesBase: true, counts: false, sharesBaseWith: "heatRor",
    evidence:
      "B501-IV compatible_detector_families includes BOTH 'IDP-Heat-ROR' AND 'IDP-Heat-HT'. Every candidate " +
      "head for any remaining heat row therefore uses the SAME B501-IV base, so an unresolved heat IDENTITY " +
      "must NOT make the base quantity unresolved. This row is EVIDENCE ONLY -- it documents that the shared " +
      "base holds -- and deliberately contributes no quantity, so it cannot double-count the heat units " +
      "already counted on the heatRor line.",
  },
  {
    key: "combined", pn: "IDP-PHOTO-T-IV", application: "Spot combined smoke + thermal detector",
    quantitySource: "combined", usesBase: true,
    evidence:
      "description '... Photoelectric Smoke Detector with Thermal (135F/57C) (Base Not Included)'; " +
      "B501-IV compatible_detector_families includes 'IDP-Photo-T'.",
  },
  {
    key: "ductHead", pn: "IDP-PHOTO-R-IV", application: "Duct detector head, installed in a DNR/DNRW housing",
    quantitySource: "duct", usesBase: false,
    evidence:
      "DNR/DNRW base_required = 'No', device_role = 'SLC_HOUSING', address_consumption = '0'. " +
      "IDP-PHOTO-R-IV detector_base_requirement: 'Also listed for use inside DNR(W) duct smoke detector " +
      "housings; when used standalone, mounts to B300-6 or B501 base' -- the base condition applies ONLY to " +
      "standalone use. B501-IV's compatible_detector_families contains no duct family.",
  },
];

/**
 * Derive the base census from the mounting matrix and the governed quantities.
 * Deliberately a sum over rows that opt in, so adding a duct line cannot
 * silently reintroduce a base.
 */
export function buildBaseCensus(quantities) {
  const rows = DETECTOR_MOUNTING.map((m) => {
    // A row with counts === false is evidence-only: it contributes no quantity,
    // so two lines can never charge the same units twice.
    const qty = m.counts === false ? 0 : (Number(quantities[m.quantitySource] ?? 0) || 0);
    return { ...m, quantity: qty, baseQuantity: m.counts === false ? 0 : (m.usesBase ? qty : 0) };
  });
  const baseQuantity = rows.reduce((t, r) => t + r.baseQuantity, 0);
  return {
    basePn: SPOT_BASE_PN,
    rows,
    baseQuantity,
    // Detector POINTS are independent of base quantity: a duct head still
    // occupies one SLC address even though it needs no B501-IV.
    spotPoints: rows.filter((r) => r.usesBase).reduce((t, r) => t + r.quantity, 0),
    ductPoints: rows.filter((r) => !r.usesBase).reduce((t, r) => t + r.quantity, 0),
  };
}
