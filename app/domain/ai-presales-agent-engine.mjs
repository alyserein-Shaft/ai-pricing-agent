// Phase A1 (2026-09-01): AI PRE-SALES AGENT MVP -- WORKERS AI ONLY.
//
// Slice 1 proved a bounded, server-controlled, read-only tool loop against
// ONE tool (get_project_status) and found one real, live-model failure:
// asked about a specific BOQ item while only project-level evidence
// existed, the real model (llama-3.1-8b-instruct-fast) projected
// project-level facts onto that item instead of admitting the gap.
//
// Slice 2 adds exactly one more tool (get_boq_item_context) and, more
// importantly, an EXPLICIT, server-side ENTITY-SCOPE GROUNDING model: a
// tool result now declares which entity scope it proves (PROJECT or
// BOQ_ITEM, keyed by real ids), a question is classified by whether it
// names a specific item, and an ANSWER is rejected -- never trusted -- if
// the question is item-specific but no item-scoped tool result for that
// exact item exists this turn. This is enforced structurally (Section 5),
// not by prompt wording alone (Slice 1 already tried a prompt-only fix and
// it did not reliably hold on the real model).
//
// This file remains pure domain logic -- no DB, no fetch, no env. Tool
// RESULTS are always supplied by the caller (worker layer), which is the
// only place a database is ever touched.
import { stableStringify } from "./boq-understanding-engine.mjs";

export const AGENT_ENGINE_VERSION = "ai-presales-agent-engine-v3.1";
export const AGENT_PROMPT_VERSION = "ai-presales-agent-prompt-v3.1";
export const AGENT_SCHEMA_VERSION = "ai-presales-agent-schema-v6";

// Slice 3.1 (fact/explanation separation): Slice 3's live test matrix
// showed the model reliably retrieved correct structured facts but was NOT
// reliably trustworthy as their SOURCE OF TRUTH -- it sometimes called a
// non-stale profile stale, leaked raw field names ("missingRequirements",
// "stale") into blockers, and (once) confused the BOQ item's own
// reviewStatus with the requirement profile's separate reviewStatus
// because the old content prompt showed both under the identical key name.
// This slice splits the ANSWER path into two strictly separate stages:
// AUTHORITATIVE ANSWER FACTS (buildAuthoritativeAnswerFacts, below) --
// responseStatus, subjectStatus, facts, blockers, capabilityGaps, and
// recommendedAction.actionType are now decided HERE, deterministically,
// from real tool results, before the model is ever asked anything; and
// EXPLANATION (ANSWER_EXPLANATION_SCHEMA / buildExplanationPrompt) -- the
// model is now asked only for narrow prose (summary, findingsText,
// explanation, recommendedNextActionText), and every piece of that prose
// is independently checked against the SAME contradiction/vocabulary
// backstops Slice 2.2/3 already proved, then either kept or silently
// dropped in favor of a server-authored fallback -- never retried for a
// content-quality reason, only for a genuine JSON-shape violation. This is
// what makes factual correctness now structurally independent of the
// model's answer quality.

// Section 10: unchanged from Slice 1 -- small, bounded, never loosened.
export const MAX_STEPS = 4;

// Slice 2.2, Section 6: the pre-2.2 FINAL_RESPONSE_SCHEMA had ONE `status`
// enum mixing two different concepts -- "how complete/trustworthy is this
// response" (an answer-quality label) and "what is the project's/item's own
// real-world state" (a subject-domain label) -- both drawn from the SAME
// five values (READY/NEEDS_REVIEW/BLOCKED/PARTIAL/STALE). Real live-model
// audit: the model used READY/BLOCKED as an ITEM readiness diagnosis
// (Slice 2.1 Section 5's finding) even though get_boq_item_context never
// proves item readiness -- the single overloaded field made that
// confusion structurally possible. Decision: split into two fields.
// responseStatus is the answer-quality label (was the real intent of
// PARTIAL/FAILED_SAFE); subjectStatus is the domain-state label (was the
// real intent of READY/NEEDS_REVIEW/BLOCKED/STALE) and is nullable --
// populated ONLY when a tool this turn actually proves an authoritative
// domain status. This contract changes now, while the surface is still
// dev-only (per the brief's explicit instruction).
export const RESPONSE_STATUSES = Object.freeze(["GROUNDED", "PARTIAL", "FAILED_SAFE"]);
export const SUBJECT_STATUSES = Object.freeze(["READY", "NEEDS_REVIEW", "BLOCKED", "STALE"]);

// Section 4: the entity-scope model. A tool result proves ONE of these
// scopes, keyed by real ids -- never a bare claim of "grounded."
export const EVIDENCE_SCOPES = Object.freeze(["PROJECT", "BOQ_ITEM"]);

// ============================================================
// Section 2 (Slice 1): get_project_status. Unchanged -- reuses
// derivePresalesWorkflow's ALREADY-COMPUTED output, never recomputes
// readiness itself.
// ============================================================
export function shapeProjectStatus(projectId, workflow) {
  if (!projectId || !workflow || !Array.isArray(workflow.stages)) {
    throw new Error("shapeProjectStatus requires a real projectId and a real derivePresalesWorkflow() result.");
  }
  const stageStatus = (id) => workflow.stages.find((stage) => stage.id === id)?.status || "Unknown";
  return {
    projectId,
    currentPhase: workflow.workflowStage,
    nextAction: workflow.nextAction
      ? {
          title: workflow.nextAction.title,
          route: workflow.nextAction.route,
          owner: workflow.nextAction.owner,
          stageId: workflow.nextAction.stageId,
        }
      : null,
    documentStatus: stageStatus("intake"),
    requirementStatus: stageStatus("requirements"),
    productSelectionStatus: stageStatus("selection"),
    pricingStatus: stageStatus("supplier"),
    quotationStatus: stageStatus("quotation"),
    blockers: workflow.blockers.map((blocker) => ({
      stageId: blocker.stageId,
      stage: blocker.stage,
      message: blocker.message,
    })),
  };
}

// ============================================================
// Section 3: item-reference resolution. Users identify a BOQ item by its
// displayed item number ("28.19" -- the SAME item.item_number || `Row
// ${item.sequence}` convention already used everywhere in app/page.tsx,
// e.g. line ~13619), a "Row N" fallback reference (used when item_number
// is null), or occasionally the internal id (id("boqitem") -> "boqitem_
// <uuid>", see worker/boq-extraction-api.mjs). This is a PURE classifier
// only -- it never queries a database; resolveItemReference (below) does
// the actual matching against a real, already-loaded set of the project's
// CURRENT items (fetched by the worker via currentBoqEvidenceFrom /
// currentBoqItemPredicate -- the one existing authority boundary for "what
// counts as a current BOQ item," never redefined here).
// ============================================================
export function classifyItemReference(reference) {
  const value = String(reference ?? "").trim();
  if (!value) return null;
  if (/^boqitem_[a-z0-9-]+$/i.test(value)) return { kind: "ID", value };
  const rowMatch = value.match(/^row\s+(\d+)$/i);
  if (rowMatch) return { kind: "ROW", value: Number(rowMatch[1]) };
  return { kind: "ITEM_NUMBER", value };
}

// Matches against an already-loaded array of current-project BOQ item rows
// (each with at least {id, item_number, sequence}). Never falls through
// tiers silently -- classifyItemReference already picked exactly one
// interpretation of the reference shape.
export function resolveItemReference(reference, items) {
  const classified = classifyItemReference(reference);
  if (!classified) return { classified: null, matches: [] };
  const pool = Array.isArray(items) ? items : [];
  let matches;
  if (classified.kind === "ID") matches = pool.filter((item) => item.id === classified.value);
  else if (classified.kind === "ROW") matches = pool.filter((item) => Number(item.sequence) === classified.value);
  else matches = pool.filter((item) => String(item.item_number ?? "").trim() === classified.value);
  return { classified, matches };
}

// Section 5: does the user's QUESTION itself name a specific item? This is
// the server-side classifier that decides whether item-scoped grounding is
// REQUIRED before ANSWER -- deliberately conservative regex matching on the
// SAME reference shapes the resolver itself accepts, so "what the question
// asked about" and "what the resolver can look up" never diverge.
const ITEM_REFERENCE_IN_QUESTION_PATTERNS = [
  /\bitem\s+([A-Za-z0-9][A-Za-z0-9._-]{0,31})\b/i,
  /\brow\s+(\d{1,6})\b/i,
  /\b(\d{1,4}(?:\.\d{1,4}){1,3})\b/,
];
export function detectItemReferenceInQuestion(question) {
  const text = String(question ?? "");
  for (const pattern of ITEM_REFERENCE_IN_QUESTION_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  return null;
}

// ============================================================
// Section 2: get_boq_item_context's compact contract. Reuses whatever the
// worker's own authoritative ownedItem-style query and currentSelectedQuantity
// (worker/quantity-source-decision-api.mjs) already returned -- this
// function only reshapes, exactly like shapeProjectStatus. Never computes
// technical readiness; never invents system/family when genuinely absent
// (returns null, honestly).
// ============================================================
export function shapeBoqItemContext(item, { selectedQuantity = null, approvedSystem = null, approvedFamily = null } = {}) {
  if (!item || !item.id) {
    throw new Error("shapeBoqItemContext requires a real BOQ item row.");
  }
  const boqQuantityRaw = item.numeric_quantity != null ? Number(item.numeric_quantity) : Number(item.original_quantity);
  return {
    itemId: item.id,
    itemReference: item.item_number || `Row ${item.sequence}`,
    description: item.description ?? null,
    boqQuantity: Number.isFinite(boqQuantityRaw) ? boqQuantityRaw : null,
    selectedQuantity: selectedQuantity?.value ?? null,
    selectedQuantitySource: selectedQuantity?.source ?? null,
    // The approved AI-Understanding-Review fact (the SAME authority
    // technical-requirement-api.mjs already treats as canonical for system/
    // family everywhere else in this app) governs when present; the raw
    // extracted value is the honest fallback; genuinely absent stays null
    // rather than being guessed.
    system: approvedSystem || item.system_value || null,
    family: approvedFamily || item.subcategory || item.category || null,
    reviewStatus: item.review_status ?? null,
  };
}

// ============================================================
// Slice 3, Section 2/3: get_requirement_profile's compact contract. Reads
// ONLY fields buildTechnicalRequirementProfile (app/domain/technical-
// requirement-engine.mjs) already computed and worker/technical-requirement-
// api.mjs's own currentProfile()/GET routes already return wholesale --
// never a second readiness algorithm. readinessStatus/blockers come
// straight from the engine's own calculateReadiness() output
// (readiness.status / readiness.blockingReasons); missingRequirements/
// conflicts come straight from missingInformation/conflicts. requirements[]
// status is DERIVED only by set-membership against those same two
// authoritative arrays (Missing/Conflict/Confirmed) -- never a new
// judgment.
// ============================================================
export function shapeRequirementProfile(profileRow, { parsedProfile, stale = false } = {}) {
  if (!profileRow || !profileRow.id) {
    throw new Error("shapeRequirementProfile requires a real requirement_profile_versions row.");
  }
  const profile = parsedProfile || {};
  const missingFields = new Set((profile.missingInformation || []).map((entry) => entry.field));
  const conflictAttributes = new Set((profile.conflicts || []).map((entry) => entry.attribute));
  const requirements = (profile.consolidatedRequirements || []).map((requirement) => {
    const attributes = requirement.attributes || [];
    const value = attributes.length === 1
      ? (attributes[0].normalizedValue ?? null)
      : (attributes.length ? attributes.map((attribute) => `${attribute.name}=${attribute.normalizedValue}`).join("; ") : null);
    const namesInvolved = [requirement.key, ...attributes.map((attribute) => attribute.name)].filter(Boolean);
    const status = namesInvolved.some((name) => conflictAttributes.has(name))
      ? "Conflict"
      : namesInvolved.some((name) => missingFields.has(name))
        ? "Missing"
        : "Confirmed";
    return {
      name: requirement.normalizedRequirement || requirement.key || null,
      value,
      status,
      sourceTypes: [...new Set((requirement.sources || []).map((source) => source.sourceType).filter(Boolean))],
    };
  });
  const missingRequirements = (profile.missingInformation || []).map((entry) => entry.field).filter(Boolean);
  const conflicts = (profile.conflicts || []).map((entry) => ({
    attribute: entry.attribute ?? null,
    type: entry.type ?? null,
    values: (entry.values || []).map((value) => ({ value: value.value ?? null, unit: value.unit ?? null, sourceType: value.source?.sourceType ?? null })),
    technicalImpact: entry.technicalImpact ?? null,
    blocking: Boolean(entry.blocking),
  }));
  return {
    profileVersionId: profileRow.id,
    stale,
    system: profile.boqItem?.system ?? null,
    family: profile.boqItem?.productFamily ?? null,
    readinessStatus: profileRow.readiness_status ?? null,
    requirements,
    missingRequirements,
    conflicts,
    reviewStatus: profileRow.status ?? null,
    // The engine's own calculateReadiness() blockingReasons -- returned
    // directly, never re-derived (Section 3 of the brief: "if the existing
    // profile has a readiness/eligibility result, return it").
    blockers: (profile.readiness?.blockingReasons || []).slice(),
  };
}

// ============================================================
// Slice 4, Section 2/3: get_product_matching_status's compact contract.
// Reads ONLY fields worker/product-matching-api.mjs's own persisted
// product_match_runs/product_match_candidates rows already contain (plus
// its own exported matchRunStaleness()) -- never a new matching algorithm,
// never a re-rank. Candidate ordering is exactly the authoritative rank
// column, ascending, already applied by the caller's ORDER BY -- this
// function only reshapes and truncates to the top N (Section 4).
//
// technicalStatus values (product-matching-engine.mjs's evaluateCandidate):
// "Technically Compliant" | "Compliant with Warnings" | "Discovery Only" |
// "Non-Compliant". counts.technicallyEligible covers the first two (both
// are real, mandatory-clean, non-discovery candidates); counts.needsReview
// is a SEPARATE, cross-cutting axis (review_status, not technicalStatus) --
// a technically eligible candidate can still need review, since every
// candidate starts at review_status "Needs Review" until an engineer acts.
//
// mandatoryFailures entries split into failedCriteria (a genuine technical
// mismatch) vs. missingEvidence (the engine's own "Evidence Missing"/
// "Missing Product Data" results) -- this reuses the EXACT distinction
// evaluateCandidate's own confidenceCeiling logic already makes, never a
// new judgment invented here.
//
// selectedCandidate reuses the SAME confirmed-review-status set
// app/domain/estimator-row-readiness.mjs's confirmedCandidate() already
// treats as "an engineer actually confirmed this" -- no current mutation
// endpoint in this codebase sets a candidate to any of these statuses yet,
// so in practice this is null until that capability exists; a rank-#1
// candidate is NEVER treated as selected just because it ranks highest
// (Section 11-E of the brief).
// ============================================================
const CANDIDATE_RETURN_LIMIT = 5;
const EVIDENCE_MISSING_RESULTS = new Set(["Evidence Missing", "Missing Product Data"]);
const ELIGIBLE_TECHNICAL_STATUSES = new Set(["Technically Compliant", "Compliant with Warnings"]);
const SELECTED_CANDIDATE_REVIEW_STATUSES = new Set(["Approved", "Accepted", "Selected", "Confirmed"]);
const parseJsonArray = (value) => {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export function shapeProductMatchingStatus(runRow, candidateRows, { stale = false } = {}) {
  if (!runRow || !runRow.id) {
    throw new Error("shapeProductMatchingStatus requires a real product_match_runs row.");
  }
  const rows = candidateRows || [];
  const shapedCandidates = rows.map((row) => {
    const failures = parseJsonArray(row.mandatory_failures);
    const failedCriteria = [];
    const missingEvidence = [];
    for (const failure of failures) {
      const label = failure?.result || failure?.type || "Mandatory requirement failed";
      if (EVIDENCE_MISSING_RESULTS.has(failure?.result)) missingEvidence.push(label);
      else failedCriteria.push(label);
    }
    return {
      candidateId: row.id,
      productId: row.product_id ?? null,
      partNumber: row.part_number ?? null,
      manufacturer: row.manufacturer ?? null,
      family: row.family ?? null,
      deterministicStatus: row.technical_status ?? null,
      reviewStatus: row.review_status ?? null,
      matchedCriteria: parseJsonArray(row.matching_basis),
      failedCriteria,
      missingEvidence,
    };
  });
  const counts = {
    technicallyEligible: shapedCandidates.filter((c) => ELIGIBLE_TECHNICAL_STATUSES.has(c.deterministicStatus)).length,
    discoveryOnly: shapedCandidates.filter((c) => c.deterministicStatus === "Discovery Only").length,
    nonCompliant: shapedCandidates.filter((c) => c.deterministicStatus === "Non-Compliant").length,
    needsReview: shapedCandidates.filter((c) => c.reviewStatus === "Needs Review").length,
  };
  const selectedRow = shapedCandidates.find((c) => SELECTED_CANDIDATE_REVIEW_STATUSES.has(c.reviewStatus));
  const selectedCandidate = selectedRow
    ? { candidateId: selectedRow.candidateId, productId: selectedRow.productId, partNumber: selectedRow.partNumber, reviewStatus: selectedRow.reviewStatus }
    : null;
  let noMatch = null;
  try {
    noMatch = typeof runRow.no_match === "string" ? JSON.parse(runRow.no_match) : (runRow.no_match || null);
  } catch {
    noMatch = null;
  }
  return {
    matchRunId: runRow.id,
    requirementProfileVersionId: runRow.requirement_profile_version_id ?? null,
    stale,
    status: runRow.status ?? null,
    candidateCount: Number.isFinite(Number(runRow.candidate_count)) ? Number(runRow.candidate_count) : shapedCandidates.length,
    counts,
    selectedCandidate,
    candidates: shapedCandidates.slice(0, CANDIDATE_RETURN_LIMIT),
    blockers: noMatch?.reason ? [noMatch.reason] : [],
  };
}

// Slice 2.1: descriptive only (shown to the model in the prompt's tool
// catalogue) -- the ACTUAL response_format schema (AGENT_DECISION_SCHEMA
// below) uses one shared, always-required arguments shape for every
// decision. Slice 2 live-model evidence showed a per-tool oneOf/generic-
// object shape leaves `arguments` optional, and llama-3.1-8b-instruct-fast
// omitted it 13/13 live attempts. A discriminated oneOf schema WAS accepted
// by Workers AI but proved structurally unreliable: probed live, it locked
// onto the get_boq_item_context branch regardless of prompt content (even
// under an explicit "call get_project_status" instruction, 3/3 wrong-tool).
// The schema below -- arguments.itemReference always present, typed
// string|null -- was the simplest shape Workers AI both accepted AND that
// reliably discriminated tool choice from prompt content (12/12 correct
// across item- and project-scoped probes). See AGENT_DECISION_SCHEMA.
//
// Slice 3, second finding: adding a SECOND nullable argument field
// (itemId, alongside itemReference) for get_requirement_profile reliably
// broke this -- live evidence: the model put the item's reference into the
// wrong field (itemId) for get_boq_item_context 6/6, and renaming the
// second field to something more distinct (resolvedInternalItemId) traded
// that bug for a worse one (wrong TOOL chosen 3/5). The reliable fix
// (verified: 6/6 correct field+tool for get_boq_item_context, 4/4 correct
// null for get_project_status) was to go back to exactly ONE shared
// argument field for every tool, reusing Slice 2.1's already-proven shape
// -- its MEANING differs per tool (a user-typed reference for
// get_boq_item_context, the already-resolved internal id for
// get_requirement_profile), disambiguated server-side by argumentKind
// (validateAgentStep), never by asking the model to pick between two
// similarly-shaped fields.
const PROJECT_STATUS_ARGUMENTS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: { itemReference: { type: "null" } },
  required: ["itemReference"],
});
const BOQ_ITEM_CONTEXT_ARGUMENTS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    itemReference: {
      type: "string",
      description: "The item reference exactly as named in the user's question (e.g. '28.19', 'Row 12', or an item id).",
    },
  },
  required: ["itemReference"],
});
// Slice 3: get_requirement_profile takes the ALREADY-RESOLVED internal
// item id a prior get_boq_item_context result this turn returned -- never a
// user-typed reference (it never re-resolves; that would be a second
// interpretation path). Reuses the SAME wire field (itemReference) as
// every other tool -- see the comment above PROJECT_STATUS_ARGUMENTS_SCHEMA
// for why a second field broke live reliability; validateAgentStep relabels
// this value internally based on the tool's argumentKind. Server-side,
// runAgentTurn additionally verifies this id matches diagnostics.
// resolvedEntity from THIS turn before ever executing the tool -- the same
// "no cross-item/fabricated evidence" discipline Section 9 (Slice 2)
// already established for item references.
const REQUIREMENT_PROFILE_ARGUMENTS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    itemReference: {
      type: "string",
      description: "The internal item id from a get_boq_item_context result already returned this turn -- never a user-typed reference.",
    },
  },
  required: ["itemReference"],
});
// Slice 4: get_product_matching_status takes the SAME already-resolved
// internal item id as get_requirement_profile -- reuses the identical
// argumentKind ("ITEM_ID") and server-side injection discipline (Section 2
// of the brief: no new argument-passing pattern needed).
const PRODUCT_MATCHING_STATUS_ARGUMENTS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    itemReference: {
      type: "string",
      description: "The internal item id from a get_boq_item_context result already returned this turn -- never a user-typed reference.",
    },
  },
  required: ["itemReference"],
});

