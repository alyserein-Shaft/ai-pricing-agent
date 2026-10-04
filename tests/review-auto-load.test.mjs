import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

// Consolidation Fix Sprint 1, item 2: activeModule !== "Review" never
// matched (only "Technical Review"/"Commercial Review" are valid
// ModuleName values), so loadReviewWorkspace(true) never ran on
// navigation and the review queue silently looked empty until a manual
// refresh. Matches this codebase's established convention of source-level
// regex assertions against the real file rather than a DOM harness.
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

const effectBlock = page.slice(
  page.indexOf("// Consolidation Fix Sprint 1, item 2:"),
  page.indexOf("actOnReview = async"),
);

test("Review queue effect no longer gates on the invalid 'Review' module name", () => {
  assert.doesNotMatch(effectBlock, /activeModule !== "Review"/);
});

test("navigating to Technical Review triggers the review workspace load", () => {
  assert.match(
    effectBlock,
    /if \(activeModule !== "Technical Review" && activeModule !== "Commercial Review"\) return;/,
  );
  assert.match(effectBlock, /void loadReviewWorkspace\(true\);/);
});

test("navigating to Commercial Review triggers the review workspace load", () => {
  // Same guard clause covers both real module names -- confirm both are present.
  assert.match(effectBlock, /activeModule !== "Commercial Review"/);
});

test("an unrelated module does not trigger review loading, and the effect still only re-fires on activeModule/projectId change", () => {
  assert.match(effectBlock, /}, \[activeModule, projectId\]\);/);
  // The guard clause is a single early return -- any module other than the
  // two valid Review names (e.g. "BOQ", "Dashboard") returns before the
  // setTimeout/loadReviewWorkspace call is ever scheduled.
  const guardIndex = effectBlock.indexOf('if (activeModule !== "Technical Review"');
  const loadIndex = effectBlock.indexOf("void loadReviewWorkspace(true);");
  assert.ok(guardIndex > -1 && loadIndex > -1 && guardIndex < loadIndex);
});
