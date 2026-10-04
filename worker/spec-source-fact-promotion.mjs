/**
 * Specification Source Fact Promotion — Deterministic Governance Module
 *
 * Slice 1 of the Source Fact Authority architecture (design closed, see
 * worker/__tests__/spec-source-fact-promotion.test.mjs's own header for the
 * fixture-level proof). Promotes DESCRIPTIVE, project-source-backed
 * technical characteristics — not normative SHALL/MUST obligations — from
 * this project's own extracted Specification evidence into governed
 * engineering_facts "Source Fact" rows.
 *
 * This module is completely separate from, and never imports or modifies,
 * worker/spec-requirement-auto-confirm.mjs. That engine remains exclusively
 * responsible for normative Mandatory requirement approval. This module
 * never sets technical_requirements.review_status or approved_for_downstream,
 * never creates boq_requirement_links, and never touches Requirement
 * Profiles, Matching, BOM, or Pricing.
 *
 * Source discipline: this module reads ONLY technical_requirements,
 * requirement_attributes and requirement_standards — already-structured
 * extraction output from THIS project's own uploaded Specification. It
 * never reads a manufacturer/Product Library table, never calls an AI
 * model, and never derives a fact value from raw requirement text when a
 * structured requirement_attributes/requirement_standards row does not
 * already carry it — "prefer structured extracted values" is treated as an
 * absolute rule here, not a soft preference, to keep this engine as
 * mechanical and auditable as the 12-gate normative engine it sits beside.
 *
 * A promoted Source Fact means: a project-source-backed technical
 * statement establishable without a new engineering design decision. It is
 * created only at status "Pending Review" — Slice 1 never creates an
 * Active fact and never silently overwrites one. Human confirmation
 * (Pending Review -> Active/Rejected) is Slice 2's job.
 */

import { buildFireAlarmTaxonomyContext } from "../app/domain/fire-alarm-taxonomy.mjs";
import { resolveNearestFamilyContext } from "../app/domain/engineering-knowledge.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";
import { currentTechnicalRequirementsFrom, currentTechnicalRequirementEligibleForEngineeringPredicate, governedRequirementSubclauseCandidates } from "./current-evidence-scope.mjs";

const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const now = () => new Date().toISOString();
const slug = (value) => String(value ?? "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();

export const SOURCE_FACT_PROMOTION_POLICY_VERSION = "spec-source-fact-promotion-1.0.0";
export const SOURCE_FACT_PROMOTION_ACTOR = "system:spec-source-fact-promotion";

// Closed vocabulary only — this module never accepts an attribute/standard
// name outside this set, and never invents a predicate via text inference.
// fixed_temperature_setpoint / rate_of_rise_sensitivity / protocol_compatibility
// / base_architecture reuse the specification extractor's own
// requirement_attributes.name values verbatim (no renaming invented — proven
// against the real Clean project's own extracted attribute names).
// applicable_standard is this module's own canonical name for a promoted
// requirement_standards row. high_temp_alternative_available exists only as
// a REROUTE TARGET (see ALTERNATIVE_OPTION_TEXT below) — no requirement
// attribute is ever read under that name directly.
export const SOURCE_FACT_PREDICATES = Object.freeze([
  "fixed_temperature_setpoint",
  "rate_of_rise_sensitivity",
  "protocol_compatibility",
  "base_architecture",
  "applicable_standard",
  "high_temp_alternative_available",
]);
const ATTRIBUTE_PREDICATES = new Set(["fixed_temperature_setpoint", "rate_of_rise_sensitivity", "protocol_compatibility", "base_architecture"]);

// Deterministic, closed, narrow pattern — never NLP-generated — recognizing
// a requirement's own text framing its value as an available ALTERNATIVE
// for special conditions rather than this project's selected/default value.
// Proven necessary against real data: req_192 ("For applications requiring
// increased sensitivity, a high-temperature model provides fixed detection
// at 190°F") has its own requirement_attributes row literally named
// fixed_temperature_setpoint=190°F by the extractor -- promoting that
// as-is would silently select 190°F as this project's Heat Detector
// setpoint, exactly the fabricated selection this whole design forbids.
// Matched only to reroute the PREDICATE (never to touch or interpret the
// VALUE) so the fact still gets recorded honestly, as "an alternative
// exists," never as "this is the chosen value."
const ALTERNATIVE_OPTION_TEXT = /\bfor applications requiring\b|\bhigh[- ]temperature model\b|\balternative model\b|\bhigh[- ]temp(?:erature)? alternative\b|\bwhere required\b|\bwhere necessary\b|\boptional(?:ly)?\b/i;

// Requirements sourced from a Manufacturer/Product-scoped engineering
// domain are never eligible — this module establishes what THIS PROJECT's
// own Specification says, never a manufacturer/product capability claim.
// technical_requirements is, by construction, always extracted from the
// project's own uploaded Technical Specification document (manufacturer
// literature never reaches this table in this architecture) -- this denylist
// is a defensive, explicit second check, not the primary guarantee.
const NON_PROJECT_DOMAINS = new Set(["Manufacturer", "Product", "Supplier"]);

const MIN_CONFIDENCE = 80;

const parseJson = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };

// MVP-CLOSE-14: the deliberate duplication is GONE.
//
// This was a byte-identical copy of worker/engineering-knowledge-api.mjs's
// private requirementSubclauseCandidates, kept separate on purpose. The cost
// of that independence is now measurable: the copy was the SECOND site of the
// same authority leak, and a single fix could never have covered both.
//
//   SELECT sequence, original_text FROM technical_requirements
//    WHERE clause_id=? AND extraction_version_id=? AND sequence<=?
//
// -- keyed on clause identity, with no currentness filter and no review filter.
// MVP-CLOSE-13 proved an unreviewed row's clause text was inherited as the
// effective family/category of a DIFFERENT requirement, and here that family
// scopes a promoted Source Fact that technical-requirement-engine.mjs consumes
// as authoritative profile evidence.
//
// Both call sites now use the one shared, governance-gated loader
// (current-evidence-scope.mjs :: governedRequirementSubclauseCandidates), so
// this module stays independent of engineering-knowledge-api.mjs's route wiring
// while the AUTHORITY RULE can no longer exist in two versions.
const subclauseCandidates = (db, requirement) => governedRequirementSubclauseCandidates(db, requirement);

