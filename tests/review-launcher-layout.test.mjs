import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");

test("review tools remain in document flow and never cover BOQ rows", () => {
  assert.match(css, /\.app-shell \{ min-height: 100vh; display: block; overflow-x: hidden; \}/);
  assert.match(css, /\.review-launcher-stack \{ position:static;/);
  assert.doesNotMatch(css, /\.review-launcher-stack \{ position:fixed;/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
});

test("review tools collapse to one column on narrower layouts", () => {
  assert.match(css, /@media \(max-width:1100px\) \{ \.review-launcher-stack \{ grid-template-columns:1fr;/);
  assert.match(css, /@media \(max-width:900px\) \{ \.review-launcher-stack \{ margin-left:18px; \}/);
});
