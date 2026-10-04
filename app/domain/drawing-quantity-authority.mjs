/**
 * GOVERNED DRAWING QUANTITY AUTHORITY — domain model.
 *
 * WHAT THIS ANSWERS
 * "How many physical devices does the drawing evidence support?"
 *
 * WHAT THIS DELIBERATELY DOES NOT ANSWER
 * "How many SLC addresses or panel resources do those devices consume?" That is a
 * separate governed authority and no pool, address or resource field exists here.
 * Keeping the domains apart is the point: a drawing count must never be able to
 * masquerade as an address demand.
 *
 * WHY A NEW MODEL, AND WHY IT IS SMALL
 * `drawing_architecture_approved_rows` already carries everything a governed fact
 * needs — document_version_id binding, source page/region, parser_version,
 * evidence_fingerprint, review actor, and version supersession — and already holds
 * LAYOUT_LEGEND_LINK facts of exactly this shape (subject "T", relation
 * "MATCHES_GOVERNED_LEGEND", object "FIREMAN TELEPHONE JACK"). So the VERSIONING,
 * PROVENANCE and REVIEW architecture is reused rather than reinvented. What it
 * cannot do is hold a quantity: it has no value, no count method, no printed or
 * component total, no discrepancy, no coverage state, and no device variant. This
 * module adds exactly that minimum.
 *
 * PARTIAL AUTHORITY IS THE POINT
 * A drawing schedule prints classes the project has not defined. That must not
 * block the classes it HAS defined. `aggregateCoverage` therefore reports proven
 * classes as current authority while unresolved ones stay unresolved, and one
 * unresolved code never invalidates a sibling.
 *
 * UNRESOLVED IS NEVER ZERO
 * An unresolved class has quantity `null`, not 0. Zero is a measured claim that
 * nothing exists; conflating the two would silently delete devices from a panel.
 *
 * FRESHNESS
 * Every claim binds to a specific drawing document version. `currentClaims`
 * requires that binding to equal the document's CURRENT version, so evidence
 * automatically stops being current the moment its source drawing head moves.
 */

export const DRAWING_QUANTITY_AUTHORITY_VERSION = "drawing-quantity-authority-1.0.0";

/** Per-claim states. No claim may claim more than its evidence supports. */
export const QUANTITY_CLAIM_STATES = Object.freeze([
  /** Class meaning is governed AND the quantity reconciles (or is the sole measure). */
  "PROVEN",
  /** Meaning is governed but printed and component totals disagree. Both retained. */
  "CONFLICT",
  /** The class has no governed meaning. Quantity stays null. */
  "UNRESOLVED",
]);

/** Sheet/drawing level coverage, derived from its claims. Never fabricated. */
export const COVERAGE_STATES = Object.freeze([
  "Complete",
  "Partial",
  "Unresolved",
  "No Evidence",
]);

/** How a quantity value was obtained. Recorded so a total is never read as a count. */
export const COUNT_METHODS = Object.freeze([
  /** Summed from class-attributed subtotal cells on the sheet. */
  "COMPONENT_CELL_SUM",
  /** Read from a printed subtotal/total cell on the sheet. */
  "PRINTED_CELL",
  /** The printed row total, kept alongside the component sum for reconciliation. */
  "PRINTED_ROW_TOTAL",
]);

/**
 * Device variant discriminators.
 *
 * F resolves to two DIFFERENT devices that share one textual code and are told
 * apart only by symbol geometry: a solid enclosure is the standard manual station,
 * a dashed enclosure is the weatherproof type. The variant is therefore part of
 * the quantity identity, not a note. Without it the two would merge and the
 * weatherproof count would be lost.
 */
export const DEVICE_VARIANTS = Object.freeze(["STANDARD", "WEATHERPROOF"]);

const isFiniteNumber = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * Build one governed quantity claim.
 *
 * Refuses malformed input rather than repairing it, and — critically — refuses to
 * mint a quantity for a class whose meaning is not governed. An unresolved class
 * yields a claim with quantity null and state UNRESOLVED, never a zero.
 */
