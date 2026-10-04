// AI PROVIDER ESCALATION POLICY -- governed, deterministic, credential-free.
//
// WHY THIS FILE EXISTS
// --------------------
// The NVIDIA NIM provider already exists in worker/boq-understanding-provider.mjs
// and is thoroughly tested. What does NOT exist is a GOVERNED LADDER: the
// provider reports `escalationModel: null, escalationEnabled: false`, so every
// call currently runs on one model regardless of how hard the item actually is.
// That means two opposite failures are both possible and neither is controlled:
// trivially easy items pay for the strongest model, and genuinely ambiguous items
// never get a second, stronger look.
//
// This module supplies the missing decision, and ONLY the decision. It performs no
// network call, reads no credential, and touches no project data. It is a pure
// function of the observed response plus the declared ladder.
//
// THE GOVERNANCE INVARIANTS THIS ENFORCES
// ----------------------------------------
// 1. NO HIDDEN FALLBACK. A tier may only change by producing an explicit reason
//    from this module. The caller cannot silently pick a model.
// 2. AI NEVER ESCALATES INTO AUTHORITY. When a decision needs human authority the
//    result is HUMAN_REVIEW_REQUIRED, which is terminal and outranks every model
//    tier. A bigger model never converts a review into an approval.
// 3. THE LADDER IS CLOSED. It cannot grow a tier at runtime; the vocabulary is
//    frozen and an unknown tier is an error, not a passthrough.
// 4. EVERY DECISION IS EXPLAINED and fingerprintable, so a later reviewer can see
//    why a bigger model was used without trusting the model that asked for it.
// 5. DEGRADATION IS EXPLICIT. If a higher tier is unavailable the result says so
//    and stays at the lower tier; it never pretends the escalation happened.

export const ESCALATION_TIERS = Object.freeze(["LIGHTNING", "SUPER", "ULTRA"]);

// The canonical hosted catalog these tiers refer to. Declared as DATA so a
// caller can resolve tier -> model without this module ever making a call, and
// so the mapping is auditable in one place.
export const NVIDIA_HOSTED_REFERENCE = Object.freeze({
  baseUrl: "https://integrate.api.nvidia.com/v1",
  // VERIFIED 2026-10-01 by the main agent against build.nvidia.com model pages.
  // These are real, hosted, OpenAI-compatible chat-completions endpoints.
  //
  // VERIFICATION METHOD, because build.nvidia.com returns HTTP 200 for EVERY
  // path including slugs that do not exist. A 200 is therefore worthless as
  // proof. A real model page is ~300-345 KB and embeds chat/completions
  // templates; a soft-404 shell is ~86 KB with none. All three IDs below were
  // confirmed by that discriminator AND by a negative control
  // ("totally-not-a-real-model-xyz", which returns 200 and 86 KB).
  verifiedModelIds: Object.freeze({
    LIGHTNING: "nvidia/nemotron-3.5-lightning-30b-a3b",
    SUPER: "nvidia/nemotron-3-super-120b-a12b",
    ULTRA: "nvidia/nemotron-3-ultra-550b-a55b",
  }),
  // Recorded so a future maintainer does not re-verify the same dead link: the
  // unversioned slug is a soft-404 shell and was confirmed absent, not merely
  // unfetched. It is the slug NVIDIA's own RAG Blueprint README links to.
  soft404Slugs: Object.freeze(["nvidia/nemotron-ocr"]),
  verifiedAt: "2026-10-01",
});

export const MODEL_TIER_IDENTITY = Object.freeze({
  LIGHTNING: Object.freeze({
    tier: "LIGHTNING",
    role: "BULK_DEFAULT",
    hostedModelId: NVIDIA_HOSTED_REFERENCE.verifiedModelIds.LIGHTNING,
    intendedFor: Object.freeze([
      "BOQ understanding of unambiguous descriptions",
      "classification",
      "structured extraction",
      "simple normalization",
    ]),
    note: "Cheapest and fastest tier. The default for anything that is not ambiguous.",
  }),
  SUPER: Object.freeze({
    tier: "SUPER",
    role: "ESCALATION_FIRST",
    hostedModelId: NVIDIA_HOSTED_REFERENCE.verifiedModelIds.SUPER,
    intendedFor: Object.freeze([
      "ambiguous or abbreviated descriptions",
      "multi-clause requirement interpretation",
      "conflicting evidence within one document",
      "RAG synthesis over several retrieved evidence chunks",
    ]),
    note: "Used when the first answer is not trustworthy enough to accept, but the item is not exceptional.",
  }),
  ULTRA: Object.freeze({
    tier: "ULTRA",
    role: "EXCEPTIONAL_ESCALATION_ONLY",
    hostedModelId: NVIDIA_HOSTED_REFERENCE.verifiedModelIds.ULTRA,
    intendedFor: Object.freeze([
      "difficult engineering reasoning",
      "conflicting evidence ACROSS multiple documents",
      "hard compatibility analysis",
      "final advisory opinion on a high-complexity item",
    ]),
    note: "Reserved for genuinely exceptional items. Expensive and slow, so the bar to enter it is deliberately high.",
  }),
});

