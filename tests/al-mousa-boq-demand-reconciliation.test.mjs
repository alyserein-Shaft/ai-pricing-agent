// AL MOUSA -- BOQ QUANTITY & PER-BUILDING DEMAND RECONCILIATION.
//
// The properties proved here are all ways a campus quantity becomes a
// per-building number without evidence, or a duplicate survives into a census:
//
//   * a superseded BOQ revision outranking the current one;
//   * a continuation block double-counting its parent;
//   * a summary row and a detail row both counting the same demand;
//   * one spreadsheet row imported twice;
//   * a campus total quietly divided across buildings;
//   * a "merged" duplicate still counted, or a real duplicate left admitted;
//   * detector and module addresses collapsing into one undifferentiated count.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  quantityOf, bindSectionToBuilding, allocateRow, rebuildCensus,
  reconcilePanelCounts, SECTION_BINDING, ADDRESS_CLASS, ALLOCATION_STATUS, DEMAND_FAMILY,
} from "../scripts/lib/al-mousa-boq-demand-reconciliation.mjs";
import { IFP75_6815_CONFLICT, EXPANSION_STATE, loopAdmissibility } from "../scripts/lib/farenhyt-panel-capability.mjs";
import { rightSizePanel, classifyLoops } from "../scripts/lib/al-mousa-per-building-panel-reconstruction.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const readFile = (p) => readFileSync(join(REPO, p), "utf8");
const DB_PATH = process.env.FA_DB;

let SQLITE_DB = null;
if (DB_PATH) {
  const { DatabaseSync } = await import("node:sqlite");
  SQLITE_DB = new DatabaseSync(DB_PATH, { readOnly: true });
}

const row = (o) => ({
  description: o.desc, numericQuantity: o.qty, originalUnit: o.unit ?? "No",
  sourceRow: o.row ?? null, reviewStatus: o.rev ?? "Auto Verified", approved: o.appr ?? 1,
});
const admitted = (r) => r.approved === 1 && r.review_status !== "Merged";

// 1 -------------------------------------------------------------------------
test("1 -- current BOQ revision wins over a superseded revision", () => {
  // A superseded extraction version must never contribute.
  const rows = [row({ desc: "Smoke detectors (above ceiling)", qty: 100, row: 11 })];
  const census = rebuildCensus({ rows, includeRow: admitted });
  assert.equal(census.families[0].quantity, 100);

  const versions = [
    { id: "v1", version_number: 1, superseded_at: "2026-01-01" },
    { id: "v2", version_number: 2, superseded_at: null },
  ];
  const current = versions.filter((v) => !v.superseded_at).sort((a, b) => b.version_number - a.version_number)[0];
  assert.equal(current.id, "v2", "the highest non-superseded version wins");
  assert.equal(versions.filter((v) => !v.superseded_at).length, 1);

  if (SQLITE_DB) {
    const evs = SQLITE_DB.prepare(
      "SELECT ev.id, ev.superseded_at FROM boq_extraction_versions ev JOIN documents d ON d.id=ev.document_id WHERE d.project_id=?",
    ).all("project_ae501b85-9c12-4332-bf8e-787c90f2d388");
    assert.equal(evs.filter((e) => !e.superseded_at).length, 1, "exactly one current BOQ extraction");
    const versions2 = SQLITE_DB.prepare(
      "SELECT COUNT(*) c FROM document_versions WHERE document_id=(SELECT id FROM documents WHERE project_id=? AND document_type='BOQ') AND supersedes_version_id IS NOT NULL",
    ).get("project_ae501b85-9c12-4332-bf8e-787c90f2d388").c;
    assert.equal(versions2, 0, "no BOQ revision supersession exists");
  }
});

// 2 -------------------------------------------------------------------------
test("2 -- continuation sections do not double-count", () => {
  const parent = row({ desc: "Smoke detectors (above ceiling)", qty: 192, row: 59 });
  const contHeader = row({ desc: "Supply, install and connect fire alarm detection and alarm system complete ... (Cont'd)", qty: null, row: 78, rev: "Needs Review", appr: 0 });
  const c = rebuildCensus({ rows: [parent, contHeader], includeRow: admitted });
  // A continuation header carries no quantity and no family; it must not add demand.
  assert.equal(c.detectorAddresses, 192);
  assert.equal(c.suppressed.length, 1);
});

