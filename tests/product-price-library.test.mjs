import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { eligiblePrices, hasHoneywellFarenhytWorkbookStructure, ingestGeneralXlsxPriceList, ingestHoneywellFarenhytWorkbook, productFamily, searchProductLibrary } from "../app/domain/product-price-library.mjs";

const workbookPath = "/Users/serein-b/Downloads/KSA Honeywell Farenhyt Series Price List -2023.xlsx";
test("ingests the supplied Honeywell workbook with real source provenance", async () => { const result = ingestHoneywellFarenhytWorkbook(new Uint8Array(await readFile(workbookPath)), { fileName: workbookPath, documentId: "doc-price" }); assert.equal(result.summary.productsDetected, 504); assert.equal(result.summary.pricesDetected, 504); assert.equal(result.priceSource.currency, "USD"); assert.equal(result.priceSource.releaseVersion, "V23.1"); assert.match(result.priceSource.effectiveFrom, /March 2023/i); assert.equal(result.products[0].source.sheet, "2023 Farenhyt"); assert.ok(result.products[0].source.row > 0); });
test("excludes scratch formulas and retains lifecycle evidence separately", async () => { const result = ingestHoneywellFarenhytWorkbook(new Uint8Array(await readFile(workbookPath))); assert.ok(result.excludedSheets.some((sheet) => sheet.name === "Sheet1")); assert.equal(result.summary.lifecycleRecords, 82); assert.ok(result.lifecycle.some((record) => record.lifecycleStatus === "Discontinued — No Replacement")); });
test("keeps historical prices discovery-only and ineligible for costing", async () => { const result = ingestHoneywellFarenhytWorkbook(new Uint8Array(await readFile(workbookPath))); assert.equal(result.summary.validCurrentPrices, 0); assert.equal(eligiblePrices(result.prices).length, 0); assert.ok(result.prices.every((price) => price.downstreamUse === "Discovery Only")); });
test("supports exact and partial structured product search without BOQ ranking", async () => { const result = ingestHoneywellFarenhytWorkbook(new Uint8Array(await readFile(workbookPath))); const exact = searchProductLibrary(result.products, "IFP-2100HV"); const partial = searchProductLibrary(result.products, "smoke detector", { manufacturer: "Honeywell" }); assert.ok(exact.some((product) => product.partNumber === "IFP-2100HV")); assert.ok(partial.length > 0); assert.ok(partial.every((product) => product.manufacturer === "Honeywell")); });

// Sprint 0.3 Phase 1: productFamily() must never write a free-text pseudo-family
// or invent "Fire Alarm"/"Unknown" as a category. It must use the same canonical
// System -> Category -> Family vocabulary as requirement understanding
// (classifyFireAlarmFamilyFromText, shared with scripts/classify-fire-alarm-product-families.mjs),
// or leave engineeringDomain null rather than guess.
test("a free-text price-list heading with no canonical taxonomy match keeps the raw heading but never invents a category", () => {
  const result = productFamily("Detectors");
  assert.equal(result.name, "Detectors", "raw heading text must be preserved as evidence");
  assert.equal(result.engineeringDomain, null);
});
test("a heading is never classified as the literal pseudo-categories the old regex produced", () => {
  for (const heading of ["Fire Alarm Accessories", "Farenhyt Panels", "Detector Bases and Mounting", "Miscellaneous"]) {
    const result = productFamily(heading);
    assert.notEqual(result.engineeringDomain, "Unknown", heading);
    assert.notEqual(result.engineeringDomain, "Fire Alarm", `"Fire Alarm" is a system name, never a category (${heading})`);
  }
});
test("a heading that literally contains a canonical family phrase is classified using the shared taxonomy vocabulary", () => {
  const result = productFamily("Manual Call Point Devices");
  assert.equal(result.name, "Manual Call Point");
  assert.equal(result.engineeringDomain, "Manual Initiation");
});
test("the default 'Unclassified' starting family never becomes a canonical taxonomy category", () => {
  const result = productFamily("Unclassified Farenhyt Products");
  assert.equal(result.engineeringDomain, null);
  assert.equal(result.name, "Unclassified Farenhyt Products");
});
// Sprint 1.16 -- the real Honeywell Farenhyt workbook has no divider rows that
// themselves resolve to a governed family (its section headings span several
// real device families at once, e.g. "IDP Addressable Detectors/Devices...").
// Previously that meant every product beneath such a heading was stamped with
// the heading's own ungoverned raw text forever, with `families` staying
// empty -- a real coverage gap, not a mis-classification, per the prior test
// name here. Closed by reclassifying each product from its OWN description
// through the same shared classifier when its heading doesn't resolve, so
// `families` is no longer empty and only ever contains real governed
// System -> Category -> Family entries, never an invented pseudo-category.
test("the real Honeywell Farenhyt workbook's per-heading coverage gap is closed by per-product reclassification, never a second taxonomy", async () => {
  const result = ingestHoneywellFarenhytWorkbook(new Uint8Array(await readFile(workbookPath)));
  assert.ok(result.families.length > 0, "per-product fallback must recover real families from this workbook's ungoverned headings");
  assert.ok(result.families.every((family) => family.engineeringDomain), "every recovered family must be a real governed category, never null/invented");
  assert.ok(result.families.some((family) => family.name === "Addressable Heat Detector"));
  assert.ok(result.families.some((family) => family.name === "Carbon Monoxide Detector"));
  const heatDetectors = result.products.filter((product) => product.partNumber.startsWith("IDP-HEAT-"));
  assert.ok(heatDetectors.length > 0);
  assert.ok(heatDetectors.every((product) => product.family === "Addressable Heat Detector"));
  const coDetectors = result.products.filter((product) => ["CO1224T", "CO1224TR"].includes(product.partNumber));
  assert.equal(coDetectors.length, 2);
  assert.ok(coDetectors.every((product) => product.family === "Carbon Monoxide Detector"));
});

