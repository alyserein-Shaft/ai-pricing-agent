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

async function getApiFacts() {
  const resp = await page.request.get(`${BASE}/api/knowledge/files`);
  return resp.json();
}

try {
  console.log("=== 1A. SOURCE REGISTER ===");
  await page.goto(`${BASE}/?workspace=Knowledge&section=Files`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.locator(".library-results article").first().waitFor({ timeout: 30000 });
  
  const apiData = await getApiFacts();
  const apiFiles = apiData.files || [];
  
  const bodyText = await page.locator("body").innerText();
  const fileRows = await page.locator(".library-results article").count();
  
  console.log(`File rows rendered: ${fileRows} (API: ${apiFiles.length})`);
  console.log("Sample rows (UI vs API):");
  
  for (const apiFile of apiFiles.slice(0, 10)) {
    const fname = apiFile.file_name;
    const inUI = bodyText.includes(fname);
    console.log(`  ${fname}`);
    console.log(`    API: processing=${apiFile.processing_status}, classification=${apiFile.classification_status}, detected_type=${apiFile.detected_type}`);
    console.log(`    UI:  ${inUI ? "VISIBLE" : "MISSING"}`);
    if (inUI) {
      // Extract the row text around this file
      const idx = bodyText.indexOf(fname);
      const snippet = bodyText.slice(Math.max(0, idx-100), idx+200);
      const processingMatch = snippet.match(/Processing: (\w+)/);
      const reviewMatch = snippet.match(/Review: ([^\n]+)/);
      const permittedMatch = snippet.match(/Permitted use: ([^\n]+)/);
      console.log(`    UI extracted: processing=${processingMatch?.[1]||"?"}, review=${reviewMatch?.[1]||"?"}, permitted=${permittedMatch?.[1]||"?"}`);
    }
  }
  
  // Check no fabricated fallback
  const hasFabricatedFallback = /Review: Needs Review/.test(bodyText) && !/Review: (Governed Supplier Intake|Reviewed|Classified|Rejected)/.test(bodyText);
  console.log(`\nFabricated "Review: Needs Review" fallback: ${hasFabricatedFallback ? "YES (BLOCKER)" : "NO (OK)"}`);
  
  // Check permitted use values
  console.log("\nPermitted use values in UI:");
  const permittedMatches = [...bodyText.matchAll(/Permitted use: ([^\n]+)/g)];
  const uniquePermitted = [...new Set(permittedMatches.map(m => m[1].trim()))];
  console.log(uniquePermitted);
  
  console.log("\nConsole errors:", consoleErrors.slice(0, 3));
  console.log("Failed requests:", failedRequests.slice(0, 3));
  
  await page.screenshot({ path: ".local-evidence/1a-source-register.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/1a-error.png", fullPage: true });
} finally {
  await browser.close();
}