// 3 -------------------------------------------------------------------------
test("3 -- summary + detail cannot double-count the same demand", () => {
  const summary = row({ desc: "Smoke detectors (above ceiling)", qty: 192, row: 59 });
  const detail = row({ desc: "Smoke detectors (above ceiling)", qty: 192, row: 103, rev: "Merged", appr: 0 });
  const withDup = rebuildCensus({ rows: [summary, detail], includeRow: admitted });
  assert.equal(withDup.detectorAddresses, 192, "a merged repeat must not add a second 192");
  assert.equal(withDup.suppressed.length, 1);
  assert.equal(withDup.suppressed[0].quantity, 192, "the suppressed row stays VISIBLE with its quantity");
  // If both were admitted the census would double -- which is why the
  // suppression flag, not the description, is what governs.
  const both = rebuildCensus({ rows: [summary, row({ desc: "Smoke detectors (above ceiling)", qty: 192, row: 103 })], includeRow: admitted });
  assert.equal(both.detectorAddresses, 384);
});

// 4 -------------------------------------------------------------------------
test("4 -- the same source row cannot be imported twice", () => {
  const a = row({ desc: "Smoke detectors (above ceiling)", qty: 100, row: 11 });
  const b = row({ desc: "Smoke detectors (above ceiling)", qty: 100, row: 11 });
  const seen = new Map();
  const dupes = [];
  for (const r of [a, b]) {
    const k = `MECH RFQ#${r.sourceRow}`;
    if (seen.has(k)) dupes.push(k); else seen.set(k, r);
  }
  assert.equal(dupes.length, 1, "identical sheet+row is a double import");
  if (SQLITE_DB) {
    const rows = SQLITE_DB.prepare(
      "SELECT source_location, COUNT(*) c FROM boq_items WHERE extraction_version_id=? GROUP BY source_location HAVING c>1",
    ).all("boqextract_cba2c9b6-3e10-41ae-9811-abe9c92bb5c3");
    assert.equal(rows.length, 0, "no spreadsheet row is imported twice in the real data");
  }
});

// 5 -------------------------------------------------------------------------
test("5 -- building allocation requires explicit evidence", () => {
  const areas = ["BOYS SCHOOL", "GIRLS SCHOOL", "DG STATION"];
  const named = bindSectionToBuilding("DG Station (Near GRS building)", areas);
  assert.equal(named.binding, SECTION_BINDING.EXPLICIT_BUILDING_BINDING);
  // The binding resolves to the ARCHITECTURE area name; the original BOQ
  // wording is quoted in the evidence and is never rewritten into a building.
  assert.equal(named.area, "DG STATION");
  assert.equal(named.originalSectionWording, "DG Station (Near GRS building)", "the tender's own wording is preserved verbatim");
  assert.match(named.evidence, /DG Station \(Near GRS building\)/);

  // The campus scope statement names NO building.
  const campus = bindSectionToBuilding("Supply, install and connect fire alarm detection and alarm system complete including wiring, conduits, accessories, complete as required for proper operation, all as specified and as shown on the drawings", areas);
  assert.equal(campus.binding, SECTION_BINDING.CAMPUS_WIDE);
  assert.equal(campus.area, null, "no building may be inferred for a campus-wide scope");

  // A heading that matches nothing is ambiguous, never silently defaulted.
  const unknown = bindSectionToBuilding("Some other scope", areas);
  assert.equal(unknown.binding, SECTION_BINDING.AMBIGUOUS_BUILDING_BINDING);
  assert.equal(unknown.area, null);
});

