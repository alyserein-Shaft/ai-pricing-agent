// PROJECT-WIDE CROSS-DOCUMENT CORROBORATION FOR VISUAL UNDERSTANDING.
//
// THE ARCHITECTURAL RULE
// ----------------------
// The final unit of understanding is THE PROJECT, not THE FILE. But the ORDER is
// fixed and non-negotiable:
//
//   image -> LLaVA RAW OBSERVATION (source-local, no project context)
//         -> NORMALIZED VISUAL EVIDENCE
//         -> PROJECT-WIDE CORROBORATION  <-- this module
//         -> DETERMINISTIC AUTHORITY / SAFETY GATES
//         -> AI_PROPOSAL or NEEDS_REVIEW
//
// Project context is NEVER placed inside the initial perception call. The first
// perception pass stays source-local so that a perception failure cannot be
// masked by a good guess from another file.
//
// THE HARD INVARIANT: PROJECT CONTEXT CANNOT FABRICATE PERCEPTION
// ---------------------------------------------------------------
// Corroboration may ATTACH to a token the observation actually contains. It may
// NEVER introduce a token the observation did not contain. If the observation saw
// only "a row of five buttons" and did not observe "T", then no amount of legend
// evidence elsewhere in the project may be used to assert that the image showed a
// "T", or that the finding PASSES because the project's answer happens to be "T".
//
// This is enforced structurally by `observedTokensOf()`: every project-evidence
// relationship is admitted only when its anchor token is present in the RAW
// observation. Retrieval similarity alone is never corroboration
// (`PROJECT_CONTEXT_MANUFACTURED_VISUAL_FACTS` is structurally 0, not merely
// observed to be 0).
//
// QUANTITY
// --------
// Cross-document evidence never creates quantity authority. An occurrence count in
// one file plus a printed "2 Nos" in another is NOT a multiplication. A physical
// quantity may only become governed through the Drawing Quantity / BOQ quantity
// authority workflow, which this module does not touch and does not stand in for.
//
// AUTHORITY IS SOURCE-TYPE AWARE
// ------------------------------
// Corroboration is not authority. See AUTHORITY_CLASS below. Multiple weak
// sources agreeing never override one stronger authoritative source.
//
// PURE DOMAIN LOGIC. No DB, no network, no model call. The evidence sources are
// supplied by the caller, already project-scoped.
import { createHash } from "node:crypto";

import { stableStringify } from "./boq-understanding-engine.mjs";

export const PROJECT_CORROBORATION_VERSION = "project-visual-corroboration-1.0.0";

/** §5 -- exactly one classification per retrieved relationship. */
export const RELATIONSHIP = Object.freeze({
  SUPPORTS: "SUPPORTS",
  CONTRADICTS: "CONTRADICTS",
  CLARIFIES: "CLARIFIES",
  RELATED_BUT_NON_AUTHORITATIVE: "RELATED_BUT_NON_AUTHORITATIVE",
  NO_RELEVANT_EVIDENCE: "NO_RELEVANT_EVIDENCE",
});

/**
 * §7 -- authority class per source type. Corroboration never confers authority;
 * it only records what class the corroborating source already holds.
 */
export const AUTHORITY_CLASS = Object.freeze({
  PROJECT_DRAWING_APPROVED: "PROJECT_DRAWING_APPROVED",
  PROJECT_LEGEND_GOVERNED: "PROJECT_LEGEND_GOVERNED",
  PROJECT_BOQ: "PROJECT_BOQ",
  PROJECT_SPECIFICATION: "PROJECT_SPECIFICATION",
  MANUFACTURER_DATASHEET: "MANUFACTURER_DATASHEET",
  SUPPLIER_QUOTE: "SUPPLIER_QUOTE",
  HISTORICAL_PROJECT: "HISTORICAL_PROJECT",
  AI_OUTPUT: "AI_OUTPUT",
});

