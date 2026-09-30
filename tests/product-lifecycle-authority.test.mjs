import test from "node:test";
import assert from "node:assert/strict";

import { evaluateProductLifecycle } from "../app/domain/product-lifecycle-authority.mjs";

// PHASE B -- REGIONAL LIFECYCLE CORRECTION.
//
// THE DEFECT THIS PROVES. `product-matching-engine.evaluateLifecycle` treats an
// UNSET / "Unknown" lifecycle state as an ADVISORY WARNING. Every one of the
// 951 canonical products currently carries `lifecycle_status =
// "Unknown — Review Required"`, so the advisory fires for all of them, and the
// engine's top-level
//
//     technicalStatus = ... || lifecycle.warning ? "Compliant with Warnings"
//                                                            : "Technically Compliant"
//
// degrades EVERY candidate to "Compliant with Warnings" -- a global technical
// downgrade caused purely by absent evidence, not by any real product finding.
//
// Lifecycle is also currently ONE global string. It cannot represent the
// distinction the project actually needs:
//
//   US discontinued / Middle East current / KSA availability unknown
//
// which are three different facts about three different scopes.
//
// THE POLICY (workflow §4 / master §4):
//   * lifecycle or market availability is NOT a hard technical eligibility gate
//   * an UNSET / unverified state must NOT downgrade technical status
//   * a region-specific state must never be applied globally
//   * genuine technical incompatibility is a different axis and still blocks

test("an UNSET lifecycle state does not downgrade technical status (the 951-product defect)", () => {
  const result = evaluateProductLifecycle({});
  assert.equal(result.state, "Unverified", "absent evidence is Unverified, not a warning");
  assert.equal(result.warning, false, "absent evidence must not warn");
  assert.equal(result.blocking, false, "lifecycle never blocks");
  assert.equal(result.pass, true, "absent evidence is not a failure");
  assert.equal(result.downgradesTechnicalStatus, false, "this is the exact defect being repaired");
});

test("an explicit unknown/review state also does not downgrade technical status", () => {
  // The literal value stored on all 951 current rows.
  const result = evaluateProductLifecycle({ lifecycleStatus: "Unknown — Review Required" });
  assert.equal(result.state, "Unverified");
  assert.equal(result.warning, false, "'Unknown — Review Required' is absent evidence, not a finding");
  assert.equal(result.downgradesTechnicalStatus, false);
});

test("a genuine current state is clean", () => {
  for (const state of ["Current", "Active", "Replacement Candidate"]) {
    const result = evaluateProductLifecycle({ lifecycleStatus: state });
    assert.equal(result.warning, false, state + " must be clean");
    assert.equal(result.downgradesTechnicalStatus, false, state);
  }
});

test("a global discontinued state warns but never blocks", () => {
  const result = evaluateProductLifecycle({ lifecycleStatus: "Discontinued" });
  assert.equal(result.warning, true, "a real discontinuation is worth surfacing");
  assert.equal(result.blocking, false, "lifecycle is not a technical eligibility gate");
  assert.equal(result.pass, true, "a discontinued product is still technically valid");
  assert.equal(result.downgradesTechnicalStatus, true, "and it is surfaced as a review flag");
});

test("a REGION-specific state never applies globally (US discontinued, KSA unknown)", () => {
  const product = {
    lifecycleStatus: "Current",
    regionalLifecycle: [
      { region: "US", state: "Discontinued" },
      { region: "Middle East", state: "Current" },
      { region: "KSA", state: "Unknown" },
    ],
  };
  const result = evaluateProductLifecycle(product);

  // Global disposition stays clean: the product is current where it is sold.
  assert.equal(result.warning, false, "a non-global discontinuation must not warn globally");
  assert.equal(result.downgradesTechnicalStatus, false, "must not degrade technical status");

  // But the regional facts are preserved and surfaced, not discarded.
  assert.equal(result.regions.length, 3);
  // "Unknown" is normalized to the canonical "Unverified" disposition: an
  // unconfirmed region is absent evidence, not an adverse regional finding.
  assert.deepEqual(result.regions.map((r) => r.state).sort(), ["Current", "Discontinued", "Unverified"]);
  const ksa = result.regions.find((r) => r.region === "KSA");
  assert.equal(ksa.state, "Unverified", "an unverified region is Unverified, not a failure");
  assert.equal(ksa.availabilityConfirmed, false);
  assert.equal(ksa.blocksTechnicalEligibility, false, "availability never blocks technical eligibility");

  // The project region is explicitly flagged as unconfirmed.
  assert.equal(result.projectRegion, "KSA");
  assert.equal(result.projectRegionAvailability, "Unverified");
});

test("a global discontinuation combined with regional current still does not block", () => {
  const result = evaluateProductLifecycle({
    lifecycleStatus: "Discontinued",
    regionalLifecycle: [{ region: "Middle East", state: "Current" }],
  });
  assert.equal(result.blocking, false, "lifecycle never blocks technical eligibility");
  assert.equal(result.pass, true);
  assert.equal(result.state, "Discontinued", "the global fact is still reported honestly");
  assert.equal(result.regions.length, 1, "and the regional counter-evidence is retained");
});

test("technical incompatibility is a different axis and is not modelled here", () => {
  // Protocol / capacity / certification failures are handled by their own
  // comparisons. This module must never absorb them, so that a protocol
  // mismatch cannot be laundered into a lifecycle "warning".
  const result = evaluateProductLifecycle({ lifecycleStatus: "Current" });
  assert.equal(result.scope, "Lifecycle and regional availability only");
  assert.equal(result.excludesTechnicalCompatibility, true);
});
