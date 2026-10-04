// DRAWING INTELLIGENCE -- WORKSTREAM 4: layout intelligence.
//
// For Layout-classified sheets: device tag + placement candidates, repeat-
// instance counting, and detail-reference detection. Placement on a real
// Layout drawing IS strong, Primary-authority evidence per Rule A
// (Device placement/location: Primary = Layout drawing) -- unlike a
// callout/schematic inference, an explicit device tag placed on the sheet
// that IS the authoritative source for placement can legitimately reach
// Verified. Connectivity is a hard boundary this module never crosses: it
// produces no connection/topology proposal of any kind, regardless of how
// close two device tags sit to each other.
//
// Pure domain logic: no DOM, no fetch, no DB.

import { evaluateDrawingEvidenceAuthority } from "./drawing-evidence-authority-policy.mjs";
import { mapToAuthorityDrawingType } from "./drawing-type-classifier.mjs";

const trim = (value) => String(value ?? "").trim();

// "SD-01", "MCP-12", "FACP-1" -- a short discipline-prefix + separator +
// number tag, the common device-tagging convention on layout drawings.
const DEVICE_TAG_PATTERN = /^([A-Z]{2,6})[-\s]?(\d{1,3})$/;

// "SEE DETAIL 3", "DETAIL 3/DWG 2401232-...", "REFER TO DETAIL 5" -- an
// explicit reference from a layout to a detail sheet.
const DETAIL_REFERENCE_PATTERN = /\b(?:SEE|REFER(?:\s+TO)?)\s+DETAIL\s+(\d+)/i;

const buildDeviceTagProposals = (assets, context) => {
  const tagged = assets.filter((asset) => DEVICE_TAG_PATTERN.test(trim(asset.text_content)));
  const counts = new Map();
  for (const asset of tagged) counts.set(trim(asset.text_content), (counts.get(trim(asset.text_content)) || 0) + 1);
  return tagged.map((asset) => {
    const text = trim(asset.text_content);
    const match = DEVICE_TAG_PATTERN.exec(text);
    const authority = evaluateDrawingEvidenceAuthority({
      fieldType: "DevicePlacement",
      drawingType: mapToAuthorityDrawingType(context.drawingType),
      sourceType: "Drawing",
    });
    return {
      proposalType: "DevicePlacementCandidate",
      pageNumber: context.pageNumber,
      rawLabel: text,
      devicePrefix: match[1],
      deviceNumber: Number(match[2]),
      repeatedInstanceCount: counts.get(text),
      sourceDocumentId: context.sourceDocument.id ?? null,
      sourceSheet: context.sourceDocument.sheetName ?? null,
      boundingBox: asset.bounding_box ?? null,
      confidence: asset.detection_confidence ?? null,
      authorityRole: authority.authorityRole,
      governedStatus: authority.finalStatus,
      hardReviewReasons: authority.hardReviewReasons,
      extractionMethod: "Device tag text pattern (prefix + number) on a Layout-authoritative sheet",
      evidence: { rawText: text },
      sourceReferences: [asset.id],
    };
  });
};

const buildDetailReferenceProposals = (assets, context) =>
  assets
    .filter((asset) => DETAIL_REFERENCE_PATTERN.test(trim(asset.text_content)))
    .map((asset) => {
      const text = trim(asset.text_content);
      const match = DETAIL_REFERENCE_PATTERN.exec(text);
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "MountingInstallation",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
        // A layout naming a detail is a real reference, but the detail
        // itself (its parent drawing) is not resolved here -- resolution
        // is drawing-cross-sheet-references.mjs's job, and an unresolved
        // reference is never treated as confirmed installation guidance.
        hardReviewTriggers: [],
      });
      return {
        proposalType: "DetailReferenceCandidate",
        pageNumber: context.pageNumber,
        rawLabel: text,
        referencedDetailNumber: Number(match[1]),
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Explicit detail-reference text pattern",
        evidence: { rawText: text },
        sourceReferences: [asset.id],
      };
    });

export const buildLayoutIntelligence = ({ sourceDocument = {}, pageNumber = null, drawingType = "Layout", assets = [] } = {}) => {
  const context = { sourceDocument, pageNumber, drawingType };
  const textAssets = assets.filter((asset) => asset.asset_type === "Text");
  return {
    devicePlacements: buildDeviceTagProposals(textAssets, context),
    detailReferences: buildDetailReferenceProposals(textAssets, context),
  };
};
