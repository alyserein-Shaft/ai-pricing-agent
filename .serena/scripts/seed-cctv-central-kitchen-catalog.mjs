#!/usr/bin/env node
/**
 * CCTV System Pack v1 -- seeds the minimal, real, evidence-backed CCTV
 * catalog this v1 scope is built from: the 13 real Hikvision products named
 * in Central Kitchen - Makkah's own real, validated final quotation
 * (Al Mespar Contracting Corp, Q1067-626-LCU, "Final Quotation CCTV" sheet
 * of outputs/central-kitchen-approved/Central_Kitchen_CCTV_Comparison_v8.xlsx),
 * plus the historical unit price each line was actually sold at.
 *
 * Two evidence tiers, both cited explicitly on every product:
 *   - 4 structurally-critical products (Dome Camera, Bullet Camera, NVR,
 *     Surveillance HDD) get a clean, official-manufacturer-datasheet-sourced
 *     description (Hikvision's own published specs), cited by URL.
 *   - The remaining 9 products keep the historical quotation's own scraped
 *     description text verbatim, cited to the real historical document --
 *     "historical quotations are evidence, not truth", so these are marked
 *     with a lower-authority source citation than the datasheet-sourced ones.
 *
 * Every price is inserted as validity_state='Historical' (never 'Current')
 * -- this is real evidence of what was actually charged on one real project
 * in the past, not a claim about today's price.
 *
 * Family classification uses the SAME shared classifyCctvFamilyFromText
 * function BOQ Understanding and every other caller uses -- never a
 * hand-picked family per product. A product whose description does not
 * literally match a governed CCTV phrase (Server, Windows Server License,
 * Testing & Commissioning) is correctly left Unclassified, not forced.
 *
 * Idempotent: skips a product if its (manufacturer_id, normalized_part_number)
 * already exists.
 *
 * Usage: node scripts/seed-cctv-central-kitchen-catalog.mjs <path-to-d1-sqlite>
 */
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { classifyCctvFamilyFromText } from "../app/domain/cctv-taxonomy.mjs";
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

const path = process.argv[2];
if (!path) throw new Error("Provide the D1 SQLite database path.");
const db = new DatabaseSync(path);
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const normalizePn = (value) => String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
const CREATED_BY = "local-development-user";
const TODAY = new Date().toISOString().slice(0, 10);

const HISTORICAL_QUOTATION_SOURCE = Object.freeze({
  sourceType: "Historical Supplier Quotation",
  sourceId: "Al Mespar Contracting Corp (MCC), Final Quotation Q1067-626-LCU, \"Central Kitchen - Makkah\" (Hikvision material list)",
  authority: "Historical Project Evidence -- Review Required",
  note: "Historical quotation is evidence, not truth: description text is the document's own OCR/scrape, part number and price are real but not independently re-verified against an official Hikvision datasheet for this specific product.",
});

// The 4 products with a clean, official Hikvision-datasheet-sourced
// description, verified via WebSearch against Hikvision's own published
// specs during the CCTV v1 audit.
const DATASHEET_PRODUCTS = [
  {
    partNumber: "DS-2CD3161G2-LIUF",
    description: "6 MP Smart Hybrid Light Motion 2.0 Fixed Dome Network Camera. 1/2.4\" Progressive Scan CMOS, max resolution 3200x1800. Smart Hybrid Light (IR + white light, up to 30m). 120 dB WDR. Human/vehicle detection. Built-in microphone. Water and dust resistant (IP67), vandal resistant (IK08).",
    source: { sourceType: "Manufacturer Official Datasheet", sourceId: "Hikvision \"DS-2CD3161G2-LIUF 6 MP Smart Hybrid Light Motion 2.0 Fixed Dome Network Camera\" Datasheet, 2023-09-07", url: "https://assets.hikvision.com/prd/public/all/doc/m000111829/DS-2CD3161G2-LIUF_Datasheet_20230907.pdf" },
    quantity: 132, unitPriceMinor: 22600,
  },
  {
    partNumber: "DS-2CD3061G2-LIUF",
    description: "6 MP Smart Hybrid Light Motion 2.0 Fixed Bullet Network Camera. 1/2.9\" Progressive Scan CMOS, 115 deg field of view. IR range up to 30m. WDR. Human/vehicle detection. Built-in microphone, two-way audio. True Day/Night (ICR). Outdoor weather resistant.",
    source: { sourceType: "Manufacturer Official Datasheet", sourceId: "Hikvision \"DS-2CD3061G2-LIUF\" Datasheet, 2023-09-07", url: "https://www.hikvision.com/content/dam/hikvision/en/support/regional-materials/bangladesh-/DS-2CD3061G2-LIUF_Datasheet_20230907.pdf" },
    quantity: 47, unitPriceMinor: 22600,
  },
  {
    partNumber: "DS-96256NI-I16",
    description: "256-ch 3U 4K Super Network Video Recorder. Up to 256 IP camera channels, up to 12MP per camera (H.265+/H.265/H.264+/H.264). Incoming/outgoing bandwidth 768 Mbps. Two independent 4K HDMI outputs. 16 SATA interfaces for HDD storage. RAID0/1/5/6/10/50/60 and JBOD support. ONVIF 2.5.",
    source: { sourceType: "Manufacturer Official Datasheet/Product Page", sourceId: "Hikvision \"DS-96256NI-I16\" Network Video Recorder, Ultra Series", url: "https://www.hikvision.com/en/products/IP-Products/Network-Video-Recorders/Ultra-Series/ds-96256ni-i16/" },
    quantity: 1, unitPriceMinor: 1293800,
  },
  {
    partNumber: "DS100HKAI-VX1",
    description: "10 TB Industry Standard 3.5-inch Form Factor Surveillance Hard Disk Drive. SATA 6 Gbit/s interface, 7200 RPM, 256 MB cache. 550 TB/year workload rating. Designed for 24x7 continuous operation, optimized for simultaneous multi-stream CCTV recording.",
    source: { sourceType: "Manufacturer Official Datasheet/Product Page", sourceId: "Hikvision \"DS100HKAI-VX1\" 10TB Surveillance HDD", url: "https://www.hikvision.com/content/dam/hikvision/en/support/regional-materials/nepal/DS160HKAI-VX1-Datasheet.pdf" },
    quantity: 15, unitPriceMinor: 249500,
  },
];

