// AI PROJECT EVIDENCE REASONER -- reusable cross-document reasoning layer.
//
// Mandatory architecture (unchanged by this module):
//   FILE-LOCAL ANALYSIS -> NORMALIZED PROJECT EVIDENCE -> CROSS-DOCUMENT
//   CORROBORATION -> AI REASONING PROPOSAL -> HUMAN/GOVERNED DECISION
//
// This module owns ONLY the middle step: it takes an already-normalized,
// project-scoped, provenance-bound evidence packet plus the question, asks a
// TEXT/REASONING model for a STRUCTURED PROPOSAL, and then re-validates that
// proposal deterministically. It never reads a database, never fetches, never
// writes, and never approves anything.
//
// Hard invariants enforced here (deterministically, not by prompt wording):
//   1. AI output stays AI_PROPOSED. No confidence threshold can change state.
//   2. Foreign-project and stale evidence is removed BEFORE any model call.
//   3. A model may only cite evidenceIds that were supplied to it.
//   4. Cross-document (non-visual) evidence can never be the sole basis for a
//      RESOLVED answer to a visual-identity question.
//   5. Non-governed evidence keeps its non-governed ceiling in the output, so
//      BOQ source corroboration / unapproved spec requirements can never be
//      promoted to governed scope or quantity authority.
//   6. Quantity claims are rejected outright, not downgraded.
//   7. Provider failure returns a reviewable fail-closed state, never a guess.
//
// Reusable beyond Drawing Intelligence: question type + evidence packet drive
// behaviour. Callers for BOQ Understanding, requirement applicability, Product
// Identity, technical matching, sizing evidence or drawing interpretation supply
// their own evidence; nothing here is project-, file- or symbol-specific.

import { resolveAuthorityClassForSource } from "./evidence-authority-policy.mjs";
import { CORROBORATION_RELATIONSHIPS } from "./project-evidence-corroboration.mjs";

export const PROJECT_EVIDENCE_REASONER_VERSION = "project-evidence-reasoner-1.0.0";

// The four semantic relationships. NO_RELEVANT_EVIDENCE is deliberately NOT
// one of them: the model must either classify an item or omit it. Omission is
// "not relevant"; it is never a fifth implied "true" state.
export const REASONING_RELATIONSHIPS = Object.freeze(
  CORROBORATION_RELATIONSHIPS.filter((value) => value !== "NO_RELEVANT_EVIDENCE"),
);

export const REASONING_STATUSES = Object.freeze([
  "RESOLVED",
  "PARTIALLY_RESOLVED",
  "AMBIGUOUS",
  "CONTRADICTED",
  "INSUFFICIENT_EVIDENCE",
]);

export const RECOMMENDED_ACTIONS = Object.freeze([
  "APPROVE_IDENTITY",
  "APPROVE_APPLICABILITY",
  "KEEP_NOT_PROVEN",
  "KEEP_AMBIGUOUS",
  "REQUEST_TARGETED_DRAWING_EVIDENCE",
  "REQUEST_SPEC_EVIDENCE",
  "REQUEST_BOQ_EVIDENCE",
  "HUMAN_REVIEW",
]);

// Actions that would move a governed state forward. The deterministic layer
// downgrades these whenever the supporting evidence is not itself governed.
const PROMOTING_ACTIONS = Object.freeze(["APPROVE_IDENTITY", "APPROVE_APPLICABILITY"]);

export const EVIDENCE_REQUEST_KINDS = Object.freeze([
  "BOQ_CONCEPT",
  "SPEC_CONCEPT",
  "LEGEND_EVIDENCE",
  "DRAWING_TEXT",
  "DRAWING_GEOMETRY",
  "CROSS_SHEET_RELATION",
]);

export const DEFAULT_MAX_EVIDENCE_REQUESTS = 2;
export const DEFAULT_MAX_PACKET_ITEMS = 24;
export const MAX_EVIDENCE_TEXT_CHARS = 900;

// Focus dimension at which a non-visual source can support meaning but can never
// alone resolve the question.
export const VISUAL_IDENTITY_FOCUS = "VISUAL_IDENTITY";

const GOVERNED = "GOVERNED";

