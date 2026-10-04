import test from "node:test";
import assert from "node:assert/strict";

import { pairLegendSymbolDescriptions } from "../app/domain/drawing-legend-notes-intelligence.mjs";

// Symbol-row + description-row legend tables carry no delimiters, so the
// intake delimited-line branch never fires. Pairing is by column: the
// description whose LEFT edge is closest to the symbol center-x.
const asset = (id, text, x, y, w = 10, h = 8) => ({ id, text, boundingBox: { x, y, width: w, height: h } });

test("1. pairs symbol columns to descriptions by left-edge proximity", () => {
  const assets = [
    asset("s1", "S", 568, 955), asset("s2", "T", 777, 967),
    asset("d1", "SMOKE DETECTOR", 568, 1031, 80, 8),
    asset("d2", "FIREMAN TELEPHONE JACK", 776, 1031, 120, 8),
  ];
  const pairs = pairLegendSymbolDescriptions({ assets });
  assert.equal(pairs.length, 2);
  const t = pairs.find((p) => p.symbol === "T");
  assert.equal(t.description, "FIREMAN TELEPHONE JACK");
  assert.equal(t.symbolAssetId, "s2");
  assert.equal(t.descriptionAssetId, "d2");
});

test("2. center-distance pairing is rejected: wide text must not shift columns", () => {
  // FIREMAN TELEPHONE JACK centered far right of T; center-distance would
  // attach it to the next column. Left-edge proximity keeps T=>FTJ.
  const assets = [
    asset("s1", "T", 777, 967),
    asset("d1", "LOOP POWERED STROBE WITH SOUNDER", 709, 1031, 150, 8),
    asset("d2", "FIREMAN TELEPHONE JACK", 776, 1031, 120, 8),
  ];
  const pairs = pairLegendSymbolDescriptions({ assets });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].description, "FIREMAN TELEPHONE JACK");
});

test("3. unpaired symbols stay unpaired; shared descriptions never double-assigned", () => {
  const assets = [
    asset("s1", "T", 777, 967),
    asset("s2", "Q", 2000, 967), // no description below within tolerance
    asset("d1", "FIREMAN TELEPHONE JACK", 776, 1031, 120, 8),
  ];
  const pairs = pairLegendSymbolDescriptions({ assets });
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].symbol, "T");
});

test("4. descriptions above the symbol row or outside dy band are ignored", () => {
  const assets = [
    asset("s1", "T", 777, 967),
    asset("d1", "NOTES HEADER TEXT HERE", 776, 800, 120, 8), // above
    asset("d2", "FAR AWAY DESCRIPTION TEXT", 776, 2000, 120, 8), // too far below
  ];
  assert.equal(pairLegendSymbolDescriptions({ assets }).length, 0);
});

test("5. malformed assets never throw; table titles stay unpaired", () => {
  const assets = [
    asset("s1", "T", 777, 967),
    { id: "bad", text: "FIREMAN TELEPHONE JACK", boundingBox: null },
    asset("t1", "FIRE ALARM SYSTEM", 519, 1024, 200, 8), // title, no symbol above in band
  ];
  const pairs = pairLegendSymbolDescriptions({ assets });
  assert.equal(pairs.length, 0);
});
