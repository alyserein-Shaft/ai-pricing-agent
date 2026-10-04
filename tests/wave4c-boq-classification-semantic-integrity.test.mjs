import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { detectCategory } from "../app/domain/boq-extractor.mjs";
import {
  isGoverningBoqSystemEvidence,
  resolveProjectSystems,
} from "../app/domain/system-knowledge-registry.mjs";
import { FIRE_ALARM_TAXONOMY } from "../app/domain/fire-alarm-taxonomy.mjs";

// WAVE 4C -- BOQ CLASSIFICATION SEMANTIC INTEGRITY.
//
// This file proves the canonical layer contract traced and documented in
// this slice's own report and in boq-extractor.mjs's detectCategory() doc
// comment:
//
//   boq_items.category = deterministic, system-independent, ungoverned
//   PHYSICAL/EQUIPMENT IDENTITY (Cable, Rack, Detector, Control Panel, ...).
//
//   estimator_item_interpretations' governed category/productFamily pair
//   (via boq-understanding-engine.mjs + each SYSTEM_PACK's own taxonomy,
//   e.g. fire-alarm-taxonomy.mjs) is a SEPARATE, richer, reviewable
//   classification layer -- not a synonym, never interchangeable.
//
// No live business-data mutation anywhere in this file; the one live DB
// read is read-only and informational only.

const extractorSource = fs.readFileSync(new URL("../app/domain/boq-extractor.mjs", import.meta.url), "utf8");
const registrySource = fs.readFileSync(new URL("../app/domain/system-knowledge-registry.mjs", import.meta.url), "utf8");

// ── FIELD_SEMANTICS ──────────────────────────────────────────────────────

test("FIELD_SEMANTICS: detectCategory()'s own doc comment states the canonical contract distinguishing raw identity from governed taxonomy category", () => {
  const fnBlock = extractorSource.slice(extractorSource.indexOf("// Wave 4B: Generic product identity detection"), extractorSource.indexOf("export const detectCategory"));
  assert.match(fnBlock, /DETERMINISTIC, SYSTEM-INDEPENDENT, UNGOVERNED\s*\n\s*\/\/\s*PHYSICAL\/EQUIPMENT IDENTITY/);
  assert.match(fnBlock, /NOT the same concept as the GOVERNED TAXONOMY category\/family/);
  assert.match(fnBlock, /estimator_item_interpretations\.validated_interpretation\.category/);
});

// ── CABLE_IDENTITY ───────────────────────────────────────────────────────

test("CABLE_IDENTITY: a fire-resistant-cable description deterministically identifies as Cable, independent of system", () => {
  assert.equal(detectCategory("CWZ category fire resistant cable with all accessories"), "Fire Resistant Cable");
  assert.equal(detectCategory("Cat 6 UTP cable"), "Network Cable");
  assert.equal(detectCategory("cable"), "Cable");
});

// ── CONTROL_PANEL_IDENTITY ───────────────────────────────────────────────

test("CONTROL_PANEL_IDENTITY: the traced completeness gap is fixed -- a control panel now resolves to a real deterministic identity, not null", () => {
  assert.equal(detectCategory("Main fire alarm control panel"), "Control Panel");
  assert.equal(detectCategory("Fire alarm control panel, eight loop"), "Control Panel");
  assert.equal(detectCategory("FACP"), "Control Panel");
  // Not a generic supporting material -- this is a real, system-specific
  // device and must remain GOVERNING evidence for Project System
  // membership, unlike Cable/Rack/UPS/Power Supply.
  assert.equal(isGoverningBoqSystemEvidence({ category: "Control Panel", systemSourceType: "Inferred" }), true);
});

// ── DETECTOR_IDENTITY ────────────────────────────────────────────────────

test("DETECTOR_IDENTITY: smoke/heat/addressable detector descriptions deterministically identify as Detector", () => {
  assert.equal(detectCategory("Addressable smoke detector"), "Detector");
  assert.equal(detectCategory("Heat detector"), "Detector");
  assert.equal(isGoverningBoqSystemEvidence({ category: "Detector", systemSourceType: "Inferred" }), true);
});

// ── NO_FALSE_PRODUCT_FAMILY ──────────────────────────────────────────────

