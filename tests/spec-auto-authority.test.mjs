import assert from "node:assert/strict";
import test from "node:test";
import {
  SPEC_AMBIGUOUS_OR_CONFLICTED,
  SPEC_AUTO_AUTHORITY_ACTOR,
  SPEC_AUTO_AUTHORITY_ACTOR_TYPE,
  SPEC_AUTO_AUTHORITY_POLICY,
  SPEC_SEMANTIC_REASONING_REQUIRED,
  SPEC_STALE_OR_REFUSED,
  evaluateSpecAutoAuthority,
  resolveSpecificationRevisionBinding,
} from "../app/domain/spec-auto-authority.mjs";

// SPEC_AUTO_AUTHORITY_V1 -- governed auto-authority for deterministically extracted
// specification requirements.
//
// THE CENTRAL RULE UNDER TEST: model confidence can never GRANT authority. A doubt flag
// may only WITHHOLD it. Every eligibility gate is a deterministic check against
// persisted provenance and currentness.

const CURRENT_REVISION = {
  resolved: true, isCurrent: true, code: "REVISION_CURRENT",
  extractionVersionId: "specextract_1", documentId: "doc_1",
  documentVersionId: "ver_1", currentDocumentVersionId: "ver_1",
  documentLogicalName: "28 46 00 - Rev 1.pdf", reason: "bound",
};
const STALE_REVISION = { resolved: true, isCurrent: false, code: "REVISION_STALE", extractionVersionId: "specextract_1", reason: "superseded document version" };

const requirement = (over = {}) => ({
  id: "req_1", project_id: "p1", clause_id: "clause_3",
  source_location: JSON.stringify({ pageFrom: 4, pageTo: 4, section: "28 46 00", clause: "3", originalClauseText: "The system shall be addressable." }),
  original_text: "The system shall be addressable.",
  extraction_version_id: "specextract_1",
  requirement_type: "Mandatory",
  domain_source_type: "Inherited From Document",
  confidence_state: "High Confidence", confidence: 91,
  condition: null, exception: null,
  ...over,
});
const canonicalEligible = { eligible: true, reason: "All gates passed" };
const canonicalRefused = (reason) => ({ eligible: false, reason });
const evaluate = (over = {}, extra = {}) =>
  evaluateSpecAutoAuthority({ requirement: requirement(over), canonical: canonicalEligible, revision: CURRENT_REVISION, ...extra });

test("1: a fully evidenced deterministic requirement is eligible", () => {
  const e = evaluate();
  assert.equal(e.eligible, true, JSON.stringify(e.failedGates));
  assert.equal(e.classification, "AUTO_AUTHORITY_ELIGIBLE");
  assert.equal(e.decisionActorType, SPEC_AUTO_AUTHORITY_ACTOR_TYPE);
  assert.equal(e.humanActor, null);
});

test("1b: missing provenance cannot auto-approve", () => {
  for (const [label, over] of [
    ["no clause_id", { clause_id: null }],
    ["no source_location", { source_location: null }],
    ["unparseable source_location", { source_location: "not-json" }],
    ["no page in source_location", { source_location: JSON.stringify({ section: "x" }) }],
    ["no original_text", { original_text: "   " }],
    ["no extraction_version_id", { extraction_version_id: null }],
  ]) {
    const e = evaluate(over);
    assert.equal(e.eligible, false, `${label} must not auto-approve`);
    assert.equal(e.classification, SPEC_SEMANTIC_REASONING_REQUIRED, label);
  }
});

test("2: a stale document/extraction cannot auto-approve", () => {
  const stale = evaluate({}, { revision: STALE_REVISION });
  assert.equal(stale.eligible, false);
  assert.equal(stale.classification, SPEC_STALE_OR_REFUSED);
  const unresolved = evaluate({}, { revision: { resolved: false, code: "EXTRACTION_VERSION_NOT_FOUND", reason: "gone" } });
  assert.equal(unresolved.eligible, false);
  assert.equal(unresolved.classification, SPEC_STALE_OR_REFUSED);
  // The canonical floor independently refuses a non-current extraction.
  const canonicalRefuses = evaluate({}, { canonical: canonicalRefused("Stale extraction version") });
  assert.equal(canonicalRefuses.eligible, false);
});

test("3: an Inferred (semantically interpreted) requirement cannot pass", () => {
  const e = evaluate({ domain_source_type: "Inferred" });
  assert.equal(e.eligible, false);
  assert.ok(e.failedGates.includes("domain_source_deterministic"));
  assert.equal(e.classification, SPEC_SEMANTIC_REASONING_REQUIRED);
});

test("4: Conditional cannot pass", () => {
  const e = evaluate({ requirement_type: "Conditional", condition: "Where required by the authority" });
  assert.equal(e.eligible, false);
  assert.ok(e.failedGates.includes("not_ambiguous_type"));
  assert.equal(e.classification, SPEC_AMBIGUOUS_OR_CONFLICTED);
});

