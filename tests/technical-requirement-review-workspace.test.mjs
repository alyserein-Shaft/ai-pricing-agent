import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../app/components/workspaces/TechnicalRequirementsWorkspace.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../worker/specification-extraction-api.mjs", import.meta.url), "utf8");
const migration = readFileSync(new URL("../drizzle/0019_requirement_review_immutability.sql", import.meta.url), "utf8");

test("renders a normal technical requirement review workspace with governed filters and actions", () => {
  assert.match(workspace, /Technical Requirement Review/);
  assert.match(workspace, /Search requirements/);
  assert.match(workspace, /<label>Section/);
  assert.match(workspace, /<label>Clause/);
  assert.match(workspace, /<label>Page/);
  assert.match(workspace, /<label>Status/);
  for (const action of ["Edit", "Approve Technical Interpretation", "Reject", "Restore"]) assert.match(workspace, new RegExp(`>${action}<`));
  assert.match(workspace, /decisions require a reason/);
  assert.match(workspace, /Immutable review history/);
});

test("persists review mutation and both audit records in one D1 batch", () => {
  assert.match(api, /await env\.DB\.batch\(\[update, \.\.\.reviewAuditStatements/);
  assert.match(api, /requirement_review_decisions/);
  assert.match(api, /document_audit_events/);
  assert.match(api, /REVIEW_REASON_REQUIRED/);
  assert.match(api, /operation === "history"/);
  assert.match(api, /parseJson\(requirement\.original_values/);
});

test("makes requirement decision history immutable", () => {
  assert.match(migration, /BEFORE UPDATE ON requirement_review_decisions/);
  assert.match(migration, /BEFORE DELETE ON requirement_review_decisions/);
  assert.match(migration, /RAISE\(ABORT, 'requirement review decisions are immutable'\)/);
});
