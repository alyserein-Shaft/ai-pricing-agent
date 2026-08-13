import { parseXlsxWorkbook } from "../document-parsers/xlsx.mjs";
import { extractAttributes, extractStandards } from "./specification-extractor.mjs";
import { FIRE_ALARM_ATTRIBUTE_PROFILES, FIRE_ALARM_TAXONOMY } from "./fire-alarm-taxonomy.mjs";
export { FIRE_ALARM_ATTRIBUTE_PROFILES, FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION } from "./fire-alarm-taxonomy.mjs";

export const PRODUCT_LIBRARY_VERSION = "product-price-library-1.0.0";
export const PRICE_INGESTION_RULESET = "price-source-rules-2026-08-02";
export const FIRE_ALARM_LIBRARY_VERSION = "fire-alarm-pilot-2.0.0";
export const PRODUCT_SOURCE_STAGES = ["Queued", "Loading Source", "Detecting Manufacturer", "Detecting Families", "Extracting Products", "Extracting Attributes", "Extracting Standards", "Extracting Compatibility", "Extracting Accessories", "Resolving Identity", "Validating", "Saving", "Needs Review", "Completed", "Failed", "Cancelled"];
export const PRICE_SOURCE_STAGES = ["Queued", "Loading Source", "Detecting Supplier", "Detecting Currency", "Detecting Price Tables", "Mapping Products", "Extracting Prices", "Extracting Discounts", "Extracting Validity", "Validating", "Saving", "Needs Review", "Completed", "Failed", "Cancelled"];
export const PRICE_STATES = ["Current Approved", "Project-Specific Approved", "Supplier Quote Approved", "Historical Reference", "Expired", "Future", "No Validity Provided", "Unverified", "Superseded", "Rejected", "Discovery Only"];
export const IDENTITY_RELATIONSHIPS = ["Exact same product", "Same product from another source", "Product variant", "Regional variant", "Revision", "Replacement", "Commercial package", "Possible duplicate", "Different product"];
export const ACCESSORY_RELATIONSHIPS = ["Required accessory", "Included accessory", "Optional accessory", "Installation accessory", "Replacement accessory", "Licensing dependency", "Mounting dependency", "Power dependency", "Network dependency", "Product package component"];
export const ACCESSORY_QUANTITY_RULES = ["One per item", "One per N devices", "One per loop", "One per panel", "One per zone", "One per system", "Optional", "Included", "Manual review required"];