const generalWorkbookPath = "/Users/serein-b/Downloads/projects/Bab Al khair - Makkah/Data/Data-RFQ/Data System OH ( newwww).xlsx";
test("general XLSX importer extracts multiple sheets and manufacturers with source provenance", async () => { const bytes = new Uint8Array(await readFile(generalWorkbookPath)); assert.equal(hasHoneywellFarenhytWorkbookStructure(bytes), false); const result = ingestGeneralXlsxPriceList(bytes, { fileName: generalWorkbookPath, sha256: "real-workbook-sha" }); assert.equal(result.importer, "General XLSX Price List"); assert.ok(result.summary.sheetsExtracted > 1); assert.ok(result.summary.manufacturersDetected > 1); assert.equal(result.summary.productObservationsProcessed, 591); assert.equal(result.summary.uniqueProductIdentities, 434); assert.equal(result.summary.repeatedObservationsConsolidated, 157); assert.equal(result.summary.priceObservationsDetected, 590); assert.ok(result.manufacturers.includes("Corning")); assert.ok(result.manufacturers.includes("Huawei")); assert.ok(result.products.length > 0); const product = result.products.find(entry => entry.partNumber === "SRT2200XLI"); assert.equal(product.manufacturer, "UPS - APC"); assert.equal(product.source.sheet, "UPS"); assert.equal(product.source.row, 3); assert.equal(product.source.cells.partNumber, "B3"); assert.equal(product.source.cells.listPrice, "F3"); assert.equal(product.source.originalValues.listPrice, 4200); assert.equal(product.quantity, 1); assert.equal(product.cd, 10); });

test("unknown currency remains unresolved and every general price fails closed", async () => { const result = ingestGeneralXlsxPriceList(new Uint8Array(await readFile(generalWorkbookPath)), { sha256: "real-workbook-sha" }); assert.equal(result.priceSource.currency, null); assert.equal(result.summary.validCurrentPrices, 0); assert.equal(result.summary.costingEligiblePrices, 0); assert.ok(result.warnings.some(warning => warning.code === "CURRENCY_NOT_EXPLICIT")); assert.ok(result.unresolvedRows.some(row => row.reasons.includes("Currency is not explicitly provided."))); assert.ok(result.prices.length > 0); assert.ok(result.prices.every(price => price.currency === null && price.approvalStatus === "Needs Review" && price.downstreamUse === "Discovery Only" && price.costingEligible === false)); assert.equal(eligiblePrices(result.prices).length, 0); });
