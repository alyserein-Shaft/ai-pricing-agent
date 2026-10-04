import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { registeredSystems } from "../app/domain/system-knowledge-registry.mjs";

// Authority Consolidation & NPQ Simplification Sprint, items 1/3/5/6/7/12:
// UI-truth assertions against the simplified onboarding wizard. Matches
// this codebase's established convention of source-level regex assertions
// against the real file (see tests/demo-stabilization-sprint.test.mjs).
//
// ONBOARDING RECOVERY B deliberately replaced the single "Primary system *"
// question with "Systems in scope *" (open-ended, multi-value) plus a
// separate, unstarred "Primary system" selector limited to whatever was
// selected -- see tests/onboarding-b-multi-system.test.mjs for the new
// behavior's own coverage. The assertions below are updated in place for
// that intentional change, not reopened/relitigated.
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

const wizardBlock = page.slice(
  page.indexOf('aria-labelledby="new-project-title"'),
  page.indexOf('{showProjectEditor && ('),
);

test("exactly one Systems in scope control exists in the whole new-project wizard", () => {
  const matches = wizardBlock.match(/Systems in scope \*/g) || [];
  assert.equal(matches.length, 1, `expected exactly one Systems in scope control, found ${matches.length}`);
});

test("the Systems-in-scope input offers registered systems as suggestions via datalist, but allows any custom value; Primary is a constrained selector over the selection", () => {
  const scopeBlock = wizardBlock.slice(
    wizardBlock.indexOf("Systems in scope *"),
    wizardBlock.indexOf("Primary system"),
  );
  assert.ok(scopeBlock.includes('list="system-scope-suggestions"'), "should be a text input with datalist");
  assert.ok(scopeBlock.includes("<datalist"), "should contain a datalist element");
  // The datalist is built from registeredSystems().map() — one option element in source, dynamically expanded
  assert.ok(scopeBlock.includes("registeredSystems().map"), "should map registeredSystems() into options");
  // No <select> in the Systems-in-scope add control itself (still free text)
  assert.doesNotMatch(scopeBlock, /<select/);

  const primaryBlock = wizardBlock.slice(
    wizardBlock.indexOf("Primary system"),
    wizardBlock.indexOf("Project currency"),
  );
  assert.match(primaryBlock, /<select/, "Primary is now a selector, constrained to the chosen Systems in scope");
  assert.match(primaryBlock, /draftSystemsInScope\.map/);
});

test("no duplicate 15-option system vocabulary remains anywhere in the wizard", () => {
  assert.doesNotMatch(wizardBlock, /Public Address &amp; Voice Alarm/);
  assert.doesNotMatch(wizardBlock, /Building Management Systems/);
  assert.doesNotMatch(wizardBlock, /Car Park Management Systems/);
});

test("onboarding no longer sends a non-canonical system label to the server -- the old one-off 'Fire Detection & Alarm' string is gone from the suggestions", () => {
  assert.doesNotMatch(wizardBlock, /value="Fire Detection &amp; Alarm"/);
});

test("Project Currency is a required field, visible (not hidden in a collapsed section), in the wizard", () => {
  assert.match(wizardBlock, /Project currency \*/);
  const currencyIndex = wizardBlock.indexOf("Project currency *");
  const detailsIndex = wizardBlock.indexOf("<details");
  assert.ok(currencyIndex > -1 && detailsIndex > -1 && currencyIndex < detailsIndex, "Project Currency must appear before the collapsed optional section, not inside it");
});

test("no required-looking Pricing Strategy, Manufacturer Strategy, or Price Source control remains in onboarding", () => {
  assert.doesNotMatch(wizardBlock, /Pricing strategy \*/);
  assert.doesNotMatch(wizardBlock, /Manufacturer strategy \*/);
  assert.doesNotMatch(wizardBlock, /Primary pricing source type/);
  assert.doesNotMatch(wizardBlock, /Selected price source/);
  assert.doesNotMatch(wizardBlock, /Approved manufacturers/);
});

test("no Expected Project Evidence gate remains in onboarding", () => {
  assert.doesNotMatch(wizardBlock, /EXPECTED PROJECT EVIDENCE/);
  assert.doesNotMatch(wizardBlock, /Declared inputs for this NPQ/);
});

