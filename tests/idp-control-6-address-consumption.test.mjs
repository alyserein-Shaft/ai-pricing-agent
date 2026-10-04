// IDP-CONTROL-6 ADDRESS CONSUMPTION -- focused validation.
//
// MANUFACTURER EVIDENCE (Honeywell Farenhyt SLC Wiring Manual LS10179-000FH-E:B,
// 4/17/2023). Fixtures use real part numbers; production logic is NEVER keyed on
// a SKU, and nothing here is specific to the control module family.
//
//   6.4.2  "each IDP-CONTROL-6 and SK-CONTROL-6 module can be set to one of 154
//          base addresses (01-154). The remaining module points are automatically
//          assigned to the next five higher SLC addresses. For example, if the
//          base address is set to 28, the next five module points will be
//          addressed to 29, 30, 31, 32 and 33."
//   6.4.5  "Protection is disabled for each module address when there is a large
//          shunt installed on the corresponding pin of the pin block (as shipped,
//          all six addresses are disabled)."
//   5.2.1  "Each module can be set to one of 159 addresses (01-159)"  <- single-point
//   6.2.1  IDP-CONTROL "refer to 'Setting the SLC Address for a Single Point
//          IDP/SK Module'"                                        <- single-point
//
// The count of 6 is therefore established four independent ways: base + next five;
// "all six addresses"; six address switches (#1-#6, "status ... of each module
// address"); and the arithmetic of 154 base addresses (01-154) whose highest
// block ends at 159, exactly the module-address ceiling.
import test from "node:test";
import assert from "node:assert/strict";

import {
  ADDRESS_MODEL_SLC_DEMAND,
  ADDRESS_COUNT_INVALID,
  slcAddressDemandForItem,
  slcAddressDemandForAllocations,
} from "../app/domain/fire-alarm-panel-capability-normalization.mjs";

const MODULE = "SLC_MODULE_POOL";
const DETECTOR = "SLC_DETECTOR_POOL";
const demand = (o) => slcAddressDemandForItem(o);

// ---------------------------------------------------------------------------
// 1. MANUFACTURER EVIDENCE PARSED CORRECTLY
// ---------------------------------------------------------------------------

test("CTRL6-EV the proven count is 6, and 154 base addresses reconcile to the 159 ceiling", () => {
  // The proof is internal-consistency, not arithmetic convenience: a module
  // needing a contiguous block of N addresses can start at 159-(N-1). The manual
  // states 154, and 154 + 5 = 159. Any other count would leave the base range and
  // the address ceiling disagreeing.
  const baseCeiling = 154;
  const moduleAddressCeiling = 159; // "one of 159 addresses (01-159)"
  const blockSize = moduleAddressCeiling - baseCeiling + 1;
  assert.equal(blockSize, 6, "154 base addresses ending at 159 implies a 6-address block");
  assert.equal(baseCeiling + 5, 159, "base + next five must land exactly on the ceiling");
});

// ---------------------------------------------------------------------------
// 2. STANDALONE IDP-CONTROL IS UNCHANGED
// ---------------------------------------------------------------------------

test("CTRL6-1 standalone IDP-CONTROL still consumes exactly one address", () => {
  const out = demand({ classificationState: MODULE, addressModel: "STANDALONE_ADDRESS" });
  assert.equal(out.ok, true);
  assert.equal(out.addresses, 1, "single-point module keeps its proven single address");
  assert.equal(out.pool, "modules");
});

test("CTRL6-2 a stated count of 1 is a no-op, so standalone behaviour cannot drift", () => {
  const bare = demand({ classificationState: MODULE, addressModel: "STANDALONE_ADDRESS" });
  const stated = demand({
    classificationState: MODULE,
    addressModel: "STANDALONE_ADDRESS",
    addressesConsumed: 1,
  });
  assert.deepEqual(stated.addresses, bare.addresses);
  assert.equal(stated.explicitCountBasis, undefined, "a matching count adds no basis note");
});

// ---------------------------------------------------------------------------
// 3. IDP-CONTROL-6 USES THE PROVEN COUNT
// ---------------------------------------------------------------------------

test("CTRL6-3 IDP-CONTROL-6 consumes the manufacturer-proven 6 addresses", () => {
  const out = demand({
    classificationState: MODULE,
    addressModel: "STANDALONE_ADDRESS",
    addressesConsumed: 6,
  });
  assert.equal(out.ok, true);
  assert.equal(out.addresses, 6, "must be the proven count, not the single-address default");
  assert.equal(out.pool, "modules", "a control module lands in the module pool");
  assert.match(out.explicitCountBasis, /manufacturer evidence/i);
});

test("CTRL6-4 quantity multiplies the proven count, it does not replace it", () => {
  const items = { a: { partNumber: "IDP-CONTROL-6", classification: { state: MODULE } } };
  const resolve = () => ({ addressModel: "STANDALONE_ADDRESS", addressesConsumed: 6 });
  const three = slcAddressDemandForAllocations([{ boqItemId: "a", quantity: 3 }], items, resolve);
  assert.equal(three.demand.modules, 18, "3 modules x 6 addresses");
  assert.equal(three.unresolved.length, 0);
});

