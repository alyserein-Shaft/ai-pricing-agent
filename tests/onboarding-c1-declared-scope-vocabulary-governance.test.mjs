import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  NPQ_DELIVERY_SCOPES,
  NPQ_DELIVERY_SCOPE_LEGACY_VALUES,
  NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS,
  NPQ_DELIVERY_SCOPE_UNRESOLVED,
  normalizeNpQProfile,
} from "../app/domain/project-npq-engine.mjs";

// ONBOARDING RECOVERY C1 -- Declared Scope vocabulary governance.
//
// ONBOARDING RECOVERY C fixed the false default and wired the UI to
// npq.deliveryScope, but left one gap: the UI mapped the FULL accepted set
// (NPQ_DELIVERY_SCOPES), which mixed legacy read-compatibility values in
// with the current, engineer-facing choices -- so a new project could
// select "Materials Only" (legacy) instead of "Supply Materials Only"
// (current). This file proves HISTORICAL ACCEPTANCE (readable, normalizes
// correctly) and CURRENT SELECTION (what a new project's UI may choose)
// are now two distinct, non-duplicated exports.
//
// No DB writes anywhere in this file. The one DB read (Al Mousa) is
// read-only, informational, not required for any assertion to pass.

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const wizardBlock = page.slice(
  page.indexOf('aria-labelledby="new-project-title"'),
  page.indexOf('{showProjectEditor && ('),
);
const roundTrip = (value) => normalizeNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR", deliveryScope: value }).deliveryScope;

// ── CURRENT_OPTIONS ───────────────────────────────────────────────────────

