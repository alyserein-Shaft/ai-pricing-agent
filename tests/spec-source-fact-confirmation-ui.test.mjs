import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Source Fact Authority Slice 2 -- UI wiring tests. Following this repo's
// established convention for .tsx (no DOM-rendering harness): source-level
// regex assertions against the real files.

test("technicalApi exposes the Source Fact list/promote/batch-confirm/single-action endpoints", async () => {
  const client = await readFile(new URL("../app/lib/api-client.ts", import.meta.url), "utf8");
  assert.match(client, /sourceFactsList: \(projectId: string\) =>/);
  assert.match(client, /sourceFactsPromote: \(projectId: string\) =>/);
  assert.match(client, /sourceFactsBatchConfirm: \(projectId: string\) =>/);
  assert.match(client, /sourceFactAction: \(factId: string, operation: "confirm" \| "reject"\) =>/);
  assert.match(client, /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/specification-source-facts\/confirm/);
  assert.match(client, /\/api\/engineering-facts\/\$\{encodeURIComponent\(factId\)\}\/\$\{operation\}/);
});

test("TechnicalRequirementsWorkspace shows a compact Source Facts panel with promote, select, batch-confirm and per-item reject", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/TechnicalRequirementsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ui, /Promote deterministic source facts/);
  assert.match(ui, /Confirm selected source facts/);
  assert.match(ui, /onClick=\{\(\) => props\.onRejectSourceFact\(fact\.factId\)\}/);
  assert.match(ui, /type="checkbox"/);
  assert.match(ui, /onChange=\{\(\) => props\.onToggleFactSelection\(fact\.factId\)\}/);
  // Never adds free-form manual fact creation in this slice.
  assert.doesNotMatch(ui, /Create source fact|Add source fact|new fact/i);
});

test("conflicted Source Facts are flagged and never selectable for batch confirmation", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/TechnicalRequirementsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ui, /Conflict — review required/);
  assert.match(ui, /disabled=\{!selectable\}/);
  const selectableLine = ui.slice(ui.indexOf("const selectable ="), ui.indexOf("const selectable =") + 120);
  assert.match(selectableLine, /!fact\.hasBlockingConflict/);
});

test("semantic wording: Promote never implies authority, Confirm is the separate authority step", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/TechnicalRequirementsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ui, /nothing becomes authoritative until confirmed/i);
  assert.doesNotMatch(ui, /approve everything automatically/i);
});

test("O/P. the promote handler calls the Slice 1 route and refreshes Source Fact state afterward", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const submitPromoteSourceFacts = async \(\) => \{/);
  const fn = page.slice(page.indexOf("const submitPromoteSourceFacts = async () => {"));
  const body = fn.slice(0, fn.indexOf("\n  };") + 5);
  assert.match(body, /technicalApi\.sourceFactsPromote\(projectId\)/);
  assert.match(body, /await loadSourceFacts\(\)/);
  assert.match(body, /setPromoteFactsSummary\(result\)/);
});

test("Q. Pending Review Source Facts are loaded into the Technical Requirements UI on open", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const fn = page.slice(page.indexOf("const openTechnicalRequirementReview = async ("));
  const body = fn.slice(0, fn.indexOf("\n  };") + 5);
  assert.match(body, /void loadSourceFacts\(\)/);
  assert.match(page, /const loadSourceFacts = async \(\) => \{/);
  assert.match(page, /technicalApi\.sourceFactsList\(projectId\)/);
});

test("closing the requirement review clears Source Fact state so a later document doesn't show a stale list", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const fn = page.slice(page.indexOf("const closeTechnicalRequirementReview = () => {"));
  const body = fn.slice(0, fn.indexOf("\n  };") + 5);
  assert.match(body, /setSourceFacts\(\[\]\)/);
  assert.match(body, /setPromoteFactsSummary\(null\)/);
  assert.match(body, /setSelectedFactIds\(\[\]\)/);
});

test("R. batch confirm submits exactly the explicitly selected fact ids, never an implicit 'confirm all'", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const fn = page.slice(page.indexOf("const submitConfirmSelectedSourceFacts = async () => {"));
  const body = fn.slice(0, fn.indexOf("\n  };") + 5);
  assert.match(body, /technicalApi\.sourceFactsBatchConfirm\(projectId\)/);
  assert.match(body, /factIds: selectedFactIds/);
  assert.doesNotMatch(body, /factIds: \[\]|all.*pending/i);
});

test("S. the label vocabulary never renders the 190°F alternative as a selected value", async () => {
  const worker = await readFile(new URL("../worker/spec-source-fact-promotion.mjs", import.meta.url), "utf8");
  assert.match(worker, /high_temp_alternative_available: "High-temperature alternative available"/);
  assert.doesNotMatch(worker, /Selected temperature/i);
  const ui = await readFile(new URL("../app/components/workspaces/TechnicalRequirementsWorkspace.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(ui, /Selected temperature/i);
});

test("T. no profile/matching/BOM/pricing action is reachable from the Source Facts panel", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/TechnicalRequirementsWorkspace.tsx", import.meta.url), "utf8");
  const panel = ui.slice(ui.indexOf('<div className="source-facts-panel">'), ui.indexOf('<div className="requirement-review-filters">'));
  for (const forbidden of [/requirement-profile/i, /matching/i, /\bBOM\b/, /Pricing/i, /Quotation/i]) assert.doesNotMatch(panel, forbidden);
});
