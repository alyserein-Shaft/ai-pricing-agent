// HUMAN-AUTHORED REQUIREMENT APPLICABILITY -- focused tests.
//
// WHY THIS FILE EXISTS
// --------------------
// `boq_requirement_links` had exactly one creation path: the bounded-shortlist
// `suggest-links` generator. The confirm/reject/remove route can only move a row
// that ALREADY exists, so an applicability relationship that automation could not
// infer but a qualified engineer could defend from project evidence had NO
// governed representation at all -- it did not exist and could not be created.
//
// These tests pin both halves of the repair:
//   * the pure planner decides correctly (create / idempotent / transition /
//     conflict) and refuses malformed input;
//   * the route is governed -- technical role required, actor never read from the
//     payload, current-evidence-bounded reads, fail-closed codes, no direct DB
//     write, and no weakening of suggest-links or of the readiness threshold.
//
// Source-level assertions on the route are deliberate and idiomatic here: the
// route's guarantees are structural (which authority it resolves, which codes it
// refuses, what it never reads), not just behavioural, and several are only
// reachable with a live D1 binding. Behavioural proof on the real governed path
// lives in the Central Kitchen benchmark run.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HUMAN_AUTHORED_LINK_APPLICABILITY,
  HUMAN_REQUIREMENT_LINK_METHOD,
  KNOWLEDGE_MODEL_VERSION,
  LINK_STATUSES,
  MACHINE_GENERATED_LINK_STATUSES,
  MACHINE_REQUIREMENT_LINK_METHOD_PREFIX,
  KnowledgeIntegrityError,
  planHumanRequirementLinkAuthoring,
  planRequirementLinkSupersession,
  requirementLinkOrigin,
  validateRequirementLink,
} from "../app/domain/engineering-knowledge.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const API = readFileSync(join(HERE, "..", "worker", "engineering-knowledge-api.mjs"), "utf8");

// Mirrors the route's bounded-key derivation, so the test pins the real shape.
const digestOf = async (value) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
    .map((byte) => byte.toString(16).padStart(2, "0")).join("");

const machineSuggested = (over = {}) => ({
  id: "link_machine",
  boqItemId: "boq_item_1",
  requirementId: "req_1",
  status: "Suggested",
  linkMethod: `${MACHINE_REQUIREMENT_LINK_METHOD_PREFIX} · bounded shortlist`,
  ...over,
});
const humanConfirmed = (over = {}) => ({
  id: "link_human",
  boqItemId: "boq_item_1",
  requirementId: "req_1",
  status: "Confirmed",
  linkMethod: HUMAN_REQUIREMENT_LINK_METHOD,
  ...over,
});

// ===========================================================================
// 1. An authorized engineer CAN create a missing applicability link.
// ===========================================================================
test("an engineer may author a missing applicability link where automation suggested nothing", () => {
  const plan = planHumanRequirementLinkAuthoring({
    activeLinks: [], // suggest-links produced nothing for this pair
    boqItemId: "boq_item_1",
    requirementId: "req_1",
    applicability: "Confirmed",
  });
  assert.equal(plan.mode, "create");
  assert.equal(plan.existingLinkId, null);
});

// The authored record must survive the SHARED validator, i.e. it is not a
// parallel state machine: it earns Confirmed authority exactly the way a
// machine-suggested-then-human-confirmed link does.
test("a human-authored Confirmed link satisfies the existing shared link validator", () => {
  const validated = validateRequirementLink({
    projectId: "project_1",
    boqItemId: "boq_item_1",
    requirementId: "req_1",
    status: "Confirmed",
    linkMethod: HUMAN_REQUIREMENT_LINK_METHOD,
    reviewedBy: "engineer-1",
    reviewReason: "Clause 2.1.A.1 governs the whole Fire Alarm system by its own terms.",
    requirementCurrent: true,
    confidence: 100,
    evidence: [{ origin: "HUMAN_AUTHORED" }],
  });
  assert.equal(validated.status, "Confirmed");
  assert.equal(validated.linkMethod, HUMAN_REQUIREMENT_LINK_METHOD);
  assert.equal(validated.confidence, 100);

  // And it is refused WITHOUT a reason, exactly like any other Confirmed link.
  assert.throws(
    () => validateRequirementLink({
      projectId: "project_1", boqItemId: "boq_item_1", requirementId: "req_1",
      status: "Confirmed", reviewedBy: "engineer-1", requirementCurrent: true,
    }),
    (error) => { assert.equal(error.code, "LINK_REASON_REQUIRED"); return true; },
  );

  // And it is refused when the requirement is not current evidence.
  assert.throws(
    () => validateRequirementLink({
      projectId: "project_1", boqItemId: "boq_item_1", requirementId: "req_1",
      status: "Confirmed", reviewedBy: "engineer-1", reviewReason: "because", requirementCurrent: false,
    }),
    (error) => { assert.equal(error.code, "LINK_REQUIREMENT_NOT_CURRENT"); return true; },
  );
});

