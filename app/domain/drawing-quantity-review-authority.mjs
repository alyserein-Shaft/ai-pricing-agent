// PRINTED-QUANTITY REVIEW AUTHORITY -- the bridge from the EXISTING governed
// drawing review authority into the canonical quantity claim writer.
//
// WHAT THIS IS NOT
// This is not a second review subsystem. The governed review authority for
// drawing findings already exists and is reused verbatim:
//
//   drawing_extraction_proposals    review_status / reviewed_by / reviewed_at
//                                  review_reason / corrected_value
//   drawing_extraction_review_events  one immutable row per action carrying
//                                  previous->new, reason, actor_user_id, request_id
//   worker/drawing-extraction-api.mjs  POST .../:proposalId/{approve|reject|
//                                  correct|conflict|restore}, mandatory
//                                  substantive reason, conflict-blocks-approve,
//                                  and a per-type gate on `approve`.
//
// That API's own module header is explicit that there is "no second, parallel
// review system for AI findings". This module supplies the one thing missing
// from it: the authority check that decides whether a reviewed candidate is
// allowed to become PHYSICAL QUANTITY AUTHORITY, and the canonical writer input
// it resolves to. It writes nothing and owns no table.
//
// THE CENTRAL RULE: A PRINTED NUMBER ON ITS OWN IS NEVER QUANTITY AUTHORITY.
//
// The engines that read a schedule numeral flag themselves
// QUANTITY_DEVICE_ASSOCIATION_UNKNOWN: they read "2 Nos" but cannot say which
// device that numeral counts. So a plain `approve` of such a candidate binds no
// device class and must NOT become a claim -- it would be a human approving a
// bare number, which is precisely what this slice must not produce. The
// device association is exactly what the reviewer has to adjudicate, and that
// adjudication is recorded through the existing `correct` action as a full
// printed-quantity adjudication, in the same audit trail as every other review.
//
// Consequences that are deliberate:
//   * `approve`  -> no corrected_value -> no class binding -> REFUSED.
//   * `reject` / `Conflict` / `Needs Review` -> REFUSED.
//   * `correct` with a complete, textually consistent adjudication -> eligible,
//     still subject to governed class meaning, a real human actor, and a
//     current document version.
//
// RECOGNITION LEAKAGE IS STRUCTURAL, NOT A CHECKLIST. The count method must be
// in the printed-count vocabulary AND must not read as occurrence-based, and the
// adjudicated number must be the numeral actually printed. A "6 x 2" reading may
// only become 12 as an explicit COMPONENT_CELL_SUM over the printed components;
// it can never be reached by multiplying a symbol count, because a symbol count
// has no field to be entered into and no method that will accept it.

import {
  COUNT_METHODS,
  DEVICE_VARIANTS,
} from "./drawing-quantity-authority.mjs";
import { classifyLegendClass } from "./fire-alarm-legend-class-semantics.mjs";

/**
 * Proposal types that may be adjudicated into printed-quantity authority.
 * The AI visual `quantities` category is the only producer of a printed
 * numeral candidate; every other proposal type describes identity, circuits,
 * interfaces or text, never a count.
 */
export const PRINTED_QUANTITY_PROPOSAL_TYPES = Object.freeze(["quantities"]);

/**
 * Review statuses that can carry quantity authority. These are the two the
 * existing review API produces for a human decision (approve -> "Verified",
 * correct -> "Verified with Assumption"). "Rejected", "Conflict", "Not Found"
 * and "Needs Review" are all refusal states.
 */
export const QUANTITY_REVIEW_AUTHORITY_STATUSES = Object.freeze(["Verified", "Verified with Assumption"]);

/**
 * Method names that describe COUNTING PLOTTED MARKS rather than reading a
 * printed quantity. Mirrors the writer's own barrier and is re-applied here so
 * a future vocabulary addition in the claim domain cannot leak through the
 * review path either.
 */
export const RECOGNITION_COUNTED_METHOD_PATTERN = /OCCURRENCE|SYMBOL_COUNT|PLOTTED|RECOGNITION/i;

/** Fields a complete human adjudication must carry. */
export const PRINTED_QUANTITY_ADJUDICATION_FIELDS = Object.freeze([
  "quantity",
  "deviceClass",
  "countMethod",
  "printedText",
]);

const isNonEmptyString = (v) => typeof v === "string" && v.trim().length > 0;

