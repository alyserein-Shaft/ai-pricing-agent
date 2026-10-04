// Guarded Knowledge Fact -> canonical Product identity repair (persistence).
//
// Stage 3E design implementation. Repairs exactly one eligible outcome:
// REPAIRABLE_NEW_PRODUCT_CANDIDATE. Identity linkage ONLY — never technical
// suitability, discovery, pricing, or costing approval.
//
// Rules enforced here:
// - Fresh Stage 3D resolution immediately before any write; the write layer
//   performs NO independent identity matching.
// - UPDATE of the exact existing link row with an optimistic concurrency guard;
//   never INSERT a second link.
// - new_information merged over prior content with an identity-only boundary.
// - Deterministic idempotent audit event (INSERT OR IGNORE) in the same batch.
// - Zero affected rows -> re-read, re-resolve, classify; never blind-retry,
//   never overwrite a competing target.

import {
  RESOLVER_VERSION,
} from "../app/domain/knowledge-product-identity-resolver.mjs";
import {
  resolveKnowledgeFactProduct,
} from "./knowledge-product-resolver-runtime.mjs";

export const IDENTITY_REPAIR_POLICY_VERSION = "knowledge-identity-policy-v1";
export const IDENTITY_REPAIR_LINK_STATE = "Existing Product — Additive Learning Only";
export const IDENTITY_REPAIR_AUDIT_TYPE = "Knowledge Product Identity Repair";

const parse = (value, fallback = {}) => {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
};

const stamp = () => new Date().toISOString();

const auditIdFor = (linkId, canonicalId) =>
  `knowledgeEvent_identity-repair_${linkId}_${canonicalId}`;

const zeroWrites = () => ({ linkWrites: 0, auditWrites: 0 });

/**
 * Attempt a guarded identity-link repair.
 *
 * db: D1-compatible database (prepare/bind/first/all/run/batch).
 * options: { factId, organizationId, expectedLinkId, expectedTarget, actor? }
 *
 * Returns a plain result object; see design doc Stage 3E. Never throws for
 * eligibility/contention outcomes; batch transport errors are caught and
 * re-classified via re-read (never reported successful unless the re-read
 * row supports the claim).
 */