// Resolves the requirement's governed equipment family. First tries the
// requirement's own text in single-entity mode (buildFireAlarmTaxonomyContext's
// default) -- if that resolves to exactly one family, done. A requirement
// whose own text names no family (a common, real pattern -- continuation
// sentences like req_196's bare "Features: a)...") falls back to the same
// nearest-preceding-family-header walk suggestLinks already uses
// (resolveNearestFamilyContext over subclauseCandidates), reusing the real
// extraction_version_id/clause_id structure, never guessing. More than one
// distinct family from the requirement's own text is treated as ambiguous,
// not resolved by picking one.
const resolveGovernedFamily = async (db, requirement) => {
  const direct = buildFireAlarmTaxonomyContext({ description: requirement.original_text, system: requirement.system, category: requirement.category });
  const distinctDirect = [...new Set(direct.families.map((entry) => entry.family))];
  if (distinctDirect.length === 1) return { family: distinctDirect[0], category: direct.families[0].category, basis: "OWN_TEXT", ambiguous: false };
  if (distinctDirect.length > 1) return { family: null, category: null, basis: "OWN_TEXT", ambiguous: true };
  const candidates = await subclauseCandidates(db, requirement);
  const nearest = resolveNearestFamilyContext(candidates);
  if (!nearest) return { family: null, category: null, basis: "NONE", ambiguous: false };
  return { family: nearest.family, category: nearest.category, basis: "NEAREST_CONTEXT", sourceSequence: nearest.sourceSequence, ambiguous: false };
};

const gateResult = (gate, name, pass, reason) => ({ gate, name, pass, reason });

/**
 * Evaluate every structured requirement_attributes/requirement_standards
 * row belonging to one requirement for Source Fact promotion eligibility.
 * Pure evaluation -- no writes. Mirrors the shape (db, {id, activeExtractionVersionId})
 * -> evaluation already established by evaluateSpecRequirementAutoConfirmation,
 * without sharing any code with it.
 */
