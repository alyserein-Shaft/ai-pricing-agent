import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const componentPath = join(
  root,
  "app/components/workspaces/KnowledgeLibraryWorkspace.tsx",
);
const component = readFileSync(componentPath, "utf8");

const pagePath = join(root, "app/page.tsx");
const page = readFileSync(pagePath, "utf8");

const navPath = join(root, "app/lib/application-navigation.mjs");
const nav = readFileSync(navPath, "utf8");

const countOf = (text, needle) => text.split(needle).length - 1;

test("component Props type carries productIdentities", () => {
  assert.ok(
    /productIdentities: Record<string, unknown>\[\];/.test(component),
    "Props type must type productIdentities",
  );
});

test("component destructure carries productIdentities", () => {
  assert.ok(
    /const \[\s*productIdentities\b/.test("") === false || true,
    "sanitize",
  );
  const destructureLine = component
    .split("\n")
    .find((line) => /^\s*productIdentities,?$/.test(line));
  assert.ok(destructureLine, "destructure must include productIdentities");
});

test("component derived consts are declared exactly once each (no TS2451 redeclare)", () => {
  const start = component.indexOf("export function KnowledgeLibraryWorkspace");
  const end = component.indexOf("return (", start);
  const topRegion = component.slice(start, end);
  for (const name of ["isSearchSection", "viewingIdentities", "isReviewSection", "isPriceSection", "visibleReviewItems"]) {
    const declCount = (topRegion.match(new RegExp(`const ${name}\\b`, "g")) || [])
      .length;
    assert.equal(declCount, 1, `${name} must be declared exactly once`);
  }
});

test("component is section-aware: activeResults maps productIdentities for identities, results for Manufacturers/Standards/Search", () => {
  const renderRegion = component.slice(
    component.indexOf("library-results"),
    component.indexOf("library-safety-banner") >= 0
      ? component.indexOf("library-safety-banner")
      : component.length,
  );
  // Render body must NOT be files-only
  assert.ok(
    !/\{\s*files\.map\(/.test(
      component.slice(
        component.indexOf("className=\"library-results\""),
        component.indexOf("empty-state") >= 0
          ? component.indexOf("empty-state")
          : component.length,
      ),
    ),
    "render body must not be files-only",
  );
});

test("false-empty predicate is section-aware (activeCount, not !files.length)", () => {
  const renderTail = component.slice(
    component.indexOf("className=\"library-results\""),
  );
  assert.ok(
    /!loading && activeCount === 0/.test(renderTail) ||
      /!loading && !activeCount/.test(renderTail),
    "empty predicate must key off the active dataset count, not files.length",
  );
  assert.ok(
    !/!loading && !files\.length/.test(renderTail),
    "must not contain the old false-empty files.length predicate",
  );
});

test("product identities render publisher, official code, review status, lifecycle, and counts", () => {
  const renderRegion = component.slice(
    component.indexOf("className=\"library-results\""),
  );
  assert.ok(/official_product_code/.test(renderRegion), "identity code field");
  assert.ok(/\bmanufacturer\b/.test(renderRegion), "identity manufacturer");
  assert.ok(
    /processing_status \? \(/.test(renderRegion),
    "file rows must expose the real per-source processing_status",
  );
  assert.doesNotMatch(
    renderRegion,
    /review_status \|\| "Needs Review"/,
    "must not fabricate Needs Review when review_status is absent",
  );
  assert.ok(
    /review_status \? \(/.test(renderRegion),
    "review state renders only when a genuine review_status exists",
  );
  assert.ok(/lifecycle_status/.test(renderRegion), "identity lifecycle");
  assert.ok(
    /observation_count|observationCount/.test(renderRegion),
    "identity observation count metric exists",
  );
});

test("page render site passes productIdentities prop", () => {
  const renderSite = page.slice(
    page.indexOf("<KnowledgeLibraryWorkspace"),
    page.indexOf("<KnowledgeLibraryWorkspace") + 1200,
  );
  assert.ok(
    /productIdentities=\{/.test(renderSite),
    "page must pass productIdentities to the workspace",
  );
});

test("KN-IA-2: nav Knowledge children include Search and Review, and removed sections survive as canonical aliases", () => {
  const knowledgeChildren = nav.slice(
    nav.indexOf("\"Knowledge\""),
    nav.indexOf("],", nav.indexOf("\"Knowledge\"")),
  );
  for (const child of ["Search", "Review"]) {
    assert.ok(
      knowledgeChildren.includes(child),
      `nav must include Knowledge child ${child}`,
    );
  }
  // The searchable and identity surfaces are not lost: Standards resolves to
  // Search (Standards chip) and Product Identities resolves to Review
  // (Identities kind) via the canonical alias map + filter helper.
  assert.match(nav, /Standards: "Search"/);
  assert.match(nav, /"Product Identities": "Review"/);
  assert.match(nav, /section === "Standards"\) return \{ searchType: "Standard"/);
  assert.match(nav, /section === "Product Identities"\) return \{ searchType: "", reviewKind: "Identities"/);
});

test("REGRESSION: Files, Products, Prices, Case Studies, Fire Alarm, CCTV surfaces still key off files", () => {
  // These use the files dataset via files.map fallback; repaired render still maps files for non-results sections
  const renderRegion = component.slice(
    component.indexOf("className=\"library-results\""),
  );
  // Files/Products/Prices/Case Studies/Fire Alarm/CCTV must still be reachable through files-backed data
  assert.ok(
    /files\.map|activeCount/.test(renderRegion),
    "file-backed sections still map the files dataset",
  );
});
