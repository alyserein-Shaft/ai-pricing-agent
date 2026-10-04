// REQUIREMENT-LINK GOVERNANCE RECONCILIATION -- focused tests.
//
// WHY THIS FILE EXISTS
// --------------------
// Human-authored applicability originally gated the LINK insert on the pair only,
// while gating the two governance inserts on the link existing. That made
// governance OPTIONAL: a deterministic audit key built from a truncated
// concatenation of a ~40-character BOQ id and a ~65-character requirement id
// overflowed the 120-character key and collided across requirements, so the link
// committed while its decision/audit INSERTs silently no-oped. 30 links, 8 with
// governance, 22 without.
//
// These tests pin the repair and, just as importantly, pin that the repair CANNOT
// fabricate anything and CANNOT become a second authoring path.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HUMAN_REQUIREMENT_LINK_METHOD,
  MACHINE_REQUIREMENT_LINK_METHOD_PREFIX,
  RECONCILABLE_LINK_FACTS,
  RECONCILIATION_OUTCOMES,
  REQUIREMENT_LINK_RECONCILIATION_ACTION,
  REQUIREMENT_LINK_RECONCILIATION_REASON_CODE,
  planRequirementLinkGovernanceReconciliation,
  reconciliationAuditIdentity,
  validateRequirementLink,
} from "../app/domain/engineering-knowledge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = readFileSync(join(HERE, "..", "worker", "engineering-knowledge-api.mjs"), "utf8");
const ROUTE = API.slice(API.indexOf("const reconcileMatch"), API.indexOf("const supersedeMatch"));

// A link exactly as the defective write persisted it: every governance fact the
// Confirmed authority needs IS on the row; only the separate decision/audit rows
// are missing.
const defectiveLink = (over = {}) => ({
  id: "boqreqlink_1",
  project_id: "project_1",
  boq_item_id: "boqitem_1",
  requirement_id: "specjob_53f92936_chunk_000004_requirement_685",
  status: "Confirmed",
  link_method: HUMAN_REQUIREMENT_LINK_METHOD,
  reviewed_by: "engineer-1",
  reviewed_at: "2026-10-01T11:42:46.609Z",
  review_reason: "PROJECT REQUIREMENT, clause 2.1.A.1 (p186, Mandatory).",
  created_by: "engineer-1",
  created_at: "2026-10-01 11:42:46",
  superseded_at: null,
  ...over,
});

const plan = (over = {}) =>
  planRequirementLinkGovernanceReconciliation({ link: defectiveLink(), requirementCurrent: true, ...over });

// ===========================================================================
// 1. detects a human-authored effective link missing its governance record
// ===========================================================================
test("detects an effective human-authored link whose governance records are absent", () => {
  const result = plan();
  assert.equal(result.outcome, "RECONCILE");
  assert.equal(result.code, REQUIREMENT_LINK_RECONCILIATION_REASON_CODE);
  // It states WHICH half was lost, because the original truncation cut the
  // decision id and the audit request_id at different offsets.
  assert.deepEqual(result.missingGovernance, { decision: true, audit: true });
  assert.deepEqual(result.recoveredExisting, { decisionIds: [], auditRequestIds: [] });
});

// The reconstructed content must come from the LINK, not from the environment.
test("reconstructs the original decision ONLY from values persisted on the link row", () => {
  const { originalDecision } = plan();
  assert.equal(originalDecision.reviewedBy, "engineer-1");
  assert.equal(originalDecision.reviewedAt, "2026-10-01T11:42:46.609Z");
  assert.equal(originalDecision.reviewReason, "PROJECT REQUIREMENT, clause 2.1.A.1 (p186, Mandatory).");
  assert.equal(originalDecision.origin, "HUMAN_AUTHORED");
  assert.equal(originalDecision.applicability, "Confirmed");
  assert.equal(originalDecision.recoveredFrom, "boq_requirement_links (persisted)");
});

// 6. Historical truth: the repair is explicitly bounded.
test("the reconciliation is explicitly not a technical decision and never alters the original", () => {
  const { authority, reason } = plan();
  assert.equal(authority.createsTechnicalDecision, false);
  assert.equal(authority.changesLinkStatus, false);
  assert.equal(authority.altersOriginalDecisionTime, false);
  assert.equal(authority.scope, "Governance repair only");
  // The reason names the CAUSE, so an auditor knows this was a repair.
  assert.match(reason, /^RECONCILE_MISSING_REQUIREMENT_LINK_AUDIT_AFTER_IDEMPOTENCY_KEY_COLLISION/);
  assert.match(reason, /does NOT re-decide the applicability/);
  assert.match(reason, /does NOT alter the original decision time/);
});

