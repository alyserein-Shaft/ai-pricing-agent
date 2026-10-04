import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCrossSheetReferences, resolveCrossSheetReferenceTargets } from "../app/domain/drawing-cross-sheet-references.mjs";

const SOURCE = { id: "doc1", drawingNumber: "2401232-PC-KGS-DR-T-91-ZZZ-002", sheetName: "FCC ROOM DETAILS" };

test("cross-sheet explicit reference -- an explicit 'refer to DWG NO. X' note is detected with the real drawing number", () => {
  const text = "1. FOR ELV LEGENDS, GENERAL NOTES & ABBREVIATIONS REFER\nDWG NO. 2401232-PC-AMS-T-00-ZZZ-002";
  const result = detectCrossSheetReferences({ sourceDocument: SOURCE, pageNumber: 1, assets: [{ id: "a1", text_content: text }] });
  assert.equal(result.length, 1);
  assert.equal(result[0].referencedDrawingNumber, "2401232-PC-AMS-T-00-ZZZ-002");
  assert.equal(result[0].sourceDocumentId, "doc1");
  assert.equal(result[0].pageNumber, 1);
});

test("no global legend propagation -- applicability is scoped to the named system, never 'applies to entire project'", () => {
  const text = "FOR ELV LEGENDS REFER DWG NO. 2401232-PC-AMS-T-00-ZZZ-002";
  const result = detectCrossSheetReferences({ sourceDocument: SOURCE, assets: [{ id: "a1", text_content: text }] });
  assert.equal(result[0].applicableSystem, "ELV");
  assert.equal(result[0].applicabilityStatus, "Scoped to ELV drawings");
  assert.doesNotMatch(result[0].applicabilityStatus, /entire project|all drawings|globally/i);
});

test("legend applicability -- when no system is named, the reference is scoped only to the current sheet, not resolved as globally applicable", () => {
  const text = "SEE DRAWING NO. 2401232-PC-WLC-DR-T-93-ZZZ-005 FOR DETAILS";
  const result = detectCrossSheetReferences({ sourceDocument: SOURCE, assets: [{ id: "a1", text_content: text }] });
  assert.equal(result[0].applicableSystem, null);
  assert.equal(result[0].applicabilityStatus, "Scoped to current sheet");
});

test("a reference is never auto-resolved to a target document id or auto-verified -- always Needs Review with resolution left to the caller", () => {
  const text = "REFER DRAWING NO. 2401232-PC-AMS-T-00-ZZZ-002";
  const result = detectCrossSheetReferences({ sourceDocument: SOURCE, assets: [{ id: "a1", text_content: text }] });
  assert.equal(result[0].resolvedTargetDocumentId, null);
  assert.equal(result[0].governedStatus, "Needs Review");
  assert.equal(result[0].revisionCompatibility, "Unknown");
});

test("a sheet's own drawing number restating itself is not treated as a cross-sheet reference", () => {
  const text = `REFER DWG NO. ${SOURCE.drawingNumber}`;
  const result = detectCrossSheetReferences({ sourceDocument: SOURCE, assets: [{ id: "a1", text_content: text }] });
  assert.equal(result.length, 0);
});

test("plain text with no reference phrase produces no relationships", () => {
  const result = detectCrossSheetReferences({ sourceDocument: SOURCE, assets: [{ id: "a1", text_content: "MAIN FIRE ALARM CONTROL PANEL (MFACP)" }] });
  assert.equal(result.length, 0);
});

test("evidence preserves the source asset id and the exact note text -- provenance is never dropped", () => {
  const text = "REFER DWG NO. 2401232-PC-AMS-T-00-ZZZ-002";
  const result = detectCrossSheetReferences({ sourceDocument: SOURCE, assets: [{ id: "asset-xyz", text_content: text }] });
  assert.equal(result[0].evidence.sourceAssetId, "asset-xyz");
  assert.match(result[0].evidence.noteText, /2401232-PC-AMS-T-00-ZZZ-002/);
});

