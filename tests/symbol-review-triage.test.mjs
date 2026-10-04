import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  unknownSizeBand,
  filterUnknownSymbols,
  locateOverlayItemId,
  UNKNOWN_SIZE_BANDS,
} from "../app/domain/symbol-review-triage.mjs";

const item = (overrides = {}) => ({
  id: "symbolOccurrence_1",
  page_number: 1,
  bounding_box: { x: 10, y: 20, width: 8, height: 8 },
  shape_signature: "shape:abc",
  nearby_text: null,
  match_basis: "Repeated vector shape has no explicit legend definition",
  confidence: 55,
  review_status: "Needs Review",
  ...overrides,
});

// ---- size bands (generic persisted bbox geometry only) ----
test("size bands classify by max bbox axis with null-safe fallback", () => {
  assert.equal(unknownSizeBand({ width: 2, height: 1 }), "<4 pt");
  assert.equal(unknownSizeBand({ width: 8, height: 8 }), "4–12 pt");
  assert.equal(unknownSizeBand({ width: 9, height: 25 }), "12–40 pt");
  assert.equal(unknownSizeBand({ width: 100, height: 5 }), "Over 40 pt");
  assert.equal(unknownSizeBand(null), "Unknown size");
  assert.equal(unknownSizeBand({}), "Unknown size");
  assert.deepEqual([...UNKNOWN_SIZE_BANDS], ["<4 pt", "4–12 pt", "12–40 pt", "Over 40 pt"]);
});

// ---- faceted filtering (view-only; never mutates review state) ----
test("empty filters preserve the full population", () => {
  const rows = [item(), item({ id: "b" })];
  assert.deepEqual(filterUnknownSymbols(rows, { sizeBands: [], nearbyTag: "any", search: "" }), rows);
});

test("size-band filter narrows generically", () => {
  const rows = [item({ id: "tiny", bounding_box: { x: 0, y: 0, width: 2, height: 2 } }), item({ id: "big", bounding_box: { x: 0, y: 0, width: 30, height: 5 } })];
  assert.deepEqual(filterUnknownSymbols(rows, { sizeBands: ["<4 pt"], nearbyTag: "any", search: "" }).map((r) => r.id), ["tiny"]);
  assert.deepEqual(filterUnknownSymbols(rows, { sizeBands: ["12–40 pt"], nearbyTag: "any", search: "" }).map((r) => r.id), ["big"]);
});

test("nearby-tag facet splits present vs absent", () => {
  const rows = [item({ id: "tagged", nearby_text: "2 Nos" }), item({ id: "bare", nearby_text: null })];
  assert.deepEqual(filterUnknownSymbols(rows, { sizeBands: [], nearbyTag: "with", search: "" }).map((r) => r.id), ["tagged"]);
  assert.deepEqual(filterUnknownSymbols(rows, { sizeBands: [], nearbyTag: "without", search: "" }).map((r) => r.id), ["bare"]);
});

test("text search matches nearby text, basis, and signature without classification", () => {
  const rows = [item({ id: "a", nearby_text: "2 Nos" }), item({ id: "b", nearby_text: null, shape_signature: "shape:ff00" })];
  assert.deepEqual(filterUnknownSymbols(rows, { sizeBands: [], nearbyTag: "any", search: "nos" }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterUnknownSymbols(rows, { sizeBands: [], nearbyTag: "any", search: "FF00" }).map((r) => r.id), ["b"]);
  assert.deepEqual(filterUnknownSymbols(rows, { sizeBands: [], nearbyTag: "any", search: "zzz-no-match" }), []);
});

test("filtering never writes review state", () => {
  const rows = [item()];
  const out = filterUnknownSymbols(rows, { sizeBands: ["Over 40 pt"], nearbyTag: "any", search: "" });
  assert.deepEqual(out, []);
  assert.equal(rows[0].review_status, "Needs Review");
});

// ---- occurrence -> overlay item identity (single mapping authority) ----
test("locate maps an occurrence id to its overlay item id", () => {
  assert.equal(locateOverlayItemId("symbolOccurrence_abc"), "occurrence:symbolOccurrence_abc");
  assert.equal(locateOverlayItemId(""), null);
  assert.equal(locateOverlayItemId(null), null);
});

// ---- wiring assertions (fail until implemented) ----
test("Symbol Review rows expose Show on drawing", async () => {
  const ui = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(ui, /Show on drawing/);
});

test("viewer accepts an external focus request", async () => {
  const viewer = await readFile(new URL("../app/components/drawing/DrawingVisualReviewPanel.tsx", import.meta.url), "utf8");
  assert.match(viewer, /focusedOverlayItem|locateRequest|externalSelected/);
});

test("Unknown tab exposes generic triage with counts and reset", async () => {
  const ui = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(ui, /symbol-triage-controls/);
  assert.match(ui, /Showing/);
  assert.match(ui, /Unknowns/);
  assert.match(ui, /Clear filters/);
  assert.match(ui, /filterUnknownSymbols\(/);
  assert.match(ui, /Nearby tag/);
});