// Section 6/7 (Slice 2): closed, server-side registry -- still no dynamic
// function lookup by name from model output. Each entry declares its
// evidence scopeType (used for entity-scope grounding) and, since Slice 3
// adds a second BOQ_ITEM-scoped tool with a DIFFERENT argument shape, an
// argumentKind discriminator ("NONE" | "ITEM_REFERENCE" | "ITEM_ID") used
// by validateAgentStep to enforce the right field per tool.
export const TOOL_REGISTRY = Object.freeze({
  get_project_status: Object.freeze({
    description:
      "Returns the current governed PROJECT-level status: phase, next action, per-stage status (documents, requirements, product selection, pricing, quotation) and open project-level blockers. Takes no item -- set arguments.itemReference and arguments.itemId to null. Does NOT know anything about any individual BOQ item.",
    argumentsSchema: PROJECT_STATUS_ARGUMENTS_SCHEMA,
    scopeType: "PROJECT",
    argumentKind: "NONE",
  }),
  get_boq_item_context: Object.freeze({
    description:
      "Resolves a user-named BOQ item reference (its displayed item number, a 'Row N' reference, or its internal id) to the current item it identifies in the active project, and returns ONLY that item's identity, description, quantities and review status. Requires arguments.itemReference set to that exact reference; arguments.itemId must be null. Returns found:false with a reason if no such current item exists or the reference matches more than one. Does NOT know requirement profile status (see get_requirement_profile), product matching/candidate status (see get_product_matching_status), safety status, price status, specification requirements, or drawing evidence for the item -- never state those as fact from this tool alone.",
    argumentsSchema: BOQ_ITEM_CONTEXT_ARGUMENTS_SCHEMA,
    scopeType: "BOQ_ITEM",
    argumentKind: "ITEM_REFERENCE",
  }),
  get_requirement_profile: Object.freeze({
    description:
      "Returns the current, already-generated technical requirement profile for one BOQ item: its requirements with source types, missing mandatory requirements, unresolved conflicts, whether the profile is stale (drawing evidence changed since generation), and the profile's own readiness status and blocking reasons. Requires arguments.itemId set to the real internal itemId a get_boq_item_context result already returned this turn; arguments.itemReference must be null. Returns found:false if no requirement profile has ever been generated for this item. Proves REQUIREMENT-level readiness only -- does NOT know product matching/candidate status (see get_product_matching_status), safety status, price status, or final product-selection/rejection decisions.",
    argumentsSchema: REQUIREMENT_PROFILE_ARGUMENTS_SCHEMA,
    scopeType: "BOQ_ITEM",
    argumentKind: "ITEM_ID",
  }),
  // Slice 4: reads the current, ALREADY-PERSISTED product match run and its
  // candidates only -- never re-runs matching, never re-ranks, never calls
  // AI Product Ranking (Section 2 of the brief). Requires the same
  // already-resolved internal itemId as get_requirement_profile.
  get_product_matching_status: Object.freeze({
    description:
      "Returns the current, already-persisted product matching result for one BOQ item: whether matching has been run, whether that run is stale (requirements changed since it ran), aggregate candidate counts (technically eligible / discovery only / non-compliant / needs review), the top few ranked candidates with their real matched criteria, failed criteria and missing evidence, and whether an engineer has actually selected one (never inferred from rank). Requires arguments.itemId set to the real internal itemId a get_boq_item_context result already returned this turn; arguments.itemReference must be null. Returns found:false if no match run exists yet for this item. Proves MATCHING-level status only -- does NOT know safety approval, final technical approval for quotation, price eligibility, or commercial readiness; a 'technically eligible' candidate is never the same as an approved, selected, or price-eligible product.",
    argumentsSchema: PRODUCT_MATCHING_STATUS_ARGUMENTS_SCHEMA,
    scopeType: "BOQ_ITEM",
    argumentKind: "ITEM_ID",
  }),
});

const TOOL_NAMES = Object.freeze(Object.keys(TOOL_REGISTRY));

// ============================================================
// Slice 2.2, Section 1: the claim-capability model. Real live evidence
// (Slice 2.1) showed a closed VOCABULARY blacklist alone lets through
// answers that never use forbidden words but still contradict or overreach
// tool evidence in other ways (e.g. "not ready due to missing review" when
// the tool's own reviewStatus is "Approved"). This is the PRIMARY, machine-
// readable authority model instead: each tool declares the exact claim
// categories a FOUND result can support; a question is classified into a
// small, deterministic intent; an intent declares which claim categories it
// REQUIRES; an answer is only trusted GROUNDED when every required category
// was actually available this turn. containsOutOfScopeClaim (Section 6
// below) remains only as a narrow vocabulary backstop, never the primary
// check (Section 12 of the brief).
// ============================================================
export const CLAIM_CAPABILITIES = Object.freeze({
  get_project_status: Object.freeze([
    "PROJECT_PHASE",
    "PROJECT_NEXT_ACTION",
    "PROJECT_BLOCKER",
    "PROJECT_DOCUMENT_STATUS",
    "PROJECT_REQUIREMENT_STATUS",
    "PROJECT_PRODUCT_SELECTION_STATUS",
    "PROJECT_PRICING_STATUS",
    "PROJECT_QUOTATION_STATUS",
  ]),
  get_boq_item_context: Object.freeze([
    "ITEM_IDENTITY",
    "ITEM_DESCRIPTION",
    "ITEM_BOQ_QUANTITY",
    "ITEM_SELECTED_QUANTITY",
    "ITEM_SELECTED_QUANTITY_SOURCE",
    "ITEM_SYSTEM",
    "ITEM_FAMILY",
    "ITEM_REVIEW_STATUS",
  ]),
  // Slice 3: may prove ITEM_READINESS_REASON only to the extent the
  // requirement profile actually proves it -- see the comment above
  // ITEM_READINESS_REASON's INTENT_REQUIRED_CAPABILITIES entry below for
  // how that partial/conditional claim is modeled without a blanket
  // "readiness is now solved" capability grant.
  get_requirement_profile: Object.freeze([
    "ITEM_REQUIREMENT_PROFILE",
    "ITEM_REQUIRED_ATTRIBUTES",
    "ITEM_REQUIREMENT_CONFLICT",
    "ITEM_REQUIREMENT_MISSING",
    "ITEM_REQUIREMENT_STALE",
    "ITEM_REQUIREMENT_REVIEW_STATUS",
  ]),
  // Slice 4: may prove ITEM_MATCHING_STATUS (and its sub-facts) only to the
  // extent the persisted match run actually proves it -- this is the SAME
  // partial/conditional-claim modeling Slice 3 established for
  // get_requirement_profile/ITEM_READINESS_REASON. Notably absent:
  // ITEM_TECHNICAL_ELIGIBILITY (an item-level "this item is eligible"
  // verdict) -- only per-CANDIDATE status (ITEM_CANDIDATE_STATUS) is ever
  // proven, never a holistic item verdict (Section 6 of the brief: keep
  // "technically eligible candidate" and "item is eligible" distinct).
  get_product_matching_status: Object.freeze([
    "ITEM_MATCHING_STATUS",
    "ITEM_MATCH_RUN",
    "ITEM_MATCH_STALE",
    "ITEM_CANDIDATE_COUNT",
    "ITEM_CANDIDATE_STATUS",
    "ITEM_MATCH_FAILURE_REASON",
    "ITEM_MATCH_MISSING_EVIDENCE",
    "ITEM_SELECTED_CANDIDATE_STATE",
  ]),
});

// Documentation/prompt use only -- capabilities NO current tool supports.
// Never added to any tool's CLAIM_CAPABILITIES; a required capability drawn
// from this list can therefore never be satisfied until a real tool for it
// exists, which is exactly the point (Section 4 of the brief). Slice 4:
// ITEM_MATCHING_STATUS moved OUT of this list (get_product_matching_status
// now genuinely supports it) -- ITEM_TECHNICAL_ELIGIBILITY (the item-level
// holistic verdict, as opposed to a per-candidate status) stays unsupported,
// alongside safety/price/final-approval/commercial-readiness, which no tool
// in this slice touches.
export const UNSUPPORTED_ITEM_CAPABILITIES = Object.freeze([
  "ITEM_TECHNICAL_ELIGIBILITY",
  "ITEM_SAFETY_STATUS",
  "ITEM_PRICE_STATUS",
  "ITEM_PRICE_ELIGIBILITY",
  "ITEM_FINAL_TECHNICAL_APPROVAL",
  "ITEM_COMMERCIAL_READINESS",
  "ITEM_PRODUCT_REJECTION_REASON",
  "ITEM_SPEC_REQUIREMENTS",
  "ITEM_DRAWING_EVIDENCE",
]);