// Real case (WLC FIRE DETECTION & ALARM SCHEMATIC, doc_3f857096-3152-408f-
// 9c86-9296e4142ced): a composite Legend asset's linearization put the
// "DWG NO. X" callout BEFORE its own "...REFER" note, with an unrelated
// ~386-character title-block strip interleaved between them -- the
// opposite order from every other case in this file, and separated further
// than a short same-sentence window. Detection must not assume either
// order, and must not confuse an intervening unrelated mention (here,
// "FIRE ALARM" from an equipment list) for the reference's own system.
test("reversed order -- 'DWG NO. X' appearing BEFORE its '...REFER' note, separated by unrelated intervening text, is still detected with the real system and number", () => {
  const text =
    "DWG NO. 2401232-PC-AMS-T-00-ZZZ-002\n" +
    "KEY PLAN GENERAL NOTES CLIENT QUALITY CARE EDUCATION COMPANY PROJECT TITLE ALMOOSA K12 " +
    "PROJECT NUMBER STAGE 5 DRAWN SOURCE FILE <2401232-PC-WLC-M3-E-ZZ-ZZZ-001> SHEET TITLE " +
    "FIRE DETECTION & ALARM SCHEMATIC DRAWING NUMBER 2401232-PC-WLC-DR-T-93-ZZZ-005\n" +
    "2401232\n" +
    "NOTES: 1. FOR ELV LEGENDS, GENERAL NOTES & ABBREVIATIONS REFER\n" +
    "1 PAIR TELEPHONE CABLE FOR EACH FIREMAN TELEPHONE JACK";
  const source = { id: "doc-wlc", drawingNumber: "2401232-PC-WLC-DR-T-93-ZZZ-005", sheetName: "FIRE DETECTION & ALARM SCHEMATIC" };
  const result = detectCrossSheetReferences({ sourceDocument: source, pageNumber: 1, assets: [{ id: "legend-blob", text_content: text }] });
  assert.equal(result.length, 1);
  assert.equal(result[0].referencedDrawingNumber, "2401232-PC-AMS-T-00-ZZZ-002");
  assert.equal(result[0].applicableSystem, "ELV");
  assert.match(result[0].evidence.noteText, /2401232-PC-AMS-T-00-ZZZ-002/);
});

test("a wide reversed-order search does not let an unrelated mention past the trigger word masquerade as the reference's system", () => {
  const text = "DWG NO. 2401232-PC-AMS-T-00-ZZZ-002\n" + "x".repeat(40) + "\nFOR ELV LEGENDS REFER\nMAIN FIRE ALARM CONTROL PANEL (MFACP)";
  const result = detectCrossSheetReferences({ sourceDocument: SOURCE, assets: [{ id: "a1", text_content: text }] });
  assert.equal(result[0].applicableSystem, "ELV");
});

const literal = "2401232-PC-AMS-T-00-ZZZ-002";
test("resolution preserves DR and discipline segments, including stale resolution cleanup", () => {
  for (const number of ["2401232-PC-AMS-DR-T-00-ZZZ-002", "2401232-PC-AMS-E-00-ZZZ-002"]) {
    const [result] = resolveCrossSheetReferenceTargets([{ referencedDrawingNumber: literal, resolvedTargetDocumentId: "old", status: "Resolved", applicabilitySource: "removed DR", revisionCompatibility: "Compatible" }], [{ id: "candidate", drawingNumber: number }]);
    assert.equal(result.status, "Unresolved");
    assert.equal(result.resolvedTargetDocumentId, null);
    assert.equal(result.revisionCompatibility, "Unknown");
    assert.match(result.applicabilitySource, /no exact/);
  }
});
test("resolution accepts harmless spacing and case without approving the entry", () => {
  const [result] = resolveCrossSheetReferenceTargets([{ referencedDrawingNumber: literal, governedStatus: "Needs Review" }], [{ id: "target", drawingNumber: "2401232- pc- ams- t-00-zzz-002" }]);
  assert.equal(result.resolvedTargetDocumentId, "target");
  assert.equal(result.governedStatus, "Needs Review");
});
test("ambiguous or empty drawing numbers remain unresolved", () => {
  for (const [number, registry] of [[literal, [{ id: "a", drawingNumber: literal }, { id: "b", drawingNumber: literal }]], ["", [{ id: "a", drawingNumber: "" }]]]) {
    const [result] = resolveCrossSheetReferenceTargets([{ referencedDrawingNumber: number }], registry);
    assert.equal(result.status, "Unresolved");
    assert.equal(result.resolvedTargetDocumentId, null);
  }
});