test("NO_FALSE_PRODUCT_FAMILY: detectCategory() never invents a MORE SPECIFIC governed family than the evidence supports -- e.g. it returns bare 'Detector', never a fabricated 'Addressable Smoke Detector'", () => {
  // detectCategory() is deliberately coarse -- it never guesses which
  // SPECIFIC governed family a device belongs to (that distinction, e.g.
  // Addressable vs. Conventional, Smoke vs. Heat, requires the richer
  // evidence the AI/governed understanding pipeline evaluates). Some raw
  // identity outputs do coincidentally equal a real governed family name
  // (Battery, Sounder, Manual Call Point, Enclosure, Speaker) -- this is
  // harmless agreement, not fabrication, because those particular families
  // are themselves bare, unqualified device types with no further governed
  // sub-distinction to get wrong. The real invariant is that no output ever
  // supplies a MORE SPECIFIC governed family name than "Detector" resolves
  // to.
  assert.equal(detectCategory("Addressable smoke detector"), "Detector");
  assert.equal(detectCategory("Addressable heat detector"), "Detector");
  const governedFamilies = new Set(Object.values(FIRE_ALARM_TAXONOMY).flat());
  assert.ok(!governedFamilies.has("Detector"), "the coarse 'Detector' identity itself is never a real governed family name");
  assert.ok(governedFamilies.has("Addressable Smoke Detector"), "sanity: the specific governed family this function correctly avoids inventing does exist");
});

test("NO_FALSE_PRODUCT_FAMILY: accessories/boilerplate text never invents a value", () => {
  assert.equal(detectCategory("accessories"), null);
  assert.equal(detectCategory("all accessories required"), null);
  assert.equal(detectCategory("as specified in drawing"), null);
  assert.equal(detectCategory("by others"), null);
});

// ── CATEGORY_CONTRACT ────────────────────────────────────────────────────

test("CATEGORY_CONTRACT: the governed Fire Alarm taxonomy's own category vocabulary (e.g. 'Control Equipment', 'Detection Devices') is entirely disjoint from detectCategory()'s raw identity output vocabulary", () => {
  const governedCategoryNames = new Set(Object.keys(FIRE_ALARM_TAXONOMY));
  const rawIdentityOutputs = new Set([
    "Fire Resistant Cable", "Low Voltage Cable", "Fiber Optic Cable", "Network Cable", "Cable",
    "Rack", "UPS", "Power Supply", "Battery", "Detector", "Sounder", "Manual Call Point",
    "Control Panel", "Module", "Recorder", "Camera", "Reader", "Switch", "Patch Panel",
    "Cable Tray", "Conduit", "Enclosure", "Speaker", "Microphone", "Amplifier",
  ]);
  for (const name of governedCategoryNames) assert.ok(!rawIdentityOutputs.has(name), `governed category "${name}" must never appear as a detectCategory() output`);
});

test("CATEGORY_CONTRACT: Fire Alarm Control Panel IS representable as a real governed family, under 'Control Equipment' -- confirming Wave 4B's prior 'panel is not a product family' reasoning was mistaken about WHERE panel identity belongs, not about whether it exists", () => {
  assert.ok(FIRE_ALARM_TAXONOMY["Control Equipment"].includes("Fire Alarm Control Panel"));
});

// ── PROJECT_SYSTEM_INDEPENDENCE ──────────────────────────────────────────

test("PROJECT_SYSTEM_INDEPENDENCE: GENERIC_SUPPORTING_CATEGORIES is unchanged by this slice -- Cable/Rack/UPS/Power Supply/Battery remain non-governing, and this fix does not expand or redefine that policy", () => {
  assert.equal(isGoverningBoqSystemEvidence({ category: "Cable", systemSourceType: "Inferred" }), false);
  assert.equal(isGoverningBoqSystemEvidence({ category: "Fire Resistant Cable", systemSourceType: "Inferred" }), false);
  assert.equal(isGoverningBoqSystemEvidence({ category: "Rack", systemSourceType: "Inferred" }), false);
  assert.equal(isGoverningBoqSystemEvidence({ category: "UPS", systemSourceType: "Inferred" }), false);
  assert.equal(isGoverningBoqSystemEvidence({ category: "Power Supply", systemSourceType: "Inferred" }), false);
  assert.equal(isGoverningBoqSystemEvidence({ category: "Battery", systemSourceType: "Inferred" }), false);
  // The set itself was not touched by this slice.
  assert.doesNotMatch(registrySource, /"Control Panel"/);
});

test("PROJECT_SYSTEM_INDEPENDENCE: Project-System policy is not what defines category's meaning -- isGoverningBoqSystemEvidence still only READS category, it does not write or redefine it", () => {
  const fnBlock = registrySource.slice(registrySource.indexOf("export function isGoverningBoqSystemEvidence"), registrySource.indexOf("export function isGoverningBoqSystemEvidence") + 400);
  assert.doesNotMatch(fnBlock, /category\s*=/, "the function reads category, it never assigns/writes it");
});

