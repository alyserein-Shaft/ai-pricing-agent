import { chromium } from "playwright";

const BASE = "http://localhost:4183";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

async function getReviewQueue() {
  const resp = await page.request.get(`${BASE}/api/knowledge/review-queue`);
  return resp.json();
}

try {
  console.log("=== 1C. ENGINEER REVIEW QUEUE ===");
  
  const apiData = await getReviewQueue();
  const apiItems = apiData.items || [];
  const apiFiles = apiItems.filter(i => i.item_kind === "File");
  const apiFacts = apiItems.filter(i => i.item_kind === "Fact");
  
  console.log(`API Review Queue: ${apiItems.length} items (Files: ${apiFiles.length}, Facts: ${apiFacts.length})`);
  
  await page.goto(`${BASE}/?workspace=Knowledge&section=Review`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator(".review-item").first().waitFor({ timeout: 30000 });
  
  const uiItems = await page.locator(".review-item").count();
  console.log(`UI Review Queue: ${uiItems} items rendered`);
  
  // Check navigation highlights Review
  const bodyText = await page.locator("body").innerText();
  const navHighlighted = bodyText.includes("Review");
  console.log(`Navigation highlights Review: ${navHighlighted ? "✓" : "✗"}`);
  
  // Check item details
  for (const apiItem of apiItems.slice(0, 5)) {
    const article = page.locator(".review-item").filter({ hasText: apiItem.title });
    const count = await article.count();
    if (count > 0) {
      const articleText = await article.first().innerText();
      const hasKind = /FILE|FACT/.test(articleText);
      const hasTitle = articleText.includes(apiItem.title);
      const hasType = articleText.includes(apiItem.item_type);
      const hasReviewStatus = articleText.includes(apiItem.review_status);
      const hasConfidence = apiItem.confidence != null && articleText.includes(String(apiItem.confidence));
      const hasSourceContext = /Completed/.test(articleText); // processing_status
      
      console.log(`  ${apiItem.item_kind}: ${apiItem.title}`);
      console.log(`    kind=${hasKind}, title=${hasTitle}, type=${hasType}, review_status=${hasReviewStatus}, confidence=${hasConfidence}, source=${hasSourceContext}`);
    } else {
      console.log(`  ${apiItem.item_kind}: ${apiItem.title} - NOT FOUND IN UI`);
    }
  }
  
  // Check file and fact counts in UI
  const uiFiles = await page.locator('.review-item:has-text("FILE")').count();
  const uiFacts = await page.locator('.review-item:has-text("FACT")').count();
  console.log(`\nUI Files: ${uiFiles} (API: ${apiFiles.length})`);
  console.log(`UI Facts: ${uiFacts} (API: ${apiFacts.length})`);
  
  await page.screenshot({ path: ".local-evidence/1c-review-queue.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/1c-error.png", fullPage: true });
} finally {
  await browser.close();
}