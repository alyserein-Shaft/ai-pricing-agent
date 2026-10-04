import { chromium } from "playwright";
const BASE = "http://localhost:4183";
const PROJECT = "project_ae501b85-9c12-4332-bf8e-787c90f2d388";
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1680, height: 1050 } });
await page.goto(`${BASE}/?project=${PROJECT}&workspace=BOQ`, { waitUntil: "domcontentloaded" });
await page.locator("tbody tr").first().waitFor({ timeout: 60000 });
await page.waitForTimeout(2500);
const attempts = {
  roleRegex: await page.getByRole("button", { name: /Possible Duplicates/ }).count(),
  roleString: await page.getByRole("button", { name: "Possible Duplicates (9)" }).count(),
  roleSubstring: await page.getByRole("button", { name: "Possible Duplicates", exact: false }).count(),
  buttonTextFilter: await page.locator("button").filter({ hasText: "Possible Duplicates" }).count(),
  getByText: await page.getByText("Possible Duplicates (9)", { exact: true }).count(),
  needsReviewRole: await page.getByRole("button", { name: "Needs Review (9)" }).count(),
  allRole: await page.getByRole("button").filter({ hasText: "Needs Review" }).count(),
};
console.log(JSON.stringify(attempts, null, 1));
// inspect the actual button element
const button = page.locator("button").filter({ hasText: "Possible Duplicates" }).first();
console.log("outerHTML:", (await button.evaluate((el) => el.outerHTML)).slice(0, 400));
console.log("accessible name:", await button.evaluate((el) => el.getAttribute("aria-label") || "(none)"));
await browser.close();
