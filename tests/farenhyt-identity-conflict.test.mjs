// Farenhyt Batch 1 -- Decision 2: 6500RSE identity conflict.
//
// The conflict is recorded in the EXISTING governed register, product_conflicts
// (conflict_type + status), and the selection posture is DERIVED from it. This
// file proves two things that matter:
//
//   1. an unresolved identity conflict is detected and surfaces as
//      IDENTITY_CONFLICT_BLOCKED, even when the product's lifecycle looks fine;
//   2. it is still NOT a technical-eligibility gate -- a conflicted product is
//      labelled, not silently removed, because identity reconciliation is a
//      governed human decision and the engineer keeps working meanwhile.
//
// 6500RSE evidence (batch1-notes.md §9): first-party documentation identifies
// it as System Sensor Europe / NOTIFIER / Morley-IAS, a CONVENTIONAL zone
// device, CPR-approved to EN 54-12:2015 (Notified Body 1293, cert
// 1293-CPR-0684), with no established UL/FM basis -- while the catalogue files
// it under Farenhyt, which the brand policy scopes as UL/FM.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  IDENTITY_CONFLICT_TYPES,
  hasOpenIdentityConflict,
  evaluateProductLifecycle,
} from "../app/domain/product-lifecycle-authority.mjs";

const regimeConflict = {
  id: "conflict-6500rse",
  productId: "product_0c2a497f-11df-4c53-a870-544969f9dd5c",
  conflictType: "Identity Collision — Brand / Standards Regime Conflict",
  status: "Open",
};

test("1 -- the brand/regime conflict type is registered in the governed vocabulary", () => {
  assert.ok(
    IDENTITY_CONFLICT_TYPES.includes("Identity Collision — Brand / Standards Regime Conflict"),
    "the 6500RSE conflict must have a governed conflict_type, not free text",
  );
  // It must live alongside the two conflict types the register already carries.
  assert.ok(IDENTITY_CONFLICT_TYPES.includes("Identity Collision — Description Difference"));
  assert.ok(IDENTITY_CONFLICT_TYPES.includes("Possible Duplicate Identity"));
  assert.equal(new Set(IDENTITY_CONFLICT_TYPES).size, IDENTITY_CONFLICT_TYPES.length);
});

test("2 -- an OPEN identity conflict is detected", () => {
  assert.equal(hasOpenIdentityConflict([regimeConflict]), true);
});

test("3 -- a RESOLVED identity conflict is NOT open", () => {
  // Reclassifying 6500RSE later must clear the posture without deleting history.
  assert.equal(
    hasOpenIdentityConflict([{ ...regimeConflict, status: "Resolved" }]),
    false,
  );
});

test("4 -- non-identity conflicts do not trigger the identity posture", () => {
  const priceConflict = { conflictType: "Price Source Conflict", status: "Open" };
  assert.equal(hasOpenIdentityConflict([priceConflict]), false);
});

test("5 -- an empty or missing conflict list is not a conflict", () => {
  for (const input of [[], undefined, null, {}]) {
    assert.equal(hasOpenIdentityConflict(input), false);
  }
});

test("6 -- 6500RSE is labelled IDENTITY_CONFLICT_BLOCKED, and lifecycle is clean", () => {
  // The product's recorded lifecycle is "Unknown - Review Required", so there is
  // no adverse lifecycle signal. The identity conflict must be what surfaces.
  const result = evaluateProductLifecycle({
    id: "product_0c2a497f-11df-4c53-a870-544969f9dd5c",
    partNumber: "6500RSE",
    lifecycleStatus: "Unknown — Review Required",
    openConflicts: [regimeConflict],
  });
  assert.equal(result.selectionPosture, "IDENTITY_CONFLICT_BLOCKED");
  assert.equal(result.warning, false, "an identity conflict is not a lifecycle warning");
});

test("7 -- NEGATIVE: an identity conflict still does NOT block technical eligibility", () => {
  // Same governing rule as the lifecycle postures: label, do not gate. The
  // product keeps its ID and stays usable while a human reconciles identity.
  const result = evaluateProductLifecycle({
    id: "p-conflict",
    lifecycleStatus: "CURRENT",
    openConflicts: [regimeConflict],
  });
  assert.equal(result.selectionPosture, "IDENTITY_CONFLICT_BLOCKED");
  assert.equal(result.blocking, false, "identity conflict must not become a hard gate");
  assert.equal(result.pass, true);
  assert.equal(result.excludesTechnicalCompatibility, true);
});

test("8 -- an explicit flag overrides the derived register", () => {
  // A caller that has already adjudicated the conflict may assert the outcome
  // directly; the register remains the default source of truth.
  const cleared = evaluateProductLifecycle({
    lifecycleStatus: "CURRENT",
    identityConflictOpen: false,
    openConflicts: [regimeConflict],
  });
  assert.equal(cleared.selectionPosture, "CURRENT_PREFERRED");
});
