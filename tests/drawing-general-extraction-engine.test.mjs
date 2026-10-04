import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGeneralDrawingExtractionProposals } from "../app/domain/drawing-general-extraction-engine.mjs";
import {
  FCC_ROOM_DETAILS_PAGES,
  FCC_ROOM_DETAILS_ASSETS,
  FCC_ROOM_DETAILS_PAGE_ID,
} from "./golden/fcc-room-details.fixture.mjs";

const PAGE = { id: "page-1", page_number: 1, width: 1000, height: 1000 };

let nextId = 0;
const textAsset = (text, x, y, width = 20, height = 12) => ({
  id: `asset-${nextId++}`,
  page_id: PAGE.id,
  asset_type: "Text",
  text_content: text,
  bounding_box: { x, y, width, height, pageWidth: PAGE.width, pageHeight: PAGE.height },
  coordinates_available: true,
});

// A synthetic 3-row numbered schedule: number column at x=100, description
// column at x=130, evenly spaced rows -- the minimal shape the column
// detector needs to recognize a genuine list (>= 3 rows).
const buildSyntheticSchedule = (rows) => {
  nextId = 0;
  const assets = [];
  rows.forEach(([number, description], index) => {
    const y = 500 - index * 30;
    assets.push(textAsset(String(number), 100, y));
    assets.push(textAsset(description, 130, y));
  });
  return assets;
};

test("numbered schedule-row extraction -- a repeating number+description column is recognized as a schedule", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.scheduleItems.length, 3);
  assert.deepEqual(
    result.scheduleItems.map((item) => item.itemNumber).sort((a, b) => a - b),
    [1, 2, 3],
  );
});

test("equipment schedule item normalization -- label, category and alias fields are derived correctly", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "IP TELEPHONE"],
    [3, "WORK TABLE"],
  ]);
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  const panel = result.scheduleItems.find((item) => item.itemNumber === 1);
  assert.equal(panel.normalizedLabel, "MAIN FIRE ALARM CONTROL PANEL (MFACP)");
  assert.equal(panel.category, "Panel");
  assert.deepEqual(panel.aliases, ["MFACP"]);

  const phone = result.scheduleItems.find((item) => item.itemNumber === 2);
  assert.equal(phone.category, "Telephone");

  const table = result.scheduleItems.find((item) => item.itemNumber === 3);
  assert.equal(table.category, "Furniture");
});

test("callout number detection -- a standalone number elsewhere on the page is found independently of the schedule column", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("1", 800, 100)); // far from the schedule column -> a callout
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.callouts.length, 1);
  assert.equal(result.callouts[0].reference, 1);
});

test("callout -> schedule-row association -- the callout carries the matched schedule item, not just a bare number", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("3", 800, 100));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.callouts[0].matchedScheduleItem.itemNumber, 3);
  assert.equal(result.callouts[0].matchedScheduleItem.description, "PRINTER");
});

test("no system-connectivity inference from mere geometric contact -- touching/overlapping geometry never produces a SystemConnectionCandidate", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  // Two callouts whose bounding boxes are made to touch/overlap -- a naive
  // geometry-adjacency engine might read this as "connected." This one must
  // not: it has no code path that produces system connectivity at all.
  assets.push(textAsset("1", 800, 100, 20, 12));
  assets.push(textAsset("2", 815, 100, 20, 12)); // overlaps the previous box
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /SystemConnection/);
  const allTypes = new Set([
    ...result.scheduleItems.map((i) => i.proposalType),
    ...result.callouts.map((i) => i.proposalType),
    ...result.equipmentCandidates.map((i) => i.proposalType),
    ...result.regionCandidates.map((i) => i.proposalType),
    ...result.unresolved.map((i) => i.proposalType),
  ]);
  for (const type of allTypes) assert.notEqual(type, "SystemConnectionCandidate");
});

test("leader classification remains proposal-level -- callouts never fabricate leader geometry and are always Needs Review", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("1", 800, 100));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.callouts[0].evidence.leaderGeometry, null);
  // Callouts are placement-context inferences with no legend/tag/riser
  // corroboration -- they can never reach Verified, regardless of the
  // schedule row's own governed status.
  assert.equal(result.callouts[0].reviewStatus, "Needs Review");
});

test("FACP/MFACP alias normalization -- a standalone acronym token resolves to the schedule row via its parenthetical/suffix alias", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("FACP", 800, 300));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.equipmentCandidates.length, 1);
  assert.equal(result.equipmentCandidates[0].proposalType, "PanelCandidate");
  assert.equal(result.equipmentCandidates[0].alias, "FACP");
  assert.equal(result.equipmentCandidates[0].matchedScheduleItem.itemNumber, 1);
});