/**
 * Precedence used ONLY to decide whether a contradiction is deterministically
 * resolvable. It never decides truth on its own; it decides whether a human must.
 * Project intent outranks manufacturer capability outranks commercial evidence;
 * an unreviewed source never outranks a reviewed one at the same tier.
 */
const AUTHORITY_RANK = Object.freeze({
  [AUTHORITY_CLASS.PROJECT_DRAWING_APPROVED]: 60,
  [AUTHORITY_CLASS.PROJECT_SPECIFICATION]: 55,
  [AUTHORITY_CLASS.PROJECT_BOQ]: 50,
  [AUTHORITY_CLASS.PROJECT_LEGEND_GOVERNED]: 40,
  [AUTHORITY_CLASS.MANUFACTURER_DATASHEET]: 30,
  [AUTHORITY_CLASS.SUPPLIER_QUOTE]: 10,
  [AUTHORITY_CLASS.HISTORICAL_PROJECT]: 5,
  [AUTHORITY_CLASS.AI_OUTPUT]: 0,
});

/** §8 -- contradiction outcome states. */
export const CONFLICT_STATE = Object.freeze({
  NONE: "NONE",
  RESOLVED_BY_PRECEDENCE: "RESOLVED_BY_PRECEDENCE",
  NEEDS_REVIEW: "NEEDS_REVIEW",
});

/** §9 -- deterministic gate reasons. */
export const GATE = Object.freeze({
  GOVERNED_LEGEND_MEMBERSHIP: "GOVERNED_LEGEND_MEMBERSHIP",
  EVIDENCE_TRACEABILITY: "EVIDENCE_TRACEABILITY",
  QUANTITY_AUTHORITY: "QUANTITY_AUTHORITY",
  UNKNOWN_TOKEN: "UNKNOWN_TOKEN",
  EVIDENCE_SUFFICIENCY: "EVIDENCE_SUFFICIENCY",
  PROJECT_EVIDENCE_CONFLICT: "PROJECT_EVIDENCE_CONFLICT",
});

// ---------------------------------------------------------------------------
// §3 -- NORMALIZED VISUAL EVIDENCE BOUNDARY
//
// LLaVA raw prose is NOT project truth and is never used directly as a fact.
// The raw observation is preserved verbatim and separately; normalization only
// records WHAT WAS SAID. Interpretation never becomes observation.
// ---------------------------------------------------------------------------

const STOP_WORDS = new Set([
  // Function words carry no discriminating power. Retrieving project evidence by
  // them is similarity, not corroboration, so they are never observation anchors.
  "by", "in", "is", "of", "to", "at", "as", "it", "its", "on", "or", "an", "be", "we", "do",
  "does", "not", "no", "so", "if", "up", "out", "over", "under", "between", "very",
  "can", "will", "may", "one", "two", "three", "four", "five", "six", "seven",
  // Narrative and reporting verbs. These describe HOW the model narrated, not WHAT
  // it saw, so they must never anchor a corroboration relationship.
  "written", "writing", "labeled", "labelled", "indicating", "indicate", "displays",
  "display", "organized", "organised", "composed", "compose", "representation",
  "representing", "allowing", "allow", "series", "element", "property", "molecular",
  "composition", "detailed", "close-up", "closeup", "overall", "within", "across",
  "several", "various", "including", "surrounded", "containing",
  // Spatial and orientation adjectives. They describe where things sit, never what
  // they are, so they cannot distinguish a fire-alarm device from any other drawing.
  "horizontal", "vertical", "diagonal", "orientation", "positioned", "position",
  "left", "right", "above", "below", "under", "over", "top", "bottom", "centre",
  "center", "middle", "edge", "corner", "row", "rows", "line", "lines",
  "the", "and", "for", "with", "that", "this", "from", "into", "image", "shows", "show",
  "there", "are", "its", "has", "have", "been", "being", "located", "located", "appears",
  "appear", "each", "some", "several", "other", "than", "then", "they", "them", "their",
  "which", "while", "would", "could", "should", "about", "number", "first", "second",
  "third", "fourth", "fifth", "left", "right", "center", "centre", "middle", "side",
  "line", "row", "rows", "way", "ways", "make", "makes", "made", "use", "used", "using",
  "likely", "possibly", "perhaps", "might", "close", "closer", "further", "farther",
  "arranged", "arrange", "allows", "allow", "easy", "identification", "identify",
  "presence", "containing", "contains", "represents", "reference", "specific", "property",
  "molecule", "compound", "atom", "atoms", "bond", "bonds", "composition", "detailed",
  "view", "structure", "surrounded", "including", "several", "different", "related",
  "terms", "word", "words", "corner", "bottom", "top", "org", "computer", "machinery",
  "piece", "equipment", "possibly", "purpose", "function", "exact", "determine",
  "difficult", "illegible", "rest", "filled", "towards", "reading", "read",
]);