export function buildQuantityClaim(input) {
  if (!input || typeof input !== "object") {
    return { ok: false, error: "INVALID_INPUT", reason: "A quantity claim must be an object." };
  }

  const {
    projectId,
    documentId = null,
    documentVersionId,
    sheet = null,
    page = null,
    parserVersion = null,
    semanticsVersion = null,
    deviceClass,
    deviceVariant = "STANDARD",
    floorOrArea = null,
    quantityType = "PHYSICAL_DEVICE",
    quantity = null,
    countMethod = null,
    printedTotal = null,
    componentTotal = null,
    discrepancy = null,
    unresolvedReason = null,
    sourceRegion = null,
    sourceAssetIds = null,
    evidenceFingerprint = null,
    reviewedBy = null,
    reviewReason = null,
    reviewStatus = null,
  } = input;

  if (typeof projectId !== "string" || projectId.trim() === "") {
    return { ok: false, error: "MISSING_PROJECT", reason: "Every quantity claim is bound to a project." };
  }
  if (typeof documentVersionId !== "string" || documentVersionId.trim() === "") {
    return {
      ok: false,
      error: "MISSING_DOCUMENT_VERSION",
      reason:
        "Every quantity claim must bind to the drawing DOCUMENT VERSION it was read from. " +
        "Without it the claim cannot be invalidated when that drawing is revised.",
    };
  }
  if (typeof deviceClass !== "string" || deviceClass.trim() === "") {
    return { ok: false, error: "MISSING_DEVICE_CLASS", reason: "A quantity claim must name a device class." };
  }
  if (!COUNT_METHODS.includes(countMethod)) {
    return {
      ok: false,
      error: "MISSING_COUNT_METHOD",
      reason: `countMethod must be one of ${COUNT_METHODS.join(", ")}. A quantity with no method is not evidence.`,
    };
  }
  if (!DEVICE_VARIANTS.includes(deviceVariant)) {
    return { ok: false, error: "INVALID_VARIANT", reason: `deviceVariant must be one of ${DEVICE_VARIANTS.join(", ")}.` };
  }

  const classMeaningGoverned = input.classMeaningGoverned === true;
  const hasQuantity = isFiniteNumber(quantity);

  // An ungoverned class may not carry a quantity. It may carry an observation of
  // what the sheet prints, but that is provenance, not authority.
  if (!classMeaningGoverned && hasQuantity) {
    return {
      ok: false,
      error: "UNGOVERNED_CLASS_WITH_QUANTITY",
      reason:
        `Class "${deviceClass}" has no governed meaning, so a quantity cannot be asserted for it. ` +
        "Record it as UNRESOLVED with quantity null instead. An unresolved class is never zero.",
    };
  }
  if (classMeaningGoverned && !hasQuantity) {
    return {
      ok: false,
      error: "GOVERNED_CLASS_WITHOUT_QUANTITY",
      reason: `Class "${deviceClass}" is governed, so a finite quantity is required.`,
    };
  }

  // Discrepancy is derived, never taken on trust, so printed and component can
  // never be silently reconciled.
  let derivedDiscrepancy = null;
  if (isFiniteNumber(printedTotal) && isFiniteNumber(componentTotal)) {
    derivedDiscrepancy = {
      printedTotal,
      componentTotal,
      delta: printedTotal - componentTotal,
    };
  } else if (discrepancy !== null && discrepancy !== undefined) {
    derivedDiscrepancy = discrepancy;
  }

  const hasDiscrepancy =
    derivedDiscrepancy !== null && isFiniteNumber(derivedDiscrepancy.delta) && derivedDiscrepancy.delta !== 0;

  const state = !classMeaningGoverned
    ? "UNRESOLVED"
    : reviewStatus === "Rejected" || reviewStatus === "Superseded"
      ? "UNRESOLVED"
      : hasDiscrepancy
        ? "CONFLICT"
        : "PROVEN";

  return {
    ok: true,
    claim: {
      project_id: projectId.trim(),
      document_id: documentId,
      document_version_id: documentVersionId.trim(),
      sheet: sheet,
      page: isFiniteNumber(page) ? page : null,
      floor_or_area: floorOrArea,
      parser_version: parserVersion,
      semantics_version: semanticsVersion,
      device_class: deviceClass.trim(),
      device_variant: deviceVariant,
      quantity_type: quantityType,
      // null for UNRESOLVED. NEVER 0.
      quantity: hasQuantity ? quantity : null,
      count_method: countMethod,
      printed_total: isFiniteNumber(printedTotal) ? printedTotal : null,
      component_total: isFiniteNumber(componentTotal) ? componentTotal : null,
      discrepancy: derivedDiscrepancy,
      coverage_state: state === "PROVEN" ? "Complete" : state === "CONFLICT" ? "Partial" : "Unresolved",
      unresolved_reason:
        state === "UNRESOLVED"
          ? unresolvedReason ?? "Class meaning is not governed for this project."
          : null,
      source_region: sourceRegion,
      source_asset_ids: Array.isArray(sourceAssetIds) ? sourceAssetIds : [],
      evidence_fingerprint: evidenceFingerprint,
      review: {
        status: reviewStatus,
        reviewed_by: reviewedBy,
        reason: reviewReason,
      },
      state,
      authority_version: DRAWING_QUANTITY_AUTHORITY_VERSION,
    },
  };
}

