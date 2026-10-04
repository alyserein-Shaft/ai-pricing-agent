import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

// Demo Stabilization Sprint (item 2): the search endpoint and its backend
// scope (drawing_structure_cells only) were already real and correct --
// these tests only cover what changed: a visible zero-result state, real
// Enter-key submission via a <form>, and honest scope copy. No backend
// file changes; this file only asserts the frontend wiring in app/page.tsx.
const page = fs.readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("Drawing Structure Search shows a visible zero-result state after a completed search, not before", () => {
  assert.match(page, /No matching reconstructed cells found\./);
  // gated on a "search actually ran" flag, not just an empty results array,
  // so the tab's initial (never-searched) state never shows this message
  assert.match(
    page,
    /structureSearchRan &&\s*\n?\s*!structureSearchResults\.length/,
  );
  assert.match(page, /const \[structureSearchRan, setStructureSearchRan\] = useState\(false\);/);
  assert.match(page, /setStructureSearchRan\(true\);/);
});

test("Drawing Structure Search resets its zero-result flag when the workspace closes", () => {
  assert.match(page, /setStructureSearchResults\(\[\]\);\s*\n\s*setStructureSearchRan\(false\);/);
});

test("Enter key submits the same search action as the button, via a real form", () => {
  assert.match(
    page,
    /<form[\s\S]{0,120}className="drawing-search"[\s\S]{0,200}onSubmit=\{\(event\) => \{[\s\S]{0,80}event\.preventDefault\(\);[\s\S]{0,80}void searchStructure\(\);/,
  );
  assert.match(page, /<button type="submit">Search<\/button>/);
});

test("scope copy honestly names what is searched, without redefining it as full-text search", () => {
  assert.match(page, /Search reconstructed structure cells\./);
  assert.doesNotMatch(page, /full[-\s]?text search|semantic search|search (the )?(raw )?PDF\b/i);
});
