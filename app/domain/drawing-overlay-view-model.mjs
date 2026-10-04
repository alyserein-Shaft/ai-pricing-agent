// AUTOMATIC-ASSISTED DRAWING REVIEW v0 -- overlay view model.
//
// Visual Review does not introduce a new persisted evidence schema. It
// reuses the FOUR real evidence sources that already exist and are already
// governed elsewhere in this app:
//   (A) Drawing Intake text assets      (worker/drawing-intake-api.mjs)
//   (B) Symbol occurrences (matched)    (worker/drawing-symbol-recognition-api.mjs)
//   (C) Symbol occurrences (unmatched)  -- same table, definition_id IS NULL
//   (D) Structural regions              (worker/drawing-structural-parser-api.mjs)
//
// This file is the ONE place that normalizes those four shapes into a
// single flat view model the Visual Review canvas can render and filter.
// It is a frontend-only presentation view -- normalizing here creates no
// new authoritative record and changes no review state. Every item keeps a
// `sourceEntity` pointer back to its real backend row so the inspector can
// invoke (or link to) the SAME governed review actions that already exist
// for that row; nothing here invents a new review action or a new
// authoritative status. See drawing-coordinate-mapper.mjs for the
// canonical bounding-box convention every `boundingBox` field below uses.
//
// Pure domain logic: no DOM, no React, no fetch. Safe to unit test directly.

import { textItemCanonicalBox } from "./drawing-coordinate-mapper.mjs";

const clampConfidence = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(100, Math.max(0, number));
};

const truncate = (text, max = 80) => {
  const value = String(text ?? "").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
};

// (A) Drawing Intake text/title-block/north-arrow assets. Assets carry
// page_id, not page_number -- pages[] (drawing_pages rows) is the only
// place that mapping exists, so it is required here.
const buildAssetItems = (assets, pages) => {
  const pageNumberById = new Map((pages || []).map((page) => [page.id, page.page_number]));
  return (assets || [])
    .filter((asset) => asset.bounding_box && asset.coordinates_available)
    .map((asset) => ({
      id: `asset:${asset.id}`,
      pageNumber: pageNumberById.get(asset.page_id) ?? null,
      sourceType: "Text",
      semanticType: asset.asset_type || "Text",
      label: truncate(asset.text_content || asset.asset_type || "Text"),
      confidence: clampConfidence(asset.detection_confidence),
      reviewStatus: asset.review_status || "Needs Review",
      boundingBox: asset.bounding_box,
      extractionMethod: asset.detection_method || null,
      evidence: { textContent: asset.text_content || null },
      sourceEntity: { kind: "drawing-asset", id: asset.id },
    }))
    .filter((item) => item.pageNumber !== null);
};

// (B)/(C) Symbol occurrences. A single `occurrences` array covers both --
// definition_id present means matched against an explicit legend
// definition (B); definition_id null means unmatched (C, "Unknown
// Symbol"). This mirrors exactly how the existing Symbol Review UI derives
// its own "Unknown Symbols" list (unknownSymbols is filtered from this
// same occurrences array server-side) -- there is no separate table.
// Where an occurrence's bounding_box came from, read off the shape_signature
// forms drawing-symbol-recognition-engine.mjs writes: `text:<tag>` for boxes
// taken from PDF text items, `shape:<hash>` for native vector paths, and
// `<n>:fuzzy:...` for clusters of vector fragments. Anything else is unknown.
const occurrenceBoxOrigin = (shapeSignature) => {
  const signature = String(shapeSignature ?? "");
  if (signature.startsWith("text:")) return "pdf-text";
  if (signature.startsWith("shape:") || /^\d+:fuzzy:/.test(signature)) return "vector-path";
  return null;
};

// A TextTag occurrence's tag text (from its `text:<TAG>` signature) and the
// baseline anchor the engine encoded in its occurrence_key
// ("<page>:text[-composed]:<TAG>:<x>:<y>:<n>", x/y = the tag's baseline origin
// or, for a composed tag, the minimum of its tokens' origins). Only present for
// text-derived occurrences; this is what verifyTextTagHighlight checks against.
const occurrenceTagEvidence = (occurrence) => {
  const signature = String(occurrence.shape_signature ?? "");
  if (!signature.startsWith("text:")) return {};
  const match = /:text(?:-composed)?:.+:(-?[0-9.]+(?:e[-+]?[0-9]+)?):(-?[0-9.]+(?:e[-+]?[0-9]+)?):[0-9]+$/.exec(String(occurrence.occurrence_key ?? ""));
  const x = match ? Number(match[1]) : NaN;
  const y = match ? Number(match[2]) : NaN;
  return {
    tagText: signature.slice("text:".length),
    tagAnchor: Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null,
  };
};

