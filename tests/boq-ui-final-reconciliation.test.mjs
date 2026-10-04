// BOQ UI Final Reconciliation -- static-source proofs for the two final
// runtime inconsistencies.
//
// 1. Quick-filter "Needs Review" must use canonical extraction-review debt
//    predicate (excludes Merged, Rejected, matches current-evidence-scope).
// 2. BOQ extraction table must not embed the UNDERSTANDING column (AI
//    Understanding is a separate downstream workspace).
//
// These tests follow the static-source pattern used for BOQ workspace closure.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = async () => readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

const boqBranch = async () => {
  const source = await page();
  const start = source.indexOf('activeModule === "BOQ" ? (');
  const end = source.indexOf('activeModule === "AI Understanding Review" ? (', start);
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("BOQ branch markers not found in app/page.tsx");
  }
  return source.slice(start, end);
};

// ============================================================================
// ISSUE 1: Quick-filter "Needs Review" must use canonical extraction-review
// predicate (exclude Merged, Rejected -- matches current-evidence-scope)
// ============================================================================

test("quick-filter 'Needs Review' predicate excludes Merged and Rejected terminal statuses", async () => {
  const branch = await boqBranch();

  // Find the quick-filter counts derivation
  const filterStart = branch.indexOf("const counts: Record");
  const filterEnd = branch.indexOf("};", filterStart);
  const filterBlock = branch.slice(filterStart, filterEnd);

  // The predicate must explicitly exclude Merged and Rejected, not just
  // check for ["Approved", "Accepted", "Auto Verified"]
  assert.match(
    filterBlock,
    /!verified\(item\)/,
    "Needs Review count must use the !verified predicate"
  );

  // The verified predicate must include Merged and Rejected as terminal
  const verifiedStart = branch.indexOf("const verified");
  const verifiedEnd = branch.indexOf("};", verifiedStart);
  const verifiedBlock = branch.slice(verifiedStart, verifiedEnd);

  assert.match(
    verifiedBlock,
    /Merged/,
    "verified predicate must include 'Merged' as terminal (excluded from Needs Review)"
  );
  assert.match(
    verifiedBlock,
    /Rejected/,
    "verified predicate must include 'Rejected' as terminal (excluded from Needs Review)"
  );
});

test("quick-filter 'Needs Review' count matches canonical extractionReview=0 for Golden state", async () => {
  // This is a structural test; the actual count match is verified at runtime.
  // Here we ensure the predicate structure is correct.
  const branch = await boqBranch();

  const verifiedStart = branch.indexOf("const verified");
  const verifiedEnd = branch.indexOf("};", verifiedStart);
  const verifiedBlock = branch.slice(verifiedStart, verifiedEnd);

  // Must include both Merged and Rejected in the terminal set
  const hasMerged = /Merged/.test(verifiedBlock);
  const hasRejected = /Rejected/.test(verifiedBlock);
  assert.ok(hasMerged && hasRejected, "verified predicate must include Merged and Rejected");

  // The Needs Review filter must use !verified
  const filterStart = branch.indexOf("const counts: Record");
  const filterEnd = branch.indexOf("};", filterStart);
  const filterBlock = branch.slice(filterStart, filterEnd);
  assert.match(filterBlock, /"Needs Review": visible\.filter\(\(item\) => !verified\(item\)\)\.length/);
});

// ============================================================================
// ISSUE 2: BOQ extraction table must not embed the UNDERSTANDING column
// ============================================================================

test("BOQ extraction table header must not contain 'Understanding' column", async () => {
  const branch = await boqBranch();

  // Find the table header section
  const tableStart = branch.indexOf('className="compact-table boq-extraction-review-table"');
  const theadEnd = branch.indexOf("</thead>", branch.indexOf("<thead>", tableStart));
  const theadBlock = branch.slice(tableStart, theadEnd);

  // Must NOT have an "Understanding" header
  assert.doesNotMatch(
    theadBlock,
    /<th>Understanding<\/th>/i,
    "BOQ extraction table must not have an 'Understanding' header column"
  );

  // Must still have Extraction header
  assert.match(theadBlock, /<th>Extraction<\/th>/i, "Extraction header must remain");
});

test("BOQ extraction table body must not render Understanding column content", async () => {
  const branch = await boqBranch();

  // Find the tbody map block
  const tbodyStart = branch.indexOf("<tbody>");
  const tbodyEnd = branch.indexOf("</tbody>", tbodyStart);
  const tbodyBlock = branch.slice(tbodyStart, tbodyEnd);

  // Must NOT render the Understanding column cell (the old code had a <td>
  // with understanding.status rendering -- look for the specific pattern
  // of the Understanding column cell which had estimatorReadiness lookup)
  assert.doesNotMatch(
    tbodyBlock,
    /<td>[^<]*estimatorReadiness\?\.items\?\.find/,
    "BOQ extraction table rows must not render an Understanding column cell with estimatorReadiness lookup"
  );

  // The Extraction column must still render
  assert.match(tbodyBlock, /extractionReviewStatusLabel\(item\)/, "Extraction status must still render");
});

test("AI Understanding navigation/handoff remains reachable from BOQ workspace", async () => {
  const branch = await boqBranch();

  // The downstream handoff for AI Understanding must still exist
  assert.match(
    branch,
    /className="downstream-handoff-title">AI Understanding<\/strong>/,
    "AI Understanding handoff card must remain in BOQ workspace"
  );

  // The "Open AI Understanding" button must remain
  assert.match(
    branch,
    /onClick=\{.*navigate\("AI Understanding Review"\)\}/,
    "Open AI Understanding button must remain functional"
  );
});

test("AI Understanding data is not deleted -- only removed from extraction table", async () => {
  // The understanding data fetch and state must still exist in the component
  const source = await page();
  
  // estimatorReadiness fetch must still exist
  assert.match(source, /estimatorReadiness/, "estimatorReadiness data fetch must remain");
  
  // understandingQualitySummary must remain for the handoff card
  assert.match(source, /understandingQualitySummary/, "understandingQualitySummary must remain for handoff");
});