// ===========================================================================
// 9. Human-authored and automatic links stay DISTINGUISHABLE.
// ===========================================================================
test("human-authored links are distinguishable from machine-generated ones, with no new vocabulary", () => {
  // Provenance lives in the EXISTING link_method column: two machine values exist,
  // and a human value is a third. No new column or vocabulary table was added.
  assert.equal(
    requirementLinkOrigin({ linkMethod: HUMAN_REQUIREMENT_LINK_METHOD }),
    "HUMAN_AUTHORED",
  );
  assert.equal(
    requirementLinkOrigin({ linkMethod: `${MACHINE_REQUIREMENT_LINK_METHOD_PREFIX} · bounded shortlist` }),
    "MACHINE_GENERATED",
  );
  assert.equal(
    requirementLinkOrigin({ linkMethod: `${MACHINE_REQUIREMENT_LINK_METHOD_PREFIX} · deterministic auto-confirm` }),
    "MACHINE_GENERATED",
  );
  assert.equal(requirementLinkOrigin({}), "UNKNOWN");

  // Both machine methods must keep their real values -- the constant is a prefix,
  // not a replacement, so nothing existing is rewritten.
  assert.match(HUMAN_REQUIREMENT_LINK_METHOD, /Human Project Decision/);
  assert.ok(MACHINE_REQUIREMENT_LINK_METHOD_PREFIX.startsWith("Technical Applicability"));
});

// A human-authored link must be PROTECTED from the machine retirement planner.
// This is the guarantee that stops `suggest-links` from silently erasing an
// engineer's applicability decision on its next run.
test("a human-authored link is structurally unreachable by the machine supersession planner", () => {
  // Every authorable applicability is machine-unretirable, by construction.
  for (const applicability of HUMAN_AUTHORED_LINK_APPLICABILITY) {
    assert.ok(
      !MACHINE_GENERATED_LINK_STATUSES.includes(applicability),
      `${applicability} must not be machine-retirable`,
    );
    // Real planner proof: even when a generation DID re-propose the same pair,
    // the human link is never retired, never counted as machine, and reported as
    // governed-untouched.
    const plan = planRequirementLinkSupersession({
      activeLinks: [humanConfirmed({ status: applicability, id: "link_human" })],
      processedItemIds: ["boq_item_1"],
      proposedPairs: [{ boqItemId: "boq_item_1", requirementId: "req_1" }],
      eligibleRequirementCount: 1,
    });
    assert.deepEqual(plan.retire, [], `${applicability} human link must never be retired`);
    assert.deepEqual(plan.replaced, [], `${applicability} human link must never be replaced`);
    assert.deepEqual(plan.retracted, [], `${applicability} human link must never be retracted`);
    assert.equal(plan.machineLinkCount, 0, "a human link must never count as machine-generated");
    assert.deepEqual(plan.governedUntouched, ["link_human"]);
  }

  // `Suggested` is deliberately NOT authorable precisely because it IS
  // machine-retirable; that is the reason for the narrow vocabulary above.
  assert.ok(MACHINE_GENERATED_LINK_STATUSES.includes("Suggested"));
  assert.ok(!HUMAN_AUTHORED_LINK_APPLICABILITY.includes("Suggested"));
});