export const repairKnowledgeProductLink = async (db, {
  factId,
  organizationId,
  expectedLinkId,
  expectedTarget,
  actor = null,
} = {}) => {
  const repairActor = {
    id: actor?.id || "system:knowledge-identity-repair",
    role: actor?.role || actor?.permission || "System",
    context: actor?.context || "identity-repair",
  };

  if (!factId || !organizationId || !expectedLinkId || !expectedTarget) {
    return {
      ok: false,
      outcome: "REPAIR_REFUSED",
      refusalReason: "MISSING_REQUIRED_INPUT",
      writes: zeroWrites(),
    };
  }

  // Fresh resolution: the ONLY source of the canonical target.
  const fresh = await resolveKnowledgeFactProduct(db, { factId, organizationId });
  if (fresh.error) {
    return { ok: false, outcome: fresh.error.code || "RESOLUTION_FAILED", writes: zeroWrites() };
  }
  const { decision, input, links } = fresh;
  if (!decision || decision.outcome !== "REPAIRABLE_NEW_PRODUCT_CANDIDATE") {
    return {
      ok: decision?.outcome === "ALREADY_LINKED",
      outcome: decision?.outcome || "RESOLUTION_FAILED",
      selectedTarget: decision?.selectedTarget || null,
      writes: zeroWrites(),
      decision,
    };
  }

  // Eligibility gates over the fresh decision + collected input.
  const refusal = refuseIfIneligible({ decision, input, organizationId, expectedLinkId, expectedTarget });
  if (refusal) {
    return { ok: false, outcome: "REPAIR_REFUSED", refusalReason: refusal, writes: zeroWrites(), decision };
  }

  const target = decision.selectedTarget;
  const link = input.existingLinks[0];
  const prior = await readLinkRow(db, organizationId, expectedLinkId);
  const previousNewInformation = parse(prior?.new_information, {});
  const repairedAt = stamp();
  const mergedNewInformation = {
    ...previousNewInformation,
    identityRepair: {
      identityDecisionOnly: true,
      technicalSuitabilityEvaluated: false,
      previousLinkState: prior?.link_state || link.linkState,
      previousExistingProductId: prior?.existing_product_id || null,
      canonicalProductId: target,
      originalPartNumber: input.fact?.originalPartNumber || link.partNumber,
      resolverOutcome: decision.outcome,
      reasonCodes: decision.reasonCodes || [],
      manufacturerBasis: decision.evidence?.manufacturerBasis || null,
      comparisonPartNumber: decision.evidence?.factComparison || null,
      searchKeyPartNumber: decision.evidence?.factSearchKey || null,
      canonicalPath: canonicalPathFor(input, target),
      openConflictsChecked: true,
      conflictRefs: input.openIdentityConflicts || [],
      resolverVersion: RESOLVER_VERSION,
      policyVersion: IDENTITY_REPAIR_POLICY_VERSION,
      repairedAt,
      actor: repairActor,
    },
  };

  const factRow = await db
    .prepare("SELECT knowledge_file_id FROM knowledge_facts WHERE id=? AND organization_id=?")
    .bind(factId, organizationId)
    .first();
  if (!factRow) {
    return { ok: false, outcome: "REPAIR_REFUSED", refusalReason: "FACT_NOT_FOUND", writes: zeroWrites(), decision };
  }

  const auditId = auditIdFor(expectedLinkId, target);
  const auditDetails = {
    knowledgeFactId: factId,
    linkId: expectedLinkId,
    previousState: prior?.link_state || link.linkState,
    previousProductId: prior?.existing_product_id || null,
    canonicalTarget: target,
    originalPartNumber: input.fact?.originalPartNumber || link.partNumber,
    resolverOutcome: decision.outcome,
    reasonCodes: decision.reasonCodes || [],
    canonicalPath: canonicalPathFor(input, target),
    manufacturerEvidence: {
      factManufacturer: decision.evidence?.factManufacturer || null,
      manufacturerBasis: decision.evidence?.manufacturerBasis || null,
    },
    comparisonPartNumber: decision.evidence?.factComparison || null,
    searchKeyPartNumber: decision.evidence?.factSearchKey || null,
    conflictCheck: { checked: true, refs: input.openIdentityConflicts || [] },
    resolverVersion: RESOLVER_VERSION,
    policyVersion: IDENTITY_REPAIR_POLICY_VERSION,
    repairedAt,
    actor: repairActor,
    safety: {
      approvedForDiscovery: false,
      costingEligible: false,
      technicalEvaluation: "NOT_PERFORMED",
    },
  };

  const guardedUpdate = db
    .prepare(
      `UPDATE knowledge_product_links
       SET existing_product_id=?, link_state=?, new_information=?
       WHERE id=? AND organization_id=? AND knowledge_fact_id=?
       AND existing_product_id IS NULL AND link_state='New Product Candidate'
       AND part_number=?`,
    )
    .bind(
      target,
      IDENTITY_REPAIR_LINK_STATE,
      JSON.stringify(mergedNewInformation),
      expectedLinkId,
      organizationId,
      factId,
      link.partNumber,
    );
  // Audit causality is established by SQLite changes(): it reports the rows
  // changed by the most recently completed data-change statement on THIS SAME
  // database connection — the guarded UPDATE directly above. changes() is
  // connection-scoped, so a competing writer's already-committed rows can
  // never satisfy it: the audit fires only for THIS invocation's own mutation
  // ((SELECT changes()) = 1), even though the EXISTS integrity check alone
  // (link row carries the fresh target) could be satisfied by a concurrent
  // winner. The audit INSERT must therefore IMMEDIATELY follow the guarded
  // UPDATE inside the same db.batch(); statement order is a correctness
  // requirement, not a convention. (INSERT...SELECT precedent:
  // worker/product-identity-api.mjs.)
  const auditInsert = db
    .prepare(
      `INSERT OR IGNORE INTO knowledge_file_events
       (id, organization_id, knowledge_file_id, event_type, details, actor_user_id)
       SELECT ?,?,?,?,?,?
       WHERE (SELECT changes()) = 1
         AND EXISTS (
           SELECT 1 FROM knowledge_product_links
           WHERE id=? AND organization_id=? AND existing_product_id=?
         )`,
    )
    .bind(
      auditId,
      organizationId,
      factRow.knowledge_file_id,
      IDENTITY_REPAIR_AUDIT_TYPE,
      JSON.stringify(auditDetails),
      repairActor.id,
      expectedLinkId,
      organizationId,
      target,
    );

  let batchResult;
  try {
    batchResult = await db.batch([guardedUpdate, auditInsert]);
  } catch {
    // Transport/audit failure: never claim success unless the re-read row
    // proves the repaired state. (Covers atomic and non-atomic backends.)
    const current = await readLinkRow(db, organizationId, expectedLinkId);
    const applied = Boolean(
      current
      && current.existing_product_id === target
      && current.link_state === IDENTITY_REPAIR_LINK_STATE,
    );
    return {
      ok: applied,
      outcome: applied ? "REPAIRED_UNLOGGED" : "REPAIR_FAILED",
      linkId: expectedLinkId,
      target,
      auditId,
      auditWritten: false,
      writes: zeroWrites(),
      decision,
    };
  }

  if (Number(batchResult?.[0]?.meta?.changes || 0) !== 1) {
    // Zero-row guard: re-read, re-resolve, classify. No blind retry, no overwrite.
    const reFresh = await resolveKnowledgeFactProduct(db, { factId, organizationId });
    const reDecision = reFresh.decision;
    if (reDecision?.outcome === "ALREADY_LINKED") {
      return {
        ok: true,
        outcome: "ALREADY_LINKED",
        linkId: expectedLinkId,
        target: reDecision.selectedTarget,
        writes: zeroWrites(),
        decision: reDecision,
      };
    }
    if (reDecision?.outcome === "EXISTING_LINK_CONFLICT") {
      return {
        ok: false,
        outcome: "EXISTING_LINK_CONFLICT",
        linkId: expectedLinkId,
        storedTarget: reDecision.evidence?.storedTarget || null,
        proposedTarget: target,
        engineerReviewRequired: true,
        writes: zeroWrites(),
        decision: reDecision,
      };
    }
    return {
      ok: false,
      outcome: reDecision?.outcome || "REPAIR_CONTENTION",
      linkId: expectedLinkId,
      proposedTarget: target,
      writes: zeroWrites(),
      decision: reDecision || decision,
    };
  }

  return {
    ok: true,
    outcome: "REPAIRED",
    linkId: expectedLinkId,
    target,
    auditId,
    auditWritten: Number(batchResult?.[1]?.meta?.changes || 0) === 1,
    writes: { linkWrites: 1, auditWrites: Number(batchResult?.[1]?.meta?.changes || 0) },
    decision,
  };
};

