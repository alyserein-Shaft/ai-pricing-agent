import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// R4 — PRICES TRUTH (Knowledge Prices / Price Lists section).
// The Prices section previously presented a "FILES" metric over price-list
// source files and no truthful price information at all. It must present the
// real prices_discovered total from the knowledge summary with honest
// context: the visible rows are the price-list SOURCE FILES that produced
// those prices, and discovered prices stay Discovery-Only until governed
// approval. The row-level fabrication ("Unclassified", "Permitted use:
// Discovery Only") is owned by R7.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const componentPath = join(
  root,
  "app/components/workspaces/KnowledgeLibraryWorkspace.tsx",
);
const component = readFileSync(componentPath, "utf8");

const pagePath = join(root, "app/page.tsx");
const page = readFileSync(pagePath, "utf8");

const workerPath = join(root, "worker/knowledge-library-api.mjs");
const worker = readFileSync(workerPath, "utf8");

test("R4 the Prices section presents a PRICES metric from the truthful summary total, not a FILES count", () => {
  const metricRegion = component.slice(
    component.indexOf("knowledge-metrics"),
    component.indexOf("</div>", component.indexOf("knowledge-metrics") + 200),
  );
  assert.match(metricRegion, /PRICES/);
  assert.match(metricRegion, /summary\.prices_discovered/);
  assert.match(metricRegion, /isPriceSection/);
  // The Prices view is still recognized (legacy deep links) and now also via
  // the Sources Price Lists chip, both gated in the same derived flag.
  assert.match(component, /section === "Prices" \|\| section === "Price Lists"/);
  assert.match(component, /sourceType === "Price List"/);
  // It must never claim a file count for a prices section.
  assert.doesNotMatch(
    metricRegion,
    /<small>FILES<\/small><strong>\{String\(files\.length\)\}<\/strong>/,
  );
});

test("R4 the Prices section copy explains the price truth honestly", () => {
  const headingRegion = component.slice(
    component.indexOf("module-heading"),
    component.indexOf("module-heading") + 1400,
  );
  assert.match(headingRegion, /isPriceSection/);
  assert.match(
    headingRegion,
    /Price evidence discovered from \$\{files\.length\} price-list source file/,
  );
  assert.match(
    headingRegion,
    /stay Discovery-Only until governed approval/,
  );
  assert.match(headingRegion, /summary\.prices_discovered/);
});

test("R4 the workspace props type the summary bag (prices_discovered is reachable)", () => {
  const props = component.slice(component.indexOf("type Props"), component.indexOf("export function"));
  assert.match(props, /summary: Record<string, unknown>;/);
});

test("R4 the page passes the knowledge summary through to the workspace", () => {
  assert.match(page, /summary=\{knowledgeSummary as unknown as Record<string, unknown>\}/);
});

test("R4 the knowledge summary API serves the truthful prices_discovered total", () => {
  const summaryRegion = worker.slice(worker.indexOf('"/api/knowledge/summary"'));
  assert.match(summaryRegion, /prices_discovered/);
  assert.match(summaryRegion, /COUNT\(\*\)/);
});