export const evaluateSourceFactCandidate = async (db, { requirementId, activeExtractionVersionId }) => {
  // Gate 5 was previously satisfiable by its own absence: `!activeExtractionVersionId
  // || ...` made the lineage check pass unconditionally whenever the caller
  // supplied no id, and `batchPromoteSourceFacts` -- the only production caller
  // -- omitted it. The requirement is now read through the canonical
  // currentness authority, so a stale requirement is not merely flagged but
  // never loaded, and an id mismatch is a hard failure rather than a soft skip.
  //
  // MVP-CLOSE-14: the canonical DOWNSTREAM-ELIGIBILITY contract is applied in
  // the same statement, not left to the caller or to a downstream filter.
  //
  // CURRENCY IS NOT ELIGIBILITY. This read previously enforced currentness only,
  // so a Needs Review / Pending Approval / Rejected requirement -- current
  // evidence, but never authorized to carry engineering authority -- was
  // evaluated and promoted exactly like an approved one. MVP-CLOSE-13 proved
  // this minted a governed Source Fact from an unreviewed row in every variant.
  // A promoted fact is not inert: technical-requirement-engine.mjs consumes
  // Active Source Facts as authoritative technicalFacts, and
  // technical-requirement-api.mjs folds them into both the profile and its
  // input_fingerprint, so an unreviewed row could reach matching that way.
  //
  // Gating the LOAD rather than adding a gate number keeps the failure honest:
  // an ineligible requirement is indistinguishable from one that does not exist,
  // so no caller can read an `eligible: true` verdict off non-authoritative
  // evidence, and the promotion scan below can no longer select it at all.
  const requirement = await db
    .prepare(`SELECT r.* FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.id=? AND ${currentTechnicalRequirementEligibleForEngineeringPredicate("r")}`)
    .bind(requirementId)
    .first();
  if (!requirement) {
    return { requirementId, candidates: [], reason: "Requirement not found, no longer current evidence, or not approved for downstream engineering authority" };
  }

  const gates = [];
  const hasCondition = Boolean(String(requirement.condition || "").trim());
  const hasException = Boolean(String(requirement.exception || "").trim());
  const currentExtraction = !activeExtractionVersionId || requirement.extraction_version_id === activeExtractionVersionId;
  const nonProjectDomain = NON_PROJECT_DOMAINS.has(String(requirement.engineering_domain || "").trim());

  gates.push(gateResult(5, "active_extraction", currentExtraction, currentExtraction ? "Requirement is from the active extraction version" : "Requirement is from a stale/superseded extraction version"));
  gates.push(gateResult(9, "project_source_evidence", !nonProjectDomain, nonProjectDomain ? `Requirement domain "${requirement.engineering_domain}" is manufacturer/product evidence, not project evidence` : "Requirement is project-source Specification evidence"));

  const family = await resolveGovernedFamily(db, requirement);
  gates.push(gateResult(1, "unambiguous_subject", !family.ambiguous && Boolean(family.family), family.ambiguous ? "Requirement text names more than one equipment family" : family.family ? `Subject resolves to ${family.family} (${family.basis})` : "No governed equipment family could be resolved for this requirement or its clause context"));

  gates.push(gateResult(7, "not_conditional", !(hasCondition || hasException), (hasCondition || hasException) ? "Requirement has an unresolved condition or exception" : "No unresolved condition or exception"));

  const structurallyEligible = gates.every((gate) => gate.pass);

  const [attributes, standards] = await Promise.all([
    db.prepare("SELECT * FROM requirement_attributes WHERE requirement_id=?").bind(requirementId).all(),
    db.prepare("SELECT * FROM requirement_standards WHERE requirement_id=?").bind(requirementId).all(),
  ]);

  const candidates = [];
  const seen = new Set();
  for (const attribute of attributes.results || []) {
    if (!ATTRIBUTE_PREDICATES.has(attribute.name)) continue;
    const normalizedValue = parseJson(attribute.normalized_value, attribute.normalized_value);
    const dedupeKey = `${attribute.name}:${JSON.stringify(normalizedValue)}`;
    if (seen.has(dedupeKey)) continue; // req_196-shaped duplicate attribute rows within the same requirement
    seen.add(dedupeKey);
    const rerouted = attribute.name === "fixed_temperature_setpoint" && ALTERNATIVE_OPTION_TEXT.test(requirement.original_text || "");
    const predicate = rerouted ? "high_temp_alternative_available" : attribute.name;
    const confidencePass = Number(attribute.confidence) >= MIN_CONFIDENCE;
    const candidateGates = [...gates, gateResult(4, "confidence_threshold", confidencePass, confidencePass ? `Confidence ${attribute.confidence} meets the ${MIN_CONFIDENCE} threshold` : `Confidence ${attribute.confidence} is below the ${MIN_CONFIDENCE} threshold`)];
    candidates.push({
      sourceType: "Requirement Attribute", sourceRowId: attribute.id, predicate, rerouted,
      value: normalizedValue, unit: attribute.normalized_unit || null, confidence: Number(attribute.confidence),
      family: family.family, category: family.category,
      gates: candidateGates, eligible: structurallyEligible && confidencePass,
      reason: structurallyEligible && confidencePass ? "All deterministic gates passed" : candidateGates.find((gate) => !gate.pass)?.reason,
    });
  }
  for (const standard of standards.results || []) {
    const value = { body: standard.body, number: standard.number, part: standard.part || null, year: standard.year || null };
    const dedupeKey = `applicable_standard:${JSON.stringify(value)}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const confidencePass = Number(standard.confidence) >= MIN_CONFIDENCE;
    // R11 Phase 2 repair -- a STANDARD may only be family-scoped when the
    // requirement's OWN text actually names that family.
    //
    // Proven Al Mousa defect: Gate 1 resolves the subject family from the
    // requirement's text OR from the nearest preceding same-clause context
    // (basis NEAREST_CONTEXT). That inheritance is sound for an ATTRIBUTE --
    // the attribute belongs to the thing the clause is about -- but it is
    // unsound for a STANDARD. Real promoted-and-reviewed examples that this
    // gate had wrongly produced in the Al Mousa project:
    //   Detector Base     <- "The entity responsible for performing the contracted services..."
    //   Sounder           <- "Features include: a) Automatic sensitivity adjustment..."
    //   Speaker/Strobe    <- "...two-core BS6387 C.W.Z fire-resistant cables"   (a CABLE standard)
    //   Conventional Detector <- "The UL 268A-listed housing..."                  (UL 268A is the DUCT standard)
    // In each case the standard was attached to a family merely inherited from a
    // neighbouring clause, and the standard does NOT govern that family. Because
    // an applicable_standard fact is consumed as authoritative by
    // technical-requirement-engine.mjs, a wrong one silently satisfies the
    // `standard` readiness gate with a value the project never stated for that
    // family. Requiring OWN_TEXT keeps the genuinely on-point cases (e.g. the
    // "UL521 ... Standard for Heat Detectors" clause -> Heat Detector) and drops
    // the inherited ones. It is a narrowing gate: it can only ever prevent a
    // promotion, never create one.
    const ownTextFamily = family.basis === "OWN_TEXT";
    const candidateGates = [...gates,
      gateResult(4, "confidence_threshold", confidencePass, confidencePass ? `Confidence ${standard.confidence} meets the ${MIN_CONFIDENCE} threshold` : `Confidence ${standard.confidence} is below the ${MIN_CONFIDENCE} threshold`),
      gateResult(10, "standard_subject_in_own_text", ownTextFamily, ownTextFamily
        ? `Requirement's own text names ${family.family}, so the standard is scoped to a subject it actually governs`
        : `Standard is scoped to ${family.family || "no family"} inherited from ${family.basis === "NEAREST_CONTEXT" ? "the nearest preceding clause context" : "no governed subject"} rather than the requirement's own text; a standard must not be attributed to a family it does not govern`)];
    candidates.push({
      sourceType: "Requirement Standard", sourceRowId: standard.id, predicate: "applicable_standard", rerouted: false,
      value, unit: null, confidence: Number(standard.confidence),
      family: family.family, category: family.category,
      gates: candidateGates, eligible: structurallyEligible && confidencePass && ownTextFamily,
      reason: structurallyEligible && confidencePass && ownTextFamily ? "All deterministic gates passed" : candidateGates.find((gate) => !gate.pass)?.reason,
    });
  }

  return {
    requirementId, projectId: requirement.project_id, extractionVersionId: requirement.extraction_version_id,
    sourceDocumentId: requirement.source_document_id, originalText: requirement.original_text,
    source: parseJson(requirement.source_location, {}), family, candidates, policyVersion: SOURCE_FACT_PROMOTION_POLICY_VERSION,
  };
};

const naturalFactId = (projectId, scopeType, scopeId, predicate) => `fact_source_${slug(projectId)}_${slug(scopeType)}_${slug(scopeId)}_${slug(predicate)}`;

/**
 * Promote one eligible candidate: create (or find) its natural-key fact,
 * add provenance, or open a conflict when a different value already exists
 * for the same natural key. Never creates status="Active", never overwrites
 * an existing fact's value.
 */
