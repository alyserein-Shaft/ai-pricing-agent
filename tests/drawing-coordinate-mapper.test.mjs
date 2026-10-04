import test from "node:test";
import assert from "node:assert/strict";
import {
  mapCanonicalBoxToViewport,
  mapViewportBoxToCanonical,
  viewportPixelSize,
} from "../app/domain/drawing-coordinate-mapper.mjs";

// AUTOMATIC-ASSISTED DRAWING REVIEW v0 -- coordinate mapper test matrix.
// Every drawing engine (Drawing Intake, Structural Parser, Symbol
// Recognition) already emits bounding boxes in PAGE-LOCAL NORMALIZED PDF
// COORDINATES (MediaBox lower-left shifted to (0,0), y-up). This file
// proves the ONE conversion to PDF.js's top-left, y-down canvas space is
// correct, including the real Al Mousa School drawing's centered-MediaBox
// page size.

test("bottom-left box near the page origin maps to the canvas bottom-left", () => {
  const page = { pageWidth: 1000, pageHeight: 500 };
  const box = { x: 0, y: 0, width: 100, height: 50 };
  const result = mapCanonicalBoxToViewport(box, page, { scale: 1 });
  assert.deepEqual(result, { left: 0, top: 450, width: 100, height: 50 });
});

test("top-left canonical box (high y) maps to the canvas top edge", () => {
  const page = { pageWidth: 1000, pageHeight: 500 };
  const box = { x: 0, y: 450, width: 100, height: 50 };
  const result = mapCanonicalBoxToViewport(box, page, { scale: 1 });
  assert.deepEqual(result, { left: 0, top: 0, width: 100, height: 50 });
});

test("scale multiplies every output dimension uniformly", () => {
  const page = { pageWidth: 1000, pageHeight: 500 };
  const box = { x: 100, y: 100, width: 40, height: 20 };
  const at1x = mapCanonicalBoxToViewport(box, page, { scale: 1 });
  const at2x = mapCanonicalBoxToViewport(box, page, { scale: 2 });
  assert.equal(at2x.left, at1x.left * 2);
  assert.equal(at2x.top, at1x.top * 2);
  assert.equal(at2x.width, at1x.width * 2);
  assert.equal(at2x.height, at1x.height * 2);
});

test("real Al Mousa School page (3370.56 x 2384.16, centered MediaBox already normalized) maps without negative geometry", () => {
  // page.view = [-1685.28, -1192.08, 1685.28, 1192.08] before normalization;
  // Drawing Intake already subtracts the origin, so pageWidth/pageHeight and
  // every asset's box are already zero-based by the time they reach here.
  const page = { pageWidth: 3370.56, pageHeight: 2384.16 };
  const box = { x: 46.99423, y: 45.47685, width: 3317.54379 - 46.99423, height: 2211.47182 - 45.47685 };
  const result = mapCanonicalBoxToViewport(box, page, { scale: 0.3 });
  assert.ok(result.left >= 0 && result.top >= 0);
  assert.ok(result.width > 0 && result.height > 0);
  assert.ok(result.left + result.width <= page.pageWidth * 0.3 + 1e-6);
  assert.ok(result.top + result.height <= page.pageHeight * 0.3 + 1e-6);
});

test("a box that partially overruns the page edge is clamped to non-negative on-canvas geometry, never negative", () => {
  const page = { pageWidth: 200, pageHeight: 100 };
  const box = { x: -10, y: -10, width: 50, height: 300 };
  const result = mapCanonicalBoxToViewport(box, page, { scale: 1 });
  assert.ok(result.left >= 0);
  assert.ok(result.top >= 0);
  assert.ok(result.width >= 0);
  assert.ok(result.height >= 0);
});

test("a box entirely outside the page (no overlap at all) returns null rather than a fake clamped corner point", () => {
  // Real upstream data does this: some Drawing Intake text items carry
  // coordinates far outside the MediaBox (observed on a real drawing --
  // e.g. x=-656.76, width=218.4 on a page 3370.56 wide, which never enters
  // [0, pageWidth] at all). Silently clamping that to (0,0) would draw an
  // overlay box at a location the item's real geometry never occupies.
  const page = { pageWidth: 3370.56, pageHeight: 2384.16 };
  const box = { x: -656.76062, y: -294.38849, width: 218.3754, height: 20.00188 };
  assert.equal(mapCanonicalBoxToViewport(box, page, { scale: 1 }), null);
});

test("a box that only grazes the page edge (single point of contact) also returns null, not a zero-area box", () => {
  const page = { pageWidth: 200, pageHeight: 100 };
  const box = { x: -50, y: 10, width: 50, height: 20 }; // right edge exactly at x=0
  assert.equal(mapCanonicalBoxToViewport(box, page, { scale: 1 }), null);
});