// The claim categories actually PROVEN this turn -- only a FOUND tool
// result contributes capabilities; a not-found/ambiguous result proves
// nothing about the item's fields (and never reaches this function anyway,
// since Section 7/8 short-circuit those server-side before any content
// call -- see runAgentTurn).
function availableClaimCapabilities(toolResults) {
  const capabilities = new Set();
  for (const entry of toolResults) {
    if (entry.toolName === "get_project_status") {
      for (const capability of CLAIM_CAPABILITIES.get_project_status) capabilities.add(capability);
    }
    if (entry.toolName === "get_boq_item_context" && entry.result?.found) {
      for (const capability of CLAIM_CAPABILITIES.get_boq_item_context) capabilities.add(capability);
    }
    if (entry.toolName === "get_requirement_profile" && entry.result?.found) {
      for (const capability of CLAIM_CAPABILITIES.get_requirement_profile) capabilities.add(capability);
    }
    if (entry.toolName === "get_product_matching_status" && entry.result?.found) {
      for (const capability of CLAIM_CAPABILITIES.get_product_matching_status) capabilities.add(capability);
    }
  }
  return capabilities;
}

// ============================================================
// Slice 2.2, Section 3: question intent -- small, deterministic, pattern-
// based (never a general NLU framework). Item-scope is decided FIRST via
// detectItemReferenceInQuestion (the SAME classifier Section 5 already uses
// for entity-scope grounding), so "is this question about a specific item"
// never diverges between the two mechanisms.
// ============================================================
export const QUESTION_INTENTS = Object.freeze([
  "PROJECT_STATUS",
  "PROJECT_BLOCKERS",
  "PROJECT_NEXT_ACTION",
  "ITEM_INFORMATION",
  "ITEM_QUANTITY",
  "ITEM_READINESS_REASON",
  "ITEM_REQUIREMENTS",
  "ITEM_REQUIREMENT_CONFLICTS",
  "ITEM_MATCHING_STATUS",
  "ITEM_REFERENCE_LOOKUP",
  "UNKNOWN",
]);

// Checked first, and shared across item/project phrasing ("what is
// blocking..."), because the brief's own readiness examples ("what is
// blocking item X?") use the same wording as a project-blockers question --
// only the presence of an item reference (checked by the caller) tells
// them apart. Deliberately UNCHANGED from Slice 3.1 -- "why isn't item X
// ready?" still means the plain, requirement-only readiness question it
// always meant (Slice 4's own brief: "Do NOT change that architecture").
// A DIFFERENT phrasing ("why isn't X matched?") is what routes to the new
// ITEM_MATCHING_STATUS intent below.
const READINESS_OR_BLOCKING_PATTERN = /\b(?:why\s+(?:isn'?t|is\s+not)\b[^?]*\bready\b|what(?:'s| is)\s+blocking\b|why\s+is\b[^?]*\bnot\s+ready\b)/i;
const QUANTITY_PATTERN = /\b(?:quantity|qty|how\s+many)\b/i;
// Slice 4: "genuinely asks about product matching/candidates" (Section 11
// of the brief) -- checked before the narrower requirements/conflicts
// patterns below since "candidate"/"matched" phrasing is otherwise generic
// enough to fall through to them by accident (e.g. a rejection question
// naming a candidate could otherwise look like a plain requirements ask).
const MATCHING_PATTERN = /\b(?:match(?:ed|ing)?|compatible\s+products?|candidates?|(?:product|candidate)\s+(?:been\s+)?selected)\b/i;
// Slice 3: "genuinely asks technical requirements" (Section 10 of the
// brief) -- deliberately narrower than INFORMATION_PATTERN below, checked
// first so a real requirements/conflicts question is never swallowed by
// the generic "what do we know" bucket.
const REQUIREMENTS_PATTERN = /\b(?:what\s+requirements|technical\s+requirements|requirements?\s+apply|required\s+attributes?)\b/i;
const REQUIREMENT_CONFLICTS_PATTERN = /\bconflicts?\b/i;
const INFORMATION_PATTERN = /\b(?:what\s+do\s+we\s+know|tell\s+me\s+about|details?\s+(?:on|about)|what\s+is\s+item)\b/i;
const PROJECT_NEXT_ACTION_PATTERN = /\b(?:next\s+(?:action|step)|what\s+should\s+i\s+(?:do|work\s+on)\s+next)\b/i;
const PROJECT_STATUS_PATTERN = /\b(?:status|ready\s+to\s+quote|how\s+is\s+the\s+project)\b/i;

export function detectQuestionIntent(question) {
  const text = String(question ?? "");
  const itemReference = detectItemReferenceInQuestion(text);
  if (itemReference) {
    if (READINESS_OR_BLOCKING_PATTERN.test(text)) return "ITEM_READINESS_REASON";
    if (QUANTITY_PATTERN.test(text)) return "ITEM_QUANTITY";
    if (MATCHING_PATTERN.test(text)) return "ITEM_MATCHING_STATUS";
    if (REQUIREMENT_CONFLICTS_PATTERN.test(text)) return "ITEM_REQUIREMENT_CONFLICTS";
    if (REQUIREMENTS_PATTERN.test(text)) return "ITEM_REQUIREMENTS";
    if (INFORMATION_PATTERN.test(text)) return "ITEM_INFORMATION";
    return "ITEM_REFERENCE_LOOKUP";
  }
  if (READINESS_OR_BLOCKING_PATTERN.test(text)) return "PROJECT_BLOCKERS";
  if (PROJECT_NEXT_ACTION_PATTERN.test(text)) return "PROJECT_NEXT_ACTION";
  if (PROJECT_STATUS_PATTERN.test(text)) return "PROJECT_STATUS";
  return "UNKNOWN";
}

// The claim categories a given intent REQUIRES to be answered as GROUNDED.
//
// Slice 3: ITEM_READINESS_REASON now requires ITEM_REQUIREMENT_PROFILE
// (get_requirement_profile actually called and found) rather than the
// permanently-unsatisfiable ITEM_READINESS_REASON capability -- this is the
// structural form of "get_requirement_profile may support
// ITEM_READINESS_REASON only to the extent the requirement profile actually
// proves it" (Section 4 of the brief): the tool call is now required, but
// FULL product-selection readiness remains impossible to claim regardless
// -- enforced separately, by subjectStatus staying null for every
// item-scoped question (Slice 2.2, unchanged) and by
// detectRequirementProfileContradiction/containsOutOfScopeClaim rejecting
// any matching/eligibility/safety/price/selection claim (Section 4/13).
export const INTENT_REQUIRED_CAPABILITIES = Object.freeze({
  PROJECT_STATUS: Object.freeze(["PROJECT_PHASE"]),
  PROJECT_BLOCKERS: Object.freeze(["PROJECT_BLOCKER"]),
  PROJECT_NEXT_ACTION: Object.freeze(["PROJECT_NEXT_ACTION"]),
  ITEM_INFORMATION: Object.freeze(["ITEM_IDENTITY"]),
  ITEM_QUANTITY: Object.freeze(["ITEM_SELECTED_QUANTITY"]),
  ITEM_READINESS_REASON: Object.freeze(["ITEM_REQUIREMENT_PROFILE"]),
  ITEM_REQUIREMENTS: Object.freeze(["ITEM_REQUIREMENT_PROFILE"]),
  ITEM_REQUIREMENT_CONFLICTS: Object.freeze(["ITEM_REQUIREMENT_CONFLICT"]),
  // Slice 4: a matching-flavored question needs BOTH the requirement
  // profile AND the matching result -- Section 11-A of the brief expects
  // the full item -> requirement -> matching chain, and Section 15 (Cross-
  // Layer Readiness) requires every matching answer to also state whether
  // the requirement profile itself is clean, since a matching run can be
  // wrong precisely BECAUSE the requirement profile changed underneath it.
  ITEM_MATCHING_STATUS: Object.freeze(["ITEM_REQUIREMENT_PROFILE", "ITEM_MATCHING_STATUS"]),
  ITEM_REFERENCE_LOOKUP: Object.freeze(["ITEM_IDENTITY"]),
  UNKNOWN: Object.freeze([]),
});

function missingRequiredCapabilities(questionIntent, available) {
  const required = INTENT_REQUIRED_CAPABILITIES[questionIntent] || [];
  return required.filter((capability) => !available.has(capability));
}

// Slice 3: real live-model evidence showed that computing missingCapabilities
// only at ANSWER-content time was too late -- given a neutral "call another
// tool only if genuinely still needed" decision prompt, the model reliably
// abstained after get_boq_item_context alone rather than continuing to
// get_requirement_profile (6/6 live runs never reached it, despite the
// system prompt already saying to call it for readiness questions). Reusing
// the SAME capability-to-tool mapping at DECISION time, BEFORE the model
// chooses, and stating explicitly which tool would satisfy the gap, is what
// actually fixed it (verified live -- see the Slice 3 report).
function toolsForMissingCapabilities(missingCapabilities) {
  const tools = new Set();
  for (const capability of missingCapabilities) {
    for (const toolName of TOOL_NAMES) {
      if (CLAIM_CAPABILITIES[toolName]?.includes(capability)) tools.add(toolName);
    }
  }
  return [...tools];
}

// Slice 4: extracted from buildAgentPrompt so runAgentTurn can ALSO use it
// to pick a toolName-restricted schema (forcedSpecificToolCallSchema),
// not just to word the prompt hint -- both must agree on exactly which
// tool is being demanded. Always resolves to at most one tool once the
// item-resolution and profile-before-matching orderings below are
// applied, which is what makes forcing toolName's enum to it safe.
function computeNextToolsNeeded({ missingCapabilities, toolResults, itemResolved }) {
  let nextToolsNeeded = toolsForMissingCapabilities(missingCapabilities).filter((name) => !toolResults.some((entry) => entry.toolName === name));
  // Neither get_requirement_profile nor get_product_matching_status can
  // ever be the first real recommendation: both require an already-
  // resolved item (see the itemId-injection comment in runAgentTurn), so
  // redirect to get_boq_item_context whenever the item isn't resolved yet.
  if (!itemResolved && (nextToolsNeeded.includes("get_requirement_profile") || nextToolsNeeded.includes("get_product_matching_status"))) {
    return ["get_boq_item_context"];
  }
  if (nextToolsNeeded.includes("get_requirement_profile") && nextToolsNeeded.includes("get_product_matching_status")) {
    // Slice 4, Section 11-A: gather the requirement profile before
    // matching status -- a matching answer is expected to explain BOTH
    // layers (Section 15), and the requirement profile is the more
    // fundamental fact (a stale/blocked profile also explains why the
    // match run itself may be stale or wrong).
    return ["get_requirement_profile"];
  }
  return nextToolsNeeded;
}

// ============================================================
// Section 8 (Slice 1) / Section 7 (Slice 2): compact, permanent system
// instructions. Capability boundaries are now stated explicitly per tool
// (Section 7) -- but per Slice 1's own finding, this prompt text is NOT
// trusted alone; Section 5's structural checks in runAgentTurn are the
// real enforcement.
// ============================================================
export const AGENT_SYSTEM_INSTRUCTIONS =
  "You are an AI Pre-Sales Engineer. For any project-specific claim you must use an available tool before answering -- never answer from memory alone. Only state facts a tool result actually contains. get_project_status proves PROJECT-level facts only (workflow phase, next action, project-level blockers) -- it knows nothing about any individual BOQ item. get_boq_item_context proves one specific BOQ item's identity, description, quantities and review status only. get_requirement_profile proves that same item's technical requirement profile -- its requirements and their source types, missing mandatory requirements, unresolved conflicts, whether the profile is stale, and the profile's own readiness status/blocking reasons -- call it (with the itemId a prior get_boq_item_context result returned) whenever a question asks why an item is or isn't ready, what is blocking it, what requirements apply, or what conflicts exist. get_product_matching_status proves that same item's product matching status -- whether matching has run, whether it is stale, aggregate candidate counts, the top ranked candidates with their real matched/failed criteria and missing evidence, and whether an engineer has actually selected one -- call it (with the same itemId) whenever a question asks whether the item is matched, whether compatible products exist, why a specific candidate was rejected, which candidates need review, or whether a product has been selected; for such a question, call get_requirement_profile FIRST if it has not been called yet this turn, then get_product_matching_status. NO item tool knows safety status, price status, specification requirements, drawing evidence, final technical approval for quotation, price eligibility, commercial readiness, or a final product-selection decision; if asked about those, say that information is not available from the current tool set, do not guess it. A 'technically eligible' matching candidate is never the same as an approved, selected, or price-eligible product -- never collapse those states. If the question names a specific BOQ item, you must call get_boq_item_context for that exact item before answering about it -- project-level evidence can never stand in for item-level evidence. Never restate project-level or another item's data as if it were about the named item. A CLEAN requirement profile (no missing requirements, no conflicts, not stale) proves the item is ready at the REQUIREMENT level only -- it does NOT prove the item is ready for product selection, since matching/safety/price evidence may still be missing. Distinguish confirmed evidence, inference, missing information, and engineer decisions. Never invent part numbers, quantities, prices, requirements, drawing evidence, candidates, or candidate criteria. Technical eligibility must be considered before price. Drawing quantity evidence is not BOQ truth. Historical evidence is not current truth. Respond ONLY with the requested structured JSON action -- do not explain your reasoning process or include any text outside the JSON.";

// Slice 3.1, Section 3: a SEPARATE, narrower system prompt for the
// explanation-only content call -- it no longer needs the tool catalogue
// or decision-making instructions above (AGENT_SYSTEM_INSTRUCTIONS is
// decision-time only now), and it is explicit that every fact it is shown
// is already decided and off-limits to change.
export const ANSWER_EXPLANATION_SYSTEM_INSTRUCTIONS =
  "You are an AI Pre-Sales Engineer writing the explanation for an already-decided, server-authoritative set of facts. Every fact you are given (whether the requirement profile is stale, which requirements are missing, which conflicts exist, review status, quantities, project blockers, and the recommended action) has ALREADY been decided by the server from real tool evidence -- you cannot see or change it, only explain it in your own words. Do not invent, add, remove, or contradict any fact given to you. Do not use internal field names (e.g. missingRequirements, profileStale, reviewStatus, readinessStatus, sourceTypes) in your prose -- describe them in plain engineering language instead. Never claim matching status, technical eligibility, safety status, price status, or a product-selection decision -- those are never covered by the given facts. If capabilityGaps mentions product-selection readiness is not available, say so plainly rather than declaring the item simply 'ready'. Respond ONLY with the requested structured JSON -- no text outside the JSON.";

const CORRECTIVE_NOTICE_NO_TOOL =
  "You attempted to answer a project-specific question without calling a tool first. That is not allowed. Call a registered tool now, or answer only if the question genuinely needs no project-specific evidence.";
const correctiveNoticeForItemScope = (itemReference) =>
  `You attempted to answer a question about item "${itemReference}" without item-level evidence for that exact item. Project-level evidence alone can never support an item-specific claim. Call get_boq_item_context with arguments {"itemReference":"${itemReference}"} before answering.`;

// ============================================================
// Section 4/5: strict, explicit JSON schemas for Workers AI's native
// structured-output support.
// ============================================================

// Slice 3.1, Section 3: replaces the old FINAL_RESPONSE_SCHEMA as the
// model-facing content schema. The model no longer supplies
// responseStatus, subjectStatus, blockers, or references at all -- see the
// file header and buildAuthoritativeAnswerFacts above for why. A smaller
// schema with no enum/status fields to get wrong is also expected to
// reduce malformed/retry cases (Slice 3.1 report, Section 10).
export const ANSWER_EXPLANATION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    findingsText: { type: "array", items: { type: "string" }, maxItems: 6 },
    explanation: { type: "string" },
    recommendedNextActionText: { type: "string" },
  },
  required: ["summary", "findingsText", "explanation", "recommendedNextActionText"],
});