// ── AL_MOUSA (read-only) ──────────────────────────────────────────────────

test("AL_MOUSA: canonical Project Systems remain exactly ['Fire Alarm'] after the completeness fix, using the real BOQ evidence composition", () => {
  const dashboardEntry = {
    systemComposition: {
      isDerived: true,
      systems: [
        { system: "Fire Alarm", itemCount: 95, governing: true },
        { system: "Electrical", itemCount: 3, governing: isGoverningBoqSystemEvidence({ category: null, systemSourceType: "Inferred" }) },
      ],
    },
    npqSystems: { primarySystem: "Fire Alarm", additionalSystems: [] },
    systemDomain: "Fire Alarm",
  };
  const resolved = resolveProjectSystems(dashboardEntry);
  assert.deepEqual(resolved.systems, ["Fire Alarm"]);
  assert.equal(resolved.primarySystem, "Fire Alarm");
});

test("AL_MOUSA (read-only, informational): real live control-row matrix confirms the traced contract -- boq_items.category stays null/legacy, estimator_item_interpretations already carries the correct equipmentType/category/productFamily split", async (t) => {
  const dbPath = "/Users/serein-b/Documents/Codex/2026-07-31/referenced-chatgpt-conversation-this-is-an/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/faaf2b0445ab934c3aac48ddf0cdfade8f9bac050be98993748742cdd2cb05fb.sqlite";
  if (!fs.existsSync(dbPath)) { t.skip("dev DB not present in this environment"); return; }
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const projectId = "project_c0123d91-c30b-4956-87cb-e473ef53f89d";
  const project = db.prepare("SELECT id FROM projects WHERE id=?").get(projectId);
  if (!project) { t.skip("Al Mousa fixture project not present in this environment"); return; }
  const panelRow = db.prepare("SELECT category FROM boq_items WHERE project_id=? AND description LIKE '%Main Fire alarm control panel%'").get(projectId);
  assert.ok(panelRow, "the real Al Mousa panel row must exist");
  assert.equal(panelRow.category, null, "historical row -- extracted before this fix existed, never re-extracted; no live mutation performed by this slice");
  const interpretation = db.prepare(`SELECT i.validated_interpretation FROM boq_items b JOIN estimator_item_interpretations i ON i.boq_item_id=b.id WHERE b.project_id=? AND b.description LIKE '%Main Fire alarm control panel%' AND i.status='NEEDS_REVIEW' ORDER BY i.version_number DESC LIMIT 1`).get(projectId);
  if (interpretation) {
    const parsed = JSON.parse(interpretation.validated_interpretation);
    assert.equal(parsed.equipmentType?.value, "Fire Alarm Control Panel");
    assert.equal(parsed.category?.value, "Control Equipment");
    assert.equal(parsed.productFamily?.value, "Fire Alarm Control Panel");
  }
  db.close();
});

// ── MATCHING_COMPATIBILITY ────────────────────────────────────────────────

test("MATCHING_COMPATIBILITY: buildProductSearchProfile prefers the governed interpretation category over raw boqItem.category, never the reverse", () => {
  const source = fs.readFileSync(new URL("../app/domain/ai-product-ranking-engine.mjs", import.meta.url), "utf8");
  assert.match(source, /category: scalar\("category", boqItem\.category\)/, "interpreted.category (governed) is read FIRST via scalar()'s own fallback-to-arg order");
});

test("MATCHING_COMPATIBILITY: the requirement profile's productFamily is explicitly documented as retrieval text only, never promoted to technical fact from raw category", () => {
  const source = fs.readFileSync(new URL("../app/domain/ai-product-ranking-engine.mjs", import.meta.url), "utf8");
  assert.match(source, /This fallback is retrieval text only/);
  assert.match(source, /cannot become technical fact/);
});

// ── NO_LIVE_MUTATION ──────────────────────────────────────────────────────

test("NO_LIVE_MUTATION: this file only reads the live DB read-only, never writes", () => {
  const source = fs.readFileSync(new URL(import.meta.url), "utf8");
  const liveDbSection = source.split("dbPath =");
  for (const chunk of liveDbSection.slice(1)) {
    const nextTest = chunk.indexOf('test("');
    const scoped = nextTest === -1 ? chunk : chunk.slice(0, nextTest);
    assert.doesNotMatch(scoped, /\.run\(|\.exec\(/);
  }
  assert.match(source, /readOnly:\s*true/);
});
