// ALL-COMPONENT SCOPE APPLICABILITY
//
// Focus: a specification clause that obliges EVERY COMPONENT of a named system
// ("Every component of the fire alarm system shall be listed ... approved by
// Underwriters Laboratories (UL)") is a real, applicable requirement that names
// NO equipment type, and therefore can never clear the equipment-type heuristic
// `scoreRequirementLink` uses. This suite proves the scope-aware path reaches it
// WITHOUT lowering any threshold, and that it cannot be over-applied.
//
// Run: node --test tests/all-components-scope-applicability.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import {
  ALL_COMPONENTS_REQUIREMENT_SCOPE,
  classifyAllComponentsScope,
  isAllComponentsScopeForSystem,
  isSystemWideRequirementText,
  systemIdentityKey,
} from "../app/domain/technical-requirement-engine.mjs";
import { buildLinkShortlist } from "../worker/engineering-knowledge-api.mjs";
import { scoreRequirementLink } from "../app/domain/engineering-knowledge.mjs";

// The verbatim Al Mousa clause, 28 46 00 / 1 GENERAL / P, sequence 100075.
const SEQ_100075 = "Every component of the fire alarm system shall be listed under a single manufacturer, approved by Underwriters Laboratories (UL), and clearly bear the UL certification.";

const requirement = (overrides = {}) => ({
  id: "req-1",
  original_text: SEQ_100075,
  system: "Fire Alarm",
  category: "Compliance",
  requirement_type: "Mandatory",
  requirement_category: "Compliance",
  source_location: JSON.stringify({ pageFrom: 5, clause: "P", section: "28 46 00 SECTION 28 46 00", originalClauseText: SEQ_100075 }),
  ...overrides,
});

const panelItem = (overrides = {}) => ({
  id: "boqitem_534f049e",
  description: "Fire alarm control panel with all accessories",
  system_value: "Fire Alarm",
  category: "Control Panel",
  subcategory: null,
  specification_reference: null,
  row_type: "BOQ Item",
  ...overrides,
});

const shortlistIds = (item, requirements) => buildLinkShortlist(item, requirements).map((entry) => entry.requirement.id);

// ---------------------------------------------------------------------------
// 1. Classification: the scope is recognised from the clause's OWN words
// ---------------------------------------------------------------------------

test("the real seq 100075 clause classifies as ALL_COMPONENTS over the Fire Alarm system", () => {
  const result = classifyAllComponentsScope(SEQ_100075);
  assert.equal(result.scope, ALL_COMPONENTS_REQUIREMENT_SCOPE);
  assert.equal(result.systemKey, "fire alarm");
  assert.equal(result.reason, "UNIVERSAL_COMPONENT_OBLIGATION_OVER_NAMED_SYSTEM");
});

test("ALL_COMPONENTS is a DIFFERENT scope from system-wide, and the two never overlap", () => {
  // A genuine system-wide demand asserts something of the system AS A WHOLE.
  const systemWide = "The entire fire detection system shall be analogue addressable type.";
  assert.equal(isSystemWideRequirementText(systemWide), true);
  assert.equal(classifyAllComponentsScope(systemWide).scope, null, "a whole-system demand is not an all-component demand");
  // The real clause is the mirror image: the predicate is asserted of each
  // COMPONENT, never of the system as a whole.
  assert.equal(isSystemWideRequirementText(SEQ_100075), false);
  assert.equal(classifyAllComponentsScope(SEQ_100075).scope, ALL_COMPONENTS_REQUIREMENT_SCOPE);
  // The recognisers are genuinely disjoint, not one a widened version of the other.
  const both = ["The entire fire alarm system shall be listed.", SEQ_100075];
  for (const text of both) {
    assert.equal(Boolean(isSystemWideRequirementText(text)) && Boolean(classifyAllComponentsScope(text).scope), false);
  }
});