test("CTRL6-5 a 10-point module is representable without touching the vocabulary", () => {
  // Proves the change is a generic numeric concept, not a 6-specific hack.
  const out = demand({
    classificationState: MODULE,
    addressModel: "STANDALONE_ADDRESS",
    addressesConsumed: 10,
  });
  assert.equal(out.addresses, 10);
});

// ---------------------------------------------------------------------------
// 4. THE TOKEN REMAINS AUTHORITATIVE
// ---------------------------------------------------------------------------

test("CTRL6-6 a malformed count FAILS CLOSED rather than defaulting to one", () => {
  for (const bad of [0, -3, 1.5, "six", Number.NaN, {}]) {
    const out = demand({
      classificationState: MODULE,
      addressModel: "STANDALONE_ADDRESS",
      addressesConsumed: bad,
    });
    assert.equal(out.ok, false, `count ${JSON.stringify(bad)} must be refused`);
    assert.equal(out.code, ADDRESS_COUNT_INVALID);
  }
});

test("CTRL6-7 an explicit count cannot manufacture SLC demand for a zero-address device", () => {
  // NON_SLC appliances: quantity must never become an address count.
  const out = demand({
    classificationState: "NOT_SLC",
    addressModel: "NON_SLC",
    addressesConsumed: 6,
  });
  assert.equal(out.ok, true);
  assert.equal(out.addresses, 0, "a NAC appliance stays at zero regardless of a stated count");
  assert.equal(out.ignoredExplicitCount, 6);
  assert.match(out.ignoredBecause, /no SLC address/i);
});

test("CTRL6-8 zero-address accessories stay zero under a stated count", () => {
  for (const model of ["SHARED_WITH_DETECTOR", "HOUSING_NO_ADDITIONAL_ADDRESS"]) {
    const out = demand({
      classificationState: DETECTOR,
      addressModel: model,
      addressesConsumed: 6,
    });
    assert.equal(out.addresses, 0, `${model} must remain zero`);
  }
});

test("CTRL6-9 a stated count never moves a device out of its classifier's pool", () => {
  const asDetector = demand({
    classificationState: DETECTOR,
    addressModel: "STANDALONE_ADDRESS",
    addressesConsumed: 6,
  });
  assert.equal(asDetector.pool, "detectors", "the classifier decides the pool, not the count");
});

// ---------------------------------------------------------------------------
// 5. NO NOTIFICATION-QUANTITY -> ADDRESS CONVERSION
// ---------------------------------------------------------------------------

test("CTRL6-10 4,380 notification appliances add ZERO SLC addresses", () => {
  // The governing guard for the accepted NAC architecture: appliance quantity is
  // a NAC sizing output and must never become an SLC address count.
  const items = { n: { partNumber: "SPSWL", classification: { state: "NOT_SLC" } } };
  const resolve = () => ({ addressModel: "NON_SLC", addressesConsumed: 1 });
  const out = slcAddressDemandForAllocations([{ boqItemId: "n", quantity: 4380 }], items, resolve);
  assert.equal(out.demand.detectors, 0);
  assert.equal(out.demand.modules, 0, "4,380 appliances must not become 4,380 addresses");
});

test("CTRL6-11 SLC addresses come from control modules alone", () => {
  const items = {
    n: { partNumber: "SPSWL", classification: { state: "NOT_SLC" } },
    c: { partNumber: "IDP-CONTROL-6", classification: { state: MODULE } },
  };
  const resolve = (item) => (item.partNumber === "SPSWL"
    ? { addressModel: "NON_SLC", addressesConsumed: 1 }
    : { addressModel: "STANDALONE_ADDRESS", addressesConsumed: 6 });
  const out = slcAddressDemandForAllocations(
    [
      { boqItemId: "n", quantity: 4380 },
      { boqItemId: "c", quantity: 2 },
    ],
    items,
    resolve,
  );
  assert.equal(out.demand.modules, 12, "2 control modules x 6 addresses, appliances contribute 0");
  assert.equal(out.demand.detectors, 0);
});

test("CTRL6-12 the legacy bare-string resolver contract still works unchanged", () => {
  // Existing callers pass a model string; they must be unaffected.
  const items = { c: { partNumber: "IDP-CONTROL", classification: { state: MODULE } } };
  const out = slcAddressDemandForAllocations(
    [{ boqItemId: "c", quantity: 4 }],
    items,
    () => "STANDALONE_ADDRESS",
  );
  assert.equal(out.demand.modules, 4, "no count stated means the proven single-address default");
});

test("CTRL6-13 the vocabulary itself is unchanged: still five tokens, none above one", () => {
  // Guards against the temptation to encode the count in the vocabulary.
  assert.equal(Object.keys(ADDRESS_MODEL_SLC_DEMAND).length, 5);
  for (const [token, semantics] of Object.entries(ADDRESS_MODEL_SLC_DEMAND)) {
    assert.ok(
      semantics.additionalAddressesConsumed <= 1,
      `${token} must stay at 0 or 1; a proven count is supplied, not encoded`,
    );
  }
});