// Slice 2.1: `arguments` is now structurally MANDATORY on every decision
// (not just present-if-you-feel-like-it), and its one field is typed
// string|null rather than a bare, shapeless object -- so the model cannot
// emit {"action":"CALL_TOOL","toolName":"get_boq_item_context"} without
// itemReference the way it did 13/13 times in Slice 2. See the comment
// above PROJECT_STATUS_ARGUMENTS_SCHEMA for why this flat shape was chosen
// over a oneOf discriminated union (oneOf was accepted by Workers AI but
// proved unreliable live -- it locked onto one branch regardless of intent,
// confirmed on two independent oneOf shapes, including a 2-way CALL_TOOL-
// vs-ANSWER split which failed to ever select ANSWER after real tool
// evidence, 0/8).
// Slice 3: a second nullable field, itemId, added alongside itemReference --
// tested live before adopting broadly (see the comment above TOOL_REGISTRY's
// get_requirement_profile entry and the Slice 3 report): the SAME
// always-required-and-nullable shape that fixed Slice 2.1's argument-
// omission bug held up with two fields, 10/10 correct on the real model.
// Slice 3: ONE shared field, not two -- see the comment above
// PROJECT_STATUS_ARGUMENTS_SCHEMA for the live evidence that a second
// nullable field broke reliability. Its meaning is tool-dependent: the
// user-typed reference for get_boq_item_context, or the already-resolved
// internal item id for get_requirement_profile -- validateAgentStep
// relabels it into distinct internal `itemReference`/`itemId` fields based
// on the tool's argumentKind, so no downstream code needed to change.
const AGENT_STEP_ARGUMENTS_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    itemReference: { type: ["string", "null"], description: "The item reference for get_boq_item_context, the internal item id for get_requirement_profile, or null for get_project_status." },
  },
  required: ["itemReference"],
});

// Slice 2.1, second finding: making `arguments` required AND embedding the
// full FINAL_RESPONSE_SCHEMA as a sibling `answer` property in the SAME
// schema reliably breaks the real model -- live evidence showed it via
// JSON.parse failures ("Expecting ',' delimiter" at end-of-string): the
// model would emit a complete-looking answer, then never emit the outer
// closing brace, instead padding with whitespace tokens until max_tokens
// truncation (finish_reason:"length"). Removing `arguments` from
// requiredness fixed ANSWER but reintroduced the CALL_TOOL omission bug;
// keeping it required but making the per-tool itemReference requirement
// non-mandatory made no difference (still broke ANSWER, 5/6). The reliable
// fix (verified: 8/8 clean CALL_TOOL, 8/8 clean forced-ANSWER, 8/8 clean
// FINAL_RESPONSE_SCHEMA-alone content) is architectural, not schema-only:
// split into two separate model calls per turn instead of one. This
// AGENT_DECISION_SCHEMA (small, no `answer` field at all) drives the
// CALL_TOOL-vs-ANSWER choice and any tool arguments; FINAL_RESPONSE_SCHEMA
// (already exported above) is then used STANDALONE, as its own
// response_format, for the actual answer content once the decision is
// ANSWER and grounding is satisfied. See runAgentTurn.
export const AGENT_DECISION_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["CALL_TOOL", "ANSWER"] },
    toolName: { type: "string", enum: [...TOOL_NAMES] },
    arguments: AGENT_STEP_ARGUMENTS_SCHEMA,
  },
  required: ["action", "arguments"],
});

// Slice 3, third finding: a decision-time PROMPT hint alone ("do not answer
// yet") was not enough -- live evidence showed the model reliably ignoring
// it and choosing ANSWER anyway once ANY tool result already existed (0/6).
// Restricting `action`'s enum to CALL_TOOL ONLY -- structurally, not just
// textually -- was what actually fixed it (verified live: 6/6). Used by
// runAgentTurn only for the decision immediately after missingCapabilities
// is still non-empty; every other decision still uses AGENT_DECISION_SCHEMA
// so the model remains free to answer once genuinely ready.
export const AGENT_FORCED_TOOL_CALL_SCHEMA = Object.freeze({
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["CALL_TOOL"] },
    toolName: { type: "string", enum: [...TOOL_NAMES] },
    arguments: AGENT_STEP_ARGUMENTS_SCHEMA,
  },
  required: ["action", "arguments"],
});

// Slice 4, live finding: once a 4th tool exists, forcing only `action`
// (leaving all 4 toolNames open) stopped being reliable -- live evidence
// (Scenario B: "Are there any compatible products for item X?") showed the
// model, needing only get_requirement_profile at that point, instead
// calling get_project_status (a tool that satisfies NOTHING it still
// needs), then repeating a call and failing safely. The fix is the exact
// same escalation that fixed `action` in Slice 3: forbid the wrong choice
// STRUCTURALLY, not just via the prompt hint. computeNextToolsNeeded
// (below) always resolves to at most one unambiguous tool whenever it is
// non-empty, so this schema variant can safely pin toolName's enum to
// exactly that one tool.
function forcedSpecificToolCallSchema(toolNames) {
  return Object.freeze({
    type: "object",
    additionalProperties: false,
    properties: {
      action: { type: "string", enum: ["CALL_TOOL"] },
      toolName: { type: "string", enum: toolNames },
      arguments: AGENT_STEP_ARGUMENTS_SCHEMA,
    },
    required: ["action", "arguments"],
  });
}

// ============================================================
// Section 5/6: explicit server-side semantic validation -- the real
// enforcement, never prompt text alone (this is exactly what Slice 1's
// real-model evidence showed prompt-only instructions could not reliably
// hold).
// ============================================================
class UngroundedAnswerError extends Error {
  constructor(message, reasonCode) {
    super(message);
    this.reasonCode = reasonCode;
  }
}
class AgentValidationError extends Error {}

// Validates a DECISION (CALL_TOOL-vs-ANSWER choice), not final answer
// content -- see AGENT_DECISION_SCHEMA. An ANSWER decision returns just
// {action:"ANSWER"}; the caller (runAgentTurn) then separately fetches and
// validates the actual content via validateFinalResponse below.
export function validateAgentStep(step, { groundedThisTurn, itemScopeSatisfiedForQuestion = true, questionItemReference = null }) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new AgentValidationError("Agent step must be a structured object.");
  }
  if (step.action !== "CALL_TOOL" && step.action !== "ANSWER") {
    throw new AgentValidationError("Agent step action must be CALL_TOOL or ANSWER.");
  }
  // Section 1 (Slice 2.1): arguments is now schema-mandated on every
  // decision (see AGENT_STEP_ARGUMENTS_SCHEMA) -- but schema conformance is
  // never trusted alone (per the file header). This still independently
  // verifies the shape.
  //
  // Slice 3: the WIRE schema carries exactly ONE field (itemReference) for
  // every tool -- see the comment above AGENT_STEP_ARGUMENTS_SCHEMA for the
  // live evidence that a second field broke reliability. Its meaning is
  // relabeled HERE, per-tool, via argumentKind, into the distinct internal
  // `itemReference`/`itemId` shape the rest of the engine (runAgentTurn's
  // cross-item check, the worker tool executors) already expects -- no
  // downstream code needed to change for this fix.
  if (!step.arguments || typeof step.arguments !== "object" || Array.isArray(step.arguments)) {
    throw new AgentValidationError("Every decision requires a structured arguments object.");
  }
  const rawItemReference = step.arguments.itemReference;
  if (rawItemReference !== null && typeof rawItemReference !== "string") {
    throw new AgentValidationError("arguments.itemReference must be a string or null.");
  }

  if (step.action === "CALL_TOOL") {
    if (typeof step.toolName !== "string" || !step.toolName) {
      throw new AgentValidationError("CALL_TOOL requires a toolName.");
    }
    const tool = TOOL_REGISTRY[step.toolName];
    if (!tool) {
      throw new AgentValidationError(`Unregistered tool: ${step.toolName}`);
    }
    if (tool.argumentKind === "ITEM_REFERENCE") {
      // Live evidence (Section 12 Scenario D): once the decision schema is
      // forced to CALL_TOOL from the very first turn (see the
      // AGENT_FORCED_TOOL_CALL_SCHEMA comment), the model sometimes selects
      // the right tool but leaves itemReference blank rather than
      // transcribing it. questionItemReference is the SAME single,
      // deterministic reference already used to decide questionScope
      // (detectItemReferenceInQuestion) -- when the model gave nothing, it
      // is safe to fall back to it. This is narrower than the get_
      // requirement_profile itemId injection: a non-empty (even wrong)
      // model-supplied reference is NEVER overridden, so Section 9's
      // wrong-item detection (querying item B for a question about item A)
      // still fires exactly as before.
      const trimmed = typeof rawItemReference === "string" ? rawItemReference.trim() : "";
      const effective = trimmed || (typeof questionItemReference === "string" ? questionItemReference.trim() : "");
      if (!effective) {
        throw new AgentValidationError(`Tool ${step.toolName} requires a non-empty arguments.itemReference.`);
      }
      return { action: "CALL_TOOL", toolName: step.toolName, arguments: { itemReference: effective, itemId: null } };
    }
    if (tool.argumentKind === "ITEM_ID") {
      // Live evidence: even under the forced-tool-call schema, the model
      // reliably returns itemReference: null for this tool rather than
      // transcribing the internal item id. That's fine -- runAgentTurn
      // always injects the real, already-resolved itemId server-side (or
      // rejects the call outright if nothing was resolved yet this turn)
      // and never trusts this field's content. Gating on it here would
      // reject the call before the injection ever runs, so this branch
      // only validates the wire type, not presence.
      return { action: "CALL_TOOL", toolName: step.toolName, arguments: { itemReference: null, itemId: typeof rawItemReference === "string" ? rawItemReference.trim() || null : null } };
    }
    // argumentKind === "NONE"
    if (rawItemReference !== null) {
      throw new AgentValidationError(`Tool ${step.toolName} takes no item -- arguments.itemReference must be null.`);
    }
    return { action: "CALL_TOOL", toolName: step.toolName, arguments: {} };
  }
  // action === "ANSWER"
  if (!groundedThisTurn) {
    throw new UngroundedAnswerError("Answer attempted before any tool executed this turn.", "NO_TOOL_EVIDENCE");
  }
  if (!itemScopeSatisfiedForQuestion) {
    throw new UngroundedAnswerError(
      `Answer attempted for a question about item "${questionItemReference}" without a matching item-scoped tool result.`,
      "ITEM_SCOPE_EVIDENCE_MISSING",
    );
  }
  // toolName/arguments are schema-mandated placeholders on ANSWER decisions
  // (the shared schema has no conditional way to omit them for ANSWER) --
  // their content carries no meaning here and is intentionally ignored.
  return { action: "ANSWER" };
}

// Slice 3.1, Section 9: server-owned, closed action-type vocabulary --
// the MEANING of recommendedNextAction can no longer be chosen or changed
// by the model (see buildAuthoritativeAnswerFacts); it may only phrase the
// label differently, never pick a different actionType.
export const RECOMMENDED_ACTION_TYPES = Object.freeze([
  "RECALCULATE_REQUIREMENT_PROFILE",
  "RESOLVE_REQUIREMENT_CONFLICT",
  "REVIEW_MISSING_REQUIREMENTS",
  "REVIEW_PRODUCT_MATCHING",
  // Slice 4, Section 14: extended only with the three types this slice's
  // logic actually emits. RESOLVE_REQUIREMENT_BLOCKER (also listed in the
  // brief) is deliberately NOT added -- every requirement-level blocker
  // this engine can detect already has a more specific existing type
  // (RESOLVE_REQUIREMENT_CONFLICT / REVIEW_MISSING_REQUIREMENTS /
  // RECALCULATE_REQUIREMENT_PROFILE); adding an unused generic value would
  // be dead enum surface, not a real capability.
  "RUN_PRODUCT_MATCHING",
  "RERUN_PRODUCT_MATCHING",
  "REVIEW_PRODUCT_CANDIDATES",
  "RESOLVE_PROJECT_BLOCKERS",
  "NONE",
]);

// Slice 3.1, Section 10: this now validates the SERVER'S OWN merged
// output (buildFinalAnswer's return value), never raw model output --
// the model no longer supplies responseStatus, subjectStatus, facts,
// blockers, recommendedNextAction.actionType, or references at all (see
// ANSWER_EXPLANATION_SCHEMA). Kept as a defensive assertion: it should
// always pass; if it doesn't, that is a bug in the merge logic itself,
// never a model-quality problem.
export function validateFinalResponse(answer) {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    throw new AgentValidationError("Final response must be a structured object.");
  }
  const keys = Object.keys(answer);
  const allowed = ["summary", "responseStatus", "subjectStatus", "facts", "findings", "blockers", "recommendedNextAction", "references"];
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new AgentValidationError("Final response contains unknown or missing fields.");
  }
  if (typeof answer.summary !== "string" || !answer.summary.trim()) throw new AgentValidationError("Final response summary is invalid.");
  if (!RESPONSE_STATUSES.includes(answer.responseStatus)) throw new AgentValidationError("Final response responseStatus is invalid.");
  if (answer.subjectStatus !== null && !SUBJECT_STATUSES.includes(answer.subjectStatus)) {
    throw new AgentValidationError("Final response subjectStatus must be null or a real subject status.");
  }
  if (!answer.facts || typeof answer.facts !== "object" || Array.isArray(answer.facts)) {
    throw new AgentValidationError("Final response facts is invalid.");
  }
  for (const name of ["findings", "blockers"]) {
    if (!Array.isArray(answer[name]) || answer[name].some((entry) => typeof entry !== "string")) {
      throw new AgentValidationError(`Final response ${name} must be an array of strings.`);
    }
  }
  const action = answer.recommendedNextAction;
  if (!action || typeof action !== "object" || Array.isArray(action) || !RECOMMENDED_ACTION_TYPES.includes(action.actionType) || typeof action.label !== "string") {
    throw new AgentValidationError("Final response recommendedNextAction is invalid.");
  }
  if (!Array.isArray(answer.references)) throw new AgentValidationError("Final response references must be an array.");
  for (const reference of answer.references) {
    if (!reference || typeof reference !== "object" || Array.isArray(reference)) {
      throw new AgentValidationError("Final response reference is malformed.");
    }
    if (reference.type === "Project") {
      if (typeof reference.projectId !== "string" || !reference.projectId) throw new AgentValidationError("Final response Project reference is malformed.");
    } else if (reference.type === "BOQ_ITEM") {
      if (typeof reference.projectId !== "string" || !reference.projectId || typeof reference.itemId !== "string" || !reference.itemId) {
        throw new AgentValidationError("Final response BOQ_ITEM reference is malformed.");
      }
    } else {
      throw new AgentValidationError("Final response reference has an unsupported type.");
    }
  }
  return answer;
}