test("malformed/ambiguous schedule row remains unresolved -- a repeated row number in one column is not silently guessed", () => {
  nextId = 0;
  const assets = [];
  // A qualifying 3-row column where row number "2" is duplicated with two
  // different descriptions at the same aligned position.
  assets.push(textAsset("1", 100, 500), textAsset("PANEL A", 130, 500));
  assets.push(textAsset("2", 100, 470), textAsset("PANEL B", 130, 470));
  assets.push(textAsset("2", 100, 440), textAsset("PANEL C", 130, 440));
  assets.push(textAsset("3", 100, 410), textAsset("PANEL D", 130, 410));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.scheduleItems.some((item) => item.itemNumber === 2), false);
  assert.ok(result.unresolved.some((entry) => /Row number 2/.test(entry.reason)));
});

test("output provenance includes document/page/bbox -- every proposal type carries pageNumber, boundingBox and source asset references", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("1", 800, 100));
  assets.push(textAsset("FACP", 800, 300));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  const allItems = [
    ...result.scheduleItems,
    ...result.callouts,
    ...result.equipmentCandidates,
    ...result.regionCandidates,
  ];
  assert.ok(allItems.length > 0);
  for (const item of allItems) {
    assert.equal(item.pageNumber, 1);
    assert.ok(item.boundingBox, `${item.proposalType} is missing a boundingBox`);
    assert.ok(Array.isArray(item.sourceReferences) && item.sourceReferences.length > 0);
  }
});

test("a two-row candidate list is not mistaken for a schedule -- the column detector requires at least three rows", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
  ]);
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.scheduleItems.length, 0);
});

test("REGRESSION (engineer-confirmed FCC rule): geometrically connected room/furniture/callout linework must never become authoritative system connectivity", () => {
  // Real Drawing Intake output for the engineer-validated FCC ROOM DETAILS
  // drawing -- the same sheet where a prior spatial-clustering pass wrongly
  // merged room geometry, furniture, leaders and symbols into one 94-
  // segment "connected" electrical system. This engine must never repeat
  // that: it has no geometry-adjacency-to-connectivity code path at all.
  const result = buildGeneralDrawingExtractionProposals({
    pages: FCC_ROOM_DETAILS_PAGES,
    assets: FCC_ROOM_DETAILS_ASSETS,
  });
  assert.doesNotMatch(JSON.stringify(result), /SystemConnection/);
  // Placement/connectivity-adjacent inferences (callouts) and identity/
  // alias guesses (equipment candidates) must NEVER auto-verify -- that is
  // the actual governance invariant this regression protects, not a blanket
  // "everything stays Needs Review" (a self-detected schedule TABLE row is
  // legitimately allowed to reach Verified; the room/furniture/callout
  // GEOMETRY-adjacent inferences are not).
  assert.ok(result.callouts.length > 0);
  for (const callout of result.callouts) assert.equal(callout.reviewStatus, "Needs Review");
  assert.ok(result.equipmentCandidates.length > 0);
  for (const candidate of result.equipmentCandidates) {
    assert.equal(candidate.reviewStatus, "Needs Review");
    assert.equal(candidate.identityStatus, "Potential Alias");
  }
});

test("real FCC ROOM DETAILS acceptance target -- the engineer-specified minimum callout/schedule mappings are all correctly identified", () => {
  const result = buildGeneralDrawingExtractionProposals({
    pages: FCC_ROOM_DETAILS_PAGES,
    assets: FCC_ROOM_DETAILS_ASSETS,
  });
  const byNumber = new Map(result.scheduleItems.map((item) => [item.itemNumber, item.description]));
  assert.equal(byNumber.get(1), "MAIN FIRE ALARM CONTROL PANEL (MFACP)");
  assert.equal(byNumber.get(4), "FIRE ALARM WORK STATION (GUI)");
  assert.equal(byNumber.get(11), "PRINTER");
  assert.equal(byNumber.get(12), "IP TELEPHONE");
  assert.equal(byNumber.get(13), "PSTN TELEPHONE (DIRECT LINE)");
  assert.equal(byNumber.get(14), "WORK TABLE");
  // All 14 rows resolve for this drawing (a stronger result than the
  // engineer-specified minimum, not a hardcoded requirement of the engine).
  assert.equal(result.scheduleItems.length, 14);

  const facpCandidate = result.equipmentCandidates.find((c) => c.alias === "FACP");
  assert.ok(facpCandidate, "FACP should be recognized as an equipment/panel candidate");
  assert.equal(facpCandidate.proposalType, "PanelCandidate");
  assert.equal(facpCandidate.matchedScheduleItem.itemNumber, 1);

  // Every callout the engine proposes for this real sheet must reference a
  // page and a source asset id that genuinely exists in the fixture --
  // provenance is never fabricated.
  const realAssetIds = new Set(FCC_ROOM_DETAILS_ASSETS.map((asset) => asset.id));
  for (const callout of result.callouts) {
    assert.equal(callout.pageNumber, 1);
    for (const ref of callout.sourceReferences) assert.ok(realAssetIds.has(ref));
  }
});