export const normalizePartNumber = (value) => text(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
export const certificationDecision = (record = {}) => ({ ...record, status: record.evidenceDocumentId && (record.evidencePage || record.evidenceRow) ? (record.reviewDecision === "Approved" ? "Verified" : "Needs Review") : "Unverified", confidence: record.evidenceDocumentId ? Number(record.confidence || 0) : 0 });
export const compatibilityDecision = (record = {}) => ({ ...record, status: record.evidenceDocumentId && record.relationshipType ? (record.reviewDecision === "Approved" ? "Verified" : "Needs Review") : "Unverified", confidence: record.evidenceDocumentId ? Number(record.confidence || 0) : 0 });
export const resolveProductIdentity = (existing, candidate) => {
  if (!existing) return { relationship: "Different product", action: "Create Product", reviewRequired: false };
  if (existing.manufacturerId !== candidate.manufacturerId) return { relationship: "Different product", action: "Create Product", reviewRequired: false };
  const samePart = normalizePartNumber(existing.partNumber) === normalizePartNumber(candidate.partNumber);
  const variantKeys = ["voltage", "region", "certification", "firmware", "package", "color", "mounting"];
  const differingVariants = variantKeys.filter((key) => text(existing[key]) !== text(candidate[key]) && (existing[key] != null || candidate[key] != null));
  if (samePart && !differingVariants.length) return { relationship: "Same product from another source", action: "Enrich Existing", reviewRequired: true };
  if (samePart || candidate.baseProductId === existing.id) return { relationship: candidate.region && candidate.region !== existing.region ? "Regional variant" : "Product variant", action: "Create Variant", reviewRequired: true, differingVariants };
  return { relationship: "Possible duplicate", action: "Review", reviewRequired: true };
};

export const accessoryRelationship = (input = {}) => {
  if (!ACCESSORY_RELATIONSHIPS.includes(input.relationship)) throw new Error("Unsupported accessory relationship");
  if (!ACCESSORY_QUANTITY_RULES.includes(input.quantityRule)) throw new Error("Unsupported accessory quantity rule");
  return { ...input, included: input.relationship === "Included accessory" && Boolean(input.inclusionEvidence), separatelyPriced: !(input.relationship === "Included accessory" && input.inclusionEvidence), reviewStatus: input.sourceId && input.evidenceLocation ? "Needs Review" : "Unverified", modifiesBoq: false };
};

export const applyGovernedDiscount = ({ price, rule, at = new Date(), product, source }) => {
  const valid = rule?.approvalState === "Approved" && rule.manufacturer === product?.manufacturer && rule.sourceId === source?.id && rule.sourceVersionId === source?.versionId && rule.componentScope === "Material Only" && product?.componentType === "Material" && (!rule.effectiveFrom || new Date(rule.effectiveFrom) <= at) && (!rule.effectiveTo || new Date(rule.effectiveTo) >= at) && price?.priceState !== "Historical Reference";
  if (!valid) return { applied: false, originalAmount: price?.amount ?? null, netAmount: price?.amount ?? null, reason: "Rule scope, approval, validity, source, manufacturer, material, or price-state gate failed" };
  const percentage = Number(rule.discountPercentage);
  return { applied: true, originalAmount: price.amount, discountPercentage: percentage, netAmount: Math.round((price.amount * (1 - percentage / 100) + Number.EPSILON) * 100) / 100, calculationMethod: rule.calculationMethod, ruleVersion: rule.version };
};

export const isPriceEligibleForCosting = (price, { at = new Date(), projectId = null, region = null, quantity = 1 } = {}) => Boolean(price?.productMappingApproved && price?.sourceApproved && price?.downstreamUse?.includes("Costing") && price.currency && price.validFrom && price.validUntil && new Date(price.validFrom) <= at && new Date(price.validUntil) >= at && (!price.projectId || price.projectId === projectId) && (!price.region || price.region === region) && (!price.minimumQuantity || quantity >= price.minimumQuantity) && (!price.maximumQuantity || quantity <= price.maximumQuantity) && !price.blockingConflict && ["Current Approved", "Project-Specific Approved", "Supplier Quote Approved"].includes(price.priceState));

export const createProcessingJob = ({ kind, inputFingerprint, idempotencyKey, parserVersion = PRODUCT_LIBRARY_VERSION, modelVersion = "not-used", promptVersion = "not-used", ruleVersion = PRICE_INGESTION_RULESET }) => ({ kind, status: "Queued", stage: "Queued", progress: 0, inputFingerprint, idempotencyKey, parserVersion, modelVersion, promptVersion, ruleVersion, attempt: 0, maxAttempts: 3, timeoutMs: 300000, cancelRequested: false, logs: [] });
export const advanceProcessingJob = (job, stage, message) => { const stages = job.kind === "Price Source" ? PRICE_SOURCE_STAGES : PRODUCT_SOURCE_STAGES; if (!stages.includes(stage)) throw new Error("Unsupported processing stage"); const terminal = ["Needs Review", "Completed", "Failed", "Cancelled"].includes(stage); return { ...job, stage, status: terminal ? stage : "Processing", progress: Math.max(job.progress, Math.round(stages.indexOf(stage) / (stages.length - 1) * 100)), logs: [...job.logs, { stage, message }], completed: terminal }; };
const text = (value) => String(value ?? "").trim();
const cell = (row, column) => row.cells.find((entry) => entry.column === column)?.value ?? (column === 1 ? row.cells.find((entry) => entry.column === 2)?.value : null) ?? null;
const source = (sheet, row, cells) => ({ sheet, row, cells, extractionMethod: "native-xlsx-structure", parserVersion: PRODUCT_LIBRARY_VERSION });
const productFamily = (heading) => ({ name: text(heading), normalizedName: text(heading).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), engineeringDomain: /fire|farenhyt|detector|alarm|panel/i.test(heading) ? "Fire Alarm" : "Unknown", reviewStatus: "Needs Review" });
const lifecycleState = (replacement) => /no replacement/i.test(replacement) ? "Discontinued — No Replacement" : text(replacement) ? "Discontinued — Replacement Candidate" : "Discontinued — Replacement Missing";

