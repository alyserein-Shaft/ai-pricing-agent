/**
 * MVP-CLOSE-16 -- governed review and promotion of requirement candidates.
 *
 * A REQUIREMENT_CANDIDATE is a clause the admission policy deliberately did not
 * admit (MVP-CLOSE-11/13). It lives ONLY on specification_clauses: no
 * technical_requirements row, no link, no profile authority, no matching
 * authority. This module adds the missing half -- a governed decision that turns
 * one into a real technical requirement, or records that a reviewer declined it.
 *
 * THREE SEPARATE DECISIONS, NEVER MERGED
 * --------------------------------------
 *   1. Admission      -- did extraction emit a requirement?  (extractor, unchanged)
 *   2. Promotion      -- should this candidate become a requirement row?  (here)
 *   3. Approval       -- may that requirement carry engineering authority?  (the
 *                        existing governed route, untouched)
 *
 * A promoted requirement is created with the SAME `review_status` the extractor
 * itself would have produced -- "Needs Review" or "Pending Approval", never
 * "Approved" -- and `approved_for_downstream` is left at its DDL default of 0.
 * Promotion therefore confers NO downstream authority. The engineer who promotes
 * has made a different decision from the engineer who approves, and may be a
 * different person on a different day. Merging them would make the requirement
 * review queue disagree with the extractor's own long-standing invariant that a
 * freshly extracted requirement is never Approved.
 *
 * DETERMINISTIC EQUIVALENCE
 * -------------------------
 * The requirement is built by `analyzeRequirementSentence` from
 * app/domain/specification-extractor.mjs -- the SAME construction the admission
 * loop uses, factored out verbatim in MVP-CLOSE-16. Promotion does not re-derive
 * a single attribute, standard, manufacturer, compatibility target, accessory or
 * ambiguity with a second implementation, and it never invents one. A clause
 * with no compatibility target promotes with no compatibility target, which is
 * why a promoted duct-detector candidate does NOT satisfy a compatibility
 * blocker that genuinely requires one.
 *
 * CANDIDATE IDENTITY
 * ------------------
 * Decisions bind to (clause_id, extraction_version_id), both foreign keys, and
 * never to raw text, page number or sequence. `clause_id` alone says nothing
 * about which extraction produced it, so a decision taken against a superseded
 * extraction cannot silently apply to a later re-extraction. currency is
 * re-proven at decision time through the canonical current-extraction contract.
 *
 * IDEMPOTENCY AND CONCURRENCY
 * ---------------------------
 * Repeat same-decision is a deterministic no-op. A conflicting decision is an
 * explicit, honest conflict rather than a silent overwrite. Two concurrent
 * Promotes cannot produce two requirements: the schema's partial UNIQUE index on
 * (clause_id) WHERE decision='Promoted' makes the second insert impossible, and
 * the whole decision is one transaction so a refusal writes nothing.
 */
import { analyzeRequirementSentence, CLAUSE_ADMISSION_CANDIDATE, SPEC_PARSER_VERSION, SPEC_MODEL_VERSION } from "../app/domain/specification-extractor.mjs";
import { isPersistableCompatibilityEntry } from "../app/domain/compatibility-vocabulary.mjs";
import { currentSpecificationExtractionFrom } from "./current-evidence-scope.mjs";
import { MIN_GOVERNED_REASON_LENGTH } from "./reason-governance.mjs";

export const CANDIDATE_DECISION_PROMOTED = "Promoted";
export const CANDIDATE_DECISION_REJECTED = "Rejected";
export const CANDIDATE_DECISIONS = Object.freeze([CANDIDATE_DECISION_PROMOTED, CANDIDATE_DECISION_REJECTED]);

const json = (value) => JSON.stringify(value ?? null);
const parseJson = (value, fallback = null) => { try { return value == null ? fallback : JSON.parse(value); } catch { return fallback; } };
const newId = (prefix) => `${prefix}_${crypto.randomUUID()}`;

// The four measured candidate mechanisms, mirrored as a set purely so a
// decision record can be validated against what the extractor may have written.
// This is a validator, never a classifier: promotion never decides that a clause
// "looks like" a requirement.
const CANDIDATE_MECHANISMS = new Set(["PASSIVE_PRESENT", "FUTURE_REQUIREMENT", "IMPERATIVE", "CAPABILITY"]);