test("the wizard is a single step -- no NPQ Strategy or Review step remains", () => {
  assert.doesNotMatch(wizardBlock, /NPQ estimation strategy/);
  assert.doesNotMatch(wizardBlock, /Review &amp; confirm/);
  assert.doesNotMatch(wizardBlock, /STEP \{newProjectStep\} OF 3/);
  assert.doesNotMatch(wizardBlock, /Define NPQ strategy/);
  assert.doesNotMatch(wizardBlock, /Review NPQ/);
});

test("Create project is reachable directly from the single step, gated only by the real required fields", () => {
  assert.match(wizardBlock, /onClick=\{createLocalProject\}/);
  const footerBlock = wizardBlock.slice(wizardBlock.indexOf("<footer>"));
  assert.match(footerBlock, /missingNpqFields\.length > 0/);
});

test("missingNpqFields (the single source of truth for the Create button gate) checks Client (ONBOARDING RECOVERY D), system membership (Systems in scope / Primary) and projectCurrency -- nothing else", () => {
  const fnBlock = page.slice(
    page.indexOf("const missingNpqFields: string[] = [];"),
    page.indexOf("const missingNpqFields: string[] = [];") + 900,
  );
  // ONBOARDING RECOVERY B: the backend contract is unchanged (a project
  // system and NPQ primarySystem remain required) -- only the UI question
  // changed from a single "Primary system" text field to Systems-in-scope
  // membership plus a Primary drawn from it.
  assert.match(fnBlock, /if \(!draftClientName\.trim\(\)\) missingNpqFields\.push\("Client \/ main contractor"\);/);
  assert.match(fnBlock, /if \(draftSystemsInScope\.length === 0\) missingNpqFields\.push\("Systems in scope"\);/);
  assert.match(fnBlock, /draftSystemsInScope\.includes\(draftIntakeProfile\.system\)/);
  assert.match(fnBlock, /if \(!draftNpQ\.projectCurrency\) missingNpqFields\.push\("Project currency"\);/);
  assert.doesNotMatch(fnBlock, /deliveryScope/);
  assert.doesNotMatch(fnBlock, /pricingSourceTypeRequired/);
  assert.doesNotMatch(fnBlock, /draftProjectCode|draftProjectDueDate|inquirySubject/, "Internal Reference, Deadline and Inquiry Subject must stay completable later");
});

// ── Wave 1: Open Project System Creation ──────────────────────────────
// (system openness itself is unchanged by ONBOARDING RECOVERY B -- only
// re-pointed at the new Systems-in-scope add control, which is where free-
// text system entry now lives; see tests/onboarding-b-multi-system.test.mjs
// for the full new-behavior coverage.)

test("Wave 1: Systems in scope is a free-text input with datalist, not a restrictive select", () => {
  const scopeBlock = wizardBlock.slice(
    wizardBlock.indexOf("Systems in scope *"),
    wizardBlock.indexOf("Primary system"),
  );
  assert.ok(scopeBlock.includes('list="system-scope-suggestions"'), "should be a text input with datalist");
  assert.ok(scopeBlock.includes("<datalist"), "should contain a datalist element");
  assert.doesNotMatch(scopeBlock, /<select/, "the add-system input itself stays free text");
});

test("Wave 1: datalist suggestions include Fire Alarm and CCTV (registered systems)", () => {
  const datalistBlock = wizardBlock.slice(
    wizardBlock.indexOf("system-scope-suggestions"),
    wizardBlock.indexOf("Primary system"),
  );
  assert.ok(datalistBlock.includes("registeredSystems()"), "should call registeredSystems() for suggestions");
  assert.ok(datalistBlock.includes("value={sys}"), "should bind value to sys variable");
  assert.ok(datalistBlock.includes("<datalist"), "should be a datalist element");
});

test("Wave 1: Intercom is NOT in SYSTEM_PACKS but would be accepted as a valid project system", () => {
  assert.ok(!registeredSystems().includes("Intercom"), "Intercom should not be in registeredSystems()");
  // The Systems-in-scope text input accepts any value — no whitelist validation in the UI
  assert.ok(page.includes('list="system-scope-suggestions"'), "text input accepts free text");
});

test("Wave 1: registeredSystems() still returns only Fire Alarm and CCTV (capability registry unchanged)", () => {
  assert.deepEqual(registeredSystems(), ["Fire Alarm", "CCTV"]);
});
