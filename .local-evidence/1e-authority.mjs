import { chromium } from "playwright";

const BASE = "http://localhost:4183";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

try {
  console.log("=== 1E. AUTHORITY SEPARATION ===");
  
  // Check Files register wording
  await page.goto(`${BASE}/?workspace=Knowledge&section=Files`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator(".library-results article").first().waitFor({ timeout: 30000 });
  
  const filesBodyText = await page.locator("body").innerText();
  console.log("Files register wording:");
  console.log(`  "Processing: Completed" (source processing): ${/Processing: Completed/.test(filesBodyText)}`);
  console.log(`  "Review: ..." (classification status): ${/Review: (Governed Supplier Intake|Reviewed|Classified|Rejected)/.test(filesBodyText)}`);
  console.log(`  "Permitted use: Discovery Only" (downstream): ${/Permitted use: Discovery Only/.test(filesBodyText)}`);
  console.log(`  NO "Approved" or "Product Approved": ${!/Product Approved|Approved for costing/.test(filesBodyText)}`);
  
  // Check Review section wording
  await page.goto(`${BASE}/?workspace=Knowledge&section=Review`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator(".review-item").first().waitFor({ timeout: 30000 });
  
  const reviewBodyText = await page.locator("body").innerText();
  console.log("\nReview section wording:");
  console.log(`  "Awaiting engineer review": ${/Awaiting engineer review/.test(reviewBodyText)}`);
  console.log(`  "Confirm" / "Reject" (not "Approve"): ${/Confirm/.test(reviewBodyText) && /Reject/.test(reviewBodyText) && !/Approve/.test(reviewBodyText)}`);
  console.log(`  "Awaiting engineer review · Needs Review": ${/Awaiting engineer review · Needs Review/.test(reviewBodyText)}`);
  
  // Check Product Identities wording
  await page.goto(`${BASE}/?workspace=Knowledge&section=Product%20Identities`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator(".library-results article").first().waitFor({ timeout: 30000 });
  
  const piBodyText = await page.locator("body").innerText();
  console.log("\nProduct Identities wording:");
  console.log(`  Has "Review:" status: ${/Review: (Needs Review|Reviewed|Obsolete)/.test(piBodyText)}`);
  console.log(`  Has "Lifecycle": ${/Lifecycle|Obsolete|Discovery Only/.test(piBodyText)}`);
  console.log(`  NO "Approved for costing" or "Product Approved": ${!/Approved for costing|Product Approved/.test(piBodyText)}`);
  
  // Check Prices section
  await page.goto(`${BASE}/?workspace=Knowledge&section=Prices`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator(".library-results article").first().waitFor({ timeout: 30000 });
  
  const pricesBodyText = await page.locator("body").innerText();
  console.log("\nPrices section wording:");
  console.log(`  Shows "Processing: Completed": ${/Processing: Completed/.test(pricesBodyText)}`);
  console.log(`  Shows "Review: Classified/Reviewed": ${/Review: (Classified|Reviewed)/.test(pricesBodyText)}`);
  console.log(`  NO "Approved for costing": ${!/Approved for costing/.test(pricesBodyText)}`);
  
  // Check the "No automatic promotion" banner
  await page.goto(`${BASE}/?workspace=Knowledge&section=Files`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const bannerText = await page.locator(".library-safety-banner").innerText();
  console.log(`\nSafety banner: "${bannerText.trim()}"`);
  
  await page.screenshot({ path: ".local-evidence/1e-authority.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/1e-error.png", fullPage: true });
} finally {
  await browser.close();
}