test("5: Clarification Required cannot pass", () => {
  const e = evaluate({ requirement_type: "Clarification Required" });
  assert.equal(e.eligible, false);
  assert.equal(e.classification, SPEC_AMBIGUOUS_OR_CONFLICTED);
});

test("6: Prohibited cannot pass", () => {
  const e = evaluate({ requirement_type: "Prohibited" });
  assert.equal(e.eligible, false);
  assert.equal(e.classification, SPEC_AMBIGUOUS_OR_CONFLICTED);
});

test("7: a flagged extraction doubt (Needs Review) cannot pass", () => {
  // Fail-CLOSED use of a doubt signal. It withholds authority and never confers it.
  const e = evaluate({ confidence_state: "Needs Review", confidence: 53 });
  assert.equal(e.eligible, false);
  assert.ok(e.failedGates.includes("extraction_doubt_cleared"));
});

test("7b: open ambiguity or conflict cannot pass", () => {
  assert.equal(evaluate({}, { openAmbiguity: true }).eligible, false);
  assert.equal(evaluate({}, { openConflict: true }).eligible, false);
  assert.equal(evaluate({}, { openAmbiguity: true }).classification, SPEC_AMBIGUOUS_OR_CONFLICTED);
  assert.equal(evaluate({}, { openConflict: true }).classification, SPEC_AMBIGUOUS_OR_CONFLICTED);
});

test("8: model confidence cannot affect approval", () => {
  // A confidence value on its own must never flip eligibility in EITHER direction.
  const low = evaluate({ confidence: 1, confidence_state: "Low Confidence" });
  const high = evaluate({ confidence: 100, confidence_state: "High Confidence" });
  assert.equal(low.eligible, true, "a low numeric score must not block");
  assert.equal(high.eligible, true);
  // The ONLY confidence-derived input that matters is the explicit doubt flag, and it
  // only ever withholds.
  const doubted = evaluate({ confidence: 100, confidence_state: "Needs Review" });
  assert.equal(doubted.eligible, false, "high numeric score must not override a doubt flag");
  // No decision field exposes a score that could be laundered into authority.
  for (const key of Object.keys(evaluate())) {
    assert.doesNotMatch(key, /confidence|score|probab/i, `decision must not expose ${key}`);
  }
});

test("9: the policy actor is a system policy and can never be a human", () => {
  assert.equal(SPEC_AUTO_AUTHORITY_POLICY, "SPEC_AUTO_AUTHORITY_V1");
  assert.equal(SPEC_AUTO_AUTHORITY_ACTOR_TYPE, "SYSTEM_POLICY");
  assert.notEqual(SPEC_AUTO_AUTHORITY_ACTOR, "omair");
  assert.notEqual(SPEC_AUTO_AUTHORITY_ACTOR, "Omair");
  assert.notEqual(SPEC_AUTO_AUTHORITY_ACTOR, "local-development-user");
  assert.match(SPEC_AUTO_AUTHORITY_ACTOR, /^system:/);
  const approved = evaluate();
  assert.equal(approved.decisionActor, SPEC_AUTO_AUTHORITY_ACTOR);
  assert.equal(approved.humanActor, null);
  // A refused evaluation grants no authority at all.
  const refused = evaluate({ domain_source_type: "Inferred" });
  assert.equal(refused.decisionActor, null);
  assert.equal(refused.decisionActorType, null);
});

test("10: the canonical floor is mandatory and cannot be bypassed", () => {
  // A row that passes every provenance gate is STILL refused when the canonical
  // spec auto-confirm policy refuses it. The floor is never weakened.
  const e = evaluate({}, { canonical: canonicalRefused("Weak phrasing detected") });
  assert.equal(e.eligible, false);
  assert.ok(e.failedGates.includes("canonical_policy_eligible"));
  assert.equal(e.canonicalPolicyVersion, "spec-requirement-auto-confirm-1.0.0");
});

