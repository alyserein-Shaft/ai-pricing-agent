import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

// Reopen/resume guards for the CONTROLLED NORMALIZED BOQ review.
//
// These assertions are SOURCE-LEVEL by necessity, not by preference: the repo's
// vite dev server requires an interactive `wrangler login`, so no runtime harness is
// available here. They therefore prove the WIRING and the fail-closed GUARDS, which is
// where the defects lived.
//
// HISTORY -- why the shape of these assertions changed:
// An earlier revision gated the normalized review on a CLIENT-LOCAL hash cache
// (`documentHashes[logical_name]`), resolved through a `controlledBoqShaFor(document)`
// helper and guarded by `if (!registeredHash)`. That cache is hydrated only from
// localStorage, which `browserBusinessPersistenceEnabled = false` disables, so in a
// fresh browser the gate was false and the button was invisible in the live UI.
// Authority now comes from the CANONICAL server-backed `document.sha256`. The guards
// below therefore assert canonical authority AND assert that the old client-cache gate
// is GONE, so the outage cannot silently return.

const SRC = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const between = (startNeedle, endNeedle) => {
  const start = SRC.indexOf(startNeedle);
  assert.notEqual(start, -1, `missing anchor: ${startNeedle}`);
  const end = SRC.indexOf(endNeedle, start + startNeedle.length);
  assert.notEqual(end, -1, `missing end anchor: ${endNeedle}`);
  return SRC.slice(start, end);
};

// The visible label sits AFTER onClick inside the element, so a slice that starts at
// the label would miss the handler. Slice the whole element instead.
const elementAround = (label) => {
  const at = SRC.indexOf(label);
  assert.notEqual(at, -1, `missing label: ${label}`);
  const open = SRC.lastIndexOf("<button", at);
  assert.notEqual(open, -1, `no <button> before label: ${label}`);
  const close = SRC.indexOf("</button>", at);
  assert.notEqual(close, -1, `no </button> after label: ${label}`);
  return SRC.slice(open, close + "</button>".length);
};

