import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  buildDrawingOverlayItems,
  highlightVerificationMode,
  verifyTextTagHighlight,
} from "../app/domain/drawing-overlay-view-model.mjs";
import { textItemCanonicalBox } from "../app/domain/drawing-coordinate-mapper.mjs";

// Phase 8A-UX-R4 (2026-09-24): the viewer's TextTag highlight safety check.
//
// The previous guard withheld a selected box whenever the nearest text that
// substring-matched the item's LABEL was drawn at an angle. That never
// looked at the box: it rejected every tag on a /Rotate 90 sheet, correct or
// not. The contract is now the actual question -- does the stored box match
// the glyph extent of the tag the occurrence was recognised from? The tag's
// identity comes from the occurrence itself (shape_signature `text:<TAG>` and
// the baseline anchor encoded in its occurrence_key); the geometry comes from
// the PDF's own text transforms (textItemCanonicalBox). Missing evidence
// fails closed.

const item = (transform, str, width, height = null) => ({ str, transform, width, height: height ?? Math.hypot(transform[2], transform[3]) });
const page = [0, 0, 3000, 3000];

// A tag occurrence exactly as the recognition engine persists it: box built
// by textItemCanonicalBox, key anchored at the text's baseline origin.
const tagOccurrence = (items, tag, { box = null, composed = false, id = "o1" } = {}) => {
  const glyphs = items.map((i) => textItemCanonicalBox(i.transform, i.width, i.height));
  const glyph = {
    x: Math.min(...glyphs.map((b) => b.x)),
    y: Math.min(...glyphs.map((b) => b.y)),
  };
  glyph.width = Math.max(...glyphs.map((b) => b.x + b.width)) - glyph.x;
  glyph.height = Math.max(...glyphs.map((b) => b.y + b.height)) - glyph.y;
  const ax = Math.min(...items.map((i) => i.transform[4]));
  const ay = Math.min(...items.map((i) => i.transform[5]));
  const [record] = buildDrawingOverlayItems({
    occurrences: [
      {
        id,
        page_number: 1,
        definition_id: "def",
        explicit_label: "SOME LONG DEFINITION LABEL",
        abbreviation: tag,
        bounding_box: { ...(box || glyph), pageWidth: 3000, pageHeight: 3000 },
        shape_signature: `text:${tag}`,
        occurrence_key: `1:${composed ? "text-composed" : "text"}:${tag}:${ax}:${ay}:1`,
        match_basis: "Exact nearby explicit tag from legend abbreviation",
        confidence: 84,
        review_status: "Needs Review",
      },
    ],
  });
  return { record, glyph };
};

const verdict = (record, items) => verifyTextTagHighlight(record, items, page);

for (const [name, transform, w] of [
  ["0 degrees", [8, 0, 0, 8, 100, 200], 12],
  ["90 degrees", [0, 8, -8, 0, 400, 500], 12],
  ["180 degrees", [-8, 0, 0, -8, 700, 800], 12],
  ["270 degrees", [0, -8, 8, 0, 1000, 1100], 12],
]) {
  test(`a correct ${name} TextTag box is accepted (rotation itself is never invalidity)`, () => {
    const tagItem = item(transform, "F", w);
    const { record } = tagOccurrence([tagItem], "F");
    assert.deepEqual(verdict(record, [tagItem, item([8, 0, 0, 8, 50, 50], "NOISE", 30)]), { valid: true, reason: "tag-geometry-verified" });
  });
}

test("real WLC-style rotated tag: legacy box rejected, corrected box accepted", () => {
  // Same shape as the /Rotate 90 WLC 'F' tag; no document identity involved.
  const tagItem = item([0, 6.0492, -8.1103, 0, 1215.7195, 1140.2401], "F", 3.6961, 8.1103);
  const legacy = { x: 1215.7195, y: 1140.2401, width: 3.6961, height: 8.1103 };
  assert.equal(verdict(tagOccurrence([tagItem], "F", { box: legacy }).record, [tagItem]).valid, false);
  assert.equal(verdict(tagOccurrence([tagItem], "F").record, [tagItem]).valid, true);
});

test("a composed multi-token tag is verified against the union of its token glyphs", () => {
  const ce = item([0, 6.05, -8.11, 0, 1213.92, 929.52], "CE", 10.08, 8.11);
  const m = item([0, 6.05, -8.11, 0, 1218.96, 940.56], "M", 5.0, 8.11);
  const { record, glyph } = tagOccurrence([ce, m], "CE M", { composed: true });
  assert.equal(verdict(record, [ce, m]).valid, true);
  const legacyUnion = { x: 1213.92, y: 929.52, width: 1218.96 + 8.11 - 1213.92, height: 940.56 + 5.0 - 929.52 };
  assert.equal(verdict(tagOccurrence([ce, m], "CE M", { box: legacyUnion, composed: true }).record, [ce, m]).valid, false);
  assert.ok(glyph.x < 1213.92, "glyphs sit on the -x side of a 90-degree baseline");
});