const normalizeToken = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

/**
 * Tokens ACTUALLY PRESENT in the raw observation.
 *
 * This is the anti-fabrication gate. A project-evidence relationship is admitted
 * only if its anchor appears here, so project context can never introduce a visual
 * fact the model did not report.
 */
export const observedTokensOf = (rawObservation) => {
  const text = String(rawObservation ?? "");
  const out = new Set();
  // Quoted spans first: an explicit "the text reads \"C\"" is a strong observation.
  for (const m of text.matchAll(/"([^"]{1,64})"/g)) {
    const t = normalizeToken(m[1]);
    if (t.length >= 1) t.split(" ").forEach((w) => w.length >= 1 && out.add(w));
  }
  for (const m of text.matchAll(/\b([A-Za-z][A-Za-z0-9\-]{1,20})\b/g)) {
    const t = m[1].toUpperCase();
    if (!STOP_WORDS.has(t.toLowerCase())) out.add(t);
  }
  for (const m of text.matchAll(/\b(\d{1,6})\b/g)) out.add(m[1]);
  return out;
};

/** Confidence words present in the raw observation, recorded as uncertainty. */
const uncertaintyOf = (raw) => {
  const t = String(raw ?? "").toLowerCase();
  const signals = [];
  if (/\bpossibly|likely|perhaps|maybe|might\b/.test(t)) signals.push("HEDGED_LANGUAGE");
  if (/\billegible|unreadable|unclear|cannot|not possible|difficult to\b/.test(t)) signals.push("READABILITY_LIMITED");
  if (/[?]\s*$/.test(String(raw ?? "").trim())) signals.push("INTERROGATIVE");
  if (t.trim().length < 12) signals.push("MINIMAL_OBSERVATION");
  return signals;
};

/**
 * Build the normalized visual-evidence record for ONE image.
 * Raw model observation is preserved verbatim under `rawModelObservation` and is
 * never merged into the observation fields.
 */
