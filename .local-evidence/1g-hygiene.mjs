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
  console.log("=== 1G. RUNTIME HYGIENE ===");
  
  // Check multiple Knowledge sections
  const sections = ["Files", "Review", "Manufacturers", "Standards", "Product Identities", "Prices", "Search"];
  
  for (const section of sections) {
    await page.goto(`${BASE}/?workspace=Knowledge&section=${encodeURIComponent(section)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    
    const hasContent = await page.locator(".library-results article").count() > 0 || 
                       (await page.locator("body").innerText()).includes("No ") && 
                       (await page.locator("body").innerText()).includes("found");
    
    console.log(`  ${section}: ${hasContent ? "✓ loads" : "✗ fails"}`);
  }
  
  console.log("\nConsole errors (filtered):");
  for (const err of consoleErrors.slice(0, 5)) {
    console.log(`  ${err}`);
  }
  
  console.log("\nFailed requests (filtered):");
  for (const req of failedRequests.slice(0, 5)) {
    console.log(`  ${req}`);
  }
  
  console.log("\nAPI calls (knowledge-related):");
  const knowledgeCalls = apiCalls.filter(c => c.includes("knowledge")).slice(-20);
  for (const call of knowledgeCalls) {
    console.log(`  ${call}`);
  }
  
  // Check no stale queue behavior
  await page.goto(`${BASE}/?workspace=Knowledge&section=Review`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.locator(".review-item").first().waitFor({ timeout: 30000 });
  
  const queueSize1 = await page.locator(".review-item").count();
  await page.waitForTimeout(3000);
  const queueSize2 = await page.locator(".review-item").count();
  console.log(`\nQueue stability: ${queueSize1} -> ${queueSize2} (${queueSize1 === queueSize2 ? "stable" : "CHANGED"})`);
  
  await page.screenshot({ path: ".local-evidence/1g-hygiene.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/1g-error.png", fullPage: true });
} finally {
  await browser.close();
}