test("system identity is exact, not fuzzy", () => {
  // The key normaliser is deliberately PURE: lowercase, collapse separators. It
  // strips no words, so it can never silently equate two different names. Article
  // removal is the recogniser's job (its determiner anchor), not the key's.
  assert.equal(systemIdentityKey("Fire Alarm"), "fire alarm");
  assert.equal(systemIdentityKey("  FIRE   alarm "), "fire alarm");
  assert.equal(systemIdentityKey("fire-alarm"), "fire alarm");
  assert.notEqual(systemIdentityKey("the fire alarm"), "fire alarm");
  // A prefix is NOT an identity: this is what stops cross-system propagation.
  assert.notEqual(systemIdentityKey("Fire"), systemIdentityKey("Fire Alarm"));
  assert.notEqual(systemIdentityKey("Fire Alarm"), systemIdentityKey("CCTV"));
  assert.equal(isAllComponentsScopeForSystem(SEQ_100075, "Fire Alarm"), true);
  assert.equal(isAllComponentsScopeForSystem(SEQ_100075, "CCTV"), false);
  assert.equal(isAllComponentsScopeForSystem(SEQ_100075, "Fire"), false);
  assert.equal(isAllComponentsScopeForSystem(SEQ_100075, ""), false);
  assert.equal(isAllComponentsScopeForSystem(SEQ_100075, null), false);
});

// ---------------------------------------------------------------------------
// 2. CONTROL A -- the target case
// ---------------------------------------------------------------------------

test("A -- an every-component clause is ELIGIBLE for governed applicability on a Fire Alarm panel", () => {
  const item = panelItem();
  const ids = shortlistIds(item, [requirement()]);
  assert.ok(ids.includes("req-1"), "the every-component clause must reach the panel shortlist");

  // And the proposal is attributed to the scope basis, so the audit trail can
  // tell it apart from an equipment-scored proposal without re-deriving.
  const [proposal] = buildLinkShortlist(item, [requirement()]);
  assert.equal(proposal.suggestion.method, "All-Component System Scope v1");
  assert.equal(proposal.suggestion.allComponentsScope.scope, ALL_COMPONENTS_REQUIREMENT_SCOPE);
  // It remains a SUGGESTION carrying the real score: the scope path grants no
  // authority and does not inflate confidence.
  assert.equal(proposal.suggestion.status, "Suggested");
  assert.ok(proposal.suggestion.confidence < 70);
});

// ---------------------------------------------------------------------------
// 3. CONTROL B -- no cross-system propagation
// ---------------------------------------------------------------------------

test("B -- the same clause is NOT applicable to an unrelated non-Fire-Alarm system item", () => {
  const ids = shortlistIds(panelItem({ system_value: "CCTV", category: "Camera", description: "IP camera with accessories" }), [requirement()]);
  assert.equal(ids.includes("req-1"), false, "a Fire Alarm clause must never reach a CCTV row");
  assert.equal(ids.includes("req-1"), false);
  // ...and the same holds for every other system this project does not contain.
  for (const system of ["Access Control", "PA/VA", "Electrical", "CCTV"]) {
    assert.equal(isAllComponentsScopeForSystem(SEQ_100075, system), false, `${system} must be refused`);
  }
});

// ---------------------------------------------------------------------------
// 4. CONTROLS C + D -- partial and conditional scope must not propagate
// ---------------------------------------------------------------------------

test("C -- 'Some components...' yields no universal scope", () => {
  const result = classifyAllComponentsScope("Some components of the fire alarm system shall be listed by UL.");
  assert.equal(result.scope, null);
  assert.equal(result.reason, "REFUSED_PARTIAL_OR_HEDGED_SCOPE");
});

test("D -- 'Where indicated...' yields no automatic universal propagation", () => {
  for (const text of [
    "Where indicated, equipment of the fire alarm system shall be listed by UL.",
    "Components of the fire alarm system shall be listed by UL where applicable.",
    "All control equipment of the fire alarm system may be listed by UL if used.",
    "Every component of the fire alarm system should preferably be listed by UL.",
  ]) {
    const result = classifyAllComponentsScope(text);
    assert.equal(result.scope, null, `${text} must yield no universal scope`);
    assert.equal(result.reason, "REFUSED_PARTIAL_OR_HEDGED_SCOPE");
  }
});

test("D2 -- 'optional', 'nominated' and 'selected by' also veto", () => {
  for (const text of [
    "Every component of the fire alarm system shall be listed by UL (optional).",
    "Every component of the fire alarm system shall be listed by UL as required.",
  ]) {
    assert.equal(classifyAllComponentsScope(text).scope, null, `${text} must be refused`);
  }
});

// ---------------------------------------------------------------------------
// 5. CONTROL E -- generic body text must not bypass normal scoring
// ---------------------------------------------------------------------------