export const normalizeVisualObservation = ({
  caseId = null,
  description = "",
  kind = null,
  cropRect = null,
  pageNumber = null,
  sourceDocument = {},
  revision = null,
  imageProvenance = [],
  modelInfo = {},
} = {}) => {
  const raw = String(description ?? "");
  const observedTokens = observedTokensOf(raw);
  const quoted = [...raw.matchAll(/"([^"]{1,64})"/g)].map((m) => m[1]);
  // A short, quoted, uppercase-ish token is treated as observed printed text.
  const observedText = quoted.filter((q) => normalizeToken(q).length >= 1 && normalizeToken(q).length <= 24);
  const tableHints = /\b(row|rows|table|line|lines)\b/i.test(raw);
  const geometryHints = /\b(circle|circles|line|lines|rectangle|box|shape|shapes|dot|dots|button|buttons)\b/i.test(raw);

  return {
    version: PROJECT_CORROBORATION_VERSION,
    caseId,
    kind,
    cropRect: cropRect ?? null,
    pageNumber: pageNumber ?? null,
    // --- provenance (§6) ---
    source: {
      documentId: sourceDocument.id ?? null,
      documentVersionId: sourceDocument.documentVersionId ?? null,
      drawingNumber: sourceDocument.drawingNumber ?? null,
      sheetName: sourceDocument.sheetName ?? null,
      revision: revision ?? null,
      pageNumber: pageNumber ?? null,
      imageProvenance,
      modelInfo,
    },
    // --- normalized OBSERVATION (what was reported, not what it means) ---
    observed_text: observedText,
    observed_symbols: [...observedTokens].filter((t) => /^[A-Z0-9\-]{2,}$/.test(t) && !/^\d+$/.test(t)),
    observed_geometry: geometryHints,
    table_or_row_evidence: tableHints ? { asserted: true, verbatim: raw } : { asserted: false, verbatim: null },
    spatial_relations: /\b(left|right|center|middle|above|below|behind|front|next to|beside|across)\b/i.test(raw),
    uncertainty: uncertaintyOf(raw),
    observedTokens: [...observedTokens].sort(),
    // --- raw preserved separately, never merged upward ---
    rawModelObservation: raw,
    interpretation: null, // deliberately null: interpretation is NOT observation.
  };
};

// ---------------------------------------------------------------------------
// §4/§6 -- PROJECT-WIDE EVIDENCE LOOKUP (caller supplies project-scoped sources)
//
// The lookup itself is a pure function over already-scoped sources. Scoping is
// the CALLER's responsibility and is asserted here, because an unscoped lookup is
// the single largest cross-contamination risk in this design.
// ---------------------------------------------------------------------------

export const assertProjectScoped = (evidenceIndex) => {
  const foreign = (evidenceIndex?.items || []).filter((item) => item.projectId && item.projectId !== evidenceIndex.projectId);
  return {
    scoped: foreign.length === 0,
    requestedProjectId: evidenceIndex?.projectId ?? null,
    foreignItemCount: foreign.length,
    foreignItemIds: foreign.slice(0, 8).map((item) => item.itemId ?? null),
    reason:
      foreign.length === 0
        ? "All supplied project evidence belongs to the requested project."
        : `${foreign.length} supplied evidence item(s) belong to a DIFFERENT project and were rejected before lookup. ` +
          "Historical-project material may only be carried as explicitly classified contextual evidence.",
  };
};

/**
 * Retrieve project evidence that mentions any token the observation ACTUALLY
 * observed. An empty observation token set yields NO retrieval at all, which is
 * what makes context-injection-into-perception structurally impossible.
 */
