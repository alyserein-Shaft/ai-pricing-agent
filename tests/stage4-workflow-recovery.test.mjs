import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  isCanonicalProjectId,
  parseProjectLocation,
  workspaceAvailability,
  workspaceForRoute,
} from "../app/lib/project-navigation.mjs";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

// Stage-4 workflow recovery: every repaired routing/workflow defect gets a
// regression test. No live DB, no network -- source + pure domain only.

test("canonical runtime is pinned: no silent port drift to 4184+", async () => {
  const vite = await source("vite.config.ts");
  assert.match(vite, /port:\s*4183/);
  assert.match(vite, /strictPort:\s*true/);
});

test("canonical project identity rejects the legacy alias", () => {
  assert.equal(isCanonicalProjectId("project_c0123d91-c30b-4956-87cb-e473ef53f89d"), true);
  assert.equal(isCanonicalProjectId("almoosa-k12-fire-alarm"), false);
  assert.equal(isCanonicalProjectId(""), false);
  assert.equal(isCanonicalProjectId(null), false);
});

test("default project state never uses the legacy alias", async () => {
  const page = await source("app/page.tsx");
  assert.doesNotMatch(page, /useState\("almoosa-k12-fire-alarm"\)/);
  assert.match(page, /parseProjectLocation\(window\.location\.search\)\.projectId/);
});

test("auto-fire server fetches are gated on canonical project identity", async () => {
  const page = await source("app/page.tsx");
  // documents register, library sources, project dashboard
  assert.match(page, /if\s*\(!isCanonicalProjectId\(projectId\)\)\s*\{[\s\S]*?setManagedDocuments\(\[\]\)/);
  assert.match(page, /if\s*\(!isCanonicalProjectId\(projectId\)\)\s*\{[\s\S]*?setDurableLibrarySources\(\[\]\)/);
  assert.match(page, /if\s*\(!showAllProjects && !isCanonicalProjectId\(projectId\)\)/);
});

test("Documents Review-requirements opens the governed requirements surface", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /openTechnicalRequirementReview\(document\)/);
  // The spec-documents button must not drop context with a bare module switch.
  const documentsBlock = page.slice(
    page.indexOf("Review requirements"),
    page.indexOf("Review requirements") + 2000,
  );
  assert.doesNotMatch(documentsBlock, /navigate\("Technical Review"\)/);
});

test("requirement search matches source requirement IDs", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /\$\{row\.id\} \$\{row\.original_text\}/);
});

test("requirement review entry supports deep-link to an exact requirement", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /openTechnicalRequirementReview = async \(\s*document[\s\S]*?requestedRequirementId/);
  assert.match(page, /url\.searchParams\.set\("requirement", selectedId\)/);
});

test("action queue routes per governed action, never hard-coded commercial", async () => {
  const page = await source("app/page.tsx");
  // The governed contract: the action queue resolves its destination from the
  // action's own route. Two shape changes are tolerated (not weakened): the
  // call is formatted across several lines, and the Home attention entries are
  // read as `entry.nextAction!.route` rather than a local `action` binding. The
  // second assertion below still forbids a hard-coded "Commercial Review".
  assert.match(page, /openDashboardRoute\(\s*entry\.project\.id,\s*entry\.nextAction!\.route,/);
  assert.match(page, /onOpenRoute=\{\(route\) => openDashboardRoute\(projectId, route\)\}/);
  assert.doesNotMatch(page, /Action queue[\s\S]{0,400}?navigate\("Commercial Review"\)/);
});

test("Review routes resolve to the correct workspace by type", () => {
  assert.equal(workspaceForRoute("Review?type=technical&status=open"), "Technical Review");
  assert.equal(workspaceForRoute("Review?type=technical&status=blocked"), "Technical Review");
  assert.equal(workspaceForRoute("Review?type=commercial&status=open"), "Commercial Review");
});

test("Open prerequisite applies the route filter to the review queue", async () => {
  const page = await source("app/page.tsx");
  // openDashboardRoute maps status params onto the queue filter and reloads.
  assert.match(page, /rawStatus === "open"[\s\S]*?"Open"/);
  assert.match(page, /setReviewFilter\(mappedStatus\)/);
  assert.match(page, /loadReviewWorkspace\(false, mappedStatus\)/);
  // loadReviewWorkspace honors an explicit status override.
  assert.match(page, /statusOverride \?\? reviewFilter/);
});

test("review queue cards deep-link to the blocking BOQ item", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /viewProductSelectionForItem\(review\.boq_item_id/);
});

test("evidence record opens a human-readable modal, raw JSON stays secondary", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /setEvidenceRecordItemId\(item\.id\)/);
  assert.match(page, /REQUIREMENT EVIDENCE RECORD/);
  assert.match(page, /View raw JSON \(developer\)/);
  assert.match(page, /Applicable requirements/);
  assert.match(page, /Readiness &amp; blockers/);
});

test("intelligence modal distinguishes itself from spec review and cross-links", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /not the Specification Requirement review queue/);
  assert.match(page, /Open Specification Requirements/);
});

test("expected 409 workflow states render as domain states, not failures", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /REQUIREMENT_PROFILE_REQUIRED/);
  assert.match(page, /\[itemId\]: null/);
});

test("prerequisite availability still resolves to a concrete route", () => {
  assert.match(JSON.stringify(workspaceAvailability(null, "Technical Review")), /Overview/);
});