const buildOccurrenceItems = (occurrences) =>
  (occurrences || [])
    .filter((occurrence) => occurrence.bounding_box)
    .map((occurrence) => {
      const matched = Boolean(occurrence.definition_id);
      const label = matched
        ? occurrence.explicit_label || occurrence.abbreviation || "Matched symbol"
        : occurrence.nearby_text
          ? `Unknown symbol · ${truncate(occurrence.nearby_text, 40)}`
          : "Unknown symbol";
      return {
        id: `occurrence:${occurrence.id}`,
        pageNumber: occurrence.page_number,
        sourceType: matched ? "Symbol" : "UnknownSymbol",
        semanticType: matched ? "Symbol Occurrence" : "Unknown Symbol Occurrence",
        label: truncate(label),
        confidence: clampConfidence(occurrence.confidence),
        reviewStatus: occurrence.review_status || "Needs Review",
        boundingBox: occurrence.bounding_box,
        boxOrigin: occurrenceBoxOrigin(occurrence.shape_signature),
        extractionMethod: occurrence.match_basis || null,
        evidence: {
          ...occurrenceTagEvidence(occurrence),
          nearbyText: occurrence.nearby_text || null,
          matchBasis: occurrence.match_basis || null,
          abbreviation: occurrence.abbreviation || null,
          explicitLabel: occurrence.explicit_label || null,
          description: occurrence.description || null,
          scoreComponents: occurrence.score_components || null,
        },
        sourceEntity: { kind: "symbol-occurrence", id: occurrence.id, definitionId: occurrence.definition_id || null },
      };
    });

// (D) Structural regions -- table/legend/title-block/etc. regions detected
// by the Structural Parser, each with its own bounding box, independent of
// the table/row/cell geometry those regions may go on to seed.
const buildRegionItems = (regions) =>
  (regions || [])
    .filter((region) => region.bounding_box)
    .map((region) => ({
      id: `region:${region.id}`,
      pageNumber: region.page_number,
      sourceType: "Structure",
      semanticType: region.region_type || "Region",
      label: truncate(region.raw_content || region.region_type || "Structural region"),
      confidence: clampConfidence(region.confidence),
      reviewStatus: region.review_status || "Needs Review",
      boundingBox: region.bounding_box,
      extractionMethod: region.detection_method || null,
      evidence: { rawContent: region.raw_content || null },
      sourceEntity: { kind: "structure-region", id: region.id },
    }));

// Combines all four sources into one flat, page-tagged list. Callers filter
// by pageNumber and sourceType for display; nothing here decides what is
// visible -- that is a pure UI concern the Visual Review component owns.
export const buildDrawingOverlayItems = ({ pages = [], assets = [], occurrences = [], regions = [] } = {}) => [
  ...buildAssetItems(assets, pages),
  ...buildOccurrenceItems(occurrences),
  ...buildRegionItems(regions),
];

// The four filter categories the Visual Review UI's toggles operate on --
// kept here (not re-declared in the component) so the pure normalization
// and the pure filtering logic share one vocabulary.
export const DRAWING_OVERLAY_SOURCE_TYPES = Object.freeze(["Text", "Symbol", "UnknownSymbol", "Structure"]);

// Whether a selected item's stored box must be checked live against the PDF's
// own text transforms before it is highlighted (see DrawingVisualReviewPanel's
// unverifiedHighlight). Only a box built from a raw PDF text item's
// width/height can be distorted by the angle that text is drawn at. An
// occurrence recognised from vector path geometry has a box computed from the
// path and its CTM, so a nearby rotated text run says nothing about it -- on a
// /Rotate 90 sheet such a check otherwise matches unrelated tag letters and
// withholds a correct box. Unknown origin keeps the check (never assumed safe).
export const highlightBoxNeedsPdfTextCheck = (item) => highlightVerificationMode(item) !== "none";