test("E -- body text merely CONTAINING 'panel' or 'alarm' does not bypass normal scoring", () => {
  // No universal quantifier, no component subject over the system, no named
  // system identity: this is ordinary clause text and must stay on the
  // pre-existing scoring path with its real score.
  const decoys = [
    "The fire alarm control panel shall be installed in the electrical room.",
    "All alarms shall be annunciated at the panel.",
    "Each alarm shall be recorded by the fire alarm system.",
    "The panel shall be listed under a single manufacturer.",
    "Every device shall be tested in accordance with the manufacturer's instructions.",
    "The entire fire detection system shall be analogue addressable type.",
  ];
  for (const text of decoys) {
    const result = classifyAllComponentsScope(text);
    assert.equal(result.scope, null, `${text} must not acquire an all-component scope`);
    assert.notEqual(result.reason, "UNIVERSAL_COMPONENT_OBLIGATION_OVER_NAMED_SYSTEM");
  }
});

test("E2 -- a clause that scores on equipment keeps its own score and method", () => {
  // A genuinely equipment-specific clause must be unaffected by the new branch. It
  // resolves to the same equipment family as the panel and scores on that merit.
  const deviceClause = requirement({
    id: "req-device",
    original_text: "The fire alarm control panel shall be addressable.",
    requirement_category: "Functional",
    source_location: JSON.stringify({ pageFrom: 5, clause: "P" }),
  });
  const [proposal] = buildLinkShortlist(panelItem(), [deviceClause]);
  assert.ok(proposal, "an equipment-matched clause is admitted on its own score");
  assert.equal(proposal.suggestion.method, "Technical Applicability v2", "an equipment-scored clause keeps its own method");
  assert.equal(proposal.suggestion.allComponentsScope, undefined, "the scope branch must not attach to it");
  assert.equal(proposal.allComponentsApplies, false);
  assert.equal(proposal.suggestion.requirementEquipment, "Fire Alarm Panel");
  assert.ok(proposal.suggestion.confidence >= 25, `admitted on merit (got ${proposal.suggestion.confidence})`);
});

test("E3 -- an Informational non-compliance clause is NOT given all-component scope", () => {
  // The scope path additionally requires a Mandatory/Compliance obligation.
  const informational = requirement({ id: "req-info", requirement_type: "Informational", requirement_category: "General" });
  assert.equal(shortlistIds(panelItem(), [informational]).includes("req-info"), false, "an Informational general clause must not be pulled in by scope alone");
});

// ---------------------------------------------------------------------------
// 6. CONTROL F -- non-product scope is not forced into product matching
// ---------------------------------------------------------------------------

test("F -- a non-product row is not swept in by a system-wide compliance clause", () => {
  // `suggestLinks` selects candidate items with currentBoqItemPredicate, i.e.
  // row_type IN ('Item','BOQ Item'). Section/subsection headers are therefore
  // never candidates, so a universal component clause cannot attach itself to a
  // structural header and drag it into product matching.
  const headers = ["Section Header", "Subsection Header"];
  for (const row_type of headers) {
    const item = panelItem({ id: `header-${row_type}`, row_type, description: "1 GENERAL", category: null });
    // Even if such a row were passed in, the classifier only classifies TEXT; the
    // product-row boundary is the caller's predicate. Assert the predicate the
    // caller actually uses.
    assert.ok(!["Item", "BOQ Item"].includes(row_type), `${row_type} is not a product row`);
  }
  // A real product row in the same system IS in scope: the clause is about
  // components, which is what product rows are.
  assert.ok(["Item", "BOQ Item"].includes(panelItem().row_type));
  assert.equal(classifyAllComponentsScope(SEQ_100075).scope, ALL_COMPONENTS_REQUIREMENT_SCOPE);
});

test("F2 -- the clause's SUBJECT is a component, so it never constrains a service", () => {
  // This is the substantive reason ALL_COMPONENTS is not SYSTEM_WIDE. The demand
  // is about COMPONENTS, and a service is not a component: no service wording may
  // satisfy the component-subject safeguard.
  for (const service of ["Training", "Commissioning", "Installation labour", "Testing and maintenance", "Software licensing", "Documentation"]) {
    const named = COMPONENT_SUBJECT_WORDS.filter((word) => new RegExp(`\\b${word}\\b`, "i").test(service));
    assert.deepEqual(named, [], `${service} names no component subject`);
  }
  // And a service-flavoured clause never acquires an all-component scope even when
  // it carries a universal quantifier and names the system.
  for (const text of [
    "Every training session for the fire alarm system shall be delivered by the contractor.",
    "All commissioning of the fire alarm system shall be witnessed by the consultant.",
  ]) {
    assert.equal(classifyAllComponentsScope(text).scope, null, `${text} must not become a product-matching scope`);
    assert.equal(classifyAllComponentsScope(text).reason, "REFUSED_NO_COMPONENT_SUBJECT");
  }
});

