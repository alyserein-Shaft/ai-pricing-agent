import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

// Spec Requirement Auto-Confirm wiring -- L. the UI action calls the new
// governed endpoint and refreshes current state. Following this repo's
// established convention for .tsx (no DOM-rendering harness): source-level
// regex assertions against the real files, matching
// tests/estimator-understanding-review-ui.test.mjs's own style.

test("technicalApi exposes the project-scoped auto-confirm endpoint, consistent with its other requirement-governance builders", async () => {
  const client = await readFile(new URL("../app/lib/api-client.ts", import.meta.url), "utf8");
  assert.match(client, /requirementAutoConfirm: \(projectId: string\) =>/);
  assert.match(client, /\/api\/projects\/\$\{encodeURIComponent\(projectId\)\}\/specification-requirements\/auto-confirm/);
});

test("TechnicalRequirementsWorkspace exposes one explicit auto-confirm action, distinct from manual per-requirement decisions", async () => {
  const ui = await readFile(new URL("../app/components/workspaces/TechnicalRequirementsWorkspace.tsx", import.meta.url), "utf8");
  assert.match(ui, /autoConfirmLoading: boolean/);
  assert.match(ui, /autoConfirmSummary: AutoConfirmSummary \| null/);
  assert.match(ui, /onAutoConfirm: \(\) => void/);
  assert.match(ui, /Auto-confirm eligible requirements/);
  // Must not silently promise more than the deterministic engine actually
  // does -- the copy must make clear judgment items stay manual.
  assert.match(ui, /Ambiguous or judgment-dependent requirements always remain here for manual review/);
  // No bulk manual-approve action was added alongside this.
  assert.doesNotMatch(ui, /Approve all|Bulk approve/i);
});

test("page.tsx wires the auto-confirm action to the governed endpoint and refreshes the same requirement list the manual action refreshes", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const submitTechnicalRequirementAutoConfirm = async \(\) => \{/);
  const fn = page.slice(page.indexOf("const submitTechnicalRequirementAutoConfirm = async () => {"));
  const body = fn.slice(0, fn.indexOf("\n  };") + 5);
  assert.match(body, /technicalApi\.requirementAutoConfirm\(projectId\)/);
  assert.match(body, /await loadTechnicalRequirements\(requirementReviewDocument\)/);
  assert.match(body, /setTechnicalRequirementAutoConfirmSummary\(result\)/);
  // Explicit-stages requirement: this action must never itself trigger link
  // suggestions -- that remains its own separate, later click.
  assert.doesNotMatch(body, /suggest-links|engineeringKnowledgeCommand/);

  assert.match(page, /autoConfirmLoading=\{technicalRequirementAutoConfirmLoading\}/);
  assert.match(page, /autoConfirmSummary=\{technicalRequirementAutoConfirmSummary\}/);
  assert.match(page, /onAutoConfirm=\{\(\) => void submitTechnicalRequirementAutoConfirm\(\)\}/);
});

test("closing the requirement review clears the auto-confirm summary so a later document doesn't show a stale run", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const fn = page.slice(page.indexOf("const closeTechnicalRequirementReview = () => {"));
  const body = fn.slice(0, fn.indexOf("\n  };") + 5);
  assert.match(body, /setTechnicalRequirementAutoConfirmSummary\(null\)/);
});