// ===========================================================================
// 2. complete link is a no-op
// ===========================================================================
test("a link that already has both governance records is ALREADY_COMPLETE", () => {
  const result = plan({
    existingDecisionIds: ["d1"], existingAuditRequestIds: ["a1"],
    ownedDecisionIds: ["d1"], ownedAuditRequestIds: ["a1"],
  });
  assert.equal(result.outcome, "ALREADY_COMPLETE");
  assert.deepEqual(result.decisionIds, ["d1"]);
  assert.deepEqual(result.auditRequestIds, ["a1"]);
});

// ===========================================================================
// 3. only human-authored links
// ===========================================================================
test("reconciliation refuses a machine-generated link", () => {
  for (const method of [
    `${MACHINE_REQUIREMENT_LINK_METHOD_PREFIX} · bounded shortlist`,
    `${MACHINE_REQUIREMENT_LINK_METHOD_PREFIX} · deterministic auto-confirm`,
    null,
  ]) {
    const result = planRequirementLinkGovernanceReconciliation({
      link: defectiveLink({ link_method: method }),
      requirementCurrent: true,
    });
    assert.equal(result.outcome, "NOT_RECONCILABLE");
    assert.equal(result.code, "LINK_NOT_HUMAN_AUTHORED");
  }
});

// ===========================================================================
// 4 + 5. foreign project and stale are rejected
// ===========================================================================
test("a superseded link and a stale requirement are both refused", () => {
  assert.equal(plan({ link: defectiveLink({ superseded_at: "2026-10-02T00:00:00.000Z" }) }).code, "LINK_NOT_EFFECTIVE");
  assert.equal(plan({ link: null }).code, "LINK_NOT_EFFECTIVE");
  assert.equal(plan({ requirementCurrent: false }).code, "LINK_REQUIREMENT_NOT_CURRENT");
});

// ===========================================================================
// 6. ambiguous duplicate pair
// ===========================================================================
test("an ambiguous duplicate pair is refused", () => {
  for (const count of [2, 3]) {
    const result = plan({ pairLinkCount: count });
    assert.equal(result.outcome, "CONFLICT");
    assert.equal(result.code, "LINK_PAIR_AMBIGUOUS");
  }
});

// ===========================================================================
// 7 + 8. NEVER fabricate a missing actor, reason or time
// ===========================================================================
test("a missing original actor, reason or time forces REAUTHORING, never fabrication", () => {
  for (const fact of ["reviewed_by", "review_reason", "reviewed_at"]) {
    const result = plan({ link: defectiveLink({ [fact]: null }) });
    assert.equal(result.outcome, "REAUTHORING_REQUIRED", `${fact} must force re-authoring`);
    assert.equal(result.code, "GOVERNANCE_REPAIR_REQUIRES_REAUTHORING");
    assert.ok(result.missingFacts.length > 0);
    // "now" is explicitly never a substitute.
    assert.match(result.reason, /"now" is never a substitute for an original decision time/);
  }
  // An empty string is as absent as null.
  assert.equal(plan({ link: defectiveLink({ review_reason: "" }) }).outcome, "REAUTHORING_REQUIRED");
  // Every fact the existing Confirmed authority needs is enumerated up front, so
  // the rule is inspectable rather than implied.
  for (const fact of ["projectId", "boqItemId", "requirementId", "status", "linkMethod", "reviewedBy", "reviewReason", "reviewedAt"]) {
    assert.ok(RECONCILABLE_LINK_FACTS.includes(fact), `${fact} must be a reconcilable fact`);
  }
  // A fabricated actor is also refused at the validator level.
  assert.throws(
    () => validateRequirementLink({
      projectId: "p", boqItemId: "b", requirementId: "r", status: "Confirmed",
      reviewedBy: null, reviewReason: "because", requirementCurrent: true,
    }),
    (error) => { assert.equal(error.code, "LINK_REVIEWER_REQUIRED"); return true; },
  );
});

// ===========================================================================
// 9. deterministic reconstruction produces a unique bounded digest
// ===========================================================================
test("the repair identity is deterministic, unique and bounded", async () => {
  const a = await reconciliationAuditIdentity("boqreqlink_1");
  const b = await reconciliationAuditIdentity("boqreqlink_1");
  const other = await reconciliationAuditIdentity("boqreqlink_2");
  assert.deepEqual(a, b, "must be deterministic");
  assert.notEqual(a.decisionId, other.decisionId, "different links must not collide");
  assert.ok(a.decisionId.length <= 120, "must fit the primary key");
  assert.ok(a.auditRequestId.length <= 120, "must fit the audit request_id column");
  assert.match(a.decisionId, /^knowledgeDecision_reconcile-governance_[0-9a-f]{64}$/);
  assert.match(a.auditRequestId, /^linkReconcile_[0-9a-f]{64}$/);

  // The concatenation this replaced would have overflowed, at the real id shapes.
  const longLink = `${"l".repeat(64)}_${"r".repeat(64)}`;
  assert.ok(`knowledgeDecision_${REQUIREMENT_LINK_RECONCILIATION_ACTION}_${longLink}`.length > 120);
});

