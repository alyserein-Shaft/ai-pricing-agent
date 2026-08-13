import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { WORKFLOW_STAGES } from "../app/domain/dashboard-workflow-engine.mjs";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { GLOBAL_DESTINATIONS, PROJECT_NAVIGATION, buildGlobalLocation, canonicalizeGlobalSearch, globalNavigationSelection, projectNavigationSelection, resolveGlobalDestination } from "../app/lib/application-navigation.mjs";
import { visibleProjectPhases } from "../app/lib/project-phase-presentation.mjs";
import { parseProjectLocation } from "../app/lib/project-navigation.mjs";
import { HOME_ACTION_SUMMARY_LIMIT, homeActionQueuePresentation, projectProgressTone } from "../app/lib/home-presentation.mjs";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("legacy global URLs map to the Release 1 information architecture", () => {
  assert.equal(resolveGlobalDestination("Dashboard").workspace, "Home");
  assert.equal(resolveGlobalDestination("Knowledge Library").section, "Files");
  assert.equal(resolveGlobalDestination("Product Library").workspace, "Product Library");
  assert.equal(resolveGlobalDestination("Settings").workspace, "Administration");
  assert.equal(parseProjectLocation(buildGlobalLocation("Knowledge", "Manufacturers")).workspace, "Knowledge Library");
  assert.deepEqual(globalNavigationSelection("Knowledge", "Manufacturers"), { parent: "Knowledge", child: "Knowledge Manufacturers" });
  assert.equal(canonicalizeGlobalSearch("?workspace=Product+Library&section=Products"), "?workspace=Knowledge&section=Products");
  assert.equal(canonicalizeGlobalSearch("?workspace=Knowledge+Library"), "?workspace=Knowledge&section=Files");
  assert.equal(canonicalizeGlobalSearch("?workspace=Pricing+Memory"), "?workspace=Knowledge&section=Prices");
  assert.equal(canonicalizeGlobalSearch("?workspace=Case+Studies"), "?workspace=Knowledge&section=Case+Studies");
});

test("global and project navigation are distinct configurations", () => {
  assert.deepEqual(GLOBAL_DESTINATIONS.map((item) => item.label), ["Home", "Projects", "Knowledge", "Reports", "Administration"]);
  assert.deepEqual(PROJECT_NAVIGATION.map((item) => item.label), ["Overview", "Tender", "Product Selection", "Pricing", "Quotation", "Activity"]);
  assert.deepEqual(projectNavigationSelection("Project Context"), { parent: "Tender", child: "Documents" });
  assert.equal(PROJECT_NAVIGATION.some((item) => item.label === "Home"), false);
});

test("all five Knowledge children keep URL, content section, and active navigation aligned", () => {
  const knowledge = GLOBAL_DESTINATIONS.find((item) => item.id === "Knowledge");
  assert.deepEqual(knowledge.children.map((item) => item.label), ["Files", "Products", "Manufacturers", "Prices", "Case Studies"]);

  for (const child of knowledge.children) {
    const href = buildGlobalLocation(child.workspace, child.section || "");
    const location = parseProjectLocation(href);
    const selection = globalNavigationSelection(child.workspace, child.section || "");
    assert.equal(href, `?workspace=Knowledge&section=${encodeURIComponent(child.section).replace(/%20/g, "+")}`);
    assert.equal(selection.parent, "Knowledge");
    assert.equal(selection.child, child.id);
    assert.equal(location.workspace, "Knowledge Library");
    assert.equal(resolveGlobalDestination("Knowledge", child.section).workspace,
      child.section === "Products" ? "Product Library" : child.section === "Case Studies" ? "Case Studies" : "Knowledge");
  }
});

test("legacy normalization replaces only global routes and preserves scoped Product Library parameters", async () => {
  const scoped = "?project=project-real&workspace=Product+Library&sourceId=source-591&libraryView=unresolved";
  assert.equal(canonicalizeGlobalSearch(scoped), scoped);
  assert.equal(
    canonicalizeGlobalSearch("?workspace=Product+Library&section=Products&sourceId=source-591"),
    "?workspace=Knowledge&section=Products&sourceId=source-591",
  );
  const page = await source("app/page.tsx");
  assert.match(page, /window\.history\.replaceState\(null, "", canonicalSearch\)/);
  assert.match(page, /window\.addEventListener\("popstate", restoreLocation\)/);
  assert.match(page, /if \(!location\.projectId\)/);
  assert.match(page, /query\.set\("sourceId", selectedLibrarySourceId\)/);
});

