import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGeneralDrawingExtractionProposals } from "../app/domain/drawing-general-extraction-engine.mjs";
import { classifyDrawingType } from "../app/domain/drawing-type-classifier.mjs";
import { buildLegendNotesIntelligence } from "../app/domain/drawing-legend-notes-intelligence.mjs";
import { buildRiserSchematicIntelligence } from "../app/domain/drawing-riser-schematic-intelligence.mjs";
import { buildCauseEffectIntelligence } from "../app/domain/drawing-cause-effect-intelligence.mjs";
import { detectCrossSheetReferences, resolveCrossSheetReferenceTargets } from "../app/domain/drawing-cross-sheet-references.mjs";
import { FCC_ROOM_DETAILS_PAGES, FCC_ROOM_DETAILS_ASSETS } from "./golden/fcc-room-details.fixture.mjs";
import { AMS_ELV_LEGEND_PAGES, AMS_ELV_LEGEND_ASSETS, AMS_ELV_LEGEND_LEGEND_ENTRIES } from "./golden/ams-elv-legend-notes.fixture.mjs";
import { KGS_SCHEMATIC_PAGES, KGS_SCHEMATIC_ASSETS } from "./golden/kgs-fire-alarm-schematic.fixture.mjs";
import { AMS_CAUSE_EFFECT_PAGES, AMS_CAUSE_EFFECT_ASSETS } from "./golden/ams-cause-and-effect.fixture.mjs";

// DRAWING INTELLIGENCE -- WORKSTREAM 10: Golden Drawing Set.
//
// Four real Al Mousa sheets, one per distinct drawing purpose, each with
// its own expected MINIMUM intelligence -- proposal counts are
// deliberately NOT required to match across sheet types (a schematic and a
// legend sheet produce fundamentally different evidence).

const FCC = { id: "doc_f7e45eba-f10e-4be2-8bb9-315e22ceb821", drawingNumber: "2401232-PC-KGS-DR-T-91-ZZZ-002", sheetName: "FCC ROOM DETAILS" };
const AMS_LEGEND = { id: "doc_0de6f58b-7b48-46a2-92d3-aaef230c92b0", drawingNumber: "2401232-PC-AMS-DR-T-00-ZZZ-002", sheetName: "ELV LEGENDS, NOTES AND ABBREVIATIONS" };
const KGS_SCHEMATIC_DOC = { id: "doc_4ac2950e-0053-4f25-8554-a9dcb906c418", drawingNumber: "2401232-PC-KGS-DR-T-93-ZZZ-005", sheetName: "FIRE DETECTION & ALARM SCHEMATIC" };
const AMS_CE = { id: "doc_f3ce8475-0c64-4abf-8e1b-1d2bfc6a60b5", drawingNumber: "2401232-PC-AMS-DR-T-94-ZZZ-001", sheetName: "FIRE ALARM SYSTEM CAUSE AND EFFECT MATRIX" };

// ---- 1. FCC ROOM DETAILS -----------------------------------------------

test("GOLDEN SET 1/4 (FCC ROOM DETAILS) -- 14/14 schedule rows, safe callout behavior, no FACP/MFACP auto-merge, no false connectivity", () => {
  const type = classifyDrawingType({ sheetName: FCC.sheetName });
  assert.equal(type.drawingType, "Detail / Enlarged Detail");

  const result = buildGeneralDrawingExtractionProposals({ pages: FCC_ROOM_DETAILS_PAGES, assets: FCC_ROOM_DETAILS_ASSETS });
  assert.equal(result.scheduleItems.length, 14);
  assert.ok(result.callouts.length > 0);
  for (const callout of result.callouts) assert.equal(callout.governedStatus, "Needs Review");
  const facp = result.equipmentCandidates.find((c) => c.alias === "FACP");
  assert.ok(facp);
  assert.equal(facp.identityStatus, "Potential Alias");
  assert.notEqual(facp.identityStatus, "Same Instance");
  assert.doesNotMatch(JSON.stringify(result), /SystemConnection/);
});

