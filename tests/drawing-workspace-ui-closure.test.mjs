import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

// Stage 10 (2026-09-01): DRAWING UI CLOSURE. This codebase's established
// pattern (every prior stage) proves UI truth via static source assertions
// against app/page.tsx combined with real backend-level tests -- there is
// no jsdom/testing-library dependency in this project. This file covers
// Section 21's checklist directly.
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const panel = fs.readFileSync(
  new URL("../app/components/drawing/DrawingVisualReviewPanel.tsx", import.meta.url),
  "utf8",
);

// Drawing Workspace redesign (2026-09-18): the old "Primary Summary" block of
// metadata columns and the Attention / Next Action banners are gone. The same
// governed material now lives in the workspace shell's two secondary views
// (Drawing information / History & tools) and in the review panel's Needs
// attention tab. These helpers slice the SAME source regions so every closure
// invariant below is still asserted where that material actually renders now.
const workspaceStart = page.indexOf("Drawing Workspace redesign (2026-09-18)");
assert.notEqual(workspaceStart, -1, "the drawing workspace block must exist");
const informationStart = page.indexOf("const drawingInformationContent = (", workspaceStart);
const legacyStart = page.indexOf("const legacyToolsContent = (", workspaceStart);
const workspaceEnd = page.indexOf("{symbolWorkspaceDocument && (", workspaceStart);
assert.ok(informationStart > workspaceStart && legacyStart > informationStart && workspaceEnd > legacyStart);
// Everything the workspace shows OUTSIDE the legacy intake index.
const mainRegion = page.slice(workspaceStart, legacyStart);
const legacyRegion = page.slice(legacyStart, workspaceEnd);
const drawingInformationRegion = page.slice(informationStart, legacyStart);

const indexOf = (needle, from = 0) => {
  const index = page.indexOf(needle, from);
  assert.notEqual(index, -1, `expected to find: ${needle}`);
  return index;
};

test("Drawing information reads Stage 7.5's authoritative structural Sheet Identity, not the legacy intake metadata, for Drawing Identity", () => {
  assert.match(mainRegion, /structureWorkspaceData\?\.version\.summary\.sheetIdentities/);
  assert.doesNotMatch(
    mainRegion,
    /drawingWorkspaceData\.metadata/,
    "nothing outside the legacy intake index may read the legacy, non-authoritative intake metadata as identity truth",
  );
  // Identity values shown to the engineer still come from the resolved /
  // structural sources, and the one intake-sourced field is explicitly
  // labelled as recorded at intake rather than presented as truth.
  assert.match(drawingInformationRegion, /titleResolution\.value/);
  assert.match(drawingInformationRegion, /revisionDisplay \|\| "Needs Review"/);
  assert.match(drawingInformationRegion, /Drawing number \(recorded at intake\)/);
  assert.match(legacyRegion, /drawingWorkspaceData\.metadata/, "the legacy metadata read still exists, inside the legacy index");
});

test("the legacy tab system (Overview/Pages/Metadata/Assets/Legend/Search/Version History) is demoted into History & tools, closed by default", () => {
  assert.match(legacyRegion, /Legacy intake index/);
  for (const tab of ["Overview", "Pages", "Metadata", "Assets", "Legend", "Search", "Version History"]) {
    assert.match(legacyRegion, new RegExp(`"${tab}"`), `the legacy ${tab} tab still exists (not deleted), inside the legacy index`);
  }
  assert.doesNotMatch(mainRegion, /drawing-workspace-tabs/, "the legacy tab nav must not render in the opening view");
  // Collapsed by default: every <details> in History & tools opens without an
  // `open` prop, so nothing in it is expanded when the view is first shown.
  assert.doesNotMatch(legacyRegion, /<details[^>]*\sopen\b/);
  assert.doesNotMatch(panel, /<details className="dwx-tool"[^>]*\sopen\b/);
  assert.match(legacyRegion, /<details\s+className="dwx-tool"/);
  // The legacy-only disclaimer lives with the legacy section, not in the main view.
  assert.match(legacyRegion, /legacy, non-authoritative early read/);
  assert.doesNotMatch(mainRegion, /legacy, non-authoritative early read/);
  // History & tools is itself a secondary view, never the opening one.
  assert.match(panel, /const \[secondaryView, setSecondaryView\] = useState<SecondaryView \| null>\(null\)/);
});

test("quantity evidence is never presented as BOQ truth -- explicit evidence language throughout", () => {
  const workspace = page.slice(workspaceStart, workspaceEnd);
  assert.match(workspace, /approved occurrence\(s\)/);
  assert.doesNotMatch(workspace, /device count/i);
});

test("a partial-coverage quantity mismatch is structurally distinct from a conclusive one -- no shared 'Conflict' wording between the two branches", () => {
  const partialIndex = indexOf("Drawing review incomplete");
  const conclusiveIndex = indexOf("conclusiveCoverage ? (");
  assert.ok(conclusiveIndex < partialIndex, "the conclusive-coverage branch must be checked before falling through to the partial/incomplete branch");
  assert.match(page.slice(partialIndex, partialIndex + 400), /Working Quantity/);
  assert.match(page.slice(partialIndex, partialIndex + 1200), /Continue Drawing Review/);
});