// ── Quantity guard ──────────────────────────────────────────────────────────
// Quoting a printed label ("the sheet prints 2 Nos") is evidence, not a claim.
// Asserting a physical quantity from cross-document reasoning is forbidden and
// is rejected, never trimmed.
const QUANTITY_CLAIM_PATTERNS = Object.freeze([
  /\b(?:total|quantity|qty)\s*(?:is|of|equals|=|:)?\s*\d/i,
  /\b\d+\s*(?:units?|nos?\.?|pcs?|off|each)\s+(?:are|is|will be|shall be|shall)\s+(?:required|provided|installed|total|needed)\b/i,
  /\b\d+\s*[×x]\s*\d+\s*(?:units?|nos?\.?|pcs?)\b/i,
  /\bquantity\s+(?:claim|assertion|authority)\b/i,
]);

const hasQuantityClaim = (text) =>
  typeof text === "string" && QUANTITY_CLAIM_PATTERNS.some((pattern) => pattern.test(text));

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "in", "on", "at", "is", "are",
  "be", "with", "by", "as", "that", "this", "these", "those", "it", "its", "from",
  "what", "which", "does", "do", "each", "per", "any", "all", "was", "were", "has",
  "have", "had", "there", "their", "they", "them", "if", "not", "but", "so", "than",
]);

export const reasonerTokens = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9./-]+/g, " ")
    .split(/\s+/)
    .map((token) => token.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));

// ── Evidence normalization: project isolation + currentness (pre-model) ─────
//
// Ordering matters: this runs BEFORE the model sees anything, so a foreign
// project or a superseded version can never even be quoted back as context.
export const normalizeReasoningEvidence = ({ projectId, evidence = [] } = {}) => {
  const accepted = [];
  const excluded = [];
  const list = Array.isArray(evidence) ? evidence : [];
  for (const item of list) {
    if (!item || typeof item !== "object") {
      excluded.push({ evidenceKey: null, reason: "MALFORMED_EVIDENCE" });
      continue;
    }
    const key = item.evidenceKey ?? item.id ?? null;
    const text = typeof item.extractedText === "string" ? item.extractedText.trim() : "";
    const scope = item.scope ?? "PROJECT";
    if (scope === "PROJECT" && (!item.projectId || item.projectId !== projectId)) {
      excluded.push({ evidenceKey: key, reason: "FOREIGN_PROJECT_EVIDENCE" });
      continue;
    }
    if (scope !== "PROJECT" && scope !== "GLOBAL_REUSABLE") {
      excluded.push({ evidenceKey: key, reason: "UNKNOWN_EVIDENCE_SCOPE" });
      continue;
    }
    if (scope === "GLOBAL_REUSABLE" && item.projectId && item.projectId !== projectId) {
      excluded.push({ evidenceKey: key, reason: "FOREIGN_PROJECT_EVIDENCE" });
      continue;
    }
    if (item.currentness === "STALE" || item.superseded === true) {
      excluded.push({ evidenceKey: key, reason: "STALE_EVIDENCE" });
      continue;
    }
    if (text === "") {
      excluded.push({ evidenceKey: key, reason: "EMPTY_EVIDENCE_TEXT" });
      continue;
    }
    const governanceState = item.governanceState ?? "UNSPECIFIED";
    accepted.push({
      evidenceId: `E${accepted.length + 1}`,
      evidenceKey: key,
      projectId: scope === "GLOBAL_REUSABLE" ? null : item.projectId,
      scope,
      sourceType: item.sourceType ?? null,
      authorityClass: item.authorityClass ?? resolveAuthorityClassForSource(item.sourceType),
      governanceState,
      // The ceiling travels WITH the evidence into the output. A caller can
      // never silently upgrade a SOURCE_CORROBORATION row by dropping it.
      authorityCeiling: governanceState === GOVERNED ? GOVERNED : "NON_AUTHORITATIVE_SOURCE",
      currentness: item.currentness ?? "CURRENT",
      documentId: item.documentId ?? null,
      documentVersionId: item.documentVersionId ?? null,
      locator: item.locator ?? null,
      extractedText: text.slice(0, MAX_EVIDENCE_TEXT_CHARS),
      isVisualSource: item.isVisualSource === true,
      metadata: item.metadata && typeof item.metadata === "object" ? { ...item.metadata } : {},
    });
  }
  return { accepted, excluded };
};