// ---- AUTHORITY FINGERPRINT -----------------------------------------------------
//
// WHY THIS EXISTS. `evidence_fingerprint` on a claim is a field a producer SETS.
// Without a function that DERIVES it, nothing can prove the two properties the
// currentness model depends on: that identical authorities always yield the same
// fingerprint, and that a change in any authority actually moves it. This is a
// dependency-free deterministic drift detector (NOT a security hash), following
// the same convention as attribute-comparison-contract.mjs's cyrb53.
//
// WHAT THE FINGERPRINT COVERS, and it is deliberately an ALLOWLIST rather than a
// hash of the whole claim. An allowlist is what makes the exclusion provable: the
// hashed key set is fixed and visible, so anything absent from it cannot possibly
// influence the result.
//
//   INCLUDED (upstream authorities that decide what the number IS):
//     project, document, document version, sheet, page, device class, device
//     variant, quantity, count method, printed/component totals, semantics
//     version, parser version, source region, source asset ids, authority
//     version.
//
//   EXCLUDED ON PURPOSE (downstream consumers, which must NEVER invalidate a
//   physical count):
//     SLC resource classification, addresses per device, module/detector pools,
//     panel allocation, panel sizing, product selection, pricing, quotation.
//     None of those fields exist on this model at all, so they cannot leak in.
//
// The exclusion is asserted by a mutation test, not merely asserted in a comment:
// changing a downstream concern leaves the fingerprint byte-identical.
//
// EXPORTED (not widened in behaviour) so the drawing-quantity->BOQ applicability
// authority hashes with the SAME primitive. Two authorities must never ship two
// hash functions: a divergent primitive makes fingerprints incomparable and turns
// a drift check into a coin flip.
export const fingerprintHash = (value) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, Object.keys(value ?? {}).sort());
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, "0");
};

/** The exact, fixed key set the quantity authority fingerprint is derived from. */
export const QUANTITY_FINGERPRINT_KEYS = Object.freeze([
  "authority_version",
  "count_method",
  "device_class",
  "device_variant",
  "document_id",
  "document_version_id",
  "page",
  "parser_version",
  "printed_total",
  "component_total",
  "project_id",
  "quantity",
  "semantics_version",
  "sheet",
  "source_asset_ids",
  "source_region",
]);

/**
 * Deterministic authority fingerprint for one quantity claim.
 *
 * Returns null when the claim carries no project, document version, class or
 * count method -- the same minimum `buildQuantityClaim` already refuses without,
 * so a claim that could not have been built cannot be fingerprinted either.
 */
export function computeQuantityAuthorityFingerprint(claim) {
  if (!claim || typeof claim !== "object") return null;
  if (!claim.project_id || !claim.document_version_id || !claim.device_class || !claim.count_method) return null;
  const material = {};
  for (const key of QUANTITY_FINGERPRINT_KEYS) {
    const value = key === "authority_version" ? claim.authority_version ?? DRAWING_QUANTITY_AUTHORITY_VERSION : claim[key];
    material[key] = value === undefined ? null : value;
  }
  // source_asset_ids is an array; order is not authority, so it is sorted.
  if (Array.isArray(material.source_asset_ids)) material.source_asset_ids = [...material.source_asset_ids].sort();
  return `dqa_${fingerprintHash(material)}`;
}

/** True when a claim's stored fingerprint still matches its own content. */
export function isFingerprintCurrent(claim) {
  const derived = computeQuantityAuthorityFingerprint(claim);
  if (!derived) return false;
  if (!claim.evidence_fingerprint) return true; // nothing stored to contradict
  return claim.evidence_fingerprint === derived;
}