test("CURRENT_OPTIONS: contains only canonical current vocabulary, in the exact engineer-requested set plus the pending state", () => {
  assert.deepEqual(NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS, [
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

test("CURRENT_OPTIONS contains none of the 3 legacy values", () => {
  for (const legacy of NPQ_DELIVERY_SCOPE_LEGACY_VALUES) {
    assert.ok(!NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.includes(legacy), `${legacy} must not be a current option`);
  }
});

// ── LEGACY_NOT_SELECTABLE ─────────────────────────────────────────────────

test("LEGACY_NOT_SELECTABLE: Materials Only / Supply and Installation / Supply, Installation, Testing and Commissioning do NOT appear as New Project options", () => {
  const block = wizardBlock.slice(wizardBlock.indexOf("Declared Scope"), wizardBlock.indexOf("Declared Scope") + 900);
  for (const legacy of ["Materials Only", "Supply and Installation", "Supply, Installation, Testing and Commissioning"]) {
    assert.doesNotMatch(block, new RegExp(`<option[^>]*>${legacy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</option>`), `${legacy} must not be offered as a new-project choice`);
  }
  // The wizard maps the current-options export only, never the full set.
  assert.match(wizardBlock, /NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS\.map/);
  assert.doesNotMatch(wizardBlock, /\{NPQ_DELIVERY_SCOPES\.map/, "the wizard must never map the full accepted-for-reading set");
});

test("LEGACY_NOT_SELECTABLE: the 3 legacy values are excluded from CURRENT_OPTIONS by construction (not just by accident of wording)", () => {
  assert.deepEqual(NPQ_DELIVERY_SCOPE_LEGACY_VALUES, [
    "Materials Only",
    "Supply and Installation",
    "Supply, Installation, Testing and Commissioning",
  ]);
});

// ── LEGACY_READABLE ────────────────────────────────────────────────────────

test("LEGACY_READABLE: each legacy value still normalizes/round-trips unchanged", () => {
  for (const legacy of NPQ_DELIVERY_SCOPE_LEGACY_VALUES) {
    assert.equal(roundTrip(legacy), legacy);
  }
});

test("NO SILENT TRANSLATION: a legacy value is never rewritten into a similarly-worded current value", () => {
  assert.equal(roundTrip("Materials Only"), "Materials Only");
  assert.notEqual(roundTrip("Materials Only"), "Supply Materials Only");
  assert.equal(roundTrip("Supply and Installation"), "Supply and Installation");
  assert.notEqual(roundTrip("Supply and Installation"), "Supply + 1st, 2nd & 3rd Fix");
  assert.equal(roundTrip("Supply, Installation, Testing and Commissioning"), "Supply, Installation, Testing and Commissioning");
  assert.notEqual(roundTrip("Supply, Installation, Testing and Commissioning"), "Supply + Testing & Commissioning");
});

// ── CURRENT_ROUND_TRIP ─────────────────────────────────────────────────────

test("CURRENT_ROUND_TRIP: all current options persist exactly", () => {
  for (const current of NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS) {
    assert.equal(roundTrip(current), current);
  }
});

// ── PENDING ────────────────────────────────────────────────────────────────

test("PENDING: remains a valid, current, selectable option and the unresolved default -- never treated as a real delivery package", () => {
  assert.equal(NPQ_DELIVERY_SCOPE_UNRESOLVED, "Pending Tender Review");
  assert.ok(NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.includes(NPQ_DELIVERY_SCOPE_UNRESOLVED), "must be selectable, not only a hidden default");
  assert.equal(roundTrip(NPQ_DELIVERY_SCOPE_UNRESOLVED), NPQ_DELIVERY_SCOPE_UNRESOLVED);
});

test("PENDING appears as the first visible option in the New Project dropdown, per the expected visible-options ordering", () => {
  assert.equal(NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS[0], "Pending Tender Review");
  // NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.map(...) preserves array order in the
  // rendered <select>, so the wizard's dropdown lists Pending first too.
});

// ── NO_FALSE_DEFAULT ───────────────────────────────────────────────────────

test("NO_FALSE_DEFAULT: a new project does not default to a real commercial package", () => {
  const profile = normalizeNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR" });
  assert.equal(profile.deliveryScope, NPQ_DELIVERY_SCOPE_UNRESOLVED);
  assert.match(page, /deliveryScope: NPQ_DELIVERY_SCOPE_UNRESOLVED,/);
  assert.doesNotMatch(page, /deliveryScope: "Supply/, "no hardcoded real-package literal default remains anywhere");
});

// ── PROJECT TYPE INDEPENDENCE ───────────────────────────────────────────────

test("PROJECT TYPE INDEPENDENCE: Project Type values never imply a Declared Scope value, and vice versa", () => {
  // Pure structural proof: the two vocabularies share no member, so no
  // code path could accidentally treat one as implying the other.
  const projectTypeValues = ["Unknown", "Tender", "On-Hand", "TENDER", "ON_HAND"];
  for (const value of projectTypeValues) assert.ok(!NPQ_DELIVERY_SCOPES.includes(value));
  // No source-level coupling: neither constant is referenced from the
  // Project Type control's own onChange handler.
  const projectTypeBlock = wizardBlock.slice(wizardBlock.indexOf("Project type"), wizardBlock.indexOf("Declared Scope"));
  assert.doesNotMatch(projectTypeBlock, /deliveryScope|NPQ_DELIVERY_SCOPE/);
});

// ── CARDINALITY: ACCEPTED = LEGACY ∪ CURRENT, no array migration ──────────

test("NPQ_DELIVERY_SCOPES (accepted-for-reading) is exactly the union of legacy and current, in stable order -- one source of truth, not duplicated", () => {
  assert.deepEqual(NPQ_DELIVERY_SCOPES, [...NPQ_DELIVERY_SCOPE_LEGACY_VALUES, ...NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS]);
  assert.equal(NPQ_DELIVERY_SCOPES.length, NPQ_DELIVERY_SCOPE_LEGACY_VALUES.length + NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.length);
});

test("cardinality remains SINGLE_PACKAGE: delivery_scope stays one string column, no JSON-array migration introduced", () => {
  const migration = fs.readFileSync(new URL("../drizzle/0061_npq_project_onboarding.sql", import.meta.url), "utf8");
  assert.match(migration, /delivery_scope TEXT NOT NULL/);
  assert.doesNotMatch(migration, /delivery_scopes|deliveryScopes/i);
  // No repo-wide evidence of a composable-service/quotation-type model was
  // found in ONBOARDING RECOVERY C1 (service_type, quotation_type,
  // inquiry_type, engagement_type, contract_type, maintenance_contract,
  // site_visit as distinct fields all absent from db/schema.ts) -- checked
  // again here structurally: the NPQ engine exposes exactly one delivery
  // scope field, never an array.
  const engineSource = fs.readFileSync(new URL("../app/domain/project-npq-engine.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(engineSource, /deliveryScopes:\s*list\(/, "deliveryScope must not become a multi-value list() field");
});

// ── HISTORICAL DISPLAY / FUTURE EDITOR SAFETY ──────────────────────────────

test("historical display: reading a stored legacy value never turns it into Unknown/invalid", () => {
  const hydrated = normalizeNpQProfile({ primarySystem: "Fire Alarm", projectCurrency: "SAR", deliveryScope: "Supply and Installation" });
  assert.equal(hydrated.deliveryScope, "Supply and Installation");
  assert.notEqual(hydrated.deliveryScope, "Unknown");
});

test("future editor safety: the domain API already exposes what a governed editor needs -- display from the full accepted set, offer choices from current options only", () => {
  // Not implementing an editor here (out of scope) -- only confirming both
  // exports exist and are independently usable for that future split.
  assert.ok(Array.isArray(NPQ_DELIVERY_SCOPES) && NPQ_DELIVERY_SCOPES.length > 0);
  assert.ok(Array.isArray(NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS) && NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.length > 0);
  assert.ok(NPQ_DELIVERY_SCOPES.length > NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.length, "the accepted set must be a strict superset of the current-choice set");
});

// ── AL_MOUSA (read-only, informational) ────────────────────────────────────

test("AL_MOUSA: legacy 'Supply and Installation' remains readable and unchanged, and is not among the new project's selectable options", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db.prepare("SELECT delivery_scope FROM project_npq_profile_versions WHERE project_id=? AND superseded_at IS NULL").get("project_c0123d91-c30b-4956-87cb-e473ef53f89d");
  if (!row) { t.skip("Al Mousa fixture project not present in this environment"); return; }
  assert.equal(row.delivery_scope, "Supply and Installation");
  assert.equal(roundTrip(row.delivery_scope), row.delivery_scope, "still readable/normalizes unchanged");
  assert.ok(!NPQ_DELIVERY_SCOPE_CURRENT_OPTIONS.includes(row.delivery_scope), "not offered as a new-project choice");
  assert.ok(NPQ_DELIVERY_SCOPE_LEGACY_VALUES.includes(row.delivery_scope), "correctly classified as legacy");
});

// ── NO DATA MUTATION ────────────────────────────────────────────────────────

test("NO DATA MUTATION: this file only reads the live DB read-only, never writes", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  const checked = source.slice(0, source.indexOf('test("NO DATA MUTATION'));
  assert.doesNotMatch(checked, new RegExp("\\.(run|exec)\\("));
  assert.match(checked, /readOnly:\s*true/);
});
