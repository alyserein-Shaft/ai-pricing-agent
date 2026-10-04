// PROD-001 -- the Knowledge promotion terminal policy, made explicit and enforced.
//
// The defect was never that the gate was wrong; it was that the gate was a bare
// `factType !== "Protocol"` with no stated rationale, so the safety-relevant
// decisions were invisible and a future reader could "fix" it by adding a fact
// type without knowing why that would be wrong.
//
// These tests assert that every fact type the extractor actually produces is
// DELIBERATELY classified, that the three distinctions that must never collapse
// are terminal, and that an unclassified type still fails closed.

import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeKnowledgeFactForPromotion,
  KNOWLEDGE_PROMOTION_ELIGIBILITY,
  ADDRESS_MODEL_CANONICAL_VALUES,
} from "../app/domain/knowledge-promotion-policy.mjs";

// The real fact-type vocabulary, measured rather than assumed. Two sources, both
// evidence: the 20 types the live database actually contains, plus the types the
// governed aggregate SQL in worker/knowledge-library-api.mjs already references.
// "BOQ Section" is the second kind -- referenced in code but not yet produced in
// live data -- so it is classified deliberately rather than left to a default.
// The four capacity types plus the relationship/lifecycle promotions are the
// KN-GOVERNANCE-REPAIR pilot vocabulary for internet enrichment: not extractor
// output yet, classified deliberately as human-only so a future extractor type
// can never slip into a deterministic path by accident.
const LIVE_FACT_TYPES = [
  "Product Description", "Part Number", "Price", "Product Relationship", "Lifecycle",
  "Product Family", "Category", "Country of Origin", "Unit", "Manufacturer",
  "Language", "Document Type", "Protocol", "Standard", "Currency", "BOQ Item",
  "Region", "Certification", "Revision", "Document Date",
  "BOQ Section",
];
const PILOT_VOCABULARY_TYPES = [
  "SLC Loops", "Detector Capacity", "Module Capacity", "System Points",
  // KN-PILOT-1: the fact types the first real internet-enrichment pilot
  // actually produced from manufacturer datasheets/manuals. Each is
  // deliberately classified terminal with its own reason, so it fails closed
  // by policy rather than by accident.
  "Voltage Range", "Standby Current", "Alarm Current", "SLC Current",
  "Auxiliary Power Current", "Power Supply Input", "Power Supply Total Current",
  "NAC Current per Circuit", "Operating Temperature", "Relative Humidity",
  "SLC Addresses Consumed", "Detector Technology", "Device Role",
  "Network Panels", "NAC Outputs", "Auxiliary Power Outputs",
  "Compatible Base", "Expansion Hardware",
  // KN-B1-ADDRESS-MODEL: Batch 1 authored real `Address Model` observations from
  // first-party Honeywell documents, so this stopped being pilot vocabulary and
  // became a governed production fact type. It is human-only (never
  // deterministic) because the SLC address model decides loop/point budgeting:
  // an inferred 0/1 would silently mis-size every panel the device appears in.
  // The five distinct values (NON_SLC, STANDALONE_ADDRESS,
  // HOUSING_NO_ADDITIONAL_ADDRESS, HOUSED_MODULE_OWN_ADDRESS,
  // SHARED_WITH_DETECTOR) are one controlled vocabulary mapped onto
  // `slc_address_model`, never a scalar.
  "Address Model",
];

// A) Completeness: every real fact type is classified, and nothing else is
//    classified by accident.
test("PROD-001/A every real fact type is deliberately classified, and nothing is classified spuriously", () => {
  for (const factType of [...LIVE_FACT_TYPES, ...PILOT_VOCABULARY_TYPES]) {
    assert.ok(
      KNOWLEDGE_PROMOTION_ELIGIBILITY[factType],
      `${factType} must be deliberately classified, not left to a default`,
    );
  }
  // The table must not contain invented types: every classified key is a real
  // fact type or explicitly governed pilot vocabulary, so the policy cannot
  // drift into fiction.
  for (const factType of Object.keys(KNOWLEDGE_PROMOTION_ELIGIBILITY)) {
    assert.ok(
      LIVE_FACT_TYPES.includes(factType) || PILOT_VOCABULARY_TYPES.includes(factType),
      `${factType} is classified but is neither a real fact type nor governed pilot vocabulary`,
    );
  }
});

