// FOCUSED: the governed SURGE evidence, the compound seq-100062 representation, and
// the two read-path repairs that let that evidence actually reach matching.
//
// Every assertion here is about fail-closed behaviour or provenance. Nothing in
// this file asserts that IFP-2100HV "has surge protection"; it asserts that the
// claim is bound to a real first-party source, that it is derived only from the
// requirement's own stored page, and that it cannot be derived without that page.
import test from "node:test";
import assert from "node:assert/strict";

import {
  governedColonListMembers,
  extractRequirementIntelligence,
  buildRequirementIntelligence,
} from "../app/domain/requirement-intelligence-engine.mjs";
import {
  CAPABILITY_RESULT,
  compareBooleanCapability,
  compareRelationalConstraint,
  evaluateCapabilities,
} from "../app/domain/product-matching-engine.mjs";
import {
  fireAlarmCapability,
  isGovernedBooleanCapability,
  isGovernedRelationalConstraint,
} from "../app/domain/fire-alarm-taxonomy.mjs";
import { capabilityClaimFromFact } from "../worker/technical-requirement-api.mjs";

// The verbatim page-4 extraction of "28 46 00 Fire Detection and Alarm System -
// Rev 1" around clause I. Line breaks and trailing spacing are preserved exactly
// as stored, because the derivation anchors on whole lines.
const PAGE_4 = [
  "7. Key presses shall be recorded in the history log. FACP shall have sufficient memory to",
  "support its operating system and databases including:",
  "I. FACP Shall be provided with the following for basic operation:",
  "1. Communication Ports: Offer data communication interfaces to enable the concurrent operation of devices such as industry-standard printers, programming terminals, PCs, transponders, and annunciators.",
  "2. Integrated On-Line Diagnostics: The control panel will continuously run self, communication, and subsidiary equipment diagnostics.",
  "3. Surge and Transient Protection: Isolation will be provided at field terminations to suppress voltage transients as needed.",
  "J. Display Information",
].join("\n");

const LEAD_IN = "FACP Shall be provided with the following for basic operation:";

// `source` mirrors exactly what the governed loader supplies from
// technical_requirements.source_location -- the engine maps `pageFrom` to `page`.
const seq100062 = (over = {}) => ({
  id: "specjob_607ca13c-5c70-49b0-8dc0-a194d3b6ee88_chunk_000001_requirement_62",
  originalText: LEAD_IN,
  normalizedRequirement: LEAD_IN,
  requirementType: "Mandatory",
  requirementCategory: "Technical Requirement",
  source: { pageFrom: 4, pageTo: 4, clause: "I", section: "28 46 00 SECTION 28 46 00" },
  ...over,
});

const CAP_PREFIX = "Capability: ";
const capFacts = (facts) => facts.filter((f) => String(f.factType).startsWith(CAP_PREFIX));
const capKeys = (facts) => capFacts(facts).map((f) => String(f.factType).slice(CAP_PREFIX.length)).sort();

// ─────────────────────────────────────────────────────────────────────────────
// 1. SURGE EVIDENCE: scope and grade, never overclaimed
// ─────────────────────────────────────────────────────────────────────────────

test("the surge capability exists in the governed vocabulary with a real meaning", () => {
  const definition = fireAlarmCapability("panel_transient_protection");
  assert.ok(definition, "panel_transient_protection must be a governed capability");
  assert.equal(isGovernedBooleanCapability("panel_transient_protection"), true);
  assert.ok(definition.meaning && definition.meaning.length > 10, "a capability must state what it means");
});

test("all three seq-100062 members are governed BOOLEAN capabilities, none is relational", () => {
  for (const key of ["panel_communication_ports", "panel_online_diagnostics", "panel_transient_protection"]) {
    assert.equal(isGovernedBooleanCapability(key), true, `${key} must be a governed boolean`);
    assert.equal(isGovernedRelationalConstraint(key), false, `${key} must not be relational`);
  }
});