test("Knowledge content uses the AppShell hierarchy without a competing incomplete tab bar", async () => {
  const workspace = await source("app/components/workspaces/KnowledgeLibraryWorkspace.tsx");
  const caseStudies = await source("app/components/workspaces/CaseStudiesWorkspace.tsx");
  const page = await source("app/page.tsx");
  const css = await source("app/globals.css");

  assert.doesNotMatch(workspace, /knowledge-section-tabs|aria-label="Knowledge sections"|onSection/);
  assert.match(workspace, /<h1>\{subsectionTitle\}<\/h1>/);
  assert.match(workspace, /section === "Price Lists" \? "Prices" : section/);
  assert.match(page, /<h1>Products<\/h1>/);
  assert.match(caseStudies, /<h1>Case Studies<\/h1>/);
  assert.match(workspace, /extraction-proof knowledge-metrics/);
  assert.match(css, /\.knowledge-metrics \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\); \}/);
  assert.doesNotMatch(css, /\.knowledge-section-tabs/);
});

test("the 12 dashboard stages map deterministically into seven visible phases", () => {
  const workflow = { currentStageId: "matching", stages: WORKFLOW_STAGES.map((stage) => ({ ...stage, status: stage.id === "setup" ? "Completed" : "Not Started", progress: stage.id === "setup" ? 100 : 0 })) };
  const phases = visibleProjectPhases(workflow);
  assert.equal(phases.length, 7);
  const mapped = phases.flatMap((phase) => phase.stageIds.filter((id) => WORKFLOW_STAGES.some((stage) => stage.id === id)));
  assert.deepEqual([...mapped].sort(), WORKFLOW_STAGES.map((stage) => stage.id).sort());
  assert.equal(phases.find((phase) => phase.id === "select-products").current, true);
});

test("visible phase status preserves blocked and needs-attention truth", () => {
  const base = { project: { id: "p", name: "P", organizationId: "o", systemDomain: "Fire Alarm" }, facts: { documents: 1, classified: 0 } };
  const attention = visibleProjectPhases(derivePresalesWorkflow(base));
  assert.equal(attention.find((phase) => phase.id === "understand-tender").state, "Needs attention");
  const blocked = visibleProjectPhases({ currentStageId: "setup", stages: [{ id: "setup", status: "Blocked", progress: 0 }] });
  assert.equal(blocked[0].state, "Blocked");
});

test("AppShell provides accessible mobile navigation behavior", async () => {
  const shell = await source("app/components/layout/AppShell.tsx");
  assert.match(shell, /aria-label="Primary navigation"/);
  assert.match(shell, /aria-current=\{active \? "page"/);
  assert.match(shell, /event\.key === "Escape"/);
  assert.match(shell, /event\.key !== "Tab"/);
  assert.match(shell, /document\.body\.style\.overflow = "hidden"/);
  assert.match(shell, /openerRef\.current\?\.focus\(\)/);
});

test("AppShell keeps complete navigation reachable within constrained viewport heights", async () => {
  const shell = await source("app/components/layout/AppShell.tsx");
  const css = await source("app/globals.css");
  const projectDestinations = PROJECT_NAVIGATION.flatMap((item) => [item.label, ...(item.children || []).map((child) => child.label)]);

  assert.deepEqual(projectDestinations, ["Overview", "Tender", "Documents", "BOQ", "Requirements", "Product Selection", "Pricing", "Supplier Price Evidence", "Costing & Pricing", "Quotation", "Activity"]);
  assert.match(shell, /className="app-navigation-scroll"[^>]*data-shell-region="navigation"/);
  assert.match(css, /height: 100dvh/);
  assert.match(css, /grid-template-rows: auto minmax\(0, 1fr\) auto/);
  assert.match(css, /\.app-navigation-scroll \{[^}]*min-height:0;[^}]*overflow-y:auto;[^}]*scrollbar-gutter:stable/);
  assert.match(css, /\.authenticated-profile \{ position:relative; z-index:1;/);
  assert.ok(shell.indexOf('data-shell-region="navigation"') < shell.indexOf('className="authenticated-profile"'));
});

