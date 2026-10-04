import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// R7 — FILES SOURCE DRILL-DOWN (no fabricated "Unclassified").
// The knowledge files API returns detected_type/classification_status/
// classification_confidence/secondary_types and a per-file summary (learning
// counts). The files branch previously rendered `document_type || source_type
// || "Unclassified"` and `downstream_use || "Discovery Only"` — keys that do
// not exist in the payload at all, so every one of the 29 files showed a
// fabricated "Unclassified" and a fabricated governance claim "Permitted use:
// Discovery Only". The truthful render uses detected_type (with secondary
// types), classification evidence, a real "Permitted use" only when the file
// (or its summary) actually carries a downstream-use value, and per-file
// evidence counts from summary (products learned / prices discovered / items
// requiring review) as the source drill-down.

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const componentPath = join(
  root,
  "app/components/workspaces/KnowledgeLibraryWorkspace.tsx",
);
const component = readFileSync(componentPath, "utf8");

const workerPath = join(root, "worker/knowledge-library-api.mjs");
const worker = readFileSync(workerPath, "utf8");

const filesBranch = component.slice(component.indexOf("files.map"));
const reviewBranch = component.slice(
  // The review list is rendered from `visibleReviewItems.map` (the filtered
  // list). Anchoring on a bare `reviewItems.map` matched nothing, so the slice
  // below was empty and the assertion could never actually reach the branch.
  component.indexOf("visibleReviewItems.map"),
  component.indexOf("visibleReviewItems.map") + 3000,
);

test("R7 the files branch renders the real detected type, never a fabricated Unclassified", () => {
  assert.match(filesBranch, /file\.detected_type/);
  assert.match(filesBranch, /"Document type not classified"/);
  assert.doesNotMatch(filesBranch, /"Unclassified"/);
});

test("R7 the files branch shows secondary types from the payload", () => {
  assert.match(filesBranch, /file\.secondary_types/);
  assert.match(filesBranch, /secondaryTypes\.join/);
});

test("R7 'Permitted use' is only claimed when the payload really carries a downstream use", () => {
  assert.match(filesBranch, /file\.downstream_use \|\| fileSummary\.downstreamUse/);
  assert.doesNotMatch(filesBranch, /downstream_use \|\| "Discovery Only"/);
});

test("R7 the files branch drills down into per-file evidence counts from summary", () => {
  assert.match(filesBranch, /summaryCount\("productsLearned"\)/);
  assert.match(filesBranch, /summaryCount\("pricesDiscovered"\)/);
  assert.match(filesBranch, /summaryCount\("itemsRequiringReview"\)/);
  assert.match(filesBranch, /evidence\.length/);
  assert.match(filesBranch, /"Source registered"/);
});

test("R7 the review-item fallback is neutral, not a fabricated category", () => {
  assert.match(reviewBranch, /item\.item_type \|\| "Not classified"/);
  assert.doesNotMatch(reviewBranch, /"Unclassified"/);
});

test("R7 the files API serves the truthful classification fields the UI consumes", () => {
  const handler = worker.slice(worker.indexOf('"/api/knowledge/files" && request.method === "GET"'));
  assert.match(handler, /SELECT \* FROM knowledge_files/);
  assert.match(handler, /detected_type/);
  const map = handler.slice(handler.indexOf("return json"));
  assert.match(map, /secondary_types: parse\(row\.secondary_types, \[\]\)/);
  assert.match(map, /summary: parse\(row\.summary, \{\}\)/);
});