export const ingestHoneywellFarenhytWorkbook = (bytes, metadata = {}) => {
  const workbook = parseXlsxWorkbook(bytes); const catalogue = workbook.sheets.find((sheet) => sheet.name === "2023 Farenhyt"); const release = workbook.sheets.find((sheet) => sheet.name === "Release Notes"); const archive = workbook.sheets.find((sheet) => sheet.name === "Obsolete & Replacement archive");
  if (!catalogue || !release) throw Object.assign(new Error("The expected Farenhyt catalogue and release-note sheets are missing."), { code: "PRICE_LIST_STRUCTURE_UNRECOGNIZED" });
  const releaseText = release.rows.flatMap((row) => row.cells.map((entry) => text(entry.value))).join(" "); const effective = releaseText.match(/effective from\s+(\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})/i)?.[1] || null; const version = releaseText.match(/V\d{2}\.\d+/i)?.[0] || null; let family = productFamily("Unclassified Farenhyt Products"); const families = []; const products = []; const prices = [];
  for (const row of catalogue.rows.slice(2)) { const partNumber = text(cell(row, 1)); const description = text(cell(row, 3) || cell(row, 4)); const countryOfOrigin = text(cell(row, 5)); const price = Number(cell(row, 6)); const comments = text(cell(row, 7)); if (partNumber && !description && !Number.isFinite(price)) { family = productFamily(partNumber); families.push({ ...family, source: source(catalogue.name, row.sourceRow, [row.cells[0]?.reference].filter(Boolean)) }); continue; } if (!partNumber || !description || !Number.isFinite(price) || price <= 0) continue; const productId = `product:honeywell:${partNumber.toLowerCase()}`; products.push({ id: productId, manufacturer: "Honeywell", brand: "Farenhyt", family: family.name, partNumber, normalizedPartNumber: partNumber.toUpperCase().replace(/\s+/g, ""), description, countryOfOrigin: countryOfOrigin || null, comments: comments || null, attributes: extractAttributes(description), standards: extractStandards(description), lifecycleStatus: "Unknown — Review Required", sourceAuthority: "Manufacturer Price List", reliability: "Historical Reference", reviewStatus: "Needs Review", source: source(catalogue.name, row.sourceRow, row.cells.map((entry) => entry.reference)) }); prices.push({ id: `price:${productId}:${row.sourceRow}`, productId, amount: price, currency: "USD", priceType: "Manufacturer List Price", scopeType: "Global Reference", effectiveFrom: effective, validUntil: null, validityState: "Historical — Validity End Missing", approvalStatus: "Needs Review", downstreamUse: "Discovery Only", source: source(catalogue.name, row.sourceRow, [row.cells.find((entry) => entry.column === 6)?.reference].filter(Boolean)) }); }
  const lifecycle = (archive?.rows || []).slice(1).map((row) => { const obsoletePart = text(cell(row, 1)); const description = text(cell(row, 2)); const replacement = text(cell(row, 3)); if (!obsoletePart) return null; return { obsoletePart, description, replacementCandidates: replacement && !/no replacement/i.test(replacement) ? replacement.split(/\s+or\s+|[,;/]/i).map(text).filter(Boolean) : [], originalReplacementText: replacement || null, lifecycleStatus: lifecycleState(replacement), reviewStatus: "Needs Review", source: source(archive.name, row.sourceRow, row.cells.map((entry) => entry.reference)) }; }).filter(Boolean);
  return { libraryVersion: PRODUCT_LIBRARY_VERSION, rulesetVersion: PRICE_INGESTION_RULESET, manufacturer: { name: "Honeywell", normalizedName: "HONEYWELL", reliability: "Historical Reference" }, brand: { name: "Farenhyt", manufacturer: "Honeywell" }, priceSource: { sourceType: "Manufacturer Price List", documentId: metadata.documentId || null, fileName: metadata.fileName || null, releaseVersion: version, effectiveFrom: effective, validUntil: null, currency: "USD", validityState: "Historical — Validity End Missing", reliability: "Historical Reference", approvalStatus: "Needs Review", downstreamUse: "Discovery Only" }, families, products, prices, lifecycle, excludedSheets: workbook.sheets.filter((sheet) => ![catalogue.name, release.name, archive?.name].includes(sheet.name)).map((sheet) => ({ name: sheet.name, reason: "Not a classified catalogue, release-note, or lifecycle sheet" })), summary: { sheetsReviewed: workbook.sheets.length, productFamilies: families.length, productsDetected: products.length, pricesDetected: prices.length, lifecycleRecords: lifecycle.length, validCurrentPrices: 0, historicalPrices: prices.length, currency: "USD", releaseVersion: version, effectiveFrom: effective } };
};