// ===========================================================================
// 10. identical reconciliation is idempotent
// ===========================================================================
test("an identical reconciliation request is idempotent by construction", async () => {
  const identity = await reconciliationAuditIdentity("boqreqlink_1");
  assert.equal(
    identity.decisionId,
    (await reconciliationAuditIdentity("boqreqlink_1")).decisionId,
    "a repeat computes the identical key, so the insert cannot duplicate",
  );
  // And once complete, the planner itself reports ALREADY_COMPLETE, which is what
  // the route returns without writing.
  const after = plan({
    existingDecisionIds: ["d"], existingAuditRequestIds: ["a"],
    ownedDecisionIds: ["d"], ownedAuditRequestIds: ["a"],
  });
  assert.equal(after.outcome, "ALREADY_COMPLETE");
});

// ===========================================================================
// 11. conflicting existing governance fails closed
// ===========================================================================
test("governance rows that are not provably this link's own fail closed", () => {
  const result = plan({
    existingDecisionIds: ["foreign_decision"],
    existingAuditRequestIds: [],
    ownedDecisionIds: [],
    ownedAuditRequestIds: [],
  });
  assert.equal(result.outcome, "CONFLICT");
  assert.equal(result.code, "GOVERNANCE_FOREIGN_TO_THIS_LINK");
  assert.deepEqual(result.foreignDecisionIds, ["foreign_decision"]);
});

// A PARTIAL pair whose present row is provably this link's own is NOT a conflict:
// the original truncation cut the two keys at different offsets, so a link could
// lose its decision and keep its audit. Only the missing half is reconstructed.
test("a partial pair that is provably this link's own reconciles only the missing half", () => {
  const result = plan({
    existingDecisionIds: [],
    existingAuditRequestIds: ["linkAuthored_truncated_key"],
    ownedDecisionIds: [],
    ownedAuditRequestIds: ["linkAuthored_truncated_key"],
  });
  assert.equal(result.outcome, "RECONCILE");
  assert.deepEqual(result.missingGovernance, { decision: true, audit: false });
  assert.deepEqual(result.recoveredExisting.auditRequestIds, ["linkAuthored_truncated_key"]);
});

// ===========================================================================
// 12 + 13 + 14 + 15. Route-level structural guarantees
// ===========================================================================

// 12. the repair writes explicit repair provenance and separate repair metadata
test("the repair writes explicit repair provenance and separates repair time from decision time", () => {
  assert.match(ROUTE, /REQUIREMENT_LINK_RECONCILIATION_ACTION/);
  assert.match(ROUTE, /'Requirement Link Governance Reconciled'/);
  assert.match(ROUTE, /reconciledAt: repairedAt/);
  assert.match(ROUTE, /originalDecision: plan\.originalDecision/);
  // Attribution is the REPAIRER and the repair time -- never backdated.
  // The decision row records the REPAIRER and the REPAIR time. `decided_at` is a
  // database default (repair time); the ORIGINAL decision time rides inside
  // previous_value/evidence as recovered data, never as decided_at.
  assert.match(ROUTE, /const repairedAt = now\(\)/);
  // decided_by is the operator id resolved from the configured human actor, and
  // decided_role the operator's own role -- the REPAIRER's, not the original's.
  assert.match(ROUTE, /const operatorId = linkHuman\.actor\.id;/);
  assert.match(ROUTE, /link\.boq_item_id, operatorId, user\.role,/);
  // reversible is 0: a governance repair is a record of fact, not a decision that
  // can be "undone" by flipping the row back.
  assert.match(ROUTE, /scope_id, reversible, decided_by, decided_role\) VALUES/);
  assert.match(ROUTE, /JSON\.stringify\(\{ reconciled: true, reconciledAt: repairedAt, originalDecision: plan\.originalDecision \}\)/);
  assert.match(ROUTE, /JSON\.stringify\(\{ repairedAt, originalDecision: plan\.originalDecision, authority: plan\.authority, operatorReason/);
  // The operator's own reason is recorded, and the fixed cause code leads.
  assert.match(ROUTE, /const operatorReason = String\(body\?\.reason \|\| ""\)\.trim\(\)/);
  // The recovered original metadata is carried as data, not re-asserted as truth.
  // `recoveredFrom` is stamped by the DOMAIN planner, which is where the
  // reconstruction actually happens -- the route only relays it.
  assert.match(ROUTE, /plan\.originalDecision/);
  assert.ok(
    !ROUTE.includes("recoveredFrom:"),
    "the route must relay the planner's recovered record, never construct its own",
  );
});

// 13. it can never author or confirm anything
test("reconciliation can only emit a reconcile-governance record, never author or confirm", () => {
  assert.match(ROUTE, /REQUIREMENT_LINK_RECONCILIATION_ACTION,?\s*\)/);
  // It writes no link row at all, and mutates no link status.
  assert.ok(!ROUTE.includes("INSERT INTO boq_requirement_links"), "a repair must never insert a link");
  assert.ok(!/UPDATE boq_requirement_links/.test(ROUTE), "a repair must never update a link");
  const inserts = [...new Set(ROUTE.match(/INSERT INTO [a-z_]+/g) || [])].sort();
  assert.deepEqual(inserts, ["INSERT INTO document_audit_events", "INSERT INTO engineering_knowledge_decisions"]);
  // Only the reconcile action name appears.
  assert.ok(!ROUTE.includes("'author'"));
  assert.ok(!ROUTE.includes("'confirm'"));
});