/**
 * A candidate decision's governed error shape. `code` is stable and is what a
 * caller branches on; `message` is operator-facing.
 */
export class CandidateDecisionError extends Error {
  constructor(code, message, status = 409, extra = {}) {
    super(message);
    this.name = "CandidateDecisionError";
    this.code = code;
    this.status = status;
    Object.assign(this, extra);
  }
}

/**
 * THE AUTHORITY GATE for candidate decisions.
 *
 * A candidate is reviewable only when ALL of the following hold, and this is
 * the single place that decides it:
 *
 *   - the project is owned by the acting user (the same server-derived
 *     `ownedProject` rule every other specification route uses);
 *   - the clause row exists and still says REQUIREMENT_CANDIDATE. A clause that
 *     was admitted, or is merely NOT_ADMITTED, is not a candidate;
 *   - the extraction version is CURRENT for its document, proven through the
 *     canonical current-extraction contract rather than a hand-typed
 *     `superseded_at IS NULL`. A decision against retired evidence fails closed.
 *
 * The join through `currentSpecificationExtractionFrom` also proves the document
 * version is governing and the project is not archived, which is exactly the
 * currency a promotion must not skip.
 */
export const loadReviewableCandidate = async (db, { clauseId, projectId, userId }) => {
  // NOTE: specification_extraction_versions has no project_id column -- the
  // project is reached through documents, and the canonical current-extraction
  // contract already joins documents. So ownership and project scope are proven
  // through that same join rather than through a column that does not exist.
  const row = await db
    .prepare(
      `SELECT c.id AS clause_id, c.extraction_version_id, c.sequence AS clause_sequence, c.kind, c.number, c.title,
              c.page_from, c.page_to, c.path, c.original_text, c.admission_status, c.admitted_requirement_count,
              c.non_admission_reason, c.candidate_mechanism,
              e.document_id, e.document_version_id, e.version_number AS extraction_version_number,
              e.parser_version, e.ruleset_version, e.model_version, e.prompt_version, e.ocr_version,
              d.project_id, p.name AS project_name, p.system_domain
         FROM specification_clauses c
         JOIN ${currentSpecificationExtractionFrom("e")} ON e.id = c.extraction_version_id
         JOIN documents d ON d.id = e.document_id
         JOIN projects p ON p.id = d.project_id AND p.archived_at IS NULL
        WHERE c.id = ? AND d.project_id = ? AND p.owner_user_id = ?`,
    )
    .bind(clauseId, projectId, userId)
    .first();

  if (!row) {
    // One message for "not yours", "not current", and "does not exist" is
    // deliberate: distinguishing them would leak whether a clause id exists in
    // a project the caller does not own.
    throw new CandidateDecisionError("CANDIDATE_NOT_CURRENT", "This candidate is not current, reviewable evidence for a project you own. Re-extract the document version to produce current candidates.", 409);
  }
  if (row.admission_status !== CLAUSE_ADMISSION_CANDIDATE) {
    throw new CandidateDecisionError("CANDIDATE_NOT_REVIEWABLE", `This clause is recorded as ${row.admission_status ?? "unrecorded"}, not ${CLAUSE_ADMISSION_CANDIDATE}. Only a REQUIREMENT_CANDIDATE clause can be decided.`, 409);
  }
  return row;
};

/**
 * The review queue (Phase 11). Read-only.
 *
 * Lists every current REQUIREMENT_CANDIDATE for a project together with the
 * full text, source identity, mechanism, and any decision already recorded --
 * including whether that decision produced a requirement. This is a REVIEW
 * surface, so it deliberately does NOT apply the CLOSE-14 eligibility predicate:
 * hiding a candidate because it has not been approved is precisely backwards.
 */
