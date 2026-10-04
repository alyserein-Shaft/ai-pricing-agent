import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  NPQ_DELIVERY_SCOPES,
  NPQ_DELIVERY_SCOPE_UNRESOLVED,
  normalizeNpQProfile,
  validateNpQProfile,
} from "../app/domain/project-npq-engine.mjs";
import { resolveProjectSystems } from "../app/domain/system-knowledge-registry.mjs";

// ONBOARDING RECOVERY C -- Declared Scope contract repair.
//
// Two unrelated scope concepts existed: the visible but disconnected
// draftIntakeProfile.scopeIntent (never sent to the server) and the
// server-authoritative but UI-less draftNpQ.deliveryScope, which the client
// always silently sent as "Supply and Installation". This file proves: (1)
// scopeIntent is retired from the creation contract and never reaches the
// payload, (2) the UI now writes the real npq.deliveryScope, (3) the false
// default is gone -- an unset value normalizes to the honest
// "Pending Tender Review" state, never a real commercial scope, and
// (4) the full governed vocabulary round-trips exactly, including every
// legacy value, unchanged.
//
// No DB writes anywhere in this file. The one DB read (Al Mousa) is
// read-only, informational, and not required for any assertion to pass.

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const wizardBlock = page.slice(
  page.indexOf('aria-labelledby="new-project-title"'),
  page.indexOf('{showProjectEditor && ('),
);

// ── NO FALSE DEFAULT ──────────────────────────────────────────────────────