/** Closed reasons. Adding one requires updating the tests that pin the vocabulary. */
export const ESCALATION_REASONS = Object.freeze({
  ACCEPTED_AT_ENTRY: "ACCEPTED_AT_ENTRY",
  SCHEMA_INVALID: "SCHEMA_INVALID",
  LOW_CONFIDENCE: "LOW_CONFIDENCE",
  MISSING_EVIDENCE: "MISSING_EVIDENCE",
  INFERRED_NOT_EXTRACTED: "INFERRED_NOT_EXTRACTED",
  CONFLICTING_EVIDENCE: "CONFLICTING_EVIDENCE",
  NORMALIZATION_APPLIED: "NORMALIZATION_APPLIED",
  CROSS_DOCUMENT_CONFLICT: "CROSS_DOCUMENT_CONFLICT",
  EXHAUSTED_LADDER: "EXHAUSTED_LADDER",
  HIGHER_TIER_UNAVAILABLE: "HIGHER_TIER_UNAVAILABLE",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
});

export const ESCALATION_OUTCOMES = Object.freeze({
  USE_TIER: "USE_TIER",
  HUMAN_REVIEW_REQUIRED: "HUMAN_REVIEW_REQUIRED",
});

/** Thresholds are declared once, here, and are part of the fingerprint. */
export const ESCALATION_THRESHOLDS = Object.freeze({
  /** At or below this overall confidence the first answer is not accepted. */
  acceptConfidence: 80,
  /** Per-fact confidence at or below this counts as a weak fact. */
  weakFactConfidence: 50,
  /** A count of weak/missing/inferred facts at or above this forces escalation. */
  weakFactCount: 3,
  /** Cross-document conflict always reaches ULTRA regardless of confidence. */
});

const isTier = (v) => ESCALATION_TIERS.includes(String(v));

function nextTier(tier) {
  const i = ESCALATION_TIERS.indexOf(tier);
  return i >= 0 && i < ESCALATION_TIERS.length - 1 ? ESCALATION_TIERS[i + 1] : null;
}

/**
 * Walk a fact tree and count evidence quality signals.
 * `origin` and `confidence` are the canonical per-fact fields already produced by
 * the BOQ understanding engine, so this reads the real governed output rather than
 * inventing a parallel signal.
 */
export function assessEvidenceQuality(value) {
  const stats = { total: 0, extracted: 0, inferred: 0, missing: 0, weak: 0, minConfidence: 100 };
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    if (Object.hasOwn(node, "origin") && Object.hasOwn(node, "confidence")) {
      stats.total += 1;
      const origin = String(node.origin).toUpperCase();
      const confidence = Number(node.confidence);
      if (origin === "MISSING") stats.missing += 1;
      else if (origin === "INFERRED") stats.inferred += 1;
      else if (origin === "EXTRACTED") stats.extracted += 1;
      if (Number.isFinite(confidence)) {
        if (confidence < stats.minConfidence) stats.minConfidence = confidence;
        if (confidence <= ESCALATION_THRESHOLDS.weakFactConfidence) stats.weak += 1;
      }
      return; // a fact is a leaf; do not descend into its payload
    }
    Object.values(node).forEach(visit);
  };
  visit(value);
  return stats;
}

/**
 * Decide the tier for one item.
 *
 * Pure: no network, no credentials, no project access. The caller passes what it
 * observed; this function only decides and explains.
 */