test("EXACT PAGE-4 SOURCE TEXT: all three members are read verbatim from the stored page", () => {
  const members = governedColonListMembers(seq100062(), PAGE_4);
  assert.equal(members.length, 3);
  assert.match(members[0], /^1\. Communication Ports: Offer data communication interfaces/);
  assert.match(members[1], /^2\. Integrated On-Line Diagnostics: The control panel will continuously run/);
  assert.match(members[2], /^3\. Surge and Transient Protection: Isolation will be provided at field terminations/);
  // Every member must be a substring of the stored page -- never reconstructed.
  for (const member of members) assert.ok(PAGE_4.includes(member), "member text must exist verbatim on the page");
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. COMPOUND REPRESENTATION: three INDEPENDENT required capabilities
// ─────────────────────────────────────────────────────────────────────────────

test("seq 100062 derives exactly the three independent member capabilities", () => {
  const keys = capKeys(extractRequirementIntelligence(seq100062(), PAGE_4));
  assert.deepEqual(keys, ["panel_communication_ports", "panel_online_diagnostics", "panel_transient_protection"]);
});

test("each derived fact binds ITS OWN member text -- no shared or invented evidence", () => {
  const facts = capFacts(extractRequirementIntelligence(seq100062(), PAGE_4));
  const byKey = Object.fromEntries(facts.map((f) => [String(f.factType).slice(CAP_PREFIX.length), f]));
  assert.match(byKey.panel_communication_ports.evidenceSnippet, /^1\. Communication Ports:/);
  assert.match(byKey.panel_online_diagnostics.evidenceSnippet, /^2\. Integrated On-Line Diagnostics:/);
  assert.match(byKey.panel_transient_protection.evidenceSnippet, /^3\. Surge and Transient Protection:/);
  // The three snippets must be three DIFFERENT strings: one member's evidence can
  // never stand in for another's.
  const snippets = Object.values(byKey).map((f) => f.evidenceSnippet);
  assert.equal(new Set(snippets).size, 3);
});

test("every derived capability fact carries the requirement, page, clause and version", () => {
  for (const fact of capFacts(extractRequirementIntelligence(seq100062(), PAGE_4))) {
    assert.equal(fact.requirementId, seq100062().id, "must be bound to seq 100062 itself");
    assert.equal(fact.source.page, 4, "must name the stored source page");
    assert.equal(fact.source.clause, "I", "must name the governing clause");
    assert.equal(fact.value, "true", "each member is a REQUIRED boolean");
    assert.ok(fact.extractionBasis && /inherits the lead-in/i.test(fact.extractionBasis), "must state inherited-modal provenance");
    assert.equal(fact.reviewStatus, "Needs Review", "derivation must never auto-approve");
  }
});

test("a fact derived with NO source provenance reports null page/clause, never a guess", () => {
  const [fact] = capFacts(extractRequirementIntelligence(seq100062({ source: {} }), PAGE_4));
  assert.equal(fact.source.page, null);
  assert.equal(fact.source.clause, null);
});

test("the derived claim survives the governed loader as a real capability claim", () => {
  for (const key of ["panel_communication_ports", "panel_online_diagnostics", "panel_transient_protection"]) {
    const claim = capabilityClaimFromFact({
      fact_type: `Capability: ${key}`,
      current_value: JSON.stringify(true),
      requirement_id: seq100062().id,
      source_page: 4,
      source_clause: "I",
      evidence_snippet: "x",
    });
    assert.ok(claim, `${key} must load as a governed claim`);
    assert.equal(claim.name, key);
    assert.equal(claim.value, true);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. NEGATIVE CONTROLS: the derivation must fail closed, every time
// ─────────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: no stored page text derives nothing at all", () => {
  assert.deepEqual(governedColonListMembers(seq100062(), null), []);
  assert.deepEqual(governedColonListMembers(seq100062(), ""), []);
  assert.deepEqual(capKeys(extractRequirementIntelligence(seq100062(), null)), []);
});

test("NEGATIVE CONTROL: a lead-in without its own trailing colon governs no list", () => {
  const noColon = seq100062({ originalText: LEAD_IN.replace(/:$/, "") });
  assert.deepEqual(governedColonListMembers(noColon, PAGE_4), []);
  assert.deepEqual(capKeys(extractRequirementIntelligence(noColon, PAGE_4)), []);
});

test("NEGATIVE CONTROL: a colon with no governing modal of its own inherits nothing", () => {
  const noModal = seq100062({ originalText: "FACP features to be provided for basic operation:" });
  assert.deepEqual(governedColonListMembers(noModal, PAGE_4), []);
  assert.deepEqual(capKeys(extractRequirementIntelligence(noModal, PAGE_4)), []);
});

test("NEGATIVE CONTROL: 'must' is as good as 'shall' -- the modal test is not 'shall'-only", () => {
  const mustLeadIn = seq100062({ originalText: "FACP Must be provided with the following for basic operation:" });
  assert.equal(governedColonListMembers(mustLeadIn, PAGE_4.replace(LEAD_IN, "FACP Must be provided with the following for basic operation:")).length, 3);
});

test("NEGATIVE CONTROL: a lead-in absent from the page derives nothing (no reach-across-prose)", () => {
  const otherLeadIn = seq100062({ originalText: "FACP Shall be provided with the following for commissioning:" });
  assert.deepEqual(governedColonListMembers(otherLeadIn, PAGE_4), []);
  assert.deepEqual(capKeys(extractRequirementIntelligence(otherLeadIn, PAGE_4)), []);
});

test("NEGATIVE CONTROL: a lead-in whose list starts with unrelated prose is refused", () => {
  // The lead-in line is present, but the very next line is not a member, so the
  // list must not be read by scanning forward for the first numbered line.
  const page = `${LEAD_IN}\nThe control panel shall be installed indoors.\n1. Communication Ports: Offer interfaces.`;
  assert.deepEqual(governedColonListMembers(seq100062(), page), []);
});

test("NEGATIVE CONTROL: an ARTICLE terminator closes the list (J. is not member 4)", () => {
  const members = governedColonListMembers(seq100062(), PAGE_4);
  assert.equal(members.length, 3, "clause J must not be captured as a fourth member");
  assert.ok(!members.some((m) => /Display Information/.test(m)));
});

test("NEGATIVE CONTROL: a WRAPPED lead-in is refused rather than joined across lines", () => {
  // Clause H.7's real lead-in wraps across two stored page lines. Joining them
  // would be an invention, so the compound path must derive NOTHING -- while the
  // requirement's OWN text still legitimately yields its own capability, which is
  // the point: the compound path adds nothing here rather than guessing.
  const wrapped = "FACP shall have sufficient memory to\nsupport its operating system and databases including:\n1. Memory\n2. Historical data\n3. Operator I/O";
  const req = seq100062({
    id: "specjob_607ca13c-5c70-49b0-8dc0-a194d3b6ee88_chunk_000001_requirement_61",
    originalText: "FACP shall have sufficient memory to support its operating system and databases including:",
  });
  assert.deepEqual(governedColonListMembers(req, wrapped), [], "a wrapped lead-in is not a verbatim single-line match");
  // Only the own-text rule fires -- no compound member is derived from the page.
  assert.deepEqual(capKeys(extractRequirementIntelligence(req, wrapped)), ["panel_database_support"]);
});

test("NEGATIVE CONTROL: an ungoverned member key can never be derived", () => {
  const page = `${LEAD_IN}\n1. Something The Vocabulary Does Not Know: Offer a widget.`;
  assert.deepEqual(capKeys(extractRequirementIntelligence(seq100062(), page)), []);
});

test("NON-COLLATERAL: the other clause-I and clause-H members are untouched by this derivation", () => {
  const req58 = {
    id: "specjob_607ca13c-5c70-49b0-8dc0-a194d3b6ee88_chunk_000001_requirement_58",
    originalText: "FACP shall be provided with a local operator display and operator control switches",
    normalizedRequirement: "FACP shall be provided with a local operator display and operator control switches",
  };
  assert.deepEqual(capKeys(extractRequirementIntelligence(req58, PAGE_4)), ["local_operator_display", "panel_operator_switches"]);
  // ...and with no page text at all it is identical, proving the new path changed
  // nothing for a requirement that never needed it.
  assert.deepEqual(capKeys(extractRequirementIntelligence(req58, null)), ["local_operator_display", "panel_operator_switches"]);
});

test("buildRequirementIntelligence is not fooled by flatMap's index argument", () => {
  // `flatMap(fn)` would pass the array INDEX as the page text, so index 1 would be
  // the string "1" -- a truthy page. The lookup is explicit, so no index leaks in.
  const requirements = [seq100062(), seq100062({ id: "x_requirement_61" })];
  assert.deepEqual(capKeys(buildRequirementIntelligence(requirements).facts), [], "no map -> no compound capability");
  assert.deepEqual(capKeys(buildRequirementIntelligence(requirements, {}).facts), [], "a plain object is not a map -> fail closed");
  assert.equal(capKeys(buildRequirementIntelligence(requirements, new Map([[seq100062().id, PAGE_4]])).facts).length, 3);
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. THE READ-PATH REPAIR: governed Product Knowledge must reach matching
// ─────────────────────────────────────────────────────────────────────────────

const governedProduct = (reviewed) => ({
  id: "product_ec9dcbb1-39fe-4d24-b369-8b3d271604a7",
  partNumber: "IFP-2100HV",
  manufacturer: "Honeywell",
  attributes: [{ name: "Voltage", normalizedValue: 240 }],
  reviewedAttributes: reviewed,
  standards: [],
});

const SURGE_ATTR = {
  name: "panel_transient_protection",
  normalizedValue: "true",
  confidence: 88,
  attributeId: "attribute_fe5e464b-984a-45a3-a611-10573fc491f8",
  authority: "Governed Product Knowledge",
  sourceId: "productsource_9acccc35-95ca-4320-b2cc-816ff121f73d",
  decidedBy: "omair-primary",
  decidedRole: "Administrator",
  decidedAt: "2026-10-02T20:59:11.043Z",
};

test("THE REPAIR: an APPROVED governed attribute is now visible to the matcher", () => {
  const outcome = compareBooleanCapability({ name: "panel_transient_protection", value: true }, governedProduct([SURGE_ATTR]));
  assert.equal(outcome.result, CAPABILITY_RESULT.Compliant);
  assert.equal(outcome.pass, true);
  assert.equal(outcome.blocking, false);
});

test("THE REPAIR: the compliant verdict names the exact attribute, source and reviewer", () => {
  const outcome = compareBooleanCapability({ name: "panel_transient_protection", value: true }, governedProduct([SURGE_ATTR]));
  assert.equal(outcome.evidence.productAttributeId, SURGE_ATTR.attributeId);
  assert.equal(outcome.evidence.productEvidenceSourceId, SURGE_ATTR.sourceId);
  assert.equal(outcome.evidence.productEvidenceDecidedBy, "omair-primary");
});

test("THE REPAIR: without the governed attribute the comparison still fails closed", () => {
  const outcome = compareBooleanCapability({ name: "panel_transient_protection", value: true }, governedProduct([]));
  assert.equal(outcome.result, CAPABILITY_RESULT.InsufficientEvidence);
  assert.equal(outcome.pass, false);
  assert.equal(outcome.blocking, false, "absent evidence must never become a blocking failure");
  assert.match(outcome.evidence.reason, /carries no evidence/i);
});

test("THE REPAIR: ungoverned keys are refused, never fuzzily matched", () => {
  const outcome = compareBooleanCapability({ name: "panel_transient_protect", value: true }, governedProduct([SURGE_ATTR]));
  assert.equal(outcome.result, CAPABILITY_RESULT.InsufficientEvidence);
  assert.match(outcome.evidence.reason, /not in the governed canonical capability vocabulary/i);
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. INDEPENDENCE: one absent member must fail on its own, never compound-pass
// ─────────────────────────────────────────────────────────────────────────────

test("INDEPENDENCE: each member is evaluated on its own evidence, with no compound pass", () => {
  const requirements = [
    {
      id: "consolidated:facp-basic-operation",
      originalText: LEAD_IN,
      capabilities: [
        { name: "panel_communication_ports", value: true, source: { page: 4, clause: "I", evidenceSnippet: "1. Communication Ports: ..." } },
        { name: "panel_online_diagnostics", value: true, source: { page: 4, clause: "I", evidenceSnippet: "2. Integrated On-Line Diagnostics: ..." } },
        { name: "panel_transient_protection", value: true, source: { page: 4, clause: "I", evidenceSnippet: "3. Surge and Transient Protection: ..." } },
      ],
    },
  ];
  const outcomes = evaluateCapabilities(requirements, governedProduct([SURGE_ATTR]));
  assert.equal(outcomes.length, 3, "one comparison per member, never one for the compound");

  const byKey = Object.fromEntries(outcomes.map((o) => [o.capabilityName, o]));
  // Only the surge member has product evidence.
  assert.equal(byKey.panel_transient_protection.result, CAPABILITY_RESULT.Compliant);
  assert.equal(byKey.panel_communication_ports.result, CAPABILITY_RESULT.InsufficientEvidence);
  assert.equal(byKey.panel_online_diagnostics.result, CAPABILITY_RESULT.InsufficientEvidence);

  // Two compliant members out of three must NOT yield a compound pass.
  const passed = outcomes.filter((o) => o.pass).length;
  assert.equal(passed, 1);
  assert.ok(!outcomes.some((o) => o.result === CAPABILITY_RESULT.Compliant && o.pass && passed < outcomes.length && o.compound === true));
});

test("INDEPENDENCE: withdrawing ONE member leaves the other two verdicts untouched", () => {
  const claims = [
    { name: "panel_communication_ports", value: true, source: { page: 4, clause: "I" } },
    { name: "panel_online_diagnostics", value: true, source: { page: 4, clause: "I" } },
    { name: "panel_transient_protection", value: true, source: { page: 4, clause: "I" } },
  ];
  const requirement = (list) => [{ id: "consolidated:x", originalText: LEAD_IN, capabilities: list }];
  const product = governedProduct([
    SURGE_ATTR,
    { name: "panel_communication_ports", normalizedValue: "true", attributeId: "attr_ports", authority: "Governed Product Knowledge" },
  ]);
  // Drop ONLY the diagnostics member from the requirement side.
  const without = evaluateCapabilities(requirement(claims.filter((c) => c.name !== "panel_online_diagnostics")), product);
  assert.equal(without.length, 2);
  assert.deepEqual(without.map((o) => o.capabilityName).sort(), ["panel_communication_ports", "panel_transient_protection"]);
  assert.ok(without.every((o) => o.result === CAPABILITY_RESULT.Compliant));
  // The verdict for the surviving members is identical with or without the third.
  const all = evaluateCapabilities(requirement(claims), product);
  for (const name of ["panel_communication_ports", "panel_transient_protection"]) {
    assert.equal(without.find((o) => o.capabilityName === name).result, all.find((o) => o.capabilityName === name).result);
  }
});

test("INDEPENDENCE: a required-true member against a product false is BLOCKING", () => {
  const product = governedProduct([{ ...SURGE_ATTR, normalizedValue: "false" }]);
  const outcome = compareBooleanCapability({ name: "panel_transient_protection", value: true }, product);
  assert.equal(outcome.result, CAPABILITY_RESULT.NonCompliant);
  assert.equal(outcome.pass, false);
  assert.equal(outcome.blocking, true, "a genuine capability failure must block");
});

test("INDEPENDENCE: conflicting governed values fail closed instead of one silently winning", () => {
  const product = governedProduct([SURGE_ATTR, { ...SURGE_ATTR, attributeId: "attr_other", normalizedValue: "false" }]);
  const outcome = compareBooleanCapability({ name: "panel_transient_protection", value: true }, product);
  assert.equal(outcome.result, CAPABILITY_RESULT.InsufficientEvidence);
  assert.match(outcome.evidence.reason, /conflicting values/i);
  assert.equal(outcome.blocking, false);
});

test("the relational constraint reads its reference value from governed knowledge too", () => {
  const claim = { name: "related_enclosure_colour_match", value: "required", referencedAttribute: "cabinet_color", normalizedRequirement: "enclosure colour must match" };
  const withColour = compareRelationalConstraint(claim, governedProduct([{ name: "cabinet_color", normalizedValue: "Red", attributeId: "attr_red", authority: "Governed Product Knowledge" }]));
  assert.equal(withColour.result, CAPABILITY_RESULT.Compliant);
  assert.equal(withColour.evidence.referenceValue, "Red");
  // ...and it is never asserted as satisfied: it is explicitly a project-level check.
  assert.match(withColour.evidence.projectLevelCheck, /NOT asserted/i);

  const unresolved = compareRelationalConstraint(claim, governedProduct([{ name: "cabinet_color", normalizedValue: "TBD", attributeId: "attr_tbd" }]));
  assert.equal(unresolved.result, CAPABILITY_RESULT.InsufficientEvidence, "an unresolved reference value is not a reference");
});

test("comparison rows carry the specification provenance that demanded the capability", () => {
  const [outcome] = evaluateCapabilities(
    [{ id: "consolidated:x", governingSourceId: seq100062().id, originalText: LEAD_IN, capabilities: [{ name: "panel_transient_protection", value: true, source: { page: 4, clause: "I", section: "28 46 00", evidenceSnippet: "3. Surge and Transient Protection: Isolation will be provided..." } }] }],
    governedProduct([SURGE_ATTR]),
  );
  assert.equal(outcome.governingRequirementId, "consolidated:x");
  assert.equal(outcome.evidence.governingRequirementDbId, seq100062().id, "must resolve to a real technical_requirements row");
  assert.equal(outcome.evidence.capabilityRequirementSource.page, 4);
  assert.equal(outcome.evidence.capabilityRequirementSource.clause, "I");
  assert.match(outcome.evidence.capabilityRequirementSource.evidenceSnippet, /^3\. Surge and Transient Protection:/);
});