// Which live check a selected item's highlight must pass before it is drawn:
//   "none"         -- vector-path boxes (computed from path + CTM, never text);
//   "tag-geometry" -- TextTag occurrences, whose box comes from PDF text and is
//                     verified geometrically (verifyTextTagHighlight);
//   "text-angle"   -- anything else of unknown/legacy text origin (e.g. Drawing
//                     Intake assets, still built as {x:e,y:f,width,height}) keeps
//                     the older rotated-text guard in DrawingVisualReviewPanel.
export const highlightVerificationMode = (item) =>
  item?.boxOrigin === "vector-path" ? "none" : item?.boxOrigin === "pdf-text" ? "tag-geometry" : "text-angle";

// Stored-vs-glyph tolerance, in PDF points. The engine and the viewer compute
// the same textItemCanonicalBox from the same pdf.js text items (identical
// output across pdf.js builds), and bounding boxes persist as full-precision
// JSON numbers, so the only slack needed is floating-point noise -- far below
// a glyph (>= ~3.7pt on real sheets) or any displaced/partial box.
export const TEXT_TAG_EDGE_TOLERANCE = 0.01;

const normalizeTagToken = (value) => String(value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// Does this TextTag occurrence's stored box match the glyph extent of the tag
// it was recognised from? Identity comes from the occurrence itself (its
// `text:<TAG>` signature and the baseline anchor in its occurrence_key); the
// glyph geometry comes from the page's own pdf.js text items. Rotation is never
// a reason to reject -- only geometry is. Any missing evidence fails closed.
export const verifyTextTagHighlight = (item, textItems, pageView) => {
  const box = item?.boundingBox;
  const anchor = item?.evidence?.tagAnchor;
  const tokens = String(item?.evidence?.tagText || "").trim().split(/\s+/).map(normalizeTagToken).filter(Boolean);
  if (!box || !anchor || !tokens.length) return { valid: false, reason: "missing-tag-evidence" };
  const originX = Number(pageView?.[0] || 0);
  const originY = Number(pageView?.[1] || 0);
  const glyphs = (textItems || [])
    .filter((raw) => raw && Array.isArray(raw.transform) && normalizeTagToken(raw.str))
    .map((raw) => ({
      token: normalizeTagToken(raw.str),
      originX: Number(raw.transform[4] || 0) - originX,
      originY: Number(raw.transform[5] || 0) - originY,
      box: textItemCanonicalBox(raw.transform, raw.width, raw.height, originX, originY),
    }));
  const chosen = [];
  for (const token of tokens) {
    const nearest = glyphs
      .filter((glyph) => glyph.token === token && !chosen.includes(glyph))
      .sort((p, q) => Math.hypot(p.originX - anchor.x, p.originY - anchor.y) - Math.hypot(q.originX - anchor.x, q.originY - anchor.y))[0];
    if (!nearest) return { valid: false, reason: "tag-text-not-found" };
    chosen.push(nearest);
  }
  const tol = TEXT_TAG_EDGE_TOLERANCE;
  const anchored =
    Math.abs(Math.min(...chosen.map((glyph) => glyph.originX)) - anchor.x) <= tol &&
    Math.abs(Math.min(...chosen.map((glyph) => glyph.originY)) - anchor.y) <= tol;
  if (!anchored) return { valid: false, reason: "tag-text-not-found" };
  const left = Math.min(...chosen.map((glyph) => glyph.box.x));
  const bottom = Math.min(...chosen.map((glyph) => glyph.box.y));
  const right = Math.max(...chosen.map((glyph) => glyph.box.x + glyph.box.width));
  const top = Math.max(...chosen.map((glyph) => glyph.box.y + glyph.box.height));
  const matches =
    Math.abs(Number(box.x) - left) <= tol &&
    Math.abs(Number(box.y) - bottom) <= tol &&
    Math.abs(Number(box.x) + Number(box.width) - right) <= tol &&
    Math.abs(Number(box.y) + Number(box.height) - top) <= tol;
  return matches ? { valid: true, reason: "tag-geometry-verified" } : { valid: false, reason: "box-does-not-match-tag" };
};

export const filterDrawingOverlayItems = (items, { pageNumber = null, sourceTypes = null } = {}) =>
  (items || []).filter((item) => {
    if (pageNumber !== null && item.pageNumber !== pageNumber) return false;
    if (sourceTypes && !sourceTypes.has(item.sourceType)) return false;
    return true;
  });