// WORKSTREAM 1 -- false-positive callout reduction.

test("title-block exclusion -- a bare integer adjacent to a standard title-block label is excluded outright, not surfaced as a low-confidence callout", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  // "STAGE" label immediately followed by its value "1" -- a title-block
  // field, not a callout, even though "1" numerically matches row 1.
  assets.push(textAsset("STAGE", 800, 100, 40));
  assets.push(textAsset("1", 850, 100));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.callouts.length, 0);
  assert.equal(result.excludedCallouts.length, 1);
  assert.equal(result.excludedCallouts[0].reference, 1);
  assert.match(result.excludedCallouts[0].reason, /title-block/i);
});

test("title-block exclusion generalizes across several standard label keywords, not just one hardcoded case", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("PHASE", 800, 300, 40), textAsset("2", 850, 300));
  assets.push(textAsset("REVISION", 800, 500, 60), textAsset("3", 870, 500));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.callouts.length, 0);
  assert.equal(result.excludedCallouts.length, 2);
});

test("a bare integer far from any title-block label still becomes a real (Needs Review) callout", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("1", 800, -400)); // nowhere near any label
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.equal(result.callouts.length, 1);
  assert.equal(result.excludedCallouts.length, 0);
  assert.equal(result.callouts[0].reviewStatus, "Needs Review");
});

test("a bare integer alone is never treated as a high-confidence callout -- every callout's governed status is Needs Review, never Verified", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("1", 800, 100));
  assets.push(textAsset("2", 800, 300));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  assert.ok(result.callouts.length > 0);
  // A callout is placement-context evidence with no legend defining the
  // "circled number = schedule reference" convention on this sheet -- the
  // missing-legend hard-review trigger forces Needs Review even though
  // Floor Plan is nominally the Primary authority for DevicePlacement.
  for (const callout of result.callouts) {
    assert.equal(callout.governedStatus, "Needs Review");
    assert.ok(callout.hardReviewReasons.some((reason) => /legend/i.test(reason)));
  }
});

// WORKSTREAM 4 -- equipment identity / alias safety.

test("FACP/MFACP name similarity alone must NOT produce automatic identity merge", () => {
  const assets = buildSyntheticSchedule([
    [1, "MAIN FIRE ALARM CONTROL PANEL (MFACP)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("FACP", 800, 300));
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  const candidate = result.equipmentCandidates[0];
  assert.ok(candidate);
  // The two labels are kept structurally separate -- never unified into one
  // canonical identity.
  assert.equal(candidate.rawLabel, "FACP");
  assert.equal(candidate.potentialMatch.rawLabel, "MAIN FIRE ALARM CONTROL PANEL (MFACP)");
  assert.equal(candidate.canonicalType, null);
  assert.equal(candidate.identityStatus, "Potential Alias");
  assert.notEqual(candidate.identityStatus, "Same Instance");
  assert.notEqual(candidate.identityStatus, "Merged");
  // And the governed status can never be Verified for an alias guess alone.
  assert.equal(candidate.governedStatus, "Needs Review");
  assert.ok(candidate.hardReviewReasons.some((reason) => /alias/i.test(reason)));
});

test("identity safety holds even for an exact parenthetical-acronym match, not just a fuzzy suffix match", () => {
  const assets = buildSyntheticSchedule([
    [1, "FIRE ALARM WORK STATION (GUI)"],
    [2, "BMS INTERFACE LAN PORT"],
    [3, "PRINTER"],
  ]);
  assets.push(textAsset("GUI", 800, 300)); // exact parenthetical acronym match, highest confidence tier
  const result = buildGeneralDrawingExtractionProposals({ pages: [PAGE], assets });
  const candidate = result.equipmentCandidates.find((c) => c.alias === "GUI");
  assert.ok(candidate);
  assert.equal(candidate.confidence, 85); // high confidence...
  assert.equal(candidate.governedStatus, "Needs Review"); // ...but confidence alone never grants approval authority
  assert.equal(candidate.identityStatus, "Potential Alias");
});