/** Every integer literal appearing in a printed string ("6 x 2 Nos" -> [6, 2]). */
const printedNumerals = (text) =>
  (String(text).match(/\d+/g) ?? []).map((n) => Number.parseInt(n, 10));

// ---- ADJUDICATION VALIDATION --------------------------------------------------

/**
 * Validate the reviewer's adjudicated reading of a printed quantity cell.
 *
 * Shape-only plus the textual-consistency rule; the governed class meaning and
 * the current document version are checked by
 * evaluatePrintedQuantityReviewAuthority() because they need external context.
 *
 * @returns {ok:true, adjudication} | {ok:false, code, reason}
 */
export function validatePrintedQuantityAdjudication(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      code: "INVALID_ADJUDICATION",
      reason: "A printed-quantity adjudication must be an object carrying the reviewed quantity, device class, count method and the literal printed text.",
    };
  }
  for (const field of PRINTED_QUANTITY_ADJUDICATION_FIELDS) {
    if (value[field] === undefined || value[field] === null) {
      return {
        ok: false,
        code: "ADJUDICATION_FIELD_MISSING",
        reason: `Adjudication field "${field}" is missing; authority is never inferred for a field the reviewer did not state.`,
      };
    }
  }

  const quantity = value.quantity;
  if (!Number.isInteger(quantity)) {
    return { ok: false, code: "ADJUDICATION_QUANTITY_NOT_INTEGER", reason: "The adjudicated quantity must be a whole number of devices." };
  }
  if (quantity < 0) {
    return { ok: false, code: "ADJUDICATION_QUANTITY_NEGATIVE", reason: "The adjudicated quantity must not be negative." };
  }
  if (!isNonEmptyString(value.deviceClass)) {
    return { ok: false, code: "ADJUDICATION_CLASS_MISSING", reason: "The adjudicated device class is required; a free-text label is not a class identity." };
  }
  if (!isNonEmptyString(value.printedText)) {
    return { ok: false, code: "ADJUDICATION_PRINTED_TEXT_MISSING", reason: "The literal printed text the reviewer read is required, so the number is auditable against the drawing." };
  }
  if (value.deviceVariant !== undefined && value.deviceVariant !== null && !DEVICE_VARIANTS.includes(value.deviceVariant)) {
    return { ok: false, code: "ADJUDICATION_VARIANT_UNKNOWN", reason: `deviceVariant must be one of ${DEVICE_VARIANTS.join(", ")}.` };
  }
  // Checked BEFORE the vocabulary test so a symbol-counting method is refused
  // for what it actually is, rather than reported as a generic typo. The pattern
  // also guards against a future vocabulary addition reintroducing an
  // occurrence-based method.
  if (RECOGNITION_COUNTED_METHOD_PATTERN.test(String(value.countMethod))) {
    return {
      ok: false,
      code: "RECOGNITION_COUNT_METHOD_REFUSED",
      reason: `countMethod "${value.countMethod}" describes counting plotted marks, not reading a printed quantity. `
        + "A recognition occurrence count is never physical quantity authority, so no vocabulary value can admit it.",
    };
  }
  if (!COUNT_METHODS.includes(value.countMethod)) {
    return {
      ok: false,
      code: "ADJUDICATION_COUNT_METHOD_UNKNOWN",
      reason: `countMethod must be one of ${COUNT_METHODS.join(", ")} -- all of which describe reading a PRINTED quantity. `
        + "Counting plotted symbols is not a printed count and has no method here.",
    };
  }

  // --- the printed-text consistency rule ------------------------------------
  // This is the guard that makes "6 occurrences x 2 Nos" unreachable as a
  // shortcut. The number asserted must be the numeral(s) actually printed.
  const numerals = printedNumerals(value.printedText);
  if (numerals.length === 0) {
    return {
      ok: false,
      code: "ADJUDICATION_PRINTED_NUMERAL_ABSENT",
      reason: `The printed text "${value.printedText}" contains no numeral. Physical quantity authority must come from a printed number; if this drawing prints a word such as "Nil", that is a count-method vocabulary gap to report, not a number to infer.`,
    };
  }

  if (numerals.length === 1) {
    // Checked BEFORE the numeric comparison so a sum declared over a single
    // printed numeral is reported as the structural problem it is, whatever the
    // asserted number happens to be. This is the guard that makes a recognizer's
    // 6 occurrences unusable as a "component": nothing printed 6.
    if (value.countMethod === "COMPONENT_CELL_SUM") {
      return {
        ok: false,
        code: "COMPONENT_SUM_WITHOUT_COMPONENTS",
        reason: `COMPONENT_CELL_SUM was declared but "${value.printedText}" prints a single numeral (${numerals[0]}), so there is no second printed component to multiply. `
          + "A component sum may only combine numerals that are actually printed; a symbol count cannot supply the missing one.",
      };
    }
    if (numerals[0] !== quantity) {
      return {
        ok: false,
        code: "PRINTED_QUANTITY_TEXT_MISMATCH",
        reason: `The adjudicated quantity ${quantity} is not the numeral printed in "${value.printedText}" (${numerals[0]}). `
          + "A quantity that does not appear in the reviewed printed text is not a printed count.",
      };
    }
  } else {
    // Two or more printed numerals ("6 x 2 Nos") may only combine into a total
    // as an explicit component sum over those printed components.
    if (value.countMethod !== "COMPONENT_CELL_SUM") {
      return {
        ok: false,
        code: "PRINTED_QUANTITY_TEXT_AMBIGUOUS",
        reason: `The printed text "${value.printedText}" carries ${numerals.length} numerals (${numerals.join(", ")}). `
          + "Combining printed components is only permitted as COMPONENT_CELL_SUM; it is never inferred.",
      };
    }
    // Every printed numeral is a component: "6 x 2 Nos" is six printed blocks of
    // two, so the physical total is their product. Crucially the multiplicand
    // must be PRINTED, so this can only be reached from text a reviewer actually
    // saw -- a recognition occurrence count has no printed text to attest and so
    // cannot enter here.
    const product = numerals.reduce((t, n) => t * n, 1);
    if (product !== quantity) {
      return {
        ok: false,
        code: "PRINTED_QUANTITY_TEXT_MISMATCH",
        reason: `The adjudicated quantity ${quantity} is not the product of the printed components in "${value.printedText}" (${numerals.join(" x ")} = ${product}).`,
      };
    }
  }

  return {
    ok: true,
    adjudication: {
      quantity,
      deviceClass: value.deviceClass.trim(),
      deviceVariant: value.deviceVariant ?? "STANDARD",
      countMethod: value.countMethod,
      printedText: value.printedText.trim(),
      floorOrArea: isNonEmptyString(value.floorOrArea) ? value.floorOrArea.trim() : null,
      printedTotal: value.printedTotal ?? null,
      componentTotal: value.componentTotal ?? null,
    },
  };
}