// B) Eligible set and governance paths (KN-GOVERNANCE-REPAIR widened this
//    deliberately): Protocol stays the sole deterministic type; capacities,
//    relationships and lifecycle are human-only with explicit destinations.
test("PROD-001/B promotion eligibility carries explicit path and destination", () => {
  const eligible = Object.entries(KNOWLEDGE_PROMOTION_ELIGIBILITY)
    .filter(([, policy]) => policy.eligible === true)
    .map(([factType]) => factType)
    .sort();
  assert.deepEqual(eligible, [
    // POLICY CHANGE 2026-10-01 (destination & relationship-semantics closure).
    // `Alarm Current`, `Network Panels` and `Standby Current` were reopened
    // because they were blocking LIVE consumers, not because a completion metric
    // looked bad:
    //   * `app/domain/calculation-requirement-engine.mjs` already maps
    //     `standby_current` / `alarm_current` into the governed
    //     `battery.standby-alarm` rule, which returns
    //     REQUIRED_BUT_INPUTS_MISSING (blocking: true) without them, so battery
    //     sizing could never be satisfied from manufacturer evidence at all.
    //   * the same engine requires `maxNetworkNodes` for `network.node-capacity`
    //     and blocks without it.
    // Their original objection -- that a current is only true at a quoted test
    // condition -- is PRESERVED rather than discarded: `normalizeCurrent` keeps
    // the condition as evidence and refuses any magnitude that is not
    // unit-tagged, so the 1000x mA/A hazard cannot recur. See PROD-001/C2.
    "Address Model",
    "Alarm Current",
    "Detector Capacity",
    "Lifecycle",
    "Module Capacity",
    "Network Panels",
    "Product Relationship",
    "Protocol",
    "SLC Loops",
    "Standby Current",
    "System Points",
  ]);
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Protocol"].path, "deterministic");
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Protocol"].destination, "attribute");
  for (const factType of ["SLC Loops", "Detector Capacity", "Module Capacity", "System Points", "Standby Current", "Alarm Current", "Network Panels"]) {
    assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY[factType].path, "human", `${factType} must never promote deterministically`);
    assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY[factType].destination, "attribute");
  }
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Product Relationship"].path, "human");
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Product Relationship"].destination, "relationship");
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Lifecycle"].path, "human");
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Lifecycle"].destination, "lifecycle");
  // The SLC address model sizes panels, so it carries the same human-only
  // requirement as the capacity types. Deterministic promotion would mint an
  // engineering resource claim with no human in the loop.
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Address Model"].path, "human");
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Address Model"].destination, "attribute");
  assert.equal(KNOWLEDGE_PROMOTION_ELIGIBILITY["Address Model"].attributeName, "slc_address_model");
});

// KN-PILOT-1: safety/compliance and documentation facts observed by the pilot
// stay terminal, and each carries a stated reason. A terminal fact must never
// be promotable by any path, and a safety fact must never acquire a
// destination by accident.
test("PROD-001/C pilot safety and documentation fact types are terminal with stated reasons", () => {
  const mustBeTerminal = [
    "Voltage Range", "SLC Current",
    "Auxiliary Power Current", "Power Supply Input", "Power Supply Total Current",
    "NAC Current per Circuit", "Operating Temperature", "Relative Humidity",
    "SLC Addresses Consumed", "Detector Technology", "Device Role",
    "NAC Outputs", "Auxiliary Power Outputs",
    "Compatible Base", "Expansion Hardware",
  ];
  // NOTE: `Standby Current`, `Alarm Current` and `Network Panels` were REMOVED
  // from this list on 2026-10-01 and are now covered by the stronger invariant in
  // PROD-001/C2 below. The terminal assertion alone was never strong enough for
  // them: it proved only that no destination existed, not that refusing was
  // correct. C2 additionally proves the destination is unit-safe and that the
  // declared live consumer can actually be satisfied.
  for (const factType of mustBeTerminal) {
    const policy = KNOWLEDGE_PROMOTION_ELIGIBILITY[factType];
    assert.ok(policy, `${factType} must be deliberately classified`);
    assert.equal(policy.eligible, false, `${factType} must not be promotable`);
    assert.equal(policy.destination, undefined, `${factType} must have no canonical destination`);
    assert.ok(
      String(policy.reason || "").length >= 40,
      `${factType} must state why it remains terminal`,
    );
  }
  // And they are refused by the normalizer on both paths, not merely flagged.
  for (const factType of ["Operating Temperature", "Voltage Range", "Detector Technology"]) {
    for (const authorization of ["human", "deterministic"]) {
      const result = normalizeKnowledgeFactForPromotion(
        { factType, originalValue: "32 to 122 F", normalizedValue: "32 to 122 F" },
        { authorization },
      );
      assert.equal(result.status, "UNSUPPORTED_FACT_TYPE", `${factType}/${authorization} must be refused`);
    }
  }
});