test("11: revision resolves through extraction_version_id, never a client string", async () => {
  const statements = [];
  // A fake DB that returns rows by table, so the whole resolution chain is exercised.
  const fakeDb = (rows) => ({
    prepare(sql) {
      const flat = sql.replace(/\s+/g, " ").trim();
      statements.push(flat);
      const table = flat.includes("specification_extraction_versions") ? "specification_extraction_versions"
        : flat.includes("FROM documents") ? "documents" : "other";
      return { bind: (...args) => ({ first: async () => rows[table] ?? null }) };
    },
  });

  // Missing extraction id fails closed without touching the database.
  const before = statements.length;
  const missing = await resolveSpecificationRevisionBinding(fakeDb({}), { extractionVersionId: null });
  assert.equal(missing.resolved, false);
  assert.equal(missing.code, "EXTRACTION_VERSION_MISSING");
  assert.equal(statements.length, before, "a missing id must not be resolved by querying");

  // Unknown extraction fails closed.
  const unknown = await resolveSpecificationRevisionBinding(fakeDb({}), { extractionVersionId: "specextract_missing" });
  assert.equal(unknown.resolved, false);
  assert.equal(unknown.code, "EXTRACTION_VERSION_NOT_FOUND");

  // Superseded extraction fails closed.
  const superseded = await resolveSpecificationRevisionBinding(fakeDb({
    specification_extraction_versions: { id: "e1", document_id: "d1", document_version_id: "v1", status: "Completed", superseded_at: "2026-01-01", version_number: 1 },
  }), { extractionVersionId: "e1" });
  assert.equal(superseded.resolved, false);
  assert.equal(superseded.code, "EXTRACTION_VERSION_SUPERSEDED");

  // Incomplete extraction fails closed.
  const incomplete = await resolveSpecificationRevisionBinding(fakeDb({
    specification_extraction_versions: { id: "e1", document_id: "d1", document_version_id: "v1", status: "Failed", superseded_at: null, version_number: 1 },
  }), { extractionVersionId: "e1" });
  assert.equal(incomplete.resolved, false);
  assert.equal(incomplete.code, "EXTRACTION_VERSION_NOT_COMPLETED");

  // A deleted source document fails closed.
  const deleted = await resolveSpecificationRevisionBinding(fakeDb({
    specification_extraction_versions: { id: "e1", document_id: "d1", document_version_id: "v1", status: "Completed", superseded_at: null, version_number: 1 },
    documents: { id: "d1", logical_name: "x.pdf", current_version_id: "v1", deleted_at: "2026-01-01", archived_at: null },
  }), { extractionVersionId: "e1" });
  assert.equal(deleted.resolved, false);
  assert.equal(deleted.code, "SOURCE_DOCUMENT_NOT_CURRENT");

  // CURRENT: extraction bound to the document's current version.
  const current = await resolveSpecificationRevisionBinding(fakeDb({
    specification_extraction_versions: { id: "e1", document_id: "d1", document_version_id: "v1", status: "Completed", superseded_at: null, version_number: 2, parser_version: "spec-engine-1.0.1" },
    documents: { id: "d1", logical_name: "28 46 00 - Rev 1.pdf", current_version_id: "v1", deleted_at: null, archived_at: null },
  }), { extractionVersionId: "e1" });
  assert.equal(current.resolved, true);
  assert.equal(current.isCurrent, true);
  assert.equal(current.code, "REVISION_CURRENT");
  assert.equal(current.documentVersionId, "v1");
  assert.equal(current.currentDocumentVersionId, "v1");
  assert.equal(current.documentLogicalName, "28 46 00 - Rev 1.pdf");
  assert.equal(current.extractionVersionNumber, 2);

  // STALE: extraction bound to an OLDER document version.
  const stale = await resolveSpecificationRevisionBinding(fakeDb({
    specification_extraction_versions: { id: "e1", document_id: "d1", document_version_id: "v0", status: "Completed", superseded_at: null, version_number: 1 },
    documents: { id: "d1", logical_name: "x.pdf", current_version_id: "v1", deleted_at: null, archived_at: null },
  }), { extractionVersionId: "e1" });
  assert.equal(stale.resolved, true);
  assert.equal(stale.isCurrent, false);
  assert.equal(stale.code, "REVISION_STALE");

  // The chain is walked through persisted rows only; no caller-supplied revision exists.
  const bound = statements.join(" ");
  assert.match(bound, /specification_extraction_versions/);
  assert.match(bound, /current_version_id/);
  assert.doesNotMatch(bound, /source_revision/, "revision must never be read from the requirement row");
});

test("12: every gate is reported and the decision carries provenance + currentness", () => {
  const e = evaluate();
  const names = e.gates.map((g) => g.name);
  for (const required of [
    "clause_id_present", "source_location_present", "source_page_present", "original_text_present",
    "extraction_version_present", "revision_resolved", "revision_current", "domain_source_deterministic",
    "extraction_doubt_cleared", "not_ambiguous_type", "no_open_ambiguity", "no_open_conflict",
    "canonical_policy_eligible",
  ]) assert.ok(names.includes(required), `missing gate: ${required}`);
  assert.equal(e.policyId, SPEC_AUTO_AUTHORITY_POLICY);
  assert.equal(e.revision.code, "REVISION_CURRENT");
  assert.equal(e.revision.documentVersionId, "ver_1");
  // A refusal always names WHY, so nothing is silently parked.
  const refused = evaluate({ domain_source_type: "Inferred" });
  assert.ok(refused.failedGates.length > 0);
  assert.ok(refused.gates.every((g) => typeof g.reason === "string" && g.reason.length > 0));
});