export const GENERAL_XLSX_PRICE_LIST_VERSION = "general-xlsx-price-list-1.0.0";
const generalHeaderAliases = Object.freeze({
  partNumber: ["partnumber", "partno", "itemnumber", "itemno", "model", "modelnumber", "modelno", "sku"],
  code: ["code", "productcode", "itemcode"], cd: ["cd"], description: ["description", "productdescription", "itemdescription", "details"],
  listPrice: ["listprice", "manufacturerlistprice", "msrp"], price: ["price", "unitprice"], quantity: ["qty", "quantity"],
  unit: ["unit", "uom"], discount: ["discount", "discountpercent", "discountpercentage"], manufacturer: ["manufacturer", "mfr", "maker"],
  brand: ["brand", "productbrand"], currency: ["currency", "curr", "currencycode"],
});
const generalHeader = value => text(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const generalNumber = value => { if (typeof value === "number") return Number.isFinite(value) ? value : null; const normalized = text(value).replace(/,/g, "").replace(/\s*(?:%|[A-Z]{3})\s*$/i, ""); const number = Number(normalized); return normalized && Number.isFinite(number) ? number : null; };
const generalCurrency = value => { const match = text(value).toUpperCase().match(/\b(USD|SAR|AED|EUR|GBP|QAR|KWD|BHD|OMR)\b/); return match?.[1] || null; };
const rowText = row => row.cells.map(entry => text(entry.value)).filter(Boolean).join(" ");
const mappedHeaders = row => { const columns = {}; for (const entry of row.cells) { const normalized = generalHeader(entry.value); for (const [field, aliases] of Object.entries(generalHeaderAliases)) if (!columns[field] && aliases.includes(normalized)) columns[field] = entry.column; } return columns; };
const isGeneralPriceHeader = columns => Boolean(columns.description && (columns.listPrice || columns.price) && (columns.partNumber || columns.code));
const generalValue = (row, column) => column ? row.cells.find(entry => entry.column === column)?.value ?? null : null;
const explicitWorkbookCurrency = workbook => { const found = new Set(); for (const sheet of workbook.sheets) for (const row of sheet.rows) for (const entry of row.cells) { const currency = generalCurrency(entry.value); if (currency) found.add(currency); } return found.size === 1 ? [...found][0] : null; };
const contextLabel = row => { const values = row?.cells.map(entry => text(entry.value)).filter(Boolean) || []; return values.length === 1 && values[0].length <= 100 && !/^\d+(?:\.\d+)?$/.test(values[0]) ? values[0] : null; };

export const hasHoneywellFarenhytWorkbookStructure = bytes => { try { const workbook = parseXlsxWorkbook(bytes); return Boolean(workbook.sheets.some(sheet => sheet.name === "2023 Farenhyt") && workbook.sheets.some(sheet => sheet.name === "Release Notes")); } catch { return false; } };

export const ingestGeneralXlsxPriceList = (bytes, metadata = {}) => {
  const workbook = parseXlsxWorkbook(bytes, { fileName: metadata.fileName, sha256: metadata.sha256 });
  const workbookCurrency = explicitWorkbookCurrency(workbook), products = [], prices = [], unresolvedRows = [], warnings = [], manufacturers = new Set(), brands = new Set(), processedSheets = new Set();
  for (const sheet of workbook.sheets) {
    const headerIndexes = sheet.rows.map((row, index) => ({ index, row, columns: mappedHeaders(row) })).filter(entry => isGeneralPriceHeader(entry.columns));
    if (!headerIndexes.length) { warnings.push({ code: "PRICE_TABLE_NOT_DETECTED", sheet: sheet.name, message: "No supported price-list header was detected." }); continue; }
    for (let tableIndex = 0; tableIndex < headerIndexes.length; tableIndex += 1) {
      const header = headerIndexes[tableIndex], endIndex = headerIndexes[tableIndex + 1]?.index ?? sheet.rows.length;
      const priorRows = sheet.rows.slice(Math.max(0, header.index - 3), header.index).reverse();
      let contextManufacturer = priorRows.map(contextLabel).find(Boolean) || null, contextBrand = null, section = null;
      if (!contextManufacturer && header.index === 0 && !/^(sheet|data|price|catalog)/i.test(sheet.name)) contextManufacturer = text(sheet.name) || null;
      for (const row of sheet.rows.slice(header.index + 1, endIndex)) {
        const nonempty = row.cells.filter(entry => text(entry.value));
        if (!nonempty.length) continue;
        if (nonempty.length <= 2 && !generalValue(row, header.columns.description) && !generalValue(row, header.columns.listPrice || header.columns.price)) { section = rowText(row); continue; }
        const explicitManufacturer = text(generalValue(row, header.columns.manufacturer)) || null, explicitBrand = text(generalValue(row, header.columns.brand)) || null;
        const manufacturer = explicitManufacturer || contextManufacturer, brand = explicitBrand || contextBrand;
        let partNumber = text(generalValue(row, header.columns.partNumber)) || null, code = text(generalValue(row, header.columns.code)) || null;
        const description = text(generalValue(row, header.columns.description)) || null, rawPrice = generalValue(row, header.columns.listPrice || header.columns.price), amount = generalNumber(rawPrice);
        if (!partNumber && code && header.columns.code !== header.columns.quantity) partNumber = code;
        const currency = generalCurrency(generalValue(row, header.columns.currency)) || generalCurrency(rawPrice) || workbookCurrency;
        const quantityRaw = generalValue(row, header.columns.quantity), discountRaw = generalValue(row, header.columns.discount), cdRaw = generalValue(row, header.columns.cd), unit = text(generalValue(row, header.columns.unit)) || null;
        const sourceCells = Object.fromEntries(Object.entries(header.columns).map(([field, column]) => [field, row.cells.find(entry => entry.column === column)?.reference || null]).filter(([, reference]) => reference));
        const originalValues = Object.fromEntries(Object.entries(header.columns).map(([field, column]) => [field, generalValue(row, column)]));
        const reasons = [];
        if (!manufacturer) reasons.push("Manufacturer is not explicitly available from a cell, section heading, or worksheet context.");
        if (!partNumber) reasons.push("Part number/model/code is missing.");
        if (!description) reasons.push("Description is missing.");
        if (!(amount > 0)) reasons.push("A positive explicit price is missing.");
        if (amount > 0 && !currency) reasons.push("Currency is not explicitly provided.");
        const provenance = { documentId: metadata.documentId || null, documentVersionId: metadata.documentVersionId || null, sha256: metadata.sha256 || null, sheet: sheet.name, row: row.sourceRow, cells: sourceCells, originalValues, extractionMethod: "native-xlsx-structure", parserVersion: GENERAL_XLSX_PRICE_LIST_VERSION };
        if (reasons.length) unresolvedRows.push({ sheet: sheet.name, row: row.sourceRow, partNumber, code, description, manufacturer, brand, amount, currency, reasons, source: provenance });
        if (!manufacturer || !partNumber || !description) continue;
        processedSheets.add(sheet.name); manufacturers.add(manufacturer); if (brand) brands.add(brand);
        const productKey = `${normalizePartNumber(manufacturer)}:${normalizePartNumber(partNumber)}`;
        const cd = generalNumber(cdRaw) ?? (text(cdRaw) || null);
        products.push({ id: `general-product:${productKey}`, manufacturer, brand, section, partNumber, normalizedPartNumber: normalizePartNumber(partNumber), code, cd, description, quantity: generalNumber(quantityRaw), unit, discount: generalNumber(discountRaw), reviewStatus: "Needs Review", approvedForDiscovery: false, source: provenance });
        if (amount > 0) prices.push({ id: `general-price:${productKey}:${sheet.name}:${row.sourceRow}`, productId: `general-product:${productKey}`, amount, currency, priceType: header.columns.listPrice ? "Manufacturer List Price Candidate" : "Price Candidate", quantity: generalNumber(quantityRaw), unit, code, cd, discount: generalNumber(discountRaw), approvalStatus: "Needs Review", downstreamUse: "Discovery Only", costingEligible: false, validityState: "Validity Review Required", source: provenance });
      }
    }
  }
  if (!workbookCurrency) warnings.push({ code: "CURRENCY_NOT_EXPLICIT", message: "Workbook currency is absent or ambiguous; affected prices remain unresolved metadata only." });
  if (unresolvedRows.some(row => !row.manufacturer)) warnings.push({ code: "MANUFACTURER_NOT_EXPLICIT", message: "Rows without explicit manufacturer evidence were not converted into products." });
  const uniqueProductIdentities = new Set(products.map(product => product.id)).size;
  return { libraryVersion: PRODUCT_LIBRARY_VERSION, parserVersion: GENERAL_XLSX_PRICE_LIST_VERSION, importer: "General XLSX Price List", priceSource: { documentId: metadata.documentId || null, documentVersionId: metadata.documentVersionId || null, fileName: metadata.fileName || null, checksum: metadata.sha256 || null, currency: workbookCurrency, reviewStatus: "Needs Review", downstreamUse: "Discovery Only" }, manufacturers: [...manufacturers], brands: [...brands], products, prices, unresolvedRows, warnings, summary: { sheetsReviewed: workbook.sheets.length, sheetsExtracted: processedSheets.size, manufacturersDetected: manufacturers.size, brandsDetected: brands.size, productObservationsProcessed: products.length, uniqueProductIdentities, repeatedObservationsConsolidated: products.length - uniqueProductIdentities, priceObservationsDetected: prices.length, productsDetected: products.length, pricesDetected: prices.length, explicitCurrencyPrices: prices.filter(price => Boolean(price.currency)).length, unresolvedRows: unresolvedRows.length, validCurrentPrices: 0, costingEligiblePrices: 0 } };
};

export const searchProductLibrary = (products, query, filters = {}) => { const needle = text(query).toLowerCase(); return products.filter((product) => (!needle || [product.partNumber, product.description, product.family, product.manufacturer, product.brand].some((value) => text(value).toLowerCase().includes(needle))) && (!filters.manufacturer || product.manufacturer === filters.manufacturer) && (!filters.family || product.family === filters.family) && (!filters.lifecycleStatus || product.lifecycleStatus === filters.lifecycleStatus) && (!filters.reviewStatus || product.reviewStatus === filters.reviewStatus)); };
export const eligiblePrices = (prices, { at = new Date(), projectId = null } = {}) => prices.filter((price) => price.approvalStatus === "Approved" && price.validUntil && new Date(price.validUntil) >= at && (!price.projectId || price.projectId === projectId));
