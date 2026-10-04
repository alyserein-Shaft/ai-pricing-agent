import test from "node:test";
import assert from "node:assert/strict";
import { computeDenseTextCropRegions } from "../app/domain/drawing-crop-selection.mjs";

const asset = (text, x, y, width = 20, height = 12) => ({ text_content: text, bounding_box: { x, y, width, height, pageWidth: 2384, pageHeight: 3370 } });

// Real WLC bounding boxes (doc_3f857096-3152-408f-9c86-9296e4142ced, page 1):
// LOOP-1..4 cluster tightly at x~1588, y from 1379.88 to 1473.36 (~31 apart);
// NAC LOOP sits nearby at (1580.76, 1643.64). A blind 2x2 quadrant grid put
// this whole cluster in a ~94px-wide sliver of a 1400px-wide crop -- this
// selector must isolate it as its OWN tight region instead.
const LOOP_CLUSTER = [
  asset("LOOP-1", 1588.44, 1379.88),
  asset("LOOP-2", 1588.44, 1410.96),
  asset("LOOP-3", 1588.44, 1442.16),
  asset("LOOP-4", 1588.44, 1473.36),
  asset("SPARE", 1588.44, 1500.0),
  asset("NAC LOOP", 1580.76, 1643.64),
];
// Unrelated content scattered far away (a title block, notes) -- must never
// be pulled into the loop cluster's own region.
const SCATTERED = [
  asset("PROJECT TITLE", 100, 3200),
  asset("CLIENT", 100, 3100),
  asset("NOTES: 1. FOR ELV LEGENDS...", 300, 200),
  asset("DRAWING NUMBER", 2000, 3200),
];

test("with no page dimensions, returns nothing rather than guessing", () => {
  assert.deepEqual(computeDenseTextCropRegions({ assets: LOOP_CLUSTER }), []);
});

test("real case: the LOOP-1..4/NAC LOOP cluster is isolated into its own tight region, not diluted by unrelated content", () => {
  const regions = computeDenseTextCropRegions({ assets: [...LOOP_CLUSTER, ...SCATTERED], pageWidth: 2384, pageHeight: 3370, maxRegions: 4 });
  assert.ok(regions.length > 0);
  const loopRegion = regions.find((region) => region.rect.x < 1588 && region.rect.x + region.rect.width > 1608 && region.rect.y < 1379 && region.rect.y + region.rect.height > 1512);
  assert.ok(loopRegion, "expected a region containing the full LOOP-1..4 + SPARE span");
  // Tight, not a blind quadrant: the loop cluster spans ~264 canonical
  // units (1379.88 to 1643.64 including NAC LOOP); with default padding
  // (140 each side) the region must stay well under a quadrant's ~1685-unit
  // half-page span, not balloon out to cover unrelated content.
  assert.ok(loopRegion.rect.width < 800, `region width ${loopRegion.rect.width} should stay tight around the cluster, not balloon to quadrant size`);
  assert.ok(loopRegion.rect.height < 800, `region height ${loopRegion.rect.height} should stay tight around the cluster, not balloon to quadrant size`);
});

test("a region's bounds are clamped to the real page -- never extends past the MediaBox", () => {
  const edgeCluster = [asset("EDGE-1", 5, 5), asset("EDGE-2", 8, 8)];
  const regions = computeDenseTextCropRegions({ assets: edgeCluster, pageWidth: 2384, pageHeight: 3370, maxRegions: 1 });
  assert.equal(regions[0].rect.x, 0);
  assert.equal(regions[0].rect.y, 0);
});

test("assets with no bounding box or empty text are ignored, never crash the bucketing", () => {
  const mixed = [...LOOP_CLUSTER, { text_content: "no box" }, { text_content: "", bounding_box: { x: 1, y: 1 } }, { bounding_box: { x: 1, y: 1 } }];
  const regions = computeDenseTextCropRegions({ assets: mixed, pageWidth: 2384, pageHeight: 3370 });
  assert.ok(regions.length > 0);
});

test("fewer real clusters than maxRegions returns fewer regions, never padded/duplicated entries", () => {
  const regions = computeDenseTextCropRegions({ assets: LOOP_CLUSTER, pageWidth: 2384, pageHeight: 3370, maxRegions: 4 });
  assert.equal(regions.length, 1, "all 6 loop-area labels fall in the same density bucket -- one real cluster, not four padded ones");
});

test("regions are returned densest-first", () => {
  const denseSpot = Array.from({ length: 8 }, (_, index) => asset(`D${index}`, 100 + index * 5, 100));
  const sparseSpot = [asset("S1", 2000, 2000)];
  const regions = computeDenseTextCropRegions({ assets: [...sparseSpot, ...denseSpot], pageWidth: 2384, pageHeight: 3370, maxRegions: 2 });
  assert.equal(regions.length, 2);
  assert.ok(regions[0].itemCount >= regions[1].itemCount);
});
