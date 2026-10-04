import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { transform } from "lightningcss";
import {
  buildDrawingOverlayItems,
  highlightBoxNeedsPdfTextCheck,
} from "../app/domain/drawing-overlay-view-model.mjs";

// Phase 8A-UX-R2 (2026-09-24): viewer selection render boundary.
//
// Runtime evidence on the Clean Golden WLC (doc_3a7c645e, a /Rotate 90 sheet)
// showed selection state reaching the panel for every symbol occurrence via
// both openFinding and "Show on drawing", yet the selection was not visible:
//   1. the live rotated-text check matched short unrelated tag letters ("M",
//      "CE") against a VECTOR-geometry occurrence's long definition label and
//      withheld its selected box, although that box never came from PDF text;
//   2. where the selected box was drawn, `.selected` carried an invalid
//      box-shadow value (dropped by the browser) and no border colour of its
//      own, so it was not visibly distinguishable from its neighbours.

const occurrence = (id, shapeSignature, extra = {}) => ({
  id,
  page_number: 1,
  definition_id: "def_1",
  explicit_label: "INTERFACE MODULE MONITORING",
  abbreviation: "CE M",
  bounding_box: { x: 10, y: 10, width: 12, height: 12, pageWidth: 100, pageHeight: 100 },
  shape_signature: shapeSignature,
  match_basis: "basis",
  confidence: 90,
  review_status: "Needs Review",
  ...extra,
});

const itemFor = (record) => buildDrawingOverlayItems({ occurrences: [record] })[0];

test("vector-geometry symbol occurrences are never subjected to the PDF text-angle check", () => {
  assert.equal(highlightBoxNeedsPdfTextCheck(itemFor(occurrence("o_shape", "shape:015cc920"))), false);
  assert.equal(
    highlightBoxNeedsPdfTextCheck(
      itemFor(occurrence("o_fuzzy", "1:fuzzy:approved:approvedStructureRow_x:1224.24:967.2:")),
    ),
    false,
  );
  // Unmatched (Unknown) occurrences are vector shapes too.
  assert.equal(
    highlightBoxNeedsPdfTextCheck(itemFor(occurrence("o_unknown", "shape:aa", { definition_id: null }))),
    false,
  );
});

test("boxes built from raw PDF text, or of unknown origin, keep the PDF text-angle check", () => {
  assert.equal(highlightBoxNeedsPdfTextCheck(itemFor(occurrence("o_tag", "text:F"))), true);
  assert.equal(highlightBoxNeedsPdfTextCheck(itemFor(occurrence("o_composed", "text:CE M"))), true);
  assert.equal(highlightBoxNeedsPdfTextCheck(itemFor(occurrence("o_missing", null))), true);
  const [asset] = buildDrawingOverlayItems({
    pages: [{ id: "p1", page_number: 1 }],
    assets: [{ id: "a1", page_id: "p1", coordinates_available: true, text_content: "LOOP-1", bounding_box: { x: 1, y: 1, width: 5, height: 2 } }],
  });
  assert.equal(highlightBoxNeedsPdfTextCheck(asset), true);
  assert.equal(highlightBoxNeedsPdfTextCheck(null), true);
});

test("the viewer's live verification is gated by that geometry-origin decision", () => {
  // R4 superseded the boolean gate with highlightVerificationMode: vector boxes
  // ("none") still skip verification entirely.
  const panel = fs.readFileSync(new URL("../app/components/drawing/DrawingVisualReviewPanel.tsx", import.meta.url), "utf8");
  const effectStart = panel.indexOf("const [unverifiedHighlight, setUnverifiedHighlight]");
  const verifyStart = panel.indexOf("const verify = async", effectStart);
  assert.ok(effectStart > 0 && verifyStart > effectStart);
  assert.match(panel.slice(effectStart, verifyStart), /const mode = highlightVerificationMode\(selectedItem\);[\s\S]*mode === "none"\) return;/);
});

const overlayDeclarations = () => {
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url));
  const rules = new Map();
  transform({
    filename: "globals.css",
    code: css,
    errorRecovery: true,
    visitor: {
      Rule: {
        style(rule) {
          const selectorText = JSON.stringify(rule.value.selectors);
          if (!selectorText.includes('"drawing-overlay-item"')) return;
          const declarations = [...(rule.value.declarations?.declarations || []), ...(rule.value.declarations?.importantDeclarations || [])];
          const key = rule.value.selectors
            .map((selector) => selector.map((part) => part.name || part.kind).join("."))
            .join(",");
          rules.set(key, declarations);
        },
      },
    },
  });
  return rules;
};

test("the selected overlay style is valid CSS and visibly distinct from every family style", () => {
  const rules = overlayDeclarations();
  const selected = rules.get("drawing-overlay-item.selected");
  assert.ok(selected, "a .drawing-overlay-item.selected rule must exist");
  const unparsed = selected.filter((d) => d.property === "unparsed").map((d) => d.value.propertyId.property);
  assert.deepEqual(unparsed, [], "every .selected declaration must be valid (an invalid value is silently dropped)");
  const properties = selected.map((d) => d.property);
  assert.ok(properties.includes("box-shadow"), "the selection ring must survive parsing");
  assert.ok(
    properties.some((p) => p === "border-color" || p === "border"),
    "selection must set its own border colour, not inherit the family colour (or none)",
  );
  assert.ok(properties.includes("z-index"), "the selected box must paint above same-position neighbours");
});

// Phase 8A-UX-R3 companion: the global `:where(button, …){min-height:40px}`
// comfort rule stretched every overlay box to 40px tall regardless of its
// mapped bbox. Overlay boxes must follow the mapped height (the panel's own
// inline Math.max(…, 4) is the explicit, local usability minimum), while the
// global rule for ordinary application buttons stays untouched.
test("overlay boxes opt out of the global button min-height; ordinary buttons keep it", () => {
  const rules = overlayDeclarations();
  const base = rules.get("drawing-overlay-item");
  assert.ok(base, "a base .drawing-overlay-item rule must exist");
  const minHeight = base.find((d) => d.property === "min-height");
  assert.ok(minHeight, "overlay boxes must set their own min-height");
  assert.match(JSON.stringify(minHeight.value), /"value":0\b/, "overlay min-height must be zero");
  const css = fs.readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  assert.match(css, /:where\(button, input, select, textarea\) \{ min-height: 40px; \}/);
  const panel = fs.readFileSync(new URL("../app/components/drawing/DrawingVisualReviewPanel.tsx", import.meta.url), "utf8");
  assert.match(panel, /height: Math\.max\(box\.height, 4\)/, "the explicit local minimum stays in the panel");
});
