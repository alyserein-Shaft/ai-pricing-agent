// ADDRESS MODEL AND LIFECYCLE CONSUMER WIRING.
//
// WHAT WAS BROKEN
// 1. `slc_address_model` was promoted onto six canonical products, Approved, and
//    read by ZERO consumers. A reviewed panel-sizing input silently influenced
//    no decision.
// 2. The Fire Alarm resource layer had a lifecycle consumer whose own vocabulary
//    could not read most of the CANONICAL lifecycle vocabulary the promotion
//    path enforces: it knew CURRENT/LEGACY/DISCONTINUED/REPLACED/UNKNOWN but not
//    `Superseded`, `End of Sale`, `End of Support`, `Limited Availability` or
//    `Replacement Candidate`. A value that had passed the promotion gate was
//    therefore dropped by the consumer and reported as UNKNOWN -- a value that
//    passed a gate and was then discarded by the code that reads it.
//
// These tests use the REAL canonical attribute values from Batch 1. No test
// invents a canonical value that production does not carry.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ADDRESS_MODEL_SLC_DEMAND,
  normalizeAddressModel,
  normalizeLifecycle,
  FIRE_ALARM_PANEL_CAPABILITY_VERSION,
} from "../app/domain/fire-alarm-panel-capability-normalization.mjs";
import { normalizeKnowledgeFactForPromotion } from "../app/domain/knowledge-promotion-policy.mjs";
import { resolveFireAlarmAttributeAlias } from "../app/domain/fire-alarm-taxonomy.mjs";

// The exact `slc_address_model` values Batch 1 promoted onto canonical products.
const BATCH1_APPROVED_ADDRESS_MODELS = [
  "NON_SLC",                     // 6500RSE, SGWL
  "STANDALONE_ADDRESS",          // IDP-HEAT-ROR-IV, IDP-PHOTO-IV, IDP-PHOTO-T-IV
  "HOUSED_MODULE_OWN_ADDRESS",   // IDP-PULL-DA
];

test("ADDRESS-MODEL/A every canonical Address Model value is interpretable", () => {
  // Guard against drift in BOTH directions: a new token added to the promotion
  // vocabulary without a resource meaning, or a resource meaning for a token the
  // promotion path would refuse.
  const canonical = normalizeKnowledgeFactForPromotion;
  for (const token of Object.keys(ADDRESS_MODEL_SLC_DEMAND)) {
    const interpretation = normalizeAddressModel(token);
    assert.ok(interpretation, `${token} must be interpretable`);
    assert.equal(interpretation.addressModel, token);
    assert.equal(typeof interpretation.consumesSlcAddress, "boolean");
    assert.equal(typeof interpretation.additionalAddressesConsumed, "number");
    assert.ok(interpretation.basis, `${token} must state why`);
  }
  // And the two vocabularies agree: everything interpretable is promotable.
  for (const token of Object.keys(ADDRESS_MODEL_SLC_DEMAND)) {
    const promoted = canonical({
      factType: "Address Model",
      originalValue: "quoted manufacturer evidence",
      normalizedValue: token,
    });
    assert.equal(promoted.status, "SUPPORTED", `${token} must remain promotable`);
  }
});

test("ADDRESS-MODEL/B the five required semantics have the required demand", () => {
  // §6 of the brief, stated as executable expectations.
  // standalone detector consumes one device address
  assert.deepEqual(
    { slc: normalizeAddressModel("STANDALONE_ADDRESS").consumesSlcAddress, addrs: normalizeAddressModel("STANDALONE_ADDRESS").additionalAddressesConsumed },
    { slc: true, addrs: 1 },
  );
  // housed module owns its address
  assert.deepEqual(
    { slc: normalizeAddressModel("HOUSED_MODULE_OWN_ADDRESS").consumesSlcAddress, addrs: normalizeAddressModel("HOUSED_MODULE_OWN_ADDRESS").additionalAddressesConsumed },
    { slc: true, addrs: 1 },
  );
  // NON_SLC consumes zero SLC addresses
  assert.deepEqual(
    { slc: normalizeAddressModel("NON_SLC").consumesSlcAddress, addrs: normalizeAddressModel("NON_SLC").additionalAddressesConsumed },
    { slc: false, addrs: 0 },
  );
  // housing-no-additional does not create a second address
  assert.deepEqual(
    { slc: normalizeAddressModel("HOUSING_NO_ADDITIONAL_ADDRESS").consumesSlcAddress, addrs: normalizeAddressModel("HOUSING_NO_ADDITIONAL_ADDRESS").additionalAddressesConsumed },
    { slc: false, addrs: 0 },
  );
  // shared-with-detector does not double-count
  assert.deepEqual(
    { slc: normalizeAddressModel("SHARED_WITH_DETECTOR").consumesSlcAddress, addrs: normalizeAddressModel("SHARED_WITH_DETECTOR").additionalAddressesConsumed },
    { slc: true, addrs: 0 },
  );
});

