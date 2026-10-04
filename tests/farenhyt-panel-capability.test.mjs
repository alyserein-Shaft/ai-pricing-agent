// FARENHYT PANEL CAPABILITY ENRICHMENT + CORRECTED ADMISSIBILITY SEMANTICS.
//
// The bug this whole slice exists to prevent:
//
//     NO GOVERNED EVIDENCE FOUND   was treated as
//     MANUFACTURER DOES NOT SUPPORT
//
// and that conflation silently rejected technically valid panels. A knowledge
// gap must never exclude a product, and must never silently admit one either
// -- so expansion capability is modelled as an explicit tri-state with
// provenance, and the maximum-expander count is an INDEPENDENT fact.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPANSION_STATE, MAXIMUM_STATE, MANUFACTURER_SOURCES, PANEL_CAPABILITY_FACTS,
  NETWORK_INTEROP_MODELS, DUCT_COMPATIBILITY_NOTE, PANEL_ELECTRICAL_FAMILY, familyFor,
  loopAdmissibility, capabilityFromAttributes,
} from "../scripts/lib/farenhyt-panel-capability.mjs";
import { classifyLoops, rightSizePanel } from "../scripts/lib/al-mousa-per-building-panel-reconstruction.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const readFile = (p) => readFileSync(join(REPO, p), "utf8");
const DB_PATH = process.env.FA_DB;

let SQLITE_DB = null;
if (DB_PATH) {
  const { DatabaseSync } = await import("node:sqlite");
  SQLITE_DB = new DatabaseSync(DB_PATH, { readOnly: true });
}

const cap = (o) => ({
  partNumber: "X", slcLoopsInBuild: 1, expansionState: null, expansionMaxCount: null,
  expansionMaxState: null, panelPointCapacityIdpSk: null, detectorsPerLoop: null,
  modulesPerLoop: null, flexputCircuits: null, ...o,
});

// 1 -------------------------------------------------------------------------
test("1 -- missing capability evidence does NOT mean unsupported", () => {
  const unknown = cap({ expansionState: EXPANSION_STATE.UNKNOWN });
  const r = loopAdmissibility({ capability: unknown, drawnLoops: 6 });
  assert.equal(r.admissible, null, "unknown capability must NOT be a rejection");
  assert.notEqual(r.admissible, false);
  assert.equal(r.state, "UNPROVEN_EXPANSION_CAPABILITY_UNKNOWN");
  assert.match(r.reason, /knowledge gap, NOT a technical rejection/);

  // A completely absent attribute set behaves the same way.
  const absent = cap({ expansionState: null });
  assert.equal(loopAdmissibility({ capability: absent, drawnLoops: 6 }).admissible, null);

  // And the three states must be genuinely distinguishable.
  const states = new Set([EXPANSION_STATE.SUPPORTED, EXPANSION_STATE.NOT_SUPPORTED, EXPANSION_STATE.UNKNOWN]);
  assert.equal(states.size, 3);
});

// 2 -------------------------------------------------------------------------
test("2 -- explicit incompatible evidence still rejects", () => {
  const notSupported = cap({ expansionState: EXPANSION_STATE.NOT_SUPPORTED, expansionMaxCount: 0 });
  const r = loopAdmissibility({ capability: notSupported, drawnLoops: 6 });
  assert.equal(r.admissible, false, "explicit NOT_SUPPORTED must still exclude the panel");
  assert.equal(r.state, "INADMISSIBLE_EXPANSION_NOT_SUPPORTED");
  assert.match(r.reason, /does not accept/);
  // ...but within in-build capacity it stays admissible.
  assert.equal(loopAdmissibility({ capability: notSupported, drawnLoops: 1 }).admissible, true);

  // Exceeding a PROVEN maximum is also a real rejection, distinct from above.
  const capped = cap({ expansionState: EXPANSION_STATE.SUPPORTED, expansionMaxCount: 2 });
  const over = loopAdmissibility({ capability: capped, drawnLoops: 10 });
  assert.equal(over.admissible, false);
  assert.equal(over.state, "INADMISSIBLE_EXCEEDS_PROVEN_MAXIMUM");
  assert.equal(loopAdmissibility({ capability: capped, drawnLoops: 3 }).admissible, true);
});

