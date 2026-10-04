// DOCUMENTS_BOQ_REVIEW_REENTRY -- the BOQ review action re-opens the
// existing runtime review modal without re-running extraction.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const pageSource = () => readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const cssSource = () => readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("A/B: BOQ review action label is dynamic with singular/plural", async () => {
  const page = await pageSource();
  assert.match(page, /Review \{Number\(downstreamState\?\.pendingCount\)\} item/);
  assert.match(page, /\{Number\(downstreamState\?\.pendingCount\) === 1 \? "" : "s"\}/);
});

test("C: review action renders only when pending items exist on a BOQ document", async () => {
  const page = await pageSource();
  const at = page.indexOf('className="boq-review-reentry"');
  const region = page.slice(Math.max(0, at - 900), at + 900);
  assert.match(region, /document\.boq_extraction_id/);
  assert.match(region, /contentReadableForDownstream\(document\)/);
  assert.match(region, /Number\(downstreamState\?\.pendingCount \|\| 0\) > 0/);
});

test("D: non-BOQ documents cannot render the BOQ review action", async () => {
  const page = await pageSource();
  // Exactly one render site, gated on boq_extraction_id, which only BOQ
  // extraction documents carry (asserted in test C).
  const occurrences = page.match(/boq-review-reentry/g) || [];
  assert.equal(occurrences.length, 1, "single gated render site only");
  assert.doesNotMatch(page, /isSpecificationDocument[\s\S]{0,400}boq-review-reentry/);
});

test("E: review click uses the existing runtime review-open path", async () => {
  const page = await pageSource();
  const at = page.indexOf('className="boq-review-reentry"');
  const region = page.slice(Math.max(0, at - 900), at + 900);
  assert.match(region, /openBoqRuntimeCandidates\(\s*document\.id/);
});

test("F/G: review click never triggers rerun extraction or new versions", async () => {
  const page = await pageSource();
  const at = page.indexOf('className="boq-review-reentry"');
  const region = page.slice(Math.max(0, at - 900), at + 900);
  assert.doesNotMatch(region, /rerun/i);
  assert.doesNotMatch(region, /boqExtractionCommand/);
});

test("affordance: review action is visibly button-like with hover and focus", async () => {
  const css = await cssSource();
  assert.match(css, /\.boq-review-reentry \{[^}]*border:[^}]*background:[^}]*cursor:pointer;/);
  assert.match(css, /\.boq-review-reentry:hover \{/);
  assert.match(css, /\.boq-review-reentry:focus-visible \{/);
});

test("J/K: Open BOQ workspace and More controls are unchanged", async () => {
  const page = await pageSource();
  assert.match(page, /<button onClick=\{\(\) => navigate\("BOQ"\)\}>\s*Open BOQ workspace\s*<\/button>/);
  assert.match(page, /More file controls/);
});