/**
 * Is this claim currently authoritative?
 *
 * Requires ALL THREE: an unrejected review, that its source document version is
 * the document's current head, and that the row itself was not superseded.
 *
 * The first two are the freshness rule: revise the drawing and the quantity
 * evidence stops being current without anything having to remember to clear it.
 *
 * The third was a real omission. 0020 supersession stamps `superseded_at` on the
 * OLD row and inserts the replacement with the SAME document_version_id and the
 * same Approved review status -- so version 1 and version 2 of one identity both
 * satisfied the first two conditions and were BOTH aggregated. Measured: two
 * versions (2 then 4) summed to provenTotal 6 with counts.proven 2. The sibling
 * quantity->BOQ authority already refuses `superseded_at` explicitly
 * (SUPERSEDED_CLAIM), so this brings the shared predicate in line with the rule
 * the adjacent authority was already enforcing, rather than inventing a new one.
 * Domain-shaped claims that carry no `superseded_at` field are unaffected.
 */
export function isCurrentQuantityClaim(claim, { currentDocumentVersionId, reviewStatusOf = () => "Approved" } = {}) {
  if (!claim) return false;
  if (claim.review?.status && claim.review.status !== "Approved") return false;
  if (reviewStatusOf(claim) !== "Approved") return false;
  // A superseded row is history. It must never satisfy currentness, and must
  // never contribute a quantity to any total.
  if (claim.superseded_at !== undefined && claim.superseded_at !== null && claim.superseded_at !== "") return false;
  if (!currentDocumentVersionId) return false;
  return claim.document_version_id === currentDocumentVersionId;
}

/**
 * Current authority for a project, grouped the ways downstream consumers ask.
 *
 * Unresolved classes are RETURNED, in their own bucket, so a consumer can see
 * that they exist. They are simply never merged into the proven totals.
 */
export function aggregateCoverage(claims = []) {
  const current = claims.filter((c) => c && c.state !== undefined);
  const proven = current.filter((c) => c.state === "PROVEN");
  const conflicted = current.filter((c) => c.state === "CONFLICT");
  const unresolved = current.filter((c) => c.state === "UNRESOLVED");

  const sum = (list) => list.reduce((t, c) => t + (isFiniteNumber(c.quantity) ? c.quantity : 0), 0);

  // Class identity includes the variant: F standard and F weatherproof are
  // separate devices even though both print "F".
  const keyOf = (c) => `${c.device_class}::${c.device_variant}`;

  const byClass = {};
  for (const c of proven) {
    const k = keyOf(c);
    byClass[k] ??= { deviceClass: c.device_class, deviceVariant: c.device_variant, quantity: 0, sheets: new Set(), state: "PROVEN" };
    byClass[k].quantity += isFiniteNumber(c.quantity) ? c.quantity : 0;
    if (c.sheet) byClass[k].sheets.add(c.sheet);
  }
  for (const c of conflicted) {
    const k = keyOf(c);
    byClass[k] ??= { deviceClass: c.device_class, deviceVariant: c.device_variant, quantity: null, sheets: new Set(), state: "CONFLICT" };
    byClass[k].state = "CONFLICT";
    if (c.sheet) byClass[k].sheets.add(c.sheet);
    // A conflicting sheet must NOT contribute to an authoritative total.
    byClass[k].quantity = null;
  }

  const coverage =
    proven.length === 0 && conflicted.length === 0 && unresolved.length > 0
      ? "Unresolved"
      : conflicted.length === 0 && unresolved.length === 0
        ? "Complete"
        : proven.length === 0
          ? "Unresolved"
          : "Partial";

  return {
    authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
    coverageState: coverage,
    // Totals come ONLY from PROVEN claims. Conflicts and unresolved classes are
    // excluded rather than contributing zero, so a partial sheet cannot look like
    // a smaller complete one.
    provenTotal: sum(proven),
    provenClassCount: Object.keys(byClass).length,
    proven: Object.fromEntries(Object.entries(byClass).map(([k, v]) => [k, { ...v, sheets: [...v.sheets] }])),
    discrepancies: conflicted.map((c) => ({
      sheet: c.sheet,
      floorOrArea: c.floor_or_area,
      deviceClass: c.device_class,
      printedTotal: c.printed_total,
      componentTotal: c.component_total,
      delta: c.discrepancy?.delta ?? null,
    })),
    unresolved: unresolved.map((c) => ({
      sheet: c.sheet,
      deviceClass: c.device_class,
      deviceVariant: c.device_variant,
      // Deliberately null. A consumer must be unable to mistake this for zero.
      quantity: null,
      reason: c.unresolved_reason,
    })),
    counts: {
      proven: proven.length,
      conflicted: conflicted.length,
      unresolved: unresolved.length,
    },
  };
}