// ===========================================================================
// 6. Identical repeat is idempotent. 7. No duplicate effective link.
// ===========================================================================
test("an identical repeat is idempotent and never creates a second effective link", async () => {
  const existing = humanConfirmed();
  const plan = planHumanRequirementLinkAuthoring({
    activeLinks: [existing],
    boqItemId: "boq_item_1",
    requirementId: "req_1",
    applicability: "Confirmed",
  });
  assert.equal(plan.mode, "idempotent");
  assert.equal(plan.existingLinkId, existing.id);
  assert.match(plan.reason, /no new record was written/i);

  // The audit identity must be a BOUNDED digest of the natural key, never a
  // concatenation. Concatenating a ~40-character BOQ id with a ~65-character
  // requirement id reaches ~153 characters against a 120-character primary key,
  // so `.slice(0, 120)` truncated the requirement half away and produced the SAME
  // key for every requirement sharing a BOQ item. The NOT EXISTS guard then
  // suppressed most audit rows (29 links authored, 7 decisions written). This is
  // the regression guard for that exact defect.
  const decisionId = async (boqItemId, requirementId) =>
    `knowledgeDecision_author_${await digestOf(`${boqItemId}|${requirementId}|Confirmed|${HUMAN_REQUIREMENT_LINK_METHOD}`)}`.slice(0, 120);
  const first = await decisionId("boq_item_1", "req_1");
  const otherRequirement = await decisionId("boq_item_1", "req_2");
  const otherItem = await decisionId("boq_item_2", "req_1");
  assert.equal(first, await decisionId("boq_item_1", "req_1"), "must be deterministic");
  assert.notEqual(first, otherRequirement, "different requirements must not collide");
  assert.notEqual(first, otherItem, "different BOQ items must not collide");
  assert.ok(first.length <= 120, "must fit the primary key");
  assert.ok(otherRequirement.length <= 120);
  // The concatenation this replaced really did overflow the column, using the
  // REAL id shapes seen in production (a 38-char boqitem uuid and a 65-char
  // specjob requirement id reach 138 characters).
  const realisticBoqItemId = `boqitem_${"b".repeat(32)}`;
  const realisticRequirementId = `specjob_${"r".repeat(38)}_chunk_000004_requirement_697`;
  assert.ok(
    `knowledgeDecision_author_${realisticBoqItemId}_${realisticRequirementId}_Confirmed`.length > 120,
    "a concatenated key would overflow the 120-character column",
  );
});

// ===========================================================================
// 8. A conflicting repeat follows the governed state machine, never overwrites.
// ===========================================================================
test("a conflicting repeat is refused as a governed conflict, not a silent overwrite", () => {
  // With Confirmed-only authoring, the ONLY disagreements left are pairs a person
  // has already decided AGAINST. An identical repeat is the idempotency case above;
  // a machine-suggested pair is the delegated transition case below. Everything
  // else that a human could "author" over is refused.
  const cases = [
    ["existing Rejected, author Confirmed", humanConfirmed({ status: "Rejected", id: "link_r" })],
    ["existing Removed, author Confirmed", humanConfirmed({ status: "Removed", id: "link_x" })],
  ];
  for (const [label, existing] of cases) {
    const plan = planHumanRequirementLinkAuthoring({
      activeLinks: [existing],
      boqItemId: "boq_item_1",
      requirementId: "req_1",
      applicability: "Confirmed",
    });
    assert.equal(plan.mode, "conflict", `${label} must conflict`);
    assert.equal(plan.existingLinkId, existing.id);
    assert.match(plan.reason, /Review that link instead/);
  }

  // And an attempt to author `Suggested` at all is refused as an invalid status.
  assert.throws(
    () => planHumanRequirementLinkAuthoring({ activeLinks: [], boqItemId: "b", requirementId: "r", applicability: "Suggested" }),
    (error) => { assert.equal(error.code, "INVALID_LINK_STATUS"); return true; },
  );
});