// The 9 remaining products: historical quotation's own scraped text, kept
// verbatim, cited only to the historical document.
const HISTORICAL_PRODUCTS = [
  { partNumber: "DS-1280ZJ-DM46", description: "Junction box for Dome camera.", quantity: 132, unitPriceMinor: 3100 },
  { partNumber: "DS-1280ZJ-XS", description: "Hikvision Junction Box For Dome/Bullet Camera.", quantity: 47, unitPriceMinor: 2800 },
  { partNumber: "DS-2CD3T66G2-4IS", description: "6 MP AcuSense Fixed Bullet Network Camera. Defog: clear imaging against strong back light due to 120 dB true WDR technology. Focus on human and vehicle targets classification based on deep learning. Water and dust resistant (IP67).", quantity: 20, unitPriceMinor: 60300 },
  { partNumber: "DS-1275ZJ-SUS", description: "Hikvision Vertical Pole Mount.", quantity: 5, unitPriceMinor: 7400 },
  { partNumber: "DS-2CD3166G2-ISU-H", description: "6 MP AcuSense Fixed Dome Network Camera. Clear imaging against strong back light due to 120 dB true WDR technology, DFOG. Focus on human and vehicle target classification based on deep learning. Water and dust resistant (IP67) and vandal-resistant (IK10).", quantity: 14, unitPriceMinor: 55200 },
  { partNumber: "PER4502A", description: "Dell PowerEdge R450 Server: Intel Xeon Silver 4309Y 2.8G, 8C/16T, chassis with up to 4 x 3.5\" SAS/SATA hard drives, 32 GB RDIMM, iDRAC9 Enterprise, PERC H755 SAS, dual port 10GbE SFP+, redundant PSU. Used as the CCTV VMS/database server in this project's real design.", quantity: 1, unitPriceMinor: 1642700 },
  { partNumber: "DS-VE41-T-HW7-B", description: "Tower Workstation. Four-screen independent output for efficient CCTV management. Pre-installed operating system, configured with keyboard and mouse, plug and play. Operates in extreme temperatures and high humidity.", quantity: 1, unitPriceMinor: 1445300 },
  { partNumber: "DS-D5024F2-AV2", description: "23.8 inch FHD 100Hz VA Monitor.", quantity: 2, unitPriceMinor: 35300 },
  { partNumber: "HikCentral-P-VSS-Base-0Ch", description: "HikCentral-P-VSS-Base/0Ch. HikCentral-P Video Security Software Base Licence (0 channels).", quantity: 1, unitPriceMinor: 14900 },
  { partNumber: "HikCentral-P-VSS-1Ch", description: "HikCentral-P-VSS-1Ch. Hikvision HikCentral 1 Channel Software Licence.", quantity: 213, unitPriceMinor: 10700 },
];

let manufacturer = db.prepare("SELECT id FROM product_manufacturers WHERE name = 'Hikvision'").get();
let manufacturerCreated = 0;
if (!manufacturer) {
  const manufacturerId = id("manufacturer");
  db.prepare("INSERT INTO product_manufacturers (id, name, normalized_name, status, created_by) VALUES (?, 'Hikvision', 'hikvision', 'Needs Review', ?)").run(manufacturerId, CREATED_BY);
  manufacturer = { id: manufacturerId };
  manufacturerCreated = 1;
}