export function decideEscalation({
  entryTier = "LIGHTNING",
  response = null,
  schemaValid = true,
  crossDocumentConflict = false,
  humanAuthorityRequired = false,
  availableTiers = ESCALATION_TIERS,
  observedAt = null,
} = {}) {
  if (!isTier(entryTier)) {
    return Object.freeze({
      state: "INVALID_TIER",
      reason: null,
      outcome: ESCALATION_OUTCOMES.USE_TIER,
      tier: null,
      reasons: [],
      provenance: null,
    });
  }

  // INVARIANT 2: authority outranks every model tier, and is terminal.
  if (humanAuthorityRequired) {
    return Object.freeze({
      state: ESCALATION_OUTCOMES.HUMAN_REVIEW_REQUIRED,
      outcome: ESCALATION_OUTCOMES.HUMAN_REVIEW_REQUIRED,
      reason: ESCALATION_REASONS.HUMAN_REVIEW_REQUIRED,
      tier: null,
      reasons: Object.freeze([ESCALATION_REASONS.HUMAN_REVIEW_REQUIRED]),
      provenance: buildProvenance({ entryTier, decidedTier: null, reasons: [ESCALATION_REASONS.HUMAN_REVIEW_REQUIRED], observedAt, availableTiers }),
    });
  }

  const reasons = [];
  if (!schemaValid) reasons.push(ESCALATION_REASONS.SCHEMA_INVALID);

  const quality = assessEvidenceQuality(response);
  const overall = Number(response?.confidence);
  if (Number.isFinite(overall) && overall <= ESCALATION_THRESHOLDS.acceptConfidence) {
    reasons.push(ESCALATION_REASONS.LOW_CONFIDENCE);
  }
  if (quality.missing > 0) reasons.push(ESCALATION_REASONS.MISSING_EVIDENCE);
  if (quality.inferred > 0) reasons.push(ESCALATION_REASONS.INFERRED_NOT_EXTRACTED);
  if (quality.weak >= ESCALATION_THRESHOLDS.weakFactCount) reasons.push(ESCALATION_REASONS.LOW_CONFIDENCE);
  if (Array.isArray(response?.corrections) && response.corrections.length > 0) {
    reasons.push(ESCALATION_REASONS.NORMALIZATION_APPLIED);
  }
  if (crossDocumentConflict) reasons.push(ESCALATION_REASONS.CROSS_DOCUMENT_CONFLICT);

  if (reasons.length === 0) {
    return Object.freeze({
      state: ESCALATION_OUTCOMES.USE_TIER,
      outcome: ESCALATION_OUTCOMES.USE_TIER,
      reason: ESCALATION_REASONS.ACCEPTED_AT_ENTRY,
      tier: entryTier,
      escalated: false,
      reasons: Object.freeze([]),
      evidenceQuality: quality,
      provenance: buildProvenance({ entryTier, decidedTier: entryTier, reasons: [], observedAt, availableTiers }),
    });
  }

  // Cross-document conflict is the one signal that jumps straight to the top of
  // the ladder, because it is the case where several authoritative sources
  // disagree and a single re-read is unlikely to settle it.
  let target = nextTier(entryTier);
  if (crossDocumentConflict) {
    target = "ULTRA";
    if (!isTier(target)) target = entryTier;
  } else if (!target) {
    // Already at the top and still not trusted: stay, and say so. Never invent
    // a stronger tier and never silently accept.
    return Object.freeze({
      state: ESCALATION_OUTCOMES.USE_TIER,
      outcome: ESCALATION_OUTCOMES.USE_TIER,
      reason: ESCALATION_REASONS.EXHAUSTED_LADDER,
      tier: entryTier,
      escalated: false,
      reasons: Object.freeze([...new Set([...reasons, ESCALATION_REASONS.EXHAUSTED_LADDER])]),
      evidenceQuality: quality,
      degraded: true,
      requiresHumanReview: true,
      provenance: buildProvenance({ entryTier, decidedTier: entryTier, reasons: reasons, observedAt, availableTiers }),
    });
  }

  const usable = isTier(target) && availableTiers.includes(target);
  const decidedTier = usable ? target : entryTier;
  if (!usable) reasons.push(ESCALATION_REASONS.HIGHER_TIER_UNAVAILABLE);

  return Object.freeze({
    state: ESCALATION_OUTCOMES.USE_TIER,
    outcome: ESCALATION_OUTCOMES.USE_TIER,
    reason: reasons[0],
    tier: decidedTier,
    escalated: decidedTier !== entryTier,
    requestedTier: target,
    degraded: !usable,
    requiresHumanReview: false,
    reasons: Object.freeze([...new Set(reasons)]),
    evidenceQuality: quality,
    provenance: buildProvenance({ entryTier, decidedTier, reasons, observedAt, availableTiers }),
  });
}

/**
 * A record of WHO decided, on WHAT, and WHY. This is deliberately separate from
 * the model output so a reviewer can audit the escalation without trusting it.
 */
export function buildProvenance({ entryTier, decidedTier, reasons, observedAt, availableTiers = ESCALATION_TIERS }) {
  return Object.freeze({
    policy: "ai-provider-escalation-policy-v1",
    entryTier: String(entryTier ?? ""),
    decidedTier: decidedTier == null ? null : String(decidedTier),
    reasons: Object.freeze([...(reasons ?? [])].map(String)),
    availableTiers: Object.freeze([...availableTiers].map(String)),
    // An instant is supplied by the caller. The policy never calls a clock, so
    // the decision stays a pure function of its inputs.
    observedAt: observedAt == null ? null : String(observedAt),
    aiAuthorityGranted: false,
    humanAuthorityRequired: decidedTier == null,
  });
}

/**
 * A stable fingerprint of the DECISION (not the model text), so repeated runs can
 * be compared and a changed decision is attributable to a changed policy.
 */
export function escalationDecisionFingerprint(decision) {
  const material = JSON.stringify({
    policy: decision?.provenance?.policy ?? null,
    entryTier: decision?.provenance?.entryTier ?? null,
    decidedTier: decision?.provenance?.decidedTier ?? null,
    reasons: decision?.reasons ?? [],
    thresholds: ESCALATION_THRESHOLDS,
  });
  let h = 2166136261;
  for (let i = 0; i < material.length; i += 1) {
    h ^= material.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
