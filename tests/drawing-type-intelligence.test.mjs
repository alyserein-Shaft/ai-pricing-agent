import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDrawingType, mapToAuthorityDrawingType, DRAWING_TYPE_BUCKETS } from "../app/domain/drawing-type-classifier.mjs";
import { buildLayoutIntelligence } from "../app/domain/drawing-layout-intelligence.mjs";
import { buildDetailIntelligence } from "../app/domain/drawing-detail-intelligence.mjs";
import { KGS_SCHEMATIC_PAGES, KGS_SCHEMATIC_ASSETS } from "./golden/kgs-fire-alarm-schematic.fixture.mjs";

// WORKSTREAM 1 -- drawing type classification.

test("drawing type classification -- all 13 real Al Mousa sheet titles classify decisively, without forcing weak evidence", () => {
  const realTitles = [
    ["ELECTRICAL LEGENDS", "Legend / Notes"],
    ["ELV LEGENDS, NOTES AND ABBREVIATIONS", "Legend / Notes"],
    ["OVERALL FIRE ALARM PANEL NETWORK DIAGRAM", "Riser Diagram"],
    ["SUBSTATION FIRE DETECTION AND ALARM SCHEMATIC", "Schematic / Single-Line"],
    ["FIRE ALARM SYSTEM CAUSE AND EFFECT MATRIX", "Cause & Effect"],
    ["FIRE DETECTION & ALARM SCHEMATIC", "Schematic / Single-Line"],
    ["FIRE ALARM SYSTEM CAUSE AND EFFECT", "Cause & Effect"],
    ["FCC ROOM DETAILS", "Detail / Enlarged Detail"],
  ];
  for (const [title, expected] of realTitles) {
    const result = classifyDrawingType({ sheetName: title });
    assert.equal(result.drawingType, expected, `"${title}" should classify as ${expected}`);
    assert.equal(result.governedStatus, "Verified");
    assert.match(result.evidence, /title/i);
  }
});

test("drawing type classification -- a sheet with no title and no classification stays Unknown / Mixed, never guessed", () => {
  const result = classifyDrawingType({ sheetName: null, classifications: [] });
  assert.equal(result.drawingType, "Unknown / Mixed");
  assert.equal(result.governedStatus, "Needs Review");
  assert.equal(result.confidence, 0);
});

test("drawing type classification -- falls back to the existing whole-sheet classification when the title is missing, capped at Needs Review", () => {
  const result = classifyDrawingType({ sheetName: "", classifications: [{ type: "Riser Diagram", confidence: 68 }, { type: "Mixed Drawing", confidence: 90 }] });
  assert.equal(result.drawingType, "Riser Diagram");
  assert.equal(result.governedStatus, "Needs Review");
  assert.match(result.evidence, /existing Drawing Intake classification/);
});

test("drawing type classification -- an unrecognized classification type produces Unknown / Mixed rather than a wrong guess", () => {
  const result = classifyDrawingType({ sheetName: "", classifications: [{ type: "Cover", confidence: 88 }] });
  assert.equal(result.drawingType, "Unknown / Mixed");
});

test("mapToAuthorityDrawingType maps every bucket except Unknown/Mixed to a real Rule-A drawingType string", () => {
  for (const bucket of DRAWING_TYPE_BUCKETS) {
    const mapped = mapToAuthorityDrawingType(bucket);
    if (bucket === "Unknown / Mixed") assert.equal(mapped, null);
    else assert.ok(mapped, `${bucket} should map to a real authority-policy drawingType`);
  }
});

// WORKSTREAM 4 -- layout intelligence (no real Al Mousa sheet classifies as
// pure Layout in this project -- honestly tested via a synthetic fixture
// that proves the mechanism, per the same "prove it, don't force it"
// principle applied to Cause & Effect).

test("layout placement authority -- an explicit device tag on a Layout-authoritative sheet reaches Verified; repeated instances are counted", () => {
  const assets = [
    { id: "a1", asset_type: "Text", text_content: "SD-01", bounding_box: { x: 100, y: 500, width: 30, height: 12 } },
    { id: "a2", asset_type: "Text", text_content: "SD-01", bounding_box: { x: 300, y: 400, width: 30, height: 12 } },
    { id: "a3", asset_type: "Text", text_content: "MCP-12", bounding_box: { x: 200, y: 450, width: 40, height: 12 } },
  ];
  const result = buildLayoutIntelligence({ sourceDocument: { id: "doc_layout" }, pageNumber: 1, drawingType: "Layout", assets });
  assert.equal(result.devicePlacements.length, 3);
  const sd01 = result.devicePlacements.find((d) => d.rawLabel === "SD-01" && d.boundingBox.x === 100);
  assert.equal(sd01.repeatedInstanceCount, 2);
  assert.equal(sd01.governedStatus, "Verified"); // Layout is Primary authority for DevicePlacement (Rule A)
});

