// DRAWING INTELLIGENCE -- WORKSTREAM 2: legend / notes intelligence.
//
// Drawing Intake ALREADY extracts legend entries (drawing_legends /
// drawing_legend_entries, see drawing-intake-engine.mjs's isLegend branch)
// and numbered general-note lines (as individual "Text" assets). This
// module does NOT re-extract from the PDF -- it is a governance layer that
// normalizes that EXISTING, already-persisted evidence into proposals
// carrying authority/status, exactly like drawing-general-extraction-
// engine.mjs does for schedule rows. Reuse, not reinvention.
//
// Rule B (Cross-Sheet Applicability): a legend is scoped to the sheet that
// defines it (or explicitly-referenced sheets) -- never applied globally.
// Every proposal here carries applicableSystem/applicableDrawingTypes
// fields precisely so a caller can enforce that scoping; this module never
// asserts "applies everywhere."

import { evaluateDrawingEvidenceAuthority } from "./drawing-evidence-authority-policy.mjs";

const trim = (value) => String(value ?? "").trim();

const SYSTEM_KEYWORDS = [
  { system: "Fire Alarm", pattern: /\bfire\s*alarm\b|\bfas\b/i },
  { system: "CCTV", pattern: /\bcctv\b/i },
  { system: "ELV", pattern: /\belv\b/i },
  { system: "BMS", pattern: /\bbms\b/i },
  { system: "IT/Security", pattern: /\bit\s*&\s*security\b|\bdata\s*outlet\b|\bcat6a\b/i },
];
const detectSystem = (text) => SYSTEM_KEYWORDS.find(({ pattern }) => pattern.test(text))?.system || null;

// legendEntries: drawing_legend_entries rows for one legend (already
// persisted, real data) -- {sequence, entry_type, label, description,
// confidence}. sourceDocument: {id, drawingNumber, sheetName}. pageNumber:
// the legend's own page. Every entry becomes one LegendDefinition proposal
// -- same-sheet legend is always Primary authority for SymbolsAbbreviations
// per Rule A.
export const buildLegendDefinitionProposals = ({ sourceDocument = {}, pageNumber = null, legendEntries = [], legendConfidence = null } = {}) =>
  legendEntries.map((entry) => {
    const rawText = `${trim(entry.label)} ${trim(entry.description)}`.trim();
    const system = entry.visualExtraction ? entry.applicableSystem : detectSystem(rawText);
    const authority = evaluateDrawingEvidenceAuthority({
      fieldType: "SymbolsAbbreviations",
      drawingType: "Legend Sheet",
      sourceType: "Drawing",
      applicableLegend: { defined: true, sheetSpecific: true },
    });
    return {
      proposalType: "LegendDefinition",
      pageNumber,
      rawLabel: trim(entry.label),
      normalizedMeaning: trim(entry.description),
      entryType: entry.entry_type || "Abbreviation",
      applicableSystem: system,
      // Rule B baseline: a legend applies to the sheet that defines it --
      // widened only to a named system when the entry text itself
      // identifies one, never to "the whole project."
      applicableDrawingTypes: system ? [system, "same sheet"] : ["same sheet"],
      applicabilityStatus: system ? `Scoped to ${system} drawings` : "Scoped to this sheet",
      sourceDocumentId: sourceDocument.id ?? null,
      sourceDrawingNumber: sourceDocument.drawingNumber ?? null,
      sourceSheet: sourceDocument.sheetName ?? null,
      confidence: legendConfidence ?? entry.confidence ?? null,
      authorityRole: authority.authorityRole,
      governedStatus: entry.visualExtraction ? "Needs Review" : authority.finalStatus,
      hardReviewReasons: entry.visualExtraction ? ["Visual legend transcription requires human review; cross-sheet applicability is not established."] : authority.hardReviewReasons,
      boundingBox: entry.boundingBox ?? null,
      extractionMethod: entry.visualExtraction ? "Visual Fire Alarm legend row transcription" : "Existing Drawing Intake legend-entry extraction (drawing_legend_entries)",
      evidence: { sequence: entry.sequence, rawLabel: entry.label, rawDescription: entry.description, ...(entry.visualExtraction ? { section: entry.section, qualifiers: entry.qualifiers, sourceDocumentVersionId: entry.sourceDocumentVersionId, boundingBox: entry.boundingBox, symbolBoundingBox: entry.symbolBoundingBox, imageProvenance: entry.imageProvenance, registerRevision: entry.registerRevision, visuallyExtractedRevision: entry.visuallyExtractedRevision, visualRunId: entry.visualRunId } : {}) },
      sourceReferences: entry.id ? [entry.id] : [],
    };
  });

