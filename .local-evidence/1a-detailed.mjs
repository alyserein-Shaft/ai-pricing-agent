import { chromium } from "playwright";

const BASE = "http://localhost:4183";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

async function getApiFacts() {
  const resp = await page.request.get(`${BASE}/api/knowledge/files`);
  return resp.json();
}

try {
  console.log("=== 1A. SOURCE REGISTER - DETAILED ROW CHECK ===");
  await page.goto(`${BASE}/?workspace=Knowledge&section=Files`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator(".library-results article").first().waitFor({ timeout: 30000 });
  
  const apiData = await getApiFacts();
  const apiFiles = apiData.files || [];
  
  // Check specific rows by locating the article and extracting its text
  for (const apiFile of apiFiles.slice(0, 10)) {
    const fname = apiFile.file_name;
    // Find the article containing this filename
    const article = page.locator(".library-results article").filter({ hasText: fname });
    const count = await article.count();
    if (count > 0) {
      const articleText = await article.first().innerText();
      // Extract processing and review from this specific article
      const processingMatch = articleText.match(/Processing: (\w+)/);
      const reviewMatch = articleText.match(/Review: ([^\n]+)/);
      const permittedMatch = articleText.match(/Permitted use: ([^\n]+)/);
      
      console.log(`  ${fname}`);
      console.log(`    API: processing=${apiFile.processing_status}, classification=${apiFile.classification_status}`);
      console.log(`    UI:  processing=${processingMatch?.[1]||"?"}, review=${reviewMatch?.[1]||"?"}, permitted=${permittedMatch?.[1]||"?"}`);
      console.log(`    MATCH: ${processingMatch?.[1] === apiFile.processing_status && reviewMatch?.[1] === apiFile.classification_status ? "✓" : "✗ MISMATCH"}`);
    } else {
      console.log(`  ${fname}: NOT FOUND IN UI`);
    }
  }
  
  await page.screenshot({ path: ".local-evidence/1a-detailed.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/1a-detailed-error.png", fullPage: true });
} finally {
  await browser.close();
}