// C2) THE REOPENED TYPES. Stronger than the terminal assertion they replaced:
//     it pins the attribute name each live consumer reads, the human-only path,
//     and the unit-safety of the conversion -- so a future edit that makes these
//     unit-naive, deterministic, or wrongly-named fails here.
test("PROD-001/C2 reopened current/count types serve their live consumers unit-safely", () => {
  const cases = [
    // [factType, attributeName, consumer input name, representative source value]
    ["Standby Current", "standby_current", "standbyCurrent", "200µA @ 24 VDC"],
    ["Alarm Current", "alarm_current", "alarmCurrent", "38.5mA at 24VDC"],
    ["Network Panels", "max_network_nodes", "maxNetworkNodes", "32"],
  ];
  for (const [factType, attributeName, consumerInput, sourceValue] of cases) {
    const policy = KNOWLEDGE_PROMOTION_ELIGIBILITY[factType];
    assert.equal(policy.eligible, true, `${factType} is reopened`);
    assert.equal(policy.attributeName, attributeName, `${factType} must write the attribute its consumer reads`);
    assert.equal(policy.path, "human", `${factType} must stay human-gated`);
    // The consumer input name is part of the contract: it is what
    // calculation-requirement-engine.mjs maps from, so a rename would silently
    // break battery/network sizing.
    assert.ok(consumerInput, `${factType} must name its consumer input`);
    const result = normalizeKnowledgeFactForPromotion(
      { factType, originalValue: sourceValue, normalizedValue: sourceValue },
      { authorization: "human" },
    );
    assert.equal(result.status, "SUPPORTED", `${factType} must promote from its real quoted form`);
    assert.equal(result.attributeName, attributeName);
  }

  // Unit safety: the currents MUST be normalised to amperes, because the
  // battery rule declares unit "A" and datasheets quote mA/uA. Reading the bare
  // digits would over-size a battery by 1000x.
  const milli = normalizeKnowledgeFactForPromotion(
    { factType: "Alarm Current", originalValue: "38.5mA at 24VDC" },
    { authorization: "human" },
  );
  assert.equal(milli.unit, "A");
  assert.ok(Math.abs(milli.normalizedValue - 0.0385) < 1e-9);
  // And an unlabelled magnitude is still refused -- the hazard is closed, not
  // merely relocated.
  assert.equal(
    normalizeKnowledgeFactForPromotion({ factType: "Alarm Current", originalValue: "38.5" }, { authorization: "human" }).status,
    "UNSUPPORTED_ATTRIBUTE_VALUE",
  );
  // The deterministic path must still refuse all three: a confident extractor is
  // not engineering authority for a sizing number.
  for (const [factType] of cases) {
    assert.equal(
      normalizeKnowledgeFactForPromotion({ factType, originalValue: "32" }, { authorization: "deterministic" }).status,
      "HUMAN_REVIEW_REQUIRED",
      `${factType} must refuse the deterministic path`,
    );
  }
});
test("PROD-001/C every terminal fact type states why it is terminal", () => {
  for (const [factType, policy] of Object.entries(KNOWLEDGE_PROMOTION_ELIGIBILITY)) {
    assert.equal(typeof policy.reason, "string", `${factType} must carry a reason`);
    assert.ok(policy.reason.trim().length > 20, `${factType} must carry a substantive reason`);
    if (policy.eligible !== true) {
      assert.equal(policy.eligible, false, `${factType} must be explicitly false, not merely absent`);
    }
  }
});

// D) The three distinctions that must NEVER collapse are all terminal, and the
//    reason for each names the real governing authority.
test("PROD-001/D price observation, part-number observation and certification are all terminal", () => {
  const cases = [
    ["Price", /price_record/i],
    ["Part Number", /identity resolver|canonical product identity/i],
    ["Certification", /safety-relevant|listing evidence/i],
    ["Standard", /listing|compliance claim/i],
  ];
  for (const [factType, reasonPattern] of cases) {
    const policy = KNOWLEDGE_PROMOTION_ELIGIBILITY[factType];
    assert.equal(policy.eligible, false, `${factType} must not be promotion-eligible`);
    assert.match(policy.reason, reasonPattern, `${factType}'s reason must name the real authority`);
  }
});