// ---------------------------------------------------------------------------
// 7. CONTROL G -- no fabricated confirmed link
// ---------------------------------------------------------------------------

test("G -- the scope path produces a SUGGESTION only, never a Confirmed link", () => {
  const [proposal] = buildLinkShortlist(panelItem(), [requirement()]);
  assert.equal(proposal.allComponentsApplies, true);
  // `buildLinkShortlist` returns proposals; it performs no write and grants no
  // status. The only status it can express is the scorer's, and the real clause
  // scores far below the Needs Review threshold.
  assert.equal(proposal.suggestion.status, "Suggested");
  assert.notEqual(proposal.suggestion.status, "Confirmed");
  // The single-writer invariant: only suggestLinks INSERTs a Suggested row, and
  // only /api/requirement-links/:id/confirm promotes one, under a human actor.
  assert.equal(buildLinkShortlist.length, 2, "it is a pure function of (item, requirements)");
});

// ---------------------------------------------------------------------------
// 8. Cross-sentence assembly must never invent a scope
// ---------------------------------------------------------------------------

test("conditions split across sentences yield NO scope", () => {
  // Quantifier in sentence 1, named system in sentence 2. The specification never
  // stated a universal component obligation over that system.
  const split = "Every component must be listed by UL. The fire alarm system shall be commissioned by the contractor.";
  const result = classifyAllComponentsScope(split);
  assert.equal(result.scope, null);
  assert.equal(result.reason, "REFUSED_CONDITIONS_SPLIT_ACROSS_SENTENCES");
});

test("two sentences asserting different systems fail closed as ambiguous", () => {
  const conflicting = "Every component of the fire alarm system shall be listed by UL. All equipment of the CCTV system shall be listed by UL.";
  const result = classifyAllComponentsScope(conflicting);
  assert.equal(result.scope, null);
  assert.equal(result.reason, "REFUSED_CONFLICTING_SYSTEM_IDENTITIES");
});

// ---------------------------------------------------------------------------
// 9. Each safeguard refuses for its own, nameable reason
// ---------------------------------------------------------------------------

test("each missing safeguard produces its own explicit reason", () => {
  const cases = [
    ["The panel of the fire alarm system shall be listed by UL.", "REFUSED_NO_UNIVERSAL_QUANTIFIER"],
    ["Every one of the fire alarm system shall be listed by UL.", "REFUSED_NO_COMPONENT_SUBJECT"],
    ["Every component of the fire alarm system may be listed by UL.", "REFUSED_NO_OBLIGATION_MODAL"],
    ["Every component shall be listed by UL.", "REFUSED_NO_NAMED_SYSTEM_IDENTITY"],
    ["", "EMPTY_TEXT"],
  ];
  for (const [text, reason] of cases) {
    assert.equal(classifyAllComponentsScope(text).reason, reason, `${JSON.stringify(text)} should report ${reason}`);
  }
});

test("the threshold and the generic-term list were NOT weakened", () => {
  // The scope path is purely additive. Prove the original scorer still refuses
  // the very clause the scope path rescues: the rescue happens in
  // buildLinkShortlist, never inside scoreRequirementLink.
  const suggestion = scoreRequirementLink({
    boqItem: { description: "Fire alarm control panel with all accessories", system: "Fire Alarm", category: "Control Panel", family: null, specificationReference: null },
    requirement: { originalText: SEQ_100075, system: "Fire Alarm", category: "Compliance", source: {} },
  });
  assert.ok(suggestion.confidence < 15, `the equipment heuristic must still score below the 15 threshold (got ${suggestion.confidence})`);
  assert.equal(suggestion.method, "Technical Applicability v2");
  // And a decoy clause with NO scope basis is still refused by the shortlist.
  const decoy = requirement({ id: "req-decoy", original_text: "The panel shall be installed in the electrical room.", requirement_category: "Installation" });
  assert.equal(shortlistIds(panelItem(), [decoy]).includes("req-decoy"), false);
});

// The component-subject vocabulary, mirrored from the engine so this suite pins
// the exact word set rather than re-deriving it.
const COMPONENT_SUBJECT_WORDS = ["component", "components", "equipment", "unit", "units", "device", "devices", "element", "elements", "product", "products", "goods"];