export const listCandidateReviewQueue = async (db, { projectId, userId, limit = 200 } = {}) => {
  // Ownership is proven FIRST, before any project data is read, so a caller who
  // does not own the project learns nothing about its candidates.
  const project = await db.prepare("SELECT id FROM projects WHERE id=? AND owner_user_id=? AND archived_at IS NULL").bind(projectId, userId).first();
  if (!project) throw new CandidateDecisionError("PROJECT_NOT_FOUND", "Project not found.", 404);

  const rows = await db
    .prepare(
      `SELECT c.id, c.extraction_version_id, c.sequence, c.kind, c.number, c.title, c.page_from, c.page_to,
              c.path, c.original_text, c.non_admission_reason, c.candidate_mechanism,
              e.document_id, e.document_version_id, e.version_number AS extraction_version_number,
              d.logical_name AS document_name,
              (SELECT group_concat(x.decision, '|') FROM specification_clause_candidate_decisions x WHERE x.clause_id = c.id) AS decisions,
              (SELECT x.requirement_id FROM specification_clause_candidate_decisions x WHERE x.clause_id = c.id AND x.decision = 'Promoted' LIMIT 1) AS requirement_id,
              (SELECT x.decided_by FROM specification_clause_candidate_decisions x WHERE x.clause_id = c.id ORDER BY x.decided_at DESC, x.id DESC LIMIT 1) AS last_decided_by,
              (SELECT x.decided_at FROM specification_clause_candidate_decisions x WHERE x.clause_id = c.id ORDER BY x.decided_at DESC, x.id DESC LIMIT 1) AS last_decided_at,
              (SELECT COUNT(*) FROM technical_requirements r WHERE r.clause_id = c.id) AS existing_requirement_count
         FROM specification_clauses c
         JOIN ${currentSpecificationExtractionFrom("e")} ON e.id = c.extraction_version_id
         JOIN documents d ON d.id = e.document_id
        WHERE d.project_id = ? AND c.admission_status = ?
        ORDER BY e.document_id, c.sequence
        LIMIT ?`,
    )
    .bind(projectId, CLAUSE_ADMISSION_CANDIDATE, Math.min(500, Math.max(1, Number(limit) || 200)))
    .all();

  return (rows.results || []).map((row) => ({
    candidateId: row.id,
    clauseSequence: row.sequence,
    extractionVersionId: row.extraction_version_id,
    extractionVersionNumber: row.extraction_version_number,
    documentId: row.document_id,
    documentName: row.document_name,
    documentVersionId: row.document_version_id,
    kind: row.kind,
    number: row.number,
    title: row.title,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    path: parseJson(row.path, []),
    originalText: row.original_text,
    candidateMechanism: row.candidate_mechanism,
    nonAdmissionReason: row.non_admission_reason,
    admissionStatus: row.admission_status,
    decisions: row.decisions ? String(row.decisions).split("|") : [],
    requirementId: row.requirement_id || null,
    lastDecidedBy: row.last_decided_by || null,
    lastDecidedAt: row.last_decided_at || null,
    // Surfaced so a reviewer can see that a promoted candidate now has a real
    // requirement behind it, without having to query the requirement table.
    existingRequirementCount: Number(row.existing_requirement_count || 0),
  }));
};

/**
 * Rebuild the extractor-domain clause shape from the PERSISTED clause row.
 *
 * `strictNormativeParent` is not stored, but it is DERIVED -- strictNormativeParentSignal
 * reads only `kind`, `title` and the hierarchy `path`, all three of which ARE
 * persisted. Recomputing it is therefore exact, not an approximation, and is what
 * lets a promoted requirement match what admission would have produced.
 */
const clauseShapeFor = (row) => {
  const path = parseJson(row.path, []) || [];
  return {
    number: row.number,
    title: row.title,
    kind: row.kind,
    pageFrom: row.page_from,
    pageTo: row.page_to,
    path,
    text: row.original_text,
    sequence: row.clause_sequence,
    strictNormativeParent: ["Article", "Clause"].includes(row.kind)
      && /\bPRODUCTS\b/i.test(path[2] || "")
      && /\bshall\b|\bmust\b|\brequired\b|\bprovide\b|\bcomply\b/i.test(row.title || ""),
  };
};