// ============================================================
// Section 6: the concrete, achievable version of "answer claim
// validation." Full natural-language claim-checking is out of scope
// (explicitly, per the brief); this instead enforces a closed vocabulary
// boundary -- when the question is item-scoped and get_boq_item_context is
// the ONLY item-level tool this slice has (no matching/safety/price/
// specification/drawing tool exists yet), the model's findings/blockers
// may never use vocabulary belonging to those NOT-YET-AVAILABLE
// capabilities. This is deliberately conservative: it can reject a
// correctly-hedged abstention that happens to use one of these words, in
// which case the loop's own safe-failure path returns a PARTIAL answer --
// never worse than the alternative, which is a fabricated claim.
// ============================================================
// Slice 4: no tool in this or any prior slice ever proves these -- safety,
// final technical approval "for quotation," price, and commercial
// readiness remain entirely out of scope regardless of which OTHER tools
// ran this turn. Always forbidden.
const FINAL_APPROVAL_CLAIM_PATTERN =
  /\b(safety\s+(?:block\w*|approv\w*)|specification\s+requirement\w*|drawing\s+evidence|technical(?:ly)?\s+approv\w*|approved\s+for\s+quotation|price\s+(?:evidence|status|eligib\w*)|eligible\s+(?:current\s+)?price\w*|current\s+price\w*|no\s+eligible\s+price\w*|commercial(?:ly)?\s+read\w*|(?:product|item)\s+\S+\s+is\s+selected|selected\s+product|product\s+selection\s+(?:complete|confirmed|finalized|decision))\b/i;
// Slice 3.1: this vocabulary was ALWAYS forbidden because no tool proved
// it. Slice 4 makes get_product_matching_status a REAL tool that
// legitimately proves candidate/matching status -- so this tier is now
// forbidden ONLY when matching evidence was not actually gathered this
// turn (the Slice 1-3.1 item tools/intents never call the matching tool at
// all, so this vocabulary remains exactly as forbidden for them as before).
const MATCHING_VOCABULARY_PATTERN =
  /\b(technical(?:ly)?\s+eligib\w*|matching\s+(?:status|result\w*|failed|succeed\w*|passed)|candidate\w*|non-?compliant|complian\w*)\b/i;
export function containsOutOfScopeClaim(strings, { matchingAvailable = false } = {}) {
  const list = strings || [];
  if (list.some((entry) => FINAL_APPROVAL_CLAIM_PATTERN.test(entry))) return true;
  if (!matchingAvailable && list.some((entry) => MATCHING_VOCABULARY_PATTERN.test(entry))) return true;
  return false;
}

// Slice 3.1, Section 4: the exact live bug this backstop targets --
// blockers=["missingRequirements","stale"] (the model literally echoing
// tool-result JSON KEY NAMES back as prose, live evidence from the Slice 3
// report Section 10/14). Structurally this can no longer happen for
// blockers at all (they are 100% server-authored now -- see
// buildAuthoritativeAnswerFacts), but the model's remaining free-text
// fields (summary/explanation/findingsText/recommendedNextActionText)
// could still coincidentally echo one of these identifiers; this is the
// backstop that catches it.
const INTERNAL_FIELD_NAME_TOKENS = [
  "missingRequirements", "profileStale", "reviewStatus", "readinessStatus",
  "blockingReasons", "sourceTypes", "selectedQuantitySource", "itemReference",
  "itemId", "profileVersionId", "requirementReviewStatus", "itemReviewStatus",
  "boqQuantity", "capabilityGaps", "responseStatus", "subjectStatus",
  "recommendedNextAction", "actionType",
];
const RAW_FIELD_NAME_LEAK_PATTERN = new RegExp(`\\b(?:${INTERNAL_FIELD_NAME_TOKENS.join("|")})\\b`);
export function containsInternalFieldNameLeak(strings) {
  return (strings || []).some((entry) => RAW_FIELD_NAME_LEAK_PATTERN.test(entry));
}

// ============================================================
// Slice 2.2, Section 5: self-consistency invariants. Not general semantic
// theorem-proving (explicitly out of scope) -- these are concrete,
// deliberately narrow contradiction checks against fields the tool result
// THIS TURN actually returned. Only two invariants exist because only two
// fields currently carry an unambiguous, checkable "this claim is simply
// false" signal: reviewStatus and the selected-quantity pair.
// ============================================================
const REVIEW_NOT_DONE_CONTRADICTION_PATTERN =
  /\breview\s+(?:is\s+)?(?:missing|pending|not\s+(?:yet\s+)?(?:done|complete|started)|required|outstanding|needed)\b|\bawaiting\s+review\b|\bpending\s+review\b|\bmissing\s+review\b|\bneeds?\s+review\b/i;
const QUANTITY_UNKNOWN_CONTRADICTION_PATTERN =
  /\b(?:quantity|qty)\s+(?:is\s+)?unknown\b|\bunknown\s+(?:quantity|qty)\b|\b(?:selected\s+)?quantity\s+(?:decision\s+)?(?:is\s+)?missing\b|\bmissing\s+quantity\s+decision\b|\bdrawing\s+quantity\s+(?:is\s+)?govern\w*\b|\bquantity\s+decision\s+(?:is\s+)?missing\b/i;

// Returns a human-readable contradiction description, or null if the
// answer text does not contradict the actual BOQ_ITEM tool result this
// turn (or no such result exists -- e.g. a project-only question).
export function detectSelfContradiction(strings, boqItemResult) {
  if (!boqItemResult || !boqItemResult.found || !boqItemResult.item) return null;
  const item = boqItemResult.item;
  const text = (strings || []).join(" ");
  if (item.reviewStatus === "Approved" && REVIEW_NOT_DONE_CONTRADICTION_PATTERN.test(text)) {
    return `reviewStatus is "Approved" but the answer claims review is missing/pending/needed.`;
  }
  if (item.selectedQuantity != null && item.selectedQuantitySource && QUANTITY_UNKNOWN_CONTRADICTION_PATTERN.test(text)) {
    return `selectedQuantity is ${item.selectedQuantity} (source: ${item.selectedQuantitySource}) but the answer claims the quantity is unknown, missing, or governed by drawing evidence.`;
  }
  return null;
}

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const CONFLICT_EXISTS_CLAIM_PATTERN = /\bconflicts?\s+(?:exist\w*|found|detected|between|remain\w*)\b/i;
const PROFILE_CURRENT_CLAIM_PATTERN = /\b(?:is\s+current|reflects\s+current|up[\s-]?to[\s-]?date)\b/i;
const PROFILE_NOT_CURRENT_HEDGE_PATTERN = /\bnot\s+current\b|\bno\s+longer\s+current\b|\bstale\b|\boutdated\b/i;
// Slice 3.1, Section 7: the reverse direction of the same invariant --
// live evidence (Slice 3 report, Scenario B) showed the model twice
// claiming a genuinely non-stale profile "is stale," which the Slice 3
// detector never checked (it only guarded stale-treated-as-current).
const PROFILE_STALE_CLAIM_PATTERN = /\b(?:is\s+stale|profile\s+is\s+stale|stale\s+(?:requirement\s+)?profile|needs?\s+recalculation)\b/i;
const PROFILE_STALE_HEDGE_PATTERN = /\bnot\s+stale\b|\bisn'?t\s+stale\b|\bno\s+longer\s+stale\b|\bdoes\s+not\s+need\s+recalculation\b/i;

// Slice 3, Section 13: the SAME concrete, field-level contradiction
// discipline as detectSelfContradiction above, applied to
// get_requirement_profile's result instead of get_boq_item_context's.
// Three narrow, deterministic invariants -- never general theorem-proving:
// (1) the profile reports zero conflicts but the answer claims one exists;
// (2) the profile is stale but the answer treats it as current; (3) a
// specific attribute the profile lists as MISSING is asserted a value.
export function detectRequirementProfileContradiction(strings, requirementProfileResult) {
  if (!requirementProfileResult || !requirementProfileResult.found) return null;
  const text = (strings || []).join(" ");
  if ((requirementProfileResult.conflicts || []).length === 0 && CONFLICT_EXISTS_CLAIM_PATTERN.test(text)) {
    return "the requirement profile reports no conflicts, but the answer claims a conflict exists.";
  }
  if (requirementProfileResult.stale && PROFILE_CURRENT_CLAIM_PATTERN.test(text) && !PROFILE_NOT_CURRENT_HEDGE_PATTERN.test(text)) {
    return "the requirement profile is stale, but the answer treats it as current.";
  }
  if (!requirementProfileResult.stale && PROFILE_STALE_CLAIM_PATTERN.test(text) && !PROFILE_STALE_HEDGE_PATTERN.test(text)) {
    return "the requirement profile is not stale, but the answer claims it is stale.";
  }
  for (const missing of requirementProfileResult.missingRequirements || []) {
    if (!missing) continue;
    // "X is (a) required/missing/mandatory/needed/not provided" honestly
    // RESTATES that X is missing -- only an actual value assertion after
    // is/=/: counts as a contradiction. The excluded-word check and its
    // optional article live in ONE lookahead (not a separate consuming
    // group before it) so backtracking can never fall through an excluded
    // phrase onto its own leading article (e.g. "is a missing..." must not
    // match by backtracking off "missing" onto the bare "a").
    const valueAssertionPattern = new RegExp(
      `\\b${escapeRegex(missing)}\\b\\s*(?:is|=|:)\\s*(?!(?:an?\\s+)?(?:required|missing|mandatory|needed|unknown|not\\s+(?:provided|available|specified|known))\\b)\\S`,
      "i",
    );
    if (valueAssertionPattern.test(text)) {
      return `${missing} is a missing requirement, but the answer asserts a value for it.`;
    }
  }
  return null;
}

const MATCHING_STALE_CLAIM_PATTERN = /\b(?:matching\s+is\s+stale|match(?:ing)?\s+(?:run\s+)?needs?\s+(?:to\s+be\s+)?rerun|stale\s+match(?:ing)?|match(?:ing)?\s+run\s+is\s+stale)\b/i;
const MATCHING_NOT_STALE_HEDGE_PATTERN = /\bnot\s+stale\b|\bisn'?t\s+stale\b|\bno\s+longer\s+stale\b|\bdoes\s+not\s+need\s+(?:to\s+be\s+)?rerun\b/i;
const MATCHING_CURRENT_CLAIM_PATTERN = /\bmatching\s+is\s+current\b|\bmatch(?:ing)?\s+run\s+is\s+current\b|\bcurrent\s+match(?:ing)?\s+run\b/i;

// Slice 4, Section 13/16: the SAME concrete, field-level contradiction
// discipline as detectRequirementProfileContradiction above, applied to
// get_product_matching_status's result. Four narrow, deterministic
// invariants: (1) the run is not stale but the answer claims it needs
// rerunning; (2) the run IS stale but the answer treats it as current;
// (3)/(4) a SPECIFIC candidate the tool proved has zero real failedCriteria
// AND zero missingEvidence is accused of failing or missing something
// anyway (the exact fabrication Section 16 of the brief requires rejecting)
// -- "Product X has been selected" when nothing was selected is already
// covered by containsOutOfScopeClaim's FINAL_APPROVAL_CLAIM_PATTERN, so it
// is not duplicated here.
export function detectProductMatchingContradiction(strings, matchingResult) {
  if (!matchingResult || !matchingResult.found) return null;
  const text = (strings || []).join(" ");
  if (!matchingResult.stale && MATCHING_STALE_CLAIM_PATTERN.test(text) && !MATCHING_NOT_STALE_HEDGE_PATTERN.test(text)) {
    return "the product match run is not stale, but the answer claims it needs to be rerun.";
  }
  if (matchingResult.stale && MATCHING_CURRENT_CLAIM_PATTERN.test(text)) {
    return "the product match run is stale, but the answer treats it as current.";
  }
  for (const candidate of matchingResult.candidates || []) {
    if (!candidate.partNumber) continue;
    const isClean = (candidate.failedCriteria || []).length === 0 && (candidate.missingEvidence || []).length === 0;
    if (!isClean) continue;
    const fabricationPattern = new RegExp(`${escapeRegex(candidate.partNumber)}[^.]{0,80}\\b(?:fail\\w*|missing\\s+evidence|reject\\w*|non-?compliant)\\b`, "i");
    if (fabricationPattern.test(text)) {
      return `${candidate.partNumber} has no real failed criteria or missing evidence, but the answer claims it failed or is missing something.`;
    }
  }
  return null;
}

// ============================================================
// Prompt construction. The INITIAL prompt never includes full project or
// item state -- only the question and the tool catalogue. This is the
// DECISION prompt (CALL_TOOL vs ANSWER, paired with AGENT_DECISION_SCHEMA).
// ============================================================
export function buildAgentPrompt({ question, toolResults, correctiveNotice, missingCapabilities = [], itemResolved = false }) {
  const availableTools = TOOL_NAMES.map((name) => ({
    name,
    description: TOOL_REGISTRY[name].description,
    arguments: TOOL_REGISTRY[name].argumentsSchema,
  }));
  // See the comment above computeNextToolsNeeded/toolsForMissingCapabilities:
  // computed and stated explicitly HERE (decision time), not only at
  // content time, or the model reliably stops one tool short of what the
  // question actually needs. Live evidence (Section 12 Scenario D: "What
  // conflicts exist for item 28.19?") showed this ALSO has to fire on the
  // very first decision, not only after a tool has already run -- gating
  // it on toolResults.length left turn-1 with no tool-selection hint at
  // all, and the model reliably guessed get_project_status for
  // "conflicts" phrasing instead of resolving the item.
  const nextToolsNeeded = computeNextToolsNeeded({ missingCapabilities, toolResults, itemResolved });
  return {
    system: AGENT_SYSTEM_INSTRUCTIONS,
    user: stableStringify({
      question,
      availableTools,
      toolResults: toolResults.map((entry) => ({ toolName: entry.toolName, result: entry.result })),
      ...(correctiveNotice ? { correctiveNotice } : {}),
      ...(nextToolsNeeded.length ? { nextToolRequired: `This question is not yet fully answerable. Call ${nextToolsNeeded.join(" or ")} next -- do not answer yet.` } : {}),
      instruction: toolResults.length
        ? "Use the tool result(s) above to answer with ANSWER, or call another registered tool only if genuinely still needed."
        : "Call a registered tool first (CALL_TOOL) if this question needs project-specific or item-specific evidence; only use ANSWER directly if it needs none at all.",
    }),
  };
}

// ============================================================
// Slice 3.1: AUTHORITATIVE ANSWER FACTS. Everything a final answer can
// state as FACT is decided HERE -- deterministically, from this turn's
// real tool results -- before the model is asked anything. See the file
// header for the live evidence this replaces. Only fields a tool actually
// proved are populated; everything else stays null, never guessed.
// ============================================================

// Deliberately renamed from the raw tool result keys (which both use
// "reviewStatus" for two DIFFERENT things: the BOQ item's own review
// status vs. the requirement profile's separate review status). Live
// evidence (Slice 3 report, Scenario B run #7) showed the model visibly
// confusing the two when both were shown under the identical key name --
// this collision is removed at the source, not just filtered after.
const PRODUCT_SELECTION_GAP_TEXT =
  "Product-selection readiness (product matching, technical eligibility, safety, and price) is not yet available from this agent's current tool set.";
// Slice 4, Section 15 (Cross-Layer Readiness): a DIFFERENT gap statement
// for matching-flavored answers specifically -- matching-level evidence
// (candidates, eligibility, staleness) IS now genuinely available, so the
// old PRODUCT_SELECTION_GAP_TEXT (which claims matching itself is
// unavailable) would be inaccurate here. Only safety and price remain
// unevaluated once the matching tool has actually run.
const FINAL_APPROVAL_GAP_TEXT =
  "Final approval (safety and price) is not yet evaluated by current agent tools.";