export const retrieveProjectEvidence = ({ observation, evidenceIndex, maxItems = 40 } = {}) => {
  const tokens = new Set(observation?.observedTokens || []);
  const items = evidenceIndex?.items || [];
  if (!tokens.size) return { retrieved: [], anchorTokens: [], scopeCheck: assertProjectScoped(evidenceIndex) };
  const anchorTokens = [...tokens];
  const retrieved = [];
  for (const item of items) {
    if (item.projectId && item.projectId !== evidenceIndex.projectId) continue; // scope guard
    const hay = normalizeToken([item.label, item.text, item.description, item.normalizedValue].filter(Boolean).join(" "));
    if (!hay) continue;
    // §5 retrieval similarity is NOT corroboration. An anchor must be a token the
    // observation actually reported AND discriminating enough to mean something:
    // explicitly quoted text, a multi-digit number, or a substantial non-narrative
    // word. Function words, reporting verbs and spatial adjectives are excluded so
    // that "IN" / "WRITTEN" / "HORIZONTAL" overlap with a legend entry can never
    // read as clarification.
    const quotedTokens = new Set(
      (observation?.observed_text || []).flatMap((q) => normalizeToken(q).split(" ")).filter(Boolean),
    );
    const exact = anchorTokens.filter((t) => {
      if (!hay.split(" ").includes(t)) return false;
      // An explicitly QUOTED token is a direct observation of printed text and is
      // always strong enough to anchor a relationship.
      if (quotedTokens.has(t)) return true;
      // A multi-digit number is discriminating enough on its own.
      if (/^\d{2,6}$/.test(t)) return true;
      // Otherwise the token must be a substantial, non-narrative word. A single
      // digit or a short word is coincidence, not corroboration.
      return t.length >= 4 && !STOP_WORDS.has(t.toLowerCase());
    });
    if (!exact.length) continue;
    retrieved.push({
      itemId: item.itemId ?? null,
      projectId: item.projectId ?? null,
      sourceType: item.sourceType,
      authorityClass: item.authorityClass,
      reviewState: item.reviewState ?? null,
      currentness: item.currentness ?? null,
      documentId: item.documentId ?? null,
      documentVersionId: item.documentVersionId ?? null,
      locator: item.locator ?? null,
      label: item.label ?? null,
      text: item.text ?? null,
      description: item.description ?? null,
      matchedTokens: exact,
      isSameSourceDocument: Boolean(item.documentId && observation?.source?.documentId && item.documentId === observation.source.documentId),
    });
    if (retrieved.length >= maxItems) break;
  }
  return { retrieved, anchorTokens, scopeCheck: assertProjectScoped(evidenceIndex) };
};

// ---------------------------------------------------------------------------
// §5/§7/§8 -- CLASSIFICATION, AUTHORITY, CONFLICT
// ---------------------------------------------------------------------------

/**
 * Classify ONE retrieved item against ONE observation.
 * Retrieval similarity alone is NOT corroboration: an item only becomes a
 * relationship when it shares an anchor token the observation actually observed.
 */
export const classifyRelationship = ({ observation, item }) => {
  const observed = new Set(observation?.observedTokens || []);
  const shared = (item.matchedTokens || []).filter((t) => observed.has(t));
  const base = {
    itemId: item.itemId,
    relationship: RELATIONSHIP.RELATED_BUT_NON_AUTHORITATIVE,
    anchorTokens: shared,
    authorityClass: item.authorityClass,
    sourceType: item.sourceType,
    reviewState: item.reviewState,
    currentness: item.currentness,
    provenance: {
      documentId: item.documentId,
      documentVersionId: item.documentVersionId,
      locator: item.locator,
      projectId: item.projectId,
    },
    supports: null,
    rationale: null,
  };

  // Anti-fabrication: nothing is admitted without a shared OBSERVED anchor.
  if (!shared.length) {
    return { ...base, relationship: RELATIONSHIP.NO_RELEVANT_EVIDENCE, rationale: "No token of this evidence item was present in the raw observation, so it cannot corroborate anything about the image." };
  }

  const governed = item.authorityClass === AUTHORITY_CLASS.PROJECT_LEGEND_GOVERNED;
  const approved = item.authorityClass === AUTHORITY_CLASS.PROJECT_DRAWING_APPROVED;
  const reviewed = item.reviewState === "Approved";

  if (item.contradicts) {
    return {
      ...base,
      relationship: RELATIONSHIP.CONTRADICTS,
      rationale: `Project evidence asserts "${item.contradicts}" against the observed "${shared.join(", ")}".`,
    };
  }
  if (governed && reviewed) {
    return { ...base, relationship: RELATIONSHIP.SUPPORTS, supports: shared, rationale: "Observed token is a member of an APPROVED governed project vocabulary." };
  }
  if (governed || approved) {
    return {
      ...base,
      relationship: RELATIONSHIP.CLARIFIES,
      supports: shared,
      rationale: `Observed token appears in project ${governed ? "legend" : "drawing"} evidence whose review state is "${item.reviewState ?? "unknown"}"; it clarifies meaning but does not yet carry approval authority.`,
    };
  }
  if (item.authorityClass === AUTHORITY_CLASS.MANUFACTURER_DATASHEET) {
    return { ...base, relationship: RELATIONSHIP.CLARIFIES, supports: shared, rationale: "Manufacturer evidence may establish product capability; it does NOT establish project selection." };
  }
  if (item.authorityClass === AUTHORITY_CLASS.SUPPLIER_QUOTE) {
    return { ...base, relationship: RELATIONSHIP.RELATED_BUT_NON_AUTHORITATIVE, rationale: "Commercial evidence does not establish technical compliance." };
  }
  if (item.authorityClass === AUTHORITY_CLASS.HISTORICAL_PROJECT) {
    return { ...base, relationship: RELATIONSHIP.RELATED_BUT_NON_AUTHORITATIVE, rationale: "Past-project material is precedent/context only and never establishes current-project truth." };
  }
  return { ...base, relationship: RELATIONSHIP.RELATED_BUT_NON_AUTHORITATIVE, rationale: "Retrieved by token overlap but carries no governing authority for this dimension." };
};

