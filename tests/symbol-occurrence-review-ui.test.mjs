import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Symbol occurrence/definition review UI closure (this slice). The
// codebase's established pattern (see tests/drawing-workspace-ui-closure.test.mjs)
// proves UI truth via static source assertions against app/page.tsx combined
// with real backend-level tests -- there is no jsdom/testing-library
// dependency in this project. Real handler behavior is proven in
// tests/symbol-takeoff-e2e.test.mjs (this slice) and the pre-existing
// tests/drawing-quantity-evidence.test.mjs /
// tests/quantity-source-decision-api.test.mjs suites.
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

// The Symbol Review overlay region -- everything it renders lives between the
// overlay mount and its footer.
const overlayStart = page.indexOf("{symbolWorkspaceDocument && (");
assert.notEqual(overlayStart, -1, "the Symbol Review overlay must exist");
const overlayEnd = page.indexOf("</footer>", overlayStart);
assert.ok(overlayEnd > overlayStart, "the Symbol Review overlay footer must exist");
const overlay = page.slice(overlayStart, overlayEnd);

// The governed review helper region.
const reviewStart = page.indexOf("const reviewSymbol = async (");
assert.notEqual(reviewStart, -1, "the reviewSymbol helper must exist");
const reviewEnd = page.indexOf("const reviewDrawingExtractionProposal", reviewStart);
assert.ok(reviewEnd > reviewStart);
const review = page.slice(reviewStart, reviewEnd);

test("reviewSymbol posts every occurrence/definition action to the existing governed backend routes, never a parallel API", () => {
  assert.match(review, /\/api\/symbol-\$\{kind\}\/\$ \{encodeURIComponent\(entityId\)\}|\$\{encodeURIComponent\(entityId\)\}\/\$\{action\}/);
  assert.match(review, /`\/api\/symbol-\$\{kind\}\/\$\{encodeURIComponent\(entityId\)\}\/\$\{action\}`/);
});

test("reviewSymbol requires a substantive reason before any backend call -- the backend stays the authority", () => {
  const reasonIndex = review.indexOf("promptForReason(");
  const fetchIndex = review.indexOf("await fetch(");
  assert.ok(reasonIndex !== -1 && fetchIndex !== -1 && reasonIndex < fetchIndex, "the reason must be collected before the request is sent");
  assert.match(review, /if \(!reason\) return;/);
});

test("all four occurrence review actions are reachable from the Occurrences tab (approve, reject, restore, reassign)", () => {
  for (const action of ["approve", "reject", "restore", "reassign"]) {
    assert.match(overlay, new RegExp(`void reviewSymbol\\(\\s*"occurrences",\\s*[\\s\\S]{0,80}?"${action}"`), `occurrence action ${action} must be wired`);
  }
});

test("definition review actions are reachable from the Definitions tab (approve, reject, edit, split, merge, restore)", () => {
  for (const action of ["approve", "reject", "edit", "split", "merge", "restore"]) {
    assert.match(overlay, new RegExp(`void reviewSymbol\\(\\s*"definitions",\\s*[\\s\\S]{0,80}?"${action}"`), `definition action ${action} must be wired`);
  }
});

test("each occurrence row shows its CURRENT REVIEW STATE, distinguishing approved, rejected and unreviewed detections", () => {
  // The Status column renders the backend's review_status with an explicit
  // unreviewed-detection label so a detected occurrence can never be read
  // as trusted quantity.
  assert.match(overlay, /<th>Status<\/th>/);
  assert.match(overlay, /item\.review_status === "Approved"/);
  assert.match(overlay, /item\.review_status === "Rejected"/);
  assert.match(overlay, /Unreviewed \(detected\)/);
  assert.match(overlay, /title=\{item\.review_status\}/);
});

test("the governed occurrence id is visible per row so split prompts are answerable", () => {
  assert.match(overlay, /symbol-occurrence-id/);
  assert.match(overlay, /<code className="symbol-occurrence-id">\s*\{item\.id\}/);
});

test("the governed definition id is visible per definition so reassign/merge prompts are answerable", () => {
  assert.match(overlay, /symbol-definition-id/);
  assert.match(overlay, /<code className="symbol-definition-id">\s*\{definition\.id\}/);
});

test("reassign and split prompts point the engineer at the visible governed ids", () => {
  assert.match(review, /shown on each entry in the Definitions tab/);
  assert.match(review, /shown in the Status column of the Occurrences tab/);
});

test("a successful review action refreshes BOTH the occurrence state and the backend's approved-only quantity evidence, for definitions as well as occurrences", () => {
  // A definition merge/split/edit can move occurrences between identities or
  // change the taxonomy text evidence resolves through, so the live evidence
  // read must refresh after every action -- never only occurrence actions.
  assert.match(review, /await loadSymbolWorkspace\(targetDocument\);/);
  assert.match(review, /void loadQuantityEvidence\(targetDocument\);/);
  assert.doesNotMatch(
    review,
    /if \(kind === "occurrences"\) void loadQuantityEvidence/,
    "definition actions must also refresh quantity evidence",
  );
});

test("the browser never computes trusted quantity: the workspace reads the backend's approved-only aggregate, never a client-side count", () => {
  assert.match(overlay, /quantityEvidence\.totalApprovedOccurrenceCount/);
  assert.doesNotMatch(overlay, /filter\(\s*item => item\.review_status === "Approved"\s*\)\.length/, "the UI must not independently count approved occurrences");
});

test("governance language keeps detected occurrences distinct from trusted quantity -- no auto-approval, no auto-coverage", () => {
  assert.match(overlay, /Occurrences are observations, not BOQ quantities or engineering objects\./);
  assert.match(overlay, /it is NOT BOQ\s+quantity, tender quantity, or engineer-approved quantity\./);
  // Coverage is only ever submitted through the engineer's explicit
  // submitCoverageState action with a substantive reason -- never as a side
  // effect of occurrence review.
  const coverageIndex = page.indexOf("const submitCoverageState");
  assert.notEqual(coverageIndex, -1);
  const coverageRegion = page.slice(coverageIndex, page.indexOf("const openSymbolWorkspace", coverageIndex));
  assert.match(coverageRegion, /coverageDraft\.reason\.trim\(\)\.length < 5/);
  assert.doesNotMatch(review, /coverageState\s*:\s*"Complete/, "occurrence review must never auto-set coverage");
  assert.doesNotMatch(review, /"Complete \/ Engineer Confirmed"/, "no review action may imply conclusive coverage on its own");
});

test("restore stays exactly what the backend defines: a return to Needs Review with the original definition -- never auto-approval", () => {
  // The UI passes only { reason } for restore; the backend alone decides the
  // resulting state. No restore branch in the UI may assert an Approved state.
  const restoreCalls = review.match(/"restore"[\s\S]{0,120}/g) || [];
  assert.ok(restoreCalls.length > 0);
  for (const call of restoreCalls) assert.doesNotMatch(call, /Approved/);
});