/**
 * The governed read contract downstream consumers use.
 *
 * Supports the four questions Agent 1's allocation work and any UI need:
 * current quantities for the project, by sheet, by class, plus the unresolved
 * set and the discrepancy set. Filtering is by CURRENT document version only.
 */
export function readCurrentDrawingQuantities({
  claims = [],
  currentDocumentVersions = {},
  sheet = null,
  deviceClass = null,
  building = null,
} = {}) {
  const current = claims.filter((c) =>
    isCurrentQuantityClaim(c, { currentDocumentVersionId: currentDocumentVersions[c.document_id] }),
  );

  let scoped = current;
  if (sheet) scoped = scoped.filter((c) => c.sheet === sheet);
  if (deviceClass) scoped = scoped.filter((c) => c.device_class === deviceClass);
  if (building) scoped = scoped.filter((c) => c.building === building || c.floor_or_area === building);

  return {
    authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
    filter: { sheet, deviceClass, building },
    claimCount: scoped.length,
    ...aggregateCoverage(scoped),
  };
}

// ---- CANONICAL DOWNSTREAM READ -------------------------------------------------
//
// ONE function Agent 3 calls. It never has to inspect recognition tables, review
// packets, agent reports, lore or drawing-parser internals -- §16.
//
// EVERY MISSING CASE IS AN EXPLICIT STATE, NEVER A FALLBACK (§17). There is
// deliberately NO path in this function that can return a BOQ quantity, a
// historical quantity, a raw recognition count, a schedule string or any other
// substitute. If the governed evidence is absent the answer is an explicit state,
// because a plausible number from the wrong source is worse than no number: it
// silently becomes address demand downstream.
export const DRAWING_QUANTITY_AUTHORITY_STATES = Object.freeze({
  /** Governed, current, non-stale physical quantity authority exists. */
  READY: "DRAWING_QUANTITY_AUTHORITY_READY",
  /** No governed quantity claim exists at all for this project. */
  MISSING: "MISSING_DRAWING_QUANTITY_AUTHORITY",
  /** Claims exist but their class meanings are not governed. */
  UNRESOLVED_SEMANTICS: "UNRESOLVED_DRAWING_SEMANTICS",
  /** Claims exist and are governed but bound to a superseded drawing revision. */
  STALE: "STALE_DRAWING_QUANTITY_AUTHORITY",
  /** Every claim was rejected or superseded in review. */
  REJECTED: "REJECTED_DRAWING_QUANTITY_AUTHORITY",
  /** A claim's stored fingerprint no longer matches its own content. */
  FINGERPRINT_DRIFT: "DRAWING_QUANTITY_AUTHORITY_FINGERPRINT_DRIFT",
});

/**
 * The canonical governed read. Agent 3 depends on this and nothing else.
 *
 * @param claims   every quantity claim known for the project, any state
 * @param currentDocumentVersions  { [document_id]: current_document_version_id }
 * @returns a discriminated result; `state` is READY only when authority is real
 */