const READINESS_FLAVORED_INTENTS = Object.freeze(["ITEM_READINESS_REASON", "ITEM_REQUIREMENTS", "ITEM_REQUIREMENT_CONFLICTS"]);
const MATCHING_FLAVORED_INTENTS = Object.freeze(["ITEM_MATCHING_STATUS"]);
const CAPABILITY_GAP_LABELS = Object.freeze({
  ITEM_REQUIREMENT_PROFILE: "No technical requirement profile is available yet for this item.",
  ITEM_REQUIREMENT_CONFLICT: "No requirement-conflict evidence is available for this item.",
  ITEM_MATCHING_STATUS: "No product matching evidence is available yet for this item.",
  ITEM_SELECTED_QUANTITY: "No selected quantity is available for this item.",
  ITEM_IDENTITY: "This item could not be identified.",
  PROJECT_BLOCKER: "No project-level blocker evidence is available.",
  PROJECT_PHASE: "No project-level phase evidence is available.",
  PROJECT_NEXT_ACTION: "No project-level next-action evidence is available.",
});
const RECOMMENDED_ACTION_LABELS = Object.freeze({
  RECALCULATE_REQUIREMENT_PROFILE: "Recalculate the requirement profile -- drawing evidence has changed since it was generated.",
  RESOLVE_REQUIREMENT_CONFLICT: "Resolve the requirement conflict with an engineering decision on the governing source.",
  REVIEW_MISSING_REQUIREMENTS: "Review and supply the missing technical requirement(s).",
  REVIEW_PRODUCT_MATCHING: "Proceed to product matching -- the requirement profile itself is ready.",
  RUN_PRODUCT_MATCHING: "Run product matching -- it has not been run yet for this item.",
  RERUN_PRODUCT_MATCHING: "Rerun product matching -- requirements have changed since the current match run.",
  REVIEW_PRODUCT_CANDIDATES: "Review the matched candidates -- an engineer decision is required before selection.",
  RESOLVE_PROJECT_BLOCKERS: "Resolve the open project-level blocker(s).",
  NONE: "",
});
const conflictBlockerText = (conflict) => {
  const values = (conflict.values || [])
    .map((value) => {
      if (!value.sourceType) return null;
      const raw = String(value.value ?? "?");
      // The unit is sometimes already embedded in value.value (e.g. "24V")
      // and sometimes carried separately -- never append a unit the value
      // already ends with, or it doubles up ("24VV").
      const unit = value.unit && !raw.toLowerCase().endsWith(String(value.unit).toLowerCase()) ? value.unit : "";
      return `${value.sourceType}: ${raw}${unit}`;
    })
    .filter(Boolean)
    .join(" vs. ");
  return `Requirement conflict on ${conflict.attribute || "an attribute"}${values ? ` (${values})` : ""} -- engineering review is required to confirm the governing source.`;
};

// A plain-language, per-candidate summary line -- the SAME server-rendered
// discipline as conflictBlockerText, reused for candidates (Section 10 of
// the brief: "the server should render factual candidate summaries," "do
// not let LLM create additional criteria").
const matchingCandidateSummaryLine = (candidate) => {
  const label = candidate.partNumber || candidate.productId || "Unnamed candidate";
  const parts = [`Candidate ${label}${candidate.manufacturer ? ` (${candidate.manufacturer})` : ""}: ${candidate.deterministicStatus || "Unknown status"}.`];
  if ((candidate.matchedCriteria || []).length) parts.push(`Matched: ${candidate.matchedCriteria.join(", ")}.`);
  if ((candidate.failedCriteria || []).length) parts.push(`Failed: ${candidate.failedCriteria.join(", ")}.`);
  if ((candidate.missingEvidence || []).length) parts.push(`Missing: ${candidate.missingEvidence.join(", ")}.`);
  return parts.join(" ");
};

// toolResults -> { entity, facts, missingRequirements, conflicts,
// capabilityGaps, blockers, recommendedAction, responseStatus,
// subjectStatus }. Section 1: only fields actually proven are populated;
// everything else stays null. Section 2: responseStatus/subjectStatus/
// blockers/missingRequirements/conflicts are fully decided here -- the
// model can no longer change them (see buildFinalAnswer below, which
// never lets model prose alter these, only explain them).
export function buildAuthoritativeAnswerFacts({ questionIntent, toolResults, missingCapabilities = [] }) {
  const boqItemResult = [...toolResults].reverse().find((entry) => entry.toolName === "get_boq_item_context" && entry.result?.found)?.result;
  const requirementProfileResult = [...toolResults].reverse().find((entry) => entry.toolName === "get_requirement_profile" && entry.result?.found)?.result;
  const matchingResult = [...toolResults].reverse().find((entry) => entry.toolName === "get_product_matching_status" && entry.result?.found)?.result;
  const projectResult = [...toolResults].reverse().find((entry) => entry.toolName === "get_project_status")?.result;

  const entity = boqItemResult
    ? { type: "BOQ_ITEM", projectId: boqItemResult.projectId ?? null, itemId: boqItemResult.item.itemId, itemReference: boqItemResult.item.itemReference }
    : projectResult
      ? { type: "PROJECT", projectId: projectResult.projectId ?? null, itemId: null, itemReference: null }
      : { type: null, projectId: null, itemId: null, itemReference: null };

  const facts = {
    system: boqItemResult?.item.system ?? requirementProfileResult?.system ?? null,
    family: boqItemResult?.item.family ?? requirementProfileResult?.family ?? null,
    itemReviewStatus: boqItemResult?.item.reviewStatus ?? null,
    selectedQuantity: boqItemResult?.item.selectedQuantity ?? null,
    selectedQuantitySource: boqItemResult?.item.selectedQuantitySource ?? null,
    boqQuantity: boqItemResult?.item.boqQuantity ?? null,
    description: boqItemResult?.item.description ?? null,
    profileStale: requirementProfileResult ? Boolean(requirementProfileResult.stale) : null,
    readinessStatus: requirementProfileResult?.readinessStatus ?? null,
    requirementReviewStatus: requirementProfileResult?.reviewStatus ?? null,
    // Slice 4: matching facts, only populated when get_product_matching_status
    // actually found a result this turn.
    matchStatus: matchingResult?.status ?? null,
    matchStale: matchingResult ? Boolean(matchingResult.stale) : null,
    candidateCount: matchingResult?.candidateCount ?? null,
    technicallyEligibleCount: matchingResult?.counts?.technicallyEligible ?? null,
    discoveryOnlyCount: matchingResult?.counts?.discoveryOnly ?? null,
    nonCompliantCount: matchingResult?.counts?.nonCompliant ?? null,
    needsReviewCount: matchingResult?.counts?.needsReview ?? null,
    selectedCandidatePartNumber: matchingResult?.selectedCandidate?.partNumber ?? null,
    selectedCandidateReviewStatus: matchingResult?.selectedCandidate?.reviewStatus ?? null,
    projectPhase: projectResult?.currentPhase ?? null,
  };

  const missingRequirements = requirementProfileResult ? [...(requirementProfileResult.missingRequirements || [])] : [];
  const conflicts = requirementProfileResult ? (requirementProfileResult.conflicts || []).map((entry) => ({ ...entry })) : [];

  const blockers = [];
  if (requirementProfileResult?.stale) {
    blockers.push("Requirement profile needs recalculation -- drawing evidence has changed since it was generated.");
  }
  for (const missing of missingRequirements) {
    if (missing) blockers.push(`Missing technical requirement: ${missing}.`);
  }
  for (const conflict of conflicts) blockers.push(conflictBlockerText(conflict));
  // Slice 4, Section 7/9: matching staleness and the matching engine's own
  // real "why zero valid candidates" reason -- never a guess (Section 9 of
  // the brief: "do not guess why zero unless blocker evidence exists").
  if (matchingResult?.stale) {
    blockers.push("Product matching needs to be rerun -- requirements have changed since the current match run.");
  }
  for (const matchingBlocker of matchingResult?.blockers || []) {
    if (matchingBlocker) blockers.push(matchingBlocker);
  }
  if (projectResult && (questionIntent === "PROJECT_BLOCKERS" || questionIntent === "PROJECT_STATUS")) {
    for (const blocker of projectResult.blockers || []) {
      if (blocker.message) blockers.push(blocker.message);
    }
  }

  const capabilityGaps = missingCapabilities.map((capability) => CAPABILITY_GAP_LABELS[capability] || `Not available from the current tool set: ${capability}.`);
  if (requirementProfileResult && READINESS_FLAVORED_INTENTS.includes(questionIntent)) {
    capabilityGaps.push(PRODUCT_SELECTION_GAP_TEXT);
  }
  // Slice 4, Section 15: once matching evidence genuinely exists, the gap
  // narrows from "matching is unavailable" to "safety/price are
  // unavailable" -- a materially different, more accurate statement.
  if (matchingResult && MATCHING_FLAVORED_INTENTS.includes(questionIntent)) {
    capabilityGaps.push(FINAL_APPROVAL_GAP_TEXT);
  }

  let actionType = "NONE";
  if (requirementProfileResult?.stale) actionType = "RECALCULATE_REQUIREMENT_PROFILE";
  else if (conflicts.length) actionType = "RESOLVE_REQUIREMENT_CONFLICT";
  else if (missingRequirements.length) actionType = "REVIEW_MISSING_REQUIREMENTS";
  else if (matchingResult?.stale) actionType = "RERUN_PRODUCT_MATCHING";
  else if (matchingResult && (matchingResult.counts.technicallyEligible + matchingResult.counts.discoveryOnly + matchingResult.counts.nonCompliant) > 0) actionType = "REVIEW_PRODUCT_CANDIDATES";
  else if (requirementProfileResult && READINESS_FLAVORED_INTENTS.includes(questionIntent)) actionType = "REVIEW_PRODUCT_MATCHING";
  else if (projectResult && (projectResult.blockers || []).length && (questionIntent === "PROJECT_BLOCKERS" || questionIntent === "PROJECT_STATUS")) actionType = "RESOLVE_PROJECT_BLOCKERS";

  return {
    entity,
    facts,
    missingRequirements,
    conflicts,
    capabilityGaps,
    blockers,
    matchingCandidateSummaries: matchingResult ? (matchingResult.candidates || []).map(matchingCandidateSummaryLine) : [],
    recommendedAction: { actionType, label: RECOMMENDED_ACTION_LABELS[actionType] },
    responseStatus: missingCapabilities.length ? "PARTIAL" : "GROUNDED",
    subjectStatus: null,
    // Not part of the user-facing contract -- carried so the merge step and
    // the SAME contradiction backstops Slice 2.2/3/3.1 already proved can
    // check model prose against the real tool results this structure came
    // from, without re-deriving them a second time.
    _boqItemResult: boqItemResult || null,
    _requirementProfileResult: requirementProfileResult || null,
    _matchingResult: matchingResult || null,
    _projectResult: projectResult || null,
  };
}

// References are now built EXCLUSIVELY from this turn's real tool results
// -- the model is never asked to supply or copy one (see
// ANSWER_EXPLANATION_SCHEMA), so there is no longer an "invented/ungrounded
// reference" failure mode to guard against; this is the only source of the
// final references array.
function buildAuthoritativeReferences(toolResults) {
  const refs = [];
  const seen = new Set();
  const add = (key, reference) => {
    if (seen.has(key)) return;
    seen.add(key);
    refs.push(reference);
  };
  for (const entry of toolResults) {
    if (entry.toolName === "get_project_status" && entry.result?.projectId) {
      add(`Project:${entry.result.projectId}`, { type: "Project", projectId: entry.result.projectId });
    }
    if (entry.toolName === "get_boq_item_context" && entry.result?.found && entry.result.item?.itemId) {
      add(`BOQ_ITEM:${entry.result.projectId}:${entry.result.item.itemId}`, {
        type: "BOQ_ITEM",
        projectId: entry.result.projectId,
        itemId: entry.result.item.itemId,
        itemReference: entry.result.item.itemReference,
      });
    }
  }
  return refs.slice(0, 5);
}

// A curated, human-labeled fact sheet -- NOT the raw camelCase facts
// object -- is what the model actually sees. Showing the model the raw
// object (with keys like profileStale, requirementReviewStatus) is exactly
// how it learned to echo those key names back as prose in Slice 3's live
// runs; pre-rendering plain-language lines removes that path at the source
// (containsInternalFieldNameLeak remains as a backstop regardless).
function renderFactLines(aaf) {
  const lines = [];
  if (aaf.facts.system) lines.push(`System: ${aaf.facts.system}`);
  if (aaf.facts.family) lines.push(`Family: ${aaf.facts.family}`);
  if (aaf.facts.itemReviewStatus) lines.push(`Item review status: ${aaf.facts.itemReviewStatus}`);
  if (aaf.facts.selectedQuantity != null) {
    lines.push(`Selected quantity: ${aaf.facts.selectedQuantity}${aaf.facts.selectedQuantitySource ? ` (source: ${aaf.facts.selectedQuantitySource})` : ""}`);
  }
  if (aaf._requirementProfileResult) {
    lines.push(`Requirement profile currency: ${aaf.facts.profileStale ? "stale -- needs recalculation" : "current -- not stale"}`);
    lines.push(`Requirement profile readiness status: ${aaf.facts.readinessStatus ?? "unknown"}`);
    lines.push(`Requirement profile review status: ${aaf.facts.requirementReviewStatus ?? "unknown"}`);
  }
  if (aaf._matchingResult) {
    lines.push(`Product matching currency: ${aaf.facts.matchStale ? "stale -- needs rerunning" : "current -- not stale"}`);
    lines.push(`Product matching status: ${aaf.facts.matchStatus ?? "unknown"}`);
    lines.push(`Candidate count: ${aaf.facts.candidateCount ?? 0} (technically eligible: ${aaf.facts.technicallyEligibleCount ?? 0}, discovery only: ${aaf.facts.discoveryOnlyCount ?? 0}, non-compliant: ${aaf.facts.nonCompliantCount ?? 0}, needs review: ${aaf.facts.needsReviewCount ?? 0})`);
    lines.push(`Selected candidate: ${aaf.facts.selectedCandidatePartNumber ? `${aaf.facts.selectedCandidatePartNumber} (${aaf.facts.selectedCandidateReviewStatus})` : "none -- no candidate has been engineer-selected"}`);
  }
  if (aaf.facts.projectPhase) lines.push(`Project phase: ${aaf.facts.projectPhase}`);
  return lines;
}

