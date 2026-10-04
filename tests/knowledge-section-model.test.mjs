import test from "node:test";
import assert from "node:assert/strict";

import {
  KNOWLEDGE_SECTIONS,
  targetSectionFor,
  newViewsRequired,
  engineerSafeSections,
  isEngineerSafe,
} from "../app/domain/knowledge-section-model.mjs";

test("target IA has exactly the nine governed sections", () => {
  assert.deepEqual([...KNOWLEDGE_SECTIONS], [
    "Sources", "Products", "Facts", "Review", "Conflicts",
    "Lifecycle", "System Packs", "Learning", "Diagnostics",
  ]);
});

test("Search folds into Products; unknown sections fail closed to Sources", () => {
  assert.equal(targetSectionFor("Search"), "Products");
  assert.equal(targetSectionFor("Review"), "Review");
  assert.equal(targetSectionFor("SomethingElse"), "Sources");
});

test("new views are exactly the unbuilt surfaces", () => {
  assert.deepEqual([...newViewsRequired()], ["Facts", "Conflicts", "Lifecycle", "Learning", "Diagnostics"]);
});

test("engineer-safe set excludes governance queues", () => {
  assert.deepEqual([...engineerSafeSections()], ["Products", "Facts", "Lifecycle"]);
  assert.equal(isEngineerSafe("Products"), true);
  assert.equal(isEngineerSafe("Review"), false);
  assert.equal(isEngineerSafe("Diagnostics"), false);
});