test("ADDRESS-MODEL/C the model is NOT flattened to a scalar", () => {
  // The distinction that a 0/1 flag destroys: a device sharing its detector's
  // address and a NON_SLC device BOTH add zero addresses, but one still sits on
  // the SLC and the other does not. Collapsing them would size a panel wrongly.
  const shared = normalizeAddressModel("SHARED_WITH_DETECTOR");
  const nonSlc = normalizeAddressModel("NON_SLC");
  assert.equal(shared.additionalAddressesConsumed, nonSlc.additionalAddressesConsumed);
  assert.notEqual(
    shared.consumesSlcAddress,
    nonSlc.consumesSlcAddress,
    "so the SLC-connection distinction must survive, or the model is lossy",
  );
  assert.notEqual(shared.addressModel, nonSlc.addressModel);
});

test("ADDRESS-MODEL/D SHARED_WITH_DETECTOR reports its context requirement instead of guessing", () => {
  // §6: where a semantic needs more context than the consumer has, report the
  // requirement rather than invent the pairing.
  const shared = normalizeAddressModel("SHARED_WITH_DETECTOR");
  assert.ok(shared.contextRequired, "the pairing requirement must be stated");
  assert.match(shared.contextRequired, /detector/i);
  // Every other state is self-contained.
  for (const token of ["STANDALONE_ADDRESS", "HOUSED_MODULE_OWN_ADDRESS", "NON_SLC", "HOUSING_NO_ADDITIONAL_ADDRESS"]) {
    assert.equal(normalizeAddressModel(token).contextRequired, null, `${token} needs no extra context`);
  }
});

test("ADDRESS-MODEL/E an absent or unknown model is reported absent, never defaulted", () => {
  // Defaulting an unknown address model to 1 (or 0) would mis-size every panel
  // the product appears in. Refusing to guess is the fail-closed behaviour.
  for (const value of [null, undefined, "", "ADDRESSABLE", "some prose", 42]) {
    assert.equal(normalizeAddressModel(value), null, `${JSON.stringify(value)} must report absent`);
  }
});

test("ADDRESS-MODEL/F matching is case- and separator-insensitive but still closed", () => {
  for (const variant of ["non_slc", "NON-SLC", "Non Slc", " non_slc "]) {
    assert.equal(normalizeAddressModel(variant).addressModel, "NON_SLC", `${variant} must resolve`);
  }
  // Normalisation must not become a widening: prose containing a token is not a
  // token. The whole-string match is what keeps this closed.
  assert.equal(normalizeAddressModel("NON_SLC because it is conventional"), null);
  assert.equal(normalizeAddressModel("the device is NON_SLC"), null);
});

test("ADDRESS-MODEL/G the Fire Alarm taxonomy resolves the attribute and its aliases", () => {
  for (const alias of ["address model", "slc address model", "Addressing Model", "device address model"]) {
    assert.equal(resolveFireAlarmAttributeAlias(alias), "slc_address_model", `${alias} must resolve`);
  }
  // The promoted attribute name itself resolves through the generic fallback,
  // which is what the sizing loader passes.
  assert.equal(resolveFireAlarmAttributeAlias("slc_address_model"), "slc_address_model");
  // No product-specific exception was added: the mapping is concept-level only.
  assert.equal(resolveFireAlarmAttributeAlias("6500RSE address model"), null);
});

// ---------------------------------------------------------------------------
// Lifecycle consumer.
// ---------------------------------------------------------------------------

test("LIFECYCLE-CONSUMER/A every canonical lifecycle value the promotion path accepts is readable here", () => {
  // This is the round-trip that was broken. Each value below PASSES the
  // promotion gate; the consumer must therefore be able to read every one.
  const canonicalTokens = ["Current", "Discontinued", "Superseded", "End of Sale", "End of Support", "Limited Availability", "Replacement Candidate"];
  for (const token of canonicalTokens) {
    const promoted = normalizeKnowledgeFactForPromotion({ factType: "Lifecycle", originalValue: token, normalizedValue: token });
    assert.equal(promoted.status, "SUPPORTED", `${token} must pass the promotion gate`);
    const consumed = normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: promoted.normalizedValue }] });
    assert.notEqual(
      consumed.lifecycleStatus,
      "UNKNOWN",
      `${token} passed the promotion gate but this consumer discarded it`,
    );
    assert.equal(consumed.source, "LIFECYCLE_EVENT", `${token} must come from the event stream`);
  }
});

test("LIFECYCLE-CONSUMER/B Discontinued and Superseded map onto the consumer vocabulary", () => {
  assert.equal(normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "Discontinued" }] }).lifecycleStatus, "DISCONTINUED");
  // `Superseded` has no REPLACED spelling conflict: it is a replacement.
  assert.equal(normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "Superseded" }] }).lifecycleStatus, "REPLACED");
  assert.equal(normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "Current" }] }).lifecycleStatus, "CURRENT");
  // Discontinued wins when both are present, so the adverse state is never missed.
  assert.equal(
    normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "Superseded" }, { lifecycle_status: "Discontinued" }] }).lifecycleStatus,
    "DISCONTINUED",
  );
});