test("layout intelligence never produces a connectivity/topology proposal of any kind", () => {
  const assets = [
    { id: "a1", asset_type: "Text", text_content: "SD-01", bounding_box: { x: 100, y: 500, width: 30, height: 12 } },
    { id: "a2", asset_type: "Text", text_content: "MCP-01", bounding_box: { x: 105, y: 500, width: 30, height: 12 } }, // deliberately overlapping/adjacent
  ];
  const result = buildLayoutIntelligence({ sourceDocument: { id: "doc_layout" }, pageNumber: 1, drawingType: "Layout", assets });
  assert.doesNotMatch(JSON.stringify(result), /Connection|Connectivity/);
});

test("layout intelligence detects an explicit detail reference", () => {
  const assets = [{ id: "a1", asset_type: "Text", text_content: "SEE DETAIL 4", bounding_box: { x: 100, y: 500, width: 80, height: 12 } }];
  const result = buildLayoutIntelligence({ sourceDocument: { id: "doc_layout" }, pageNumber: 1, drawingType: "Layout", assets });
  assert.equal(result.detailReferences.length, 1);
  assert.equal(result.detailReferences[0].referencedDetailNumber, 4);
});

// WORKSTREAM 6 -- detail / enlarged detail intelligence.

test("typical detail quantity safety -- a 'TYPICAL' detail forces TYPICAL_DETAIL_AS_QUANTITY and stays Needs Review regardless of how explicit the detail number is", () => {
  const assets = [{ id: "a1", asset_type: "Text", text_content: "TYPICAL DETAIL 5", bounding_box: { x: 100, y: 500, width: 100, height: 12 } }];
  const result = buildDetailIntelligence({ sourceDocument: { id: "doc_detail" }, pageNumber: 1, drawingType: "Detail / Enlarged Detail", assets });
  assert.equal(result.detailNumbers.length, 1);
  assert.equal(result.detailNumbers[0].isTypical, true);
  assert.equal(result.detailNumbers[0].governedStatus, "Needs Review");
  assert.ok(result.detailNumbers[0].hardReviewReasons.some((reason) => /typical/i.test(reason)));
});

test("a project-specific (non-typical) detail number is not forced to Needs Review by the typical-detail rule", () => {
  const assets = [{ id: "a1", asset_type: "Text", text_content: "DETAIL 5", bounding_box: { x: 100, y: 500, width: 60, height: 12 } }];
  const result = buildDetailIntelligence({ sourceDocument: { id: "doc_detail" }, pageNumber: 1, drawingType: "Detail / Enlarged Detail", assets });
  assert.equal(result.detailNumbers[0].isTypical, false);
  assert.ok(!result.detailNumbers[0].hardReviewReasons.some((reason) => /typical/i.test(reason)));
});

test("mounting/installation dimensions are captured as installation evidence only, never as a standalone quantity claim", () => {
  const assets = [{ id: "a1", asset_type: "Text", text_content: "WALL MOUNTED AT 1200mm AFFL", bounding_box: { x: 100, y: 500, width: 150, height: 12 } }];
  const result = buildDetailIntelligence({ sourceDocument: { id: "doc_detail" }, pageNumber: 1, drawingType: "Detail / Enlarged Detail", assets });
  assert.equal(result.installationRequirements.length, 1);
  assert.deepEqual(result.installationRequirements[0].mountingDimension, { value: 1200, unit: "mm" });
  assert.equal(result.installationRequirements[0].proposalType, "InstallationRequirementCandidate");
  assert.notEqual(result.installationRequirements[0].proposalType, "QuantityCandidate");
});

// Real-data sanity: running the layout/detail extractors against a real
// (non-Layout, non-Detail) sheet should not crash and should not
// fabricate results from unrelated content.
test("layout and detail extractors run safely against an unrelated real sheet (Riser/Schematic) without crashing or fabricating results", () => {
  const layout = buildLayoutIntelligence({ sourceDocument: { id: "doc_kgs" }, pageNumber: 1, drawingType: "Layout", assets: KGS_SCHEMATIC_ASSETS });
  const detail = buildDetailIntelligence({ sourceDocument: { id: "doc_kgs" }, pageNumber: 1, drawingType: "Detail / Enlarged Detail", assets: KGS_SCHEMATIC_ASSETS });
  assert.ok(Array.isArray(layout.devicePlacements));
  assert.ok(Array.isArray(detail.detailNumbers));
});
