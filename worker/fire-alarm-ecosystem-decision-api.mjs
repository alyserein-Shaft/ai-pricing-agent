// PERSISTED PROJECT FIRE ALARM ECOSYSTEM DECISION -- worker read/write side.
//
// This is the ONLY module that queries the ecosystem decision. Every consumer
// goes through `resolveProjectFireAlarmEcosystemDecision`; no consumer
// re-implements the SQL. The domain model, validation, write planning and
// policy bridging all live in app/domain/fire-alarm-ecosystem-decision.mjs,
// which performs no database access.
//
// Storage reuses `engineering_knowledge_decisions` exactly as it exists in
// drizzle-active/0000 and in the live database. No migration, no new table,
// no new column. The table already carries project_id, entity_type, entity_id,
// action, previous_value, new_value, reason, evidence, scope_type, scope_id,
// reversible, reverses_decision_id, decided_by, decided_role, decided_at --
// verified field-by-field against both DDL sources before this was written.

import {
  CONTRACT_AUTHORITY_ITEMS,
  ECOSYSTEM_DECISION_ENTITY_TYPE,
  ECOSYSTEM_DECISION_ACTIONS,
  EcosystemDecisionError,
  evaluateProjectEcosystemPolicy,
  normalizePersistedEcosystemDecision,
  planEcosystemDecisionWrite,
  projectEcosystemCompatibilityEntry,
  selectCurrentEcosystemDecision,
  validateProjectFireAlarmEcosystemDecision,
} from "../app/domain/fire-alarm-ecosystem-decision.mjs";
import { applicationActor, resolveApplicationContext } from "./application-context.mjs";
import {
  buildEcosystemRequirementBasis,
  classifyEcosystemCompatibility,
  ecosystemBasisRelationships,
} from "../app/domain/fire-alarm-ecosystem-requirement-basis.mjs";

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// ---------------------------------------------------------------------------
// READ -- the single canonical resolver for the CURRENT project Fire Alarm
// ecosystem decision.
//
// Current means: the newest decision for this project that has not itself been
// reversed by a later one. Lineage is followed through reverses_decision_id
// rather than inferred from a timestamp, so a decision recorded out of
// chronological order still resolves deterministically.
// ---------------------------------------------------------------------------
export const loadEcosystemDecisionRows = async (db, projectId) => {
  const all = (await db
    .prepare(
      "SELECT id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, reversible, reverses_decision_id, decided_by, decided_role, decided_at FROM engineering_knowledge_decisions WHERE project_id=? AND entity_type=? ORDER BY decided_at ASC, id ASC",
    )
    .bind(projectId, ECOSYSTEM_DECISION_ENTITY_TYPE)
    .all()).results || [];
  return all;
};

export const resolveProjectFireAlarmEcosystemDecision = async (db, projectId) => {
  const rows = await loadEcosystemDecisionRows(db, projectId);
  if (!rows.length) return null;

  const byId = new Map(rows.map((row) => [row.id, row]));
  // A decision is superseded when some OTHER record in this project's lineage
  // points at it through reverses_decision_id.
  const reversed = new Set(rows.map((row) => row.reverses_decision_id).filter(Boolean));
  const current = rows.filter((row) => !reversed.has(row.id));

  // A reversal that points at a decision which is not in this project/system's
  // lineage means the record set is inconsistent. Refuse rather than guess.
  for (const row of rows) {
    if (row.reverses_decision_id && !byId.has(row.reverses_decision_id)) {
      throw new EcosystemDecisionError(
        "ECOSYSTEM_DECISION_LINEAGE_BROKEN",
        `Fire Alarm ecosystem decision ${row.id} supersedes ${row.reverses_decision_id}, which is not present in this project's decision lineage. The governed state is treated as absent.`,
      );
    }
  }

  return selectCurrentEcosystemDecision(current);
};

// Convenience read for consumers that must not fail closed silently on a
// malformed record: returns the decision only when it is fully governed.
export const currentEcosystemCompatibilityEntry = async (db, projectId) => {
  const current = await resolveProjectFireAlarmEcosystemDecision(db, projectId);
  return projectEcosystemCompatibilityEntry(current);
};

// ---------------------------------------------------------------------------
// SLICE 2B INTEGRATION SEAM.
//
// `loadEcosystemRequirementBasis` is the ONE call a consumer needs. It is the
// only sanctioned way for the governed ecosystem decision to reach the restored
// Technical Requirement Engine, and it is deliberately the whole integration:
//
//   const basisRelationships = await loadEcosystemRequirementBasis(db, projectId);
//   buildTechnicalRequirementProfile({ boqItem, relationships: [
//     ...relationships,
//     ...basisRelationships,          // <-- the entire Slice 2B wiring
//   ] });
//
// WHY IT IS AN ARRAY AND NOT A SINGLE OBJECT: with no governed decision this
// returns []. Spreading [] is a no-op, so the engine's own `compatibilityTarget`
// predicate keeps failing closed exactly as it does before Slice 2B. There is no
// code path here that can relax, replace or second-guess that predicate -- the
// engine remains its sole authority.
//
// The returned relationship names a real target and is marked
// `productCompatibilityClaimed: false`. It states a project REQUIREMENT BASIS.
// It is not a product compatibility proof, not a match, and not a selection.
// ---------------------------------------------------------------------------
export const loadEcosystemRequirementBasis = async (db, projectId) => {
  const current = await resolveProjectFireAlarmEcosystemDecision(db, projectId);
  return ecosystemBasisRelationships(current);
};