// Slice 3.1, Section 3: the narrow EXPLANATION prompt. The model is shown
// the server's ALREADY-DECIDED facts/blockers/capabilityGaps/recommended
// action and asked only to explain them in prose -- it can no longer
// change any of them (buildFinalAnswer enforces this regardless of what
// the model returns).
export function buildExplanationPrompt({ question, aaf, correctiveNotice = null }) {
  const hasMatching = Boolean(aaf._matchingResult);
  return {
    system: ANSWER_EXPLANATION_SYSTEM_INSTRUCTIONS,
    user: stableStringify({
      question,
      decidedFacts: renderFactLines(aaf),
      missingRequirements: aaf.missingRequirements,
      conflicts: aaf.conflicts,
      ...(hasMatching ? { candidates: aaf.matchingCandidateSummaries } : {}),
      blockers: aaf.blockers,
      capabilityGaps: aaf.capabilityGaps,
      recommendedAction: aaf.recommendedAction.label,
      ...(correctiveNotice ? { correctiveNotice } : {}),
      instruction: hasMatching
        ? "decidedFacts, missingRequirements, conflicts, candidates, blockers, capabilityGaps, and recommendedAction above are ALREADY DECIDED and authoritative -- you cannot change them, add a candidate, remove one, or invent criteria for one. Write only: summary (natural language), findingsText (up to 6 short sentences explaining, never adding to or contradicting, blockers/capabilityGaps/candidates above), explanation (a short elaboration), and recommendedNextActionText (a short sentence consistent with recommendedAction's meaning -- you may rephrase it, never change what it means). It is fine to use 'candidate', 'technically eligible', 'Discovery Only', or 'Non-Compliant' -- that vocabulary is genuinely proven here. Never claim safety approval, final technical approval for quotation, price eligibility, commercial readiness, or that a candidate was engineer-selected unless the 'Selected candidate' fact above names one. Never use internal field names as words (e.g. missingRequirements, profileStale, matchStale) -- describe them in plain engineering language."
        : "decidedFacts, missingRequirements, conflicts, blockers, capabilityGaps, and recommendedAction above are ALREADY DECIDED and authoritative -- you cannot change them. Write only: summary (natural language), findingsText (up to 6 short sentences explaining, never adding to or contradicting, blockers/capabilityGaps above), explanation (a short elaboration), and recommendedNextActionText (a short sentence consistent with recommendedAction's meaning -- you may rephrase it, never change what it means). Never use internal field names as words (e.g. missingRequirements, profileStale, reviewStatus) -- describe them in plain engineering language. Never mention matching, technical eligibility, candidates, safety, or price status.",
    }),
  };
}

// Slice 3.1, Section 3: pure type/shape validation only -- this schema no
// longer carries any FACTUAL field (no responseStatus/subjectStatus/
// blockers/references), so there is nothing here for content-quality
// checks to police; those apply separately, per-string, in proseIsSafe.
function validateExplanationContent(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new AgentValidationError("Explanation response must be a structured object.");
  }
  const keys = Object.keys(raw);
  const allowed = ["summary", "findingsText", "explanation", "recommendedNextActionText"];
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) {
    throw new AgentValidationError("Explanation response contains unknown or missing fields.");
  }
  if (typeof raw.summary !== "string") throw new AgentValidationError("Explanation summary is invalid.");
  if (!Array.isArray(raw.findingsText) || raw.findingsText.some((entry) => typeof entry !== "string")) {
    throw new AgentValidationError("Explanation findingsText must be an array of strings.");
  }
  if (typeof raw.explanation !== "string") throw new AgentValidationError("Explanation explanation is invalid.");
  if (typeof raw.recommendedNextActionText !== "string") throw new AgentValidationError("Explanation recommendedNextActionText is invalid.");
  return {
    summary: raw.summary.trim(),
    findingsText: raw.findingsText.map((entry) => entry.trim()).filter(Boolean),
    explanation: raw.explanation.trim(),
    recommendedNextActionText: raw.recommendedNextActionText.trim(),
  };
}

// A single piece of model prose is kept only if it passes every backstop
// Slice 2.2/3 already proved (self-contradiction, requirement-profile
// contradiction, out-of-scope vocabulary, internal-field-name leak) --
// checked against the SAME real tool results buildAuthoritativeAnswerFacts
// derived from. A failing string is silently DROPPED, never retried: since
// every fact is already server-owned, dropping one bad sentence can never
// make the final answer factually wrong, only slightly less verbose (and a
// server-authored fallback always exists -- see buildFinalAnswer).
function proseIsSafe(text, { boqItemResult, requirementProfileResult, matchingResult, questionScope }) {
  if (!text) return false;
  if (containsInternalFieldNameLeak([text])) return false;
  if (questionScope === "BOQ_ITEM" && containsOutOfScopeClaim([text], { matchingAvailable: Boolean(matchingResult) })) return false;
  if (detectSelfContradiction([text], boqItemResult)) return false;
  if (detectRequirementProfileContradiction([text], requirementProfileResult)) return false;
  if (detectProductMatchingContradiction([text], matchingResult)) return false;
  return true;
}

// Server-authored default, used whenever no piece of the model's prose
// passes proseIsSafe -- guarantees the final summary is always coherent
// and correct regardless of model output quality.
// Slice 4: aaf.blockers now mixes requirement-level AND matching-level
// blockers together (Section 3's flat tool contract) -- "is the
// REQUIREMENT PROFILE SPECIFICALLY clean" can no longer be read off
// aaf.blockers.length alone once a matching blocker (e.g. staleness) can
// also populate that same array. This is the one precise check for it,
// used everywhere "Requirement profile: Ready/Not ready" is rendered.
const requirementProfileIsReady = (aaf) =>
  Boolean(aaf._requirementProfileResult) && aaf.missingRequirements.length === 0 && aaf.conflicts.length === 0 && !aaf.facts.profileStale;

// Slice 4, Section 15: the exact three-line cross-layer structure the
// brief requires, server-authored so it is present even with zero usable
// model prose.
const matchingStatusSummaryFragment = (aaf) => {
  if (aaf.facts.matchStale) return "product matching needs to be rerun (stale)";
  if ((aaf.facts.candidateCount ?? 0) === 0) return "no candidates were found";
  if ((aaf.facts.technicallyEligibleCount ?? 0) > 0) return `technically eligible candidates found (${aaf.facts.technicallyEligibleCount})`;
  if ((aaf.facts.discoveryOnlyCount ?? 0) > 0) return "only Discovery Only candidates were found";
  if ((aaf.facts.nonCompliantCount ?? 0) > 0) return "no technically compliant candidates were found (Non-Compliant)";
  return "no eligible candidates were found";
};

function fallbackSummary(aaf) {
  if (aaf.entity.type === "BOQ_ITEM") {
    if (aaf._matchingResult) {
      const lines = [
        `Requirement profile: ${requirementProfileIsReady(aaf) ? "Ready" : "Not ready"}.`,
        `Product matching: ${matchingStatusSummaryFragment(aaf)}.`,
        `Final approval: ${FINAL_APPROVAL_GAP_TEXT}`,
      ];
      return lines.join(" ");
    }
    if (aaf._requirementProfileResult) {
      if (aaf.blockers.length === 0) {
        return aaf.capabilityGaps.length ? `The requirement profile is ready. ${PRODUCT_SELECTION_GAP_TEXT}` : "The requirement profile is ready.";
      }
      return `The requirement profile is not ready: ${aaf.blockers.join(" ")}`;
    }
    if (aaf.facts.selectedQuantity != null) {
      return `The selected quantity is ${aaf.facts.selectedQuantity}${aaf.facts.selectedQuantitySource ? ` (source: ${aaf.facts.selectedQuantitySource})` : ""}.`;
    }
    return "Here is the available information for this item.";
  }
  if (aaf.entity.type === "PROJECT") {
    return aaf.blockers.length ? `The project has open blockers: ${aaf.blockers.join(" ")}` : "No open project-level blockers were found.";
  }
  return "No grounded information is available for this question.";
}

// Slice 3.1, Section 10: the merge. Every FACTUAL field (responseStatus,
// subjectStatus, facts, blockers, recommendedNextAction.actionType,
// references) comes from aaf/toolResults, never from the model. Only
// summary/findings/recommendedNextAction.label may contain model prose --
// and only the pieces that independently pass proseIsSafe.
function buildFinalAnswer(aaf, explanation, references) {
  const ctx = {
    boqItemResult: aaf._boqItemResult,
    requirementProfileResult: aaf._requirementProfileResult,
    matchingResult: aaf._matchingResult,
    questionScope: aaf.entity.type === "BOQ_ITEM" ? "BOQ_ITEM" : "PROJECT",
  };

  const summaryParts = [explanation.summary, explanation.explanation].filter((text) => proseIsSafe(text, ctx));
  const summary = summaryParts.length ? summaryParts.join(" ") : fallbackSummary(aaf);

  const modelFindings = explanation.findingsText.filter((text) => proseIsSafe(text, ctx));
  const baseFindings = [];
  if (aaf.entity.type === "BOQ_ITEM" && aaf._requirementProfileResult) {
    baseFindings.push(requirementProfileIsReady(aaf) ? "Requirement profile: Ready" : "Requirement profile: Not ready");
  }
  if (aaf.entity.type === "BOQ_ITEM" && aaf._matchingResult) {
    baseFindings.push(`Product matching: ${matchingStatusSummaryFragment(aaf)}.`);
    baseFindings.push(...aaf.matchingCandidateSummaries);
  }
  // capabilityGaps (e.g. "no requirement profile exists yet," "product-
  // selection readiness is not yet available") must surface REGARDLESS of
  // whether a requirement profile was ever found this turn -- the absence
  // of a tool call is itself part of the gap being communicated.
  if (aaf.entity.type === "BOQ_ITEM") baseFindings.push(...aaf.capabilityGaps);
  const findings = [...baseFindings, ...modelFindings].slice(0, 10);

  const actionLabel = explanation.recommendedNextActionText && proseIsSafe(explanation.recommendedNextActionText, ctx)
    ? explanation.recommendedNextActionText
    : aaf.recommendedAction.label;

  return {
    summary,
    responseStatus: aaf.responseStatus,
    subjectStatus: aaf.subjectStatus,
    facts: {
      entityType: aaf.entity.type,
      itemId: aaf.entity.itemId,
      itemReference: aaf.entity.itemReference,
      projectId: aaf.entity.projectId,
      system: aaf.facts.system,
      family: aaf.facts.family,
      itemReviewStatus: aaf.facts.itemReviewStatus,
      profileStale: aaf.facts.profileStale,
      readinessStatus: aaf.facts.readinessStatus,
      requirementReviewStatus: aaf.facts.requirementReviewStatus,
      selectedQuantity: aaf.facts.selectedQuantity,
      selectedQuantitySource: aaf.facts.selectedQuantitySource,
      matchStatus: aaf.facts.matchStatus,
      matchStale: aaf.facts.matchStale,
      candidateCount: aaf.facts.candidateCount,
      technicallyEligibleCount: aaf.facts.technicallyEligibleCount,
      discoveryOnlyCount: aaf.facts.discoveryOnlyCount,
      nonCompliantCount: aaf.facts.nonCompliantCount,
      needsReviewCount: aaf.facts.needsReviewCount,
      selectedCandidatePartNumber: aaf.facts.selectedCandidatePartNumber,
      selectedCandidateReviewStatus: aaf.facts.selectedCandidateReviewStatus,
    },
    findings,
    blockers: aaf.blockers.slice(),
    recommendedNextAction: { actionType: aaf.recommendedAction.actionType, label: actionLabel },
    references,
  };
}

const fingerprint = (value) => stableStringify(value);

const FAILURE_MESSAGES = Object.freeze({
  PROVIDER_ERROR: "Workers AI is unavailable or the request failed. I can't complete this request right now.",
  MALFORMED_MODEL_OUTPUT: "The model returned an invalid response that failed validation. I can't confirm an answer right now.",
  REPEATED_UNGROUNDED_ANSWER: "The model could not produce a grounded answer after being asked to use a tool. Retry the question.",
  REPEATED_TOOL_CALL: "The model requested the same tool with the same arguments again instead of answering. Retry the question.",
  UNREGISTERED_TOOL: "The model requested a tool that is not available. I can't complete this request right now.",
  TOOL_EXECUTION_ERROR: "A backend tool failed while gathering evidence. I can't confirm an answer right now.",
  STEP_LIMIT_REACHED: "This question needed more steps than allowed. Retry with a narrower question.",
});

// A FIXED, non-model-generated safe response -- every failure path returns
// this shape, never a partially-trusted model answer. responseStatus is
// FAILED_SAFE (not PARTIAL) -- PARTIAL means "grounded, but some requested
// evidence is honestly unavailable"; this means the turn itself could not
// be completed at all. subjectStatus is always null -- no tool evidence is
// trusted on a failure path.
const EMPTY_FACTS = Object.freeze({
  entityType: null, itemId: null, itemReference: null, projectId: null,
  system: null, family: null, itemReviewStatus: null, profileStale: null,
  readinessStatus: null, requirementReviewStatus: null, selectedQuantity: null, selectedQuantitySource: null,
  matchStatus: null, matchStale: null, candidateCount: null, technicallyEligibleCount: null,
  discoveryOnlyCount: null, nonCompliantCount: null, needsReviewCount: null,
  selectedCandidatePartNumber: null, selectedCandidateReviewStatus: null,
});

function safeFailure(reason, diagnostics, error) {
  return {
    status: "FAILED_SAFE",
    reason,
    answer: {
      summary: "I can't confirm a grounded answer to this question right now.",
      responseStatus: "FAILED_SAFE",
      subjectStatus: null,
      facts: EMPTY_FACTS,
      findings: [],
      blockers: [FAILURE_MESSAGES[reason] || "The request could not be completed safely."],
      recommendedNextAction: { actionType: "NONE", label: "Retry the question." },
      references: [],
    },
    diagnostics: { ...diagnostics, failureReason: reason, error: error ? String(error?.message || error) : null },
  };
}

// Deterministic, server-authored GROUNDED response -- never asks the model
// again. Used for ITEM_NOT_FOUND / ITEM_REFERENCE_AMBIGUOUS (Section 7/8):
// there is no valid entity to reason about, so there is nothing for the
// model to add, and asking it anyway is exactly what let Slice 2's real
// model fabricate a reference or (Slice 2.1's finding) retry the identical
// call instead of answering honestly.
function deterministicResolverResponse(summary, recommendedNextActionLabel, actionType = "NONE") {
  return {
    summary,
    responseStatus: "GROUNDED",
    subjectStatus: null,
    facts: EMPTY_FACTS,
    findings: [],
    blockers: [],
    recommendedNextAction: { actionType, label: recommendedNextActionLabel },
    references: [],
  };
}

