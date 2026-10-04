// Focused proof for the requirement-profile approval gate.
//
// Contract under test: a human may approve a profile for matching when, and
// only when, its readiness state is one the downstream matcher already treats
// as unblocked -- "Ready for Matching" or "Ready with Warnings".
//
// This was a proven contract mismatch. `calculateReadiness` in
// app/domain/technical-requirement-engine.mjs returns "Ready with Warnings"
// only after all four genuinely blocking states have already been excluded, and
// the only remaining condition is `confidence.overall < 80`. Meanwhile
// app/domain/product-matching-engine.mjs computes
// `profileBlocked = !["Ready for Matching", "Ready with Warnings"].includes(...)`,
// so the consumer already considered the state safe. The approval gate alone
// refused it, leaving 9 "Completed" profiles structurally unapprovable.
//
// This test is deliberately behavioural about the readiness LADDER (imported
// from the engine, not re-declared) and structural about the ROUTE (the route
// is one minified line and is not unit-callable without a full D1 harness).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { calculateReadiness, READINESS_STATUSES } from "../app/domain/technical-requirement-engine.mjs";

const HERE = new URL(".", import.meta.url).pathname;
const ROUTE = readFileSync(join(HERE, "..", "worker", "technical-requirement-api.mjs"), "utf8");
const MATCHER = readFileSync(join(HERE, "..", "app", "domain", "product-matching-engine.mjs"), "utf8");

// A profile that has passed classification, has no blocking conflict, has no
// blocking missing information, and has a confirmed mandatory baseline -- i.e.
// everything that could actually block. Only `confidence` varies.
const baseInput = (confidence) => ({
  boqItem: { id: "boqitem_test", system: "Fire Alarm", category: "Detector" },
  requirements: [{ priority: "Mandatory" }],
  missing: [],
  conflicts: [],
  confidence: { overall: confidence },
});

test("the approvable set is exactly the two downstream-safe readiness states", () => {
  const match = ROUTE.match(/MATCH_APPROVABLE_READINESS\s*=\s*\[([^\]]*)\]/);
  assert.ok(match, "MATCH_APPROVABLE_READINESS must be a declared list");
  const approvable = [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]);
  assert.deepEqual(approvable, ["Ready for Matching", "Ready with Warnings"]);
});

test("the route gates on membership of that set, not on a single literal", () => {
  assert.match(ROUTE, /!MATCH_APPROVABLE_READINESS\.includes\(profile\.readiness_status\)/);
  assert.ok(
    !/readiness_status !== "Ready for Matching"/.test(ROUTE),
    "the old single-state comparison must be gone",
  );
  assert.match(ROUTE, /READINESS_BLOCKED/);
});

test("the three blocking readiness states are never approvable", () => {
  for (const blocking of [
    "Classification Required",
    "Missing Critical Information",
    "Needs Technical Review",
  ]) {
    assert.ok(READINESS_STATUSES.includes(blocking), `${blocking} must remain a declared status`);
    const list = ROUTE.match(/MATCH_APPROVABLE_READINESS\s*=\s*\[([^\]]*)\]/)[1];
    assert.ok(!list.includes(`"${blocking}"`), `${blocking} must not be approvable`);
  }
  // "Conflict Blocking", "Rejected" and "Not Applicable" are excluded too.
  const list = ROUTE.match(/MATCH_APPROVABLE_READINESS\s*=\s*\[([^\]]*)\]/)[1];
  for (const alsoBlocking of ["Conflict Blocking", "Rejected", "Not Applicable"]) {
    assert.ok(!list.includes(`"${alsoBlocking}"`), `${alsoBlocking} must not be approvable`);
  }
});

test("the ladder only reaches Ready with Warnings after every blocking state is excluded", () => {
  // Genuinely blocked inputs never produce an approvable state.
  assert.equal(
    calculateReadiness({ ...baseInput(95), boqItem: { id: "x", system: null, category: null } }).status,
    "Classification Required",
  );
  assert.equal(
    calculateReadiness({ ...baseInput(95), conflicts: [{ blocking: true, technicalImpact: "conflict" }] }).status,
    "Conflict Blocking",
  );
  assert.equal(
    calculateReadiness({ ...baseInput(95), missing: [{ blocking: true, whyNeeded: "missing" }] }).status,
    "Missing Critical Information",
  );
  assert.equal(
    calculateReadiness({ ...baseInput(95), requirements: [{ priority: "Suggested" }] }).status,
    "Needs Technical Review",
  );
});

test("Ready with Warnings is a confidence shortfall, not a blocking condition", () => {
  const readiness = calculateReadiness(baseInput(72));
  assert.equal(readiness.status, "Ready with Warnings");
  assert.equal(readiness.approved, false);
  // The reason is present but is a confidence message, not a block.
  assert.deepEqual(readiness.blockingReasons, ["Requirement profile confidence is below 80%."]);
  // Same inputs at full confidence reach the fully-approvable state.
  assert.equal(calculateReadiness(baseInput(80)).status, "Ready for Matching");
});

test("the downstream matcher already treats Ready with Warnings as unblocked", () => {
  // This is the evidence that made the gate mismatch a defect rather than policy:
  // the consumer never blocked on this state, so refusing to approve it could
  // only strand work that was already considered safe.
  assert.match(
    MATCHER,
    /!\[?"Ready for Matching",\s*"Ready with Warnings"\]\.includes\(profile\.readiness\?\.status\)/,
  );
});

test("approval preserves the warnings instead of clearing them", () => {
  // Approval writes only the approval columns; profile_issues is never touched,
  // so the warning rows survive on the approved profile.
  const approval = ROUTE.match(
    /UPDATE requirement_profile_versions SET approved_for_matching=1[^)]*\)/,
  );
  assert.ok(approval, "the approval UPDATE must exist");
  assert.ok(
    !/profile_issues/.test(approval[0]),
    "approval must not delete or rewrite warning rows",
  );
  assert.match(approval[0], /approved_for_matching=1/);
});
