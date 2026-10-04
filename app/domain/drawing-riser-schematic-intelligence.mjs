// DRAWING INTELLIGENCE -- WORKSTREAM 3: riser / schematic intelligence.
//
// Extracts candidate PanelTag/DeviceTag/Loop/CableSpec/SystemInterface/
// ConnectionCandidate proposals from a Riser/Schematic-classified sheet's
// text evidence. Drawing Intake extracts text only (no vector/line
// geometry pipeline exists anywhere in this codebase -- confirmed while
// building General Drawing Extraction v0) -- so nothing here can ever
// verify a junction dot or a legend-defined line COLOR/style. Every
// ConnectionCandidate is therefore capped at Needs Review unconditionally,
// regardless of how explicit the surrounding text is: Rule C's full
// evidence bar (legend-defined line type, junction convention) requires
// geometry this pipeline does not have. This is the safe, honest
// interpretation of "do not infer system connectivity from geometry alone"
// -- it is also never inferred from mere TEXT alone without at least two
// corroborating signals (explicit tag AND the sheet's own Riser/Schematic
// authority).
//
// Pure domain logic: no DOM, no fetch, no DB.

import { evaluateDrawingEvidenceAuthority } from "./drawing-evidence-authority-policy.mjs";
import { mapToAuthorityDrawingType } from "./drawing-type-classifier.mjs";

const trim = (value) => String(value ?? "").trim();

// "LOOP-3", "LOOP 4", "NAC LOOP" -- this project's own real loop-tag
// convention (verified against real KGS-T-93-005 text).
const LOOP_PATTERN = /^(?:NAC\s+)?LOOP[\s-]?(\d+)?$/i;

// "2 X 1.5 sq.mm CWZ CABLE", "2 X 2.5 sq.mm CWZ FIRE RESISTANT CABLE" --
// this project's own real cable-spec convention (core count x cross-
// section, cable type code).
const CABLE_SPEC_PATTERN = /(\d+)\s*[Xx]\s*([\d.]+)\s*sq\.?\s*mm/i;

// "TO FACP @BOS BUILDING", "TO CIVIL DEFENCE K.S.A." -- an explicit
// destination/source statement, the strongest available textual
// connectivity signal in this pipeline (still not geometry, so still
// capped at Needs Review -- see module header).
const DESTINATION_PATTERN = /^TO\s+([A-Z0-9@.\s]{3,60})$/i;

// "INTERFACE TO PUBLIC ADDRESS & VOICE ALARM SYSTEM" -- an explicit
// cross-system relationship statement.
const INTERFACE_PATTERN = /^INTERFACE\s+TO\s+(.{3,60})$/i;

// A short, isolated device/panel abbreviation token (e.g. "FACP", "CE",
// "WP", "SIM") -- these are real, observed single/double-letter codes on
// this project's schematic sheets, almost certainly keyed to a legend
// defined elsewhere (Rule A: Symbols/abbreviations authority is the
// same-sheet or explicitly-referenced legend, not this extractor).
const SHORT_CODE_PATTERN = /^[A-Z]{1,4}$/;

const buildLoopProposals = (assets, context) =>
  assets
    .filter((asset) => LOOP_PATTERN.test(trim(asset.text_content)))
    .map((asset) => {
      const match = LOOP_PATTERN.exec(trim(asset.text_content));
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "LoopCircuitAssignment",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
      });
      return {
        proposalType: "LoopCandidate",
        pageNumber: context.pageNumber,
        rawLabel: trim(asset.text_content),
        loopNumber: match[1] ? Number(match[1]) : null,
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Loop tag text pattern",
        evidence: { rawText: trim(asset.text_content) },
        sourceReferences: [asset.id],
      };
    });

const buildCableSpecProposals = (assets, context) =>
  assets
    .filter((asset) => CABLE_SPEC_PATTERN.test(trim(asset.text_content)))
    .map((asset) => {
      const text = trim(asset.text_content);
      const match = CABLE_SPEC_PATTERN.exec(text);
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "CableTypeSize",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
      });
      return {
        proposalType: "CableSpecCandidate",
        pageNumber: context.pageNumber,
        rawLabel: text,
        coreCount: Number(match[1]),
        crossSectionSqmm: Number(match[2]),
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Cable specification text pattern (core count x cross-section)",
        evidence: { rawText: text },
        sourceReferences: [asset.id],
      };
    });