// ============================================================
// Section 4/5/10: the bounded loop, now entity-scope aware.
//
// Slice 2.1: TWO providers, not one -- decisionProvider is configured with
// AGENT_DECISION_SCHEMA (small: CALL_TOOL-vs-ANSWER + tool arguments only),
// answerProvider is configured with FINAL_RESPONSE_SCHEMA (used standalone,
// no sibling arguments/toolName). See the comment above
// AGENT_DECISION_SCHEMA for why this replaced a single combined schema.
// Each loop iteration still costs exactly one of maxSteps, even when it
// spends two real model calls (a CALL_TOOL decision always costs one model
// call; an ANSWER decision that passes grounding costs a second, content-
// fetching call in the SAME step) -- MAX_STEPS bounds agent decisions, not
// raw HTTP calls.
//
// toolExecutors: { [toolName]: async (args, {projectId}) => result }.
// get_boq_item_context's result shape (built by the worker):
//   { found: true, projectId, item: <shapeBoqItemContext output> }
//   { found: false, projectId, reason: "ITEM_NOT_FOUND" | "ITEM_REFERENCE_AMBIGUOUS", candidateReference }
// ============================================================
export async function runAgentTurn({ question, projectId, decisionProvider, answerProvider, toolExecutors, maxSteps = MAX_STEPS }) {
  const diagnostics = {
    modelCalls: 0,
    modelCallDetails: [],
    toolCalls: [],
    toolsCalled: [],
    startedAt: Date.now(),
    questionScope: null,
    questionIntent: null,
    requiredCapabilities: null,
    availableCapabilities: null,
    resolvedEntity: null,
    toolEvidenceScopes: [],
    profileVersionId: null,
    profileStale: null,
    matchRunId: null,
    matchStale: null,
    candidateCount: null,
    toolSteering: [],
    groundingFailureReason: null,
  };
  if (!decisionProvider || !answerProvider) {
    diagnostics.groundingFailureReason = "PROVIDER_ERROR";
    return safeFailure("PROVIDER_ERROR", diagnostics);
  }
  if (!question || typeof question !== "string" || !question.trim()) {
    diagnostics.groundingFailureReason = "MALFORMED_MODEL_OUTPUT";
    return safeFailure("MALFORMED_MODEL_OUTPUT", diagnostics);
  }

  const questionItemReference = detectItemReferenceInQuestion(question);
  const questionScope = questionItemReference ? "BOQ_ITEM" : "PROJECT";
  diagnostics.questionScope = questionScope;
  const questionIntent = detectQuestionIntent(question);
  diagnostics.questionIntent = questionIntent;

  let groundedThisTurn = false;
  let itemScopeSatisfiedForQuestion = questionScope !== "BOQ_ITEM";
  let correctiveIssued = false;
  let correctiveNoticeText = null;
  const toolResults = [];
  const seenToolCalls = new Set();
  const seenScopeTypes = new Set();

  for (let step = 0; step < maxSteps; step += 1) {
    const missingCapabilitiesSoFar = missingRequiredCapabilities(questionIntent, availableClaimCapabilities(toolResults));
    const itemResolvedSoFar = Boolean(diagnostics.resolvedEntity);
    const prompt = buildAgentPrompt({ question, toolResults, correctiveNotice: correctiveNoticeText, missingCapabilities: missingCapabilitiesSoFar, itemResolved: itemResolvedSoFar });
    // Slice 4 live finding: with a 4th tool in the registry, forcing only
    // `action` (leaving toolName open across all 4) stopped reliably
    // steering the model to the one tool that actually closes the
    // remaining capability gap -- see the comment above
    // forcedSpecificToolCallSchema. When computeNextToolsNeeded resolves to
    // exactly one tool, pin toolName's enum to it too; otherwise fall back
    // to the broader (any-tool) forced-CALL_TOOL schema Slice 3 proved.
    const nextToolsNeededForStep = missingCapabilitiesSoFar.length
      ? computeNextToolsNeeded({ missingCapabilities: missingCapabilitiesSoFar, toolResults, itemResolved: itemResolvedSoFar })
      : [];
    const decisionSchema = nextToolsNeededForStep.length === 1
      ? forcedSpecificToolCallSchema(nextToolsNeededForStep)
      : missingCapabilitiesSoFar.length
        ? AGENT_FORCED_TOOL_CALL_SCHEMA
        : undefined;
    let raw;
    try {
      // Structural forbid, not just a prompt hint -- see the comment above
      // AGENT_FORCED_TOOL_CALL_SCHEMA / forcedSpecificToolCallSchema.
      raw = await decisionProvider.interpret({ prompt, schema: decisionSchema });
      diagnostics.modelCalls += 1;
      if (decisionProvider.lastCallMetadata) diagnostics.modelCallDetails.push(decisionProvider.lastCallMetadata);
    } catch (error) {
      diagnostics.durationMs = Date.now() - diagnostics.startedAt;
      diagnostics.groundingFailureReason = "PROVIDER_ERROR";
      return safeFailure("PROVIDER_ERROR", diagnostics, error);
    }
    // Slice 4.1, Section 3: tool-STEERING diagnostics only -- tool names
    // and step counters, never raw project content -- proving live whether
    // forcedSpecificToolCallSchema's pin actually matches what the model
    // chose, one row per decision step.
    diagnostics.toolSteering.push({
      stepNumber: step,
      availableTools: [...TOOL_NAMES],
      nextToolsNeeded: nextToolsNeededForStep,
      schemaPinnedTool: nextToolsNeededForStep.length === 1 ? nextToolsNeededForStep[0] : null,
      modelChosenTool: raw && typeof raw === "object" ? raw.toolName ?? null : null,
    });

    let validated;
    try {
      validated = validateAgentStep(raw, { groundedThisTurn, itemScopeSatisfiedForQuestion, questionItemReference });
    } catch (error) {
      if (error instanceof UngroundedAnswerError) {
        if (correctiveIssued) {
          diagnostics.durationMs = Date.now() - diagnostics.startedAt;
          diagnostics.groundingFailureReason = error.reasonCode || "REPEATED_UNGROUNDED_ANSWER";
          return safeFailure("REPEATED_UNGROUNDED_ANSWER", diagnostics);
        }
        correctiveIssued = true;
        correctiveNoticeText = error.reasonCode === "ITEM_SCOPE_EVIDENCE_MISSING"
          ? correctiveNoticeForItemScope(questionItemReference)
          : CORRECTIVE_NOTICE_NO_TOOL;
        continue; // consumes one of the bounded steps -- never an unbounded retry
      }
      diagnostics.durationMs = Date.now() - diagnostics.startedAt;
      const reason = error instanceof AgentValidationError && /Unregistered tool/.test(error.message) ? "UNREGISTERED_TOOL" : "MALFORMED_MODEL_OUTPUT";
      diagnostics.groundingFailureReason = reason;
      return safeFailure(reason, diagnostics, error);
    }

    if (validated.action === "ANSWER") {
      // Grounding already passed (validateAgentStep would have thrown
      // UngroundedAnswerError otherwise). Slice 3.1: every FACTUAL field is
      // now decided HERE, deterministically, by buildAuthoritativeAnswerFacts
      // -- responseStatus, subjectStatus, facts, blockers, capabilityGaps,
      // recommendedAction.actionType, and references (buildAuthoritative
      // References) never come from the model. The model is asked only to
      // explain these already-decided facts in prose (buildExplanationPrompt
      // / ANSWER_EXPLANATION_SCHEMA); see the file header for the live
      // evidence this replaces.
      const available = availableClaimCapabilities(toolResults);
      const missingCapabilities = missingRequiredCapabilities(questionIntent, available);
      diagnostics.requiredCapabilities = INTENT_REQUIRED_CAPABILITIES[questionIntent] || [];
      diagnostics.availableCapabilities = [...available];

      const aaf = buildAuthoritativeAnswerFacts({ questionIntent, toolResults, missingCapabilities });
      const references = buildAuthoritativeReferences(toolResults);

      // Slice 3.1: only a genuine JSON-shape violation retries the model
      // now (content-quality issues -- contradictions, out-of-scope
      // vocabulary, internal-field-name leaks -- are silently dropped per-
      // string in buildFinalAnswer/proseIsSafe instead, never retried,
      // since a server-authored fallback always exists). This is expected
      // to reduce corrective retries versus Slice 3 (see the report).
      let explanation = null;
      let contentCorrectiveNotice = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const contentPrompt = buildExplanationPrompt({ question, aaf, correctiveNotice: contentCorrectiveNotice });
        let rawContent;
        try {
          rawContent = await answerProvider.interpret({ prompt: contentPrompt });
          diagnostics.modelCalls += 1;
          if (answerProvider.lastCallMetadata) diagnostics.modelCallDetails.push(answerProvider.lastCallMetadata);
        } catch (error) {
          diagnostics.durationMs = Date.now() - diagnostics.startedAt;
          diagnostics.groundingFailureReason = "PROVIDER_ERROR";
          return safeFailure("PROVIDER_ERROR", diagnostics, error);
        }
        try {
          explanation = validateExplanationContent(rawContent);
          break;
        } catch (error) {
          if (attempt === 0) {
            contentCorrectiveNotice = `Your previous response was rejected: ${error.message} Respond again with the structured JSON only.`;
            continue; // one bounded retry, never unbounded
          }
          diagnostics.durationMs = Date.now() - diagnostics.startedAt;
          diagnostics.groundingFailureReason = "MALFORMED_MODEL_OUTPUT";
          return safeFailure("MALFORMED_MODEL_OUTPUT", diagnostics, error);
        }
      }

      const answer = buildFinalAnswer(aaf, explanation, references);
      validateFinalResponse(answer); // defensive: asserts the server's OWN merge is well-formed
      diagnostics.durationMs = Date.now() - diagnostics.startedAt;
      diagnostics.finalStatus = answer.responseStatus;
      diagnostics.subjectStatus = answer.subjectStatus;
      return { status: "COMPLETED", answer, diagnostics };
    }

    // action === "CALL_TOOL"
    // Slice 3: get_requirement_profile's itemId is ALREADY fully known and
    // verified server-side -- it is exactly diagnostics.resolvedEntity's id
    // from this turn's own get_boq_item_context result; there is only ever
    // one valid value. Real live-model evidence showed the model reliably
    // DECIDES to call this tool but does not reliably TRANSCRIBE that id
    // correctly into its own arguments (it tried the literal strings "null"
    // and the user-facing reference instead, never the real internal id,
    // across every live variant tested). Rather than trust an unreliable
    // transcription of a value the server already has with certainty, the
    // known-correct id is injected directly -- the model's own arguments
    // content for this one field is never used. If no item was resolved
    // yet this turn, there is nothing to inject and the call is rejected
    // (matching the "no cross-item/fabricated evidence" discipline Section
    // 9, Slice 2, already established for item references). Slice 4:
    // get_product_matching_status takes the identical already-resolved
    // itemId, via the identical argumentKind ("ITEM_ID") -- same injection.
    if (validated.toolName === "get_requirement_profile" || validated.toolName === "get_product_matching_status") {
      if (!diagnostics.resolvedEntity?.itemId) {
        diagnostics.durationMs = Date.now() - diagnostics.startedAt;
        diagnostics.groundingFailureReason = validated.toolName === "get_requirement_profile" ? "REQUIREMENT_PROFILE_ITEM_MISMATCH" : "PRODUCT_MATCHING_ITEM_MISMATCH";
        return safeFailure("MALFORMED_MODEL_OUTPUT", diagnostics);
      }
      validated.arguments = { itemReference: null, itemId: diagnostics.resolvedEntity.itemId };
    }

    const callKey = `${validated.toolName}:${fingerprint(validated.arguments)}`;
    if (seenToolCalls.has(callKey)) {
      diagnostics.durationMs = Date.now() - diagnostics.startedAt;
      diagnostics.groundingFailureReason = "REPEATED_TOOL_CALL";
      return safeFailure("REPEATED_TOOL_CALL", diagnostics);
    }
    seenToolCalls.add(callKey);

    const executor = toolExecutors?.[validated.toolName];
    if (typeof executor !== "function") {
      diagnostics.durationMs = Date.now() - diagnostics.startedAt;
      diagnostics.groundingFailureReason = "UNREGISTERED_TOOL";
      return safeFailure("UNREGISTERED_TOOL", diagnostics);
    }
    let result;
    try {
      result = await executor(validated.arguments, { projectId });
    } catch (error) {
      diagnostics.durationMs = Date.now() - diagnostics.startedAt;
      diagnostics.groundingFailureReason = "TOOL_EXECUTION_ERROR";
      return safeFailure("TOOL_EXECUTION_ERROR", diagnostics, error);
    }
    diagnostics.toolCalls.push({ toolName: validated.toolName, arguments: validated.arguments, resultFingerprint: fingerprint(result) });
    diagnostics.toolsCalled.push(validated.toolName);
    toolResults.push({ toolName: validated.toolName, result });
    groundedThisTurn = true;

    const scopeType = TOOL_REGISTRY[validated.toolName].scopeType;
    if (scopeType) seenScopeTypes.add(scopeType);
    diagnostics.toolEvidenceScopes = [...seenScopeTypes];

    // Section 9: cross-item grounding. A tool call for item B never
    // satisfies a question about item A -- only an EXACT reference match
    // (case-insensitive) counts, regardless of found/not-found outcome
    // (an honest "not found" for the SAME reference the question named is
    // still real, item-scoped evidence -- see Section 8 Test F/G).
    if (validated.toolName === "get_boq_item_context") {
      const queried = String(validated.arguments.itemReference || "").trim().toLowerCase();
      const asked = String(questionItemReference || "").trim().toLowerCase();
      if (questionScope === "BOQ_ITEM" && queried === asked) itemScopeSatisfiedForQuestion = true;
      if (result?.found && result.item) diagnostics.resolvedEntity = { itemId: result.item.itemId, itemReference: result.item.itemReference };
    }
    if (validated.toolName === "get_requirement_profile" && result?.found) {
      diagnostics.profileVersionId = result.profileVersionId ?? null;
      diagnostics.profileStale = Boolean(result.stale);
    }
    if (validated.toolName === "get_product_matching_status" && result?.found) {
      diagnostics.matchRunId = result.matchRunId ?? null;
      diagnostics.matchStale = Boolean(result.stale);
      diagnostics.candidateCount = Number.isFinite(Number(result.candidateCount)) ? Number(result.candidateCount) : null;
    }

    // Section 7/8 (Slice 2.2) / Section 11 (Slice 3) / Section 8 (Slice 4):
    // a resolver result with no valid entity to reason about --
    // ITEM_NOT_FOUND, ITEM_REFERENCE_AMBIGUOUS, REQUIREMENT_PROFILE_NOT_FOUND,
    // or MATCH_RUN_NOT_FOUND -- short-circuits to a FIXED, server-authored
    // GROUNDED response and never asks the model again ("do not allow the
    // model to convert absence into a technical conclusion" -- Slice 4's
    // own explicit instruction: "Do not interpret absence as 'no compatible
    // product exists.'"). Exactly one model decision call happens before
    // this -- no answer-model call follows.
    if (result?.found === false) {
      diagnostics.durationMs = Date.now() - diagnostics.startedAt;
      let answer;
      if (validated.toolName === "get_boq_item_context") {
        const reference = result.candidateReference;
        answer = result.reason === "ITEM_REFERENCE_AMBIGUOUS"
          ? deterministicResolverResponse(
              `I found more than one BOQ row matching "${reference}". Please select the intended item.`,
              "Specify which row or internal id you mean (e.g. \"Row 12\" or the internal item id).",
            )
          : deterministicResolverResponse(
              `I couldn't find BOQ item ${reference} in this project.`,
              "Check the item reference and try again.",
            );
      } else if (validated.toolName === "get_requirement_profile") {
        answer = deterministicResolverResponse(
          "No technical requirement profile has been generated for this item yet.",
          "Generate the requirement profile before asking about its requirements or readiness.",
        );
      } else if (validated.toolName === "get_product_matching_status") {
        answer = deterministicResolverResponse(
          "Requirements exist, but product matching has not been run yet.",
          "Run product matching for this item.",
          "RUN_PRODUCT_MATCHING",
        );
      }
      if (answer) {
        diagnostics.finalStatus = answer.responseStatus;
        diagnostics.subjectStatus = answer.subjectStatus;
        return { status: "COMPLETED", answer, diagnostics };
      }
    }
  }

  diagnostics.durationMs = Date.now() - diagnostics.startedAt;
  diagnostics.groundingFailureReason = "STEP_LIMIT_REACHED";
  return safeFailure("STEP_LIMIT_REACHED", diagnostics);
}
