import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  resolveProjectSystems,
  deriveSystemComposition,
  isGoverningBoqSystemEvidence,
} from "../app/domain/system-knowledge-registry.mjs";

// ONBOARDING RECOVERY B1 -- Canonical Primary + Project Membership integrity.
//
// Two regressions exposed by ONBOARDING RECOVERY B's own report:
//   1. resolveProjectSystems().primarySystem was derived from item-count/
//      alphabetical sort order instead of the governed NPQ declaration.
//   2. The report's Al Mousa fixture wrongly set governing:true for the
//      3 real, support-only Electrical cable rows (an inaccurate fixture --
//      see below for the real, read-only-verified live data), which in turn
//      surfaced a genuine, real design gap: the governing rule itself
//      (category-non-null OR EXTRACTED) did not distinguish a generic
//      supporting-material category (Cable, Rack, UPS, ...) from a real
//      system-specific device category (Detector, Camera, Reader, ...).
//
// No DB writes anywhere in this file. The one DB read (below) is read-only,
// against the live dev DB, to prove the fix against real data -- it changes
// nothing and is not required for any assertion to pass (all assertions use
// literal fixtures per instructions).

// ── ISSUE 1: NPQ PRIMARY AUTHORITY ───────────────────────────────────────

test("NPQ PRIMARY AUTHORITY: Fire Alarm remains Primary despite alphabetical order (Multi-System Test fixture, no BOQ)", () => {
  const dashboardEntry = {
    systemComposition: { isDerived: false, systems: [] },
    npqSystems: { primarySystem: "Fire Alarm", additionalSystems: ["CCTV", "Access Control", "Intercom"] },
    systemDomain: "Fire Alarm",
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  assert.deepEqual(new Set(resolved.systems), new Set(["Fire Alarm", "CCTV", "Access Control", "Intercom"]));
  assert.equal(resolved.primarySystem, "Fire Alarm", "must not fall to the alphabetically-first tied member (Access Control)");
});

// ── BOQ COUNT DOES NOT REDEFINE PRIMARY ──────────────────────────────────

test("BOQ COUNT DOES NOT REDEFINE PRIMARY: CCTV 100 vs Fire Alarm 5 -> Primary stays Fire Alarm", () => {
  const dashboardEntry = {
    systemComposition: { isDerived: true, systems: [
      { system: "CCTV", itemCount: 100, governing: true },
      { system: "Fire Alarm", itemCount: 5, governing: true },
    ] },
    npqSystems: { primarySystem: "Fire Alarm", additionalSystems: ["CCTV"] },
    systemDomain: "Fire Alarm",
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  assert.deepEqual(new Set(resolved.systems), new Set(["Fire Alarm", "CCTV"]), "both systems must still be members");
  // Display/composition ordering is unaffected -- CCTV's larger BOQ count
  // still sorts it first in `systems`, which is fine: ordering != authority.
  assert.equal(resolved.systems[0], "CCTV", "count-based display ordering is preserved");
  assert.equal(resolved.primarySystem, "Fire Alarm", "governed Primary must never be overridden by BOQ item count");
});

// ── OPEN PRIMARY ──────────────────────────────────────────────────────────

test("OPEN PRIMARY: Intercom Primary works without a SYSTEM_PACK", () => {
  const dashboardEntry = {
    systemComposition: { isDerived: false, systems: [] },
    npqSystems: { primarySystem: "Intercom", additionalSystems: ["Fire Alarm"] },
    systemDomain: "Intercom",
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  assert.deepEqual(new Set(resolved.systems), new Set(["Intercom", "Fire Alarm"]));
  assert.equal(resolved.primarySystem, "Intercom");
});

// ── LEGACY FALLBACK ───────────────────────────────────────────────────────

test("LEGACY FALLBACK: a legacy-only single-system project (no NPQ systems at all) remains backward-compatible", () => {
  const dashboardEntry = {
    systemComposition: { isDerived: false, systems: [] },
    npqSystems: null,
    systemDomain: "CCTV",
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  assert.deepEqual(resolved.systems, ["CCTV"]);
  assert.equal(resolved.primarySystem, "CCTV", "with no governed NPQ declaration, Primary safely falls back to the legacy systemDomain member");
});

test("Policy D (malformed data safety): an empty-string NPQ primarySystem is treated as absent, never crashes, never selects a phantom Primary", () => {
  const dashboardEntry = {
    systemComposition: { isDerived: false, systems: [] },
    npqSystems: { primarySystem: "", additionalSystems: ["CCTV"] },
    systemDomain: "CCTV",
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  assert.deepEqual(resolved.systems, ["CCTV"]);
  assert.equal(resolved.primarySystem, "CCTV");
});

// ── AL MOUSA: real, read-only-verified evidence ──────────────────────────

test("AL MOUSA: support cable does not become a Project System solely because category now has product identity", () => {
  // Real, read-only-verified live values (ONBOARDING RECOVERY B1 Part 8):
  // all 3 Electrical BOQ rows have category=null, system_source_type="Inferred".
  const dashboardEntry = {
    systemComposition: { isDerived: true, systems: [
      { system: "Fire Alarm", itemCount: 95, governing: true },
      { system: "Electrical", itemCount: 3, governing: isGoverningBoqSystemEvidence({ category: null, systemSourceType: "Inferred" }) },
    ] },
    npqSystems: { primarySystem: "Fire Alarm", additionalSystems: [] },
    systemDomain: "Fire Alarm",
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  assert.deepEqual(resolved.systems, ["Fire Alarm"], "Electrical must not surface as a canonical Project System");
  assert.equal(resolved.primarySystem, "Fire Alarm");
});

test("AL MOUSA: even if Wave 4B's detectCategory() were re-run and populated category=\"Fire Resistant Cable\" on those rows, they still must not govern", () => {
  // This is the forward-looking check: boq-extractor.mjs's detectCategory()
  // pattern /fire\s*resistant...\s+cable/i WOULD match Al Mousa's real
  // description ("CWZ category fire resistant cable with all accessories")
  // if these historical rows were ever re-extracted. Proves the governing
  // rule itself -- not just today's lucky null category -- is now safe.
  assert.equal(isGoverningBoqSystemEvidence({ category: "Fire Resistant Cable", systemSourceType: "Inferred" }), false);
});

test("READ-ONLY LIVE VERIFICATION (informational, not required for correctness): the real Al Mousa DB, recomputed with the fixed rule, resolves to Fire Alarm only", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const projectId = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
  const project = db.prepare("SELECT id FROM projects WHERE id=?").get(projectId);
  if (!project) { t.skip("Al Mousa fixture project not present in this environment"); return; }
  const countRows = db.prepare("SELECT system_value system, COUNT(*) itemCount FROM boq_items WHERE project_id=? AND system_value IS NOT NULL AND system_value<>'' GROUP BY system_value").all(projectId);
  const base = deriveSystemComposition(countRows);
  const govRows = db.prepare("SELECT system_value system, category, system_source_type sourceType FROM boq_items WHERE project_id=? AND system_value IS NOT NULL AND system_value<>''").all(projectId);
  const govBySystem = new Map();
  for (const row of govRows) {
    const bucket = govBySystem.get(row.system) || { governing: false };
    if (isGoverningBoqSystemEvidence({ category: row.category, systemSourceType: row.sourceType })) bucket.governing = true;
    govBySystem.set(row.system, bucket);
  }
  for (const s of base.systems) { const g = govBySystem.get(s.system); if (g) s.governing = g.governing; }
  const resolved = resolveProjectSystems({ systemComposition: base, npqSystems: { primarySystem: "Fire Alarm", additionalSystems: [] }, systemDomain: "Fire Alarm" });
  assert.deepEqual(resolved.systems, ["Fire Alarm"]);
  assert.equal(resolved.primarySystem, "Fire Alarm");
});

// ── CATEGORY INDEPENDENCE ─────────────────────────────────────────────────

test("CATEGORY INDEPENDENCE: a generic supporting category (Cable/Rack/UPS/Power Supply/Battery/Conduit/Enclosure/...) cannot alone promote membership", () => {
  for (const category of ["Cable", "Fire Resistant Cable", "Low Voltage Cable", "Fiber Optic Cable", "Network Cable", "Cable Tray", "Conduit", "Rack", "Enclosure", "Patch Panel", "UPS", "Power Supply", "Battery"]) {
    assert.equal(isGoverningBoqSystemEvidence({ category, systemSourceType: "Inferred" }), false, `${category} alone must not govern`);
    assert.equal(isGoverningBoqSystemEvidence({ category, systemSourceType: null }), false, `${category} alone must not govern`);
  }
});

test("CATEGORY INDEPENDENCE: category=null with no EXTRACTED source never governs", () => {
  assert.equal(isGoverningBoqSystemEvidence({ category: null, systemSourceType: "Inferred" }), false);
  assert.equal(isGoverningBoqSystemEvidence({}), false);
});

test("EXTRACTED source is always sufficient on its own, even with a generic or absent category", () => {
  assert.equal(isGoverningBoqSystemEvidence({ category: null, systemSourceType: "EXTRACTED" }), true);
  assert.equal(isGoverningBoqSystemEvidence({ category: "Cable", systemSourceType: "EXTRACTED" }), true);
});

// ── REAL TECHNICAL ITEM ───────────────────────────────────────────────────

test("REAL TECHNICAL ITEM: a governing Fire Alarm/CCTV device category still contributes to Project membership", () => {
  for (const category of ["Detector", "Sounder", "Manual Call Point", "Module", "Camera", "Recorder", "Reader", "Switch", "Speaker", "Microphone", "Amplifier"]) {
    assert.equal(isGoverningBoqSystemEvidence({ category, systemSourceType: "Inferred" }), true, `${category} alone should be real device-identity evidence`);
  }
  const dashboardEntry = {
    systemComposition: { isDerived: true, systems: [
      { system: "Fire Alarm", itemCount: 12, governing: isGoverningBoqSystemEvidence({ category: "Detector", systemSourceType: "Inferred" }) },
    ] },
    npqSystems: null,
    systemDomain: null,
  };
  assert.deepEqual(resolveProjectSystems(dashboardEntry).systems, ["Fire Alarm"]);
});

// ── deriveSystemComposition's OWN primarySystem (dominant-by-count) is a
//    separate, unmodified concept and must not be confused with the
//    resolver's governed Primary. ──────────────────────────────────────────

test("deriveSystemComposition's own primarySystem (BOQ-dominant, used only for the legacy systemDomain display fallback) is untouched by this fix", () => {
  const composition = deriveSystemComposition([
    { system: "CCTV", itemCount: 100 },
    { system: "Fire Alarm", itemCount: 5 },
  ]);
  assert.equal(composition.primarySystem, "CCTV", "deriveSystemComposition's dominant-by-count concept is intentionally unchanged");
});

// ── RELOAD/UI ──────────────────────────────────────────────────────────────

const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const overview = fs.readFileSync(new URL("../app/components/workspaces/OverviewWorkspace.tsx", import.meta.url), "utf8");

test("RELOAD/UI: both real UI consumers of resolveProjectSystems().primarySystem exist and are wired to the fixed resolver, not a re-derived value", () => {
  assert.match(page, /resolveProjectSystems\(serverProjectDashboard\.project\)/, "OverviewWorkspace's resolvedSystems prop reads the canonical resolver output");
  assert.match(overview, /sys === resolvedSystems\.primarySystem \? " · Primary" : ""/, "the Overview Primary badge reads resolvedSystems.primarySystem directly, not a separately computed value");
  assert.match(page, /background: sys === rs\.primarySystem \? "#e0e7ff" : "#f3f4f6"/, "the organization project-list chips also highlight by rs.primarySystem");
});

test("RELOAD/UI: after canonical hydration, a project created with Fire Alarm as Primary among multiple systems still shows Fire Alarm as Primary", () => {
  // Simulates the exact server round-trip: creation payload -> stored NPQ ->
  // next dashboard read's npqSystems -> resolveProjectSystems() -> the same
  // field the UI's Primary badge reads (see the two assertions above).
  const creationPayload = { primarySystem: "Fire Alarm", additionalSystems: ["CCTV", "Access Control"] };
  const rehydratedDashboardEntry = {
    systemComposition: { isDerived: false, systems: [] },
    npqSystems: creationPayload,
    systemDomain: creationPayload.primarySystem,
  };
  const resolved = resolveProjectSystems(rehydratedDashboardEntry);
  assert.equal(resolved.primarySystem, "Fire Alarm", "the Primary chosen at creation must still be Primary after reload");
});

// ── NO CREATION UX REWRITE ────────────────────────────────────────────────

test("no creation UX rewrite: the Systems-in-scope wizard control is untouched by this wave", () => {
  const wizardBlock = page.slice(
    page.indexOf('aria-labelledby="new-project-title"'),
    page.indexOf('{showProjectEditor && ('),
  );
  assert.match(wizardBlock, /Systems in scope \*/);
  assert.match(wizardBlock, /Primary system/);
  const addFn = page.slice(page.indexOf("const addDraftSystem"), page.indexOf("const removeDraftSystem"));
  assert.match(addFn, /addSystemToScope\(\s*\{ scope: draftSystemsInScope, primary: draftIntakeProfile\.system \},\s*raw,\s*\)/, "addDraftSystem's wiring to the pure helper is unchanged by this resolver-only fix");
});

test("NO DATA MUTATION: this file opens the live DB read-only where it touches it at all, and never calls a write statement", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  // Check everything BEFORE this assertion's own line (which necessarily
  // names the two forbidden method calls in its own source text). Only
  // DatabaseSync .prepare(...).all()/.get() reads appear in this file --
  // no .run()/.exec() write call anywhere else.
  const checked = source.slice(0, source.indexOf("test(\"NO DATA MUTATION"));
  const writeCallPattern = new RegExp("\\.(run|exec)\\(");
  assert.doesNotMatch(checked, writeCallPattern);
  assert.match(checked, /readOnly:\s*true/);
});