test("the Quantity Source Decision write path is the SAME real backend endpoint used by both the Requirement Profiles panel (Stage 9) and the Drawing Workspace (Stage 10)", () => {
  const matches = [...page.matchAll(/\/api\/boq-items\/\$\{encodeURIComponent\(([a-zA-Z.]+)\)\}\/quantity-source-decision/g)];
  assert.ok(matches.length >= 2, "at least the Stage 9 panel and Stage 10 drawing-workspace call sites must exist");
});

test("linked requirement navigation reuses the real BOQ module + a real DOM anchor, not a browser-only scroll with no target", () => {
  const fnStart = indexOf("const viewLinkedRequirement = ");
  const fnBody = page.slice(fnStart, page.indexOf("};", fnStart));
  assert.match(fnBody, /setActiveModule\("BOQ"\)/);
  assert.match(fnBody, /getElementById\(`requirement-profile-\$\{boqItemId\}`\)/);
  assert.match(page, /id=\{`requirement-profile-\$\{item\.id\}`\}/, "the anchor target must actually exist on the requirement profile article");
});

test("linked Product Selection navigation reuses the SAME real selection state Technical Matching's own item-select handler uses", () => {
  const fnStart = indexOf("const viewProductSelectionForItem = ");
  const fnBody = page.slice(fnStart, page.indexOf("};", fnStart));
  assert.match(fnBody, /setActiveModule\("Technical Matching"\)/);
  assert.match(fnBody, /setSelectedMatchingItemId\(boqItemId\)/);
  assert.match(fnBody, /buildProjectLocation\(projectId, "Technical Matching", boqItemId\)/);
});

test("stale drawing evidence renders a real recalculate action wired to the requirement-profile recalculate endpoint", () => {
  const fnStart = indexOf("const recalculateLinkedRequirement = ");
  const fnBody = page.slice(fnStart, page.indexOf("\n  };", fnStart));
  assert.match(fnBody, /\/requirement-profile\/recalculate/);
});

test("the unsupported (raster/CAD) drawing state renders no do-nothing button -- a Needs-attention entry degrades to plain text when there is no real action", () => {
  // The duplicate Attention + Next Action banners are gone; a single Needs
  // attention list replaces both, and an entry only renders a control when a
  // real action (or a real record to inspect) exists.
  assert.doesNotMatch(page, /drawing-attention-panel/, "the old Attention banner must be gone");
  assert.doesNotMatch(page, /drawing-next-action/, "the old Next Action banner must be gone");
  assert.match(panel, /entry\.onAction \? \(/);
  assert.match(panel, /\) : entry\.itemId \? \(/);
  assert.doesNotMatch(page, /label: "Review Manually", onClick: \(\) => \{\}/, "the old inert no-op Next Action handler must be gone");
});

test("every workspace action either opens a real view/overlay or calls a real fetch-backed handler -- no inline no-op onClick anywhere in the workspace", () => {
  assert.doesNotMatch(page.slice(workspaceStart, workspaceEnd), /onClick=\{\(\) => \{\}\}/);
  assert.doesNotMatch(panel, /onClick=\{\(\) => \{\}\}/);
});

test("opening a drawing loads symbol, structure, quantity evidence and requirement impact data together, without opening their separate advanced overlays", () => {
  const fnStart = indexOf("const openDrawingWorkspace = ");
  const fnBody = page.slice(fnStart, page.indexOf("};", fnStart));
  assert.match(fnBody, /loadSymbolWorkspace\(document, false\)/);
  assert.match(fnBody, /loadStructureWorkspace\(document, false\)/);
  assert.match(fnBody, /loadQuantityEvidence\(document\)/);
  assert.match(fnBody, /loadDrawingRequirementImpact\(document\)/);
});

test("Requirement Profiles panel exposes a real 'View Drawing Evidence' back-link to the Drawing Workspace (Section 15)", () => {
  assert.match(page, /View Drawing Evidence/);
  assert.match(page, /openDrawingWorkspace\(drawingDocument\)/);
});

test("the Sheet Identity and Occurrences advanced tabs are reachable directly (not defaulted to an unrelated tab) from the Primary Summary's actions", () => {
  assert.match(page, /tab: typeof structureWorkspaceTab = "Sheet Identity"/);
  assert.match(page, /tab: typeof symbolWorkspaceTab = "Definitions"/);
  assert.match(page, /openStructureWorkspace\(drawingWorkspaceDocument, "Sheet Identity"\)/);
  assert.match(page, /openSymbolWorkspace\(drawingWorkspaceDocument, "Occurrences"\)/);
});

test("the one overall status label uses concise engineer-facing vocabulary (Section 17), not internal processor/version labels", () => {
  for (const state of ["Ready", "Needs Review", "Partial", "Conflict", "Unsupported", "Stale"]) {
    assert.match(page, new RegExp(state === "Needs Review" ? '"Needs Review"' : `"${state}"`));
  }
  const workspace = page.slice(workspaceStart, workspaceEnd);
  assert.doesNotMatch(workspace, /candidate fingerprint|raw confidence payload|graph version/i);
  // Exactly one overall label, rendered once, in the header.
  assert.match(page, /const overallStatusLabel =/);
  assert.equal(
    (panel.match(/className="dwx-overall-status"/g) || []).length,
    1,
    "the overall status label must be rendered exactly once",
  );
  assert.match(panel, /\{overallStatusLabel && <span className="dwx-overall-status">\{overallStatusLabel\}<\/span>\}/);
  // "Ready" must not read as engineering approval.
  assert.doesNotMatch(workspace, /overallStatusLabel[\s\S]{0,400}?"Approved"/);
});
