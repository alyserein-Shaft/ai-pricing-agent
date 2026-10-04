import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDrawingOverlayItems,
  filterDrawingOverlayItems,
  DRAWING_OVERLAY_SOURCE_TYPES,
} from "../app/domain/drawing-overlay-view-model.mjs";

// AUTOMATIC-ASSISTED DRAWING REVIEW v0 -- overlay normalization test
// matrix. This view model must reuse the exact shapes already returned by
// GET /api/documents/:id/drawing-intake, GET .../symbol-recognition, and
// GET .../drawing-structure -- nothing here invents a new backend shape.

const pages = [
  { id: "page_1", page_number: 1, width: 1000, height: 500 },
  { id: "page_2", page_number: 2, width: 800, height: 600 },
];

const assets = [
  {
    id: "asset_1",
    page_id: "page_1",
    asset_type: "Text",
    text_content: "MAIN FIRE ALARM CONTROL PANEL",
    bounding_box: { x: 10, y: 20, width: 100, height: 10, pageWidth: 1000, pageHeight: 500 },
    coordinates_available: 1,
    detection_confidence: 99,
    detection_method: "PDF text item geometry · MediaBox origin normalized",
    review_status: "Needs Review",
  },
  {
    // no bounding box available (e.g. a Table/Schedule asset) -- must be
    // skipped, never rendered at a guessed/zero location.
    id: "asset_2",
    page_id: "page_1",
    asset_type: "Table",
    text_content: "SCHEDULE",
    bounding_box: null,
    coordinates_available: 0,
    detection_confidence: 40,
    detection_method: "Heuristic",
    review_status: "Needs Review",
  },
  {
    // references a page_id not present in pages[] -- must be dropped, not
    // rendered with a null pageNumber.
    id: "asset_3",
    page_id: "page_missing",
    asset_type: "Text",
    text_content: "orphan",
    bounding_box: { x: 0, y: 0, width: 5, height: 5 },
    coordinates_available: 1,
    detection_confidence: 90,
    detection_method: "x",
    review_status: "Needs Review",
  },
];

const occurrences = [
  {
    id: "occ_matched",
    definition_id: "def_1",
    abbreviation: "FACP",
    explicit_label: "Fire Alarm Control Panel",
    page_number: 1,
    bounding_box: { x: 200, y: 200, width: 30, height: 30 },
    nearby_text: "FACP",
    match_basis: "Legend shape match",
    confidence: 95,
    review_status: "Approved",
  },
  {
    id: "occ_unknown",
    definition_id: null,
    page_number: 1,
    bounding_box: { x: 400, y: 100, width: 15, height: 15 },
    nearby_text: "UNK-1",
    match_basis: "Geometry cluster",
    confidence: 55,
    review_status: "Needs Review",
  },
  {
    // no bounding box -- must be skipped.
    id: "occ_no_box",
    definition_id: "def_2",
    page_number: 2,
    bounding_box: null,
    confidence: 80,
    review_status: "Needs Review",
  },
];

const regions = [
  {
    id: "region_1",
    page_number: 2,
    region_type: "Legend Table",
    bounding_box: { x: 0, y: 0, width: 400, height: 200 },
    raw_content: "LEGEND",
    confidence: 88,
    review_status: "Needs Review",
    detection_method: "Vector cluster",
  },
];

test("builds one normalized item per valid asset/occurrence/region, dropping unresolvable ones", () => {
  const items = buildDrawingOverlayItems({ pages, assets, occurrences, regions });
  const ids = items.map((item) => item.id).sort();
  assert.deepEqual(ids, [
    "asset:asset_1",
    "occurrence:occ_matched",
    "occurrence:occ_unknown",
    "region:region_1",
  ].sort());
});

test("text assets normalize to sourceType Text with the page resolved via pages[]", () => {
  const items = buildDrawingOverlayItems({ pages, assets, occurrences: [], regions: [] });
  const item = items.find((entry) => entry.id === "asset:asset_1");
  assert.equal(item.sourceType, "Text");
  assert.equal(item.pageNumber, 1);
  assert.equal(item.reviewStatus, "Needs Review");
  assert.deepEqual(item.sourceEntity, { kind: "drawing-asset", id: "asset_1" });
});

test("occurrences with a definition_id normalize to sourceType Symbol; null definition_id normalizes to UnknownSymbol", () => {
  const items = buildDrawingOverlayItems({ pages: [], assets: [], occurrences, regions: [] });
  const matched = items.find((entry) => entry.id === "occurrence:occ_matched");
  const unknown = items.find((entry) => entry.id === "occurrence:occ_unknown");
  assert.equal(matched.sourceType, "Symbol");
  assert.equal(matched.label, "Fire Alarm Control Panel");
  assert.equal(matched.sourceEntity.definitionId, "def_1");
  assert.equal(unknown.sourceType, "UnknownSymbol");
  assert.equal(unknown.sourceEntity.definitionId, null);
});

test("structural regions normalize to sourceType Structure", () => {
  const items = buildDrawingOverlayItems({ pages: [], assets: [], occurrences: [], regions });
  const item = items.find((entry) => entry.id === "region:region_1");
  assert.equal(item.sourceType, "Structure");
  assert.equal(item.pageNumber, 2);
  assert.equal(item.sourceEntity.kind, "structure-region");
});

test("filterDrawingOverlayItems narrows by page and by selected source types", () => {
  const items = buildDrawingOverlayItems({ pages, assets, occurrences, regions });
  const page1Only = filterDrawingOverlayItems(items, { pageNumber: 1 });
  assert.ok(page1Only.every((item) => item.pageNumber === 1));
  assert.equal(page1Only.length, 3);

  const symbolsOnly = filterDrawingOverlayItems(items, { sourceTypes: new Set(["Symbol"]) });
  assert.deepEqual(symbolsOnly.map((item) => item.id), ["occurrence:occ_matched"]);

  const none = filterDrawingOverlayItems(items, { sourceTypes: new Set() });
  assert.equal(none.length, 0);
});

test("DRAWING_OVERLAY_SOURCE_TYPES exposes exactly the four v0 filter categories", () => {
  assert.deepEqual(DRAWING_OVERLAY_SOURCE_TYPES, ["Text", "Symbol", "UnknownSymbol", "Structure"]);
});

test("confidence is clamped into 0..100 and missing confidence normalizes to null, never NaN", () => {
  const items = buildDrawingOverlayItems({
    pages: [],
    assets: [],
    occurrences: [
      { id: "a", definition_id: "d", page_number: 1, bounding_box: { x: 0, y: 0, width: 1, height: 1 }, confidence: 150, review_status: "Needs Review" },
      { id: "b", definition_id: "d", page_number: 1, bounding_box: { x: 0, y: 0, width: 1, height: 1 }, confidence: undefined, review_status: "Needs Review" },
    ],
    regions: [],
  });
  const a = items.find((item) => item.id === "occurrence:a");
  const b = items.find((item) => item.id === "occurrence:b");
  assert.equal(a.confidence, 100);
  assert.equal(b.confidence, null);
});