// ── Deterministic retrieval: focused packet, source diversity ───────────────
//
// No embeddings, no ranking model, no RAG platform: lexical overlap over
// question + candidate terms, then a per-source-type cap so one huge document
// cannot crowd out the others.
//
// Non-matching evidence is EXCLUDED, never used as filler. Shipping a
// revision-block string that shares no term with the question is not neutral:
// the model reads it as project evidence and then reports that the real
// evidence was missing. Filler is only tolerated when nothing matches at all,
// so a question with no lexical overlap still gets a packet instead of a hard
// stop.
export const selectReasoningPacket = ({
  question = "",
  candidates = [],
  evidence = [],
  maxItems = DEFAULT_MAX_PACKET_ITEMS,
  perSourceCap = 6,
} = {}) => {
  const query = new Set([
    ...reasonerTokens(question),
    ...candidates.flatMap((candidate) =>
      reasonerTokens(typeof candidate === "string" ? candidate : candidate?.label ?? ""),
    ),
  ]);
  const scored = evidence.map((item, index) => {
    const text = item.extractedText.toLowerCase();
    let score = 0;
    for (const token of query) if (text.includes(token)) score += 1;
    const sourceType = item.sourceType ?? "UNKNOWN";
    return { item, index, score, sourceType };
  });
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const matching = scored.filter((entry) => entry.score > 0);
  const pool = matching.length ? matching : scored;
  const perSource = new Map();
  const selected = [];
  for (const entry of pool) {
    if (selected.length >= maxItems) break;
    const used = perSource.get(entry.sourceType) ?? 0;
    if (used >= perSourceCap) continue;
    perSource.set(entry.sourceType, used + 1);
    selected.push(entry.item);
  }
  return selected;
};

// ── Prompt ──────────────────────────────────────────────────────────────────
export const buildReasoningPrompt = ({
  questionId,
  question,
  questionType = null,
  focusDimension = null,
  candidates = [],
  evidence = [],
  iteration = 1,
} = {}) => {
  const evidenceBlock = evidence
    .map((item) => [
      `- evidenceId: ${item.evidenceId}`,
      `  sourceType: ${item.sourceType}`,
      `  governanceState: ${item.governanceState}`,
      `  authorityCeiling: ${item.authorityCeiling}`,
      `  currentness: ${item.currentness}`,
      `  locator: ${item.locator ?? "n/a"}`,
      `  text: ${item.extractedText}`,
    ].join("\n"))
    .join("\n");

  const system = [
    "You are a technical evidence reasoner for engineering drawings and project documents.",
    "You compare evidence across documents and propose an interpretation for a human to decide.",
    `Valid status values: ${REASONING_STATUSES.join(", ")}.`,
    `Valid relationship values: ${REASONING_RELATIONSHIPS.join(", ")}.`,
    `Valid recommendedAction values: ${RECOMMENDED_ACTIONS.join(", ")}.`,
    "Hard rules:",
    "1. You may ONLY cite evidenceIds that appear in the EVIDENCE list below. Any other id is invalid output.",
    "2. You cannot create source facts. If the evidence does not contain a symbol, geometry or occurrence, you cannot assert one.",
    "3. Never assert or compute a physical quantity. You may quote a printed label as text, but never state a required, total or supplied quantity.",
    "4. If the evidence does not resolve the question, say so: status AMBIGUOUS, PARTIALLY_RESOLVED or INSUFFICIENT_EVIDENCE.",
    "5. Your modelConfidence is informational only and grants no authority.",
    "Return JSON only.",
    // The output CONTRACT. This module validates a specific field contract
    // (`proposedInterpretation`, `evidenceAssessment`, `reasoningSummary`,
    // `missingEvidence`, `contradictions`, `modelConfidence`), but until now the
    // prompt only listed valid VALUES for status/relationship/recommendedAction
    // and never named the fields. A compliant instruction-following model
    // therefore invented its own names (`interpretation`, `evidenceLinks`), and
    // `validateReasoningResult` rejected the answer with MISSING_* / INVALID_*
    // every single time -- the reasoner could never succeed. Emitting the schema
    // that is ALREADY EXPORTED from this module is the smallest correct fix: it
    // changes no validation, no vocabulary and no authority rule.
    `Output contract (exactly these fields, no others): ${JSON.stringify(REASONING_RESULT_SCHEMA)}`,
  ].join("\n");

  const user = [
    `questionId: ${questionId}`,
    `questionType: ${questionType ?? "GENERAL"}`,
    `focusDimension: ${focusDimension ?? "UNSPECIFIED"}`,
    `iteration: ${iteration}`,
    `question: ${question}`,
    `candidateInterpretations: ${candidates.length ? candidates.map((c) => (typeof c === "string" ? c : c?.label ?? JSON.stringify(c))).join(" | ") : "none"}`,
    "",
    "EVIDENCE:",
    evidenceBlock || "(none supplied)",
    "",
    `If you need specific additional evidence, list it in evidenceRequests using kind from: ${EVIDENCE_REQUEST_KINDS.join(", ")} and a concrete term. Maximum ${DEFAULT_MAX_EVIDENCE_REQUESTS} requests, no open-ended crawling.`,
  ].join("\n");

  return { system, user };
};