test("active lower navigation destinations scroll into view without stealing focus", async () => {
  const shell = await source("app/components/layout/AppShell.tsx");
  assert.match(shell, /querySelector<HTMLElement>\('\[aria-current="page"\]'\)/);
  assert.match(shell, /scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/);
  assert.doesNotMatch(shell, /activeDestination\?\.focus\(/);
  assert.deepEqual(projectNavigationSelection("Quotation"), { parent: "Quotation", child: "" });
  assert.deepEqual(projectNavigationSelection("Activity"), { parent: "Activity", child: "" });
  assert.deepEqual(projectNavigationSelection("Costing"), { parent: "Pricing", child: "Costing & Pricing" });
});

test("Project Overview renders one canonical next-action control", async () => {
  const projectShell = await source("app/components/project/ProjectShell.tsx");
  const overview = await source("app/components/workspaces/OverviewWorkspace.tsx");
  const page = await source("app/page.tsx");

  assert.match(projectShell, /<section className="project-strip"/);
  assert.match(projectShell, /<button disabled=\{!workflow\?\.nextAction\}/);
  assert.doesNotMatch(overview, /next-recommended-action|NEXT WORKFLOW ACTION|Open work/);
  assert.match(overview, /overview-workflow-context/);
  assert.doesNotMatch(page, /NEXT WORKFLOW ACTION/);
});

test("Knowledge disclosure follows active context without consuming Home space", async () => {
  const shell = await source("app/components/layout/AppShell.tsx");
  assert.match(shell, /useState<Record<string, boolean>>\(\{ Tender: true, Pricing: true \}\)/);
  assert.match(shell, /id === "Knowledge" && globalSelection\.parent === "Knowledge"/);
  assert.match(shell, /aria-expanded=\{item\.children \? groupExpanded\(item\.id\)/);
  assert.doesNotMatch(shell, /Knowledge: true/);
});

test("Home renders exactly six of 32 operational actions before truthful expansion", async () => {
  const actions = Array.from({ length: 32 }, (_, index) => ({ id: `action-${index + 1}` }));
  const summary = homeActionQueuePresentation(actions, false);
  assert.equal(HOME_ACTION_SUMMARY_LIMIT, 6);
  assert.equal(summary.visible.length, 6);
  assert.equal(summary.total, 32);
  assert.equal(summary.hasMore, true);
  assert.equal(homeActionQueuePresentation(actions, true).visible.length, 32);
  const page = await source("app/page.tsx");
  assert.match(page, /View all \$\{organizationDashboard\.actionQueue\.length\} actions/);
  assert.match(page, /aria-expanded=\{showAllHomeActions\}/);
});

test("incomplete project progress never inherits success green", async () => {
  for (const progress of [9, 14, 19]) {
    assert.equal(projectProgressTone({ progress, status: "In Progress" }), "primary");
  }
  assert.equal(projectProgressTone({ progress: 100, status: "Complete" }), "success");
  assert.equal(projectProgressTone({ progress: 100, status: "Approved" }), "success");
  assert.equal(projectProgressTone({ progress: 100, status: "Needs Review" }), "primary");
  assert.equal(projectProgressTone({ progress: 19, status: "Blocked" }), "danger");
  assert.equal(projectProgressTone({ progress: 100, status: "Failed" }), "danger");

  const css = await source("app/globals.css");
  assert.match(css, /server-project-progress i,.workflow-stage-progress i \{[^}]*background:var\(--blue\)/);
  assert.match(css, /progress-success i \{ background:#18815f/);
  assert.match(css, /progress-danger i \{ background:#b83b3b/);
  assert.doesNotMatch(css, /server-project-progress i,.workflow-stage-card>div i[^}]*#18815f/);
});

test("Home relies on server operational scope rather than project-name filtering", async () => {
  const dashboardApi = await source("worker/dashboard-api.mjs");
  assert.match(dashboardApi, /p\.operational_classification='Operational'/);
  assert.match(dashboardApi, /uniqueProjects/);
  assert.match(dashboardApi, /uniqueActions/);
  assert.doesNotMatch(dashboardApi, /p\.name\s*(?:=|LIKE)\s*['"][^'"]*(?:Golden|Fixture|Validation)/i);
});

test("project context and supplier evidence remain truthful and reachable", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /Project Context/);
  assert.match(page, /Supplier RFQ workspace is not available in this version/);
  assert.match(page, /Unavailable in this version/);
  assert.doesNotMatch(await source("app/components/layout/AppShell.tsx"), /project_[0-9a-f-]{20,}/i);
});

test("URL restoration remains driven by popstate and the shared parser", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /window\.addEventListener\("popstate", restoreLocation\)/);
  assert.match(page, /parseProjectLocation\(window\.location\.search\)/);
  assert.match(page, /buildGlobalLocation\(destination\.canonicalWorkspace \|\| workspace, destination\.section\)/);
});