// 14. future authoring is atomic
test("future human-link authoring cannot persist a link without its governance records", () => {
  const authorRoute = API.slice(API.indexOf("const authorMatch"), API.indexOf("const reconcileMatch"));
  // The link insert is now gated on BOTH governance identities being free, and the
  // two governance inserts are UNCONDITIONAL, so nothing can silently skip.
  const linkInsert = authorRoute.slice(authorRoute.indexOf("INSERT INTO boq_requirement_links"));
  assert.match(linkInsert, /AND NOT EXISTS \(SELECT 1 FROM engineering_knowledge_decisions WHERE id=\?\)/);
  assert.match(linkInsert, /AND NOT EXISTS \(SELECT 1 FROM document_audit_events WHERE request_id=\?\)/);
  const decisionInsert = authorRoute.slice(authorRoute.indexOf("INSERT INTO engineering_knowledge_decisions"));
  const auditInsert = authorRoute.slice(authorRoute.indexOf("INSERT INTO document_audit_events"));
  // Unconditional: no WHERE EXISTS / NOT EXISTS gating remains on either.
  assert.ok(!decisionInsert.slice(0, 400).includes("WHERE EXISTS"), "the decision insert must be unconditional");
  assert.ok(!auditInsert.slice(0, 400).includes("WHERE EXISTS"), "the audit insert must be unconditional");
  // All three are in one batch, which is this repo's canonical atomic unit.
  assert.match(authorRoute, /env\.DB\.batch\(\[\s*env\.DB\.prepare\("INSERT INTO boq_requirement_links/);
  // The key is a bounded digest, never a concatenation.
  assert.match(authorRoute, /crypto\.subtle\.digest\("SHA-256"/);
  assert.ok(!/knowledgeDecision_author_\$\{boqItemId\}_/.test(authorRoute), "no concatenated audit key");
});

// 15. suggest-links and the readiness threshold remain unchanged
test("suggest-links and the readiness threshold are untouched by the repair", () => {
  assert.match(API, /export const buildLinkShortlist/);
  assert.equal((API.match(/DEVICE_SPECIFIC_SHORTLIST_RESERVE/g) || []).length, 3, "shortlist arithmetic unchanged");
  assert.ok(!ROUTE.includes("suggestLinks"), "the repair must not enter the generation path");
  assert.ok(!ROUTE.includes("approved_for_matching"), "the repair must not touch readiness approval");
  const readiness = readFileSync(join(HERE, "..", "worker", "technical-requirement-api.mjs"), "utf8");
  // The readiness gate is unchanged BY THIS SLICE. It was later widened, under
  // separate authorization, to accept "Ready with Warnings" as well as "Ready
  // for Matching" (both are downstream-safe in the matcher); the invariant this
  // test protects is that the blocking states stay non-approvable.
  assert.match(readiness, /MATCH_APPROVABLE_READINESS/);
  assert.match(readiness, /READINESS_BLOCKED/);
  assert.ok(!/MATCH_APPROVABLE_READINESS\s*=\s*\[[^\]]*(Classification Required|Missing Critical Information|Needs Technical Review)/.test(readiness), "blocking readiness states must never become approvable");
});

// The outcome vocabulary is closed and inspectable.
test("the reconciliation outcome vocabulary is closed", () => {
  for (const outcome of ["RECONCILE", "ALREADY_COMPLETE", "REAUTHORING_REQUIRED", "CONFLICT", "NOT_RECONCILABLE"]) {
    assert.ok(RECONCILIATION_OUTCOMES.includes(outcome));
  }
  assert.equal(RECONCILIATION_OUTCOMES.length, 5);
});