test("displaced, partial, oversized and far boxes are rejected", () => {
  const tagItem = item([0, 8, -8, 0, 400, 500], "WP", 14);
  const { glyph } = tagOccurrence([tagItem], "WP");
  const cases = {
    translated: { ...glyph, x: glyph.x + glyph.width },
    shiftedHalf: { ...glyph, y: glyph.y + glyph.height / 2 },
    partial: { ...glyph, width: glyph.width / 2 },
    oversized: { x: glyph.x - glyph.width / 2, y: glyph.y - glyph.height / 2, width: glyph.width * 2, height: glyph.height * 2 },
    far: { ...glyph, x: glyph.x + 500 },
  };
  for (const [name, box] of Object.entries(cases)) {
    const result = verdict(tagOccurrence([tagItem], "WP", { box }).record, [tagItem]);
    assert.deepEqual(result, { valid: false, reason: "box-does-not-match-tag" }, name);
  }
});

test("a box sitting on a different, identical tag elsewhere is rejected (anchor identity)", () => {
  const recognised = item([0, 8, -8, 0, 400, 500], "F", 6);
  const elsewhere = item([0, 8, -8, 0, 900, 1500], "F", 6);
  const { record } = tagOccurrence([recognised], "F", { box: textItemCanonicalBox(elsewhere.transform, elsewhere.width, elsewhere.height) });
  assert.equal(verdict(record, [recognised, elsewhere]).valid, false);
});

test("a box on a different neighbouring tag text is rejected", () => {
  const f = item([0, 8, -8, 0, 400, 500], "F", 6);
  const m = item([0, 8, -8, 0, 400, 520], "M", 7);
  const { record } = tagOccurrence([f], "F", { box: textItemCanonicalBox(m.transform, m.width, m.height) });
  assert.equal(verdict(record, [f, m]).valid, false);
});

test("missing glyph evidence, missing anchor or missing tag text fail closed", () => {
  const tagItem = item([0, 8, -8, 0, 400, 500], "F", 6);
  const { record } = tagOccurrence([tagItem], "F");
  assert.deepEqual(verdict(record, []), { valid: false, reason: "tag-text-not-found" });
  assert.deepEqual(verdict(record, [item([0, 8, -8, 0, 400, 500], "G", 6)]), { valid: false, reason: "tag-text-not-found" });
  assert.deepEqual(verifyTextTagHighlight({ ...record, evidence: { ...record.evidence, tagAnchor: null } }, [tagItem], page), { valid: false, reason: "missing-tag-evidence" });
  assert.deepEqual(verifyTextTagHighlight({ ...record, evidence: { ...record.evidence, tagText: "" } }, [tagItem], page), { valid: false, reason: "missing-tag-evidence" });
  assert.deepEqual(verifyTextTagHighlight(null, [tagItem], page), { valid: false, reason: "missing-tag-evidence" });
});

test("verification mode: vector boxes skip it, TextTags use geometry, unknown-origin text keeps the angle check", () => {
  const [vector] = buildDrawingOverlayItems({ occurrences: [{ id: "v", page_number: 1, definition_id: "d", bounding_box: { x: 1, y: 1, width: 2, height: 2 }, shape_signature: "shape:abc", occurrence_key: "1:shape:abc:1:1:1" }] });
  const [fuzzy] = buildDrawingOverlayItems({ occurrences: [{ id: "z", page_number: 1, definition_id: "d", bounding_box: { x: 1, y: 1, width: 2, height: 2 }, shape_signature: "1:fuzzy:x:1:1:", occurrence_key: "1:fuzzy:x:1" }] });
  const { record: tag } = tagOccurrence([item([8, 0, 0, 8, 10, 10], "F", 6)], "F");
  const [asset] = buildDrawingOverlayItems({ pages: [{ id: "p", page_number: 1 }], assets: [{ id: "a", page_id: "p", coordinates_available: true, text_content: "LOOP-1", bounding_box: { x: 1, y: 1, width: 5, height: 2 } }] });
  assert.equal(highlightVerificationMode(vector), "none");
  assert.equal(highlightVerificationMode(fuzzy), "none");
  assert.equal(highlightVerificationMode(tag), "tag-geometry");
  assert.equal(highlightVerificationMode(asset), "text-angle");
  assert.equal(highlightVerificationMode(null), "text-angle");
  assert.equal(vector.evidence.tagAnchor, undefined, "vector occurrences carry no tag evidence");
});

test("the viewer routes TextTags to the geometric verdict and withholds them until it passes", () => {
  const panel = fs.readFileSync(new URL("../app/components/drawing/DrawingVisualReviewPanel.tsx", import.meta.url), "utf8");
  const start = panel.indexOf("const [unverifiedHighlight, setUnverifiedHighlight]");
  const end = panel.indexOf("const evidenceBoxes =", start);
  const block = panel.slice(start, end);
  assert.match(block, /highlightVerificationMode\(selectedItem\)/);
  assert.match(block, /verifyTextTagHighlight\(selectedItem, textContent\.items, page\.view\)/);
  assert.match(block, /const highlightVerifiedInvalid = Boolean\(\s*selectedItem &&/);
  assert.match(block, /tagHighlightVerdict\?\.itemId !== selectedItem\.id \|\| !tagHighlightVerdict\.valid/);
});
