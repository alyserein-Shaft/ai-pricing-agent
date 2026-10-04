import { chromium } from "playwright";

const BASE = "http://localhost:4183";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

const apiCalls = [];
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("/api/knowledge/review/")) {
    apiCalls.push(`${response.request().method()} ${response.status()} ${url}`);
  }
});

try {
  console.log("=== 1D. GOVERNED DECISION WALKTHROUGH ===");
  
  await page.goto(`${BASE}/?workspace=Knowledge&section=Review`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator(".review-item").first().waitFor({ timeout: 30000 });
  
  // --- CONFIRM DECISION ---
  console.log("\n--- CONFIRM DECISION ---");
  
  const fileItem = page.locator('.review-item:has-text("FILE")').first();
  const fileTitle = await fileItem.locator("strong").innerText();
  console.log(`Confirming: ${fileTitle}`);
  
  await fileItem.locator('button:has-text("Review this file")').click();
  await page.waitForTimeout(500);
  
  const hasReasonTextarea = await page.locator('textarea[placeholder*="reason"]').count();
  const hasConfirmBtn = await page.locator('button:has-text("Confirm")').count();
  const hasRejectBtn = await page.locator('button:has-text("Reject")').count();
  console.log(`Decision box: reason=${hasReasonTextarea>0}, confirm=${hasConfirmBtn>0}, reject=${hasRejectBtn>0}`);
  
  const confirmDisabled = await page.locator('button:has-text("Confirm")').isDisabled();
  console.log(`Confirm disabled (empty reason): ${confirmDisabled}`);
  
  const confirmReason = "KN-UX-4 validation: source file matches detected Supplier RFQ type, classification confidence 88%, processing completed, confirming classification as Needs Review is correct";
  await page.locator('textarea[placeholder*="reason"]').fill(confirmReason);
  await page.waitForTimeout(300);
  
  const confirmEnabled = await page.locator('button:has-text("Confirm")').isDisabled();
  console.log(`Confirm enabled (with reason): ${!confirmEnabled}`);
  
  const [confirmResp] = await Promise.all([
    page.waitForResponse(r => r.url().includes("/api/knowledge/review/file/") && r.request().method() === "POST", { timeout: 15000 }),
    page.locator('button:has-text("Confirm")').click(),
  ]);
  
  console.log(`Confirm response: ${confirmResp.status()}`);
  const confirmResult = await confirmResp.json().catch(() => ({}));
  console.log(`Confirm result:`, confirmResult);
  
  await page.waitForTimeout(2000);
  
  const itemsAfterConfirm = await page.locator(".review-item").count();
  console.log(`Items after confirm: ${itemsAfterConfirm}`);
  
  // --- REJECT DECISION ---
  console.log("\n--- REJECT DECISION ---");
  
  await page.locator(".review-item").first().waitFor({ timeout: 10000 });
  const factItem = page.locator('.review-item:has-text("FACT")').first();
  const factTitle = await factItem.locator("strong").innerText();
  console.log(`Rejecting: ${factTitle}`);
  
  await factItem.locator('button:has-text("Review this fact")').click();
  await page.waitForTimeout(500);
  
  const rejectReason = "KN-UX-4 validation: fact item is a BOQ Item extraction with low confidence (57%), rejecting as the extracted value does not match expected part number format";
  await page.locator('textarea[placeholder*="reason"]').fill(rejectReason);
  await page.waitForTimeout(300);
  
  const [rejectResp] = await Promise.all([
    page.waitForResponse(r => r.url().includes("/api/knowledge/review/fact/") && r.request().method() === "POST", { timeout: 15000 }),
    page.locator('button:has-text("Reject")').click(),
  ]);
  
  console.log(`Reject response: ${rejectResp.status()}`);
  const rejectResult = await rejectResp.json().catch(() => ({}));
  console.log(`Reject result:`, rejectResult);
  
  await page.waitForTimeout(2000);
  
  const itemsAfterReject = await page.locator(".review-item").count();
  console.log(`Items after reject: ${itemsAfterReject}`);
  
  console.log("\nAPI calls made:");
  for (const call of apiCalls) {
    console.log(`  ${call}`);
  }
  
  await page.screenshot({ path: ".local-evidence/1d-decisions.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/1d-error.png", fullPage: true });
} finally {
  await browser.close();
}
