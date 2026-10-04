import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// FINAL BOQ WORKSPACE CLOSURE PASS -- static-source proofs for the BOQ
// branch of app/page.tsx. This file follows the codebase's own established
// pattern (see tests/boq-workspace-specification-cta-authority.test.mjs,
// tests/boq-bulk-review-contract.test.mjs) for page.tsx-internal render
// logic that is not independently exported: assert on the exact source
// text the render path depends on, scoped to the BOQ branch specifically so
// a match elsewhere in this very large file can't produce a false pass.

const page = async () => readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const boqBranch = async () => {
  const source = await page();
  const start = source.indexOf('activeModule === "BOQ" ? (');
  const end = source.indexOf('activeModule === "AI Understanding Review" ? (', start);
  assert.ok(start > -1 && end > start, "BOQ branch markers must exist in app/page.tsx");
  return source.slice(start, end);
};

test("current BOQ item counts are backend-authoritative (serverProjectDashboard.facts), never re-derived from the cached per-document row fetch", async () => {
  const branch = await boqBranch();
  assert.match(branch, /serverProjectDashboard\?\.facts\.boqItems|serverProjectDashboard\.facts\.boqItems/);
  assert.match(branch, /serverProjectDashboard\.facts\.extractionReview/);
  assert.match(branch, /serverProjectDashboard\.facts\.structuralRows/);
  assert.match(branch, /serverProjectDashboard\.facts\.possibleDuplicates/);
  // The stat spans must not fall back to extractedBoqItems.filter(...).length --
  // that client-side re-derivation was the root cause of the 46-vs-54 defect.
  const statsBlock = branch.slice(branch.indexOf('className="extraction-proof"'), branch.indexOf("</div>", branch.indexOf('className="extraction-proof"')));
  assert.doesNotMatch(statsBlock, /extractedBoqItems\.filter/);
});

test("multi-source breakdown (source filter chips) is derived from serverProjectDashboard.boqSources, never from extractedBoqItems counts", async () => {
  const source = await page();
  const derivation = source.slice(source.indexOf("const boqSourceOptions ="), source.indexOf("const selectedBoqSourceName ="));
  assert.match(derivation, /serverProjectDashboard\?\.boqSources/);
  assert.doesNotMatch(derivation, /extractedBoqItems\.(filter|reduce|length)/, "source counts must come from the authoritative backend breakdown, not a client-side row recount");
  // Names are resolved for display only, from the already-loaded document list.
  assert.match(derivation, /managedDocuments\.find/);
});

test("the source filter control renders live counts and an All option, and is absent for a single-source project", async () => {
  const branch = await boqBranch();
  assert.match(branch, /className="boq-source-filter"/);
  assert.match(branch, /boqSourceOptions\.length > 1/, "the filter control itself must be conditional on more than one source");
  assert.match(branch, /All \(\{serverProjectDashboard\?\.facts\.boqItems \|\| 0\}\)/);
});

test("switching source filters the table rows only; the top-line stats remain project-wide", async () => {
  const branch = await boqBranch();
  const statsBlock = branch.slice(branch.indexOf('className="extraction-proof"'), branch.indexOf("</div>", branch.indexOf('className="extraction-proof"')));
  assert.doesNotMatch(statsBlock, /selectedBoqSourceDocumentId/, "the four primary stat tiles must not react to the source filter");
  const tableBlock = branch.slice(branch.indexOf('className="compact-table boq-extraction-review-table"'));
  assert.match(tableBlock, /selectedBoqSourceDocumentId === "All" \|\| item\.source_document_id === selectedBoqSourceDocumentId/);
});

test("every BOQ table row displays its source document name, not only item number and sheet/row", async () => {
  const branch = await boqBranch();
  const tableBlock = branch.slice(branch.indexOf('className="compact-table boq-extraction-review-table"'));
  assert.match(tableBlock, /managedDocuments\.find\(\(document\) => document\.id === item\.source_document_id\)\?\.logical_name/);
});

