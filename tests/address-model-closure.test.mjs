// PRE-BATCH-3B ADDRESS CLOSURE -- focused regression.
//
// Fixtures use real part numbers; production logic is never keyed on a SKU.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ADDRESS_MODEL_SLC_DEMAND,
  slcAddressDemandForItem,
  slcAddressDemandForAllocations,
  ADDRESS_POOL_CLASSIFICATION_REQUIRED,
} from "../app/domain/fire-alarm-panel-capability-normalization.mjs";
import {
  assessFactWithdrawal,
  activePromotionsForFact,
  KNOWLEDGE_FACT_WITHDRAWAL_VERSION,
} from "../app/domain/knowledge-fact-withdrawal.mjs";

const HUMAN = { id: "omair-primary", name: "Omair", source: "server-configured-human-operator" };
const item = (classificationState, addressModel) => slcAddressDemandForItem({ classificationState, addressModel });

// ---------------------------------------------------------------------------
// ADDRESS TRUTH
// ---------------------------------------------------------------------------

test("ADDR-1 a duct detector head is STANDALONE_ADDRESS and its passive housing adds none", () => {
  // The correction this slice made. IDP-PHOTO-R-IV previously carried
  // HOUSING_NO_ADDITIONAL_ADDRESS because its evidence was the IFP-2100 manual
  // sentence about the DNR HOUSING -- conflating the addressed device with the
  // accessory that carries it.
  const head = item("SLC_DETECTOR_POOL", "STANDALONE_ADDRESS");
  assert.equal(head.ok, true);
  assert.equal(head.addresses, 1);
  assert.equal(head.pool, "detectors", "the detector head occupies a DETECTOR address");

  const housing = item("NOT_SLC", "HOUSING_NO_ADDITIONAL_ADDRESS");
  assert.equal(housing.ok, true);
  assert.equal(housing.addresses, 0, "the housing adds no SLC address");
  assert.equal(housing.pool, null);
});

test("ADDR-2 a duct ASSEMBLY of detector + housing is ONE detector address, never two", () => {
  const allocations = [{ boqItemId: "d", quantity: 1 }, { boqItemId: "h", quantity: 1 }];
  const items = {
    d: { classification: { state: "SLC_DETECTOR_POOL" } },
    h: { classification: { state: "NOT_SLC" } },
  };
  const byId = { d: "STANDALONE_ADDRESS", h: "HOUSING_NO_ADDITIONAL_ADDRESS" };
  const { demand, unresolved } = slcAddressDemandForAllocations(allocations, items, (item_, allocation) => byId[allocation.boqItemId]);
  assert.deepEqual(unresolved, []);
  assert.deepEqual(demand, { detectors: 1, modules: 0 }, "one detector address for the whole assembly");
});

test("ADDR-3 a shared-address sounder base adds NO second detector address", () => {
  // SPDS536 rev 02/15: the base "adopts the same address as the detector, but as
  // a unique device type on the loop". A unique DEVICE TYPE is not a unique
  // ADDRESS.
  const allocations = [{ boqItemId: "d", quantity: 1 }, { boqItemId: "b", quantity: 1 }];
  const items = {
    d: { classification: { state: "SLC_DETECTOR_POOL" } },
    b: { classification: { state: "SLC_MODULE_POOL" } },
  };
  const byId = { d: "STANDALONE_ADDRESS", b: "SHARED_WITH_DETECTOR" };
  const { demand } = slcAddressDemandForAllocations(allocations, items, (_, a) => byId[a.boqItemId]);
  assert.deepEqual(demand, { detectors: 1, modules: 0 }, "the base must not inflate loop demand");
  // And the shared token must state the pairing requirement rather than hide it.
  assert.match(ADDRESS_MODEL_SLC_DEMAND.SHARED_WITH_DETECTOR.contextRequired, /paired detector/i);
});

test("ADDR-4 a conventional device and a notification appliance consume ZERO SLC addresses", () => {
  for (const [label, state] of [["conventional beam", "SLC_MODULE_POOL"], ["notification appliance", "SLC_MODULE_POOL"]]) {
    const r = item(state, "NON_SLC");
    assert.equal(r.ok, true, label);
    assert.equal(r.addresses, 0, `${label} must consume no SLC address`);
  }
});

test("ADDR-5 the pull station routes to the MODULE pool on its own address", () => {
  const r = item("SLC_MODULE_POOL", "HOUSED_MODULE_OWN_ADDRESS");
  assert.equal(r.ok, true);
  assert.equal(r.addresses, 1);
  assert.equal(r.pool, "modules", "the housed module occupies a MODULE address, not a detector address");
});

test("ADDR-6 an absent or unknown address model FAILS CLOSED", () => {
  // Defaulting to "1 address" here is exactly the flattening that mis-sizes a loop.
  for (const model of [null, undefined, "", "   ", "MADE_UP_TOKEN"]) {
    const r = item("SLC_DETECTOR_POOL", model);
    assert.equal(r.ok, false, `"${model}" must not be assumed`);
    assert.equal(r.code, ADDRESS_POOL_CLASSIFICATION_REQUIRED);
  }
  const { demand, unresolved } = slcAddressDemandForAllocations(
    [{ boqItemId: "x", quantity: 1 }],
    { x: { classification: { state: "SLC_DETECTOR_POOL" } } },
    () => null,
  );
  assert.deepEqual(demand, { detectors: 0, modules: 0 }, "an unprovable item contributes nothing");
  assert.equal(unresolved.length, 1, "and it is reported as unresolved rather than silently counted");
});

