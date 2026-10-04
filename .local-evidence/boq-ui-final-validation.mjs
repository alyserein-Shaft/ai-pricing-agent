import { chromium } from "playwright";

const BASE = "http://localhost:4183";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

const consoleErrors = [];
const failedRequests = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300)); });
page.on("response", (response) => {
  const url = response.url();
  if (response.status() >= 400 && !/woff|font|\\.png|\\.svg/.test(url)) failedRequests.push(`${response.status()} ${response.request().method()} ${url.replace(BASE, "")}`);
});

try {
  console.log("=== BOQ UI FINAL RECONCILIATION VALIDATION ===");
  
  await page.goto(`${BASE}/?project=project_ae501b85-9c12-4332-bf8e-787c90f2d388&workspace=BOQ`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.locator("tbody tr").first().waitFor({ timeout: 30000 });
  
  const bodyText = await page.locator("body").innerText();
  
  // ===== ISSUE 1: Quick filter =====
  console.log("\n=== ISSUE 1: QUICK FILTER ===");
  const filterButtons = await page.locator("button").filter({ hasText: /Needs Review|Possible Duplicates|All|Verified/ }).allInnerTexts();
  console.log("Filter buttons:", filterButtons);
  
  const needsReviewMatch = bodyText.match(/Needs Review\s*\((\d+)\)/);
  if (needsReviewMatch) {
    console.log(`"Needs Review" filter count: ${needsReviewMatch[1]}`);
    console.log(needsReviewMatch[1] === "0" ? "✅ PASS: Needs Review = 0" : "❌ FAIL: Needs Review != 0");
  }
  
  // Check Action Center
  const actionCenterMatch = bodyText.match(/BOQ extraction is fully reviewed|extraction review/i);
  console.log(`Action Center says "fully reviewed": ${actionCenterMatch ? "✅" : "❌"}`);
  
  // ===== ISSUE 2: UNDERSTANDING column =====
  console.log("\n=== ISSUE 2: UNDERSTANDING COLUMN ===");
  const headers = await page.locator("thead th").allInnerTexts();
  console.log("Table headers:", headers);
  const hasUnderstandingHeader = headers.some(h => /understanding/i.test(h));
  console.log(`Has UNDERSTANDING header: ${hasUnderstandingHeader ? "❌ FAIL" : "✅ PASS"}`);
  
  // Check for AI INTERPRETATION content in the table
  const hasAIInterpretation = /AI INTERPRETATION|NOT A VERIFIED|missing attributes/i.test(bodyText);
  console.log(`Has AI INTERPRETATION content in table: ${hasAIInterpretation ? "❌ FAIL" : "✅ PASS"}`);
  
  // ===== DOWNSTREAM HANDOFF =====
  console.log("\n=== DOWNSTREAM HANDOFF ===");
  const hasHandoff = /AI Understanding/.test(bodyText);
  console.log(`AI Understanding handoff present: ${hasHandoff ? "✅" : "❌"}`);
  
  const hasOpenButton = await page.locator('button:has-text("Open AI Understanding")').count();
  console.log(`"Open AI Understanding" button: ${hasOpenButton > 0 ? "✅" : "❌"}`);
  
  // ===== TABLE COLUMNS =====
  console.log("\n=== TABLE STRUCTURE ===");
  console.log(`Total rows: ${await page.locator("tbody tr").count()}`);
  
  // Check extraction statuses
  const extractionCells = await page.locator("td >> nth-of-type(7)").allInnerTexts(); // Extraction column (index 6, 0-based)
  console.log(`Extraction column samples:`, extractionCells.slice(0, 5));
  
  // Check actions column still works
  const actionCells = await page.locator(".boq-col-actions").count();
  console.log(`Actions column cells: ${actionCells}`);
  
  console.log("\n=== CONSOLE ERRORS ===");
  console.log(consoleErrors.slice(0, 3));
  
  console.log("\n=== FAILED REQUESTS ===");
  console.log(failedRequests.slice(0, 3));
  
  await page.screenshot({ path: ".local-evidence/boq-ui-final-result.png", fullPage: true });
  
  // Final verdict
  const issue1Pass = needsReviewMatch && needsReviewMatch[1] === "0";
  const issue2Pass = !hasUnderstandingHeader && !hasAIInterpretation;
  const handoffPass = hasHandoff && hasOpenButton > 0;
  
  console.log("\n=== FINAL VERDICT ===");
  console.log(`Issue 1 (Needs Review = 0): ${issue1Pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Issue 2 (No Understanding column): ${issue2Pass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Handoff intact: ${handoffPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`Overall: ${issue1Pass && issue2Pass && handoffPass ? "🟢 CLOSED" : "🔴 FAIL"}`);
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/boq-ui-final-error.png", fullPage: true });
} finally {
  await browser.close();
}