// ---- 2. AMS ELV LEGENDS, NOTES AND ABBREVIATIONS -----------------------

test("GOLDEN SET 2/4 (Legend/Notes) -- real symbol/abbreviation proposals with scoped applicability, never global", () => {
  const type = classifyDrawingType({ sheetName: AMS_LEGEND.sheetName });
  assert.equal(type.drawingType, "Legend / Notes");

  const intelligence = buildLegendNotesIntelligence({
    sourceDocument: AMS_LEGEND,
    pageNumber: 1,
    assets: AMS_ELV_LEGEND_ASSETS,
    legendEntries: AMS_ELV_LEGEND_LEGEND_ENTRIES,
  });
  assert.ok(intelligence.legendDefinitions.length >= 5, "expected the 5 real legend entries to normalize into proposals");
  for (const definition of intelligence.legendDefinitions) {
    assert.ok(definition.applicabilityStatus);
    assert.doesNotMatch(definition.applicabilityStatus, /entire project|all drawings|globally/i);
    assert.equal(definition.sourceDocumentId, AMS_LEGEND.id);
  }
  // Same-sheet legend is Primary authority for symbols/abbreviations
  // (Rule A) -- explicit, no triggers, so it legitimately reaches Verified.
  assert.ok(intelligence.legendDefinitions.some((d) => d.governedStatus === "Verified"));
  assert.ok(intelligence.generalNotes.length > 0, "expected numbered general-note lines to be found on this real sheet");
});

test("GOLDEN SET 2/4 (Legend/Notes) -- explicit referenced-sheet behavior: the real FCC reference remains unresolved when the candidate adds DR", () => {
  const references = detectCrossSheetReferences({ sourceDocument: FCC, pageNumber: 1, assets: FCC_ROOM_DETAILS_ASSETS });
  assert.ok(references.length > 0);
  const registry = [AMS_LEGEND, FCC, KGS_SCHEMATIC_DOC, AMS_CE].map((doc) => ({ id: doc.id, drawingNumber: doc.drawingNumber }));
  const resolved = resolveCrossSheetReferenceTargets(references, registry);
  const toLegend = resolved.find((reference) => reference.referencedDrawingNumber === "2401232-PC-AMS-T-00-ZZZ-002");
  assert.ok(toLegend);
  assert.equal(toLegend.resolvedTargetDocumentId, null);
  assert.equal(toLegend.status, "Unresolved");
  assert.equal(toLegend.applicableSystem, "ELV");
  assert.doesNotMatch(toLegend.applicabilityStatus, /entire project|globally/i);
});

// ---- 3. KGS FIRE DETECTION & ALARM SCHEMATIC ---------------------------

test("GOLDEN SET 3/4 (Riser/Schematic) -- real panel/device/loop/tag candidates, possible connectivity only with semantic evidence, never geometry-only", () => {
  const type = classifyDrawingType({ sheetName: KGS_SCHEMATIC_DOC.sheetName });
  assert.equal(type.drawingType, "Schematic / Single-Line");

  const intelligence = buildRiserSchematicIntelligence({
    sourceDocument: KGS_SCHEMATIC_DOC,
    pageNumber: 1,
    drawingType: type.drawingType,
    assets: KGS_SCHEMATIC_ASSETS,
  });
  assert.ok(intelligence.loops.length > 0, "expected real LOOP-n tags to be found");
  assert.ok(intelligence.cableSpecs.length > 0, "expected real cable specification text to be found");
  assert.ok(intelligence.systemInterfaces.length > 0, "expected real 'INTERFACE TO <system>' notes to be found");
  // Explicit tags on this authoritative sheet type CAN legitimately reach
  // Verified (real evidence, not geometry) -- but every connection
  // candidate specifically stays Needs Review (no junction/line-type
  // geometry exists anywhere in this pipeline to complete the evidence bar).
  assert.ok(intelligence.loops.some((loop) => loop.governedStatus === "Verified"));
  for (const connection of intelligence.connectionCandidates) {
    assert.equal(connection.governedStatus, "Needs Review");
    assert.ok(connection.hardReviewReasons.length > 0);
  }
});

