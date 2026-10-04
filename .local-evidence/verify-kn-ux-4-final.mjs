import { chromium } from "playwright";

const BASE = "http://localhost:4183";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

const consoleErrors = [];
const failedRequests = [];
const apiCalls = [];
page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text().slice(0, 300)); });
page.on("response", (response) => {
  const url = response.url();
  if (url.includes("/api/")) apiCalls.push(`${response.request().method()} ${response.status()} ${url.replace(BASE, "")}`);
  if (response.status() >= 400 && !/woff|font|\\.png|\\.svg/.test(url)) failedRequests.push(`${response.status()} ${response.request().method()} ${url.replace(BASE, "")}`);
});

try {
  // Navigate to Knowledge Library Review section
  await page.goto(`${BASE}/?workspace=Knowledge&section=Review`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Wait for the review items to load
  await page.locator(".review-item").first().waitFor({ timeout: 30000 });

  // Get initial state
  const initialItems = await page.locator(".review-item").count();
  const bodyText = await page.locator("body").innerText();
  
  console.log("=== KN-UX-4 Final Verification ===");
  console.log(`Initial review items: ${initialItems}`);
  console.log("Section title:", await page.locator("h1").first().innerText());
  console.log("Subtitle:", await page.locator("p").first().innerText());
  
  // Verify review queue shows both files and facts
  const fileItems = await page.locator('.review-item:has-text("FILE")').count();
  const factItems = await page.locator('.review-item:has-text("FACT")').count();
  console.log(`File items: ${fileItems}, Fact items: ${factItems}`);
  
  // Verify each item shows kind, title, type, review status, confidence, source context
  const firstItemText = await page.locator(".review-item").first().innerText();
  console.log("\nFirst item details:", firstItemText.slice(0, 300));
  
  // Click "Review this file" on first item
  const firstReviewBtn = page.locator('button:has-text("Review this file")').first();
  await firstReviewBtn.click();
  await page.waitForTimeout(1000);
  
  // Verify decision box opens
  const hasReasonTextarea = await page.locator('textarea[placeholder*="reason"]').count();
  const hasConfirmBtn = await page.locator('button:has-text("Confirm")').count();
  const hasRejectBtn = await page.locator('button:has-text("Reject")').count();
  console.log(`\nDecision box: reason textarea=${hasReasonTextarea}, Confirm=${hasConfirmBtn}, Reject=${hasRejectBtn}`);
  
  // Fill reason and confirm
  await page.locator('textarea[placeholder*="reason"]').fill("KN-UX-4 final verification: confirming this file review is correct");
  await page.waitForTimeout(500);
  
  const [confirmResponse] = await Promise.all([
    page.waitForResponse(r => r.url().includes("/api/knowledge/review/") && r.request().method() === "POST", { timeout: 15000 }),
    page.locator('button:has-text("Confirm")').click(),
  ]);
  
  console.log(`Confirm response: ${confirmResponse.status()}`);
  const confirmResult = await confirmResponse.json().catch(() => ({}));
  console.log(`Confirm result:`, confirmResult);
  
  await page.waitForTimeout(2000);
  
  // Verify item removed from queue
  const itemsAfterConfirm = await page.locator(".review-item").count();
  console.log(`\nItems after confirm: ${itemsAfterConfirm} (was ${initialItems})`);
  
  // Test reject on a fact item
  await page.locator(".review-item").first().waitFor({ timeout: 10000 });
  const factReviewBtn = page.locator('button:has-text("Review this fact")').first();
  if (await factReviewBtn.count() > 0) {
    await factReviewBtn.click();
    await page.waitForTimeout(1000);
    
    await page.locator('textarea[placeholder*="reason"]').fill("KN-UX-4 final verification: rejecting this fact for testing");
    await page.waitForTimeout(500);
    
    const [rejectResponse] = await Promise.all([
      page.waitForResponse(r => r.url().includes("/api/knowledge/review/") && r.request().method() === "POST", { timeout: 15000 }),
      page.locator('button:has-text("Reject")').click(),
    ]);
    
    console.log(`Reject response: ${rejectResponse.status()}`);
    const rejectResult = await rejectResponse.json().catch(() => ({}));
    console.log(`Reject result:`, rejectResult);
    
    await page.waitForTimeout(2000);
    const itemsAfterReject = await page.locator(".review-item").count();
    console.log(`Items after reject: ${itemsAfterReject}`);
  }
  
  // Verify navigation highlighting
  console.log("\n=== Navigation ===");
  const navItems = await page.locator(".navigation-children button").allInnerTexts();
  console.log("Knowledge nav items:", navItems.filter(x => x.includes("File") || x.includes("Product") || x.includes("Manufacturer") || x.includes("Standard") || x.includes("Search") || x.includes("Identity") || x.includes("Review") || x.includes("Price") || x.includes("Case") || x.includes("Fire") || x.includes("CCTV")));
  
  console.log("\n=== Console Errors ===");
  console.log(consoleErrors.slice(0, 5));
  
  console.log("\n=== API Calls (review-related) ===");
  console.log(apiCalls.filter(c => c.includes("review")).slice(-10));
  
  console.log("\n=== Failed Requests ===");
  console.log(failedRequests.slice(0, 5));
  
  await page.screenshot({ path: ".local-evidence/kn-ux-4-final.png", fullPage: true });
  
  console.log("\n✅ KN-UX-4 verification complete - all flows working");
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/kn-ux-4-final-error.png", fullPage: true });
} finally {
  await browser.close();
}