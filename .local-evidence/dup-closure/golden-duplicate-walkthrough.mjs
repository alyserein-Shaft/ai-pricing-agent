// DUP closure Stage 3 — Golden engineer walkthrough driver (locator fix v2).
// Drives the REAL UI on the canonical runtime (http://localhost:4183) against
// the Golden project only. Every decision below was made from source evidence
// gathered in Stage 3B (see the closure report): the MECH RFQ sheet repeats
// the fire alarm schedule verbatim (rows 103-119 duplicate rows 59-75), while
// row 156 is the control panel of a genuinely separate, smaller schedule
// (rows 144-160) and must NOT be merged.
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const BASE = "http://localhost:4183";
const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const log = [];
const record = (step, data) => {
  log.push({ step, at: new Date().toISOString(), ...data });
  console.log(`[${step}]`, JSON.stringify(data));
};

// Evidence-based decisions: [duplicate source row, first-occurrence row, item, qty]
const MERGE_ROWS = [
  [103, 59, "D", "192"], [105, 61, "E", "243"], [109, 65, "G", "10"], [111, 67, "H", "24"],
  [113, 69, "J", "13"], [115, 71, "K", "1"], [117, 73, "L", "33"], [119, 75, "M", "8"],
];
const NOT_DUPLICATE_ROW = { row: 156, item: "K", qty: "1" };
const SURVIVOR_ROWS = [59, 61, 65, 67, 69, 71, 73, 75];

const mergeReason = ([dupeRow, firstRow, item, qty]) =>
  `MECH RFQ row ${dupeRow} repeats row ${firstRow} verbatim (item ${item}, ${qty} No, same description and section); confirmed real duplicate and merged into the original line.`;
const BULK_REASON =
  "Duplicate-resolution re-review: each row merged its verbatim re-listing from MECH RFQ rows 103-119; unit and quantity are unchanged from the already-verified source content; confirmed against the source schedule.";
const NOT_DUPLICATE_REASON =
  "MECH RFQ row 156 is the control panel of the separate smaller fire alarm schedule (rows 144-160: 56/81/1/5/8/6/1/23/2), not a duplicate of the main schedule panel at row 71; kept as a distinct line.";
const APPROVE_PANEL_REASON =
  "Distinct second-schedule control panel (MECH RFQ row 156) reviewed against the source; extraction content (panel, No, qty 1) is complete and confirmed.";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
const consoleErrors = [];
const failedRequests = [];
const apiCalls = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300)); });
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("/api/")) apiCalls.push(`${response.request().method()} ${response.status()} ${url.replace(BASE, "")}`);
  if (response.status() >= 400 && !/woff|font|\.png|\.svg/.test(url)) failedRequests.push(`${response.status()} ${response.request().method()} ${url.replace(BASE, "")}`);
});

let pendingDialogText = null;
page.on("dialog", async (dialog) => {
  if (pendingDialogText !== null) { const text = pendingDialogText; pendingDialogText = null; await dialog.accept(text); return; }
  if (dialog.type() === "prompt") await dialog.accept(dialog.defaultValue());
  else await dialog.dismiss();
});

const rowBySourceRow = (rowNumber) =>
  page.locator("tbody tr").filter({ hasText: new RegExp(`row ${rowNumber}(\\D|$)`) }).first();
const buttonWithText = (scope, text) => scope.locator("button").filter({ hasText: text }).first();
const waitForPost = (urlPart) => page.waitForResponse((response) =>
  response.request().method() === "POST" && response.url().includes(urlPart), { timeout: 45000 });

const openMore = async (rowNumber) => {
  const row = rowBySourceRow(rowNumber);
  await row.locator("details.row-actions-menu summary").click();
  await page.waitForTimeout(250);
  return row;
};