export const authorityRank = (authorityClass) => AUTHORITY_RANK[authorityClass] ?? 0;

/** §8 -- contradiction handling. Never silently picks a side. */
export const resolveConflict = ({ relationships }) => {
  const supporting = relationships.filter((r) => r.relationship === RELATIONSHIP.SUPPORTS || r.relationship === RELATIONSHIP.CLARIFIES);
  const contradicting = relationships.filter((r) => r.relationship === RELATIONSHIP.CONTRADICTS);
  if (!contradicting.length) {
    return { state: CONFLICT_STATE.NONE, resolvedBy: null, supporting, contradicting, note: "No contradicting project evidence." };
  }
  const topSupporting = Math.max(0, ...supporting.map((r) => authorityRank(r.authorityClass)));
  const topContradicting = Math.max(...contradicting.map((r) => authorityRank(r.authorityClass)));
  // Deterministic precedence resolves ONLY a strict tier gap. A tie, or an
  // unreviewed top tier, is a human decision.
  if (topContradicting > topSupporting && contradicting.some((r) => ["Approved", "Confirmed"].includes(r.reviewState))) {
    return {
      state: CONFLICT_STATE.RESOLVED_BY_PRECEDENCE,
      resolvedBy: "DETERMINISTIC_AUTHORITY_PRECEDENCE",
      supporting,
      contradicting,
      note: `Contradicting evidence holds a strictly higher authority tier (${topContradicting} > ${topSupporting}) and is reviewed.`,
    };
  }
  return {
    state: CONFLICT_STATE.NEEDS_REVIEW,
    resolvedBy: null,
    supporting,
    contradicting,
    note: "No deterministic precedence rule separates the governing sources, or the strongest contradicting source is itself unreviewed. A human decides; the system does not choose a side.",
  };
};

// ---------------------------------------------------------------------------
// §9/§10 -- DETERMINISTIC GATES
// ---------------------------------------------------------------------------

/**
 * Apply the hardened gates AFTER corroboration. No second model is invoked.
 * Returns a final proposal state of AI_PROPOSAL or NEEDS_REVIEW plus the exact
 * reasons. `withinSourceDocument` excludes the image's own document so that
 * corroboration genuinely means CROSS-document.
 */
