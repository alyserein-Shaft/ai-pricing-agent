import { chromium } from "playwright";

const BASE = "http://localhost:4183";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });

try {
  console.log("=== 1B. LEARNED KNOWLEDGE REACHABILITY ===");
  
  const sections = [
    { section: "Products", label: "Products" },
    { section: "Manufacturers", label: "Manufacturers" },
    { section: "Standards", label: "Standards" },
    { section: "Search", label: "Search" },
    { section: "Product Identities", label: "Product Identities" },
    { section: "Prices", label: "Prices" },
    { section: "Case Studies", label: "Case Studies" },
    { section: "Fire Alarm", label: "Fire Alarm" },
    { section: "CCTV", label: "CCTV" },
  ];
  
  for (const { section, label } of sections) {
    await page.goto(`${BASE}/?workspace=Knowledge&section=${encodeURIComponent(section)}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    
    const hasResults = await page.locator(".library-results article").count();
    const bodyText = await page.locator("body").innerText();
    const hasHeading = bodyText.includes(label) || bodyText.includes(section);
    const emptyState = bodyText.includes("No ") && bodyText.includes("found");
    
    console.log(`  ${label} (section=${section}): results=${hasResults}, heading=${hasHeading}, empty=${emptyState}`);
    
    if (hasResults > 0) {
      const firstItem = await page.locator(".library-results article").first().innerText();
      console.log(`    First item: ${firstItem.slice(0, 100).replace(/\n/g, " | ")}`);
    }
  }
  
  // Verify no automatic promotion claims
  await page.goto(`${BASE}/?workspace=Knowledge&section=Files`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);
  const bodyText = await page.locator("body").innerText();
  const hasAutoPromotion = /automatic promotion|auto.*promot|automatically promot/i.test(bodyText);
  const hasNoAutoPromotion = /No automatic promotion/.test(bodyText);
  console.log(`\n"Automatic promotion" claim present: ${hasAutoPromotion}`);
  console.log(`"No automatic promotion" banner present: ${hasNoAutoPromotion}`);
  
  await page.screenshot({ path: ".local-evidence/1b-learned.png", fullPage: true });
  
} catch (error) {
  console.error("Error:", error);
  await page.screenshot({ path: ".local-evidence/1b-error.png", fullPage: true });
} finally {
  await browser.close();
}