export const REASONING_RESULT_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  required: [
    "status",
    "proposedInterpretation",
    "evidenceAssessment",
    "missingEvidence",
    "contradictions",
    "recommendedAction",
    "modelConfidence",
    "reasoningSummary",
    "evidenceRequests",
  ],
  properties: {
    status: { type: "string", enum: [...REASONING_STATUSES] },
    proposedInterpretation: { type: "string" },
    evidenceAssessment: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["evidenceId", "sourceType", "relationship", "explanation"],
        properties: {
          evidenceId: { type: "string" },
          sourceType: { type: "string" },
          relationship: { type: "string", enum: [...REASONING_RELATIONSHIPS] },
          explanation: { type: "string" },
        },
      },
    },
    missingEvidence: { type: "array", items: { type: "string" } },
    contradictions: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string", enum: [...RECOMMENDED_ACTIONS] },
    modelConfidence: { type: "number" },
    reasoningSummary: { type: "string" },
    evidenceRequests: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "term"],
        properties: { kind: { type: "string", enum: [...EVIDENCE_REQUEST_KINDS] }, term: { type: "string" } },
      },
    },
  },
});

// ── Deterministic validation of model output ────────────────────────────────
//
// The prompt asks for these rules; this function is what actually enforces them.
export const validateReasoningResult = ({ result, evidence = [] } = {}) => {
  const errors = [];
  if (!result || typeof result !== "object") return { ok: false, errors: ["MODEL_OUTPUT_MISSING"] };
  const known = new Map(evidence.map((item) => [item.evidenceId, item]));

  if (!REASONING_STATUSES.includes(result.status)) errors.push("INVALID_STATUS");
  if (!RECOMMENDED_ACTIONS.includes(result.recommendedAction)) errors.push("INVALID_RECOMMENDED_ACTION");
  if (typeof result.proposedInterpretation !== "string" || result.proposedInterpretation.trim() === "") {
    errors.push("MISSING_PROPOSED_INTERPRETATION");
  }
  if (typeof result.modelConfidence !== "number" || !Number.isFinite(result.modelConfidence)) {
    errors.push("INVALID_MODEL_CONFIDENCE");
  }

  const assessment = [];
  const cited = new Set();
  const entries = Array.isArray(result.evidenceAssessment) ? result.evidenceAssessment : [];
  if (!Array.isArray(result.evidenceAssessment)) errors.push("MISSING_EVIDENCE_ASSESSMENT");
  for (const entry of entries) {
    const id = entry?.evidenceId;
    if (typeof id !== "string" || !known.has(id)) {
      // Fabricated / unknown citation: reject the whole output. Never silently
      // drop it, which would launder a hallucinated citation into a clean run.
      errors.push(`UNKNOWN_EVIDENCE_ID:${String(id)}`);
      continue;
    }
    if (!REASONING_RELATIONSHIPS.includes(entry.relationship)) {
      errors.push(`INVALID_RELATIONSHIP:${String(entry.relationship)}`);
      continue;
    }
    const item = known.get(id);
    if (entry.sourceType && item.sourceType && entry.sourceType !== item.sourceType) {
      errors.push(`SOURCE_TYPE_MISMATCH:${id}`);
      continue;
    }
    cited.add(id);
    assessment.push({
      evidenceId: id,
      evidenceKey: item.evidenceKey,
      sourceType: item.sourceType,
      relationship: entry.relationship,
      explanation: typeof entry.explanation === "string" ? entry.explanation : "",
      governanceState: item.governanceState,
      authorityCeiling: item.authorityCeiling,
      locator: item.locator,
      documentId: item.documentId,
      documentVersionId: item.documentVersionId,
    });
  }

  if (hasQuantityClaim(result.proposedInterpretation) || hasQuantityClaim(result.reasoningSummary)) {
    errors.push("QUANTITY_CLAIM_FORBIDDEN");
  }

  const requests = [];
  for (const request of Array.isArray(result.evidenceRequests) ? result.evidenceRequests : []) {
    if (!request || !EVIDENCE_REQUEST_KINDS.includes(request.kind)) continue;
    const term = String(request.term ?? "").trim();
    if (term === "") continue;
    requests.push({ kind: request.kind, term });
  }

  return {
    ok: errors.length === 0,
    errors,
    normalized: {
      status: result.status,
      proposedInterpretation: result.proposedInterpretation,
      reasoningSummary: typeof result.reasoningSummary === "string" ? result.reasoningSummary : "",
      evidenceAssessment: assessment,
      missingEvidence: Array.isArray(result.missingEvidence) ? result.missingEvidence.map(String) : [],
      contradictions: Array.isArray(result.contradictions) ? result.contradictions.map(String) : [],
      recommendedAction: result.recommendedAction,
      modelConfidence: result.modelConfidence,
      evidenceRequests: requests,
      citedEvidenceIds: [...cited],
    },
  };
};

