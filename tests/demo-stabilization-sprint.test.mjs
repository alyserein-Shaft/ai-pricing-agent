import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

// Demo Stabilization Sprint: items 4 (Project Type immediate feedback),
// 5 (BOQ re-extraction warning) and 6 (NPQ immediate UX fixes) are all
// presentation-only changes in app/page.tsx and OverviewWorkspace.tsx --
// no backend/schema/governance change. Matches this codebase's own
// established pattern for asserting UI wiring: source-level regex checks
// against the real file, not a DOM-rendering harness.
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const overview = fs.readFileSync(
  new URL("../app/components/workspaces/OverviewWorkspace.tsx", import.meta.url),
  "utf8",
);

// ---------------------------------------------------------------------
// Item 4: Project Type immediate feedback
// ---------------------------------------------------------------------

test("Project Type: reason entry uses the governed modal, not window.prompt", () => {
  const fn = page.slice(page.indexOf("const mutateProjectType"), page.indexOf("const mutateQuotation"));
  assert.match(fn, /await promptForReason\(/);
  assert.doesNotMatch(fn, /window\.prompt\(/);
});

test("Project Type: cancelling shows explicit feedback and leaves value unchanged", () => {
  const fn = page.slice(page.indexOf("const mutateProjectType"), page.indexOf("const mutateQuotation"));
  const cancelBranch = fn.slice(fn.indexOf("if (!reason)"), fn.indexOf("setProjectTypeOverride(value)"));
  assert.match(cancelBranch, /showToast\("Project type change cancelled"\)/);
  assert.match(cancelBranch, /return;/);
  // no optimistic/server mutation before the cancel branch's own return
  assert.doesNotMatch(cancelBranch, /requestJson\(/);
});

test("Project Type: value updates immediately on confirm, before the network round trip", () => {
  const fn = page.slice(page.indexOf("const mutateProjectType"), page.indexOf("const mutateQuotation"));
  const setIndex = fn.indexOf("setProjectTypeOverride(value)");
  const commandIndex = fn.indexOf("commandThenRefresh(");
  assert.ok(setIndex > -1 && commandIndex > -1);
  assert.ok(setIndex < commandIndex, "the optimistic update must happen before the request, not after");
});

test("Project Type: a failed request reverts the optimistic value", () => {
  const fn = page.slice(page.indexOf("const mutateProjectType"), page.indexOf("const mutateQuotation"));
  const catchBranch = fn.slice(fn.indexOf("} catch (error)"));
  assert.match(catchBranch, /setProjectTypeOverride\(undefined\)/);
});

test("Project Type select prefers the optimistic override over the server value, and the wizard threads it through", () => {
  assert.match(
    overview,
    /projectTypeOverride !== undefined\s*\n?\s*\?\s*projectTypeOverride\s*\n?\s*:\s*dashboard\.project\.projectType \|\| ""/,
  );
  assert.match(page, /projectTypeOverride=\{projectTypeOverride\}/);
  assert.match(
    page,
    /const \[projectTypeOverride, setProjectTypeOverride\] = useState</,
  );
});

// ---------------------------------------------------------------------
// Item 5: BOQ re-extraction warning
// ---------------------------------------------------------------------

test("BOQ re-extraction shows a non-blocking confirmation before firing any request, and cancelling sends none", () => {
  // BOQ Auto-Verification (2026-09-13): the warning was expanded to
  // explicitly cover the 4 points a rerun implies -- a new extraction
  // version, current rows becoming historical (not live) evidence, no
  // automatic carry-forward of human decisions, and fresh rows being
  // evaluated again under the current Auto-Verification rules -- see
  // tests/boq-auto-verification.test.mjs test 25 for the full assertion.
  assert.match(
    page,
    /This creates a new BOQ extraction version\. The\s*\n\s*current rows become historical evidence, not\s*\n\s*live evidence\. Item-level human review and\s*\n\s*approval decisions are not carried forward/,
  );
  // deliberately not window.confirm() -- an existing test in
  // tests/boq-understanding-pilot.test.mjs already documents why: it blocks
  // the render thread and cannot be dismissed by automated/CDP-driven
  // browser clients, which is why this codebase removed it elsewhere.
  const block = page.slice(page.indexOf("boqRerunArmedFor === document.id ? ("), page.indexOf("Re-run BOQ extraction"));
  assert.doesNotMatch(block, /window\.confirm\(/);
  assert.match(block, /Confirm re-run/);
  assert.match(block, /setBoqRerunArmedFor\(null\);\s*\n\s*void boqExtractionCommand\(document, "rerun"\);/);
  // Cancel resets the armed state without ever calling boqExtractionCommand
  const cancelButton = block.slice(block.indexOf("Cancel") - 200, block.indexOf("Cancel"));
  assert.match(cancelButton, /onClick=\{\(\) => setBoqRerunArmedFor\(null\)\}/);
});

test("BOQ re-extraction confirmation only gates the rerun path, not a first-time extraction", () => {
  assert.match(page, /boqRerunArmedFor === document\.id \? \(/);
  assert.match(page, /onClick=\{\(\) => setBoqRerunArmedFor\(document\.id\)\}/);
});

// ---------------------------------------------------------------------
// Item 6: NPQ immediate UX fixes
// ---------------------------------------------------------------------

// Authority Consolidation & NPQ Simplification Sprint, item 6: Primary
// Pricing Source Type (and Pricing Strategy entirely) were removed from
// onboarding -- they were metadata only, never connected to the pricing
// runtime. See tests/onboarding-simplification-ui.test.mjs for the
// current, positive assertion that no such control remains.
test("6A: Primary Pricing Source Type is no longer part of onboarding at all (superseded by the Authority Consolidation Sprint's removal)", () => {
  assert.doesNotMatch(page, /pricingSourceTypeRequired/);
  assert.doesNotMatch(page, /Primary pricing source type/);
});

// Authority Consolidation & NPQ Simplification Sprint, item 3: the wizard
// is now a single step, so "Review NPQ" no longer exists as a separate
// gate -- missingNpqFields now directly gates the Create project button
// alongside the other real creation blockers.
test("6B: the actual missing fields are shown instead of silently disabling, now on the Create project button directly", () => {
  assert.match(page, /const missingNpqFields: string\[\] = \[\];/);
  assert.match(page, /Complete before continuing: \{missingNpqFields\.join\(", "\)\}\./);
  const footerBlock = page.slice(page.indexOf('<footer>\n              <button className="secondary" onClick={closeNewProjectWizard}>'));
  assert.match(footerBlock.slice(0, 800), /missingNpqFields\.length > 0/);
});

test("6C: optional tender context banner no longer claims fields are unpersisted", () => {
  assert.doesNotMatch(
    page,
    /not persisted to the\s*\n?\s*server in this version/,
  );
  assert.match(
    page,
    /These fields are saved with the project as onboarding\s*\n?\s*context\./,
  );
});

test("6D: Internal Reference copy no longer claims server-side auto-generation", () => {
  assert.doesNotMatch(page, /"Generated if blank"/);
  assert.doesNotMatch(page, /"Generated on creation"/);
  assert.match(
    page,
    /Optional\. Leave blank if no internal reference is assigned\./,
  );
});

test("6E: Create project guards against a duplicate onboard POST and shows an in-flight state", () => {
  const fn = page.slice(page.indexOf("const createLocalProject"), page.indexOf("const openNewProjectWizard"));
  assert.match(fn, /if \(isCreatingProject\) return;/);
  assert.match(fn, /setIsCreatingProject\(true\);/);
  assert.match(fn, /\} finally \{\s*\n\s*setIsCreatingProject\(false\);/);
  // Authority Consolidation Sprint, item 3: the disabled condition now also
  // includes missingNpqFields.length (the wizard is single-step), so this
  // only checks that isCreatingProject is still one of the guards, not the
  // exact original clause order.
  const createButtonBlock = page.slice(page.indexOf('onClick={createLocalProject}') - 400, page.indexOf('onClick={createLocalProject}'));
  assert.match(createButtonBlock, /Boolean\(draftProjectIdentityConflict\)/);
  assert.match(createButtonBlock, /draftTenderTimelineBlocked/);
  assert.match(createButtonBlock, /isCreatingProject/);
  assert.match(page, /\{isCreatingProject \? "Creating…" : "Create project"\}/);
});
