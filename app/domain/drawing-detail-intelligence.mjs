// DRAWING INTELLIGENCE -- WORKSTREAM 6: detail / enlarged detail
// intelligence.
//
// For Detail-classified sheets: installation/mounting requirement
// candidates (with dimensions treated ONLY as installation evidence, never
// as quantity), the detail's own reference number, and an explicit
// Typical-vs-project-specific flag. A "TYPICAL" detail is never usable as
// actual project quantity evidence unless another sheet explicitly
// references it by number -- this module marks that distinction but does
// not itself resolve the reference (drawing-cross-sheet-references.mjs's
// job).
//
// Pure domain logic: no DOM, no fetch, no DB.

import { evaluateDrawingEvidenceAuthority } from "./drawing-evidence-authority-policy.mjs";
import { mapToAuthorityDrawingType } from "./drawing-type-classifier.mjs";

const trim = (value) => String(value ?? "").trim();

// "MOUNTED AT 1200mm AFFL", "SURFACE MOUNTED", "FLUSH MOUNTED", "MOUNTING
// HEIGHT 2.4m" -- an explicit installation/mounting statement. A nearby
// dimension (mm/m/cm) is captured as installation evidence for THIS
// statement, never as a standalone quantity claim.
const MOUNTING_PATTERN = /\b(SURFACE|FLUSH|WALL|CEILING|RECESSED)?\s*MOUNT(?:ED|ING)?\b/i;
const DIMENSION_PATTERN = /(\d+(?:\.\d+)?)\s*(mm|cm|m)\b/i;

// "DETAIL 3", "DETAIL NO. 3", "TYPICAL DETAIL 5" -- this sheet's own
// detail number.
const DETAIL_NUMBER_PATTERN = /\bDETAIL\s*(?:NO\.?)?\s*(\d+)\b/i;
const TYPICAL_PATTERN = /\bTYPICAL\b|\bTYP\.?\b/i;

const buildMountingProposals = (assets, context) =>
  assets
    .filter((asset) => MOUNTING_PATTERN.test(trim(asset.text_content)))
    .map((asset) => {
      const text = trim(asset.text_content);
      const dimensionMatch = DIMENSION_PATTERN.exec(text);
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "MountingInstallation",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
      });
      return {
        proposalType: "InstallationRequirementCandidate",
        pageNumber: context.pageNumber,
        rawLabel: text,
        mountingDimension: dimensionMatch ? { value: Number(dimensionMatch[1]), unit: dimensionMatch[2].toLowerCase() } : null,
        isTypical: TYPICAL_PATTERN.test(text),
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Mounting/installation text pattern; dimension used as installation evidence only, never quantity",
        evidence: { rawText: text },
        sourceReferences: [asset.id],
      };
    });

const buildDetailReferenceProposals = (assets, context) =>
  assets
    .filter((asset) => DETAIL_NUMBER_PATTERN.test(trim(asset.text_content)))
    .map((asset) => {
      const text = trim(asset.text_content);
      const match = DETAIL_NUMBER_PATTERN.exec(text);
      const isTypical = TYPICAL_PATTERN.test(text);
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "MountingInstallation",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
        // A Typical detail must never be read as actual project quantity
        // evidence without an explicit reference from a project-specific
        // sheet -- forced unconditionally when the "TYPICAL" keyword is
        // present, regardless of how explicit the detail number itself is.
        hardReviewTriggers: isTypical ? ["TYPICAL_DETAIL_AS_QUANTITY"] : [],
      });
      return {
        proposalType: "DetailNumberCandidate",
        pageNumber: context.pageNumber,
        rawLabel: text,
        detailNumber: Number(match[1]),
        isTypical,
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Detail-number text pattern",
        evidence: { rawText: text },
        sourceReferences: [asset.id],
      };
    });

export const buildDetailIntelligence = ({ sourceDocument = {}, pageNumber = null, drawingType = "Detail / Enlarged Detail", assets = [] } = {}) => {
  const context = { sourceDocument, pageNumber, drawingType };
  const textAssets = assets.filter((asset) => asset.asset_type === "Text");
  return {
    installationRequirements: buildMountingProposals(textAssets, context),
    detailNumbers: buildDetailReferenceProposals(textAssets, context),
  };
};
