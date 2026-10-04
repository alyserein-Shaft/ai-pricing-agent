import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDrawingTitle } from "../app/domain/drawing-title-resolution.mjs";

test("only Drawing Intake has a value -- used as-is", () => {
  const result = resolveDrawingTitle({ intakeSheetName: "FIRE DETECTION & ALARM SCHEMATIC", structuralTitle: null });
  assert.equal(result.value, "FIRE DETECTION & ALARM SCHEMATIC");
  assert.equal(result.source, "Drawing Intake");
});

test("only the Structural Parser has a value -- used as-is", () => {
  const result = resolveDrawingTitle({ intakeSheetName: null, structuralTitle: "FCC ROOM DETAILS" });
  assert.equal(result.value, "FCC ROOM DETAILS");
  assert.equal(result.source, "Structural Parser");
});

test("neither parser produced a value -- no title, not a guess", () => {
  const result = resolveDrawingTitle({ intakeSheetName: null, structuralTitle: null });
  assert.equal(result.value, null);
  assert.equal(result.source, "None");
});

test("both parsers agree (case-insensitive) -- value used, no conflict", () => {
  const result = resolveDrawingTitle({ intakeSheetName: "Fcc Room Details", structuralTitle: "FCC ROOM DETAILS" });
  assert.equal(result.value, "Fcc Room Details");
  assert.equal(result.source, "Agreement");
});

// Real case (WLC FIRE DETECTION & ALARM SCHEMATIC): the Structural Parser's
// independent table-cell reconstruction bled adjacent title-block cells
// into its drawingTitle value -- verbatim other-field labels ("PROJECT
// NUMBER", "SOURCE FILE") appear inside it, evidence of a cross-cell error.
// Drawing Intake's own bounded-adjacency sheet_name was correct. Resolution
// must prefer Drawing Intake here, from that evidence, not confidence.
test("real case: a contaminated Structural Parser title (containing other title-block labels) loses to a clean Drawing Intake value", () => {
  const result = resolveDrawingTitle({
    intakeSheetName: "FIRE DETECTION & ALARM SCHEMATIC",
    structuralTitle: "PROJECT NUMBER 2401232 STAGE 5 AM SOURCE FILE <2401232-PC-WLC-M3-E-ZZ-ZZZ-001 >",
  });
  assert.equal(result.value, "FIRE DETECTION & ALARM SCHEMATIC");
  assert.equal(result.source, "Drawing Intake");
  assert.ok(result.conflict);
});

test("the reverse case also resolves correctly -- a contaminated Drawing Intake value loses to a clean Structural Parser value", () => {
  const result = resolveDrawingTitle({
    intakeSheetName: "PROJECT TITLE ALMOOSA K12 DRAWING NUMBER 2401232",
    structuralTitle: "FCC ROOM DETAILS",
  });
  assert.equal(result.value, "FCC ROOM DETAILS");
  assert.equal(result.source, "Structural Parser");
});

test("both parsers disagree and neither shows contamination -- surfaced as an unresolved conflict, never a guessed side", () => {
  const result = resolveDrawingTitle({ intakeSheetName: "FCC ROOM DETAILS", structuralTitle: "SECURITY RISER SCHEMATIC" });
  assert.equal(result.value, null);
  assert.equal(result.source, "Conflict");
  assert.ok(result.conflict);
});

test("a title legitimately containing the word SHEET is never penalized -- SHEET is excluded from the contamination vocabulary", () => {
  const result = resolveDrawingTitle({ intakeSheetName: "GROUND FLOOR SHEET LAYOUT", structuralTitle: null });
  assert.equal(result.value, "GROUND FLOOR SHEET LAYOUT");
});