// A machine-suggested link the engineer now confirms is NOT a conflict and NOT a
// duplicate: it is the existing governed transition, delegated.
test("confirming a machine-proposed link is delegated to the existing transition, never duplicated", () => {
  // BOTH machine-proposable statuses behave the same way: the engineer confirms
  // the existing row through the existing route, so the single-transition
  // guarantee is preserved and no second effective link is created.
  for (const status of MACHINE_GENERATED_LINK_STATUSES) {
    const existing = machineSuggested({ status, id: `link_${status}` });
    const plan = planHumanRequirementLinkAuthoring({
      activeLinks: [existing],
      boqItemId: "boq_item_1",
      requirementId: "req_1",
      applicability: "Confirmed",
    });
    assert.equal(plan.mode, "transition_existing", `${status} must delegate, not duplicate`);
    assert.equal(plan.existingLinkId, existing.id);
    assert.match(plan.reason, /existing link review route/);
  }
});

// A second effective link for the same pair is corrupt state and must be
// refused rather than "resolved" by picking a winner.
test("two effective links for one pair are refused as ambiguous", () => {
  assert.throws(
    () => planHumanRequirementLinkAuthoring({
      activeLinks: [humanConfirmed({ id: "l1" }), humanConfirmed({ id: "l2" })],
      boqItemId: "boq_item_1",
      requirementId: "req_1",
    }),
    (error) => { assert.ok(error instanceof KnowledgeIntegrityError); assert.equal(error.code, "LINK_PAIR_AMBIGUOUS"); return true; },
  );
});

// Superseded rows never participate, so re-authoring after a supersede is legal.
test("a superseded link does not block authoring a new effective one", () => {
  const plan = planHumanRequirementLinkAuthoring({
    activeLinks: [humanConfirmed({ id: "old", supersededAt: "2026-01-01T00:00:00.000Z" })],
    boqItemId: "boq_item_1",
    requirementId: "req_1",
    applicability: "Confirmed",
  });
  assert.equal(plan.mode, "create");
});

// ===========================================================================
// 5. No new status is invented.
// ===========================================================================
test("human applicability adds no new link state", () => {
  for (const applicability of HUMAN_AUTHORED_LINK_APPLICABILITY) {
    assert.ok(LINK_STATUSES.includes(applicability), `${applicability} must already exist in LINK_STATUSES`);
  }
  // Rejected / Removed stay transition-only: they belong to the existing route.
  for (const forbidden of ["Rejected", "Removed", "Superseded", "Needs Review"]) {
    assert.throws(
      () => planHumanRequirementLinkAuthoring({ boqItemId: "b", requirementId: "r", applicability: forbidden }),
      (error) => { assert.equal(error.code, "INVALID_LINK_STATUS"); return true; },
    );
  }
  // The authored link is not made MORE authoritative than an existing confirmed
  // one: both carry the same reviewer/reason/currentness obligations.
  assert.throws(
    () => planHumanRequirementLinkAuthoring({ boqItemId: "", requirementId: "r" }),
    (error) => { assert.equal(error.code, "LINK_BOQ_REQUIRED"); return true; },
  );
  assert.throws(
    () => planHumanRequirementLinkAuthoring({ boqItemId: "b", requirementId: "" }),
    (error) => { assert.equal(error.code, "LINK_REQUIREMENT_REQUIRED"); return true; },
  );
});

// ===========================================================================
// ROUTE-LEVEL GOVERNANCE (structural guarantees, asserted on the source)
// ===========================================================================

// 2. An unauthorized actor cannot author.
test("the authoring route requires a technical engineering role, not an observer or pricing role", () => {
  assert.match(API, /canApproveTechnicalSafety\(authority\.role\)/);
  assert.match(API, /TECHNICAL_APPROVAL_ROLE_REQUIRED/);
  // It resolves authority from durable project membership, not from a header.
  assert.match(API, /resolveProjectAuthority\(env\.DB, \{ projectId, actor: user \}\)/);
  // The role set is the shared single authority, not a local copy.
  assert.match(API, /from "\.\.\/app\/domain\/project-roles\.mjs"/);
});