// Full basis record, for consumers that need the authority detail (the API
// response, review surfaces) rather than just the engine input.
export const loadEcosystemBasisRecord = async (db, projectId) => {
  const current = await resolveProjectFireAlarmEcosystemDecision(db, projectId);
  return buildEcosystemRequirementBasis(current);
};

// Candidate classification against the governed basis. Returns a fail-closed
// verdict; it never returns a match.
export const loadEcosystemCandidateClassification = async (db, projectId, candidate) => {
  const current = await resolveProjectFireAlarmEcosystemDecision(db, projectId);
  return classifyEcosystemCompatibility(current, candidate);
};

// ---------------------------------------------------------------------------
// WRITE -- governed, validated, lineage-preserving, never a silent overwrite.
// ---------------------------------------------------------------------------
export const recordFireAlarmEcosystemDecision = async (db, { projectId, actor, input }) => {
  const candidate = validateProjectFireAlarmEcosystemDecision({
    ...input,
    decidedBy: input.decidedBy || actor.id,
    decidedRole: input.decidedRole || actor.role,
  });

  const current = await resolveProjectFireAlarmEcosystemDecision(db, projectId);
  const plan = planEcosystemDecisionWrite({ current, candidate });

  if (plan.mode === "idempotent") {
    return { mode: "idempotent", decisionId: plan.decisionId, decision: current.decision, reason: plan.reason };
  }

  const decisionId = id("ecosystemDecision");
  const stamp = now();
  await db.batch([
    db
      .prepare(
        "INSERT INTO engineering_knowledge_decisions (id, project_id, entity_type, entity_id, action, previous_value, new_value, reason, evidence, scope_type, scope_id, reversible, reverses_decision_id, decided_by, decided_role, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)",
      )
      .bind(
        decisionId,
        projectId,
        ECOSYSTEM_DECISION_ENTITY_TYPE,
        projectId,
        plan.action,
        plan.previousValue ? JSON.stringify(plan.previousValue) : null,
        JSON.stringify(candidate),
        candidate.reason,
        JSON.stringify({ evidence: candidate.evidence, specificationVersion: candidate.specificationVersion, contractUncertainty: candidate.contractUncertainty }),
        "Project",
        projectId,
        plan.reversesDecisionId,
        candidate.decidedBy,
        candidate.decidedRole,
        stamp,
      ),
    db
      .prepare(
        "INSERT INTO document_audit_events (id, project_id, actor_user_id, action, old_value, new_value, reason, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        id("audit"),
        projectId,
        candidate.decidedBy,
        plan.mode === "supersede" ? "Fire Alarm Ecosystem Decision Superseded" : "Fire Alarm Ecosystem Decision Recorded",
        JSON.stringify(plan.previousValue || {}),
        JSON.stringify({ decisionId, ecosystem: candidate.ecosystem, protocols: candidate.protocols, complianceBasisState: candidate.complianceBasisState, supersedes: plan.reversesDecisionId }),
        candidate.reason,
        id("request"),
      ),
  ]);

  return { mode: plan.mode, decisionId, action: plan.action, supersedes: plan.reversesDecisionId, decision: candidate, decidedAt: stamp };
};