test("90 degree rotation swaps width/height and rotates the box clockwise", () => {
  const page = { pageWidth: 200, pageHeight: 100 };
  const box = { x: 0, y: 0, width: 20, height: 10 };
  const result = mapCanonicalBoxToViewport(box, page, { scale: 1, rotation: 90 });
  // Unrotated: left=0, top=90, w=20, h=10 (bottom-left corner).
  // Rotated 90cw around a canvas now sized (pageHeight, pageWidth) = (100,200).
  assert.deepEqual(result, { left: 0, top: 0, width: 10, height: 20 });
});

test("180 degree rotation maps the bottom-left corner to the top-right", () => {
  const page = { pageWidth: 200, pageHeight: 100 };
  const box = { x: 0, y: 0, width: 20, height: 10 };
  const result = mapCanonicalBoxToViewport(box, page, { scale: 1, rotation: 180 });
  assert.deepEqual(result, { left: 180, top: 0, width: 20, height: 10 });
});

test("missing or non-finite page dimensions return null instead of throwing or producing NaN geometry", () => {
  assert.equal(mapCanonicalBoxToViewport({ x: 0, y: 0, width: 1, height: 1 }, { pageWidth: 0, pageHeight: 100 }), null);
  assert.equal(mapCanonicalBoxToViewport({ x: 0, y: 0, width: 1, height: 1 }, { pageWidth: NaN, pageHeight: 100 }), null);
  assert.equal(mapCanonicalBoxToViewport(null, { pageWidth: 100, pageHeight: 100 }), null);
});

test("non-finite box fields return null", () => {
  const page = { pageWidth: 100, pageHeight: 100 };
  assert.equal(mapCanonicalBoxToViewport({ x: "n/a", y: 0, width: 1, height: 1 }, page), null);
});

test("viewportPixelSize matches an unrotated scaled page, and swaps for 90/270", () => {
  const page = { pageWidth: 1000, pageHeight: 500 };
  assert.deepEqual(viewportPixelSize(page, { scale: 0.5 }), { width: 500, height: 250 });
  assert.deepEqual(viewportPixelSize(page, { scale: 0.5, rotation: 90 }), { width: 250, height: 500 });
  assert.deepEqual(viewportPixelSize(page, { scale: 1, rotation: 270 }), { width: 500, height: 1000 });
});

const assertBoxClose=(actual,expected,tolerance=1e-9)=>{for(const key of["x","y","width","height"])assert.ok(Math.abs(actual[key]-expected[key])<=tolerance,`${key}: ${actual[key]} != ${expected[key]}`);};

for(const rotation of[0,90,180,270])test(`inverse mapper round-trips canonical geometry at ${rotation} degrees`,()=>{
  const page={pageWidth:2384,pageHeight:3370},viewport={scale:2.67,rotation},boxes=[
    {x:0,y:0,width:2384,height:3370},
    {x:0,y:0,width:9,height:40},
    {x:2370,y:3350,width:14,height:20},
    {x:580.25,y:955.68,width:8.11,height:4.42},
    {x:579.53,y:1031.76,width:8.11,height:51.04},
    {x:579.53,y:955.68,width:8.83,height:127.12},
  ];
  for(const box of boxes)assertBoxClose(mapViewportBoxToCanonical(mapCanonicalBoxToViewport(box,page,viewport),page,viewport),box,1e-8);
});

test("inverse mapper handles portrait/landscape viewport swaps without caller-side axis math",()=>{
  const page={pageWidth:2384,pageHeight:3370},box={x:500,y:900,width:20,height:360};
  for(const rotation of[90,270]){
    const viewport={scale:.5,rotation},size=viewportPixelSize(page,viewport),mapped=mapCanonicalBoxToViewport(box,page,viewport);
    assert.deepEqual(size,{width:1685,height:1192});
    assertBoxClose(mapViewportBoxToCanonical(mapped,page,viewport),box);
  }
});

test("inverse mapper clamps partial viewport overlap and rejects wholly off-canvas geometry",()=>{
  const page={pageWidth:200,pageHeight:100};
  assert.deepEqual(mapViewportBoxToCanonical({left:-10,top:80,width:30,height:40},page,{rotation:0}),{x:0,y:0,width:20,height:20});
  assert.equal(mapViewportBoxToCanonical({left:-30,top:10,width:20,height:20},page,{rotation:0}),null);
  assert.equal(mapViewportBoxToCanonical({left:0,top:0,width:0,height:20},page,{rotation:0}),null);
});