// ── Deterministic post-processing: authority firewall ───────────────────────
//
// Model judgement stays; model AUTHORITY does not.
export const applyAuthorityFirewall = ({ normalized, evidence = [], focusDimension = null } = {}) => {
  const known = new Map(evidence.map((item) => [item.evidenceId, item]));
  const assessment = normalized.evidenceAssessment.map((entry) => ({
    ...entry,
    authorityCeiling: known.get(entry.evidenceId)?.authorityCeiling ?? entry.authorityCeiling,
    governanceState: known.get(entry.evidenceId)?.governanceState ?? entry.governanceState,
  }));
  const downgrades = [];

  // Rule 4: for a visual-identity question, cross-document evidence may support
  // meaning but can never alone resolve it. No visual basis => not RESOLVED.
  let status = normalized.status;
  const visualBasis = assessment.some((entry) =>
    ["SUPPORTS", "CLARIFIES"].includes(entry.relationship) && known.get(entry.evidenceId)?.isVisualSource,
  );
  if (focusDimension === VISUAL_IDENTITY_FOCUS && status === "RESOLVED" && !visualBasis) {
    status = assessment.length ? "PARTIALLY_RESOLVED" : "INSUFFICIENT_EVIDENCE";
    downgrades.push("VISUAL_IDENTITY_WITHOUT_VISUAL_BASIS");
  }

  // Rule 5: a promoting action needs governed support. Otherwise it is downgraded
  // to a non-promoting equivalent -- confidence is never the deciding factor.
  let recommendedAction = normalized.recommendedAction;
  const anyGovernedSupport = assessment.some((entry) =>
    ["SUPPORTS", "CLARIFIES"].includes(entry.relationship) && entry.authorityCeiling === GOVERNED,
  );
  if (!anyGovernedSupport && PROMOTING_ACTIONS.includes(recommendedAction)) {
    recommendedAction = status === "RESOLVED" ? "HUMAN_REVIEW" : "KEEP_NOT_PROVEN";
    downgrades.push("PROMOTING_ACTION_WITHOUT_GOVERNED_SUPPORT");
  }

  return {
    status,
    recommendedAction,
    evidenceAssessment: assessment,
    visualBasisPresent: visualBasis,
    governedSupportPresent: anyGovernedSupport,
    firewallNotes: downgrades,
  };
};

// ── Fail-closed result ──────────────────────────────────────────────────────
const failClosed = ({ questionId, question, status, reason, model = null, extra = {} }) => ({
  questionId,
  question: question ?? null,
  status,
  proposedInterpretation: null,
  evidenceAssessment: [],
  missingEvidence: [],
  contradictions: [],
  recommendedAction: "HUMAN_REVIEW",
  modelConfidence: null,
  reasoningSummary: null,
  authorityStatus: "AI_PROPOSED",
  requiresHumanApproval: true,
  failClosedReason: reason,
  model,
  iterations: 0,
  evidenceRequestsFulfilled: 0,
  modelCalls: 0,
  ...extra,
});

