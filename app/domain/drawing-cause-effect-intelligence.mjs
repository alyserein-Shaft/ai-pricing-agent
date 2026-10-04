// DRAWING INTELLIGENCE -- WORKSTREAM 5: cause & effect intelligence.
//
// For Cause & Effect-classified sheets: row/column header candidates and
// explicit input->action relationship statements. A real cause-and-effect
// matrix is usually drawn as a GRID (row/column headers with filled/marked
// cells) -- Drawing Intake's text extraction captures readable text, not
// the grid's own cell-fill graphics, so a blank or graphically-marked cell
// with no text of its own produces NO evidence at all here. This module
// never treats that absence as either "no relationship" or "a
// relationship" -- it simply has nothing to propose for that cell. Only an
// EXPLICIT textual relationship statement (a real sentence naming the
// initiating condition and the resulting action) becomes a proposal.
// Any life-safety functional inference is always Needs Review -- see
// LIFE_SAFETY_OR_CODE_COMPLIANCE, forced unconditionally below.
//
// Pure domain logic: no DOM, no fetch, no DB.

import { evaluateDrawingEvidenceAuthority } from "./drawing-evidence-authority-policy.mjs";
import { mapToAuthorityDrawingType } from "./drawing-type-classifier.mjs";
import { TITLE_BLOCK_LABELS, isTitleBlockLabelAdjacent } from "./drawing-general-extraction-engine.mjs";

const trim = (value) => String(value ?? "").trim();

// The title block's own field grid (labels like "STAGE"/"SCALE" and their
// values) is ALSO short, uppercase, and row/column-aligned -- exactly the
// same shape a real matrix header has. Reusing the same exclusion
// General Drawing Extraction already relies on (WORKSTREAM 1 there)
// prevents this module from re-detecting the title block as a fake
// "cause & effect matrix" -- verified against a real Al Mousa sheet where,
// without this exclusion, all 28 "headers" found were title-block noise.
const isTitleBlockNoise = (asset, pageAssets) =>
  TITLE_BLOCK_LABELS.includes(trim(asset.text_content).toUpperCase()) || isTitleBlockLabelAdjacent(asset, pageAssets);

// "SMOKE DETECTOR ACTIVATION SHUTS DOWN AHU-01", "MANUAL CALL POINT
// TRIGGERS EVACUATION ALARM" -- an explicit cause->effect statement using
// a real relational verb. Two capitalized phrases joined by a recognized
// relational verb.
const RELATION_VERBS = ["ACTIVATES", "TRIGGERS", "INITIATES", "SHUTS DOWN", "STOPS", "OPENS", "CLOSES", "DE-ENERGI[SZ]ES", "ENERGI[SZ]ES", "RELEASES", "SOUNDS"];
const RELATION_PATTERN = new RegExp(`^(.{4,60}?)\\s+(?:${RELATION_VERBS.join("|")})\\s+(.{4,60})$`, "i");

// A short (<=3 word), mostly-uppercase label repeated 3+ times in a
// consistent row or column position -- the same generic alignment
// heuristic drawing-general-extraction-engine.mjs uses for schedule
// columns, reused here for header detection instead of number+description
// pairing (see detectScheduleColumns there for the original pattern this
// is adapted from).
const isHeaderLikeLabel = (text) => {
  const trimmed = trim(text);
  if (trimmed.length < 2 || trimmed.length > 40) return false;
  const words = trimmed.split(/\s+/);
  if (words.length > 4) return false;
  return /^[A-Z0-9][A-Z0-9\s\-/&]*$/.test(trimmed);
};

const buildHeaderCandidates = (assets, context) => {
  const candidates = assets.filter((asset) => isHeaderLikeLabel(asset.text_content) && !isTitleBlockNoise(asset, assets));
  // Group by rounded x (column alignment) and by rounded y (row alignment);
  // a label counted in either group 3+ times is a plausible header.
  const byX = new Map();
  const byY = new Map();
  for (const asset of candidates) {
    if (!asset.bounding_box) continue;
    const xKey = Math.round(asset.bounding_box.x / 20);
    const yKey = Math.round(asset.bounding_box.y / 20);
    (byX.get(xKey) || byX.set(xKey, []).get(xKey)).push(asset);
    (byY.get(yKey) || byY.set(yKey, []).get(yKey)).push(asset);
  }
  const headerAssetIds = new Set();
  for (const group of [...byX.values(), ...byY.values()]) if (group.length >= 3) for (const asset of group) headerAssetIds.add(asset.id);

  return candidates
    .filter((asset) => headerAssetIds.has(asset.id))
    .map((asset) => {
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "FunctionalOperation",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
        explicit: false, // a header candidate is a structural inference (repeated alignment), not an explicitly-labeled fact
      });
      return {
        proposalType: "MatrixHeaderCandidate",
        pageNumber: context.pageNumber,
        rawLabel: trim(asset.text_content),
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Repeated row/column-aligned short label (>=3 occurrences)",
        evidence: { rawText: trim(asset.text_content) },
        sourceReferences: [asset.id],
      };
    });
};

const buildRelationshipProposals = (assets, context) =>
  assets
    .filter((asset) => RELATION_PATTERN.test(trim(asset.text_content)))
    .map((asset) => {
      const text = trim(asset.text_content);
      const match = RELATION_PATTERN.exec(text);
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "FunctionalOperation",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
        // Any life-safety / cause-and-effect functional inference is
        // always Needs Review unless it is the sheet's own explicit,
        // unambiguous text -- forced unconditionally here since this
        // module has no way to confirm it against the actual Sequence of
        // Operation / I/O schedule (Rule E's LIFE_SAFETY_OR_CODE_COMPLIANCE).
        hardReviewTriggers: ["LIFE_SAFETY_OR_CODE_COMPLIANCE"],
      });
      return {
        proposalType: "MatrixRelationshipCandidate",
        pageNumber: context.pageNumber,
        rawLabel: text,
        initiatingCondition: trim(match[1]),
        resultingAction: trim(match[2]),
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Explicit cause->effect relational-verb text pattern",
        evidence: { rawText: text },
        sourceReferences: [asset.id],
      };
    });

export const buildCauseEffectIntelligence = ({ sourceDocument = {}, pageNumber = null, drawingType = "Cause & Effect", assets = [] } = {}) => {
  const context = { sourceDocument, pageNumber, drawingType };
  // isTitleBlockLabelAdjacent (reused from drawing-general-extraction-
  // engine.mjs) expects each asset to carry .boundingBox -- the same alias
  // that engine's own orchestrator adds before calling it.
  const textAssets = assets
    .filter((asset) => asset.asset_type === "Text")
    .map((asset) => ({ ...asset, boundingBox: asset.bounding_box }));
  return {
    headers: buildHeaderCandidates(textAssets, context),
    relationships: buildRelationshipProposals(textAssets, context),
  };
};
