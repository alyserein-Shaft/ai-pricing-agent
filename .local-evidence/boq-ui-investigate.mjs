import { chromium } from "playwright";

const BASE = "http://localhost:4183";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

try {
  console.log("=== BOQ UI INVESTIGATION ===");
  
  await page.goto(`${BASE}/?project=project_ae501b85-9c12-4332-bf8e-787c90f2d388&workspace=BOQ`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  await page.locator(".library-results article, .boq-col-actions").first().waitFor({ timeout: 30000 });
  
  const bodyText = await page.locator("body").innerText();
  
  // Check quick filters
  console.log("\n=== QUICK FILTERS ===");
  const filterButtons = await page.locator("button").filter({ hasText: /Needs Review|Possible Duplicates|All|Verified/ }).allInnerTexts();
  console.log("Filter buttons:", filterButtons);
  
  // Check the Needs Review filter count
  const needsReviewText = bodyText.match(/Needs Review\s*\((\d+)\)/);
  if (needsReviewText) {
    console.log(`"Needs Review" filter count: ${needsReviewText[1]}`);
  }
  
  // Check Action Center
  const actionCenterMatch = bodyText.match(/BOQ.*extraction.*review|extraction.*review/gi);
  console.log("Action Center extraction mentions:", actionCenterMatch);
  
  // Check BOQ table
  const rowCount = await page.locator("tbody tr").count();
  console.log(`\nBOQ table rows: ${rowCount}`);
  
  // Check column headers
  const headers = await page.locator("thead th").allInnerTexts();
  console.log("Table headers:", headers);
  
  // Check for UNDERSTANDING column
  const hasUnderstandingHeader = headers.some(h => /understanding/i.test(h));
  console.log(`Has UNDERSTANDING header: ${hasUnderstandingHeader}`);
  
  // Check first few rows for UNDERSTANDING content
  const firstRow = await page.locator("tbody tr").first().innerText();
  console.log(`\nFirst row sample: ${firstRow.slice(0, 300)}`);
  
  // Check for "AI INTERPRETATION" or similar
  const hasAIInterpretation = /AI INTERPRETATION|NOT A VERIFIED|missing attributes/i.test(bodyText);
  console.log(`Has AI INTERPRETATION content: ${hasAIInterpretation}`);
  
  // Check quick filter specific counts
  const filterCounts = bodyText.match(/(All|Needs Review|Possible Duplicates|Verified)\s*\((\d+)\)/g);
  console.log("\nAll filter counts:", filterCounts);
  
  await page.screenshot({ path: ".local-evidence/boq-ui-investigate.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/boq-ui-error.png", fullPage: true });
} finally {
  await browser.close();
}