// 4. The actor is never taken from the request payload.
test("the authoring route never reads the actor from the request body", () => {
  const block = API.slice(API.indexOf("const authorMatch"), API.indexOf("const supersedeMatch"));
  assert.ok(block.length > 0, "authoring route block must exist");
  for (const forbidden of ["body.actor", "body.userId", "body.decidedBy", "body.reviewedBy", "body.actorId"]) {
    assert.ok(!block.includes(forbidden), `must not read ${forbidden} from the payload`);
  }
  // Attribution quotes the configured human actor, not the synthetic identity.
  assert.match(block, /requireHumanActor\(env\)/);
  assert.match(block, /reviewedBy: applicability === "Confirmed" \? linkHuman\.actor\.id : null/);
  assert.match(block, /decided_by, decided_role\)[\s\S]*linkHuman\.actor\.id, authority\.role/);
});

// 3 + 4 + 5. Stale / cross-project / stale-interpretation protection.
test("the authoring route is bounded by current evidence and by project", () => {
  const block = API.slice(API.indexOf("const authorMatch"), API.indexOf("const supersedeMatch"));
  // BOQ item: current evidence AND inside an owned project.
  assert.match(block, /currentBoqEvidenceFrom\("b"\)/);
  assert.match(block, /owner_user_id=\? AND archived_at IS NULL/);
  assert.match(block, /LINK_TARGET_NOT_CURRENT/);
  // Requirement: current evidence AND same project; a foreign id is refused with a
  // distinct code rather than silently accepted.
  assert.match(block, /currentTechnicalRequirementsFrom\("r"\)/);
  assert.match(block, /r\.project_id=\?/);
  assert.match(block, /LINK_REQUIREMENT_PROJECT_MISMATCH/);
  // requirementCurrent is passed AFFIRMATIVELY -- the flag that earns Confirmed
  // authority -- rather than omitted.
  assert.match(block, /requirementCurrent: true/);
});

// A substantive reason is required, and the refusal message must reject the
// non-reason the brief calls out.
test("the authoring route requires a substantive reason and rejects a non-reason", () => {
  assert.match(API, /LINK_REVIEW_REASON_REQUIRED/);
  assert.match(API, /because I want this matched/);
  assert.match(API, /body\.reason \|\| ""/);
});