const buildInterfaceProposals = (assets, context) =>
  assets
    .filter((asset) => INTERFACE_PATTERN.test(trim(asset.text_content)))
    .map((asset) => {
      const text = trim(asset.text_content);
      const match = INTERFACE_PATTERN.exec(text);
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "SystemConnectivity",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
        // An interface note names a relationship in text, but this
        // pipeline has no line-type/junction geometry to corroborate it --
        // always forced to Needs Review (see module header).
        hardReviewTriggers: ["CROSSING_LINES_NO_JUNCTION"],
      });
      return {
        proposalType: "SystemInterfaceCandidate",
        pageNumber: context.pageNumber,
        rawLabel: text,
        interfacedSystem: trim(match[1]),
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Explicit 'INTERFACE TO <system>' text pattern",
        evidence: { rawText: text },
        sourceReferences: [asset.id],
      };
    });

// A "possible connection" -- an explicit textual destination statement
// ("TO FACP @BOS BUILDING") on a sheet whose type IS the Rule A-authorized
// Primary source for SystemConnectivity. Two signals: (1) correct
// authoritative drawing type, (2) an explicit destination tag. Still never
// reaches Verified: no junction/line-type geometry exists to complete
// Rule C's evidence bar.
const buildConnectionCandidates = (assets, context) =>
  assets
    .filter((asset) => DESTINATION_PATTERN.test(trim(asset.text_content)))
    .map((asset) => {
      const text = trim(asset.text_content);
      const match = DESTINATION_PATTERN.exec(text);
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "SystemConnectivity",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
        corroboratingEvidence: ["explicit textual destination statement"],
        hardReviewTriggers: ["CROSSING_LINES_NO_JUNCTION"],
      });
      return {
        proposalType: "ConnectionCandidate",
        pageNumber: context.pageNumber,
        rawLabel: text,
        destination: trim(match[1]),
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        boundingBox: asset.bounding_box ?? null,
        confidence: asset.detection_confidence ?? null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Explicit 'TO <destination>' text pattern on a Riser/Schematic-authoritative sheet",
        evidence: { rawText: text, signals: ["correct drawing type (Riser/Schematic)", "explicit destination tag"] },
        sourceReferences: [asset.id],
      };
    });

const buildDeviceCodeProposals = (assets, context) => {
  const counts = new Map();
  for (const asset of assets) {
    const text = trim(asset.text_content);
    if (!SHORT_CODE_PATTERN.test(text)) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  // A code repeated 3+ times reads as a real, deliberate device/type code
  // (not a stray one-off OCR fragment) -- still Unverified without the
  // legend that actually defines it (Rule A: legend is the authority for
  // symbols/abbreviations, not this extractor).
  return [...counts.entries()]
    .filter(([, count]) => count >= 3)
    .map(([code, count]) => {
      const authority = evaluateDrawingEvidenceAuthority({
        fieldType: "SymbolsAbbreviations",
        drawingType: mapToAuthorityDrawingType(context.drawingType),
        sourceType: "Drawing",
        applicableLegend: { defined: false },
      });
      return {
        proposalType: "DeviceCodeCandidate",
        pageNumber: context.pageNumber,
        rawLabel: code,
        occurrenceCount: count,
        sourceDocumentId: context.sourceDocument.id ?? null,
        sourceSheet: context.sourceDocument.sheetName ?? null,
        confidence: null,
        authorityRole: authority.authorityRole,
        governedStatus: authority.finalStatus,
        hardReviewReasons: authority.hardReviewReasons,
        extractionMethod: "Repeated short device/type code (>=3 occurrences)",
        evidence: { occurrenceCount: count },
        sourceReferences: [],
      };
    });
};

// sourceDocument: {id, drawingNumber, sheetName}. drawingType: the
// classifyDrawingType() bucket for this sheet (should be "Riser Diagram"
// or "Schematic / Single-Line"). assets: Text assets for this sheet.
export const buildRiserSchematicIntelligence = ({ sourceDocument = {}, pageNumber = null, drawingType = "Schematic / Single-Line", assets = [] } = {}) => {
  const context = { sourceDocument, pageNumber, drawingType };
  const textAssets = assets.filter((asset) => asset.asset_type === "Text");
  return {
    loops: buildLoopProposals(textAssets, context),
    cableSpecs: buildCableSpecProposals(textAssets, context),
    systemInterfaces: buildInterfaceProposals(textAssets, context),
    connectionCandidates: buildConnectionCandidates(textAssets, context),
    deviceCodes: buildDeviceCodeProposals(textAssets, context),
  };
};