const readLinkRow = async (db, organizationId, linkId) => {
  const rows = await db
    .prepare("SELECT * FROM knowledge_product_links WHERE id=? AND organization_id=?")
    .bind(linkId, organizationId)
    .all();
  return (rows.results || [])[0] || null;
};

const canonicalPathFor = (input, target) => {
  const hits = (input.candidates || []).filter(
    (entry) => entry.canonicalProductId === target && Array.isArray(entry.canonicalPath),
  );
  return hits.length > 0 ? hits[0].canonicalPath : [];
};

const refuseIfIneligible = ({ decision, input, organizationId, expectedLinkId, expectedTarget }) => {
  if (decision.engineerReviewRequired) return "ENGINEER_REVIEW_REQUIRED";
  if (decision.selectedTarget !== expectedTarget) return "TARGET_MISMATCH";
  if (!Array.isArray(input.existingLinks) || input.existingLinks.length !== 1) return "LINK_CARDINALITY";
  const link = input.existingLinks[0];
  if (link.id !== expectedLinkId) return "LINK_ID_MISMATCH";
  if (link.existingProductId) return "LINK_ALREADY_TARGETED";
  if (input.fact?.organizationId !== organizationId) return "ORGANIZATION_SCOPE_MISMATCH";
  if ((input.openIdentityConflicts || []).includes(decision.selectedTarget)) return "UNRESOLVED_IDENTITY_CONFLICT";

  const targetEntries = (input.candidates || []).filter(
    (entry) => entry.canonicalProductId === decision.selectedTarget,
  );
  if (targetEntries.length === 0) return "TARGET_NOT_VISIBLE";
  if (targetEntries.some((entry) => entry.canonicalResolutionError)) return "CANONICAL_CHAIN_UNHEALTHY";
  if (!targetEntries.some((entry) => entry.canonicalStatus === "Active")) return "CANONICAL_NOT_ACTIVE";
  const directHit = (input.candidates || []).find((entry) => entry.productId === decision.selectedTarget);
  if (directHit && directHit.identityStatus !== "Active") return "TARGET_SUPERSEDED";

  const considered = (decision.candidatesConsidered || []).filter(
    (entry) => entry.resolvedCanonicalId === decision.selectedTarget,
  );
  if (!considered.some((entry) => entry.comparisonEqual)) return "SEARCH_KEY_ONLY";
  if (considered.some((entry) => entry.excludedReason === "COMMERCIAL_SUBSTITUTE_NOT_IDENTITY")) {
    return "COMMERCIAL_SUBSTITUTE";
  }
  return null;
};
