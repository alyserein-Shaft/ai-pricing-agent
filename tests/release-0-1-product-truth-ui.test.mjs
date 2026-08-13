import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [page, projectContext, projectShell, navigation, matching, pricing, quotation] =
  await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/workspaces/ProjectContextWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/project/ProjectShell.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/project-navigation.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/components/workspaces/MatchingWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/workspaces/PricingWorkspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/workspaces/QuotationWorkspace.tsx", import.meta.url), "utf8"),
  ]);

test("Price Library reports observations, identities, repeats and commercial safety separately", () => {
  assert.match(page, /Product observations processed/);
  assert.match(page, /Unique product identities/);
  assert.match(page, /Repeated observations consolidated/);
  assert.match(page, /Price observations detected/);
  assert.match(page, /Can be used in costing: 0/);
  assert.doesNotMatch(page, /591 products imported/i);
});

test("standard Price Library status is multidimensional and does not expose source IDs", () => {
  for (const label of ["Processing:", "Review:", "Permitted use:", "Lifecycle:", "Blocker:"]) {
    assert.match(page, new RegExp(label));
  }
  assert.doesNotMatch(page, /Source \{selectedLibrarySource\.id\}/);
  assert.match(page, /PRODUCT RECORDS & SOURCE EVIDENCE/);
  assert.match(page, /PRODUCT RECORD/);
});

test("project state indicators reserve green for completed or approved states", () => {
  assert.match(projectShell, /completed\|approved/);
  assert.match(projectShell, /status-neutral/);
  assert.match(projectShell, /status-blocked/);
  assert.doesNotMatch(projectShell, /aria-label=\{`Active project/);
});

test("Project Context explains confidence without claiming approval or AI interpretation", () => {
  assert.match(projectContext, /Interpretation review required/);
  assert.match(projectContext, /including when shown as\s*100%/);
  assert.match(projectContext, /No interpretation has been approved/);
  assert.doesNotMatch(projectContext, />AI interpretation</);
});

test("unfinished Supplier RFQs fail honestly and browser-only project edits stay unsaved", () => {
  assert.match(page, /Supplier RFQ workspace is not available in this version/);
  assert.match(page, /No RFQ action has been completed/);
  assert.match(page, /Browser-only project draft/);
  assert.match(page, /server project details were not changed/);
  assert.match(page, /optional fields below are not persisted to the\s*server/);
});

test("user-facing workflow terminology is stage-specific without changing internal routes", () => {
  for (const text of ["Requirements", "Product Selection", "Supplier Price Evidence", "Costing & Pricing", "Prepare Quotation"]) {
    assert.match(navigation + matching + pricing + quotation, new RegExp(text.replace("&", "&(?:amp;)?")));
  }
  assert.match(navigation, /"Technical Matching": "Technical Matching"/);
  assert.match(navigation, /Pricing: "Costing"/);
});

test("global navigation keeps URL, active navigation and rendered workspace on one state model", () => {
  assert.match(navigation, /Dashboard: "Dashboard"/);
  assert.match(navigation, /Projects: "Projects"/);
  assert.match(navigation, /globalWorkspacePresentation/);
  assert.match(page, /const presentation = globalWorkspacePresentation\(location\.workspace\)/);
  assert.match(page, /buildProjectLocation\("", workspace\)/);
  assert.match(page, /\["Knowledge Library", "Product Library", "Reports"\]\.includes\(module\)/);
  assert.match(page, /isGlobalWorkspace \? activeModule : topLevelArea/);
});

test("standard project summaries never fall back to an internal project UUID", () => {
  assert.doesNotMatch(page, /entry\.project\.tenderNumber \|\| entry\.project\.id/);
  assert.doesNotMatch(page, /serverProjectDashboard\.project\.tenderNumber \|\|\s*serverProjectDashboard\.project\.id/);
  assert.match(page, /userFacingProjectReference\(\s*entry\.project\.tenderNumber/);
});