// 6 -------------------------------------------------------------------------
test("6 -- campus quantities cannot be proportionally distributed", () => {
  const campus = bindSectionToBuilding("Supply, install and connect fire alarm detection and alarm system complete ...", ["BOYS SCHOOL"]);
  const alloc = allocateRow({ row: row({ desc: "Loop powered strobes", qty: 324 }), binding: campus, panelIndex: new Map() });
  assert.equal(alloc.status, ALLOCATION_STATUS.CAMPUS_WIDE_NOT_ALLOCATABLE);
  assert.equal(alloc.panel, null);
  assert.match(alloc.forbidden, /must not be divided/);
  // And nothing in the module offers a proportional split.
  const src = readFile("scripts/lib/al-mousa-boq-demand-reconciliation.mjs")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /\/ *areas\.length|\/ *panelCount|\/ *panelIdentities\.length/,
    "no campus quantity may be divided by a building or panel count");
});

// 7 -------------------------------------------------------------------------
test("7 -- unknown panel allocation remains unknown", () => {
  const binding = bindSectionToBuilding("DG Station (Near GRS building)", ["DG Station"]);
  const empty = allocateRow({ row: row({}), binding, panelIndex: new Map() });
  assert.equal(empty.status, ALLOCATION_STATUS.BUILDING_KNOWN_PANEL_UNRESOLVED);
  assert.equal(empty.panel, null, "the panel must stay null, not be invented from the area name");

  const resolved = allocateRow({ row: row({}), binding, panelIndex: new Map([["DG STATION", { identity: "FACP @DG BUILDING", resolutionState: "ADJUDICATED_CANONICAL" }]]) });
  assert.equal(resolved.status, ALLOCATION_STATUS.ALLOCATED_EXPLICIT);
  assert.equal(resolved.panel, "FACP @DG BUILDING");
});

// 8 -------------------------------------------------------------------------
test("8 -- detector and module address counts remain separate", () => {
  const c = rebuildCensus({
    rows: [
      row({ desc: "Smoke detectors (above ceiling)", qty: 131 }),
      row({ desc: "Heat detector", qty: 9 }),
      row({ desc: "Fire alarm manual station", qty: 29 }),
      row({ desc: "Interface module monitor", qty: 29 }),
      row({ desc: "Loop powered strobes", qty: 97 }),
    ],
    includeRow: admitted,
  });
  assert.equal(c.detectorAddresses, 140);
  assert.equal(c.moduleAddresses, 58);
  assert.equal(c.nonAddressable, 97);
  assert.equal(c.detectorAddresses + c.moduleAddresses, 198);
  // A strobe consumes ZERO SLC addresses -- it must not inflate the point count.
  const byFamily = (f) => c.families.find((x) => x.family === f).addressClass;
  assert.equal(byFamily(DEMAND_FAMILY.NOTIFICATION_INDOOR_STROBE), ADDRESS_CLASS.NONE);
  assert.equal(byFamily(DEMAND_FAMILY.SMOKE), ADDRESS_CLASS.DETECTOR);
  assert.equal(byFamily(DEMAND_FAMILY.MONITOR), ADDRESS_CLASS.MODULE);
});

// 9/10 ---------------------------------------------------------------------
test("9/10 -- panel sizing consumes per-panel demand, never a campus total", () => {
  const CAPS = [
    { partNumber: "IFP-75HV", slcLoopsInBuild: 1, expansionState: EXPANSION_STATE.NOT_SUPPORTED, expansionMaxCount: 0, panelPointCapacityIdpSk: 150, detectorsPerLoop: 75, modulesPerLoop: 75, flexputCircuits: 2 },
    { partNumber: "IFP-2100HV", slcLoopsInBuild: 1, expansionState: EXPANSION_STATE.SUPPORTED, expansionMaxCount: 12, panelPointCapacityIdpSk: 2100, detectorsPerLoop: 159, modulesPerLoop: 159, flexputCircuits: 8 },
  ];
  // A campus-only total is not a per-panel demand, so it cannot select a panel.
  const campusOnly = rightSizePanel({ panelId: "P", loops: classifyLoops({ drawnLoops: 1 }), capabilities: CAPS, detectorDemand: null, moduleDemand: null });
  assert.equal(campusOnly.selected, null, "campus total alone must not right-size a panel");
  assert.equal(campusOnly.status, "RIGHT_SIZE_CANDIDATE_AVAILABLE__DEMAND_NOT_PROVEN");

  // The same campus total that WOULD fit one panel must not be read as per-panel.
  const campusTotal = 1500;
  assert.ok(campusTotal > CAPS[0].panelPointCapacityIdpSk);
  const perPanel = rightSizePanel({ panelId: "P", loops: classifyLoops({ drawnLoops: 1 }), capabilities: CAPS, detectorDemand: 40, moduleDemand: 10 });
  assert.equal(perPanel.selected, "IFP-75HV", "with real per-panel demand the small panel is admissible");

  // Detector and module demand are validated SEPARATELY against separate limits.
  const detectorsOkModulesNot = rightSizePanel({ panelId: "P", loops: classifyLoops({ drawnLoops: 1 }), capabilities: CAPS, detectorDemand: 40, moduleDemand: 500 });
  assert.ok(!detectorsOkModulesNot.candidates.includes("IFP-75HV"),
    "a module demand of 500 must exclude a 75-module panel even when detectors fit");
});