test("NO FALSE DEFAULT: a new project does not silently become 'Supply and Installation'", () => {
  assert.equal(NPQ_DELIVERY_SCOPE_UNRESOLVED, "Pending Tender Review");
  assert.match(page, /const INITIAL_DRAFT_NPQ: ProjectNpQDraft = \{[\s\S]{0,200}deliveryScope: NPQ_DELIVERY_SCOPE_UNRESOLVED,/, "the wizard's own initial state must use the honest unresolved constant, not a literal commercial scope");
  assert.doesNotMatch(page, /deliveryScope: "Supply and Installation"/, "no hardcoded false-certainty literal remains anywhere in page.tsx");
});

test("NO FALSE DEFAULT: normalizeNpQProfile never invents a real commercial scope when none was collected", () => {
  const profile = normalizeNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR" });
  assert.equal(profile.deliveryScope, NPQ_DELIVERY_SCOPE_UNRESOLVED);
});

test("NO FALSE DEFAULT: draftNpQ (including Declared Scope) is reset on every wizard open, close and successful creation -- it must not silently carry over from one project to the next", () => {
  for (const fnStart of ["const createLocalProject", "const openNewProjectWizard", "const closeNewProjectWizard"]) {
    const nextMarkers = ["const openNewProjectWizard", "const closeNewProjectWizard", "const addDraftSystem"];
    const end = Math.min(...nextMarkers.map((m) => { const i = page.indexOf(m, page.indexOf(fnStart) + 1); return i === -1 ? Infinity : i; }));
    const fn = page.slice(page.indexOf(fnStart), end);
    assert.match(fn, /setDraftNpQ\(INITIAL_DRAFT_NPQ\)/, `${fnStart} must reset draftNpQ`);
  }
});

// ── VISIBLE CONTROL ───────────────────────────────────────────────────────

test("VISIBLE CONTROL: a Declared Scope control exists, writes npq.deliveryScope (via draftNpQ), and is populated from the canonical domain vocabulary", () => {
  assert.match(wizardBlock, /Declared Scope/);
  const block = wizardBlock.slice(wizardBlock.indexOf("Declared Scope"), wizardBlock.indexOf("Declared Scope") + 700);
  assert.match(block, /value=\{draftNpQ\.deliveryScope\}/);
  assert.match(block, /setDraftNpQ\(\(current\) => \(\{\s*\.\.\.current,\s*deliveryScope: event\.target\.value,\s*\}\)\)/);
  // ONBOARDING RECOVERY C1: the UI must map the CURRENT-selectable subset,
  // never the full accepted-for-reading set (which also contains legacy
  // values) -- see tests/onboarding-c1-declared-scope-vocabulary-governance.test.mjs.
  assert.match(block, /NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS\.map/, "options must come from the domain module's current-options export, not a duplicated literal list");
  assert.doesNotMatch(block, /<option>Materials Only<\/option>|<option>Supply and Installation<\/option>/, "no literal-duplicated option strings -- must be generated from the array");
});

test("VISIBLE CONTROL: is NOT starred/required, matching the business-required=false finding", () => {
  assert.doesNotMatch(wizardBlock, /Declared Scope \*/);
});

test("PLACEMENT: Declared Scope sits in the main visible field area (paired with Project Type), not inside the collapsed Optional tender context section", () => {
  const scopeIndex = wizardBlock.indexOf("Declared Scope");
  const detailsIndex = wizardBlock.indexOf("<details");
  const projectTypeIndex = wizardBlock.indexOf("Project type");
  assert.ok(scopeIndex > -1 && detailsIndex > -1 && scopeIndex < detailsIndex, "Declared Scope must appear before the collapsed section");
  assert.ok(projectTypeIndex > -1 && projectTypeIndex < scopeIndex, "placed alongside/after Project Type, in the same visible area");
});

// ── NO DISCONNECTED scopeIntent ───────────────────────────────────────────

test("NO DISCONNECTED scopeIntent: the old visible-but-unsent control is gone, and creation never reads scopeIntent", () => {
  assert.doesNotMatch(wizardBlock, /Declared scope request/);
  assert.doesNotMatch(wizardBlock, /Pending tender review<\/option>/i);
  const createFn = page.slice(page.indexOf("const createLocalProject"), page.indexOf("const openNewProjectWizard"));
  assert.doesNotMatch(createFn, /scopeIntent/, "the creation payload must not reference scopeIntent anywhere");
});

test("scopeIntent is retired from the wizard's own draft/reset state (kept only as an optional type field for old localStorage compatibility)", () => {
  const wizardStateBlocks = [
    page.slice(page.indexOf("const [draftIntakeProfile, setDraftIntakeProfile]"), page.indexOf("const [draftSystemsInScope")),
    page.slice(page.indexOf("const openNewProjectWizard"), page.indexOf("const closeNewProjectWizard")),
    page.slice(page.indexOf("const closeNewProjectWizard"), page.indexOf("// ONBOARDING RECOVERY B -- Systems in scope")),
  ];
  for (const block of wizardStateBlocks) assert.doesNotMatch(block, /scopeIntent:/, "the wizard's own state must not (re)declare scopeIntent");
  assert.match(page, /scopeIntent\?: string;/, "the type keeps it optional for backward-compatible reads of older saved projects");
});

// ── VOCABULARY ROUND-TRIPS ────────────────────────────────────────────────

const roundTrip = (value) => normalizeNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR", deliveryScope: value }).deliveryScope;

test("SUPPLY MATERIALS ONLY: round-trips exactly", () => {
  assert.equal(roundTrip("Supply Materials Only"), "Supply Materials Only");
});

test("SUPPLY + T&C: round-trips exactly", () => {
  assert.equal(roundTrip("Supply + Testing & Commissioning"), "Supply + Testing & Commissioning");
});

test("SUPPLY + 3RD FIX: round-trips exactly", () => {
  assert.equal(roundTrip("Supply + 3rd Fix"), "Supply + 3rd Fix");
});

test("SUPPLY + 2ND & 3RD FIX: round-trips exactly", () => {
  assert.equal(roundTrip("Supply + 2nd & 3rd Fix"), "Supply + 2nd & 3rd Fix");
});

test("SUPPLY + 1ST, 2ND & 3RD FIX: round-trips exactly, and the fix stages are never collapsed into each other or into a generic 'Installation'", () => {
  assert.equal(roundTrip("Supply + 1st, 2nd & 3rd Fix"), "Supply + 1st, 2nd & 3rd Fix");
  const distinct = new Set(["Supply + 3rd Fix", "Supply + 2nd & 3rd Fix", "Supply + 1st, 2nd & 3rd Fix"].map(roundTrip));
  assert.equal(distinct.size, 3, "each fix-stage value must remain its own distinct string");
  for (const value of distinct) assert.doesNotMatch(value, /^Supply \+ Installation$/);
});

test("T&C SERVICE: distinct from Supply + T&C -- commercially different, never collapsed", () => {
  const service = roundTrip("Testing & Commissioning Service");
  const bundled = roundTrip("Supply + Testing & Commissioning");
  assert.equal(service, "Testing & Commissioning Service");
  assert.equal(bundled, "Supply + Testing & Commissioning");
  assert.notEqual(service, bundled);
});

test("AMC: round-trips safely with its full explanatory label, without inferring supply/installation/T&C", () => {
  assert.equal(roundTrip("AMC — Annual Maintenance Contract"), "AMC — Annual Maintenance Contract");
});

test("SITE VISIT: round-trips safely, without inferring supply/installation/T&C", () => {
  assert.equal(roundTrip("Site Visit"), "Site Visit");
});

test("PENDING/UNKNOWN: the explicit unresolved state round-trips and is never mistaken for a real scope", () => {
  assert.equal(roundTrip("Pending Tender Review"), "Pending Tender Review");
  assert.ok(NPQ_DELIVERY_SCOPES.includes("Pending Tender Review"));
});

test("every engineer-requested concept and the legacy vocabulary together form the exact expected canonical set", () => {
  // ONBOARDING RECOVERY C1 moved "Pending Tender Review" to the front of
  // the current-options list (matching the brief's own illustrative
  // ordering); NPQ_DELIVERY_SCOPES (legacy ++ current) reflects that.
  assert.deepEqual(NPQ_DELIVERY_SCOPES, [
    "Materials Only",
    "Supply and Installation",
    "Supply, Installation, Testing and Commissioning",
    "Pending Tender Review",
    "Supply Materials Only",
    "Supply + Testing & Commissioning",
    "Supply + 3rd Fix",
    "Supply + 2nd & 3rd Fix",
    "Supply + 1st, 2nd & 3rd Fix",
    "Testing & Commissioning Service",
    "AMC — Annual Maintenance Contract",
    "Site Visit",
  ]);
});

// ── LEGACY VALUE ───────────────────────────────────────────────────────────

test("LEGACY VALUE: existing historical 'Supply and Installation' (and the other two pre-C values) remain readable, never rewritten by normalization", () => {
  for (const legacy of ["Materials Only", "Supply and Installation", "Supply, Installation, Testing and Commissioning"]) {
    assert.equal(roundTrip(legacy), legacy);
  }
});

test("cardinality is SINGLE by design: delivery_scope is one string column, not a JSON array, and this file introduces no array-typed vocabulary", () => {
  const migrationHint = fs.readFileSync(new URL("../drizzle/0061_npq_project_onboarding.sql", import.meta.url), "utf8");
  assert.match(migrationHint, /delivery_scope TEXT NOT NULL/);
  assert.doesNotMatch(migrationHint, /delivery_scopes|deliveryScopes/i);
});

// ── MULTI-SYSTEM INDEPENDENCE ────────────────────────────────────────────

test("MULTI-SYSTEM INDEPENDENCE: Declared Scope does not alter Systems membership or canonical Primary", () => {
  const dashboardEntry = {
    systemComposition: { isDerived: false, systems: [] },
    npqSystems: { primarySystem: "Fire Alarm", additionalSystems: ["CCTV", "Access Control"] },
    systemDomain: "Fire Alarm",
  };
  const before = resolveProjectSystems(dashboardEntry);
  // deliveryScope is not even a field resolveProjectSystems reads -- proven
  // by re-resolving with it present under an unrelated key and getting the
  // identical result.
  const after = resolveProjectSystems({ ...dashboardEntry, npqSystems: { ...dashboardEntry.npqSystems, deliveryScope: "AMC — Annual Maintenance Contract" } });
  assert.deepEqual(before, after);
  assert.equal(after.primarySystem, "Fire Alarm");
});

// ── AL MOUSA (read-only, informational) ───────────────────────────────────

test("AL MOUSA: unchanged live data -- its persisted 'Supply and Installation' is legacy-provenance-uncertain, and the new creation flow would no longer silently produce this value", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare("SELECT delivery_scope FROM project_npq_profile_versions WHERE project_id=? AND superseded_at IS NULL").get("project_c0123d91-c30b-4956-87cb-e473ef53f89d");
  if (!row) { t.skip("Al Mousa fixture project not present in this environment"); return; }
  assert.equal(row.delivery_scope, "Supply and Installation", "unchanged by this task");
  // still a valid, readable legacy vocabulary member -- normalization does not reject it
  assert.equal(roundTrip(row.delivery_scope), row.delivery_scope);
});

// ── VALIDATION: still not required ────────────────────────────────────────

test("REQUIRED vs OPTIONAL: deliveryScope still never blocks NPQ confirmation (business/API requirement unchanged by this slice)", () => {
  const result = validateNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR", deliveryScope: "" }, { forConfirmation: true });
  assert.equal(result.ok, true);
  assert.doesNotMatch(JSON.stringify(result.missing), /deliveryScope/);
});

// ── NO DATA MUTATION ───────────────────────────────────────────────────────

test("NO DATA MUTATION: this file only reads the live DB read-only, never writes", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  const checked = source.slice(0, source.indexOf('test("NO DATA MUTATION'));
  assert.doesNotMatch(checked, new RegExp("\\.(run|exec)\\("));
  assert.match(checked, /readOnly:\s*true/);
});