// ── Orchestrator ────────────────────────────────────────────────────────────
//
// Bounded loop: initial reasoning -> at most DEFAULT_MAX_EVIDENCE_REQUESTS
// targeted retrievals -> final reasoning. No autonomous crawling, no loop
// without a budget, and any doubt resolves to a reviewable fail-closed state.
export async function reasonAcrossProjectEvidence({
  projectId,
  questionId,
  question,
  questionType = null,
  focusDimension = null,
  localEvidence = [],
  candidates = [],
  evidence = [],
  provider = null,
  retrieveEvidence = null,
  maxEvidenceRequests = DEFAULT_MAX_EVIDENCE_REQUESTS,
  maxPacketItems = DEFAULT_MAX_PACKET_ITEMS,
  modelCalls = 0,
} = {}) {
  if (!provider || typeof provider.interpret !== "function") {
    return failClosed({ questionId, question, status: "INSUFFICIENT_EVIDENCE", reason: "PROVIDER_NOT_CONFIGURED" });
  }
  const model = provider.metadata ? { provider: provider.metadata.provider, model: provider.metadata.model } : null;

  const normalized = normalizeReasoningEvidence({ projectId, evidence: [...(evidence || []), ...(localEvidence || [])] });
  let packet = selectReasoningPacket({ question, candidates, evidence: normalized.accepted, maxItems: maxPacketItems });
  if (packet.length === 0) {
    return failClosed({
      questionId,
      question,
      status: "INSUFFICIENT_EVIDENCE",
      reason: "NO_CURRENT_PROJECT_EVIDENCE",
      model,
      extra: { excludedEvidence: normalized.excluded },
    });
  }

  let iteration = 0;
  let requestsFulfilled = 0;
  let validation = null;
  // Bounded: initial reasoning, one repair attempt per reasoning turn, plus the
  // post-request final reasoning.
  const budget = 2 + Math.max(0, maxEvidenceRequests);

  while (iteration < budget) {
    iteration += 1;
    const prompt = buildReasoningPrompt({
      questionId, question, questionType, focusDimension, candidates, evidence: packet, iteration,
    });
    let raw = null;
    try {
      modelCalls += 1;
      raw = await provider.interpret({ prompt });
    } catch (error) {
      return failClosed({
        questionId,
        question,
        status: "INSUFFICIENT_EVIDENCE",
        reason: "MODEL_PROVIDER_FAILURE",
        model,
        extra: { modelError: String(error?.message ?? error).slice(0, 200), iterations: iteration - 1, evidenceRequestsFulfilled: requestsFulfilled, modelCalls, excludedEvidence: normalized.excluded },
      });
    }

    validation = validateReasoningResult({ result: raw, evidence: packet });
    if (validation.ok) break;

    // One repair attempt for a structurally invalid answer; anything else is
    // rejected fail-closed rather than repaired from prose.
    if (validation.errors.some((error) => error.startsWith("QUANTITY_CLAIM_FORBIDDEN"))) {
      return failClosed({
        questionId,
        question,
        status: "INSUFFICIENT_EVIDENCE",
        reason: "QUANTITY_CLAIM_FORBIDDEN",
        model,
        extra: { errors: validation.errors, iterations: iteration, evidenceRequestsFulfilled: requestsFulfilled, modelCalls, excludedEvidence: normalized.excluded },
      });
    }
    if (iteration >= budget || requestsFulfilled >= maxEvidenceRequests) break;
  }

  if (!validation?.ok) {
    return failClosed({
      questionId,
      question,
      status: "INSUFFICIENT_EVIDENCE",
      reason: "MODEL_OUTPUT_INVALID",
      model,
      extra: { errors: validation?.errors ?? ["MODEL_OUTPUT_MISSING"], iterations: iteration, evidenceRequestsFulfilled: requestsFulfilled, modelCalls, excludedEvidence: normalized.excluded },
    });
  }

  // Targeted second pass: only allowlisted kinds, only up to the budget, only
  // through the caller-supplied deterministic retriever.
  if (validation.normalized.evidenceRequests.length && retrieveEvidence && requestsFulfilled < maxEvidenceRequests) {
    const wanted = validation.normalized.evidenceRequests.slice(0, maxEvidenceRequests - requestsFulfilled);
    let fetched = [];
    try {
      fetched = (await retrieveEvidence({
        projectId,
        questionId,
        requests: wanted,
        alreadySuppliedEvidenceIds: packet.map((item) => item.evidenceKey),
      })) || [];
    } catch {
      fetched = [];
    }
    if (fetched.length) {
      const merged = normalizeReasoningEvidence({ projectId, evidence: [...packet, ...fetched] });
      packet = merged.accepted;
      requestsFulfilled += wanted.length;
      const finalPrompt = buildReasoningPrompt({
        questionId, question, questionType, focusDimension, candidates, evidence: packet, iteration: iteration + 1,
      });
      try {
        modelCalls += 1;
        const finalRaw = await provider.interpret({ prompt: finalPrompt });
        const finalValidation = validateReasoningResult({ result: finalRaw, evidence: packet });
        if (finalValidation.ok) validation = finalValidation;
      } catch {
        // Keep the pre-request proposal; it is already validated. The reasoner
        // never loses a valid answer because the follow-up call failed.
      }
    }
  }

  const firewall = applyAuthorityFirewall({ normalized: validation.normalized, evidence: packet, focusDimension });

  return {
    questionId,
    question,
    status: firewall.status,
    proposedInterpretation: validation.normalized.proposedInterpretation,
    reasoningSummary: validation.normalized.reasoningSummary,
    evidenceAssessment: firewall.evidenceAssessment,
    missingEvidence: validation.normalized.missingEvidence,
    contradictions: validation.normalized.contradictions,
    recommendedAction: firewall.recommendedAction,
    modelConfidence: validation.normalized.modelConfidence,
    // Confidence is informational metadata. It is deliberately not an input to
    // any state transition anywhere in this module.
    confidenceAuthority: "INFORMATIONAL_ONLY",
    authorityStatus: "AI_PROPOSED",
    requiresHumanApproval: true,
    visualBasisPresent: firewall.visualBasisPresent,
    governedSupportPresent: firewall.governedSupportPresent,
    firewallNotes: firewall.firewallNotes,
    model,
    iterations: iteration,
    evidenceRequestsFulfilled: requestsFulfilled,
    modelCalls,
    evidencePacket: packet.map((item) => ({
      evidenceId: item.evidenceId,
      evidenceKey: item.evidenceKey,
      sourceType: item.sourceType,
      governanceState: item.governanceState,
      authorityCeiling: item.authorityCeiling,
      locator: item.locator,
      documentId: item.documentId,
      documentVersionId: item.documentVersionId,
    })),
    excludedEvidence: normalized.excluded,
  };
}