// E) Behaviour: every terminal fact type is actually refused, with the unchanged
//    two-key result shape.
test("PROD-001/E every classified terminal fact type is refused at runtime", () => {
  for (const [factType, policy] of Object.entries(KNOWLEDGE_PROMOTION_ELIGIBILITY)) {
    if (policy.eligible === true) continue;
    assert.deepEqual(
      normalizeKnowledgeFactForPromotion({ factType, originalValue: "anything", normalizedValue: "anything" }),
      { status: "UNSUPPORTED_FACT_TYPE", factType },
      `${factType} must be refused`,
    );
  }
});

// F) Protocol behaviour is byte-identical to before this change.
test("PROD-001/F Protocol promotion behaviour is unchanged", () => {
  const supported = normalizeKnowledgeFactForPromotion({ factType: "Protocol", originalValue: "bacnet" });
  assert.equal(supported.status, "SUPPORTED");
  assert.equal(supported.targetTable, "product_attributes");
  assert.equal(supported.attributeName, "protocol");
  assert.equal(supported.normalizedValue, "BACnet");

  const unsupportedValue = normalizeKnowledgeFactForPromotion({ factType: "Protocol", originalValue: "not-a-protocol" });
  assert.equal(unsupportedValue.status, "UNSUPPORTED_ATTRIBUTE_VALUE");
  assert.equal(unsupportedValue.attributeName, "protocol");
});

// G) Fail closed for anything unclassified -- including a type the extractor
//    might start producing tomorrow.
test("PROD-001/G an unclassified fact type still fails closed", () => {
  for (const factType of ["Operating Voltage", "IP Rating", "Mounting Type", "", "protocol"]) {
    assert.deepEqual(
      normalizeKnowledgeFactForPromotion({ factType, originalValue: "anything" }),
      { status: "UNSUPPORTED_FACT_TYPE", factType },
      `${JSON.stringify(factType)} must fail closed`,
    );
  }
});

// H) KN-DISPATCH: an eligible fact type must be PROMOTABLE, not merely eligible.
//
// This is not redundant with B. `eligible: true` only means the fact type passed
// classification; the normalizer then dispatches on `policy.attributeName`. The
// two used to disagree in both directions, and neither test caught it:
//
//   * `Address Model` was eligible with no attributeName, so it fell through to
//     the protocol normalizer and answered
//     `UNSUPPORTED_ATTRIBUTE_VALUE attributeName: "protocol"` for every real
//     SLC address-model fact;
//   * after dispatch was fixed to read the declared attribute, `Protocol` --
//     still carrying no attributeName -- began answering
//     `UNSUPPORTED_FACT_TYPE`.
//
// Both are the same defect: a table that classifies and a dispatcher that acts,
// with nothing asserting they agree. So eligibility is asserted end-to-end --
// each eligible type must reach SUPPORTED (or a value-level refusal that names
// its OWN attribute, never another fact type's) with a value drawn from its own
// vocabulary.
test("PROD-001/H every eligible fact type is promotable, and names its own attribute when it refuses", () => {
  // One valid value per attribute, taken from the attribute's own normalizer.
  const probes = {
    Protocol: { originalValue: "bacnet", expect: "SUPPORTED" },
    // Address Model is a CLOSED vocabulary of canonical tokens, deliberately not
    // a free-text matcher: mapping "the detector owns one loop address" onto a
    // token is an interpretation, and interpretation is a human decision, not a
    // spelling one. So the probe value is a token.
    "Address Model": { originalValue: "STANDALONE_ADDRESS", expect: "SUPPORTED" },
    "SLC Loops": { originalValue: "2", expect: "SUPPORTED" },
    "Detector Capacity": { originalValue: "30", expect: "SUPPORTED" },
    "Module Capacity": { originalValue: "10", expect: "SUPPORTED" },
    "System Points": { originalValue: "250", expect: "SUPPORTED" },
    // Reopened 2026-10-01 for the live battery-sizing and network-capacity
    // consumers. The probe values are REAL quoted manufacturer forms, including
    // a microamp one, because the unit conversion is the part that can go wrong.
    "Standby Current": { originalValue: "200µA @ 24 VDC", expect: "SUPPORTED" },
    "Alarm Current": { originalValue: "38.5mA at 24VDC", expect: "SUPPORTED" },
    "Network Panels": { originalValue: "32", expect: "SUPPORTED" },
    Lifecycle: { originalValue: "Active", expect: "SUPPORTED" },
    "Product Relationship": {
      originalValue: "mounts on",
      expect: "MISSING_RELATIONSHIP_TARGET",
    },
  };

  for (const [factType, policy] of Object.entries(KNOWLEDGE_PROMOTION_ELIGIBILITY)) {
    if (policy.eligible !== true) continue;
    // `attributeName` is what an ATTRIBUTE-destination entry dispatches on, so
    // only that destination requires it. Relationship and lifecycle entries
    // promote to entities that have no attribute column -- `Product Relationship`
    // promotes to a row of `engineering_relationships`, `Lifecycle` to a row of
    // `product_lifecycle_events` -- and inventing a column name for them would
    // be a fiction the dispatcher would then have to special-case.
    if (policy.destination === "attribute") {
      assert.ok(policy.attributeName, `${factType} is eligible but declares no attributeName to promote to`);
    }
    const probe = probes[factType];
    assert.ok(probe, `${factType} is eligible but no promotion probe is defined for it`);
    const result = normalizeKnowledgeFactForPromotion({
      factType,
      originalValue: probe.originalValue,
      normalizedValue: probe.originalValue,
      relationshipType: factType === "Product Relationship" ? "Compatible With" : undefined,
      targetPartNumber: factType === "Product Relationship" ? "B200S-LF-IV" : undefined,
    });
    assert.notEqual(
      result.status,
      "UNSUPPORTED_FACT_TYPE",
      `${factType} is classified eligible yet the normalizer refuses it: ${JSON.stringify(result)}`,
    );
    if (result.status !== "SUPPORTED" && result.status !== probe.expect) {
      assert.equal(
        result.status,
        probe.expect,
        `${factType} refused for an unexpected reason: ${JSON.stringify(result)}`,
      );
    }
    // A value-level refusal must name the fact type's OWN attribute. Naming
    // another type's attribute is exactly how Address Model was answering with
    // `attributeName: "protocol"`, and it sends a reviewer looking at a field
    // that has nothing to do with the decision in front of them.
    if (result.attributeName !== undefined && policy.destination === "attribute") {
      assert.equal(
        result.attributeName,
        policy.attributeName,
        `${factType} refused naming attribute "${result.attributeName}", which is not its own`,
      );
    }
  }
});