// 3 -------------------------------------------------------------------------
test("3 -- IFP-75/IFP-2100 expansion capability follows manufacturer facts", () => {
  const f = (pn, a) => PANEL_CAPABILITY_FACTS.find((x) => x.partNumber === pn && x.attribute === a);
  // CORRECTED: IFP-75/6815 is a first-party CONFLICT, not a settled
  // NOT_SUPPORTED. The invariant preserved here is that the conclusion rests on
  // affirmative manufacturer evidence -- never on silence.
  assert.equal(f("IFP-75HV", "slc_expansion_state").value, EXPANSION_STATE.OFFICIAL_DOCUMENTATION_CONFLICT);
  assert.equal(f("IFP-75HV", "slc_loop_count").value, 1);
  assert.equal(f("IFP-2100HV", "slc_expansion_state").value, EXPANSION_STATE.SUPPORTED);
  assert.equal(f("IFP-2100HV", "slc_loop_count").value, 1);

  // The IFP-75 finding rests on affirmative wording from BOTH sides.
  const conflict = f("IFP-75HV", "slc_expansion_state");
  assert.match(conflict.original, /\(A\).*Farenhyt Series/i, "the affirming source must be recorded");
  assert.match(conflict.original, /\(B\).*Intelligent Signaling Line Circuits: 1/i, "the denying source must be recorded with its actual spec-block wording");
  assert.match(conflict.original, /no '\(expandable\)' qualifier/, "the missing qualifier must be recorded, not paraphrased away");
  assert.match(conflict.original, /ZERO times/, "the IFP-75 datasheet absence must itself be evidenced");
  assert.match(conflict.original, /erratum/i, "the absence of a reconciling erratum must be recorded");
  // IFP-2100's is affirmative.
  assert.match(f("IFP-2100HV", "slc_expansion_state").original, /6815: SLC Expander for IDP and SK devices/);

  // Maximum expander count is a SEPARATE fact from support.
  //
  // SUPERSEDED EXPECTATION -- recorded here rather than silently deleted.
  // This test previously asserted `slc_expansion_max_count === 12` AND
  // `12 === Math.floor(2100/159) - 1`, i.e. it asserted that the physical
  // maximum expander count was the point-capacity arithmetic 2100/159.
  // First-party evidence retrieved and inspected 2026-10-01 REFUTES that:
  //   * 6815 Data Sheet, SYSTEM CAPACITY: "IFP-2100/ECS FACP supports 63 6815s
  //     (but a maximum of 2100 SLC devices per system)".
  //   * LS10143-001SK-E Rev E Sec 4.12: "The maximum number of IDP or SK SLC
  //     devices per panel is 2,100. The number of 6815s is limited by the maximum
  //     number of SBUS devices." -- it never states 12; its 71 occurrences of
  //     "12" are section and page numbers.
  // The expander maximum is SBUS-bounded (63), a DIFFERENT concept from the
  // 2100-point system ceiling. The old expectation was therefore a wrong
  // assertion, not a guard; replacing it strengthens the test.
  assert.equal(f("IFP-2100HV", "slc_expansion_max_count").value, 63);
  assert.match(f("IFP-2100HV", "slc_expansion_max_count").original, /supports 63 6815s/);
  assert.equal(f("IFP-2100HV", "slc_expansion_max_state").value, MAXIMUM_STATE.PROVEN);
  // The maximum must follow from a stated manufacturer figure, not point arithmetic.
  assert.notEqual(f("IFP-2100HV", "slc_expansion_max_count").value, Math.floor(2100 / 159) - 1,
    "the expander maximum must NOT be the 2100/159 point-capacity arithmetic");
  // The three concepts stay independent.
  assert.equal(f("IFP-2100HV", "max_system_slc_points_idp_sk").value, 2100);
  assert.equal(f("IFP-2100HV", "full_populated_loop_equivalent_at_system_ceiling").value, 13);

  if (SQLITE_DB) {
    const got = SQLITE_DB.prepare(
      `SELECT pa.normalized_value, pa.original_value, pa.evidence_json FROM product_attributes pa
       JOIN library_products lp ON lp.id=pa.product_id
       WHERE lp.part_number='IFP-2100HV' AND pa.attribute_name='slc_expansion_state'`,
    ).get();
    assert.equal(got.normalized_value, EXPANSION_STATE.SUPPORTED);
    const ev = JSON.parse(got.evidence_json);
    assert.equal(ev.authority, "OFFICIAL_MANUFACTURER");
    assert.match(ev.reference, /351602 Rev C/, "the document revision must travel with the fact");
    assert.ok(got.original_value, "the original manufacturer wording must be retained");
  }
});

