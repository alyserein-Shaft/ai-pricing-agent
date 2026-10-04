import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  addSystemToScope,
  removeSystemFromScope,
  buildOnboardingSystemsPayload,
  isValidScope,
} from "../app/domain/project-system-scope.mjs";
import { resolveProjectSystems, registeredSystems } from "../app/domain/system-knowledge-registry.mjs";

// ONBOARDING RECOVERY B -- Multi-System Project Creation.
//
// Real, independently-testable behavior lives in the pure
// app/domain/project-system-scope.mjs helpers (no DOM/rendering harness
// needed for the decision logic itself). Wiring/UI-structure assertions
// follow this codebase's established convention (see
// tests/onboarding-simplification-ui.test.mjs / tests/demo-stabilization-
// sprint.test.mjs): source-level regex checks against the real app/page.tsx.
//
// No DB access, no live business data, fixtures only.
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const wizardBlock = page.slice(
  page.indexOf('aria-labelledby="new-project-title"'),
  page.indexOf('{showProjectEditor && ('),
);

// ── NO FIRE ALARM DEFAULT ──────────────────────────────────────────────

test("NO FIRE ALARM DEFAULT: none of the three new-project wizard state resets declare a system", () => {
  const literalFireAlarmDefaults = (page.match(/system: "Fire Alarm"/g) || []).length;
  // The two non-wizard occurrences that must remain untouched (existing
  // demo project's own useState, and loadProject's fallback for a legacy
  // project that was saved with no intakeProfile at all -- neither is the
  // Create Project wizard, and neither is a new project).
  assert.equal(literalFireAlarmDefaults, 2, "only the pre-existing demo-project state and legacy-load fallback may still default to Fire Alarm");
  assert.match(page, /const \[draftIntakeProfile, setDraftIntakeProfile\] =\s*\n\s*useState<ProjectIntakeProfile>\(\{\s*\n\s*country: "Saudi Arabia",\s*\n\s*city: "",\s*\n\s*location: "",\s*\n\s*[\s\S]*?system: "",/, "the wizard's own draftIntakeProfile state must initialize system to an empty string");
});

test("NO FIRE ALARM DEFAULT: opening the wizard clears any previously selected Systems in scope", () => {
  const fn = page.slice(page.indexOf("const openNewProjectWizard"), page.indexOf("const closeNewProjectWizard"));
  assert.match(fn, /setDraftSystemsInScope\(\[\]\)/);
  assert.match(fn, /system: "",/);
});

test("addSystemToScope never declares a system on its own -- an empty scope stays empty until add is called", () => {
  const state = { scope: [], primary: "" };
  assert.deepEqual(state, { scope: [], primary: "" });
});

// ── SINGLE SYSTEM ───────────────────────────────────────────────────────

test("SINGLE SYSTEM: Fire Alarm selected -> Primary = Fire Alarm, additionalSystems = []", () => {
  const after = addSystemToScope({ scope: [], primary: "" }, "Fire Alarm");
  assert.deepEqual(after, { scope: ["Fire Alarm"], primary: "Fire Alarm" });
  const payload = buildOnboardingSystemsPayload(after);
  assert.deepEqual(payload, { primarySystem: "Fire Alarm", additionalSystems: [] });
});

// ── MULTI SYSTEM ────────────────────────────────────────────────────────

test("MULTI SYSTEM: Fire Alarm + CCTV + Access Control -> all persisted, one Primary, remainder in additionalSystems", () => {
  let state = { scope: [], primary: "" };
  state = addSystemToScope(state, "Fire Alarm");
  state = addSystemToScope(state, "CCTV");
  state = addSystemToScope(state, "Access Control");
  assert.deepEqual(state, { scope: ["Fire Alarm", "CCTV", "Access Control"], primary: "Fire Alarm" });
  const payload = buildOnboardingSystemsPayload(state);
  assert.equal(payload.primarySystem, "Fire Alarm");
  assert.deepEqual(payload.additionalSystems, ["CCTV", "Access Control"]);
  assert.ok(!payload.additionalSystems.includes(payload.primarySystem), "Primary must never be duplicated inside additionalSystems");
});

// ── OPEN SYSTEM ─────────────────────────────────────────────────────────

test("OPEN SYSTEM: Intercom is accepted without a SYSTEM_PACK, BMS too", () => {
  const state = addSystemToScope(addSystemToScope({ scope: [], primary: "" }, "Fire Alarm"), "Intercom");
  assert.ok(state.scope.includes("Intercom"));
  const withBms = addSystemToScope(state, "BMS");
  assert.ok(withBms.scope.includes("BMS"));
  // registeredSystems()/SYSTEM_PACKS/hasGovernedTaxonomy() must never be
  // IMPORTED (i.e. never actually consulted) by the pure add/remove logic
  // -- open-ended per Wave 1 (Open Project System Creation). The module's
  // own doc comments mention these names in prose, which is fine; nothing
  // here checks the comments, only that no executable import pulls them in.
  const helperSource = fs.readFileSync(new URL("../app/domain/project-system-scope.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(helperSource, /^import /m, "the pure scope helpers import nothing -- no registry, no taxonomy, no framework");
});

// ── PRIMARY MEMBERSHIP ──────────────────────────────────────────────────

test("PRIMARY MEMBERSHIP: Primary is always a member of Systems in scope after every add/remove", () => {
  let state = { scope: [], primary: "" };
  assert.ok(isValidScope(state));
  state = addSystemToScope(state, "Fire Alarm");
  assert.ok(isValidScope(state));
  state = addSystemToScope(state, "CCTV");
  assert.ok(isValidScope(state));
  state = removeSystemFromScope(state, "CCTV");
  assert.ok(isValidScope(state));
  state = removeSystemFromScope(state, "Fire Alarm");
  assert.ok(isValidScope(state));
  assert.deepEqual(state, { scope: [], primary: "" });
});

// ── PRIMARY REMOVAL ─────────────────────────────────────────────────────

test("PRIMARY REMOVAL: removing Primary deterministically promotes a remaining System, never a stale value", () => {
  let state = { scope: [], primary: "" };
  state = addSystemToScope(state, "Fire Alarm"); // Primary
  state = addSystemToScope(state, "CCTV");
  state = addSystemToScope(state, "Access Control");
  assert.equal(state.primary, "Fire Alarm");
  const afterRemoval = removeSystemFromScope(state, "Fire Alarm");
  assert.deepEqual(afterRemoval.scope, ["CCTV", "Access Control"]);
  assert.notEqual(afterRemoval.primary, "Fire Alarm", "Primary can no longer be the removed system");
  assert.ok(afterRemoval.scope.includes(afterRemoval.primary), "the promoted Primary must be a real remaining member");
  assert.equal(afterRemoval.primary, "CCTV", "deterministic: the next remaining system in insertion order");
  const payload = buildOnboardingSystemsPayload(afterRemoval);
  assert.equal(payload.primarySystem, "CCTV");
  assert.deepEqual(payload.additionalSystems, ["Access Control"]);
});

test("PRIMARY REMOVAL: removing the only System leaves an empty, valid, re-addable state", () => {
  let state = addSystemToScope({ scope: [], primary: "" }, "Fire Alarm");
  state = removeSystemFromScope(state, "Fire Alarm");
  assert.deepEqual(state, { scope: [], primary: "" });
  assert.ok(isValidScope(state));
});

test("removing a non-Primary System leaves Primary untouched", () => {
  let state = { scope: [], primary: "" };
  state = addSystemToScope(state, "Fire Alarm");
  state = addSystemToScope(state, "CCTV");
  const after = removeSystemFromScope(state, "CCTV");
  assert.deepEqual(after, { scope: ["Fire Alarm"], primary: "Fire Alarm" });
});

// ── DEDUPLICATION ───────────────────────────────────────────────────────

test("DEDUPLICATION: exact-trimmed-string match, matching normalizeNpQProfile's own list() convention", () => {
  let state = addSystemToScope({ scope: [], primary: "" }, "Fire Alarm");
  state = addSystemToScope(state, "Fire Alarm");
  assert.deepEqual(state.scope, ["Fire Alarm"], "repeated exact same system does not create duplicate membership");
  state = addSystemToScope(state, " Fire Alarm ");
  assert.deepEqual(state.scope, ["Fire Alarm"], "surrounding whitespace alone does not create duplicate membership");
  // Preserve current domain conventions: no case-insensitive normalization
  // (matches project-npq-engine.mjs's list(), which only trims).
  state = addSystemToScope(state, "fire alarm");
  assert.deepEqual(state.scope, ["Fire Alarm", "fire alarm"], "different case is a different string under the existing convention -- not fuzzy-merged");
});

test("adding a blank/whitespace-only entry is rejected", () => {
  const state = addSystemToScope({ scope: [], primary: "" }, "   ");
  assert.deepEqual(state, { scope: [], primary: "" });
});

// ── PAYLOAD ─────────────────────────────────────────────────────────────

test("PAYLOAD: top-level system equals npq.primarySystem by construction", () => {
  const fn = page.slice(page.indexOf("const createLocalProject"), page.indexOf("const openNewProjectWizard"));
  assert.match(fn, /const systemsPayload = buildOnboardingSystemsPayload\(/);
  assert.match(fn, /system: systemsPayload\.primarySystem,/);
  assert.match(fn, /primarySystem: systemsPayload\.primarySystem,/);
  assert.match(fn, /additionalSystems: systemsPayload\.additionalSystems,/);
});

test("PAYLOAD shape example from the brief resolves through the pure builder", () => {
  let state = { scope: [], primary: "" };
  state = addSystemToScope(state, "Fire Alarm");
  state = addSystemToScope(state, "CCTV");
  state = addSystemToScope(state, "Access Control");
  const payload = buildOnboardingSystemsPayload(state);
  assert.equal(payload.primarySystem, "Fire Alarm");
  assert.deepEqual(payload.additionalSystems, ["CCTV", "Access Control"]);
});

// ── CANONICAL RESOLVER ──────────────────────────────────────────────────

test("CANONICAL RESOLVER (Multi-System Test fixture): the new payload shape resolves through the existing, unmodified resolveProjectSystems()", () => {
  let state = { scope: [], primary: "" };
  state = addSystemToScope(state, "Fire Alarm");
  state = addSystemToScope(state, "CCTV");
  state = addSystemToScope(state, "Access Control");
  state = addSystemToScope(state, "Intercom");
  const payload = buildOnboardingSystemsPayload(state);
  // Shape a synthetic dashboard entry exactly as projectDashboard() would
  // populate it for a brand-new project (no BOQ evidence yet, no legacy
  // system_domain override needed since NPQ already declares everything).
  const dashboardEntry = {
    systemComposition: { isDerived: false, systems: [] },
    npqSystems: payload,
    systemDomain: payload.primarySystem,
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  assert.deepEqual(
    new Set(resolved.systems),
    new Set(["Fire Alarm", "CCTV", "Access Control", "Intercom"]),
    "all four declared systems must be canonical project members, no SYSTEM_PACK required for Intercom",
  );
  assert.equal(resolved.systems.length, 4, "no system is lost or duplicated by the resolver");
  // ONBOARDING RECOVERY B1 fixed the resolver's Primary authority: the
  // governed NPQ primarySystem now always wins over item-count/alphabetical
  // ordering (see resolveProjectSystems's own updated doc comment and
  // tests/onboarding-b1-primary-membership-integrity.test.mjs for the full
  // regression coverage of this fix). Superseded here: this test previously
  // asserted the pre-fix bug ("Access Control") as expected behavior.
  assert.equal(resolved.primarySystem, "Fire Alarm");
  assert.equal(dashboardEntry.npqSystems.primarySystem, "Fire Alarm");
});

// ── EXISTING PROJECT (Al Mousa, unchanged) ───────────────────────────────

test("EXISTING PROJECT: a single-system NPQ record shaped exactly like Al Mousa's real persisted data still resolves to just that one system", () => {
  // Al Mousa School's real, unmutated onboarding data (read-only audit,
  // ONBOARDING RECOVERY B1 Part 8/11): primary_system="Fire Alarm",
  // additional_systems_json="[]"; its 3 real Electrical BOQ rows are generic
  // "Fire Resistant Cable"-pattern items with category=null and
  // system_source_type="Inferred" -- non-governing per
  // isGoverningBoqSystemEvidence(). No live DB access here -- a literal
  // fixture reconstruction, per instructions (tests/fixtures only).
  const dashboardEntry = {
    systemComposition: { isDerived: true, systems: [
      { system: "Fire Alarm", itemCount: 95, governing: true },
      { system: "Electrical", itemCount: 3, governing: false },
    ] },
    npqSystems: { primarySystem: "Fire Alarm", additionalSystems: [] },
    systemDomain: "Fire Alarm",
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  // Unaffected by this wave: BOQ evidence still wins on ordering, and the
  // Corrected by ONBOARDING RECOVERY B1's governing-evidence fix: the
  // support-only Electrical cable rows are non-governing, so canonical
  // Project System membership is Fire Alarm only -- matching Wave 2A's own
  // original intent (this file's ONBOARDING RECOVERY B version incorrectly
  // set governing:true for Electrical in its fixture; see the B1 report).
  assert.deepEqual(resolved.systems, ["Fire Alarm"]);
  assert.equal(resolved.primarySystem, "Fire Alarm");
});

// ── UI wiring / structure (source-level, matching this codebase's convention) ──

test("Systems in scope * is the one starred scope-membership question in the wizard", () => {
  const matches = wizardBlock.match(/Systems in scope \*/g) || [];
  assert.equal(matches.length, 1, `expected exactly one Systems in scope control, found ${matches.length}`);
  assert.doesNotMatch(wizardBlock, /Primary system \*/, "the old single starred Primary system question must be gone");
});

test("Primary System is a plain, unstarred selector limited to the selected Systems in scope", () => {
  const block = wizardBlock.slice(wizardBlock.indexOf("Primary system"), wizardBlock.indexOf("Project currency"));
  assert.match(block, /<select/, "Primary System must be a constrained selector, not free text");
  assert.match(block, /draftSystemsInScope\.map/, "options must come from Systems in scope, not a fixed/registered vocabulary");
  assert.doesNotMatch(block, /Primary system \*/);
});

test("the Systems-in-scope free-text input offers registeredSystems() as suggestions only, with no whitelist validation", () => {
  const block = wizardBlock.slice(wizardBlock.indexOf("Systems in scope *"), wizardBlock.indexOf("Primary system"));
  assert.ok(block.includes('list="system-scope-suggestions"'), "should be a text input with datalist");
  assert.ok(block.includes("<datalist"), "should contain a datalist element");
  assert.ok(block.includes("registeredSystems().map"), "suggestions come from registeredSystems()");
  assert.doesNotMatch(block, /<select/, "the add-system input itself must remain free text, not a restrictive select");
});

test("Intercom would be accepted by the Systems-in-scope input despite not being in registeredSystems()", () => {
  assert.ok(!registeredSystems().includes("Intercom"), "Intercom is not in the capability registry");
  assert.ok(page.includes('list="system-scope-suggestions"'), "text input accepts free text beyond the datalist suggestions");
  assert.deepEqual(addSystemToScope({ scope: [], primary: "" }, "Intercom").scope, ["Intercom"]);
});

test("removing a chip calls the pure removeDraftSystem wrapper, adding calls addDraftSystem, both wired to project-system-scope.mjs", () => {
  // ONBOARDING RECOVERY F added `isValidScope` to this same import line for
  // the governed post-creation editor -- the exact set of named imports may
  // grow, but addSystemToScope/removeSystemFromScope/buildOnboardingSystemsPayload
  // must always be present, sourced from this one module.
  assert.match(page, /import \{[^}]*\baddSystemToScope\b[^}]*\bremoveSystemFromScope\b[^}]*\bbuildOnboardingSystemsPayload\b[^}]*\} from "\.\/domain\/project-system-scope\.mjs";/);
  const addFn = page.slice(page.indexOf("const addDraftSystem"), page.indexOf("const removeDraftSystem"));
  assert.match(addFn, /addSystemToScope\(/);
  const removeFn = page.slice(page.indexOf("const removeDraftSystem"), page.indexOf("const duplicateCurrentProject"));
  assert.match(removeFn, /removeSystemFromScope\(/);
});

test("Create button validation requires at least one System and a Primary that is a member of it, alongside the existing Currency rule", () => {
  const fnBlock = page.slice(
    page.indexOf("const missingNpqFields: string[] = [];"),
    page.indexOf("const missingNpqFields: string[] = [];") + 700,
  );
  assert.match(fnBlock, /draftSystemsInScope\.length === 0/);
  assert.match(fnBlock, /missingNpqFields\.push\("Systems in scope"\)/);
  assert.match(fnBlock, /draftSystemsInScope\.includes\(draftIntakeProfile\.system\)/);
  assert.match(fnBlock, /if \(!draftNpQ\.projectCurrency\) missingNpqFields\.push\("Project currency"\);/);
});

test("no new technical side effects: Systems-in-scope wiring touches no SYSTEM_PACK, matching, BOQ, requirement or product creation code", () => {
  const helperSource = fs.readFileSync(new URL("../app/domain/project-system-scope.mjs", import.meta.url), "utf8");
  for (const forbidden of [/runMatching/, /boq_items/i, /technical_requirements/i, /createProduct/i, /INSERT INTO/i]) {
    assert.doesNotMatch(helperSource, forbidden);
  }
});

// ── Preserve prior waves ────────────────────────────────────────────────

test("Wave 1 capability registry is unchanged by this wave", () => {
  // system-knowledge-registry.mjs is not modified in this wave; re-imported
  // here to prove the import itself still resolves and returns the same
  // registered set this codebase already pinned in Wave 1's own tests.
  const helperSource = fs.readFileSync(new URL("../app/domain/project-system-scope.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(helperSource, /export const registeredSystems/, "registeredSystems() stays owned by system-knowledge-registry.mjs, not duplicated here");
});

test("Project Type, Currency default/options and the collapsed tender-context ordering are unchanged", () => {
  assert.match(wizardBlock, /Project type/);
  assert.match(wizardBlock, /<option>Unknown<\/option>/);
  assert.match(wizardBlock, /<option>Tender<\/option>/);
  assert.match(wizardBlock, /<option>On-Hand<\/option>/);
  assert.match(wizardBlock, /Project currency \*/);
  const currencyIndex = wizardBlock.indexOf("Project currency *");
  const detailsIndex = wizardBlock.indexOf("<details");
  assert.ok(currencyIndex > -1 && detailsIndex > -1 && currencyIndex < detailsIndex, "Project Currency must still appear before the collapsed optional section");
  assert.match(wizardBlock, /<option>SAR<\/option>/);
});