export function readCurrentDrawingQuantityAuthority({
  claims = [],
  currentDocumentVersions = {},
  sheet = null,
  deviceClass = null,
  requireProven = true,
} = {}) {
  const scoped = claims.filter((c) => c && (!sheet || c.sheet === sheet) && (!deviceClass || c.device_class === deviceClass));

  // 1. Nothing at all -> MISSING. Never a substitute value.
  if (scoped.length === 0) {
    return {
      state: DRAWING_QUANTITY_AUTHORITY_STATES.MISSING,
      ready: false,
      authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
      reason: "No governed drawing quantity claim exists for this scope.",
      quantity: null,
      proven: {},
      unresolved: [],
      counts: { proven: 0, conflicted: 0, unresolved: 0 },
    };
  }

  // 2. Fingerprint drift is checked BEFORE anything is trusted: a claim whose
  //    stored fingerprint disagrees with its own content is evidence of tampering
  //    or a partial write, and must never be read as authority.
  const drifted = scoped.filter((c) => !isFingerprintCurrent(c));
  if (drifted.length === scoped.length) {
    return {
      state: DRAWING_QUANTITY_AUTHORITY_STATES.FINGERPRINT_DRIFT,
      ready: false,
      authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
      reason: "Every candidate claim's authority fingerprint disagrees with its content.",
      quantity: null,
      proven: {},
      unresolved: [],
      counts: { proven: 0, conflicted: 0, unresolved: 0 },
    };
  }
  const sound = drifted.length === 0 ? scoped : scoped.filter((c) => isFingerprintCurrent(c));

  // 3. Currentness: the claim's source drawing version must still be the head.
  const current = sound.filter((c) => isCurrentQuantityClaim(c, { currentDocumentVersionId: currentDocumentVersions[c.document_id] }));

  // 4. Governed review: a rejected claim is not authority even if it is current.
  const rejectedOnly = current.length === 0 && sound.length > 0;
  if (rejectedOnly) {
    return {
      state: DRAWING_QUANTITY_AUTHORITY_STATES.STALE,
      ready: false,
      authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
      reason: "Quantity claims exist but none is bound to the current drawing revision, or all were rejected in review.",
      quantity: null,
      proven: {},
      unresolved: [],
      counts: { proven: 0, conflicted: 0, unresolved: 0 },
    };
  }

  const coverage = aggregateCoverage(current);
  const provenClaims = current.filter((c) => c.state === "PROVEN");

  // 5. Class meaning must be governed. An unresolved class is never zero, and a
  //    partially-resolved set is reported as such rather than as a smaller total.
  if (provenClaims.length === 0) {
    const state = coverage.counts.unresolved > 0 ? DRAWING_QUANTITY_AUTHORITY_STATES.UNRESOLVED_SEMANTICS : DRAWING_QUANTITY_AUTHORITY_STATES.MISSING;
    return {
      state,
      ready: false,
      authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
      reason: state === DRAWING_QUANTITY_AUTHORITY_STATES.UNRESOLVED_SEMANTICS
        ? "Drawing quantity evidence exists, but no class meaning is governed, so no physical quantity can be asserted."
        : "No proven drawing quantity claim is current for this scope.",
      quantity: null,
      coverageState: coverage.coverageState,
      proven: {},
      unresolved: coverage.unresolved,
      discrepancies: coverage.discrepancies,
      counts: coverage.counts,
    };
  }

  // 6. A CONFLICT never yields a number. Printed and component disagree, so the
  //    honest answer is "in conflict", not whichever total is larger.
  if (coverage.counts.conflicted > 0 && requireProven) {
    return {
      state: DRAWING_QUANTITY_AUTHORITY_STATES.MISSING,
      ready: false,
      authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
      reason: "At least one class has a printed/component quantity conflict; the conflicting class contributes no authoritative quantity.",
      quantity: null,
      coverageState: coverage.coverageState,
      proven: coverage.proven,
      unresolved: coverage.unresolved,
      discrepancies: coverage.discrepancies,
      counts: coverage.counts,
    };
  }

  return {
    state: DRAWING_QUANTITY_AUTHORITY_STATES.READY,
    ready: true,
    authorityVersion: DRAWING_QUANTITY_AUTHORITY_VERSION,
    // SAFETY MARKER. `ready`/`coverageState` below are CLAIM-RELATIVE: they are
    // computed only from the claims supplied and cannot know which project
    // locations were expected. Measured: BOS+GRS+KGS with WLC absent entirely
    // returns coverageState "Complete" and ready true. That is correct for
    // those claims and is NOT project completeness. Anything that needs to know
    // every expected location is governed must use
    // readProjectScopedDrawingQuantityCoverage in
    // app/domain/drawing-quantity-project-scope.mjs, which returns
    // UNKNOWN_SCOPE rather than Complete when scope is not governed. Additive:
    // no existing field is renamed, removed or redefined.
    coverageScope: "CLAIM_RELATIVE",
    projectCoverageComplete: false,
    projectCoverageReason: "Not evaluated here. This reader receives claims, not a governed expected scope, so it cannot assert project completeness. Use readProjectScopedDrawingQuantityCoverage().",
    coverageState: coverage.coverageState,
    // Sum of PROVEN class quantities only. Conflicts and unresolved are excluded
    // rather than counted as zero, so a partial sheet cannot read as a smaller
    // complete one.
    quantity: coverage.provenTotal,
    proven: coverage.proven,
    unresolved: coverage.unresolved,
    discrepancies: coverage.discrepancies,
    counts: coverage.counts,
    claims: current.map((c) => ({
      deviceClass: c.device_class,
      deviceVariant: c.device_variant,
      sheet: c.sheet,
      documentId: c.document_id,
      documentVersionId: c.document_version_id,
      quantity: c.quantity,
      countMethod: c.count_method,
      authorityFingerprint: computeQuantityAuthorityFingerprint(c),
      state: c.state,
    })),
  };
}