// 4 -------------------------------------------------------------------------
test("4 -- capability facts are reusable and not Al-Mousa hard-coded", () => {
  const src = readFile("scripts/lib/farenhyt-panel-capability.mjs");
  // Strip comments before checking: the file explains in prose that it is NOT
  // project specific, which is not the same as encoding a project.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /al[- ]?mousa|project_ae501b85|BOS BUILDING|GIRLS|WELCOME|DG STATION/i,
    "manufacturer capability must not encode any project");
  // Every fact must name a registered first-party source.
  for (const f of PANEL_CAPABILITY_FACTS) {
    const s = MANUFACTURER_SOURCES[f.source];
    assert.ok(s, `${f.partNumber}.${f.attribute} names unknown source ${f.source}`);
    assert.equal(s.authority, "OFFICIAL_MANUFACTURER");
    assert.ok(f.original && f.original.length > 10, `${f.attribute} must retain original wording`);
    // A value may be null ONLY when the original wording states why it is not
    // yet proven -- an unexplained null is exactly the silent knowledge gap
    // this slice exists to eliminate.
    if (f.value === null || f.value === undefined) {
      assert.match(String(f.original), /NOT YET PROVEN|blocked by|CONFLICT/i,
        `${f.partNumber}.${f.attribute} is null but its wording does not say why`);
    }
  }
  // Facts are keyed by manufacturer part number, so another project reuses them.
  const pns = new Set(PANEL_CAPABILITY_FACTS.map((f) => f.partNumber));
  assert.ok(pns.has("IFP-75HV") && pns.has("IFP-2100HV") && pns.has("6815"));

  // The right-sizing library must READ capability, not declare it.
  const rs = readFile("scripts/lib/al-mousa-per-building-panel-reconstruction.mjs");
  assert.doesNotMatch(rs, /FARENHYT_PANEL_CAPABILITY = Object\.freeze/,
    "per-project capability declarations are what let this drift from the library");
  assert.match(rs, /loadPanelCapability/);
});

// 5 -------------------------------------------------------------------------
test("5 -- low-loop panel candidates are reconsidered after enrichment", () => {
  // The enriched knowledge must admit a SMALL panel for a single-loop drawing,
  // which the previous knowledge state could not do.
  const small = cap({
    partNumber: "IFP-75HV", expansionState: EXPANSION_STATE.NOT_SUPPORTED,
    expansionMaxCount: 0, panelPointCapacityIdpSk: 150, detectorsPerLoop: 75,
    modulesPerLoop: 75, flexputCircuits: 2,
  });
  const one = loopAdmissibility({ capability: small, drawnLoops: 1 });
  assert.equal(one.admissible, true, "a 1-loop drawing is inside an IFP-75's in-build SLC");
  assert.equal(one.additionalLoops, 0);

  // And it must still exclude the same panel for a 6-loop drawing.
  assert.equal(loopAdmissibility({ capability: small, drawnLoops: 6 }).admissible, false);

  // Mixed sizes must be possible in one project.
  assert.equal(PANEL_ELECTRICAL_FAMILY["IFP-75"].variants.length, 4,
    "the four IFP-75 colour/input variants are ONE electrical family");
  assert.match(PANEL_ELECTRICAL_FAMILY["IFP-75"].original, /IFP-75HV \(red\)/);
  assert.equal(familyFor("IFP-75B"), "IFP-75");
  assert.equal(familyFor("IFP-75HV"), "IFP-75");
  assert.equal(familyFor("IFP-2100HVB"), "IFP-2100");
  assert.ok(NETWORK_INTEROP_MODELS.includes("IFP-75") && NETWORK_INTEROP_MODELS.includes("IFP-2100"),
    "first-party interop statement must include both families");
});

// 6 -------------------------------------------------------------------------
test("6 -- no model is selected without required panel demand", () => {
  const capabilities = [
    cap({ partNumber: "IFP-75HV", expansionState: EXPANSION_STATE.NOT_SUPPORTED, expansionMaxCount: 0, panelPointCapacityIdpSk: 150, detectorsPerLoop: 75, modulesPerLoop: 75, flexputCircuits: 2 }),
    cap({ partNumber: "IFP-2100HV", expansionState: EXPANSION_STATE.SUPPORTED, expansionMaxCount: 12, panelPointCapacityIdpSk: 2100, detectorsPerLoop: 159, modulesPerLoop: 159, flexputCircuits: 8 }),
  ];
  const noDemand = rightSizePanel({ panelId: "P", loops: classifyLoops({ drawnLoops: 1 }), capabilities, detectorDemand: null, moduleDemand: null });
  assert.equal(noDemand.selected, null, "no panel may be selected without demand");
  assert.equal(noDemand.status, "RIGHT_SIZE_CANDIDATE_AVAILABLE__DEMAND_NOT_PROVEN");
  assert.ok(noDemand.candidates.includes("IFP-75HV"), "the candidate is still reported");

  // A 1-loop drawing with proven small demand IS right-sized.
  const proven = rightSizePanel({ panelId: "P", loops: classifyLoops({ drawnLoops: 1 }), capabilities, detectorDemand: 40, moduleDemand: 10 });
  assert.equal(proven.selected, "IFP-75HV", "loop count alone must not force the larger panel");

  // Unknown loop count can never yield a selection.
  const unknownLoops = rightSizePanel({ panelId: "P", loops: classifyLoops({ drawnLoops: null }), capabilities, detectorDemand: 40, moduleDemand: 10 });
  assert.equal(unknownLoops.selected, null);
  assert.match(unknownLoops.blockers.join(" "), /not known/);
});