test("BOQ table rows use boq_items.id as React key and identity, never item_number", async () => {
  const branch = await boqBranch();
  const tableBlock = branch.slice(branch.indexOf('className="compact-table boq-extraction-review-table"'));
  assert.match(tableBlock, /<tr key=\{item\.id\}>/);
  assert.doesNotMatch(tableBlock, /key=\{item\.item_number\}/);
});

test("the extraction-stage state is an explicit statement, separate from the four primary stats, and does not depend on downstream AI/Requirements state", async () => {
  const branch = await boqBranch();
  assert.match(branch, /className="boq-extraction-status-line"/);
  assert.match(branch, /Ready for downstream engineering/);
  assert.match(branch, /BOQ Extraction/);
  const statusLine = branch.slice(branch.indexOf('className="boq-extraction-status-line"'), branch.indexOf("</div>", branch.indexOf('className="boq-extraction-status-line"')));
  assert.doesNotMatch(statusLine, /understandingQualitySummary|requirementReview/, "BOQ extraction readiness must be computed only from extraction facts, never from AI Understanding or Requirements state");
});

test("the total is explained with multi-source context (N current BOQ items and source count) without cluttering the four primary stat tiles", async () => {
  const branch = await boqBranch();
  assert.match(branch, /current BOQ item/);
  assert.match(branch, /BOQ sources/);
});

test("handoff card title, status and detail are structurally separate block elements, not a concatenated <small>/<strong> pair", async () => {
  const branch = await boqBranch();
  const handoffRow = branch.slice(branch.indexOf('className="downstream-handoff-row"'), branch.indexOf('className="compact-table boq-extraction-review-table"'));
  assert.match(handoffRow, /<strong className="downstream-handoff-title">AI Understanding<\/strong>/);
  assert.match(handoffRow, /<strong className="downstream-handoff-title">Requirements<\/strong>/);
  // Status uses the same review-ready/review-blocked/review-pending language as the rest of the workspace.
  assert.match(handoffRow, /review-ready|review-blocked|review-pending/);
  // The old shape -- a title and status crammed into one <div> with no distinct element between them -- must be gone.
  assert.doesNotMatch(handoffRow, /<small>AI UNDERSTANDING<\/small>\s*<strong>/);
});

test("row actions: Edit is the only permanent primary action; Restore/Confirm/Reject live behind a disclosure and remain individually conditional", async () => {
  const branch = await boqBranch();
  const tableBlock = branch.slice(branch.indexOf('className="compact-table boq-extraction-review-table"'));
  const actionsCell = tableBlock.slice(tableBlock.indexOf('className="boq-col-actions"'));
  assert.match(actionsCell, /reviewBoqItem\(item, "update"\)/);
  assert.match(actionsCell, /<details className="row-actions-menu">/);
  assert.match(actionsCell, /boqItemHasRestorableEdit\(item\) &&/);
  assert.match(actionsCell, /item\.review_status !== "Approved" &&/);
  assert.match(actionsCell, /item\.review_status !== "Rejected" &&/);
  assert.match(actionsCell, /Confirm manually/);
});

test("Auto Verified never implies mandatory human confirmation: the Confirm action is optional (title explains it), not a blocking control", async () => {
  const branch = await boqBranch();
  assert.match(branch, /Already downstream-ready as Auto Verified/);
});

test("bulk review & export launcher is relabeled distinct from the inline table, and restores the multi-source aggregation on close", async () => {
  const source = await page();
  assert.match(source, /Bulk review &amp; export/);
  assert.match(source, /const closeBoqExtractionReview = \(\) => \{/);
  const closer = source.slice(source.indexOf("const closeBoqExtractionReview = () => {"), source.indexOf("};", source.indexOf("const closeBoqExtractionReview = () => {")));
  assert.match(closer, /setExtractedBoqItems\(itemGroups\.flat\(\)\)/, "closing the bulk-review overlay must restore the full multi-source row aggregation, not leave the table scoped to one document");
});

test("the workflow stepper carries an inspectable per-stage blocker summary, not just a bare 'Needs attention' label", async () => {
  const shell = await readFile(new URL("../app/components/project/ProjectShell.tsx", import.meta.url), "utf8");
  assert.match(shell, /item\.blockerSummary/);
  assert.match(shell, /title=\{tooltip\}/);
});
