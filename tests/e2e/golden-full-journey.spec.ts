import { expect, test, type APIRequestContext, type Page } from "playwright/test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/* eslint-disable @typescript-eslint/no-explicit-any -- API contracts are asserted at runtime across independently versioned worker modules. */

const fixture = (name: string) => path.join(process.cwd(), "tests/e2e/fixtures", name);
const reportJson = path.join(process.cwd(), "Golden_E2E_Result_v1.json");
const reportMd = path.join(process.cwd(), "Golden_E2E_Execution_v1.md");
const checkpoints: Array<Record<string, unknown>> = [];
let failureMessage = "";

const responseJson = async (response: Awaited<ReturnType<APIRequestContext["get"]>>) => {
  const text = await response.text();
  try { return JSON.parse(text); } catch { throw new Error(`${response.url()} returned ${response.status()}: ${text.slice(0, 500)}`); }
};

const api = async (request: APIRequestContext, method: "get" | "post" | "patch", url: string, options: Record<string, unknown> = {}) => {
  const response = await request[method](url, options);
  const body = await responseJson(response);
  if (!response.ok()) throw new Error(`${method.toUpperCase()} ${url} returned ${response.status()}: ${JSON.stringify(body)}`);
  return body;
};

const poll = async <T>(label: string, operation: () => Promise<T>, complete: (value: T) => boolean, timeoutMs = 30_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  let latest: T;
  do {
    latest = await operation();
    if (complete(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  throw new Error(`${label} timed out. Last persisted response: ${JSON.stringify(latest!)}`);
};

const workflow = async (request: APIRequestContext, projectId: string, milestone: string) => {
  const value = await api(request, "get", `/api/projects/${projectId}/presales-workflow`);
  const server = value.workflow;
  for (const key of ["lifecycleState", "workflowStage", "workflowStatus", "progress", "blockers", "warnings", "nextAction", "readyForQuotation", "readyForIssue"])
    expect(server, `server workflow field ${key}`).toHaveProperty(key);
  checkpoints.push({ milestone, ...server });
  return value;
};

const upload = async (request: APIRequestContext, projectId: string, fileName: string, mimeType: string) => {
  const body = await readFile(fixture(fileName));
  return api(request, "post", `/api/projects/${projectId}/documents`, {
    multipart: { file: { name: fileName, mimeType, buffer: body }, projectName: "Golden Full Journey", documentType: "Auto Detection", reason: "Golden governed document intake" },
  });
};

const refreshAt = async (
  page: Page,
  projectId: string,
  workspace: string,
) => {
  const url = `/?project=${encodeURIComponent(projectId)}&workspace=${encodeURIComponent(workspace)}`;

  const assertLoaded = async () => {
    await expect(
      page.getByRole("button", { name: /Project Golden Full Journey/ }),
    ).toBeVisible();

    await expect.poll(async () => {
      const url = new URL(page.url());

      return {
        project: url.searchParams.get("project"),
        workspace: url.searchParams.get("workspace"),
      };
    }).toEqual({
      project: projectId,
      workspace,
    });

    await expect(
      page.getByRole("heading", { level: 1 }).first(),
    ).toBeVisible();
  };

  await page.goto(url);
  await assertLoaded();

  await page.reload();
  await assertLoaded();
};

test.afterEach(async ({}, testInfo) => { if (testInfo.status !== testInfo.expectedStatus) failureMessage = testInfo.error?.message || testInfo.status; });

test.afterAll(async () => {
  const verdict = failureMessage ? "GOLDEN E2E FAILED" : "GOLDEN E2E PASSED";
  const result = { verdict, completedAt: new Date().toISOString(), failure: failureMessage || null, checkpoints };
  await writeFile(reportJson, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(reportMd, `# Golden E2E Execution v1\n\n**${verdict}**\n\nServer workflow checkpoints captured: ${checkpoints.length}.\n${failureMessage ? `\nFailure: ${failureMessage}\n` : ""}`);
});

test("@golden @golden-full completes the governed upload-to-issued-export journey", async ({ page, request }) => {
  const created = await api(request, "post", "/api/projects", { data: { name: "Golden Full Journey", client: "Internal Validation", reference: "GOLDEN-FULL-001", system: "Fire Alarm", currency: "SAR", status: "Draft" } });
  const projectId = created.project.id as string;
  await workflow(request, projectId, "project-created");

  const boqUpload = await upload(request, projectId, "golden-boq.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const specUpload = await upload(request, projectId, "golden-specification.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  const boqDocumentId = boqUpload.document.id as string;
  const specDocumentId = specUpload.document.id as string;
  await refreshAt(page, projectId, "Documents");

  for (const [documentId, selectedType] of [[boqDocumentId, "BOQ"], [specDocumentId, "Technical Specification"]]) {
    await poll("automatic classification", () => api(request, "get", `/api/documents/${documentId}/classification/result`), (value: any) => !["Classification Queued", "Classifying", "Not Classified"].includes(value.classification.status));
    await api(request, "post", `/api/documents/${documentId}/classification/override`, { data: { selectedType, secondaryTypes: [], reason: `Golden evidence confirms ${selectedType}`, startExtraction: true } });
  }

  const boqResult = await poll("BOQ extraction", () => api(request, "get", `/api/documents/${boqDocumentId}/boq-extraction/status`), (value: any) => ["Completed", "Needs Review", "Failed"].includes(value.extraction.status));
  expect(boqResult.extraction.status).not.toBe("Failed");
  const specResult = await poll(
    "specification extraction",
    async () => {
      const response = await request.get(
        `/api/documents/${specDocumentId}/specification-extraction/status`,
      );

      const body = await responseJson(response);

      if (
        response.status() === 409 &&
        body?.error?.code === "SPECIFICATION_EXTRACTION_REQUIRED"
      ) {
        return {
          extraction: {
            status: "Starting",
          },
        };
      }

      if (!response.ok()) {
        throw new Error(
          `GET specification extraction status returned ${response.status()}: ${JSON.stringify(body)}`,
        );
      }

      return body;
    },
    (value: any) =>
      ["Completed", "Needs Review", "Failed"].includes(
        value.extraction?.status,
      ),
  );

  expect(specResult.extraction.status).not.toBe("Failed");

  const itemPayload = await api(request, "get", `/api/documents/${boqDocumentId}/boq-extraction/items?limit=200`);
  const items = itemPayload.items.filter((item: any) => item.row_type === "BOQ Item");
  expect(items).toHaveLength(3);
  const valid = items.find((item: any) => item.part_number === "GOLDEN-FA-001");
  const incomplete = items.find((item: any) => /interface module/i.test(item.description));
  const noMatch = items.find((item: any) => item.part_number === "GOLDEN-NOMATCH-001");
  expect({ unit: valid.normalized_unit, quantity: Number(valid.numeric_quantity) }).toEqual({ unit: "Each", quantity: 2 });
  expect({ unit: incomplete.normalized_unit, quantity: Number(incomplete.numeric_quantity) }).toEqual({ unit: "Each", quantity: 1 });
  expect({ unit: noMatch.normalized_unit, quantity: Number(noMatch.numeric_quantity) }).toEqual({ unit: "Each", quantity: 1 });
  await api(request, "post", `/api/boq-items/${valid.id}/update`, {
    data: {
      reason: "Golden engineering review confirmed Fire Alarm detector classification from explicit project evidence",
      values: {
        system: "Fire Alarm",
        category: "Detection Device",
        subcategory: "Smoke Detector",
      },
    },
  });
  await api(request, "post", `/api/boq-items/${valid.id}/approve`, {
    data: {
      reason: "Source values and reviewed Fire Alarm detector classification confirmed",
    },
  });
  for (const item of [incomplete, noMatch]) {
    await api(request, "post", `/api/boq-items/${item.id}/approve`, {
      data: {
        reason: "Source row and extracted values visually confirmed",
      },
    });
  }
  await refreshAt(page, projectId, "BOQ");

  const requirementPayload = await api(request, "get", `/api/documents/${specDocumentId}/specification-extraction/requirements?limit=200`);
  expect(requirementPayload.requirements.length).toBeGreaterThanOrEqual(3);
  for (const requirement of requirementPayload.requirements) await api(request, "post", `/api/requirements/${requirement.id}/approve`, { data: { reason: "Explicit native-text technical evidence confirmed" } });
  await api(request, "post", `/api/projects/${projectId}/engineering-knowledge/suggest-links`);
  const links = (await api(request, "get", `/api/projects/${projectId}/engineering-knowledge/links`)).links;
  const validLink = links.find((link: any) => link.boq_item_id === valid.id && /GOLDEN-FA-001|24 V/i.test(link.original_text));
  expect(validLink).toBeTruthy();
  await api(request, "post", `/api/requirement-links/${validLink.id}/confirm`, { data: { reason: "Exact model and operating-voltage evidence applies to this BOQ item" } });
  for (const item of [incomplete, noMatch]) await api(request, "post", `/api/boq-items/${item.id}/requirement-profile/generate`);
  for (const item of items) await poll("requirement profile", () => api(request, "get", `/api/boq-items/${item.id}/requirement-profile`), (value: any) => Boolean(value.profile?.id));

  const ready = await api(request, "post", `/api/boq-items/${valid.id}/requirement-profile/approve-readiness`, { data: { reason: "Complete exact-model profile reviewed for controlled matching" } });
  expect(ready.approved).toBe(true);
  const incompleteReadiness = await request.post(`/api/boq-items/${incomplete.id}/requirement-profile/approve-readiness`, { data: { reason: "Attempt must remain blocked because mandatory identity is missing" } });
  expect(incompleteReadiness.status()).toBe(409);

  for (const item of items) await api(request, "post", `/api/boq-items/${item.id}/matching/start`);
  for (const item of items) await poll("product matching", () => api(request, "get", `/api/boq-items/${item.id}/matching/status`), (value: any) => !["Queued", "Processing", "Not Started"].includes(value.processing?.status || value.status));
  const validCandidates = (await api(request, "get", `/api/boq-items/${valid.id}/matching/candidates`)).candidates;
  const candidate = validCandidates.find((entry: any) => entry.part_number === "GOLDEN-FA-001");
  expect(candidate).toBeTruthy();

  const candidateExplanation = await api(
    request,
    "get",
    `/api/match-candidates/${candidate.id}/explanation`,
  );
  const candidateComparisons = await api(
    request,
    "get",
    `/api/match-candidates/${candidate.id}/comparisons`,
  );

  const incompleteCandidates = (await api(request, "get", `/api/boq-items/${incomplete.id}/matching/candidates`)).candidates;
  expect(incompleteCandidates.every((entry: any) => entry.confidence_state !== "High Confidence")).toBe(true);
  const noMatchSummary = await api(request, "get", `/api/boq-items/${noMatch.id}/matching/summary`);
  expect(Number(noMatchSummary.matchRun.candidate_count)).toBe(0);

  const blockedSafety = incompleteCandidates[0] && await api(request, "post", `/api/match-candidates/${incompleteCandidates[0].id}/safety/evaluate`, { data: { reason: "Golden negative safety evaluation" } });
  if (blockedSafety) {
    const blockedApproval = await request.post(`/api/match-candidates/${incompleteCandidates[0].id}/safety/approve`, { data: { approvalType: "Technical", entityVersion: blockedSafety.decision.version_number, reason: "This attempt must be rejected" } });
    expect(blockedApproval.status()).toBe(409);
  }
  const safety = await api(request, "post", `/api/match-candidates/${candidate.id}/safety/evaluate`, { data: { reason: "Exact model, source provenance, and mandatory values evaluated" } });
  const requiredWarnings = safety.decision.warnings.filter((warning: any) => warning.acknowledgment_required && !warning.acknowledged_at);
  if (requiredWarnings.length) await api(request, "post", `/api/match-candidates/${candidate.id}/safety/warnings/acknowledge`, { data: { warningIds: requiredWarnings.map((warning: any) => warning.id), reason: "Warnings reviewed against the Golden evidence" } });
  const currentSafety = await api(
    request,
    "get",
    `/api/match-candidates/${candidate.id}/safety`,
  );

  await api(request, "post", `/api/match-candidates/${candidate.id}/safety/approve`, { data: { approvalType: "Technical", entityVersion: safety.decision.version_number, reason: "Controlled technical eligibility explicitly approved", evidence: { source: "golden-product-source" } } });
  await refreshAt(page, projectId, "Technical Matching");

  const premature = await request.post(`/api/projects/${projectId}/presales-workflow/quotation/draft`, { data: { validityDays: 30 } });
  expect(premature.status()).toBe(409);
  expect((await responseJson(premature)).error.code).toBe("QUOTATION_READINESS_BLOCKED");
  const scenario = await api(request, "post", `/api/pricing/projects/${projectId}/scenarios`, { data: { name: "Golden governed scenario", projectCurrency: "SAR" } });
  const selectedScenario = await api(
    request,
    "post",
    `/api/pricing/projects/${projectId}/selected-scenario`,
    {
      data: {
        scenarioId: scenario.scenarioId,
        reason: "Selected as the governed quotation pricing scenario for the Golden journey",
      },
    },
  );
  expect(selectedScenario.selectedScenario.id).toBe(scenario.scenarioId);

  const manual = await api(
    request,
    "post",
    `/api/pricing/items/${valid.id}/manual-price?scenarioId=${encodeURIComponent(scenario.scenarioId)}`,
    {
      data: {
        candidateId: candidate.id,
        productId: "golden-product-fa-001",
        source: "golden-current-price-source.csv",
        effectiveFrom: "2026-08-01",
        validUntil: "2027-08-01",
        price: 125,
        currency: "SAR",
        unit: "EA",
        scope: "Project item",
        reason: "Current dated supplier evidence submitted for governed review",
      },
    },
  );
  expect(manual).toMatchObject({ approvalStatus: "Needs Review", downstreamUse: "Discovery Only" });
  const unreviewedCalculation = await request.post(
    `/api/pricing/items/${valid.id}/calculate`,
    {
      data: {
        scenarioId: scenario.scenarioId,
        candidateId: candidate.id,
        reason: "Unreviewed evidence must remain commercially unusable",
      },
    },
  );

  expect(unreviewedCalculation.status()).toBe(201);

  const unreviewedPricing = await responseJson(unreviewedCalculation);

  expect(unreviewedPricing.result?.approvalReady).toBe(false);
  expect(unreviewedPricing.result?.selectedSource ?? null).toBeNull();
  await api(
    request,
    "post",
    `/api/price-sources/${manual.sourceId}/review`,
    {
      data: {
        downstreamUse: "Costing",
        reason: "Current source, validity and exact product reference reviewed",
      },
    },
  );

  const reviewedSource = await api(
    request,
    "get",
    `/api/price-sources/${manual.sourceId}/prices`,
  );

  const selectedPrice = reviewedSource.prices.find(
    (entry: any) =>
      entry.product_id === "golden-product-fa-001" &&
      entry.approval_status === "Approved" &&
      entry.downstream_use === "Costing",
  );

  expect(selectedPrice).toBeTruthy();

  await refreshAt(page, projectId, "Pricing");

  const priced = await api(
    request,
    "post",
    `/api/pricing/items/${valid.id}/calculate`,
    {
      data: {
        scenarioId: scenario.scenarioId,
        candidateId: candidate.id,
        selectedPriceSourceId: selectedPrice.id,
        reason: "Calculate from explicitly selected reviewed current source",
      },
    },
  );

  expect(priced.result?.approvalReady).toBe(true);
  expect(priced.result?.selectedSource?.id).toBe(selectedPrice.id);

  await api(
    request,
    "post",
    `/api/pricing/runs/${priced.runId}/approve`,
    {
      data: {
        entityVersion: priced.version,
        reason: "Server-calculated price and source evidence commercially approved",
      },
    },
  );

  for (const item of [incomplete, noMatch]) await api(request, "post", `/api/boq-items/${item.id}/row-type`, { data: { rowType: "Excluded", reason: "Golden negative case retained but excluded from quotation scope" } });

  const beforeFinalReview = await workflow(request, projectId, "before-final-review");
  expect(beforeFinalReview.workflow.readyForQuotation).toBe(false);

  await api(request, "post", `/api/reviews/projects/${projectId}/sync`);
  const queue = (await api(request, "get", `/api/reviews/projects/${projectId}/queue`)).items;
  expect(queue).toHaveLength(1);
  const review = queue[0];
  const started = await api(request, "post", `/api/reviews/${review.id}/start`, { data: { reviewVersion: review.version_number, reason: "Begin final governed review" } });
  const technicalDecision = await api(request, "post", `/api/reviews/${review.id}/decision`, { data: { reviewVersion: started.version, type: "Approve Technical Match", outcome: "Approved", reason: "Persisted safety approval and exact product evidence reviewed", evidence: [{ candidateId: candidate.id }] } });
  await api(request, "post", `/api/reviews/${review.id}/decision`, { data: { reviewVersion: technicalDecision.version, type: "Approve Commercial Cost", outcome: "Approved", reason: "Persisted commercial price approval and calculated totals reviewed", evidence: [{ pricingRunId: priced.runId }] } });

  const readyWorkflow = await workflow(request, projectId, "ready-for-quotation");

  expect(readyWorkflow.workflow.readyForQuotation).toBe(true);
  const quote = await api(request, "post", `/api/projects/${projectId}/presales-workflow/quotation/draft`, { data: { validityDays: 30, warrantyMonths: 12, delivery: "As agreed", paymentTerms: "As agreed" } });

  const alternativeScenario = await api(
    request,
    "post",
    `/api/pricing/projects/${projectId}/scenarios`,
    { data: { name: "Golden alternative scenario", projectCurrency: "SAR" } },
  );

  await api(
    request,
    "post",
    `/api/pricing/projects/${projectId}/selected-scenario`,
    {
      data: {
        scenarioId: alternativeScenario.scenarioId,
        reason: "Temporarily select alternative scenario to prove quotation staleness",
      },
    },
  );

  const staleApproval = await request.post(
    `/api/projects/${projectId}/presales-workflow/quotation/approve`,
    {
      data: {
        quotationRevisionId: quote.quotation.id,
        quotationFingerprint: quote.quotation.quotationFingerprint,
        reason: "Attempt approval after governed pricing scenario changed",
      },
    },
  );

  expect(staleApproval.status()).toBe(409);
  expect((await responseJson(staleApproval)).error.code).toBe("QUOTATION_STALE");

  await api(
    request,
    "post",
    `/api/pricing/projects/${projectId}/selected-scenario`,
    {
      data: {
        scenarioId: scenario.scenarioId,
        reason: "Restore original governed scenario after staleness regression proof",
      },
    },
  );

  const approved = await api(request, "post", `/api/projects/${projectId}/presales-workflow/quotation/approve`, { data: { quotationRevisionId: quote.quotation.id, quotationFingerprint: quote.quotation.quotationFingerprint, reason: "Golden quotation revision explicitly approved" } });
  expect(approved.status).toBe("Approved");
  await refreshAt(page, projectId, "Quotation");

  const exported = await api(request, "post", `/api/excel-exports/projects/${projectId}/exports`, { headers: { "idempotency-key": `golden-export-${projectId}` }, data: { mode: "Approved Cost Sheet", reason: "Golden approved quotation export", tenderNumber: "GOLDEN-FULL-001" } });
  expect(["Completed", "Completed with Warnings"]).toContain(exported.status);
  const download = await request.get(`/api/excel-exports/${exported.jobId}/download`);
  expect(download.ok()).toBe(true);
  expect(download.headers()["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  expect(download.headers()["x-export-sha256"]).toBeTruthy();
  const exportedWorkbook = await download.body();
  expect(exportedWorkbook.byteLength).toBeGreaterThan(1000);

  const reviewDir = `${process.env.HOME}/Desktop/AI-Pricing-Agent-Golden-Engineer-Review`;
  const fs = await import("node:fs/promises");
  await fs.mkdir(reviewDir, { recursive: true });
  await fs.writeFile(`${reviewDir}/03-Golden-Approved-Cost-Sheet.xlsx`, exportedWorkbook);
  await fs.writeFile(
    `${reviewDir}/04-Golden-Quotation.json`,
    JSON.stringify(
      {
        projectId,
        quotation: quote.quotation,
        approval: approved,
        export: exported,
      },
      null,
      2,
    ),
  );
  const issued = await api(request, "post", `/api/projects/${projectId}/presales-workflow/quotation/issue`, { data: { quotationRevisionId: quote.quotation.id, exportJobId: exported.jobId, reason: "Issue exact approved revision with governed export", issueReference: "GOLDEN-FULL-001-R1" } });
  expect(issued.status).toBe("Issued");
  const finalWorkflow = await workflow(request, projectId, "issued");
  expect(finalWorkflow.workflow.readyForIssue).toBe(true);

  const second = await api(request, "post", "/api/projects", { data: { name: "Golden Navigation Isolation", client: "Internal", reference: "GOLDEN-NAV-002", system: "Fire Alarm", status: "Draft" } });

  await page.goto(`/?project=${second.project.id}&workspace=Documents`);
  await expect(page).toHaveURL(new RegExp(`project=${second.project.id}`));
  await expect(page).toHaveURL(/workspace=Documents/);

  const secondDashboard = await api(
    request,
    "get",
    `/api/projects/${second.project.id}/dashboard`,
  );
  expect(secondDashboard.project?.id).toBe(second.project.id);
  expect(secondDashboard.project?.name).toBe("Golden Navigation Isolation");

  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`project=${projectId}`));

  const originalDashboard = await api(
    request,
    "get",
    `/api/projects/${projectId}/dashboard`,
  );
  expect(originalDashboard.project?.id).toBe(projectId);
  expect(originalDashboard.project?.name).toBe("Golden Full Journey");

  await page.goForward();
  await expect(page).toHaveURL(new RegExp(`project=${second.project.id}`));
  await expect(page).toHaveURL(/workspace=Documents/);
  await expect(page.getByText("GOLDEN-FA-001")).toHaveCount(0);
});
