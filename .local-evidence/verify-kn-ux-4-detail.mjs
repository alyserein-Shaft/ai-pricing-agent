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
  // Navigate to Knowledge Library Review section
  await page.goto(`${BASE}/?workspace=Knowledge&section=Review`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Wait for the review items to load
  await page.locator(".review-item").first().waitFor({ timeout: 30000 });

  // Click the first "Review this file" button
  const firstReviewButton = page.locator('button:has-text("Review this file")').first();
  await firstReviewButton.click();
  await page.waitForTimeout(1000);

  // Get the page content after clicking
  const bodyText = await page.locator("body").innerText();
  
  // Check for decision box elements
  const hasReasonTextarea = await page.locator('textarea[placeholder*="reason"]').count();
  console.log("Reason textareas after click:", hasReasonTextarea);
  
  const hasConfirmButton = await page.locator('button:has-text("Confirm")').count();
  console.log("Confirm buttons after click:", hasConfirmButton);
  
  const hasRejectButton = await page.locator('button:has-text("Reject")').count();
  console.log("Reject buttons after click:", hasRejectButton);
  
  // Check for processing status in the review item
  const reviewItemText = await page.locator(".review-item").first().innerText();
  console.log("First review item text:", reviewItemText.slice(0, 500));
  
  // Fill in a reason and click Confirm
  if (hasConfirmButton > 0) {
    await page.locator('textarea[placeholder*="reason"]').fill("Test review reason for confirmation - this item looks correct");
    await page.waitForTimeout(500);
    
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().includes("/api/knowledge/review/") && r.request().method() === "POST", { timeout: 15000 }),
      page.locator('button:has-text("Confirm")').click(),
    ]);
    
    console.log("Confirm response status:", response.status());
    const result = await response.json().catch(() => ({}));
    console.log("Confirm result:", result);
    
    await page.waitForTimeout(2000);
    
    // Check if item was removed
    const reviewItemsAfter = await page.locator(".review-item").count();
    console.log("Review items after confirm:", reviewItemsAfter);
  }
  
  console.log("\n=== Console Errors ===");
  console.log(consoleErrors.slice(0, 5));
  
  console.log("\n=== Failed Requests ===");
  console.log(failedRequests.slice(0, 5));
  
  await page.screenshot({ path: ".local-evidence/kn-ux-4-review-detail.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/kn-ux-4-detail-error.png", fullPage: true });
} finally {
  await browser.close();
}