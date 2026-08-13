import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { derivePresalesWorkflow } from "../app/domain/presales-workflow-engine.mjs";
import { aiQuotationAvailability, canonicalStepperItems, parseProjectLocation, visibleProductProjects, workspaceAvailability, workspaceForRoute } from "../app/lib/project-navigation.mjs";

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");
const emptyWorkflow = derivePresalesWorkflow({ project: { id: "p", name: "Empty", organizationId: "org", systemDomain: "Fire Alarm" }, facts: {} });
const pricedWorkflow = derivePresalesWorkflow({ project: { id: "p", name: "Priced", organizationId: "org", systemDomain: "Fire Alarm" }, facts: { boqItems: 2, pricedItems: 1 } });

test("Technical Review route is distinct from Commercial Review", async () => {
  assert.equal(workspaceForRoute("Review?type=technical&status=open"), "Technical Review");
  assert.equal(workspaceForRoute("Review?type=final&status=open"), "Commercial Review");
  assert.equal(parseProjectLocation("?project=p&workspace=Technical%20Review").workspace, "Technical Review");
  assert.match(await source("app/page.tsx"), /activeModule === "Technical Review"[\s\S]*?<TechnicalReviewWorkspace/);
});

test("canonical stepper preserves governed workflow order and status", () => {
  assert.deepEqual(canonicalStepperItems(emptyWorkflow).map((item) => item.id), ["overview", ...emptyWorkflow.stages.map((stage) => stage.id)]);
  assert.equal(canonicalStepperItems(emptyWorkflow).find((item) => item.id === "technical").workspace, "Technical Review");
});

test("matching waits when prerequisites are absent", async () => {
  assert.equal(workspaceAvailability(emptyWorkflow, "Technical Matching").state, "WAITING");
  const ui = await source("app/components/workspaces/MatchingWorkspace.tsx");
  assert.match(ui, /Product matching is not available yet/);
  assert.match(ui, /unavailable \?/);
});

test("pricing unavailable state hides operational controls", async () => {
  const ui = await source("app/components/workspaces/PricingWorkspace.tsx");
  assert.match(ui, /!props\.available \? <PrerequisiteState/);
  assert.match(ui, /Pricing starts after a technically eligible product is approved/);
});

test("commercial review unavailable state hides filters and queue", async () => {
  const ui = await source("app/components/workspaces/CommercialReviewWorkspace.tsx");
  assert.match(ui, /!props\.available \? <PrerequisiteState/);
  assert.match(ui, /Commercial review starts after governed pricing is available/);
});

test("blocked quotation does not present draft as actionable", async () => {
  const ui = await source("app/components/workspaces/QuotationWorkspace.tsx");
  assert.match(ui, /!props\.workflow\?\.readyForQuotation&&!props\.quotation \? <PrerequisiteState/);
  assert.match(ui, /disabled=\{!actions\.canDraft/);
});

test("AI advisory is unavailable without governed quotation evidence", () => {
  assert.deepEqual(aiQuotationAvailability(emptyWorkflow), { available: false, reason: "A reviewed BOQ is required before an advisory can be generated.", route: "BOQ" });
});

test("AI advisory is available at deterministic minimum evidence", () => {
  assert.equal(aiQuotationAvailability(pricedWorkflow).available, true);
});

test("Golden projects are excluded from normal lists", () => {
  const projects = [{ id: "real", organizationId: "org", operationalClassification: "Operational" }, { id: "golden", organizationId: "org", operationalClassification: "Internal Validation", isTestFixture: true }];
  assert.deepEqual(visibleProductProjects(projects).map((entry) => entry.id), ["real"]);
});

test("Golden projects remain available in explicit Golden mode", () => {
  const projects = [{ id: "golden", organizationId: "org", operationalClassification: "Internal Validation", isTestFixture: true }];
  assert.equal(visibleProductProjects(projects, { goldenMode: true }).length, 1);
});

test("document UI explicitly distinguishes legacy references from persisted documents", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /Legacy indexed reference evidence/);
  assert.match(page, /currently has no persisted documents/);
  assert.match(page, /baseTenderLoaded && managedDocuments\.length > 0/);
});

test("Dashboard and Projects have distinct information architectures", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /topLevelArea === "Dashboard" && <><div className="organization-metric-grid"/);
  assert.match(page, /topLevelArea === "Projects" && <label className="project-search"/);
  assert.match(page, /PROJECT REGISTER/);
});

test("attention KPIs include units and specific actions", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /Review required[\s\S]*reviewRequired/);
  assert.match(page, /BOQ items/);
  assert.match(page, /Review items/);
  assert.match(page, /Resolve pricing/);
});

test("project workspace context prevents false Dashboard active state", async () => {
  const page = await source("app/page.tsx");
  const shell = await source("app/components/project/ProjectShell.tsx");
  assert.match(page, /projectWorkspace=\{!showAllProjects && !isGlobalWorkspace \? activeModule : undefined\}/);
  assert.match(shell, /PROJECT WORKSPACE/);
});

test("normal active UX omits implementation diagnostics", async () => {
  const files = await Promise.all(["app/components/project/ProjectShell.tsx", "app/components/workspaces/OverviewWorkspace.tsx", "app/components/workspaces/PricingWorkspace.tsx", "app/components/workspaces/QuotationWorkspace.tsx"].map(source));
  const text = files.join("\n");
  for (const phrase of ["SERVER VERIFIED", "SERVER DERIVED", "WORKSPACE LOCK", "records project-bound", "Not exposed", "pricing API does not yet expose", "Ready for quotation:"]) assert.doesNotMatch(text, new RegExp(phrase));
});

test("AI POST endpoint fails before provider use when meaningful evidence is absent", async () => {
  const api = await source("worker/ai-quotation-api.mjs");
  assert.ok(api.indexOf("AI_QUOTATION_EVIDENCE_REQUIRED") < api.indexOf("const provider=createConfiguredCloudflareStructuredProvider(env" , api.indexOf("request.method!==\"POST\"")));
});