// ---- AUTHORITY EVALUATION ----------------------------------------------------

/**
 * Decide whether a reviewed drawing candidate may become physical quantity
 * authority, and resolve the canonical writer input it yields.
 *
 * Every refusal returns an exact code so the gap is reportable rather than a
 * generic "not allowed". The returned `claimInput` deliberately omits the
 * evidence fingerprint: the caller derives it with
 * governedQuantityClaimFingerprint() from exactly this evidence, so a reviewer
 * can never hand-author it.
 *
 * @param input
 * @param input.proposal                   drawing_extraction_proposals row
 * @param input.projectId                  the project the caller is scoped to
 * @param input.sourceAssets               [{ id, textContent }] resolved from source_references
 * @param input.currentDocumentVersionId   documents.current_version_id
 * @param input.intakeDocumentVersionId    drawing_intake_versions.document_version_id
 * @param input.isReviewerHuman            false for any synthetic actor id
 */
export function evaluatePrintedQuantityReviewAuthority(input = {}) {
  const {
    proposal,
    projectId,
    sheet = null,
    sourceAssets = [],
    currentDocumentVersionId = null,
    intakeDocumentVersionId = null,
    isReviewerHuman = false,
  } = input;

  if (!proposal || typeof proposal !== "object") {
    return { ok: false, code: "PROPOSAL_NOT_FOUND", reason: "No reviewed drawing proposal was supplied." };
  }
  if (isNonEmptyString(projectId) && proposal.project_id !== projectId) {
    return {
      ok: false,
      code: "CROSS_PROJECT_PROPOSAL",
      reason: "This proposal belongs to another project; a quantity claim may only be created inside its own project.",
    };
  }
  if (!PRINTED_QUANTITY_PROPOSAL_TYPES.includes(proposal.proposal_type)) {
    return {
      ok: false,
      code: "PROPOSAL_TYPE_NOT_QUANTITY",
      reason: `Proposal type "${proposal.proposal_type}" does not carry a printed quantity. Only ${PRINTED_QUANTITY_PROPOSAL_TYPES.join(", ")} may become quantity authority.`,
    };
  }
  if (isNonEmptyString(proposal.superseded_at)) {
    return {
      ok: false,
      code: "PROPOSAL_SUPERSEDED",
      reason: `This proposal was superseded at ${proposal.superseded_at} by a later visual run. Superseded evidence is history, not current authority; re-run the visual analysis to produce a live candidate.`,
    };
  }
  if (!QUANTITY_REVIEW_AUTHORITY_STATUSES.includes(proposal.review_status)) {
    return {
      ok: false,
      code: "REVIEW_NOT_AUTHORISED",
      reason: `Review status "${proposal.review_status}" carries no quantity authority. `
        + `A human decision must first record "${QUANTITY_REVIEW_AUTHORITY_STATUSES.join("` or `")}" via the governed review path.`,
    };
  }
  if (!isNonEmptyString(proposal.reviewed_by)) {
    return { ok: false, code: "REVIEWER_MISSING", reason: "The proposal records no reviewing actor." };
  }
  if (!isReviewerHuman) {
    return {
      ok: false,
      code: "SYNTHETIC_REVIEWER_REFUSED",
      reason: `Reviewer "${proposal.reviewed_by}" is not a human decision-maker. `
        + "A synthetic/development identity may record a proposal but can never confer quantity authority.",
    };
  }
  if (!isNonEmptyString(proposal.reviewed_at)) {
    return { ok: false, code: "REVIEW_TIMESTAMP_MISSING", reason: "The review records no timestamp, so it cannot be placed in the audit sequence." };
  }
  if (!isNonEmptyString(proposal.review_reason)) {
    return { ok: false, code: "REVIEW_REASON_MISSING", reason: "The review records no substantive reason." };
  }

  // --- THE BARE-NUMBER RULE -------------------------------------------------
  // An `approve` sets review_status but leaves corrected_value null, so no device
  // class was ever bound. Refuse rather than guess which device the numeral counts.
  let adjudicatedValue = proposal.corrected_value;
  if (typeof adjudicatedValue === "string") {
    try { adjudicatedValue = JSON.parse(adjudicatedValue); } catch { adjudicatedValue = null; }
  }
  if (adjudicatedValue === null || adjudicatedValue === undefined) {
    return {
      ok: false,
      code: "QUANTITY_ADJUDICATION_MISSING",
      reason: "This proposal was approved without a printed-quantity adjudication, so no device class is bound to the numeral. "
        + `A printed numeral alone is not quantity authority (this candidate is flagged ${readHardReasons(proposal).join(", ") || "UNCLASSIFIED"}). `
        + 'Use the review path\'s "correct" action to record which governed device class the printed numeral counts, and at what count method.',
    };
  }

  const validated = validatePrintedQuantityAdjudication(adjudicatedValue);
  if (!validated.ok) return validated;
  const adjudication = validated.adjudication;

  // --- governed class meaning, never the reviewer's word ---------------------
  const meaning = classifyLegendClass(adjudication.deviceClass);
  if (!meaning || meaning.state !== "GOVERNED_AND_PROVEN") {
    return {
      ok: false,
      code: "CLASS_MEANING_NOT_GOVERNED",
      reason: `Legend class "${adjudication.deviceClass}" is ${meaning?.state ?? "unknown"}, so no physical quantity may be asserted for it. `
        + "An unresolved class is UNRESOLVED with a null quantity, never zero.",
    };
  }

  // --- currentness ----------------------------------------------------------
  if (!isNonEmptyString(intakeDocumentVersionId)) {
    return { ok: false, code: "MISSING_DOCUMENT_VERSION", reason: "The proposal's intake version does not resolve to a document version, so the claim could never go stale." };
  }
  if (!isNonEmptyString(currentDocumentVersionId)) {
    return { ok: false, code: "MISSING_CURRENT_DOCUMENT_VERSION", reason: "The document's current version is unknown." };
  }
  if (intakeDocumentVersionId !== currentDocumentVersionId) {
    return {
      ok: false,
      code: "STALE_DOCUMENT_VERSION",
      reason: `The reviewed evidence belongs to document version ${intakeDocumentVersionId}, but the document's current version is ${currentDocumentVersionId}. `
        + "A claim may only bind to the current version; re-run the review against the current drawing.",
    };
  }

  if (!isNonEmptyString(sheet)) {
    return {
      ok: false,
      code: "MISSING_SHEET_IDENTITY",
      reason: "No governed sheet identity was resolved for this document. 0020 quantity authority is location-scoped, so a claim with no sheet cannot exist.",
    };
  }

  // --- source evidence ------------------------------------------------------
  const assetIds = sourceAssets.map((a) => a?.id).filter(isNonEmptyString);
  if (assetIds.length === 0) {
    return { ok: false, code: "MISSING_SOURCE_ASSETS", reason: "The adjudication cites no governed source asset." };
  }
  const unresolved = sourceAssets.filter((a) => !isNonEmptyString(a?.id));
  if (unresolved.length > 0) {
    return { ok: false, code: "UNVERIFIABLE_SOURCE_ASSETS", reason: "A cited source asset has no identity." };
  }

  return {
    ok: true,
    adjudication,
    meaning,
    claimInput: {
      projectId: proposal.project_id,
      documentId: proposal.document_id,
      documentVersionId: intakeDocumentVersionId,
      sheet: sheet.trim(),
      page: Number.isInteger(proposal.page_number) ? proposal.page_number : null,
      parserVersion: proposal.extraction_version ?? null,
      semanticsVersion: meaning.semanticsVersion ?? null,
      deviceClass: adjudication.deviceClass,
      deviceVariant: adjudication.deviceVariant,
      floorOrArea: adjudication.floorOrArea,
      quantityType: "PHYSICAL_DEVICE",
      physicalQuantity: adjudication.quantity,
      unit: "Nos",
      countMethod: adjudication.countMethod,
      printedTotal: adjudication.printedTotal,
      componentTotal: adjudication.componentTotal,
      sourceRegion: null,
      sourceAssetIds: assetIds,
      reviewedBy: proposal.reviewed_by,
      reviewReason: proposal.review_reason,
      reviewStatus: "Approved",
    },
    // What the reviewer must NOT be asked to do: there is no field for a symbol
    // count, and no count method that would accept one.
    recognitionCountIsAdmissible: false,
  };
}