export const promoteSourceFact = async (db, { evaluation, candidate, actorUserId }) => {
  if (!candidate.eligible) return { success: false, reason: candidate.reason, skipped: true };
  const projectId = evaluation.projectId;
  const scopeType = "Product Family";
  const scopeId = candidate.family;
  const factId = naturalFactId(projectId, scopeType, scopeId, candidate.predicate);
  const stamp = now();

  const existing = await db.prepare("SELECT * FROM engineering_facts WHERE id=?").bind(factId).first();
  const newValueJson = JSON.stringify({ value: candidate.value, unit: candidate.unit });

  if (existing) {
    const existingValueJson = existing.value;
    if (existingValueJson === newValueJson) {
      // Same fact, additional supporting evidence -- add provenance only
      // (idempotent: a second identical run for the same source requirement
      // must not add a second provenance row for the same source).
      const alreadyRecorded = await db.prepare("SELECT id FROM engineering_fact_provenance WHERE fact_id=? AND source_id=?").bind(factId, evaluation.requirementId).first();
      if (alreadyRecorded) return { success: true, factId, created: false, provenanceAdded: false, deduplicated: true };
      await writeProvenance(db, { factId, evaluation, candidate, actorUserId });
      return { success: true, factId, created: false, provenanceAdded: true, deduplicated: true };
    }
    // Conflicting value for the same natural key -- never overwrite, never
    // auto-select. Open (or reuse) a blocking conflict; the existing fact
    // is left exactly as it was.
    const existingConflict = await db.prepare(
      "SELECT id FROM engineering_knowledge_conflicts WHERE project_id=? AND left_entity_id=? AND right_entity_id=? AND resolution_status='Open'",
    ).bind(projectId, factId, candidate.sourceRowId).first();
    if (existingConflict) return { success: false, factId, conflict: true, conflictId: existingConflict.id, deduplicated: true };
    const conflictId = id("knowledgeConflict");
    await db.prepare(
      "INSERT INTO engineering_knowledge_conflicts (id, project_id, conflict_type, left_entity_type, left_entity_id, right_entity_type, right_entity_id, left_value, right_value, severity, impact, blocking, resolution_status, evidence) VALUES (?, ?, 'Source Fact Value Conflict', 'Engineering Fact', ?, ?, ?, ?, ?, 'High', 'Two current project Specification sources state different values for the same technical fact; neither is selected automatically.', 1, 'Open', ?)",
    ).bind(
      conflictId, projectId, factId, candidate.sourceType, candidate.sourceRowId, existingValueJson, newValueJson,
      JSON.stringify([{ requirementId: evaluation.requirementId, sourceRowId: candidate.sourceRowId, policyVersion: SOURCE_FACT_PROMOTION_POLICY_VERSION }]),
    ).run();
    return { success: false, factId, conflict: true, conflictId };
  }

  await db.prepare(
    "INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, version_number, changed_by, model_version) VALUES (?, ?, 'Technical Requirement', ?, ?, ?, 'Text', 'Equal', 'Source Fact', ?, ?, 'Pending Review', ?, 1, ?, ?)",
  ).bind(
    factId, projectId, evaluation.requirementId, candidate.predicate, newValueJson,
    scopeType, scopeId, candidate.confidence, actorUserId, SOURCE_FACT_PROMOTION_POLICY_VERSION,
  ).run();
  await writeProvenance(db, { factId, evaluation, candidate, actorUserId });
  return { success: true, factId, created: true, provenanceAdded: true, deduplicated: false };
};

const writeProvenance = async (db, { factId, evaluation, candidate, actorUserId }) => {
  const source = evaluation.source || {};
  await db.prepare(
    "INSERT INTO engineering_fact_provenance (id, fact_id, source_type, source_id, document_id, extraction_version_id, page, page_to, section, clause, original_text, rule_version, confidence, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id("factProvenance"), factId, candidate.sourceType, evaluation.requirementId, evaluation.sourceDocumentId, evaluation.extractionVersionId,
    source.pageFrom || source.page || null, source.pageTo || null, source.section || null, source.clause || null,
    evaluation.originalText || null, SOURCE_FACT_PROMOTION_POLICY_VERSION, candidate.confidence, actorUserId,
  ).run();
};

/**
 * Scan every current technical_requirements row for a project and promote
 * every deterministically eligible Source Fact candidate. Pure orchestration
 * over evaluateSourceFactCandidate + promoteSourceFact -- idempotent (see
 * their own dedup/provenance-dedup behavior).
 */
/**
 * Scan every CURRENT technical_requirements row for a project and promote every
 * deterministically eligible Source Fact candidate. Pure orchestration over
 * evaluateSourceFactCandidate + promoteSourceFact -- idempotent (see their own
 * dedup/provenance-dedup behavior).
 *
 * The scan used to resolve ONE project-wide extraction id from
 * `specification_extraction_jobs ... status='Completed' ORDER BY completed_at
 * DESC LIMIT 1` and then filter `extraction_version_id = that`. That lookup is
 * not an authority: the jobs table has no `superseded_at` column, the job's
 * status says nothing about whether its extraction version still governs, and a
 * project-wide LIMIT 1 silently stopped promoting document A's requirements once
 * document B's job finished later. The scan is now driven by
 * CURRENT_TECHNICAL_REQUIREMENT_SQL itself, so it covers every document in the
 * project and cannot promote a requirement that is not current evidence.
 */