test("1: a clear reopen action exists and is wired to the NORMALIZED review, not the raw one", () => {
  const action = elementAround("Review normalized BOQ");
  assert.match(action, /openNormalizedBoqReview\(/);
  assert.doesNotMatch(action, /openBoqExtractionReview\(/);
});

test("2: the raw extraction review stays available and SEPARATE", () => {
  assert.match(SRC, /openBoqExtractionReview/);
  assert.match(SRC, /Review extracted rows/);
  // The two entry points must not be collapsed into one.
  assert.notEqual(
    SRC.indexOf("Review normalized BOQ"),
    SRC.indexOf("Review extracted rows"),
    "the normalized and raw review actions must be distinct",
  );
});

test("3: closing the drawer no longer discards decisions (it is a VIEW action)", () => {
  const close = between("const closeKnownBoqExtraction", "const loadServerNormalizationReview");
  assert.doesNotMatch(close, /setBoqLineDecisions\(\{\}\)/, "close must not clear decisions");
  assert.doesNotMatch(close, /setBoqExclusionReasons\(\{\}\)/, "close must not clear reasons");
});

test("4: decisions survive a page refresh — they are PERSISTED server-side and restored", () => {
  // The server owns the decisions; the client is only a view of them.
  const persist = between("const persistCandidateDecision", "const openNormalizedBoqReview");
  assert.match(persist, /candidates\/by-ordinal\//, "decisions persist by controlled ordinal");
  assert.match(persist, /method: "POST"/);

  const load = between("const loadServerNormalizationReview", "const persistCandidateDecision");
  assert.match(load, /boq-normalization\/reviews\?documentId=/, "resume reads the server review");
  assert.match(load, /setBoqLineDecisions\(decisions\)/, "resume restores decisions from the server");
  assert.match(load, /setNormalizationReviewId\(review\.id\)/);
  // Anything undecided stays Pending so the server remains authority.
  assert.match(load, /"Pending"/);
});

test("5: restore reads the CURRENT server review and never fabricates decisions", () => {
  const load = between("const loadServerNormalizationReview", "const persistCandidateDecision");
  // A read failure must not invent decisions.
  assert.match(load, /catch/, "a failed read is caught");
  assert.doesNotMatch(load, /setBoqLineDecisions\(\{[^}]*:\s*"Accepted"/, "no fabricated acceptance");
});

test("6: reopening requires the controlled fingerprint and refuses otherwise", () => {
  const open = between("const openNormalizedBoqReview", "const applyKnownBoqExtraction");
  assert.match(open, /document\.sha256 !== almoosaBoqSha256/, "refuses a non-controlled fingerprint");
  assert.match(open, /showToast\(/, "refusal is explained to the reviewer");
  // The refusal must happen BEFORE the review is loaded.
  const guardAt = open.indexOf("document.sha256 !== almoosaBoqSha256");
  const loadAt = open.indexOf("loadServerNormalizationReview");
  assert.ok(guardAt !== -1 && loadAt !== -1 && guardAt < loadAt, "the guard must precede the load");
});

test("7: the 21 candidates and 90 anchors are untouched — the reopen path rebuilds nothing", () => {
  const load = between("const loadServerNormalizationReview", "const persistCandidateDecision");
  assert.doesNotMatch(load, /method:\s*"POST"[^}]*candidates/, "reopen must not write candidates");
  assert.doesNotMatch(load, /bootstrap/, "reopen must not regenerate the normalization");
});

test("8: reopening the same workbook does not clear decisions", () => {
  const load = between("const loadServerNormalizationReview", "const persistCandidateDecision");
  assert.doesNotMatch(load, /setBoqLineDecisions\(\{\}\)/, "reopen must not wipe decisions");
  assert.match(load, /candidate\.decision === "Accepted" \|\| candidate\.decision === "Excluded"/, "server decisions are mirrored verbatim");
  assert.match(load, /: "Pending";/, "anything undecided stays Pending");
});

test("9: applying the normalized lines routes through the CANONICAL server Apply", () => {
  const apply = between("const applyKnownBoqExtraction", "const closeGenericBoqPreview");
  assert.match(apply, /\/api\/boq-normalization\/\$\{encodeURIComponent\(normalizationReviewId\)\}\/apply/);
  assert.match(apply, /requireDocumentIssue: true/, "document issue stays governed");
  assert.match(apply, /documentIssueAllowsScope/, "document issue is confirmed, not assumed");
});

test("10: the reopen action is offered only for the controlled BOQ document", () => {
  const gate = elementAround("Review normalized BOQ").slice(0, 400);
  assert.match(SRC, /document\.sha256 === almoosaBoqSha256 && \(/);
  assert.match(gate, />\s*Review normalized BOQ/);
});

test("11: the gate reads the CANONICAL server hash, NOT the client-only hash map", () => {
  // This is the regression that made the button invisible in the live UI.
  assert.match(SRC, /document\.sha256 === almoosaBoqSha256/);
  assert.doesNotMatch(SRC, /documentHashes\[document\.logical_name\]\s*===\s*almoosaBoqSha256/,
    "the client-local hash cache must not gate the normalized review");
  const open = between("const openNormalizedBoqReview", "const applyKnownBoqExtraction");
  assert.doesNotMatch(open, /documentHashes\[/, "reopen must not consult the client hash cache");
});

test("12: authority comes from the document model, which the server populates", () => {
  // `ManagedDocument.sha256` is a required, server-backed field on the document model.
  assert.match(SRC, /type ManagedDocument = \{[\s\S]{0,900}?sha256: string;/);
  const open = between("const openNormalizedBoqReview", "const applyKnownBoqExtraction");
  assert.match(open, /document: ManagedDocument/, "the whole document is passed, not just its name");
});

test("13: the policy banner reports the server verdict without granting authority client-side", () => {
  assert.match(SRC, /normalized-boq-policy-banner/);
  assert.match(SRC, /Auto-approved by policy/);
  assert.match(SRC, /current normalized BOQ/);
  assert.match(SRC, /current normalized BOQ\s*lines/);
  // The verdict is READ from the server, never computed in the component.
  const load = between("const loadServerNormalizationReview", "const persistCandidateDecision");
  assert.match(load, /evaluate-auto-approval/, "the policy verdict comes from the server");
  assert.match(load, /setNormalizationPolicy\(/);
});