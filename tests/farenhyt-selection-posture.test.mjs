// Farenhyt Batch 1 -- Decision 1 (option a): selection posture is ADVISORY metadata.
//
// The point of this file is the NEGATIVE tests. It is easy to add a
// "selection posture" field and quietly wire it into eligibility, which would
// make the system silently drop an installed, working product because the
// manufacturer discontinued it. These tests exist to make that regression
// impossible to introduce silently.
//
// Governing rule: product availability and project usability are engineer and
// business decisions. Lifecycle is evidence that informs them; it is not the
// decision.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SELECTION_POSTURES,
  evaluateProductLifecycle,
  LIFECYCLE_AUTHORITY_VERSION,
} from "../app/domain/product-lifecycle-authority.mjs";

const discontinued = { id: "p-1", partNumber: "IFP-2100HVB", lifecycleStatus: "DISCONTINUED" };
const current = { id: "p-2", partNumber: "IDP-PHOTO-IV", lifecycleStatus: "CURRENT" };

test("1 -- the four governed postures are exposed and distinct", () => {
  assert.deepEqual([...SELECTION_POSTURES].sort(), [
    "CURRENT_PREFERRED",
    "HISTORICAL_ONLY",
    "IDENTITY_CONFLICT_BLOCKED",
    "LEGACY_SUPPORTED",
  ]);
});

test("2 -- a manufacturer-discontinued product is labelled LEGACY_SUPPORTED", () => {
  const result = evaluateProductLifecycle(discontinued);
  assert.equal(result.selectionPosture, "LEGACY_SUPPORTED");
  assert.equal(String(result.state).toUpperCase(), "DISCONTINUED");
  assert.equal(result.warning, true, "the adverse state must be surfaced to the engineer");
});

test("3 -- a current product is labelled CURRENT_PREFERRED", () => {
  const result = evaluateProductLifecycle(current);
  assert.equal(result.selectionPosture, "CURRENT_PREFERRED");
  assert.equal(result.warning, false);
});

test("4 -- an open identity conflict outranks the lifecycle label", () => {
  // 6500RSE: first-party evidence says NOTIFIER / System Sensor Europe / EN 54
  // conventional, while the catalogue files it under Farenhyt (UL/FM). The
  // conflict is the more important signal and must win over a lifecycle label.
  const result = evaluateProductLifecycle({
    ...discontinued,
    identityConflictOpen: true,
  });
  assert.equal(result.selectionPosture, "IDENTITY_CONFLICT_BLOCKED");
});

test("5 -- NEGATIVE: lifecycle alone NEVER blocks technical eligibility", () => {
  // This is the regression guard for the whole decision. A discontinued panel
  // that is installed in three live projects must stay eligible; a warning is
  // the correct output, a block is not.
  for (const product of [discontinued, current, { id: "p-3" }]) {
    const result = evaluateProductLifecycle(product);
    assert.equal(result.blocking, false, "lifecycle must never be a hard gate");
    assert.equal(result.pass, true, "lifecycle must never fail a product");
    assert.equal(
      result.projectRegionBlocksTechnicalEligibility,
      false,
      "a regional lifecycle state must never block technical eligibility",
    );
    assert.equal(result.downgradesTechnicalStatus, Boolean(result.warning),
      "only a genuine adverse state may downgrade, and only to a warning");
  }
});

test("6 -- NEGATIVE: a HISTORICAL_ONLY label still does not block", () => {
  // HISTORICAL_ONLY is a posture, not a lifecycle state, so it is requested
  // explicitly on the product record rather than via lifecycleStatus.
  const result = evaluateProductLifecycle({
    id: "p-4",
    lifecycleStatus: "CURRENT",
    selectionPosture: "HISTORICAL_ONLY",
  });
  assert.equal(result.selectionPosture, "HISTORICAL_ONLY");
  assert.equal(result.blocking, false,
    "historical-only is a label for the engineer, not an eligibility filter");
  assert.equal(result.pass, true);
});

test("6b -- HISTORICAL_ONLY cannot arrive through lifecycleStatus", () => {
  // The lifecycle vocabulary has no HISTORICAL_ONLY member, so a lifecycle state
  // can never smuggle in a posture. Guards the distinction the test above rests on.
  const result = evaluateProductLifecycle({ id: "p-4b", lifecycleStatus: "HISTORICAL_ONLY" });
  assert.notEqual(result.selectionPosture, "HISTORICAL_ONLY");
  assert.equal(result.blocking, false);
});

test("7 -- the authority declares it excludes technical compatibility", () => {
  const result = evaluateProductLifecycle(discontinued);
  assert.equal(result.authorityVersion, LIFECYCLE_AUTHORITY_VERSION);
  assert.equal(result.excludesTechnicalCompatibility, true);
  assert.equal(result.technicalSuitability, "NOT_ASSESSED_HERE");
  assert.equal(result.contractualAcceptance, "NOT_ASSESSED_HERE");
  assert.equal(result.commercialAvailability, "NOT_ASSESSED_HERE");
});

test("8 -- absent lifecycle evidence is NOT treated as adverse", () => {
  // An unverified state must not be read as "legacy" and must not warn; that
  // would make the whole 503-product Farenhyt catalogue look legacy simply
  // because most of it has never been researched.
  const result = evaluateProductLifecycle({ id: "p-5" });
  assert.equal(result.warning, false);
  assert.equal(result.selectionPosture, "CURRENT_PREFERRED");
  assert.equal(result.blocking, false);
});