test("ADDR-7 a NOT_SLC classification can never carry SLC demand, whatever the token", () => {
  for (const model of Object.keys(ADDRESS_MODEL_SLC_DEMAND)) {
    const r = item("NOT_SLC", model);
    assert.equal(r.ok, true, model);
    assert.equal(r.addresses, 0, `${model} under NOT_SLC must yield zero`);
  }
});

// ---------------------------------------------------------------------------
// WITHDRAWAL
// ---------------------------------------------------------------------------

const reviewedFact = { id: "f1", review_status: "Reviewed", fact_type: "Detector Capacity", original_value: "250", attributes: JSON.stringify({ partNumber: "X" }) };

test("WD-1 a synthetic or asserted actor is refused", () => {
  for (const actor of [
    undefined, null, {},
    { id: "local-development-user", name: "Dev", source: "server-configured-human-operator" },
    { id: "system", name: "System", source: "server-configured-human-operator" },
    { id: "omair-primary", name: "Omair", source: "asserted-by-caller" },
  ]) {
    const r = assessFactWithdrawal({ fact: reviewedFact, activePromotions: [], humanActor: actor, reason: "because it is fabricated" });
    assert.equal(r.ok, false, `${JSON.stringify(actor)} must be refused`);
    assert.equal(r.code, "KNOWLEDGE_WITHDRAWAL_HUMAN_ACTOR_REQUIRED");
  }
});

test("WD-2 a substantive reason is required", () => {
  for (const reason of ["", "no", "wrong"]) {
    const r = assessFactWithdrawal({ fact: reviewedFact, activePromotions: [], humanActor: HUMAN, reason });
    assert.equal(r.ok, false);
    assert.equal(r.code, "KNOWLEDGE_WITHDRAWAL_REASON_REQUIRED");
  }
});

test("WD-3 a fact that was never Reviewed must be Rejected through the ordinary path", () => {
  // This path must not become a back door around the review guard.
  for (const status of ["Learned", "Needs Review", "Rejected"]) {
    const r = assessFactWithdrawal({ fact: { ...reviewedFact, review_status: status }, activePromotions: [], humanActor: HUMAN, reason: "deliberate synthetic conflict probe with no manufacturer evidence" });
    assert.equal(r.ok, false, status);
    assert.equal(r.code, "KNOWLEDGE_FACT_NOT_REVIEWED");
  }
});

test("WD-4 a fact with ACTIVE canonical promotion is refused until the promotion is reversed", () => {
  // THE REGRESSION THAT MATTERS. An earlier version compared against the action
  // string "Promote" while the table actually stores "Promoted", so this guard
  // never fired and a fact carrying live canonical authority could be withdrawn.
  for (const action of ["Promoted", "Promote"]) {
    const r = assessFactWithdrawal({
      fact: reviewedFact,
      activePromotions: [{ id: "p1", action }],
      humanActor: HUMAN,
      reason: "deliberate synthetic conflict probe with no manufacturer evidence",
    });
    assert.equal(r.ok, false, `action=${action} must be recognised as active`);
    assert.equal(r.code, "KNOWLEDGE_FACT_ACTIVE_PROMOTION");
    assert.deepEqual(r.promotions, ["p1"]);
  }
  // With the promotion reversed there is nothing left blocking it.
  const free = assessFactWithdrawal({ fact: reviewedFact, activePromotions: [], humanActor: HUMAN, reason: "deliberate synthetic conflict probe with no manufacturer evidence" });
  assert.equal(free.ok, true);
  assert.equal(free.previousStatus, "Reviewed");
  assert.equal(free.nextStatus, "Rejected");
});

test("WD-5 Evidence Only is not active canonical authority", () => {
  const r = assessFactWithdrawal({
    fact: reviewedFact,
    activePromotions: [{ id: "p2", action: "Evidence Only" }],
    humanActor: HUMAN,
    reason: "deliberate synthetic conflict probe with no manufacturer evidence",
  });
  assert.equal(r.ok, true, "Evidence Only carries no canonical authority to reverse first");
});

test("WD-6 the module exports a version and the assessment preserves part number", () => {
  assert.equal(typeof KNOWLEDGE_FACT_WITHDRAWAL_VERSION, "string");
  assert.match(KNOWLEDGE_FACT_WITHDRAWAL_VERSION, /knowledge-fact-withdrawal/);
  const r = assessFactWithdrawal({ fact: reviewedFact, activePromotions: [], humanActor: HUMAN, reason: "deliberate synthetic conflict probe with no manufacturer evidence" });
  assert.equal(r.partNumber, "X", "the withdrawn fact's subject is recorded for the audit");
});

test("WD-7 activePromotionsForFact is an async reader, not a synchronous list", () => {
  // Guards against a future caller passing a caller-supplied list that is stale.
  assert.equal(typeof activePromotionsForFact, "function");
  assert.equal(activePromotionsForFact.constructor.name, "AsyncFunction");
});