// ── Human review packet ─────────────────────────────────────────────────────
//
// Omair sees the decision, the strongest evidence and the strongest
// contradiction. Raw retrieval stays available but is not the headline.
export const buildReasoningReviewPacket = ({ results = [], optionsByQuestionId = {} } = {}) =>
  results.map((result) => {
    const supporting = result.evidenceAssessment.filter((entry) => entry.relationship === "SUPPORTS");
    const clarifying = result.evidenceAssessment.filter((entry) => entry.relationship === "CLARIFIES");
    const contradicting = result.evidenceAssessment.filter((entry) => entry.relationship === "CONTRADICTS");
    return {
      questionId: result.questionId,
      question: result.question,
      status: result.status,
      aiRecommendation: result.recommendedAction,
      proposedInterpretation: result.proposedInterpretation,
      confidence: result.modelConfidence,
      authorityStatus: result.authorityStatus,
      requiresHumanApproval: result.requiresHumanApproval,
      strongestSupport: supporting[0] ?? clarifying[0] ?? null,
      strongestContradiction: contradicting[0] ?? null,
      contradictions: result.contradictions ?? [],
      nonAuthoritativeContext: result.evidenceAssessment.filter(
        (entry) => entry.relationship === "RELATED_BUT_NON_AUTHORITATIVE",
      ),
      options: optionsByQuestionId[result.questionId] ?? ["APPROVE", "REJECT", "KEEP_UNRESOLVED"],
      rawEvidence: result.evidencePacket ?? [],
    };
  });
