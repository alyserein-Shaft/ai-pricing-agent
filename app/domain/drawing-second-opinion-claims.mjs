/**
 * Drawing second-opinion claim layer.
 *
 * PURPOSE
 * A governed place to hold what an advisory second opinion (NVIDIA document
 * second opinion) proposes about a drawing, alongside what native extraction
 * already found, WITHOUT letting the second opinion become authority.
 *
 * HARD RULES ENCODED HERE (these are the point of the module, not decoration)
 * 1. NVIDIA is never authority. A claim sourced only from the advisory layer is
 *    NEVER `CORROBORATED`; at best it is `INSUFFICIENT_EVIDENCE`.
 * 2. Disagreement is preserved, never resolved. Conflicting claims are retained
 *    with their conflicts; nothing is dropped and no winner is picked by
 *    confidence, model name, or arrival order.
 * 3. Nothing here promotes. The only status a claim can reach is `PROPOSED`.
 *    Promotion is a separate governed act outside this module.
 * 4. The claim vocabulary is closed. An unrecognised claim type is refused
 *    rather than invented.
 * 5. No semantics are invented. A claim carries the RAW observed token plus its
 *    evidence; it never asserts what a device class or code *means*.
 *
 * The module is pure: no I/O, no network, no database, no clock, no randomness.
 */

export const CLAIM_TYPES = Object.freeze([
  /** A legend entry maps a drawn code/mark to a project meaning. */
  "LEGEND_CODE_MEANING",
  /** A header cell is related to the column/row it titles. */
  "TABLE_HEADER_RELATION",
  /** A schedule row is related to the level/band it belongs to. */
  "SCHEDULE_ROW_RELATION",
  /** A counted quantity of a device. */
  "DEVICE_QUANTITY",
  /** A drawn device class, as OBSERVED. Meaning is never asserted. */
  "DEVICE_CLASS",
  /** A device is a member of a named loop. */
  "LOOP_MEMBERSHIP",
  /** A device/loop is associated with a panel. */
  "PANEL_ASSOCIATION",
  /** A panel/loop/zone is associated with a building. */
  "BUILDING_ASSOCIATION",
  /** A cross-reference from this sheet to another document or sheet. */
  "CROSS_REFERENCE",
  /** A drawn symbol is associated with its nearest label. */
  "SYMBOL_LABEL_ASSOCIATION",
  /** A subtotal relates to the class codes printed beneath/above it. */
  "SUBTOTAL_RELATION",
  /** A panel-to-panel or loop-to-loop topology link. */
  "TOPOLOGY_RELATION",
]);

const CLAIM_TYPE_SET = new Set(CLAIM_TYPES);

/** Where a claim's evidence came from. Native always outranks advisory. */
export const CLAIM_SOURCES = Object.freeze(["NATIVE", "NVIDIA", "BOTH"]);

/** Reconciliation verdicts. None of them is "approved". */
export const RECONCILIATION_STATES = Object.freeze([
  /** Native and advisory independently agree. */
  "CORROBORATED",
  /** They overlap but not completely; the difference is retained. */
  "PARTIALLY_CORROBORATED",
  /** They disagree. Both readings are retained. */
  "CONFLICT",
  /** Only one side has evidence, or the evidence cannot decide. */
  "INSUFFICIENT_EVIDENCE",
]);

const RECONCILIATION_SET = new Set(RECONCILIATION_STATES);

/** The only lifecycle status a claim may hold here. Promotion happens elsewhere. */
export const CLAIM_STATUSES = Object.freeze(["PROPOSED"]);

/**
 * Claim statuses a caller may NOT set here. Named so the refusal is legible
 * rather than a bare boolean.
 */
export const FORBIDDEN_CLAIM_STATUSES = Object.freeze([
  "APPROVED",
  "AUTHORITATIVE",
  "GOVERNED",
  "ACCEPTED",
  "PROMOTED",
  "FINAL",
]);

export const SECOND_OPINION_AUTHORITY = Object.freeze({
  AUTHORITATIVE_PARSER: "NATIVE_ONLY",
  NVIDIA_ROLE: "SHADOW_ONLY_ADVISORY",
  ESCALATION_POLICY: "MEASURED_NON_DISCRIMINATING",
  LEADING_ROW_DECISION: "TABLE_TITLE_UNLESS_INDEPENDENT_HIERARCHY_EVIDENCE",
});

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normaliseToken(value) {
  return typeof value === "string" ? value.trim().toUpperCase() : "";
}

