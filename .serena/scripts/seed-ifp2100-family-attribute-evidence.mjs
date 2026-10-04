#!/usr/bin/env node
/**
 * Sprint 1.29 -- closes the reusable technical Product Knowledge gaps for
 * the 6 active IFP-2100/IFP-2100ECS/RFP-2100 SKUs using the single official
 * Honeywell manual that explicitly covers all of them by name.
 *
 * Source (fetched and read directly this sprint):
 *   Honeywell Farenhyt "IFP-2100/IFP-2100ECS Addressable Fire Alarm Control
 *   Panel Manual", Document LS10143-001SK-E, Rev E, 8/29/2022.
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/LS10143-001SK-E-E-IFP-2100.pdf
 *
 * The manual states explicitly on p.10 (Section 1: Introduction):
 *   "NOTE: All references to the IFP-2100 within this manual are applicable
 *   to the IFP-2100, IFP-2100B, IFP-2100ECS, IFP-2100ECSB, IFP-2100HV,
 *   IFP-2100HVB, IFP-2100ECSHV, IFP-2100ECSHVB, RFP-2100, and RFP-2100B
 *   unless otherwise indicated."
 * This is the manufacturer's OWN explicit statement of equivalence -- not an
 * inference from naming similarity -- and is the basis for applying facts
 * proven for IFP-2100HV/HVB onto RFP-2100HV/HVB and IFP-2100ECSHV/HVB below.
 * (IFP-75 is a genuinely different product line, not covered by this note,
 * and is explicitly out of scope this sprint.)
 *
 * Facts NOT structured, and why:
 * - protocol: the panel is multi-protocol (Section 8.6.8 "SLC Family" lets
 *   the installer choose IDP, SK, or SD for the whole loop) -- there is no
 *   single "protocol=X" value that is true for every installation of this
 *   panel model. Asserting one would misrepresent a real, evidenced,
 *   installer-selectable capability as a fixed fact. Left unstructured.
 * - A specific FM listing NUMBER: the manual and price list both only say
 *   "FM approved" -- no citable number was found anywhere. The existing
 *   vague {"body":"FM","number":"Approved"} entry is NOT treated as
 *   resolved by this script and is left exactly as-is; a real FM number
 *   remains a genuine, reported gap.
 *
 * Usage:
 *   node scripts/seed-ifp2100-family-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-ifp2100-family-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-ifp2100-family-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();

const MANUAL = { sourceType: "Manufacturer Official Manual", sourceId: "Honeywell Farenhyt \"IFP-2100/IFP-2100ECS Addressable Fire Alarm Control Panel Manual\", Document LS10143-001SK-E, Rev E, 8/29/2022", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/LS10143-001SK-E-E-IFP-2100.pdf" };

// -- 1. Capacity/loop attributes for RFP-2100HV/HVB, mirroring IFP-2100HV/HVB
// via the manual's own explicit equivalence note (p.10) and its Hardware
// Features text (p.10): "The basic IFP-2100 panel contains one built-in
// signaling line circuit (SLC), which supports up to 159 IDP/SK sensors and
// 159 IDP/SK modules... Additional 6815 SLC expanders... for a maximum of
// 2,100 points per IFP-2100 control panel."
const RFP_CAPACITY_ATTRS = [
  { name: "native_slc_loops", value: 1, sourceText: "The basic IFP-2100 panel contains one built-in signaling line circuit (SLC)...", page: 10, section: "1.1.1 Hardware Features" },
  { name: "max_detectors_per_loop", value: 159, sourceText: "...supports up to 159 IDP/SK sensors and 159 IDP/SK modules...", page: 10, section: "1.1.1 Hardware Features" },
  { name: "max_modules_per_loop", value: 159, sourceText: "...supports up to 159 IDP/SK sensors and 159 IDP/SK modules...", page: 10, section: "1.1.1 Hardware Features" },
  { name: "max_system_points", value: 2100, sourceText: "Additional 6815 SLC expanders supports 159 IDP/SK sensors and 159 IDP/SK modules for a maximum of 2,100 points per IFP-2100 control panel.", page: 10, section: "1.1.1 Hardware Features" },
];

// -- 2. Communication interface for the ECS variants -- same manual, same
// Section 4.1.3 (p.32), which the manual's title and note apply to
// IFP-2100ECS just as much as IFP-2100HV (already structured for IFP-2100HV).
const ECS_COMM_ATTR = { name: "communication_interface", value: "Ethernet/TCP-IP", sourceText: "The Ethernet connect is used for IP communication.", page: 32, section: "4.1.3 Ethernet Connection" };

const PRODUCT_ATTRIBUTES = [
  ...RFP_CAPACITY_ATTRS.map((a) => ({ partNumber: "RFP-2100HV", ...a })),
  ...RFP_CAPACITY_ATTRS.map((a) => ({ partNumber: "RFP-2100HVB", ...a })),
  { partNumber: "IFP-2100ECSHV", ...ECS_COMM_ATTR },
  { partNumber: "IFP-2100ECSHVB", ...ECS_COMM_ATTR },
];

// -- 3. Real, citable standards for all 6 SKUs (p.10, Section 1:
// Introduction): "The IFP-2100, IFP-2100B, IFP-2100ECS, IFP-2100ECSB,
// IFP-2100HV, IFP-2100HVB, IFP-2100ECSHV, and IFP-2100ECSHVB are analog
// addressable fire alarm control panels (FACP), that meet the requirements
// of UL 864. The IFP-2100ECS, IFP-2100ECSB, IFP-2100ECSHV, and
// IFP-2100ECSHVB are analog addressable fire control system combined with
// an Emergency Communication System that meet the requirements for Mass
// Notification as described in UL 864 and UL 2572." This is added
// alongside -- not in place of -- the existing vague "UL Listing"/"FM
// Approved" placeholder entries, which are left untouched and not treated
// as resolved.
const ALL_SIX = ["IFP-2100HV", "IFP-2100HVB", "RFP-2100HV", "RFP-2100HVB", "IFP-2100ECSHV", "IFP-2100ECSHVB"];
const ECS_TWO = ["IFP-2100ECSHV", "IFP-2100ECSHVB"];
const STANDARDS = [
  ...ALL_SIX.map((partNumber) => ({ partNumber, body: "UL", number: "864", originalText: "...are analog addressable fire alarm control panels (FACP), that meet the requirements of UL 864.", page: 10, section: "Section 1: Introduction" })),
  ...ECS_TWO.map((partNumber) => ({ partNumber, body: "UL", number: "2572", originalText: "...analog addressable fire control system combined with an Emergency Communication System that meet the requirements for Mass Notification as described in UL 864 and UL 2572.", page: 10, section: "Section 1: Introduction" })),
];

// -- 4. 5815RMK expansion-module accessory relationship for RFP-2100HV/HVB,
// mirroring IFP-2100HV/HVB's own existing entry, via the manual's explicit
// installation instructions (p.48-49, Sections 4.11/4.12): "Mount the
// 5815XL/6815 in the IFP-2100 cabinet, the RPS-1000 cabinet, or the
// 5815RMK remote mounting kit" -- combined with the p.10 equivalence note.
const ACCESSORIES = [
  { partNumber: "RFP-2100HV", accessoryPartNumber: "5815RMK" },
  { partNumber: "RFP-2100HVB", accessoryPartNumber: "5815RMK" },
];

const getProduct = db.prepare("SELECT id, part_number, attributes, standards FROM library_products WHERE part_number = ? AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, 'Expansion Module', 'CAPACITY_DEPENDENT -- quantity depends on the project''s SLC loop/point count; not calculated by this system', '[]', 0, 1, ?, 90, 'Approved', 'sprint-1.29-ifp2100-family-seed')");
const existingAccessory = db.prepare("SELECT 1 FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND deleted_at IS NULL AND superseded_at IS NULL");

let attrsAdded = 0, attrsSkipped = 0, stdsAdded = 0, stdsSkipped = 0, accAdded = 0, accSkipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  // Attributes
  const byProduct = new Map();
  for (const a of PRODUCT_ATTRIBUTES) { if (!byProduct.has(a.partNumber)) byProduct.set(a.partNumber, []); byProduct.get(a.partNumber).push(a); }
  for (const [partNumber, attrs] of byProduct) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.attributes || "[]");
    const existingNames = new Set(existing.map((e) => norm(e.name)));
    const toAdd = attrs.filter((a) => !existingNames.has(norm(a.name)));
    for (const a of attrs.filter((a) => existingNames.has(norm(a.name)))) { console.log(`SKIP (already present): ${partNumber} -> ${a.name}`); attrsSkipped += 1; }
    if (toAdd.length) {
      const appended = toAdd.map((a) => ({ name: a.name, value: a.value, origin: "EXTRACTED", confidence: 90, sourceText: a.sourceText, extractionMethod: "manual-research-official-documentation", source: { ...MANUAL, page: a.page, section: a.section } }));
      for (const a of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${a.name} = ${JSON.stringify(a.value)}`);
      if (apply) updateAttributes.run(JSON.stringify([...existing, ...appended]), product.id);
      attrsAdded += appended.length;
    }
  }

  // Standards
  const byProductStd = new Map();
  for (const s of STANDARDS) { if (!byProductStd.has(s.partNumber)) byProductStd.set(s.partNumber, []); byProductStd.get(s.partNumber).push(s); }
  for (const [partNumber, stds] of byProductStd) {
    const product = getProduct.get(partNumber);
    if (!product) throw new Error(`Product not found: ${partNumber}`);
    const existing = JSON.parse(product.standards || "[]");
    const existingKeys = new Set(existing.map((e) => `${norm(e.body)}:${norm(e.number)}`));
    const toAdd = stds.filter((s) => !existingKeys.has(`${norm(s.body)}:${norm(s.number)}`));
    for (const s of stds.filter((s) => existingKeys.has(`${norm(s.body)}:${norm(s.number)}`))) { console.log(`SKIP (already present): ${partNumber} -> ${s.body} ${s.number}`); stdsSkipped += 1; }
    if (toAdd.length) {
      const appended = toAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, originalText: s.originalText, status: "Verified", confidence: 96, source: { ...MANUAL, page: s.page, section: s.section } }));
      for (const s of appended) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${partNumber} -> ${s.body} ${s.number}`);
      if (apply) updateStandards.run(JSON.stringify([...existing, ...appended]), product.id);
      stdsAdded += appended.length;
    }
  }

  // Accessories
  for (const a of ACCESSORIES) {
    const product = getProduct.get(a.partNumber);
    if (!product) throw new Error(`Product not found: ${a.partNumber}`);
    const accessory = getProduct.get(a.accessoryPartNumber);
    if (!accessory) throw new Error(`Accessory product not found: ${a.accessoryPartNumber}`);
    if (existingAccessory.get(product.id, accessory.id)) { console.log(`SKIP (already present): ${a.partNumber} -> ${a.accessoryPartNumber}`); accSkipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${a.partNumber} -> Expansion Module: ${a.accessoryPartNumber}`);
    if (apply) {
      const evidence = JSON.stringify([{ ...MANUAL, page: "48-49", section: "4.11 5815XL Installation / 4.12 6815 Installation" }]);
      insertAccessory.run(`productaccessory_${crypto.randomUUID()}`, product.id, accessory.id, evidence);
    }
    accAdded += 1;
  }

  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} product attributes inserted (${attrsSkipped} skipped); ${stdsAdded} standards inserted (${stdsSkipped} skipped); ${accAdded} accessory relationships inserted (${accSkipped} skipped). protocol left unstructured (multi-protocol panel); FM listing number remains unresolved (no citable number found).`);
