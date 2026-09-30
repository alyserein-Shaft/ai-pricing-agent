// REGIONAL LIFECYCLE AUTHORITY (Phase B).
//
// WHY THIS EXISTS. Product lifecycle arrived as ONE global string
// (`canonical_library_products.lifecycle_status`), and the matching engine
// treated an UNSET / "Unknown" value as an advisory WARNING:
//
//     advisory = /discontinued|end of sale|limited|end of support|replaced|unknown/i
//
// All 951 canonical products currently carry `lifecycle_status =
// "Unknown — Review Required"`. That made `advisory` true for every product in
// the library, and the engine's top-level
//
//     technicalStatus = ... || lifecycle.warning
//         ? "Compliant with Warnings" : "Technically Compliant"
//
// downgraded EVERY candidate. The cause was absent evidence, not a finding
// about any product.
//
// Lifecycle also could not express what the project actually needs to know:
//
//   product A: discontinued in the US
//              current in the Middle East
//              availability in KSA unknown
//              successor: product B
//              technical suitability: still valid
//
// Those are five distinct facts. One global string cannot hold them, and
// collapsing them means a US-only phase-out is treated as a global one.
//
// THE POLICY ENCODED HERE
//   1. Absent evidence is `Unverified`, never a finding. It must not warn and
//      must not downgrade technical status.
//   2. A region-specific state applies ONLY to that region. A global state is
//      not inferred from a regional one, and a regional one never overrides
//      the global disposition.
//   3. Lifecycle and regional availability are NEVER a hard technical
//      eligibility gate. `blocking` is always false here. A product that is
//      technically suitable with valid evidence stays technically selectable
//      even when a market is closed, a successor exists, or KSA availability
//      is unconfirmed.
//   4. SCOPE. This module models lifecycle and availability ONLY. Protocol,
//      capacity, certification and specification conformance are separate
//      axes with their own comparisons. A protocol mismatch must never be
//      laundered into a lifecycle "warning", so this module deliberately
//      exposes no protocol/capacity/certification logic and asserts that
//      boundary in its own result.

export const LIFECYCLE_AUTHORITY_VERSION = "product-lifecycle-authority-1.0.0";

// Project region whose availability the technical track tracks separately.
export const PROJECT_AVAILABILITY_REGION = "KSA";

// Normalized lifecycle dispositions. `Unverified` is the important one: it is
// the state for absent evidence and is deliberately NOT an adverse finding.
export const LIFECYCLE_STATES = Object.freeze([
  "Current",
  "Replacement Candidate",
  "Discontinued",
  "End of Sale",
  "Limited Availability",
  "End of Support",
  "Superseded",
  "Unverified",
]);

// States that are a genuine, global, adverse finding.
const ADVERSE_STATES = /(discontinued|end of sale|end of support|superseded|limited availability)/i;

const normalizeState = (raw) => {
  const value = String(raw ?? "").trim();
  if (!value) return "Unverified";
  if (/replacement candidate/i.test(value)) return "Replacement Candidate";
  if (/end of sale/i.test(value)) return "End of Sale";
  if (/end of support/i.test(value)) return "End of Support";
  if (/limited/i.test(value)) return "Limited Availability";
  if (/discontinued/i.test(value)) return "Discontinued";
  if (/superseded/i.test(value)) return "Superseded";
  if (/current|active/i.test(value)) return "Current";
  // Anything unrecognised -- including the literal stored value
  // "Unknown — Review Required" -- is ABSENT EVIDENCE, not an adverse finding.
  return "Unverified";
};

// `unknown` is deliberately excluded from the adverse pattern. This single
// change is the repair for the 951-product global downgrade.
const isAdverse = (state) => state !== "Unverified" && ADVERSE_STATES.test(state);

const regionEntry = (raw) => {
  const region = String(raw?.region ?? "").trim();
  const state = normalizeState(raw?.state ?? raw?.lifecycleStatus);
  const availabilityConfirmed = state !== "Unverified";
  return {
    region,
    state,
    availabilityConfirmed,
    // Policy (3): availability is informational. It never removes a product
    // from technical eligibility.
    blocksTechnicalEligibility: false,
    reviewFlag: !availabilityConfirmed || isAdverse(state) ? "AVAILABILITY_REVIEW_REQUIRED" : null,
  };
};

export const evaluateProductLifecycle = (product = {}, { projectRegion = PROJECT_AVAILABILITY_REGION } = {}) => {
  const globalState = normalizeState(product.lifecycleStatus ?? product.lifecycle_status);
  const regions = Array.isArray(product.regionalLifecycle) ? product.regionalLifecycle.map(regionEntry).filter((r) => r.region) : [];

  // Global disposition. An Unverified global state is absent evidence: no
  // warning, no downgrade. A genuine global adverse state warns but never
  // blocks.
  const globalAdverse = isAdverse(globalState);
  const warning = globalAdverse;

  // A regional state is reported, and is deliberately NOT folded into the
  // global disposition. A product discontinued in the US but current in the
  // Middle East is still Current for this project's purposes.
  const projectRegionEntry = regions.find((r) => r.region === projectRegion) || null;
  const projectRegionAvailability = projectRegionEntry ? projectRegionEntry.state : "Unverified";

  const state = globalState;

  return {
    authorityVersion: LIFECYCLE_AUTHORITY_VERSION,
    scope: "Lifecycle and regional availability only",
    excludesTechnicalCompatibility: true,

    state,
    result: warning ? "Warning" : "Pass",
    pass: true,
    // Policy (3): lifecycle is never a hard technical eligibility gate.
    blocking: false,
    warning,
    // The exact flag the matching engine consults for its top-level status.
    // False whenever the cause is absent evidence.
    downgradesTechnicalStatus: warning,

    regions,
    projectRegion,
    projectRegionAvailability,
    projectRegionBlocksTechnicalEligibility: false,

    // Explicit separation required by the master brief.
    technicalSuitability: "NOT_ASSESSED_HERE",
    contractualAcceptance: "NOT_ASSESSED_HERE",
    commercialAvailability: "NOT_ASSESSED_HERE",
  };
};