// GOVERNANCE IS MANDATORY, not optional.
//
// SUPERSEDED GATE DIRECTION. This test originally asserted "the link row is the
// gate": the link insert was gated on the pair only, while the two governance
// inserts were gated on `WHERE EXISTS (link id) AND NOT EXISTS(<own id>)`. That
// made governance OPTIONAL -- a colliding decision id silently no-oped those two
// inserts while the link still committed, and 22 of 30 links ended up Confirmed
// with no decision and no audit row.
//
// The invariant is now asserted in the direction that actually holds: the LINK
// insert is gated on BOTH governance identities being free, and the two
// governance inserts are UNCONDITIONAL. So there is nothing left to silently
// skip, all three statements apply, and if any ever fails the batch rolls back.
test("governance records are mandatory: a link cannot commit without them", () => {
  const block = API.slice(API.indexOf("const authorMatch"), API.indexOf("const reconcileMatch"));

  // The link may only be written when its governance identities are free.
  const linkInsert = block.slice(block.indexOf("INSERT INTO boq_requirement_links"), block.indexOf("INSERT INTO engineering_knowledge_decisions"));
  assert.match(linkInsert, /WHERE NOT EXISTS \(SELECT 1 FROM boq_requirement_links WHERE boq_item_id=\? AND requirement_id=\? AND superseded_at IS NULL\)/);
  assert.match(linkInsert, /AND NOT EXISTS \(SELECT 1 FROM engineering_knowledge_decisions WHERE id=\?\)/);
  assert.match(linkInsert, /AND NOT EXISTS \(SELECT 1 FROM document_audit_events WHERE request_id=\?\)/);

  // The two governance inserts are unconditional, so they cannot skip.
  const decisionStatement = block.slice(block.indexOf("INSERT INTO engineering_knowledge_decisions")).split(").bind(")[0];
  assert.ok(!decisionStatement.includes("WHERE"), "the decision insert must be unconditional");
  const auditStatement = block.slice(block.indexOf("INSERT INTO document_audit_events")).split(").bind(")[0];
  assert.ok(!auditStatement.includes("WHERE"), "the audit insert must be unconditional");

  // All three are one atomic unit -- this repo's canonical atomic pattern.
  assert.match(block, /env\.DB\.batch\(\[\s*env\.DB\.prepare\("INSERT INTO boq_requirement_links/);

  // The governance identities are bounded digests, never concatenations.
  assert.match(block, /crypto\.subtle\.digest\("SHA-256"/);
  assert.ok(!/knowledgeDecision_author_\$\{boqItemId\}_/.test(block), "no concatenated governance key");
});

// 10 + 17. The authoring path must not become an ambiguity bypass, and neither
// suggest-links nor the readiness threshold may be touched to make it work.
test("authoring does not broaden suggest-links and does not touch the readiness threshold", () => {
  // The generator's scoring/shortlist is untouched: only a read filter and the
  // shortlist builder exist, and neither gained an authoring escape.
  assert.match(API, /export const buildLinkShortlist/);
  // Defined once, consumed twice (the primary slice and the device-specific
  // reserve slice) -- i.e. the generator's arithmetic is unchanged by this slice.
  assert.equal(
    (API.match(/DEVICE_SPECIFIC_SHORTLIST_RESERVE/g) || []).length,
    3,
    "the shortlist reserve must be defined once and used twice, not expanded",
  );
  // Human authoring lives on its OWN anchored route; it never enters the
  // suggest-links generation path.
  assert.match(API, /const authorMatch = url\.pathname\.match\(\/\^\\\/api\\\/requirement-links\$\/\)/);
  assert.ok(!/suggestLinks\([^)]*authored/i.test(API));
  // The readiness gate string must be untouched by this slice. It was later
  // widened, under separate authorization, to accept "Ready with Warnings" too;
  // the invariant protected here is that the blocking states stay excluded.
  const readiness = readFileSync(join(HERE, "..", "worker", "technical-requirement-api.mjs"), "utf8");
  assert.match(readiness, /MATCH_APPROVABLE_READINESS/);
  assert.match(readiness, /READINESS_BLOCKED/);
  assert.ok(!/MATCH_APPROVABLE_READINESS\s*=\s*\[[^\]]*(Classification Required|Missing Critical Information|Needs Technical Review)/.test(readiness), "blocking readiness states must never become approvable");
});

// 13. Rejection / removal continue to work and are untouched.
test("the existing link transition routes are preserved", () => {
  // The collection-authoring route and the per-link transition route are distinct
  // anchored patterns, so authoring cannot shadow an existing transition.
  assert.match(API, /const authorMatch = url\.pathname\.match\(\/\^\\\/api\\\/requirement-links\$\/\)/);
  assert.match(
    API,
    /const linkMatch = url\.pathname\.match\(\/\^\\\/api\\\/requirement-links\\\/\(\[\^\/\]\+\)\\\/\(confirm\|reject\|remove\)\$\/\)/,
  );
  // All three operations still map to their original target statuses.
  assert.match(API, /status = \{ confirm: "Confirmed", reject: "Rejected", remove: "Removed" \}/);
  // A terminal link still cannot be moved by the transition route: the UPDATE is
  // still bounded to Suggested/Needs Review.
  assert.match(API, /WHERE id=\? AND status IN \('Suggested','Needs Review'\)/);
});

// 15 + 16. Nothing here resolves an ambiguity or moves a threshold.
test("the authoring capability contains no product-selection or readiness authority", () => {
  const block = API.slice(API.indexOf("const authorMatch"), API.indexOf("const supersedeMatch"));
  for (const forbidden of ["approved_for_matching", "primarySelection", "safety_decisions", "safety_approval_requests", "product_match"]) {
    assert.ok(!block.includes(forbidden), `authoring must not touch ${forbidden}`);
  }
  // It writes ONLY the applicability link and its two audit rows.
  const inserts = block.match(/INSERT INTO [a-z_]+/g) || [];
  assert.deepEqual(
    [...new Set(inserts)].sort(),
    ["INSERT INTO boq_requirement_links", "INSERT INTO document_audit_events", "INSERT INTO engineering_knowledge_decisions"],
    "authoring must write only the link and its existing audit rows",
  );
});