export const applyDeterministicGates = ({ observation, relationships, conflict, quantityClaims = [] }) => {
  const reasons = [];
  const notes = [];
  const observed = new Set(observation?.observedTokens || []);
  const withinSourceDocument = relationships.filter((r) => r.provenance?.documentId && observation?.source?.documentId && r.provenance.documentId === observation.source.documentId);
  const crossDocument = relationships.filter((r) => !withinSourceDocument.includes(r));

  const governing = crossDocument.filter((r) => r.relationship === RELATIONSHIP.SUPPORTS);
  const clarifying = crossDocument.filter((r) => r.relationship === RELATIONSHIP.CLARIFIES);
  const unknownTokens = [...observed].filter(
    (t) => !relationships.some((r) => (r.anchorTokens || []).includes(t)),
  );

  // §9 GOVERNED LEGEND MEMBERSHIP -- a token that nothing in the project knows is
  // an unknown token and fails closed rather than being force-fitted.
  if (unknownTokens.length && observed.size) {
    reasons.push({ gate: GATE.UNKNOWN_TOKEN, detail: `${unknownTokens.length} observed token(s) have no governed project vocabulary match: ${unknownTokens.slice(0, 10).join(", ")}.` });
  }

  // §9 EVIDENCE TRACEABILITY -- an interpretation must trace to observed evidence.
  if (!observation?.rawModelObservation) {
    reasons.push({ gate: GATE.EVIDENCE_TRACEABILITY, detail: "No raw model observation was retained; interpretation would be untraceable." });
  }

  // §10 QUANTITY AUTHORITY -- corroboration never creates quantity authority.
  if (quantityClaims.length) {
    reasons.push({
      gate: GATE.QUANTITY_AUTHORITY,
      detail: `${quantityClaims.length} quantity claim(s) were surfaced as evidence only. Cross-document evidence does not multiply, total or persist a physical quantity; governed quantity requires the Drawing Quantity / BOQ authority workflow.`,
    });
    notes.push("QUANTITY_SURFACED_AS_EVIDENCE_ONLY");
  }

  // §8 CONTRADICTION
  if (conflict?.state === CONFLICT_STATE.NEEDS_REVIEW) {
    reasons.push({ gate: GATE.PROJECT_EVIDENCE_CONFLICT, detail: `PROJECT_EVIDENCE_CONFLICT: ${conflict.note}` });
  }

  // §9 EVIDENCE SUFFICIENCY
  const hasGovernedSupport = governing.length > 0;
  const hasClarification = clarifying.length > 0;
  if (!hasGovernedSupport && !hasClarification) {
    reasons.push({
      gate: GATE.EVIDENCE_SUFFICIENCY,
      detail: crossDocument.length
        ? `Retrieved ${crossDocument.length} cross-document item(s) but none supports or clarifies an observed token at governing authority.`
        : "No cross-document project evidence could be attached to any observed token.",
    });
  }
  if ((observation?.uncertainty || []).includes("MINIMAL_OBSERVATION")) {
    reasons.push({ gate: GATE.EVIDENCE_SUFFICIENCY, detail: "The raw observation is too short to support any engineering interpretation." });
  }

  const conflictBlocks = conflict?.state === CONFLICT_STATE.NEEDS_REVIEW;
  const unresolved = reasons.filter((r) => r.gate !== GATE.QUANTITY_AUTHORITY);
  const finalState = unresolved.length === 0 ? "AI_PROPOSAL" : "NEEDS_REVIEW";
  const outcome =
    unresolved.length === 0 ? "PASS" : conflictBlocks || reasons.some((r) => r.gate === GATE.UNKNOWN_TOKEN) ? "SAFE_FAIL" : "SAFE_FAIL";

  return {
    finalState,
    outcome,
    hardReviewReasons: reasons.map((r) => r.gate),
    reasons,
    notes,
    counts: {
      retrieved: relationships.length,
      crossDocument: crossDocument.length,
      withinSourceDocument: withinSourceDocument.length,
      governingSupport: governing.length,
      clarifying: clarifying.length,
      contradicting: relationships.filter((r) => r.relationship === RELATIONSHIP.CONTRADICTS).length,
      unknownTokens: unknownTokens.length,
    },
    unknownTokens,
  };
};

// ---------------------------------------------------------------------------
// §12 -- THE HARD INVARIANT, PROVABLE
// ---------------------------------------------------------------------------