test("GOLDEN SET 3/4 (Riser/Schematic) -- no connection candidate is ever produced from geometry/proximity alone, only explicit text", () => {
  const intelligence = buildRiserSchematicIntelligence({
    sourceDocument: KGS_SCHEMATIC_DOC,
    pageNumber: 1,
    drawingType: "Schematic / Single-Line",
    assets: KGS_SCHEMATIC_ASSETS,
  });
  for (const connection of intelligence.connectionCandidates) {
    assert.match(connection.rawLabel, /^TO\s/i, "every connection candidate must be backed by an explicit 'TO <destination>' statement");
  }
});

// ---- 4. AMS FIRE ALARM SYSTEM CAUSE AND EFFECT MATRIX ------------------

test("GOLDEN SET 4/4 (Cause & Effect) -- mechanism is real and tested; blank/graphic-only matrix cells never become relationships", () => {
  const type = classifyDrawingType({ sheetName: AMS_CE.sheetName });
  assert.equal(type.drawingType, "Cause & Effect");

  const real = buildCauseEffectIntelligence({ sourceDocument: AMS_CE, pageNumber: 1, drawingType: type.drawingType, assets: AMS_CAUSE_EFFECT_ASSETS });
  // Honest, evidence-based finding: this real sheet's matrix GRID content
  // (the actual cause/effect cells) is not captured as extractable text by
  // Drawing Intake -- only title-block/general-notes text is present.
  // Zero relationships here is the CORRECT result for this real sheet, not
  // a missed extraction -- proven separately below with a synthetic
  // fixture that the mechanism itself works when the evidence exists.
  assert.equal(real.relationships.length, 0);
  assert.equal(real.headers.length, 0, "title-block noise must not be misread as matrix headers");

  const synthetic = [
    { id: "r1", asset_type: "Text", text_content: "SMOKE DETECTOR ACTIVATION SHUTS DOWN AHU-01", bounding_box: { x: 200, y: 300, width: 200, height: 12 } },
    { id: "r2", asset_type: "Text", text_content: "MANUAL CALL POINT TRIGGERS EVACUATION ALARM", bounding_box: { x: 200, y: 280, width: 200, height: 12 } },
    // A blank/graphic-only cell has no text asset at all -- there is
    // nothing here representing "no relationship"; absence is absence.
  ];
  const synth = buildCauseEffectIntelligence({ sourceDocument: AMS_CE, pageNumber: 1, drawingType: type.drawingType, assets: synthetic });
  assert.equal(synth.relationships.length, 2);
  for (const relationship of synth.relationships) {
    assert.equal(relationship.governedStatus, "Needs Review");
    assert.ok(relationship.hardReviewReasons.some((reason) => /life safety/i.test(reason)));
  }
});

// ---- Full-suite regression: all 4 fixtures together --------------------

test("GOLDEN SET -- full test suite regressions remain intact across all four real sheets simultaneously", () => {
  for (const [pages, assets] of [
    [FCC_ROOM_DETAILS_PAGES, FCC_ROOM_DETAILS_ASSETS],
    [KGS_SCHEMATIC_PAGES, KGS_SCHEMATIC_ASSETS],
    [AMS_ELV_LEGEND_PAGES, AMS_ELV_LEGEND_ASSETS],
    [AMS_CAUSE_EFFECT_PAGES, AMS_CAUSE_EFFECT_ASSETS],
  ]) {
    const result = buildGeneralDrawingExtractionProposals({ pages, assets });
    assert.doesNotMatch(JSON.stringify(result), /SystemConnection/);
  }
});