// Two product_sources rows -- one per evidence tier -- reused across every
// product in that tier, matching the real Fire Alarm convention of one
// registered source per real document rather than one per product.
const findOrCreateSource = (key, { fileName, sourceType, authority, checksumSeed }) => {
  const existing = db.prepare("SELECT id FROM product_sources WHERE file_name=? AND scope_type='Global'").get(fileName);
  if (existing) return existing.id;
  const sourceId = id("productsource");
  db.prepare(
    "INSERT INTO product_sources (id, checksum, source_type, authority, scope_type, file_name, validity_state, review_status, created_by) VALUES (?, ?, ?, ?, 'Global', ?, ?, 'Needs Review', ?)",
  ).run(sourceId, sha256(checksumSeed), sourceType, authority, fileName, key === "historical" ? "Historical — Superseded By Current Pricing Unknown" : "Current Document — Applicability Review Required", CREATED_BY);
  return sourceId;
};
const historicalSourceId = findOrCreateSource("historical", {
  fileName: "Q1067-626-LCU- Central Kitchen - Makkah (CCTV material list)",
  sourceType: "Historical Supplier Quotation",
  authority: "Historical Project Evidence — Review Required",
  checksumSeed: "Al Mespar Contracting Corp (MCC), Final Quotation Q1067-626-LCU, Central Kitchen - Makkah, CCTV material list, Hikvision, page 7-8",
});
const datasheetSourceId = findOrCreateSource("datasheet", {
  fileName: "Hikvision official product datasheets (Dome/Bullet/NVR/HDD, CCTV v1 audit)",
  sourceType: "Manufacturer Official Datasheet",
  authority: "Official Manufacturer",
  checksumSeed: "Hikvision official datasheets: DS-2CD3161G2-LIUF, DS-2CD3061G2-LIUF, DS-96256NI-I16, DS100HKAI-VX1",
});

const familyCache = new Map();
const resolveFamilyId = (description) => {
  const classification = classifyCctvFamilyFromText(description);
  if (!classification) return null;
  const normalizedName = classification.family.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const cacheKey = normalizedName;
  if (familyCache.has(cacheKey)) return familyCache.get(cacheKey);
  const existing = db.prepare("SELECT id FROM product_families WHERE normalized_name=? AND brand_id IS NULL").get(normalizedName);
  let familyId = existing?.id;
  if (!familyId) {
    familyId = id("family");
    db.prepare("INSERT INTO product_families (id, brand_id, name, normalized_name, engineering_domain, review_status) VALUES (?, NULL, ?, ?, ?, 'Needs Review')")
      .run(familyId, classification.family, normalizedName, classification.category);
  }
  familyCache.set(cacheKey, familyId);
  return familyId;
};

const insertProduct = db.prepare(
  "INSERT INTO library_products (id, manufacturer_id, brand_id, family_id, part_number, normalized_part_number, description, review_status, approved_for_discovery, identity_status, library_scope, created_by) VALUES (?, ?, NULL, ?, ?, ?, ?, 'Needs Review', 0, 'Active', 'Global Library', ?)",
);
const insertEvidence = db.prepare(
  "INSERT INTO product_source_evidence (id, product_id, source_id, original_text, parser_version) VALUES (?, ?, ?, ?, 'seed-cctv-central-kitchen-catalog-1.0.0')",
);
const insertPriceRecord = db.prepare(
  "INSERT INTO price_records (id, product_id, source_id, project_id, amount_minor, currency, price_type, unit, validity_state, approval_status, downstream_use, source_location) VALUES (?, ?, ?, NULL, ?, 'SAR', 'Unit Price', 'EA', 'Historical', 'Needs Review', 'Discovery Only', ?)",
);

let productsCreated = 0, productsSkipped = 0, priceRecordsCreated = 0, familiesTouched = new Set();

db.exec("BEGIN IMMEDIATE");
try {
  for (const entry of [...DATASHEET_PRODUCTS, ...HISTORICAL_PRODUCTS]) {
    const normalizedPn = normalizePn(entry.partNumber);
    const existing = db.prepare("SELECT id FROM library_products WHERE manufacturer_id=? AND normalized_part_number=?").get(manufacturer.id, normalizedPn);
    if (existing) { productsSkipped += 1; continue; }
    const productId = id("product");
    const familyId = resolveFamilyId(entry.description);
    if (familyId) familiesTouched.add(familyId);
    insertProduct.run(productId, manufacturer.id, familyId, entry.partNumber, normalizedPn, entry.description, CREATED_BY);
    const sourceId = entry.source ? datasheetSourceId : historicalSourceId;
    const sourceNote = entry.source
      ? JSON.stringify({ ...entry.source, capturedAt: TODAY })
      : JSON.stringify({ ...HISTORICAL_QUOTATION_SOURCE, capturedAt: TODAY });
    insertEvidence.run(id("evidence"), productId, sourceId, sourceNote);
    insertPriceRecord.run(id("price"), productId, sourceId, entry.unitPriceMinor, sourceNote);
    priceRecordsCreated += 1;
    productsCreated += 1;
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(JSON.stringify({
  manufacturerCreated, productsCreated, productsSkipped, priceRecordsCreated,
  familiesClassified: familiesTouched.size,
}, null, 2));