export const batchPromoteSourceFacts = async (db, projectId, { activeExtractionVersionId = null, actorUserId } = {}) => {
  // MVP-CLOSE-14: the scan is now restricted to requirements that actually hold
  // engineering authority. It previously selected the whole current set with no
  // review filter, which is what let an unreviewed row reach promotion. The
  // predicate is the canonical one, so the scan and the per-row evaluator can
  // never disagree about what is eligible.
  const requirements = await db.prepare(
    `SELECT r.id, r.extraction_version_id FROM ${currentTechnicalRequirementsFrom("r")} WHERE r.project_id=? AND ${currentTechnicalRequirementEligibleForEngineeringPredicate("r")} ORDER BY r.id`,
  ).bind(projectId).all();
  const rows = requirements.results || [];
  if (!rows.length) {
    return { totalScanned: 0, candidateFacts: 0, promoted: 0, deduplicated: 0, conflicts: 0, skipped: 0, failed: 0, skipReasonCounts: {}, policyVersion: SOURCE_FACT_PROMOTION_POLICY_VERSION, activeExtractionVersionId, note: "No current specification requirements exist for this project" };
  }

  let candidateFacts = 0, promoted = 0, deduplicated = 0, conflicts = 0, skipped = 0, failed = 0;
  const skipReasonCounts = {};
  const results = [];

  for (const row of rows) {
    // An explicitly supplied expectation is honoured where it applies; per-row
    // currency is the default, so gate 5 is never vacuous.
    const expected = activeExtractionVersionId || row.extraction_version_id;
    const evaluation = await evaluateSourceFactCandidate(db, { requirementId: row.id, activeExtractionVersionId: expected });
    for (const candidate of evaluation.candidates) {
      candidateFacts += 1;
      if (!candidate.eligible) {
        skipped += 1;
        skipReasonCounts[candidate.reason] = (skipReasonCounts[candidate.reason] || 0) + 1;
        continue;
      }
      try {
        const result = await promoteSourceFact(db, { evaluation, candidate, actorUserId });
        results.push({ requirementId: row.id, predicate: candidate.predicate, ...result });
        if (result.conflict) { conflicts += 1; continue; }
        if (!result.success) { failed += 1; continue; }
        if (result.deduplicated) deduplicated += 1; else promoted += 1;
      } catch (error) {
        failed += 1;
        results.push({ requirementId: row.id, predicate: candidate.predicate, success: false, error: error.message });
      }
    }
  }

  return { totalScanned: rows.length, candidateFacts, promoted, deduplicated, conflicts, skipped, failed, skipReasonCounts, policyVersion: SOURCE_FACT_PROMOTION_POLICY_VERSION, activeExtractionVersionId, results };
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const id2 = (prefix) => `${prefix}_${crypto.randomUUID()}`;
// Same ownership-scoping shape used throughout this codebase (see
// worker/engineering-knowledge-api.mjs's own ownedProject, worker/
// specification-extraction-api.mjs's own ownedProject) -- one
// server-controlled identity per environment (application-context.mjs), so
// "authorized" means "owns this project," exactly like every other governed
// action in this repository. No parallel role framework.
const ownedProject = (db, projectId, userId) => db.prepare("SELECT * FROM projects WHERE id=? AND owner_user_id=? AND archived_at IS NULL").bind(projectId, userId).first();

// ---------------------------------------------------------------------------
// Slice 2 -- Confirmation Governance
//
// Authority state machine for fact_type='Source Fact' rows only (never
// Supplier Claim, Manufacturer Rule, Human Decision, or any other fact
// type -- every query below filters on fact_type explicitly, not by
// convention): Pending Review -> Active, or Pending Review -> Rejected.
// Supersession remains the existing engineering_facts versioning columns'
// job, untouched here. No new states invented.
//
// No prior production code reviews/activates/rejects engineering_facts at
// all (confirmed by inspection of worker/engineering-knowledge-api.mjs --
// its only engineering_knowledge_decisions writers are for 'BOQ Requirement
// Link' and 'Technical Requirement' entities, never 'Engineering Fact'), so
// this reuses that same governance PATTERN (guarded UPDATE ... WHERE
// status=?, one engineering_knowledge_decisions row entity_type='Engineering
// Fact', one document_audit_events row, MIN_GOVERNED_REASON_LENGTH-gated
// reason) rather than inventing a parallel one.
// ---------------------------------------------------------------------------

export const SOURCE_FACT_PREDICATE_LABELS = Object.freeze({
  fixed_temperature_setpoint: "Fixed temperature",
  rate_of_rise_sensitivity: "Rate of rise",
  applicable_standard: "Applicable standard",
  protocol_compatibility: "Protocol compatibility",
  base_architecture: "Base architecture",
  // Deliberately phrased as an existence statement, never a chosen-value
  // statement -- the UI can only ever render what this server-computed
  // label says, so it structurally cannot claim 190°F was picked for the
  // project when all that is actually known is that the option exists.
  high_temp_alternative_available: "High-temperature alternative available",
});

const formatFactValue = (predicate, parsedValue) => {
  const raw = parsedValue?.value;
  if (predicate === "applicable_standard" && raw && typeof raw === "object") {
    return [raw.body, raw.number].filter(Boolean).join(" ") + (raw.part ? ` Part ${raw.part}` : "");
  }
  if (Array.isArray(raw)) return raw.join(", ");
  return raw == null ? "" : String(raw);
};

const loadSourceFact = (db, factId) => db.prepare("SELECT * FROM engineering_facts WHERE id=? AND fact_type='Source Fact'").bind(factId).first();
const blockingConflictFor = (db, projectId, factId) => db.prepare(
  "SELECT id FROM engineering_knowledge_conflicts WHERE project_id=? AND (left_entity_id=? OR right_entity_id=?) AND resolution_status='Open' AND blocking=1",
).bind(projectId, factId, factId).first();
const provenanceCountFor = async (db, factId) => Number((await db.prepare("SELECT COUNT(*) c FROM engineering_fact_provenance WHERE fact_id=?").bind(factId).first())?.c || 0);

// THE missing authority in the whole confirmation path. `confirmSourceFact`
// gated on fact_type, ownership, status, provenance count and blocking
// conflict -- and on NOTHING about whether the fact's own source evidence is
// still current. That is reachable end to end: a fact promoted from extraction
// E1 sits at 'Pending Review'; the invalidators only ever touched
// `status = 'Active'`, so superseding E1 left the Pending Review row untouched;
// the engineer then confirmed it to 'Active', and
// technical-requirement-api's loadActiveSourceFacts -- which also has no lineage
// join -- fed it straight into buildTechnicalRequirementProfile, a persisted,
// approved-for-matching input, and onward into BOM and pricing.
//
// The check joins engineering_fact_provenance through the requirement to the
// canonical currentness authority, so it asks the real question: does this fact
// still have at least one source that IS current evidence? A fact with a
// non-extraction provenance (a datasheet, a calibration) legitimately has none,
// so that case is reported as such rather than silently treated as stale.
const sourceFactCurrentness = async (db, factId) => {
  const extractionBacked = await db.prepare(
    `SELECT efp.extraction_version_id AS extractionVersionId, efp.source_id AS sourceId
       FROM engineering_fact_provenance efp
      WHERE efp.fact_id = ?
        AND efp.extraction_version_id IS NOT NULL
        AND EXISTS (SELECT 1 FROM specification_extraction_versions sev WHERE sev.id = efp.extraction_version_id)`,
  ).bind(factId).all();
  const provenances = extractionBacked.results || [];
  if (!provenances.length) return { verdict: "no-extraction-provenance", staleSourceIds: [] };
  const staleSourceIds = [];
  for (const provenance of provenances) {
    const current = await db.prepare(
      `SELECT 1 AS ok FROM specification_extraction_versions sev
        JOIN ${currentTechnicalRequirementsFrom("r")} ON r.extraction_version_id = sev.id
       WHERE sev.id = ? AND r.id = ?`,
    ).bind(provenance.extractionVersionId, provenance.sourceId).first();
    if (!current) staleSourceIds.push({ sourceId: provenance.sourceId, extractionVersionId: provenance.extractionVersionId });
  }
  return { verdict: staleSourceIds.length === provenances.length ? "all-stale" : staleSourceIds.length ? "partially-stale" : "current", staleSourceIds };
};

const writeFactDecision = (db, { projectId, factId, action, previous, next, reason, fact, actorUserId, actorRole }) => db.batch([
  db.prepare(
    "INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, decided_by, decided_role) VALUES (?, ?, 'Engineering Fact', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id2("knowledgeDecision"), projectId, factId, action, JSON.stringify(previous), JSON.stringify(next), reason,
    JSON.stringify({ predicate: fact.predicate, policyVersion: SOURCE_FACT_PROMOTION_POLICY_VERSION }), fact.scope_type, fact.scope_id, actorUserId, actorRole || "Unknown",
  ),
  db.prepare(
    "INSERT INTO document_audit_events (id, project_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(
    id2("audit"), projectId, actorUserId, `Specification Source Fact ${action === "confirm" ? "Confirmed" : "Rejected"}`,
    JSON.stringify(previous), JSON.stringify({ ...next, factId }), reason, id2("request"),
  ),
]);

/**
 * Pending Review -> Active for exactly one Source Fact. Refuses (never
 * silently activates) a stale/conflicted/ineligible fact. Idempotent: an
 * already-Active fact is a safe no-op (no duplicate decision/audit row);
 * any other non-Pending-Review state is an explicit, reported failure.
 */
export const confirmSourceFact = async (db, { factId, expectedProjectId = null, reason, actorUserId, actorRole }) => {
  const fact = await loadSourceFact(db, factId);
  if (!fact) return { success: false, code: "SOURCE_FACT_NOT_FOUND" };
  if (expectedProjectId && fact.project_id !== expectedProjectId) return { success: false, code: "SOURCE_FACT_NOT_FOUND" };
  if (fact.status === "Active") return { success: true, idempotent: true, fact, factId };
  if (fact.status !== "Pending Review") return { success: false, code: "SOURCE_FACT_NOT_PENDING", fact, factId };

  const provenanceCount = await provenanceCountFor(db, factId);
  if (provenanceCount === 0) return { success: false, code: "SOURCE_FACT_PROVENANCE_MISSING", fact, factId };
  // Fail closed on stale source evidence. A fact whose every extraction-backed
  // provenance has stopped being current evidence must not be promoted to
  // authoritative, and the refusal names the sources so the operator can act.
  const currentness = await sourceFactCurrentness(db, factId);
  if (currentness.verdict === "all-stale") {
    return { success: false, code: "SOURCE_FACT_SOURCE_NOT_CURRENT", fact, factId, staleSourceIds: currentness.staleSourceIds };
  }
  const conflict = await blockingConflictFor(db, fact.project_id, factId);
  if (conflict) return { success: false, code: "SOURCE_FACT_CONFLICT_BLOCKING", fact, factId, conflictId: conflict.id };

  const stamp = now();
  const updated = await db.prepare("UPDATE engineering_facts SET status='Active', changed_by=?, effective_from=? WHERE id=? AND status='Pending Review'").bind(actorUserId, stamp, factId).run();
  const changed = Number(updated?.changes ?? updated?.meta?.changes ?? 0);
  if (changed === 0) {
    // Lost a race to a concurrent writer -- report the real current state
    // rather than claim success for a transition that did not happen.
    const current = await loadSourceFact(db, factId);
    return current?.status === "Active"
      ? { success: true, idempotent: true, fact: current, factId }
      : { success: false, code: "SOURCE_FACT_STATE_CHANGED", fact: current, factId };
  }
  await writeFactDecision(db, { projectId: fact.project_id, factId, action: "confirm", previous: { status: "Pending Review" }, next: { status: "Active" }, reason, fact, actorUserId, actorRole });
  return { success: true, idempotent: false, fact: { ...fact, status: "Active" }, factId };
};

/**
 * Pending Review -> Rejected for exactly one Source Fact. Never deletes the
 * fact or its provenance. Idempotent: an already-Rejected fact is a safe
 * no-op. Rejecting an Active fact is refused, not silently accepted --
 * rejection only ever applies to a fact that never became authoritative.
 */
export const rejectSourceFact = async (db, { factId, expectedProjectId = null, reason, actorUserId, actorRole }) => {
  const fact = await loadSourceFact(db, factId);
  if (!fact) return { success: false, code: "SOURCE_FACT_NOT_FOUND" };
  if (expectedProjectId && fact.project_id !== expectedProjectId) return { success: false, code: "SOURCE_FACT_NOT_FOUND" };
  if (fact.status === "Rejected") return { success: true, idempotent: true, fact, factId };
  if (fact.status !== "Pending Review") return { success: false, code: "SOURCE_FACT_NOT_PENDING", fact, factId };

  const stamp = now();
  const updated = await db.prepare("UPDATE engineering_facts SET status='Rejected', changed_by=?, effective_from=? WHERE id=? AND status='Pending Review'").bind(actorUserId, stamp, factId).run();
  const changed = Number(updated?.changes ?? updated?.meta?.changes ?? 0);
  if (changed === 0) {
    const current = await loadSourceFact(db, factId);
    return current?.status === "Rejected"
      ? { success: true, idempotent: true, fact: current, factId }
      : { success: false, code: "SOURCE_FACT_STATE_CHANGED", fact: current, factId };
  }
  await writeFactDecision(db, { projectId: fact.project_id, factId, action: "reject", previous: { status: "Pending Review" }, next: { status: "Rejected" }, reason, fact, actorUserId, actorRole });
  return { success: true, idempotent: false, fact: { ...fact, status: "Rejected" }, factId };
};

// Bounded, explicit-ids-only batch confirm -- "confirm every Pending Review
// fact in the project without showing them" is never implemented; the
// caller must submit the exact ids it showed the engineer. Partial-success
// (matches this repository's own batch precedent: batchAutoConfirmSpecRequirements
// and batchPromoteSourceFacts above are both independent-per-item, not
// all-or-nothing) -- one ineligible id never blocks the other eligible ones,
// and each id is validated with the exact same rules confirmSourceFact uses
// for a single fact.
const MAX_BATCH_IDS = 50;
export const batchConfirmSourceFacts = async (db, projectId, { factIds, reason, actorUserId, actorRole }) => {
  const ids = [...new Set((Array.isArray(factIds) ? factIds : []).map(String).filter(Boolean))].slice(0, MAX_BATCH_IDS);
  const results = [];
  let confirmed = 0, alreadyActive = 0, blocked = 0, failed = 0;
  for (const factId of ids) {
    const result = await confirmSourceFact(db, { factId, expectedProjectId: projectId, reason, actorUserId, actorRole });
    results.push({ factId, ...result });
    if (result.success && result.idempotent) alreadyActive += 1;
    else if (result.success) confirmed += 1;
    else if (result.code === "SOURCE_FACT_CONFLICT_BLOCKING") blocked += 1;
    else failed += 1;
  }
  return { requested: (Array.isArray(factIds) ? factIds : []).length, evaluated: ids.length, confirmed, alreadyActive, blocked, failed, results };
};

/**
 * Minimal, project-scoped read model for the UI's compact Source Fact list.
 * Never returns raw provenance JSON -- only a bounded, compact source
 * summary (document/page/section) and a count.
 */
export const listPendingSourceFacts = async (db, projectId) => {
  // `status<>'Superseded'` admitted 'Rejected' rows into a read model whose
  // route is presented to the engineer as the pending-review list, so a fact
  // that had already been refused was offered for confirmation again. The
  // route states the population it serves, so the query now states it too.
  const facts = await db.prepare("SELECT * FROM engineering_facts WHERE project_id=? AND fact_type='Source Fact' AND status='Pending Review' ORDER BY scope_id, predicate").bind(projectId).all();
  const rows = facts.results || [];
  const out = [];
  for (const fact of rows) {
    const [provenance, sourceCount, conflict, currentness] = await Promise.all([
      db.prepare("SELECT document_id, page, section, clause FROM engineering_fact_provenance WHERE fact_id=? ORDER BY created_at LIMIT 5").bind(fact.id).all(),
      provenanceCountFor(db, fact.id),
      blockingConflictFor(db, projectId, fact.id),
      sourceFactCurrentness(db, fact.id),
    ]);
    const parsedValue = parseJson(fact.value, {});
    out.push({
      factId: fact.id,
      predicate: fact.predicate,
      label: SOURCE_FACT_PREDICATE_LABELS[fact.predicate] || fact.predicate,
      value: formatFactValue(fact.predicate, parsedValue),
      unit: parsedValue?.unit || null,
      scopeType: fact.scope_type,
      scopeId: fact.scope_id,
      confidence: fact.confidence,
      status: fact.status,
      sourceCount,
      // Surfaced so the UI can show a real blocker BEFORE the engineer
      // attempts a confirmation the server will refuse. This is the same
      // check confirmSourceFact enforces; reporting it here is what makes the
      // governance state visible instead of merely enforced.
      sourceCurrency: currentness.verdict,
      staleSourceIds: currentness.staleSourceIds,
      confirmable: currentness.verdict !== "all-stale",
      sources: (provenance.results || []).map((entry) => ({ documentId: entry.document_id, page: entry.page, section: entry.section, clause: entry.clause })),
      hasBlockingConflict: Boolean(conflict),
    });
  }
  return out;
};

const errorForConfirmCode = (code) => ({
  SOURCE_FACT_NOT_FOUND: [{ code, message: "Source Fact not found." }, 404],
  SOURCE_FACT_NOT_PENDING: [{ code, message: "Only a Pending Review Source Fact can be confirmed or rejected through this route." }, 409],
  SOURCE_FACT_PROVENANCE_MISSING: [{ code, message: "This Source Fact has no current supporting evidence and cannot be confirmed." }, 409],
  SOURCE_FACT_SOURCE_NOT_CURRENT: [{ code, message: "This Source Fact's source requirements are no longer current evidence, so it cannot be confirmed. Re-extract the governing document version and promote the fact again." }, 409],
  SOURCE_FACT_CONFLICT_BLOCKING: [{ code, message: "This Source Fact has an open blocking conflict and cannot be confirmed until it is resolved." }, 409],
  SOURCE_FACT_STATE_CHANGED: [{ code, message: "This Source Fact's state changed before this request completed." }, 409],
}[code] || [{ code: code || "SOURCE_FACT_REQUEST_FAILED", message: "The Source Fact request could not be completed." }, 422]);

/**
 * All governed Source Fact HTTP operations. Wired directly into
 * worker/index.ts's flat handle*Api(request, env) dispatch chain, matching
 * this repository's real routing convention (a per-domain module handler
 * returning null when the path doesn't match, a Response otherwise).
 *
 *   GET  /api/projects/:id/specification-source-facts            -- read model (Slice 2)
 *   POST /api/projects/:id/specification-source-facts/promote     -- Slice 1, unchanged
 *   POST /api/projects/:id/specification-source-facts/confirm     -- batch confirm (Slice 2)
 *   POST /api/engineering-facts/:id/confirm                       -- single confirm (Slice 2)
 *   POST /api/engineering-facts/:id/reject                        -- single reject (Slice 2)
 *
 * Confirm/reject never touch technical_requirements review state, never
 * create boq_requirement_links, never regenerate a Requirement Profile,
 * never run Matching/BOM/Pricing -- Slice 3's job, not this one's.
 */
export async function handleSpecSourceFactApi(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.includes("/specification-source-facts") && !url.pathname.includes("/engineering-facts/")) return null;
  if (!env.DB) return json({ error: { code: "SOURCE_FACT_ENGINE_UNAVAILABLE", message: "Source Fact storage is unavailable." } }, 503);
  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);

  const listMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/specification-source-facts$/);
  if (listMatch && request.method === "GET") {
    const project = await ownedProject(env.DB, decodeURIComponent(listMatch[1]), user.id);
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    return json({ project: project.id, facts: await listPendingSourceFacts(env.DB, project.id) });
  }

  const promoteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/specification-source-facts\/promote$/);
  if (promoteMatch && request.method === "POST") {
    const project = await ownedProject(env.DB, decodeURIComponent(promoteMatch[1]), user.id);
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (reason.length < MIN_GOVERNED_REASON_LENGTH) return json({ error: { code: "SOURCE_FACT_PROMOTION_REASON_REQUIRED", message: "Provide a substantive reason for running deterministic Source Fact promotion." } }, 422);

    const batch = await batchPromoteSourceFacts(env.DB, project.id, { actorUserId: user.id });

    // Minimal audit adapter, same convention used throughout this codebase
    // (see worker/specification-extraction-api.mjs's auto-confirm route,
    // suggestLinks/publishApprovedEngineeringKnowledge in
    // engineering-knowledge-api.mjs): one document_audit_events row per newly
    // created fact (carrying enough to reconstruct project/fact/scope/
    // predicate/value/source/policyVersion/actor/timestamp), plus one
    // run-level summary event. engineering_knowledge_conflicts already
    // carries the per-conflict record, written by promoteSourceFact itself.
    const created = (batch.results || []).filter((entry) => entry.success && entry.created);
    const auditStatements = created.map((entry) => env.DB.prepare(
      "INSERT INTO document_audit_events (id, project_id, document_id, version_id, actor_user_id, action, old_value, new_value, reason, request_id) SELECT ?, ?, r.source_document_id, e.document_version_id, ?, 'Specification Source Fact Promoted', NULL, ?, ?, ? FROM technical_requirements r JOIN specification_extraction_versions e ON e.id=r.extraction_version_id WHERE r.id=?",
    ).bind(
      id2("audit"), project.id, user.id,
      JSON.stringify({ factId: entry.factId, predicate: entry.predicate, requirementId: entry.requirementId, policyVersion: SOURCE_FACT_PROMOTION_POLICY_VERSION }),
      reason, id2("request"), entry.requirementId,
    ));
    for (let index = 0; index < auditStatements.length; index += 60) await env.DB.batch(auditStatements.slice(index, index + 60));
    await env.DB.prepare("INSERT INTO document_audit_events (id, project_id, actor_user_id, action, new_value, reason, request_id) VALUES (?, ?, ?, 'Specification Source Facts Promotion Run', ?, ?, ?)").bind(
      id2("audit"), project.id, user.id,
      JSON.stringify({ totalScanned: batch.totalScanned, candidateFacts: batch.candidateFacts, promoted: batch.promoted, deduplicated: batch.deduplicated, conflicts: batch.conflicts, skipped: batch.skipped, failed: batch.failed, policyVersion: SOURCE_FACT_PROMOTION_POLICY_VERSION }),
      reason, id2("request"),
    ).run();

    return json({ project: project.id, policyVersion: SOURCE_FACT_PROMOTION_POLICY_VERSION, totalScanned: batch.totalScanned, candidateFacts: batch.candidateFacts, promoted: batch.promoted, deduplicated: batch.deduplicated, conflicts: batch.conflicts, skipped: batch.skipped, failed: batch.failed, skipReasonCounts: batch.skipReasonCounts, note: batch.note || null }, 201);
  }

  const batchConfirmMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/specification-source-facts\/confirm$/);
  if (batchConfirmMatch && request.method === "POST") {
    const project = await ownedProject(env.DB, decodeURIComponent(batchConfirmMatch[1]), user.id);
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (reason.length < MIN_GOVERNED_REASON_LENGTH) return json({ error: { code: "SOURCE_FACT_CONFIRM_REASON_REQUIRED", message: "Provide a substantive reason for confirming these Source Facts." } }, 422);
    // Explicit ids only -- "confirm every Pending Review fact in the project
    // without showing them" is never accepted.
    if (!Array.isArray(body.factIds) || !body.factIds.length) return json({ error: { code: "SOURCE_FACT_IDS_REQUIRED", message: "Submit the exact Source Fact ids being confirmed." } }, 422);
    const batch = await batchConfirmSourceFacts(env.DB, project.id, { factIds: body.factIds, reason, actorUserId: user.id, actorRole: user.role });
    return json({ project: project.id, ...batch }, 201);
  }

  const singleMatch = url.pathname.match(/^\/api\/engineering-facts\/([^/]+)\/(confirm|reject)$/);
  if (singleMatch && request.method === "POST") {
    const factId = decodeURIComponent(singleMatch[1]);
    const operation = singleMatch[2];
    // Ownership is resolved through the fact's own project (the URL only
    // names the fact), same "owns the project" boundary as every other
    // governed route in this codebase.
    const owned = await env.DB.prepare(
      "SELECT f.id FROM engineering_facts f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND f.fact_type='Source Fact' AND p.owner_user_id=?",
    ).bind(factId, user.id).first();
    if (!owned) return json({ error: { code: "SOURCE_FACT_NOT_FOUND", message: "Source Fact not found." } }, 404);
    const body = await request.json().catch(() => ({}));
    const reason = String(body.reason || "").trim();
    if (reason.length < MIN_GOVERNED_REASON_LENGTH) return json({ error: { code: "SOURCE_FACT_REVIEW_REASON_REQUIRED", message: `Provide a substantive reason to ${operation} this Source Fact.` } }, 422);
    const result = operation === "confirm"
      ? await confirmSourceFact(env.DB, { factId, reason, actorUserId: user.id, actorRole: user.role })
      : await rejectSourceFact(env.DB, { factId, reason, actorUserId: user.id, actorRole: user.role });
    if (!result.success) { const [error, status] = errorForConfirmCode(result.code); return json({ error }, status); }
    return json({ factId: result.factId, status: result.fact?.status, idempotent: Boolean(result.idempotent) });
  }

  return null;
}