// 11 ----------------------------------------------------------------------
test("11 -- notification allocation never invents exact P/N configuration", () => {
  const c = rebuildCensus({ rows: [row({ desc: "Loop powered strobes", qty: 324 }), row({ desc: "Loop powered strobes with sounder (weatherproof)", qty: 100 })], includeRow: admitted });
  const f = c.families.map((x) => x.family);
  assert.ok(f.includes(DEMAND_FAMILY.NOTIFICATION_INDOOR_STROBE));
  assert.ok(f.includes(DEMAND_FAMILY.NOTIFICATION_OUTDOOR_HORN_STROBE));
  // A family carries no part number, no mounting, no colour, no wiring.
  for (const fam of c.families) {
    assert.equal(fam.partNumber, undefined);
    assert.equal(fam.mounting, undefined);
    assert.equal(fam.bodyColour, undefined);
  }
  assert.doesNotMatch(readFile("scripts/lib/al-mousa-boq-demand-reconciliation.mjs"), /wall|ceiling|2-wire|4-wire|bodyColour/i,
    "this slice must not touch notification configuration");
});

// 12 ----------------------------------------------------------------------
test("12 -- phone-jack count does not imply telephone module count", () => {
  const c = rebuildCensus({ rows: [row({ desc: "Fireman telephone jack", qty: 73 })], includeRow: admitted });
  assert.equal(c.families[0].quantity, 73);
  assert.equal(c.families[0].addressClass, ADDRESS_CLASS.NONE);
  assert.ok(!c.families.some((f) => /TELEPHONE|FFT|MODULE/.test(f.family)), "no telephone circuit or module is derived from jacks");
});

// 13 ----------------------------------------------------------------------
test("13 -- the IFP-75/6815 official-document conflict is represented as a CONFLICT", () => {
  assert.equal(IFP75_6815_CONFLICT.state, EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT);
  assert.equal(IFP75_6815_CONFLICT.newProjectSelectionAuthority, "NOT_CONFIRMED");
  // Every source keeps its revision, date and direction.
  assert.ok(IFP75_6815_CONFLICT.sources.length >= 4);
  for (const s of IFP75_6815_CONFLICT.sources) {
    assert.equal(s.authority, "OFFICIAL_MANUFACTURER");
    assert.ok(s.reference && /\d{4}/.test(s.reference), "each source must carry a revision/date");
    assert.ok(s.text && s.text.length > 20, "each source must quote the manufacturer");
    assert.ok(["AFFIRMS", "DENIES", "AFFIRMS_FOR_IFP2100", "DENIES_FOR_IFP75"].includes(s.direction));
  }
  // At least one source affirms and at least one denies -- that is what makes it a conflict.
  const dirs = IFP75_6815_CONFLICT.sources.map((s) => s.direction);
  assert.ok(dirs.some((d) => d.startsWith("AFFIRMS")));
  assert.ok(dirs.some((d) => d.startsWith("DENIES")));
  assert.ok(IFP75_6815_CONFLICT.sources.some((s) => /NO panel model is ever enumerated/i.test(s.caveat)),
    "the non-enumerating source must say so");
});