const dashboardFacts = async () => {
  const response = await page.request.get(`${BASE}/api/projects/${PROJECT}/dashboard`);
  const payload = await response.json();
  const facts = payload.facts || {};
  const extraction = (payload.workflow?.stages || []).find((stage) => stage.id === "extraction");
  return {
    boqItems: facts.boqItems, extractionReview: facts.extractionReview,
    possibleDuplicates: facts.possibleDuplicates, extractionConfirmed: facts.extractionConfirmed,
    extractionStage: extraction?.status, extractionBlockers: extraction?.blockers,
    workflowStage: payload.workflow?.workflowStage, readyForQuotation: payload.workflow?.readyForQuotation,
    currentStageId: payload.workflow?.currentStageId,
  };
};

try {
  await page.goto(`${BASE}/?project=${PROJECT}&workspace=BOQ`, { waitUntil: "domcontentloaded" });
  await page.locator("tbody tr").first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);

  const actionCenterText = await page.locator("body").innerText();
  record("landing", {
    resolveAffordance: actionCenterText.match(/Resolve \d+ possible duplicates?[^\n]*/)?.[0] || null,
    filterLabels: await page.locator("button").filter({ hasText: "Possible Duplicates (" }).allInnerTexts(),
    facts: await dashboardFacts(),
  });
  await page.screenshot({ path: `${OUT}01-boq-workspace.png` });

  // ---- open the duplicate queue through the real quick filter ----
  await buttonWithText(page, "Possible Duplicates (").click();
  await page.waitForTimeout(1500);
  record("duplicate-filter-open", { visibleRows: await page.locator("tbody tr").count() });

  // ---- 3B: the 8 evidence-confirmed merges ----
  for (const entry of MERGE_ROWS) {
    const row = await openMore(entry[0]);
    pendingDialogText = mergeReason(entry);
    const [response] = await Promise.all([
      waitForPost("/merge"),
      buttonWithText(row, "Merge into original").click(),
    ]);
    const body = await response.json().catch(() => ({}));
    record("merge", { sourceRow: entry[0], intoRow: entry[1], item: entry[2], status: response.status(), survivorStatus: body.item?.review_status ?? null, survivorFlag: body.item?.duplicate_of_item_id ?? null });
    await page.waitForTimeout(1800);
  }
  record("after-merges", { visibleRows: await page.locator("tbody tr").count(), facts: await dashboardFacts() });
  await page.screenshot({ path: `${OUT}02-after-merges.png` });

  // ---- 3B: evidence-confirmed Not Duplicate (row 156, separate schedule panel) ----
  {
    const row = await openMore(NOT_DUPLICATE_ROW.row);
    await buttonWithText(row, "Not Duplicate").click();
    const overlay = page.locator(".boq-review-action-overlay");
    await overlay.locator("h2").waitFor({ timeout: 15000 });
    const title = (await overlay.locator("h2").innerText()).trim();
    await overlay.locator("textarea").fill(NOT_DUPLICATE_REASON);
    const [response] = await Promise.all([
      waitForPost("/not-duplicate"),
      buttonWithText(overlay, "Not Duplicate").click(),
    ]);
    const body = await response.json().catch(() => ({}));
    record("not-duplicate", { sourceRow: NOT_DUPLICATE_ROW.row, modalTitle: title, status: response.status(), flagAfter: body.item?.duplicate_of_item_id ?? "STILL-SET", reviewStatus: body.item?.review_status ?? null });
    await page.waitForTimeout(1800);
  }
  record("after-not-duplicate", { visibleRows: await page.locator("tbody tr").count(), facts: await dashboardFacts() });
  await page.screenshot({ path: `${OUT}03-after-not-duplicate.png` });

  // ---- 3C: approve the distinct panel row individually ----
  await buttonWithText(page, "Needs Review (").click();
  await page.waitForTimeout(1500);
  const needsReviewBeforePanel = await page.locator("tbody tr").count();
  {
    const row = await openMore(NOT_DUPLICATE_ROW.row);
    await buttonWithText(row, "Confirm manually").click();
    const overlay = page.locator(".boq-review-action-overlay");
    await overlay.locator("h2").waitFor({ timeout: 15000 });
    const title = (await overlay.locator("h2").innerText()).trim();
    await overlay.locator("textarea").fill(APPROVE_PANEL_REASON);
    const [response] = await Promise.all([
      waitForPost("/approve"),
      buttonWithText(overlay, "Confirm Extraction").click(),
    ]);
    record("approve-panel", { sourceRow: NOT_DUPLICATE_ROW.row, modalTitle: title, status: response.status() });
    await page.waitForTimeout(1800);
  }

  // ---- 3C: bulk-confirm the 8 merged survivors ----
  const needsReviewRowsBeforeBulk = await page.locator("tbody tr").count();
  for (const rowNumber of SURVIVOR_ROWS) {
    await rowBySourceRow(rowNumber).locator("input[type='checkbox']").check();
  }
  const selectedLabel = await page.locator(".profile-actions strong").first().innerText().catch(() => null);
  pendingDialogText = BULK_REASON;
  const [bulkResponse] = await Promise.all([
    waitForPost("/bulk-review"),
    buttonWithText(page, "Confirm extraction review").click(),
  ]);
  const bulkBody = await bulkResponse.json().catch(() => ({}));
  record("bulk-approve", {
    needsReviewBeforePanel, needsReviewRowsBeforeBulk, selectedLabel,
    status: bulkResponse.status(), reviewed: bulkBody.reviewed, extractionStatus: bulkBody.extractionStatus,
  });
  await page.waitForTimeout(3000);

  // ---- 3D: live end state ----
  const finalFacts = await dashboardFacts();
  record("final-facts", finalFacts);

  await buttonWithText(page, "All (").click();
  await page.waitForTimeout(1200);
  await buttonWithText(page, "Possible Duplicates (").click();
  await page.waitForTimeout(1200);
  const finalFilterRows = await page.locator("tbody tr").count();
  const finalBodyText = await page.locator("body").innerText();
  record("final-ui", {
    duplicateFilterRows: finalFilterRows,
    resolveAffordanceGone: !/Resolve [1-9]\d* possible duplicate/.test(finalBodyText),
    filterLabelsAfter: await page.locator("button").filter({ hasText: "Possible Duplicates (" }).allInnerTexts(),
  });
  await page.screenshot({ path: `${OUT}04-final-duplicate-filter.png` });

  await page.goto(`${BASE}/?project=${PROJECT}&workspace=Overview`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const overviewText = await page.locator("body").innerText();
  record("overview", {
    extractionStage: overviewText.match(/BOQ and specification extraction\s*\n?\s*(\S[^\n]{0,40})/)?.[1] || null,
    duplicateStat: overviewText.match(/POSSIBLE DUPLICATES\s*\n\s*(\d+)/)?.[1] || null,
    needsReviewStat: overviewText.match(/BOQ ITEMS NEEDING REVIEW\s*\n\s*(\d+)/)?.[1] || null,
    nextActionText: overviewText.match(/(Continue to AI Understanding[^\n]{0,60}|Review \d+ items[^\n]{0,40}|Resolve \d+ possible[^\n]{0,40})/)?.[1] || null,
  });
  await page.screenshot({ path: `${OUT}05-overview.png` });

  record("runtime-hygiene", { consoleErrors: consoleErrors.slice(0, 12), failedRequests: failedRequests.slice(0, 12) });
  record("api-trail", { calls: apiCalls.filter((call) => /boq-items|bulk-review|dashboard/.test(call)).slice(-45) });
} catch (error) {
  record("driver-error", { message: String(error).slice(0, 600) });
  await page.screenshot({ path: `${OUT}error.png`, fullPage: true }).catch(() => {});
} finally {
  writeFileSync(`${OUT}walkthrough-log.json`, JSON.stringify(log, null, 2));
  await browser.close();
}