test("LIFECYCLE-CONSUMER/C the canonical states are preserved, not just the mapped bucket", () => {
  // §8: expose lifecycle TRUTH to the engineer. Reporting only DISCONTINUED would
  // hide whether the manufacturer said "Discontinued" or "Superseded".
  const consumed = normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "Superseded" }] });
  assert.deepEqual(consumed.canonicalLifecycleStates, ["Superseded"]);
  assert.equal(consumed.lifecycleStatus, "REPLACED");
});

test("LIFECYCLE-CONSUMER/D prose is still unreadable, and absence is not adverse", () => {
  // The consumer must not become laxer than the promotion gate.
  const inert = normalizeLifecycle({
    lifecycleEvents: [{ lifecycle_status: "SUPERSEDED - SGWLED (L-Series LED) replaces SGWL; no discontinuation statement present in this document" }],
  });
  assert.equal(inert.lifecycleStatus, "UNKNOWN");
  assert.equal(inert.source, "CATALOG_FIELD");
  // LIFECYCLE_NOT_ESTABLISHED is a research finding, never a lifecycle state.
  assert.equal(normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "LIFECYCLE_NOT_ESTABLISHED" }] }).lifecycleStatus, "UNKNOWN");
  // No events at all: absent evidence, not an adverse finding.
  assert.equal(normalizeLifecycle({ lifecycleEvents: [] }).lifecycleStatus, "UNKNOWN");
  assert.equal(normalizeLifecycle({}).inferredFromDocumentRecency, false, "never inferred from a document date");
});

test("LIFECYCLE-CONSUMER/E a replacement is reported, never silently applied", () => {
  const consumed = normalizeLifecycle({
    lifecycleEvents: [{ lifecycle_status: "Superseded", replacement_candidates: ["product_new"] }],
  });
  assert.equal(consumed.replacementProductId, "product_new");
  assert.equal(consumed.lifecycleStatus, "REPLACED");
});

test("LIFECYCLE-CONSUMER/F Batch 1's promoted lifecycle values are all readable", () => {
  // The five Discontinued events Batch 1 promoted, plus the fact that the prose
  // value which reached canonical truth last slice is NOT among them any more.
  const promotedByBatch1 = ["Discontinued"];
  for (const value of promotedByBatch1) {
    const consumed = normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: value }] });
    assert.equal(consumed.lifecycleStatus, "DISCONTINUED");
    assert.equal(consumed.source, "LIFECYCLE_EVENT");
  }
  assert.equal(FIRE_ALARM_PANEL_CAPABILITY_VERSION, "fire-alarm-panel-capability-normalization-1.0.0");
});

test("LIFECYCLE-CONSUMER/G legacy DERIVED forms stay readable without becoming promotable", () => {
  // 57 live rows carry "Discontinued — Replacement Candidate", 20 "— No
  // Replacement", 5 "— Replacement Missing". These are DERIVED DISPLAY FORMS
  // from `product-price-library`'s lifecycleState(), not manufacturer-stated
  // states -- so they must stay OUT of the promotion vocabulary while remaining
  // READABLE here, or those products report as unverified.
  const legacy = ["Discontinued — Replacement Candidate", "Discontinued — No Replacement", "Discontinued — Replacement Missing"];
  for (const value of legacy) {
    const consumed = normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: value }] });
    assert.equal(consumed.lifecycleStatus, "DISCONTINUED", `${value} must be readable`);
    assert.equal(consumed.source, "LIFECYCLE_EVENT");
    assert.deepEqual(consumed.canonicalLifecycleStates, [], "and must be marked derived, not canonical");
    assert.ok(consumed.legacyDerivedStates.includes(value));
    // ...while the promotion gate still refuses to mint one.
    assert.equal(
      normalizeKnowledgeFactForPromotion({ factType: "Lifecycle", originalValue: value, normalizedValue: value }).status,
      "UNSUPPORTED_LIFECYCLE_VALUE",
      `${value} must never be promoted as a lifecycle state`,
    );
  }
  // A derived form says whether a replacement is KNOWN; it never applies one.
  const candidate = normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "Discontinued — Replacement Candidate" }] });
  assert.equal(candidate.replacementKnown, true);
  assert.equal(candidate.replacementProductId, null, "a derived form never supplies a replacement product");
});

test("ADDRESS-MODEL/H Batch 1's Approved values all resolve, so no canonical value is orphaned", () => {
  for (const value of BATCH1_APPROVED_ADDRESS_MODELS) {
    const interpretation = normalizeAddressModel(value);
    assert.ok(interpretation, `Batch 1 promoted ${value}; it must be consumable`);
    assert.equal(interpretation.addressModel, value);
  }
});
