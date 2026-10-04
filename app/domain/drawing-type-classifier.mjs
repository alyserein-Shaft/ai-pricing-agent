// DRAWING INTELLIGENCE -- WORKSTREAM 1: drawing type classification review.
//
// Drawing Intake already computes a whole-sheet classification
// (drawing_document_classifications / DRAWING_CLASSIFICATIONS in
// drawing-intake-engine.mjs) but it is a coarse, often multi-labeled signal
// ("Mixed Drawing" at 90% alongside four weaker co-classifications) --
// real Al Mousa sheets titled "FIRE ALARM SYSTEM CAUSE AND EFFECT MATRIX"
// or "FIRE DETECTION & ALARM SCHEMATIC" score highest as "Mixed Drawing",
// which tells an engineer nothing about which type-specific intelligence
// extractor should run.
//
// This module does NOT re-run OCR or re-classify from scratch -- it
// combines the EXISTING classification signal with the sheet's own
// EXPLICIT title text (drawing_metadata.sheet_name / the title-block
// asset), which is a much stronger, literal signal a drafter wrote
// deliberately. Title text wins when it explicitly names a type; the
// existing classification is the fallback when title text is missing or
// ambiguous. Nothing here ever upgrades a weak/ambiguous signal to a
// confident type -- an unmatched sheet stays "Unknown / Mixed" with
// governedStatus "Needs Review", never guessed.
//
// Pure domain logic: no DOM, no fetch, no DB.

export const DRAWING_TYPE_BUCKETS = Object.freeze([
  "Layout",
  "Riser Diagram",
  "Schematic / Single-Line",
  "Legend / Notes",
  "Cause & Effect",
  "Detail / Enlarged Detail",
  "Schedule",
  "Unknown / Mixed",
]);

// Ordered: first pattern that matches the title wins. Order matters --
// "CAUSE AND EFFECT" must be checked before "SCHEMATIC"/"NOTES" since a
// real sheet title like "FIRE ALARM SYSTEM CAUSE AND EFFECT MATRIX" could
// otherwise be miscategorized by a looser pattern.
const TITLE_RULES = [
  { bucket: "Cause & Effect", pattern: /\bcause\s*(?:and|&)\s*effect\b/i },
  { bucket: "Schedule", pattern: /\bschedule\b/i },
  { bucket: "Legend / Notes", pattern: /\blegend|\babbreviations?\b|\bnotes?\s*(?:and|&)?\s*abbreviation/i },
  { bucket: "Riser Diagram", pattern: /\briser\b|\bnetwork\s*diagram\b|\bsingle\s*line\s*diagram\b|\bsld\b/i },
  { bucket: "Schematic / Single-Line", pattern: /\bschematic\b/i },
  { bucket: "Detail / Enlarged Detail", pattern: /\bdetail(?:s)?\b|\benlarged\b/i },
  { bucket: "Layout", pattern: /\blayout\b|\bfloor\s*plan\b/i },
];

// Fallback mapping from Drawing Intake's own DRAWING_CLASSIFICATIONS
// vocabulary (drawing-intake-engine.mjs) when the title itself doesn't
// name a type explicitly.
const CLASSIFICATION_FALLBACK = {
  "Floor Plan": "Layout",
  "Device Layout": "Layout",
  "Riser Diagram": "Riser Diagram",
  "Single Line Diagram (SLD)": "Riser Diagram",
  "Wiring Diagram": "Schematic / Single-Line",
  "Legend Sheet": "Legend / Notes",
  "Notes Sheet": "Legend / Notes",
  "Installation Detail": "Detail / Enlarged Detail",
  "Typical Detail": "Detail / Enlarged Detail",
  "Sequence of Operation": "Schematic / Single-Line",
  Schedule: "Schedule",
};

// classifications: the drawing_document_classifications rows for this
// sheet's intake version, e.g. [{type:"Mixed Drawing",confidence:90}, ...].
// sheetName: drawing_metadata.sheet_name (the title-block's own title
// field) -- the strongest available signal when present.
export const classifyDrawingType = ({ classifications = [], sheetName = null } = {}) => {
  const title = String(sheetName ?? "").trim();
  if (title) {
    for (const rule of TITLE_RULES) {
      if (rule.pattern.test(title)) {
        return {
          drawingType: rule.bucket,
          confidence: 85,
          evidence: `Explicit sheet title: "${title}"`,
          extractionMethod: "Sheet title keyword match",
          governedStatus: "Verified",
        };
      }
    }
  }

  // No explicit, confident title match -- fall back to the existing
  // whole-sheet classification's strongest recognized entry.
  const ranked = [...classifications].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  for (const entry of ranked) {
    const bucket = CLASSIFICATION_FALLBACK[entry.type];
    if (bucket) {
      return {
        drawingType: bucket,
        confidence: Math.min(entry.confidence ?? 0, 70), // capped -- this is a weaker, indirect signal than an explicit title match
        evidence: `Derived from existing Drawing Intake classification: ${entry.type} (${entry.confidence}%)`,
        extractionMethod: "Fallback from whole-sheet classification",
        governedStatus: "Needs Review",
      };
    }
  }

  return {
    drawingType: "Unknown / Mixed",
    confidence: 0,
    evidence: title ? `Title "${title}" did not match a known drawing-type pattern` : "No sheet title or recognized classification available",
    extractionMethod: "No confident signal",
    governedStatus: "Needs Review",
  };
};

// This module's DRAWING_TYPE_BUCKETS is a coarser "which extractor should
// run on this sheet" vocabulary; drawing-evidence-authority-policy.mjs's
// FIELD_AUTHORITY_TABLE instead expects the SAME literal drawingType
// strings Rule A's table itself uses (which match Drawing Intake's own
// DRAWING_CLASSIFICATIONS, e.g. "Single Line Diagram (SLD)", "Floor
// Plan") -- the two vocabularies are related but not identical, so a
// bucket must be mapped through this table before being passed as
// evaluateDrawingEvidenceAuthority()'s drawingType, never passed directly.
const AUTHORITY_DRAWING_TYPE = {
  Layout: "Floor Plan",
  "Riser Diagram": "Riser Diagram",
  "Schematic / Single-Line": "Single Line Diagram (SLD)",
  "Legend / Notes": "Legend Sheet",
  "Cause & Effect": "Sequence of Operation",
  "Detail / Enlarged Detail": "Installation Detail",
  Schedule: "Schedule",
  "Unknown / Mixed": null,
};

export const mapToAuthorityDrawingType = (bucket) => AUTHORITY_DRAWING_TYPE[bucket] ?? null;