// ---------------------------------------------------------------------------
// ROUTE -- registered in worker/index.ts immediately after the requirement
// engine this decision feeds. Endpoints:
//   GET  /api/projects/:id/fire-alarm/ecosystem
//   POST /api/projects/:id/fire-alarm/ecosystem
//   POST /api/projects/:id/fire-alarm/ecosystem/classify   (read-only verdict)
// GET 404s with ECOSYSTEM_DECISION_REQUIRED when no governed decision exists --
// that is the fail-closed signal, not a server fault. POST 409s on any governed
// refusal. Fire Alarm projects only; another system domain is 409
// ECOSYSTEM_DECISION_SYSTEM_SCOPE.
// ---------------------------------------------------------------------------
export const handleFireAlarmEcosystemDecisionApi = async (request, env) => {
  const url = new URL(request.url);
  if (!url.pathname.includes("/fire-alarm/ecosystem")) return null;
  if (!env.DB) return json({ error: { code: "ECOSYSTEM_DECISION_STORAGE_UNAVAILABLE", message: "Ecosystem decision storage is unavailable." } }, 503);

  const resolved = await resolveApplicationContext(request, env);
  if (resolved.error) return json({ error: resolved.error }, resolved.error.status);
  const user = applicationActor(resolved.context);

  // NOTE the regexes below are anchored and end at the resource, so the
  // `/classify` sub-resource matches its OWN pattern and does NOT fall through
  // the read/write projectMatch (which would then return null and drop it).
  const classifyMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/fire-alarm\/ecosystem\/classify$/);
  if (classifyMatch && request.method === "POST") {
    const projectId = decodeURIComponent(classifyMatch[1]);
    const project = await env.DB.prepare("SELECT id, system_domain FROM projects WHERE id=? AND owner_user_id=? AND archived_at IS NULL").bind(projectId, user.id).first();
    if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);
    if (project.system_domain !== "Fire Alarm") {
      return json({ error: { code: "ECOSYSTEM_DECISION_SYSTEM_SCOPE", message: "A project Fire Alarm ecosystem decision applies only to a Fire Alarm project." } }, 409);
    }
    // Exists so the eligibility rules the basis encodes are actually REACHABLE
    // by a downstream consumer, rather than existing only as an unused export.
    // Strictly read-only: it classifies a candidate against the ALREADY-RECORDED
    // decision and never records, approves or matches anything. A project with
    // no governed decision answers every candidate with NO_GOVERNED_DECISION,
    // i.e. fail-closed -- the same posture the requirement engine takes.
    const body = await request.json().catch(() => ({}));
    const candidate = body?.candidate && typeof body.candidate === "object" ? body.candidate : {};
    const verdict = await loadEcosystemCandidateClassification(env.DB, projectId, candidate);
    return json({
      verdict,
      // Restated at the boundary: an eligibility verdict is never a match.
      productCompatibilityClaimed: false,
      compatibilityTargetSatisfiedByThis: false,
      scope: { type: "Project", id: projectId, system: "Fire Alarm", projectId },
    });
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/fire-alarm\/ecosystem$/);
  if (!projectMatch) return null;
  const projectId = decodeURIComponent(projectMatch[1]);
  const project = await env.DB.prepare("SELECT id, system_domain FROM projects WHERE id=? AND owner_user_id=? AND archived_at IS NULL").bind(projectId, user.id).first();
  if (!project) return json({ error: { code: "PROJECT_NOT_FOUND", message: "Project not found." } }, 404);

  // Fire-Alarm scope only. This decision has no meaning on another system.
  if (project.system_domain !== "Fire Alarm") {
    return json({ error: { code: "ECOSYSTEM_DECISION_SYSTEM_SCOPE", message: "A project Fire Alarm ecosystem decision applies only to a Fire Alarm project." } }, 409);
  }

  try {
    if (request.method === "GET") {
      const current = await resolveProjectFireAlarmEcosystemDecision(env.DB, projectId);
      if (!current) return json({ error: { code: "ECOSYSTEM_DECISION_REQUIRED", message: "No governed project Fire Alarm ecosystem decision exists. Technical requirements remain fail-closed until one is recorded." } }, 404);
      return json({
        decision: current.decision,
        decisionId: current.id,
        action: current.action,
        decidedBy: current.decision.decidedBy,
        decidedRole: current.decision.decidedRole,
        decidedAt: current.decidedAt,
        supersedes: current.reversesDecisionId,
        evidence: current.evidence,
        scope: { type: current.scopeType, id: current.scopeId, system: "Fire Alarm", projectId },
        // The two-part answer the system can truthfully give.
        technicalDesignBasis: {
          ecosystem: current.decision.ecosystem,
          ecosystemState: current.decision.ecosystemState,
          newDesignProtocol: current.decision.primaryProtocol,
          selectedProtocolMode: current.decision.selectedProtocolMode,
          allowedLegacyProtocols: current.decision.allowedLegacyProtocols,
          preliminaryPanelFamily: current.decision.preliminaryPanelFamily,
        },
        stillUnresolved: {
          contractualManufacturerAcceptance: current.decision.contractualManufacturerAcceptance,
          ul864GoverningEdition: current.decision.complianceBasis.unresolved.find((entry) => entry.field === "ul864GoverningEdition")?.state,
          substitutionAuthority: current.decision.substitutionAuthority,
          proposedSubstitutionState: current.decision.proposedSubstitutionState,
          contractAuthorityItems: current.decision.contractualItems || CONTRACT_AUTHORITY_ITEMS,
        },
        projectCompatibilityEntry: projectEcosystemCompatibilityEntry(current),
        policyEvaluation: evaluateProjectEcosystemPolicy(current),
        // The exact engine input, and the truthfulness contract that travels
        // with it. A client can see precisely what was contributed to
        // requirement generation and, just as importantly, what was NOT.
        requirementBasis: buildEcosystemRequirementBasis(current),
        productCompatibilityClaimed: false,
      });
    }

    if (request.method === "POST") {
      const body = await request.json();
      const result = await recordFireAlarmEcosystemDecision(env.DB, { projectId, actor: user, input: body || {} });
      return json({ decision: result.decision, decisionId: result.decisionId, mode: result.mode, supersedes: result.supersedes || null, decidedAt: result.decidedAt || null, reason: result.reason || null }, result.mode === "idempotent" ? 200 : 201);
    }
  } catch (error) {
    if (error instanceof EcosystemDecisionError) {
      return json({ error: { code: error.code, message: error.message } }, 409);
    }
    throw error;
  }

  return json({ error: { code: "METHOD_NOT_ALLOWED", message: "Use GET or POST." } }, 405);
};