const readHardReasons = (proposal) => {
  try {
    const parsed = JSON.parse(proposal.hard_review_reasons ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isNonEmptyString) : [];
  } catch { return []; }
};

// ---- REVIEWER-FACING PACKET --------------------------------------------------

const safeParse = (raw, fallback = null) => {
  if (raw === null || raw === undefined) return fallback;
  if (typeof raw === "object") return raw;
  try { return JSON.parse(raw); } catch { return fallback; }
};

/**
 * Assemble exactly what a reviewer needs to Approve / Correct / Reject one
 * printed quantity without relying on hidden assumptions.
 *
 * This is a READ model. It proposes nothing and confers nothing: it shows the
 * engine's candidate, the source crops and printed assets behind it, the
 * governed class meaning, and the exact blocking code if the candidate cannot
 * yet become authority. A reviewer is never handed a bare number.
 */
export function buildPrintedQuantityReviewPacket({
  proposal,
  document = null,
  currentDocumentVersionId = null,
  intakeDocumentVersionId = null,
  sourceAssets = [],
  isReviewerHuman = false,
} = {}) {
  if (!proposal || typeof proposal !== "object") {
    return { ok: false, code: "PROPOSAL_NOT_FOUND", reason: "No proposal to packet." };
  }

  const evidence = safeParse(proposal.evidence, {}) ?? {};
  const imageProvenance = Array.isArray(evidence.imageProvenance) ? evidence.imageProvenance : [];
  const corrected = safeParse(proposal.corrected_value, null);
  const adjudicated = corrected && typeof corrected === "object" ? validatePrintedQuantityAdjudication(corrected) : { ok: false };
  const meaning = adjudicated.ok ? classifyLegendClass(adjudicated.adjudication.deviceClass) : null;

  // The sheet identity comes from governed document identity, never from the
  // reviewer's free text: 0020 authority is location-scoped.
  const governedSheet = isNonEmptyString(document?.logical_name) ? document.logical_name : null;

  const verdict = evaluatePrintedQuantityReviewAuthority({
    proposal,
    projectId: proposal.project_id,
    sheet: governedSheet,
    sourceAssets,
    currentDocumentVersionId,
    intakeDocumentVersionId,
    isReviewerHuman,
  });

  return {
    ok: true,
    packetVersion: "printed-quantity-review-packet-1.0.0",
    proposalId: proposal.id,
    projectId: proposal.project_id,
    state: verdict.ok ? "READY_FOR_CLAIM" : "NOT_YET_AUTHORITATIVE",
    blockingCode: verdict.ok ? null : verdict.code,
    blockingReason: verdict.ok ? null : verdict.reason,

    // --- what the reviewer is deciding about -------------------------------
    location: {
      documentId: proposal.document_id,
      documentName: document?.logical_name ?? null,
      sourceSheet: evidence.sourceSheet ?? null,
      sourceDrawingNumber: evidence.sourceDrawingNumber ?? null,
      sourceRevision: evidence.sourceRevision ?? null,
      page: Number.isInteger(proposal.page_number) ? proposal.page_number : null,
    },
    currentDocumentVersionId,
    evidenceDocumentVersionId: intakeDocumentVersionId,
    isCurrentVersion: Boolean(intakeDocumentVersionId) && intakeDocumentVersionId === currentDocumentVersionId,

    deviceClass: {
      // Until the reviewer adjudicates, there IS no class. It is shown as
      // unassigned rather than guessed from the description.
      adjudicated: adjudicated.ok ? adjudicated.adjudication.deviceClass : null,
      governedMeaning: meaning ? { state: meaning.state, description: meaning.description ?? null } : null,
      engineFlag: readHardReasons(proposal).includes("QUANTITY_DEVICE_ASSOCIATION_UNKNOWN"),
      note: "The engine could not determine which device this numeral counts. The reviewer binds it to a governed legend class; a free-text label is refused.",
    },

    // --- the engine's proposal, labelled as a proposal ---------------------
    engineProposal: {
      rawLabel: proposal.raw_label,
      proposedQuantity: Number.isFinite(evidence.quantity) ? evidence.quantity : null,
      printedQuote: evidence.evidenceQuote ?? null,
      sourceSymbolOrText: evidence.sourceSymbolOrText ?? null,
      groundingWarning: evidence.groundingWarning ?? null,
      confidence: proposal.confidence ?? null,
      isAuthority: false,
    },

    // --- the evidence the reviewer must be able to look at -----------------
    sourceCrops: imageProvenance.map((p) => ({
      index: p.index ?? null,
      kind: p.kind ?? null,
      purpose: p.cropRect?.purpose ?? null,
      pageNumber: p.pageNumber ?? null,
      cropRect: p.cropRect ?? null,
      sha256: p.sha256 ?? null,
      objectKey: p.objectKey ?? null,
    })),
    sourceAssets: sourceAssets.map((a) => ({
      id: a.id,
      textContent: a.textContent ?? null,
      boundingBox: a.boundingBox ?? null,
      reviewStatus: a.reviewStatus ?? null,
    })),

    provenance: {
      extractionMethod: proposal.extraction_method,
      extractionVersion: proposal.extraction_version,
      visualRunId: proposal.visual_run_id ?? evidence.visualRunId ?? null,
      hardReviewReasons: readHardReasons(proposal),
      authorityRole: proposal.authority_role,
      governedStatus: proposal.governed_status,
      supersededAt: proposal.superseded_at ?? null,
    },

    review: {
      reviewStatus: proposal.review_status,
      reviewedBy: proposal.reviewed_by ?? null,
      reviewedAt: proposal.reviewed_at ?? null,
      reviewReason: proposal.review_reason ?? null,
      adjudicated: adjudicated.ok ? adjudicated.adjudication : null,
      adjudicatedError: adjudicated.ok ? null : (adjudicated.code ?? "ADJUDICATION_ABSENT"),
      reviewerIsHuman: isReviewerHuman,
    },

    // --- the three decisions, and exactly what each one does ---------------
    actions: {
      approve: {
        effect: "Sets review_status=Verified and leaves corrected_value unchanged.",
        consequence: verdict.ok
          ? "Eligible: this candidate may be promoted to a governed quantity claim."
          : "Still creates no quantity authority. An approve binds no device class, so the bare numeral cannot become a physical quantity.",
      },
      correct: {
        effect: "Sets review_status='Verified with Assumption' and records corrected_value: the quantity, the governed device class, the count method, and the literal printed text.",
        consequence: "This is the ONLY action that can carry printed quantity authority, and only when the adjudication is internally consistent with the printed text.",
      },
      reject: {
        effect: "Sets review_status=Rejected.",
        consequence: "Permanently excluded from quantity authority for this visual run.",
      },
    },
  };
}