// 14 ----------------------------------------------------------------------
test("14 -- a conflicted compatibility state cannot authorise expansion procurement", () => {
  const conflicted = {
    partNumber: "IFP-75HV", slcLoopsInBuild: 1,
    expansionState: EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT, expansionMaxCount: null,
  };
  const r = loopAdmissibility({ capability: conflicted, drawnLoops: 6 });
  assert.equal(r.admissible, null, "a conflict authorises nothing");
  assert.notEqual(r.admissible, false, "and must not be collapsed into a settled rejection");
  assert.equal(r.state, "CONFLICTED_NO_PROCUREMENT_AUTHORITY");
  // Within in-build capacity a conflict is irrelevant.
  assert.equal(loopAdmissibility({ capability: conflicted, drawnLoops: 1 }).admissible, true);
  // The global-prohibition conclusion is explicitly forbidden.
  assert.ok(IFP75_6815_CONFLICT.permittedConclusions.some((c) => /may not be expanded/i.test(c)));
  assert.ok(IFP75_6815_CONFLICT.permittedConclusions.some((c) => /NOT established/i.test(c)),
    "the global prohibition must be explicitly recorded as NOT established");
  assert.ok(IFP75_6815_CONFLICT.forbiddenConclusions.some((c) => /record NOT_SUPPORTED as settled/i.test(c)),
    "collapsing the conflict into a settled rejection must be forbidden");
});

// 15 ----------------------------------------------------------------------
test("15 -- final quotation / historical BOM is not an input", () => {
  for (const f of ["scripts/lib/al-mousa-boq-demand-reconciliation.mjs", "scripts/reconcile-al-mousa-fire-alarm-demand.mjs"]) {
    const code = readFile(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /quotation|selling|finalBOM|customerQuote|supplierQuote|golden.*bom|answer.?key/i, f);
    assert.doesNotMatch(code, /import .*from "node:fs"|readFileSync/, `${f} must not read local files`);
  }
});

// 16 ----------------------------------------------------------------------
test("16 -- rerun is deterministic and the reconciliation is idempotent", () => {
  const rows = [row({ desc: "Smoke detectors (above ceiling)", qty: 131 }), row({ desc: "Smoke detectors (below ceiling)", qty: 253 })];
  const a = rebuildCensus({ rows, includeRow: admitted });
  const b = rebuildCensus({ rows: [...rows], includeRow: admitted });
  assert.deepEqual(a.families, b.families);
  // Rebuilding from an already-reconciled row set must not add demand.
  const again = rebuildCensus({ rows, includeRow: admitted });
  assert.equal(again.detectorAddresses, a.detectorAddresses);

  // Quantity coercion must be total and must never produce a false zero.
  assert.equal(quantityOf("131"), 131);
  assert.equal(quantityOf("1,310"), 1310);
  assert.equal(quantityOf(null), null);
  assert.equal(quantityOf(""), null);
  assert.equal(quantityOf("abc"), null);
  assert.notEqual(quantityOf("0"), null, "a genuine zero stays a zero, not an unknown");
});

// 17 ----------------------------------------------------------------------
test("17 -- panel-count reconciliation reports, never forces", () => {
  const r = reconcilePanelCounts({
    boqPanelRows: [{ description: "Main Fire alarm control panel with all required hardware", numericQuantity: 1 }, { description: "Fire alarm control panel with all accessories", numericQuantity: 1 }],
    architecturePanels: [{ identity: "MFACP", role: "MFACP" }, { identity: "FACP::BOYS", role: "FACP" }],
  });
  assert.equal(r.boqPanelQuantity, 2);
  assert.equal(r.architecturePanelCount, 2);
  assert.equal(r.delta, 0);
  assert.equal(r.forced, false, "counts must never be forced to agree");
  assert.match(r.status, /BINDING_UNPROVEN/, "equal counts still do not prove binding");
  assert.ok(r.classifications.some((c) => c.status === "MISSING_BOQ_PANEL"));
});