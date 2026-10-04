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
  await page.locator(".review-item").first().waitFor({ timeout: 30000 }).catch(() => console.log("No review items found"));

  // Get the page content
  const bodyText = await page.locator("body").innerText();
  
  // Check for review items
  const reviewItems = await page.locator(".review-item").count();
  console.log(`Review items found: ${reviewItems}`);
  
  // Check for processing status rendering
  const hasProcessingCompleted = /Processing: Completed/.test(bodyText);
  console.log("Has 'Processing: Completed':", hasProcessingCompleted);
  
  // Check for review status rendering
  const hasReviewStatus = /Awaiting engineer review/.test(bodyText);
  console.log("Has 'Awaiting engineer review':", hasReviewStatus);
  
  // Check for Confirmed/Reject buttons
  const hasConfirmButton = await page.locator('button:has-text("Confirm")').count();
  const hasRejectButton = await page.locator('button:has-text("Reject")').count();
  console.log("Confirm buttons:", hasConfirmButton);
  console.log("Reject buttons:", hasRejectButton);
  
  // Check for reason textarea
  const hasReasonTextarea = await page.locator('textarea[placeholder*="reason"]').count();
  console.log("Reason textareas:", hasReasonTextarea);
  
  // Check for "Review this file/fact" buttons
  const hasReviewButtons = await page.locator('button:has-text("Review this")').count();
  console.log("Review buttons:", hasReviewButtons);
  
  // Check the section title
  const sectionTitle = await page.locator("h1").first().innerText().catch(() => "N/A");
  console.log("Section title:", sectionTitle);
  
  // Check the subtitle
  const subtitle = await page.locator("p").first().innerText().catch(() => "N/A");
  console.log("Subtitle:", subtitle);
  
  console.log("\n=== Console Errors ===");
  console.log(consoleErrors.slice(0, 5));
  
  console.log("\n=== Failed Requests ===");
  console.log(failedRequests.slice(0, 5));
  
  await page.screenshot({ path: ".local-evidence/kn-ux-4-review-section.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/kn-ux-4-error.png", fullPage: true });
} finally {
  await browser.close();
}