// General notes: numbered "N. <text>" lines already extracted as
// individual Text assets by Drawing Intake (same asset_type:"Text"
// convention drawing-general-extraction-engine.mjs already relies on).
// This produces GeneralNote proposals -- Needs Review by default (a plain
// note is not, on its own, an authoritative technical requirement; Rule A's
// TechnicalRequirements table names Specification as Primary, general
// notes as Verification only).
const NUMBERED_NOTE = /^(\d{1,2})\.\s*(.{4,})$/;

// "1." alone, as its own text run -- the SAME split convention the
// numbered equipment schedule uses (see drawing-general-extraction-
// engine.mjs's detectScheduleColumns/isRowPair): the leading number and
// its note text are frequently two SEPARATE adjacent Text assets, not one
// combined string (verified against the real AMS ELV Legends/Notes sheet).
const BARE_NUMBER = /^(\d{1,2})\.$/;

const buildNoteProposal = ({ sourceDocument, pageNumber, noteNumber, text, boundingBox, confidence, sourceReferences }) => {
  const system = detectSystem(text);
  const authority = evaluateDrawingEvidenceAuthority({
    fieldType: "TechnicalRequirements",
    drawingType: "Notes Sheet",
    sourceType: "Drawing",
  });
  return {
    proposalType: "GeneralNote",
    pageNumber,
    noteNumber,
    normalizedMeaning: trim(text),
    applicableSystem: system,
    applicabilityStatus: system ? `Scoped to ${system} drawings` : "Scoped to this sheet",
    sourceDocumentId: sourceDocument.id ?? null,
    sourceDrawingNumber: sourceDocument.drawingNumber ?? null,
    sourceSheet: sourceDocument.sheetName ?? null,
    boundingBox: boundingBox ?? null,
    confidence: confidence ?? null,
    authorityRole: authority.authorityRole,
    governedStatus: authority.finalStatus,
    hardReviewReasons: authority.hardReviewReasons,
    extractionMethod: "Numbered general-note line pattern",
    evidence: { rawText: text },
    sourceReferences,
  };
};

// A bare number's plausible note-text partner: the closest OTHER text
// asset on (approximately) the same row, to its right -- same proximity
// test as the schedule engine's isRowPair, generalized here without
// requiring a repeating 3+ row column (a notes list may be short).
const isSameRowPartner = (numberAsset, candidate) => {
  const rowHeight = Math.max(numberAsset.bounding_box?.height || 0, candidate.bounding_box?.height || 0, 4);
  if (!numberAsset.bounding_box || !candidate.bounding_box) return false;
  const yGap = Math.abs(numberAsset.bounding_box.y - candidate.bounding_box.y);
  if (yGap > rowHeight * 0.75) return false;
  const xGap = candidate.bounding_box.x - (numberAsset.bounding_box.x + numberAsset.bounding_box.width);
  return xGap >= 0 && xGap <= rowHeight * 40;
};