/**
 * Comparable form of a claim value.
 *
 * Comparison is on the UPPER-CASED, whitespace-collapsed token so that trivial
 * case and spacing differences do not manufacture a conflict. It is deliberately
 * conservative: it does NOT strip punctuation, subscripts, or trailing "(Cont'd)"
 * markers, because those are exactly the mutations the advisory layer is known
 * to introduce and we must not paper over them.
 */
export function claimValueKey(claimValue) {
  return normaliseToken(claimValue).replace(/\s+/g, " ");
}

/**
 * Key for the subject a claim is about. Same conservatism as the value key: a
 * subject identifies the thing, and must not be collapsed so loosely that two
 * different things merge into one bucket.
 */
export function claimSubjectKey(claimSubject) {
  return normaliseToken(claimSubject).replace(/\s+/g, " ");
}

/** A point in native PDF user space. Kept as-is; no unit conversion is implied. */
function sanitiseBbox(bbox) {
  if (bbox === null || bbox === undefined) return null;
  if (!isPlainObject(bbox)) return null;
  const { x, y, width, height } = bbox;
  if (![x, y, width, height].every((n) => typeof n === "number" && Number.isFinite(n))) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function sanitiseEvidenceList(value) {
  if (value === null || value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .map((item) => ({ source_text: item }));
}

/**
 * Build one governed claim.
 *
 * Refuses (rather than repairs) a claim that is missing its provenance or that
 * tries to assert authority. A claim with no evidence from either side is not a
 * claim, and a claim that declares itself authoritative is a governance
 * violation, not something to silently downgrade.
 */
export function buildDrawingFactClaim(input) {
  if (!isPlainObject(input)) {
    return { ok: false, error: "INVALID_CLAIM_INPUT", reason: "Claim input must be an object." };
  }

  const {
    claimType,
    claimValue,
    // The identity of the THING being claimed about, independent of its value.
    // Two claims about the same subject with different values are a conflict;
    // without a subject they would silently land in different buckets and the
    // conflict could never be detected. When absent, the value key is used,
    // which can corroborate agreement but can never surface disagreement.
    claimSubject = null,
    projectId,
    documentId = null,
    documentVersionId = null,
    sheet = null,
    page = null,
    bbox = null,
    nativeEvidence = null,
    nvidiaEvidence = null,
    visualEvidence = null,
    confidence = null,
    conflicts = null,
    status = "PROPOSED",
    notes = null,
  } = input;

  if (!CLAIM_TYPE_SET.has(claimType)) {
    return {
      ok: false,
      error: "UNRECOGNISED_CLAIM_TYPE",
      reason: `Claim type "${claimType}" is not in the closed drawing-claim vocabulary.`,
    };
  }

  if (normaliseClaimStatus(status) !== "PROPOSED") {
    return {
      ok: false,
      error: "CLAIM_STATUS_NOT_PERMITTED",
      reason:
        "A second-opinion claim may only be PROPOSED. Approval, promotion and " +
        "governance are separate governed acts and cannot be asserted here.",
    };
  }

  const hasNative = sanitiseEvidenceList(nativeEvidence).length > 0;
  const hasNvidia = sanitiseEvidenceList(nvidiaEvidence).length > 0;
  if (!hasNative && !hasNvidia) {
    return {
      ok: false,
      error: "NO_EVIDENCE",
      reason: "A claim must retain native evidence, advisory evidence, or both.",
    };
  }

  if (typeof projectId !== "string" || projectId.trim() === "") {
    return { ok: false, error: "MISSING_PROJECT", reason: "Every drawing claim is bound to a project." };
  }

  const confidenceValue =
    typeof confidence === "number" && Number.isFinite(confidence)
      ? Math.min(Math.max(confidence, 0), 1)
      : null;

  const claim = {
    claim_type: claimType,
    // The RAW observed token. Meaning is never added here.
    claim_value: typeof claimValue === "string" ? claimValue.trim() : "",
    claim_subject: claimSubjectKey(claimSubject),
    project_id: projectId.trim(),
    document_id: documentId,
    document_version_id: documentVersionId,
    sheet: typeof sheet === "string" && sheet.trim() !== "" ? sheet.trim() : null,
    page: typeof page === "number" && Number.isFinite(page) ? page : null,
    bbox: sanitiseBbox(bbox),
    native_evidence: sanitiseEvidenceList(nativeEvidence),
    nvidia_evidence: sanitiseEvidenceList(nvidiaEvidence),
    visual_evidence: sanitiseEvidenceList(visualEvidence),
    // Evidence provenance, derived rather than trusted from the caller.
    evidence_sources: hasNative && hasNvidia ? ["BOTH"] : hasNative ? ["NATIVE"] : ["NVIDIA"],
    confidence: confidenceValue,
    conflicts: Array.isArray(conflicts) ? conflicts.filter((c) => c !== null && c !== undefined) : [],
    status: "PROPOSED",
    authority: SECOND_OPINION_AUTHORITY,
    notes: typeof notes === "string" && notes.trim() !== "" ? notes.trim() : null,
  };

  return { ok: true, claim };
}

function normaliseClaimStatus(status) {
  return typeof status === "string" ? status.trim().toUpperCase() : "";
}

/**
 * Reconcile two claims of the same type/value that describe the same thing.
 *
 * The verdict describes the RELATIONSHIP BETWEEN THE EVIDENCE. It is never an
 * approval, and it never discards a reading.
 *
 * Rules:
 *  - Only the advisory layer alone => INSUFFICIENT_EVIDENCE, no matter how
 *    confident the model claimed to be. This is the load-bearing rule.
 *  - Only native => INSUFFICIENT_EVIDENCE (uncorroborated, but native stands
 *    on its own as native evidence).
 *  - Both, same value key => CORROBORATED.
 *  - Both, different value keys => CONFLICT, both retained.
 *  - Both, same value but non-identical evidence sets => PARTIALLY_CORROBORATED
 *    when one side's evidence is a strict subset, because the extra native text
 *    is then unreconciled detail rather than a contradiction.
 */
/**
 * Reconcile the native and advisory claims for one subject.
 *
 * `siblingNativeClaims` are additional native claims about the SAME subject,
 * typically from a different sheet. Two independent native sources agreeing is
 * corroboration in its own right -- but it is a DIFFERENT kind from native
 * agreeing with the advisory layer, so it is reported under its own basis and
 * never laundered into advisory corroboration.
 */
export function reconcileDrawingClaims({ nativeClaim = null, nvidiaClaim = null, siblingNativeClaims = [] }) {
  const native = isPlainObject(nativeClaim) ? nativeClaim : null;
  const advisory = isPlainObject(nvidiaClaim) ? nvidiaClaim : null;
  const siblings = (Array.isArray(siblingNativeClaims) ? siblingNativeClaims : []).filter(isPlainObject);

  if (!native && !advisory) {
    return {
      ok: false,
      error: "NOTHING_TO_RECONCILE",
      reason: "Reconciliation needs at least one claim.",
    };
  }

  const hasNative = Boolean(native);
  const hasAdvisory = Boolean(advisory);

  // Rule 1 + 2: advisory-only evidence can never be promoted to corroborated,
  // however confident it is. An advisory-only claim is simply unproven.
  if (!hasNative) {
    return finalise({
      state: "INSUFFICIENT_EVIDENCE",
      basis: "ADVISORY_ONLY_CANNOT_CORROBORATE",
      native_value: null,
      nvidia_value: advisory.claim_value ?? null,
      conflict_detail: [],
      notes:
        "Advisory evidence alone cannot corroborate a drawing fact. Native extraction " +
        "has not found this. Retained as a proposal for governed review only.",
      confidence: advisory.confidence ?? null,
      corroborating_sheets: [],
    });
  }

  if (!hasAdvisory) {
    // Independent native sources agreeing is genuine corroboration of the
    // drawing itself. It is reported distinctly, and only when the siblings are
    // genuinely independent (different documents or sheets) -- a duplicate of the
    // same reading on one sheet is not corroboration.
    const independentSheets = distinctProvenance([native, ...siblings]);
    const agreesWithSiblings =
      siblings.length > 0 &&
      siblings.every((s) => claimValueKey(s.claim_value) === claimValueKey(native.claim_value)) &&
      independentSheets.length > 1;

    return finalise({
      state: agreesWithSiblings ? "CORROBORATED" : "INSUFFICIENT_EVIDENCE",
      basis: agreesWithSiblings ? "NATIVE_CROSS_SHEET_AGREEMENT" : "NATIVE_ONLY_NOT_CORROBORATED",
      native_value: native.claim_value ?? null,
      nvidia_value: null,
      conflict_detail: [],
      notes: agreesWithSiblings
        ? `Independent native sources on ${independentSheets.length} distinct sheets/documents agree. ` +
          "Corroborated by native evidence only; the advisory layer did not address this fact."
        : "Native evidence only. The advisory layer did not address this fact.",
      confidence: native.confidence ?? null,
      corroborating_sheets: independentSheets,
    });
  }

  const nativeKey = claimValueKey(native.claim_value);
  const advisoryKey = claimValueKey(advisory.claim_value);

  if (nativeKey === advisoryKey) {
    const nativeText = new Set(textsOf(native));
    const advisoryText = new Set(textsOf(advisory));
    const onlyNative = [...nativeText].filter((t) => !advisoryText.has(t));
    const onlyAdvisory = [...advisoryText].filter((t) => !nativeText.has(t));

    if (onlyNative.length === 0 && onlyAdvisory.length === 0) {
      return finalise({
        state: "CORROBORATED",
        basis: "AGREEING_EVIDENCE",
        native_value: native.claim_value,
        nvidia_value: advisory.claim_value,
        conflict_detail: [],
        notes: "Native and advisory evidence agree on the observed value and supporting text.",
        confidence: advisory.confidence ?? null,
      });
    }

    return finalise({
      state: "PARTIALLY_CORROBORATED",
      basis: "AGREED_VALUE_UNRECONCILED_SUPPORTING_TEXT",
      native_value: native.claim_value,
      nvidia_value: advisory.claim_value,
      conflict_detail: [
        ...onlyNative.map((t) => ({ side: "NATIVE", detail: t })),
        ...onlyAdvisory.map((t) => ({ side: "NVIDIA", detail: t })),
      ],
      notes:
        "Both sides agree on the value but not on every supporting text fragment. " +
        "The differing fragments are retained rather than merged.",
      confidence: advisory.confidence ?? null,
    });
  }

  // Genuine disagreement. Retain BOTH readings verbatim. Never pick a winner,
  // and never let a higher advisory confidence break the tie.
  return finalise({
    state: "CONFLICT",
    basis: "DISAGREING_VALUES",
    native_value: native.claim_value,
    nvidia_value: advisory.claim_value,
    conflict_detail: [
      { side: "NATIVE", detail: `native reads "${native.claim_value}"` },
      { side: "NVIDIA", detail: `advisory reads "${advisory.claim_value}"` },
    ],
    notes:
      "Native and advisory readings disagree. Both are retained. A higher advisory " +
      "confidence does NOT resolve this; resolution requires governed human review.",
    confidence: advisory.confidence ?? null,
  });
}

/**
 * The distinct documents/sheets a set of claims came from.
 *
 * Used to decide whether two native claims are genuinely INDEPENDENT readings.
 * Two claims from the same sheet are one reading, however many times repeated;
 * corroboration requires different provenance.
 */
function distinctProvenance(claims) {
  const seen = new Set();
  for (const claim of claims) {
    const sheet = claim.sheet ?? null;
    const doc = claim.document_id ?? claim.document_version_id ?? null;
    seen.add(`${doc ?? "?"}::${sheet ?? "?"}`);
  }
  return [...seen];
}

function textsOf(claim) {
  return [
    ...(claim.native_evidence ?? []).map((e) => e.source_text),
    ...(claim.nvidia_evidence ?? []).map((e) => e.source_text),
    ...(claim.visual_evidence ?? []).map((e) => e.source_text),
  ].filter(Boolean);
}

function finalise({ state, basis, native_value, nvidia_value, conflict_detail, notes, confidence, corroborating_sheets = [] }) {
  return {
    ok: true,
    reconciliation: {
      state,
      basis,
      native_value,
      nvidia_value,
      corroborating_sheets,
      // Both values are always present in a conflict so neither can be lost.
      retained_values: [native_value, nvidia_value].filter((v) => v !== null && v !== undefined),
      conflict_detail,
      notes,
      confidence,
      // Reconciliation never confers authority.
      status: "PROPOSED",
      authority: SECOND_OPINION_AUTHORITY,
    },
  };
}

/**
 * Reconcile a whole evidence batch.
 *
 * Groups claims by (claim_type, claim_subject) -- NOT by value. Grouping by value
 * would put two disagreeing readings about the same subject into different
 * buckets, and the conflict would be invisible. When a claim carries no subject
 * the value key is used, which can still corroborate agreement within a bucket
 * but cannot raise a disagreement.
 *
 * Within a bucket, if the native and advisory sides each carry more than one
 * distinct value, that itself is a conflict: it means the evidence within one
 * provenance is not self-consistent.
 *
 * Output order is derived from sorted bucket keys, so input order cannot change
 * the result.
 */
export function reconcileClaimBatch(claims) {
  const list = Array.isArray(claims) ? claims.filter(isPlainObject) : [];
  const buckets = new Map();

  for (const claim of list) {
    const subject = claim.claim_subject || claimValueKey(claim.claim_value);
    const key = `${claim.claim_type} ${subject}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(claim);
  }

  const entries = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, group]) => {
      const native = group.find((c) => (c.evidence_sources ?? []).includes("NATIVE")) ?? null;
      const advisory = group.find((c) => (c.evidence_sources ?? []).includes("NVIDIA")) ?? null;

      // Self-inconsistency within a single provenance is itself a conflict.
      const nativeValues = new Set(
        group.filter((c) => (c.evidence_sources ?? []).includes("NATIVE")).map((c) => claimValueKey(c.claim_value)),
      );
      const advisoryValues = new Set(
        group.filter((c) => (c.evidence_sources ?? []).includes("NVIDIA")).map((c) => claimValueKey(c.claim_value)),
      );
      const internallyInconsistent =
        nativeValues.size > 1 || advisoryValues.size > 1;

      const result = internallyInconsistent
        ? finalise({
            state: "CONFLICT",
            basis: "INTERNALLY_INCONSISTENT_EVIDENCE",
            native_value: [...nativeValues].join(" | ") || null,
            nvidia_value: [...advisoryValues].join(" | ") || null,
            conflict_detail: [
              ...[...nativeValues].map((v) => ({ side: "NATIVE", detail: `native reports "${v}"` })),
              ...[...advisoryValues].map((v) => ({ side: "NVIDIA", detail: `advisory reports "${v}"` })),
            ],
            notes:
              "A single provenance reported more than one value for the same subject. " +
              "All readings are retained; none is selected.",
            confidence: advisory?.confidence ?? null,
          })
        : reconcileDrawingClaims({
            nativeClaim: native,
            nvidiaClaim: advisory,
            // Every other NATIVE claim in the bucket is an independent reading of
            // the same subject, so it is offered as corroboration evidence.
            siblingNativeClaims: group.filter(
              (c) => c !== native && (c.evidence_sources ?? []).includes("NATIVE"),
            ),
          });

      return {
        claim_type: group[0].claim_type,
        claim_subject: key.split(" ")[1],
        claim_count: group.length,
        status: result.ok ? result.reconciliation.state : "INSUFFICIENT_EVIDENCE",
        claims: group,
        ...(result.ok ? { reconciliation: result.reconciliation } : { reconciliation_error: result.error }),
      };
    });

  const summary = {
    buckets: entries.length,
    corroborated: entries.filter((e) => e.status === "CORROBORATED").length,
    partially_corroborated: entries.filter((e) => e.status === "PARTIALLY_CORROBORATED").length,
    conflicts: entries.filter((e) => e.status === "CONFLICT").length,
    insufficient_evidence: entries.filter((e) => e.status === "INSUFFICIENT_EVIDENCE").length,
  };

  return { ok: true, entries, summary };
}

/**
 * Guard used before any governed consumer reads a claim batch.
 *
 * Returns the reasons a batch must NOT be treated as sufficient for sizing.
 * This is deliberately a list of blockers rather than a boolean so a caller can
 * report exactly what is still missing.
 */
export function claimBatchBlockers(result) {
  const blockers = [];
  if (!isPlainObject(result) || !Array.isArray(result.entries)) {
    blockers.push("NO_RECONCILED_CLAIMS");
    return blockers;
  }
  if (result.entries.length === 0) blockers.push("NO_RECONCILED_CLAIMS");

  for (const entry of result.entries) {
    if (entry.status === "CONFLICT") blockers.push(`UNRESOLVED_CONFLICT:${entry.claim_type}`);
    if (entry.status === "INSUFFICIENT_EVIDENCE") {
      const sources = entry.claims.some((c) => (c.evidence_sources ?? []).includes("NVIDIA"))
        && !entry.claims.some((c) => (c.evidence_sources ?? []).includes("NATIVE"))
        ? "ADVISORY_ONLY"
        : "NOT_CORROBORATED";
      blockers.push(`${sources}:${entry.claim_type}`);
    }
  }
  // A batch whose every claim is advisory-only can never unblock sizing.
  const anyNative = result.entries.some((e) => e.claims.some((c) => (c.evidence_sources ?? []).includes("NATIVE")));
  if (!anyNative && result.entries.length > 0) blockers.push("NO_NATIVE_EVIDENCE_IN_BATCH");

  return [...new Set(blockers)];
}