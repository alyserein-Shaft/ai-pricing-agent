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
  // Navigate to Knowledge Library Files section
  await page.goto(`${BASE}/?workspace=Knowledge&section=Files`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  // Wait for the table/results to load
  await page.locator(".library-results article").first().waitFor({ timeout: 30000 });

  // Get the page content
  const bodyText = await page.locator("body").innerText();
  
  // Check for processing status rendering
  const hasProcessingCompleted = /Processing: Completed/.test(bodyText);
  const hasProcessing = /Processing:/.test(bodyText);
  
  // Check for review status rendering (classification_status)
  const hasReviewStatus = /Review: (Governed Supplier Intake|Needs Review|Classified)/.test(bodyText);
  
  // Check that there's no fabricated "Needs Review" for review status when it shouldn't be there
  // The test is: all Review: lines should have actual classification_status values
  const reviewLines = bodyText.match(/Review: [^\n]+/g) || [];
  
  console.log("=== KN-UX-3 Verification ===");
  console.log("Has 'Processing:' label:", hasProcessing);
  console.log("Has 'Processing: Completed':", hasProcessingCompleted);
  console.log("Has Review status with actual values:", hasReviewStatus);
  console.log("Review lines found:", reviewLines.length);
  console.log("Review lines:", reviewLines.slice(0, 10));
  
  // Verify specific files from the API response
  const expectedStatuses = [
    "Governed Supplier Intake",
    "Needs Review", 
    "Classified"
  ];
  
  let allExpectedFound = true;
  for (const status of expectedStatuses) {
    if (bodyText.includes(`Review: ${status}`)) {
      console.log(`✓ Found Review: ${status}`);
    } else {
      console.log(`✗ Missing Review: ${status}`);
      allExpectedFound = false;
    }
  }
  
  // Check no fabricated "Review: Needs Review" for items that have different classification_status
  // The fabricated fallback would show "Review: Needs Review" for ALL items
  // But we should see different values
  const uniqueReviewStatuses = [...new Set(reviewLines.map(l => l.replace("Review: ", "").trim()))];
  console.log("Unique review statuses rendered:", uniqueReviewStatuses);
  
  if (uniqueReviewStatuses.length > 1) {
    console.log("✓ Multiple review statuses rendered (no single fallback)");
  } else {
    console.log("⚠ Only one review status rendered - may indicate fallback");
  }
  
  // Check for "Permitted use" which is in the Files template
  const hasPermittedUse = /Permitted use:/.test(bodyText);
  console.log("Has 'Permitted use:' label:", hasPermittedUse);
  
  console.log("\n=== Console Errors ===");
  console.log(consoleErrors.slice(0, 5));
  
  console.log("\n=== Failed Requests ===");
  console.log(failedRequests.slice(0, 5));
  
  await page.screenshot({ path: ".local-evidence/kn-ux-3-verification.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/kn-ux-3-error.png", fullPage: true });
} finally {
  await browser.close();
}