export const buildGeneralNoteProposals = ({ sourceDocument = {}, pageNumber = null, assets = [] } = {}) => {
  const notes = [];
  const textAssets = assets.filter((asset) => asset.asset_type === "Text");
  const consumed = new Set();

  // Pass 1: already-combined "N. <text>" single-asset lines.
  for (const asset of textAssets) {
    const text = trim(asset.text_content);
    const match = NUMBERED_NOTE.exec(text);
    if (!match) continue;
    consumed.add(asset.id);
    notes.push(
      buildNoteProposal({
        sourceDocument,
        pageNumber,
        noteNumber: Number(match[1]),
        text: match[2],
        boundingBox: asset.bounding_box,
        confidence: asset.detection_confidence,
        sourceReferences: [asset.id],
      }),
    );
  }

  // Pass 2: split "N." + note-text pairs across two adjacent assets.
  for (const numberAsset of textAssets) {
    if (consumed.has(numberAsset.id)) continue;
    const match = BARE_NUMBER.exec(trim(numberAsset.text_content));
    if (!match) continue;
    let best = null;
    let bestGap = Infinity;
    for (const candidate of textAssets) {
      if (candidate === numberAsset || consumed.has(candidate.id)) continue;
      if (!isSameRowPartner(numberAsset, candidate)) continue;
      const gap = candidate.bounding_box.x - numberAsset.bounding_box.x;
      if (gap < bestGap) {
        bestGap = gap;
        best = candidate;
      }
    }
    if (!best) continue;
    consumed.add(numberAsset.id);
    consumed.add(best.id);
    notes.push(
      buildNoteProposal({
        sourceDocument,
        pageNumber,
        noteNumber: Number(match[1]),
        text: trim(best.text_content),
        boundingBox: best.bounding_box,
        confidence: best.detection_confidence,
        sourceReferences: [numberAsset.id, best.id],
      }),
    );
  }

  return notes;
};

// Top-level orchestrator for one Legend/Notes-classified sheet.
export const buildLegendNotesIntelligence = ({ sourceDocument = {}, pageNumber = null, assets = [], legendEntries = [], legendConfidence = null } = {}) => ({
  legendDefinitions: buildLegendDefinitionProposals({ sourceDocument, pageNumber, legendEntries, legendConfidence }),
  generalNotes: buildGeneralNoteProposals({ sourceDocument, pageNumber, assets }),
});

// Symbol/description column pairing for delimiter-free legend tables.
//
// REUSABLE PARSER REPAIR: intake legend detection only fires on delimited
// (" - ", ":", "=") lines under an explicit legend heading. Fire-alarm
// symbol legends are commonly laid out as a SYMBOL row with a DESCRIPTION
// row directly beneath, column-aligned, with no delimiters at all -- so the
// intake branch never fires and no legend entries exist to govern. This
// function recovers those pairs deterministically from persisted text
// geometry: a single-token symbol asset paired with the nearest multi-word
// description asset below it in the same column. No delimiters, no headings,
// no guessing: unpaired symbols stay unpaired, shared descriptions are never
// double-assigned, and nothing here approves or governs anything.
const isSymbolToken = (text) => /^[A-Za-z0-9+]{1,4}$/.test(String(text ?? "").trim());
const isDescriptionText = (text) => String(text ?? "").trim().split(/\s+/).length >= 2;

export const pairLegendSymbolDescriptions = ({ assets = [], dyMin = 15, dyMax = 140, dxMax = 25 } = {}) => {
  const texts = (assets || []).filter((a) => a && typeof a.text === "string" && a.boundingBox
    && Number.isFinite(a.boundingBox.x) && Number.isFinite(a.boundingBox.y));
  const symbols = texts
    .filter((a) => isSymbolToken(a.text))
    .sort((a, b) => a.boundingBox.x - b.boundingBox.x);
  const descriptions = texts.filter((a) => isDescriptionText(a.text));
  const used = new Set();
  const pairs = [];
  // Column rule: a description belongs to the symbol column whose center-x is
  // closest to the description's LEFT edge. Description centers are meaningless
  // for wide text; center-distance pairing demonstrably shifts every column by
  // one. Left-edge proximity is the deterministic column signal.
  for (const symbol of symbols) {
    const scx = symbol.boundingBox.x + symbol.boundingBox.width / 2;
    let best = null;
    for (const desc of descriptions) {
      if (used.has(desc.id)) continue;
      const dy = desc.boundingBox.y - symbol.boundingBox.y;
      if (dy < dyMin || dy > dyMax) continue;
      const dx = Math.abs(desc.boundingBox.x - scx);
      if (dx > dxMax) continue;
      const score = dy * 4 + dx;
      if (!best || score < best.score) best = { desc, score };
    }
    if (best) {
      used.add(best.desc.id);
      pairs.push({
        symbol: symbol.text.trim(),
        symbolAssetId: symbol.id ?? null,
        symbolBbox: symbol.boundingBox,
        description: best.desc.text.trim(),
        descriptionAssetId: best.desc.id ?? null,
        descriptionBbox: best.desc.boundingBox,
      });
    }
  }
  return pairs;
};