/**
 * Phase 6 + 7 -- materialization.
 *
 * Builds the deterministic requirement representation and returns the statements
 * that persist it, using the SAME column mapping and the SAME child-table
 * filtering as the extraction persistence path (worker/specification-extraction-background.mjs
 * :: persistChunkEntities). Nothing is invented: manufacturer scope/conditions/
 * product_family stay NULL, compatibility conditions/exceptions stay NULL, and
 * accessory quantity_rule stays NULL, exactly as extraction writes them.
 *
 * `approved_for_downstream` is deliberately absent from the INSERT, so the DDL
 * default 0 applies. That is the Phase 5 guarantee expressed in schema terms.
 */
export const buildPromotionStatements = (db, { candidate, requirement, requirementId, extractionMethod = "candidate-promotion" }) => {
  const current = {
    normalizedRequirement: requirement.normalizedRequirement,
    requirementType: requirement.requirementType,
    requirementCategory: requirement.requirementCategory,
    domain: requirement.domain?.value,
    category: requirement.category,
    condition: requirement.condition,
    exception: requirement.exception,
  };
  const statements = [];
  statements.push(db.prepare("INSERT OR IGNORE INTO technical_requirements (id,extraction_version_id,project_id,source_document_id,clause_id,sequence,source_revision,original_text,normalized_requirement,engineering_domain,domain_source_type,system,category,subcategory,requirement_type,requirement_category,condition,exception,confidence,confidence_state,review_status,extraction_method,parser_version,model_version,source_location,original_values,current_values) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
    requirementId, candidate.extraction_version_id, candidate.project_id, candidate.document_id, candidate.clause_id, candidate.clause_sequence,
    null, requirement.originalText, requirement.normalizedRequirement, requirement.domain?.value || "Unknown", requirement.domain?.sourceType || "Explicit",
    requirement.system, requirement.category, requirement.subcategory, requirement.requirementType, requirement.requirementCategory,
    requirement.condition, requirement.exception, requirement.confidence, requirement.confidenceState, requirement.reviewStatus,
    extractionMethod, SPEC_PARSER_VERSION, SPEC_MODEL_VERSION, json(requirement.source), json(requirement), json(current),
  ));
  statements.push(db.prepare("INSERT OR IGNORE INTO requirement_evidence (id,extraction_version_id,requirement_id,evidence_type,source_location,original_text,extraction_method,confidence) VALUES (?,?,?,'Source Clause',?,?,?,?)").bind(
    `${requirementId}_evidence`, candidate.extraction_version_id, requirementId, json(requirement.source), requirement.originalText, extractionMethod, requirement.confidence,
  ));
  for (let item = 0; item < (requirement.attributes || []).length; item += 1) {
    const value = requirement.attributes[item];
    statements.push(db.prepare("INSERT OR IGNORE INTO requirement_attributes (id,requirement_id,name,operator,original_value,parsed_value,original_unit,normalized_value,normalized_unit,confidence,source_location) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(`${requirementId}_attribute_${item + 1}`, requirementId, value.name, value.operator, value.originalValue, json(value.parsedValue), value.originalUnit, json(value.normalizedValue), value.normalizedUnit, value.confidence, json(requirement.source)));
  }
  for (let item = 0; item < (requirement.standards || []).length; item += 1) {
    const value = requirement.standards[item];
    statements.push(db.prepare("INSERT OR IGNORE INTO requirement_standards (id,requirement_id,body,number,part,year,original_text,status,confidence) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${requirementId}_standard_${item + 1}`, requirementId, value.body, value.number, value.part, value.year, value.originalText, value.status, value.confidence));
  }
  for (let item = 0; item < (requirement.manufacturers || []).length; item += 1) {
    const value = requirement.manufacturers[item];
    statements.push(db.prepare("INSERT OR IGNORE INTO requirement_manufacturers (id,requirement_id,manufacturer,status,scope,conditions,product_family,confidence) VALUES (?,?,?,?,NULL,NULL,NULL,?)").bind(`${requirementId}_manufacturer_${item + 1}`, requirementId, value.manufacturer, value.status, value.confidence));
  }
  const persistableCompatibility = (requirement.compatibility || []).filter(isPersistableCompatibilityEntry);
  for (let item = 0; item < persistableCompatibility.length; item += 1) {
    const value = persistableCompatibility[item];
    statements.push(db.prepare("INSERT OR IGNORE INTO requirement_compatibility (id,requirement_id,source_item,target_item,relationship_type,conditions,exceptions,mandatory,confidence) VALUES (?,?,?,?,?,NULL,NULL,?,?)").bind(`${requirementId}_compatibility_${item + 1}`, requirementId, value.sourceItem, value.targetItem, value.type, value.mandatory ? 1 : 0, value.confidence));
  }
  for (let item = 0; item < (requirement.accessories || []).length; item += 1) {
    const value = requirement.accessories[item];
    statements.push(db.prepare("INSERT OR IGNORE INTO requirement_accessories (id,requirement_id,accessory,source_type,quantity_rule,confidence) VALUES (?,?,?,?,NULL,?)").bind(`${requirementId}_accessory_${item + 1}`, requirementId, value.accessory, value.sourceType, value.confidence));
  }
  for (let item = 0; item < (requirement.ambiguities || []).length; item += 1) {
    const value = requirement.ambiguities[item];
    statements.push(db.prepare("INSERT OR IGNORE INTO requirement_ambiguities (id,extraction_version_id,requirement_id,original_text,reason,technical_impact,commercial_impact,clarification_question,blocking) VALUES (?,?,?,?,?,?,?,?,?)").bind(`${requirementId}_ambiguity_${item + 1}`, candidate.extraction_version_id, requirementId, value.originalText, value.why, value.technicalImpact, value.commercialImpact, value.clarificationQuestion, value.blocking ? 1 : 0));
  }
  return statements;
};

/**
 * Derive the requirement a promoted candidate should become, WITHOUT writing
 * anything. Exposed separately so promotion equivalence can be asserted directly
 * against what the admission path would have produced.
 */
export const derivePromotedRequirement = (candidate, { candidateSystems = [] } = {}) => {
  const clause = clauseShapeFor(candidate);
  const analyzed = analyzeRequirementSentence({
    sentence: candidate.original_text,
    clause,
    candidateSystems,
  });
  // The admission gate is deliberately NOT consulted. Promotion is a human
  // decision to admit a clause the automated policy declined, and refusing here
  // would make the whole workflow a no-op for exactly the clauses it exists to
  // rescue. What the gate protected against -- a clause that is not a requirement
  // at all -- is now a human judgement, recorded with a reason and an actor.
  return analyzed.build(1);
};

/**
 * The single governed write. Transactional, idempotent, and honest about
 * conflicts.
 */
export const decideSpecificationCandidate = async (db, {
  projectId, clauseId, userId, decision, reason, evidence = null, candidateSystems = [],
}) => {
  if (!CANDIDATE_DECISIONS.includes(decision)) {
    throw new CandidateDecisionError("CANDIDATE_DECISION_INVALID", `decision must be one of ${CANDIDATE_DECISIONS.join(", ")}.`, 422);
  }
  // Phase 2: a substantive human reason is required for BOTH decisions, not just
  // Reject. Promotion is the decision that creates a governed requirement row, so
  // it is at least as much a judgement as rejection and is recorded identically.
  // The threshold is the SHARED constant, never a literal: tests/reason-governance-consolidation.test.mjs
  // exists precisely to stop the governed reason length drifting per route.
  const trimmedReason = String(reason ?? "").trim();
  if (trimmedReason.length < MIN_GOVERNED_REASON_LENGTH) {
    throw new CandidateDecisionError("CANDIDATE_REASON_REQUIRED", "Provide a substantive reason naming why this candidate is promoted or rejected.", 422);
  }

  const candidate = await loadReviewableCandidate(db, { clauseId, projectId, userId });

  const existing = (await db
    .prepare("SELECT id, decision, requirement_id, decided_by, decided_at, reason FROM specification_clause_candidate_decisions WHERE clause_id=? ORDER BY decided_at ASC, id ASC")
    .bind(clauseId).all()).results || [];

  const priorSame = existing.find((row) => row.decision === decision);
  if (priorSame) {
    // Idempotent repeat: report the ORIGINAL outcome rather than creating a
    // second row, so a retried request is observably a no-op.
    return {
      idempotent: true,
      decision,
      candidateId: clauseId,
      requirementId: priorSame.requirement_id || null,
      decidedBy: priorSame.decided_by,
      decidedAt: priorSame.decided_at,
      requirement: priorSame.requirement_id
        ? await db.prepare("SELECT * FROM technical_requirements WHERE id=?").bind(priorSame.requirement_id).first()
        : null,
    };
  }
  const priorOther = existing.find((row) => row.decision !== decision);
  if (priorOther) {
    // No governed reversal exists in this model: a decision is immutable and a
    // reversal would be a NEW decision on a NEW extraction. Say so plainly
    // rather than silently overwriting, and name the prior decision so the
    // operator knows what they are contradicting.
    throw new CandidateDecisionError(
      "CANDIDATE_DECISION_CONFLICT",
      `This candidate was already ${priorOther.decision} by ${priorOther.decided_by}. A candidate decision is immutable and there is no governed reversal, so a contradicting decision must be made against a re-extraction.`,
      409,
      { priorDecision: priorOther.decision, priorRequirementId: priorOther.requirement_id || null },
    );
  }

  const decisionId = newId("speccandidate");
  const decidedAt = new Date().toISOString();
  let requirementId = null;
  let requirement = null;
  const statements = [];

  if (decision === CANDIDATE_DECISION_PROMOTED) {
    requirementId = newId("requirement");
    requirement = derivePromotedRequirement(candidate, { candidateSystems });
    statements.push(...buildPromotionStatements(db, { candidate, requirement, requirementId, extractionMethod: "candidate-promotion" }));
  }

  statements.push(db.prepare("INSERT INTO specification_clause_candidate_decisions (id,clause_id,extraction_version_id,project_id,document_id,document_version_id,decision,candidate_mechanism,non_admission_reason,source_fingerprint,requirement_id,reason,evidence,decided_by,decided_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(
    decisionId, clauseId, candidate.extraction_version_id, projectId, candidate.document_id, candidate.document_version_id,
    decision,
    candidate.candidate_mechanism && CANDIDATE_MECHANISMS.has(candidate.candidate_mechanism) ? candidate.candidate_mechanism : null,
    candidate.non_admission_reason || null,
    // Provenance only. The extraction's own parser/ruleset/model/prompt/ocr
    // versions plus the clause text bound this decision to the exact engine and
    // evidence that produced the candidate. It is recorded so a later reviewer
    // can tell "the same evidence re-extracted" from "different evidence"; it is
    // NEVER used to match one decision onto another.
    [candidate.parser_version, candidate.ruleset_version, candidate.model_version, candidate.prompt_version, candidate.ocr_version, candidate.clause_id].join("|"),
    requirementId, trimmedReason, evidence == null ? null : json(evidence), userId, decidedAt,
  ));

  // A document-level audit row accompanies every decision, mirroring the
  // requirement-review routes, so candidate review is visible in the same audit
  // surface as every other governed specification decision.
  statements.push(db.prepare("INSERT INTO document_audit_events (id,project_id,document_id,version_id,actor_user_id,action,old_value,new_value,reason,request_id) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(
    newId("audit"), projectId, candidate.document_id, candidate.document_version_id, userId,
    `Specification Clause Candidate ${decision}`,
    json({ admissionStatus: candidate.admission_status, candidateMechanism: candidate.candidate_mechanism, decisions: existing.map((row) => row.decision) }),
    json({ decision, requirementId, candidateMechanism: candidate.candidate_mechanism }),
    trimmedReason, newId("request"),
  ));

  // One transaction. If the partial UNIQUE index refuses a racing second
  // promotion, the whole batch rolls back and NOTHING is written -- no orphan
  // decision row, no orphan requirement. That is the database-level guarantee
  // behind "parallel Promote produces exactly one requirement".
  await db.batch(statements);

  const persisted = await db.prepare("SELECT * FROM specification_clause_candidate_decisions WHERE id=?").bind(decisionId).first();
  return {
    idempotent: false,
    decision,
    candidateId: clauseId,
    decisionId: persisted?.id ?? decisionId,
    requirementId,
    decidedBy: userId,
    decidedAt,
    requirement: requirementId ? await db.prepare("SELECT * FROM technical_requirements WHERE id=?").bind(requirementId).first() : null,
  };
};