// 7 -------------------------------------------------------------------------
test("7 -- final quotation / history is not an input", () => {
  for (const f of ["scripts/lib/farenhyt-panel-capability.mjs", "scripts/enrich-farenhyt-panel-capability.mjs",
    "scripts/lib/al-mousa-per-building-panel-reconstruction.mjs"]) {
    assert.doesNotMatch(readFile(f), /quotation|selling|finalBOM|customerQuote|supplierQuote|priceList|golden.*bom/i, f);
  }
  // The capability library must stay I/O-free and pure.
  assert.doesNotMatch(readFile("scripts/lib/farenhyt-panel-capability.mjs"), /import .*from "node:/);
  // Only manufacturer document references may appear.
  for (const s of Object.values(MANUFACTURER_SOURCES)) assert.match(s.url, /prod-edam\.honeywell\.com/);
});

// 8 -------------------------------------------------------------------------
test("8 -- enrichment rerun is idempotent", () => {
  if (!SQLITE_DB) return;
  const key = (pn, a) => SQLITE_DB.prepare(
    "SELECT COUNT(*) c FROM product_attributes pa JOIN library_products lp ON lp.id=pa.product_id WHERE lp.part_number=? AND pa.attribute_name=?",
  ).get(pn, a).c;
  const before = key("IFP-2100HV", "slc_expansion_state");
  assert.equal(before, 1, "one row per (product, attribute) -- no duplicates");
  const beforeTotal = SQLITE_DB.prepare("SELECT COUNT(*) c FROM product_attributes").get().c;

  // The script itself is idempotent by construction: it skips matching values.
  const src = readFile("scripts/enrich-farenhyt-panel-capability.mjs");
  assert.match(src, /already-correct|skipped\+\+/, "an unchanged value must be skipped, not re-inserted");

  // Guard: no duplicate (product, attribute) pairs anywhere we touched.
  const dupes = SQLITE_DB.prepare(
    "SELECT lp.part_number, pa.attribute_name, COUNT(*) c FROM product_attributes pa JOIN library_products lp ON lp.id=pa.product_id GROUP BY lp.part_number, pa.attribute_name HAVING c>1",
  ).all();
  assert.deepEqual(dupes.filter((d) => PANEL_CAPABILITY_FACTS.some((f) => f.partNumber === d.part_number && f.attribute === d.attribute_name)), [],
    "enrichment must never create a duplicate fact");
  assert.ok(SQLITE_DB.prepare("SELECT COUNT(*) c FROM product_attributes").get().c >= beforeTotal);
});

// 9 -------------------------------------------------------------------------
test("9 -- duct compatibility nuance is recorded WITHOUT reopening selection", () => {
  assert.match(DUCT_COMPATIBILITY_NOTE.original, /included with IDP-PHOTO-R/);
  assert.match(DUCT_COMPATIBILITY_NOTE.doesNotEstablish, /INCOMPATIBLE/i);
  assert.match(DUCT_COMPATIBILITY_NOTE.doesNotEstablish, /states no exclusivity/i);
  assert.equal(DUCT_COMPATIBILITY_NOTE.status, "COMPATIBILITY_NUANCE_RECORDED");
  assert.equal(DUCT_COMPATIBILITY_NOTE.selectionImpact, "NONE_IN_THIS_SLICE");
  assert.match(DUCT_COMPATIBILITY_NOTE.forbiddenConclusion, /never be used with DNR/);
  // The existing Al Mousa duct selection must be untouched by this slice.
  const sel = readFile("scripts/lib/al-mousa-fire-alarm-selection-farenhyt.mjs");
  assert.match(sel, /IDP-PHOTO-R-IV/, "the Al Mousa duct head selection must still be IDP-PHOTO-R-IV");
});

// 10 ------------------------------------------------------------------------
test("10 -- capabilityFromAttributes never converts absent knowledge to zero", () => {
  const bundle = capabilityFromAttributes([{ attribute_name: "slc_loop_count", normalized_value: "1" }]);
  assert.equal(bundle.slcLoopsInBuild, 1);
  for (const k of ["expansionState", "expansionMaxCount", "panelPointCapacityIdpSk", "flexputCircuits", "batteryCapacityAh"]) {
    assert.equal(bundle[k], null, `absent ${k} must stay null`);
    assert.notEqual(bundle[k], 0);
  }
});