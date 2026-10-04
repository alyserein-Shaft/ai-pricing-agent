// Source-Backed Drawing Understanding pilot: Drawing Intake and the
// Structural Parser each independently extract a sheet title, and on some
// real title-block layouts they disagree -- the Structural Parser's own
// table-cell reconstruction can mis-associate a "SHEET TITLE" header with a
// neighboring column's value, producing a title that is actually a splice
// of several OTHER fields' labels and values from the same title-block row
// (observed real case: "PROJECT NUMBER 2401232 STAGE 5 AM SOURCE FILE
// <...>" -- a genuine title never legitimately contains "PROJECT NUMBER" or
// "SOURCE FILE", since those are themselves OTHER fields' labels in the
// same row).
//
// This resolves that disagreement from source evidence, not confidence:
// TITLE_BLOCK_LABELS is the same drawing-agnostic AEC title-block label
// vocabulary already used elsewhere (drawing-general-extraction-engine.mjs)
// to recognize a title-block field label on ANY sheet -- reused here, not
// duplicated, so this check stays generic rather than tuned to one drawing.
// Pure domain logic: no DOM, no fetch, no React. Safe to unit test directly.
import { TITLE_BLOCK_LABELS } from "./drawing-general-extraction-engine.mjs";

// "SHEET" legitimately overlaps a real title (e.g. "SHEET TITLE" as a
// descriptive phrase within the title itself, or "GROUND FLOOR SHEET"), so
// it is excluded from the contamination vocabulary to avoid penalizing a
// genuine value for sharing one common word with its own label family.
const CONTAMINATION_LABELS = TITLE_BLOCK_LABELS.filter((label) => label !== "SHEET");

const countOtherFieldLabels = (value) => {
  if (!value) return 0;
  const upper = value.toUpperCase();
  return CONTAMINATION_LABELS.filter((label) => upper.includes(label)).length;
};

// intakeSheetName: Drawing Intake's own drawing_metadata.sheet_name (a
// bounded horizontal/vertical-adjacency extraction, gap- and label-stop-
// capped -- see app/domain/drawing-intake-engine.mjs).
// structuralTitle: the Structural Parser's sheetIdentities[0].fields
// .drawingTitle.value (an independent title-block table-cell
// reconstruction -- see drawing_structure_versions).
// Returns { value, source, reason, conflict? } -- value is null only when
// neither parser produced anything, or both/neither show contamination
// evidence and there is no source-evidence basis to prefer one over the
// other (a real, surfaced conflict, never silently guessed).
export const resolveDrawingTitle = ({ intakeSheetName, structuralTitle } = {}) => {
  const intake = typeof intakeSheetName === "string" && intakeSheetName.trim() ? intakeSheetName.trim() : null;
  const structural = typeof structuralTitle === "string" && structuralTitle.trim() ? structuralTitle.trim() : null;

  if (!intake && !structural)
    return { value: null, source: "None", reason: "Neither Drawing Intake nor the Structural Parser extracted a sheet title." };
  if (intake && !structural)
    return { value: intake, source: "Drawing Intake", reason: "Only Drawing Intake's own extraction produced a value." };
  if (!intake && structural)
    return { value: structural, source: "Structural Parser", reason: "Only the Structural Parser's table reconstruction produced a value." };
  if (intake.toLowerCase() === structural.toLowerCase())
    return { value: intake, source: "Agreement", reason: "Drawing Intake and the Structural Parser independently agree." };

  const intakeContamination = countOtherFieldLabels(intake);
  const structuralContamination = countOtherFieldLabels(structural);

  if (structuralContamination > 0 && intakeContamination === 0) {
    return {
      value: intake,
      source: "Drawing Intake",
      reason: `The Structural Parser's value contains ${structuralContamination} other title-block label word(s) (e.g. "PROJECT NUMBER", "SOURCE FILE") -- evidence of a cross-cell reconstruction error, not a genuine title. Drawing Intake's bounded-adjacency extraction is preferred.`,
      conflict: { intake, structural },
    };
  }
  if (intakeContamination > 0 && structuralContamination === 0) {
    return {
      value: structural,
      source: "Structural Parser",
      reason: `Drawing Intake's value contains ${intakeContamination} other title-block label word(s), the same contamination signature; the Structural Parser's value does not.`,
      conflict: { intake, structural },
    };
  }
  return {
    value: null,
    source: "Conflict",
    reason: "Drawing Intake and the Structural Parser disagree and neither value shows independent contamination evidence favoring one over the other.",
    conflict: { intake, structural },
  };
};