// I) The specific regression, pinned with its own shape rather than inferred from
//    the loop above: an out-of-vocabulary Address Model must be refused as an
//    ADDRESS MODEL problem, and must publish the vocabulary so the reviewer is
//    told what a corrected value has to look like.
test("PROD-001/I an out-of-vocabulary address model is refused as an address-model problem", () => {
  // These are real Batch-1 observation values, quoted rather than invented: the
  // manufacturer documents say this in prose, and the whole reason this fact type
  // exists is that prose must be turned into a token by a human.
  for (const prose of [
    "the detector owns one loop address",
    "conventional zone device",
    "one address for the housing",
    "0",
    "1",
  ]) {
    const result = normalizeKnowledgeFactForPromotion({ factType: "Address Model", originalValue: prose });
    assert.equal(
      result.status,
      "UNSUPPORTED_ATTRIBUTE_VALUE",
      `"${prose}" must be refused, not guessed into a token`,
    );
    assert.equal(result.attributeName, "slc_address_model", "and blamed on the address model");
    assert.deepEqual(
      [...result.allowedValues].sort(),
      [
        "HOUSED_MODULE_OWN_ADDRESS",
        "HOUSING_NO_ADDITIONAL_ADDRESS",
        "NON_SLC",
        "SHARED_WITH_DETECTOR",
        "STANDALONE_ADDRESS",
      ],
      "the refusal must publish the closed vocabulary",
    );
    assert.match(result.message, /must be one of/i);
  }

  // And each token is accepted. This is the positive half, and it matters
  // because a closed vocabulary that also rejects its own members is just a
  // vocabulary-shaped wall.
  for (const token of Object.keys(ADDRESS_MODEL_CANONICAL_VALUES)) {
    const result = normalizeKnowledgeFactForPromotion({ factType: "Address Model", originalValue: token });
    assert.equal(result.status, "SUPPORTED", `${token} must be accepted`);
    assert.equal(result.attributeName, "slc_address_model");
    assert.equal(result.normalizedValue, token);
    assert.equal(result.targetTable, "product_attributes");
  }
});
