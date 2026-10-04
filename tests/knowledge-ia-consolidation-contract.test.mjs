import test from "node:test";
import assert from "node:assert/strict";
import { GLOBAL_DESTINATIONS, buildGlobalLocation, canonicalizeGlobalSearch, globalNavigationSelection, knowledgeSectionFilter, resolveGlobalDestination } from "../app/lib/application-navigation.mjs";

// KN-IA-2 — Knowledge navigation consolidation contract.
// The approved 6-destination IA must be stable, and every removed section
// must survive as a working alias with the right initial filter state.
// Zero capability loss: every original section still resolves somewhere.

const KNOWLEDGE = GLOBAL_DESTINATIONS.find((item) => item.id === "Knowledge");

test("KN-IA-2: exactly six first-level Knowledge destinations, one of them the System Packs group", () => {
  assert.deepEqual(KNOWLEDGE.children.map((item) => item.label), [
    "Sources",
    "Products",
    "Review",
    "Search",
    "System Packs",
    "Case Studies",
  ]);
  const systemPacks = KNOWLEDGE.children.find((item) => item.id === "Knowledge System Packs");
  assert.deepEqual(systemPacks.children.map((item) => item.label), ["Fire Alarm", "CCTV"]);
  assert.equal(systemPacks.section, undefined);
});

test("KN-IA-2: every removed top-level section still resolves to its approved home (zero dead aliases)", () => {
  const expectations = {
    Files: { section: "Sources", workspace: "Knowledge" },
    Sources: { section: "Sources", workspace: "Knowledge" },
    Manufacturers: { section: "Search", workspace: "Knowledge" },
    Standards: { section: "Search", workspace: "Knowledge" },
    "Product Identities": { section: "Review", workspace: "Knowledge" },
    Prices: { section: "Sources", workspace: "Knowledge" },
    "Price Lists": { section: "Sources", workspace: "Knowledge" },
    "Fire Alarm": { section: "Fire Alarm", workspace: "Fire Alarm Knowledge" },
    CCTV: { section: "CCTV", workspace: "CCTV Knowledge" },
    Products: { section: "Products", workspace: "Product Library" },
    "Case Studies": { section: "Case Studies", workspace: "Case Studies" },
  };
  for (const [section, expected] of Object.entries(expectations)) {
    const resolved = resolveGlobalDestination("Knowledge", section);
    assert.equal(resolved.section, expected.section, `section ${section}`);
    assert.equal(resolved.workspace, expected.workspace, `section ${section}`);
  }
});

test("KN-IA-2: legacy aliases carry the initial filter state for their destination surface", () => {
  assert.deepEqual(knowledgeSectionFilter("Manufacturers"), { searchType: "Manufacturer", reviewKind: "All", sourceType: "" });
  assert.deepEqual(knowledgeSectionFilter("Standards"), { searchType: "Standard", reviewKind: "All", sourceType: "" });
  assert.deepEqual(knowledgeSectionFilter("Product Identities"), { searchType: "", reviewKind: "Identities", sourceType: "" });
  assert.deepEqual(knowledgeSectionFilter("Prices"), { searchType: "", reviewKind: "All", sourceType: "Price List" });
  assert.deepEqual(knowledgeSectionFilter("Price Lists"), { searchType: "", reviewKind: "All", sourceType: "Price List" });
  assert.deepEqual(knowledgeSectionFilter("Sources"), { searchType: "", reviewKind: "All", sourceType: "" });
  assert.deepEqual(knowledgeSectionFilter("Review"), { searchType: "", reviewKind: "All", sourceType: "" });
  assert.deepEqual(knowledgeSectionFilter("Search"), { searchType: "", reviewKind: "All", sourceType: "" });
  assert.deepEqual(knowledgeSectionFilter("Fire Alarm"), { searchType: "", reviewKind: "All", sourceType: "" });
});

test("KN-IA-2: canonical search normalizes workspace forms while keeping alias sections stable as deep links", () => {
  // Explicitly requested sections are preserved verbatim so legacy aliases
  // remain stable links whose landing filter state survives refresh.
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=Files"), "?workspace=Knowledge&section=Files");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=Sources"), "?workspace=Knowledge&section=Sources");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=Manufacturers"), "?workspace=Knowledge&section=Manufacturers");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=Standards"), "?workspace=Knowledge&section=Standards");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=Product+Identities"), "?workspace=Knowledge&section=Product+Identities");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=Prices"), "?workspace=Knowledge&section=Prices");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=Fire+Alarm"), "?workspace=Knowledge&section=Fire+Alarm");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge&section=CCTV"), "?workspace=Knowledge&section=CCTV");
  // Absent sections gain the canonical default; legacy workspace names still
  // normalize to the Knowledge workspace form.
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge"), "?workspace=Knowledge&section=Sources");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge+Library"), "?workspace=Knowledge&section=Sources");
  assert.equal(canonicalizeGlobalSearch("?workspace=Pricing+Memory"), "?workspace=Knowledge&section=Sources");
});

test("KN-IA-2: navigation selection highlights the approved child for every alias", () => {
  assert.deepEqual(globalNavigationSelection("Knowledge", "Files"), { parent: "Knowledge", child: "Knowledge Sources" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Prices"), { parent: "Knowledge", child: "Knowledge Sources" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Manufacturers"), { parent: "Knowledge", child: "Knowledge Search" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Standards"), { parent: "Knowledge", child: "Knowledge Search" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Product Identities"), { parent: "Knowledge", child: "Knowledge Review" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "Fire Alarm"), { parent: "Knowledge", child: "Knowledge Fire Alarm" });
  assert.deepEqual(globalNavigationSelection("Knowledge", "CCTV"), { parent: "Knowledge", child: "Knowledge CCTV" });
});

test("KN-IA-2: every canonical destination builds a stable deep link (current + legacy lives under the old URLs)", () => {
  const canonical = ["Sources", "Products", "Review", "Search", "Fire Alarm", "CCTV", "Case Studies"];
  const legacy = ["Files", "Manufacturers", "Standards", "Product Identities", "Prices"];
  for (const section of canonical) {
    assert.equal(buildGlobalLocation("Knowledge", section), `?workspace=Knowledge&section=${encodeURIComponent(section).replace(/%20/g, "+")}`);
  }
  for (const section of legacy) {
    // Legacy URLs may be rewritten by canonicalizeGlobalSearch, but they must
    // never become dead: resolveGlobalDestination still understands them.
    assert.ok(resolveGlobalDestination("Knowledge", section), `legacy ${section} resolves`);
  }
});