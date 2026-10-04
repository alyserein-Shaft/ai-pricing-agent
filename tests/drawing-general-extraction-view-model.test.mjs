import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGeneralDrawingExtractionProposals } from "../app/domain/drawing-general-extraction-engine.mjs";
import {
  buildGeneralExtractionOverlayItems,
  GENERAL_EXTRACTION_SOURCE_TYPES,
} from "../app/domain/drawing-general-extraction-view-model.mjs";

const PAGE = { id: "page-1", page_number: 1, width: 1000, height: 1000 };
let nextId = 0;
const textAsset = (text, x, y) => ({
  id: `asset-${nextId++}`,
  page_id: PAGE.id,
  asset_type: "Text",
  text_content: text,
  bounding_box: { x, y, width: 20, height: 12, pageWidth: PAGE.width, pageHeight: PAGE.height },
  coordinates_available: true,
});

const buildProposals = () => {
  nextId = 0;
  const assets = [
    textAsset("1", 100, 500),
    textAsset("MAIN FIRE ALARM CONTROL PANEL (MFACP)", 130, 500),
    textAsset("2", 100, 470),
    textAsset("BMS INTERFACE LAN PORT", 130, 470),
    textAsset("3", 100, 440),
    textAsset("PRINTER", 130, 440),
    textAsset("1", 800, 100), // callout
    textAsset("FACP", 800, 300), // equipment candidate
  ];
  return buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
};

test("overlay normalization for new proposal types -- schedule items, callouts, and equipment candidates all become flat overlay items", () => {
  const proposals = buildProposals();
  const items = buildGeneralExtractionOverlayItems(proposals);
  assert.equal(items.filter((item) => item.sourceType === "Equipment").length, 5); // 3 schedule rows + 1 candidate + 1 region
  assert.equal(items.filter((item) => item.sourceType === "Callout").length, 1);
  for (const item of items) {
    assert.equal(item.pageNumber, 1);
    assert.ok(item.boundingBox);
    assert.ok(item.reviewStatus);
  }
  // Callouts are placement inferences -- can never auto-verify.
  for (const item of items.filter((item) => item.sourceType === "Callout")) assert.equal(item.reviewStatus, "Needs Review");
});

test("GENERAL_EXTRACTION_SOURCE_TYPES exposes exactly the two new v0 filter categories", () => {
  assert.deepEqual([...GENERAL_EXTRACTION_SOURCE_TYPES], ["Equipment", "Callout"]);
});

test("a callout overlay item carries its linked schedule item in evidence, matching the inspector's expected shape", () => {
  const proposals = buildProposals();
  const items = buildGeneralExtractionOverlayItems(proposals);
  const callout = items.find((item) => item.sourceType === "Callout");
  assert.equal(callout.label, "Callout 1");
  assert.equal(callout.evidence.linkedScheduleItem.itemNumber, 1);
  assert.equal(callout.evidence.linkedScheduleItem.description, "MAIN FIRE ALARM CONTROL PANEL (MFACP)");
});

test("an equipment/panel candidate overlay item carries its alias and matched schedule item", () => {
  const proposals = buildProposals();
  const items = buildGeneralExtractionOverlayItems(proposals);
  const candidate = items.find((item) => item.semanticType === "Panel Candidate");
  assert.ok(candidate, "FACP should normalize to a Panel Candidate overlay item");
  assert.equal(candidate.evidence.alias, "FACP");
  assert.equal(candidate.evidence.linkedScheduleItem.itemNumber, 1);
});

test("buildGeneralExtractionOverlayItems never produces a SystemConnection sourceType", () => {
  const proposals = buildProposals();
  const items = buildGeneralExtractionOverlayItems(proposals);
  for (const item of items) assert.notEqual(item.sourceType, "SystemConnection");
});

test("an empty/missing proposals object normalizes to an empty overlay list rather than throwing", () => {
  assert.deepEqual(buildGeneralExtractionOverlayItems(null), []);
  assert.deepEqual(buildGeneralExtractionOverlayItems(undefined), []);
});

test("unresolved proposal-level ambiguities are not rendered as overlay items", () => {
  nextId = 0;
  const assets = [
    textAsset("1", 100, 500),
    textAsset("PANEL A", 130, 500),
    textAsset("2", 100, 470),
    textAsset("PANEL B", 130, 470),
    textAsset("2", 100, 440),
    textAsset("PANEL C", 130, 440),
    textAsset("3", 100, 410),
    textAsset("PANEL D", 130, 410),
  ];
  const proposals = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.ok(proposals.unresolved.length > 0);
  const items = buildGeneralExtractionOverlayItems(proposals);
  assert.equal(items.some((item) => item.evidence?.reference === 2 && item.semanticType === "Equipment Schedule Item"), false);
});