/**
 * Count visual facts that were manufactured by project context rather than
 * observed. Structurally zero: every admitted relationship is anchored to an
 * observed token. This function exists so the invariant is ASSERTED rather than
 * merely claimed.
 */
export const countManufacturedVisualFacts = ({ relationships, observation }) => {
  const observed = new Set(observation?.observedTokens || []);
  const manufactured = relationships.filter((r) =>
    (r.anchorTokens || []).some((t) => !observed.has(t)),
  );
  return {
    PROJECT_CONTEXT_MANUFACTURED_VISUAL_FACTS: manufactured.length,
    offenders: manufactured.map((r) => ({ itemId: r.itemId, inventedTokens: (r.anchorTokens || []).filter((t) => !observed.has(t)) })),
  };
};

/** §4 -- currentness fingerprint so a corroboration result is reproducible. */
export const corroborationFingerprint = ({ observation, relationships, evidenceIndex }) =>
  createHash("sha256")
    .update(
      stableStringify({
        version: PROJECT_CORROBORATION_VERSION,
        projectId: evidenceIndex?.projectId ?? null,
        documentId: observation?.source?.documentId ?? null,
        revision: observation?.source?.revision ?? null,
        observedTokens: observation?.observedTokens ?? [],
        evidence: (relationships || [])
          .map((r) => ({ itemId: r.itemId, relationship: r.relationship, reviewState: r.reviewState, authorityClass: r.authorityClass }))
          .sort((a, b) => String(a.itemId).localeCompare(String(b.itemId))),
      }),
    )
    .digest("hex");

// ---------------------------------------------------------------------------
// ORCHESTRATOR
// ---------------------------------------------------------------------------

/**
 * THE PRODUCTION SHAPE:
 *   raw observation -> normalize -> project-wide corroboration -> gates
 *
 * `runProjectCorroboration` is the single entry point Vision should call AFTER
 * local perception and BEFORE deterministic authority gating.
 */
export const runProjectCorroboration = ({
  description,
  kind = null,
  caseId = null,
  pageNumber = null,
  sourceDocument = {},
  revision = null,
  imageProvenance = [],
  modelInfo = {},
  evidenceIndex = { projectId: null, items: [] },
  quantityClaims = [],
} = {}) => {
  const observation = normalizeVisualObservation({
    caseId,
    description,
    kind,
    pageNumber,
    sourceDocument,
    revision,
    imageProvenance,
    modelInfo,
  });

  const scopeCheck = assertProjectScoped(evidenceIndex);
  if (!scopeCheck.scoped) {
    return {
      version: PROJECT_CORROBORATION_VERSION,
      observation,
      scopeCheck,
      relationships: [],
      conflict: { state: CONFLICT_STATE.NEEDS_REVIEW, note: scopeCheck.reason },
      gates: { finalState: "NEEDS_REVIEW", outcome: "UNSAFE_FAIL", hardReviewReasons: [GATE.PROJECT_EVIDENCE_CONFLICT], reasons: [{ gate: GATE.PROJECT_EVIDENCE_CONFLICT, detail: scopeCheck.reason }], counts: {}, unknownTokens: [] },
      manufactured: { PROJECT_CONTEXT_MANUFACTURED_VISUAL_FACTS: 0, offenders: [] },
      fingerprint: null,
    };
  }

  const { retrieved, anchorTokens } = retrieveProjectEvidence({ observation, evidenceIndex });
  const relationships = retrieved.map((item) => classifyRelationship({ observation, item }));
  const conflict = resolveConflict({ relationships });
  const gates = applyDeterministicGates({ observation, relationships, conflict, quantityClaims });
  const manufactured = countManufacturedVisualFacts({ relationships, observation });

  return {
    version: PROJECT_CORROBORATION_VERSION,
    observation,
    scopeCheck,
    anchorTokens,
    relationships,
    conflict,
    gates,
    manufactured,
    fingerprint: corroborationFingerprint({ observation, relationships, evidenceIndex }),
  };
};
