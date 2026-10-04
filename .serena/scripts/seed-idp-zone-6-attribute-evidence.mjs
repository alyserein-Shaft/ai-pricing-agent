#!/usr/bin/env node
/**
 * Sprint 1.39 -- enriches IDP-ZONE-6, newly reclassified into Zone Module
 * this same sprint, using its own official document: Honeywell Farenhyt
 * "IDP-Zone-6: Addressable Two-Wire Interface Module" (Doc 350297, Rev G,
 * 09/17). Mirrors the exact attribute/standard/accessory shape already
 * established for IDP-ZONE (Sprint 1.34) and for the other -6 multi-module
 * boards (IDP-MONITOR-10/IDP-CONTROL-6/IDP-RELAY-6/ISO-6), never copied
 * from them without this device's own document confirming the same facts
 * (which it does: same 7-panel Farenhyt list, same IDP-ACB cabinet mount,
 * same UL/CSFM/MEA 386-02-E Vol. II listing).
 *
 * https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_Zone_6_Datasheet.pdf
 *
 * Kept distinct from IDP-ZONE: six zone inputs vs one, mounts in IDP-ACB
 * (multi-module cabinet) vs SMB500 (single-module backbox) -- the same
 * single-vs-multi-module mounting distinction already established for
 * every other -6/-10 module in this catalog.
 *
 * Usage:
 *   node scripts/seed-idp-zone-6-attribute-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-idp-zone-6-attribute-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-idp-zone-6-attribute-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (v) => String(v ?? "").trim().toLowerCase();
const id = (prefix) => `${prefix}_${crypto.randomUUID()}`;

const DOC_ZONE_6 = { sourceType: "Manufacturer Official Datasheet", sourceId: "Honeywell Farenhyt \"IDP-Zone-6: Addressable Two-Wire Interface Module\" (Doc 350297, Rev G, 09/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_Zone_6_Datasheet.pdf" };
const fact = (name, value, { operator = "Equal", page = 1, section, confidence = 90, sourceText } = {}) => ({ name, operator, normalizedValue: value, confidence, ...(sourceText ? { sourceText } : {}), source: { sourceType: DOC_ZONE_6.sourceType, sourceId: DOC_ZONE_6.sourceId, url: DOC_ZONE_6.url, page, section } });

const ATTRS = [
  fact("module_type", "Zone Module", { section: "Product Description" }),
  fact("device_role", "Six-Zone 2-Wire Conventional Interface (Multi-Module Board)", { section: "Product Description" }),
  fact("conventional_zone_interface_capability", "Converts a conventional two-wire loop to an SLC loop; six independent zone inputs, each supervised, sharing a common SLC input and external power supply; up to two unused inputs can be disabled; reports normal/open/alarm per zone", { section: "Features & Benefits" }),
  fact("protocol", "IDP", { section: "Product Description", sourceText: "Converts a conventional two-wire loop to an SLC loop" }),
  fact("compatible_panel_families", "IFP-2100, IFP-2100ECS, RFP-2100, IFP-2000, IFP-2000ECS, RPS-2000, IFP-1000, IFP-1000ECS, IFP-300, IFP-300ECS, IFP-100, IFP-100ECS, IFP-75, IFP-50", { operator: "Informational", page: 1, section: "Compatibility" }),
  fact("operating_voltage_range", "15-32 VDC", { operator: "Informational", page: 2, section: "Electrical Ratings" }),
  fact("mounting_requirement", "Mounts in IDP-ACB cabinet (accommodates one or two IDP-Zone-6 modules)", { operator: "Informational", page: 2, section: "Installation / Accessories" }),
];
const STANDARDS = [{ body: "UL", number: "Listed" }, { body: "CSFM", number: "Listed" }, { body: "MEA", number: "386-02-E Vol. II" }];

const getProduct = db.prepare("SELECT id, attributes, standards FROM library_products WHERE part_number='IDP-ZONE-6' AND identity_status='Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
const insertAccessory = db.prepare("INSERT INTO product_accessories (id, product_id, accessory_product_id, relationship_type, quantity_rule, condition_json, included, separately_priced, evidence_json, confidence, review_status, created_by) VALUES (?, ?, ?, 'Compatible Cabinet', 'One per two modules', '[]', 0, 1, ?, 90, 'Approved', 'sprint-1.39-idp-zone-6-seed')");
const existingAccessory = db.prepare("SELECT 1 FROM product_accessories WHERE product_id=? AND accessory_product_id=? AND deleted_at IS NULL AND superseded_at IS NULL");
const getAcb = db.prepare("SELECT id FROM library_products WHERE part_number='IDP-ACB' AND identity_status='Active'");

let attrsAdded = 0, attrsSkipped = 0, stdsAdded = 0, stdsSkipped = 0, accAdded = 0, accSkipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  const product = getProduct.get();
  if (!product) throw new Error("IDP-ZONE-6 not found");
  const existingAttrs = JSON.parse(product.attributes || "[]");
  const existingNames = new Set(existingAttrs.map((e) => norm(e.name)));
  const toAdd = ATTRS.filter((a) => !existingNames.has(norm(a.name)));
  for (const a of ATTRS.filter((a) => existingNames.has(norm(a.name)))) { console.log(`SKIP (already present): IDP-ZONE-6 -> ${a.name}`); attrsSkipped += 1; }
  for (const a of toAdd) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: IDP-ZONE-6 -> ${a.name} = ${JSON.stringify(a.normalizedValue)}`);
  if (apply && toAdd.length) updateAttributes.run(JSON.stringify([...existingAttrs, ...toAdd]), product.id);
  attrsAdded += toAdd.length;

  const existingStds = JSON.parse(product.standards || "[]");
  const existingKeys = new Set(existingStds.map((e) => `${norm(e.body)}:${norm(e.number)}`));
  const stdsToAdd = STANDARDS.filter((s) => !existingKeys.has(`${norm(s.body)}:${norm(s.number)}`));
  for (const s of STANDARDS.filter((s) => existingKeys.has(`${norm(s.body)}:${norm(s.number)}`))) { console.log(`SKIP (already present): IDP-ZONE-6 -> ${s.body} ${s.number}`); stdsSkipped += 1; }
  for (const s of stdsToAdd) console.log(`${apply ? "INSERT" : "WOULD INSERT"}: IDP-ZONE-6 -> ${s.body} ${s.number}`);
  if (apply && stdsToAdd.length) updateStandards.run(JSON.stringify([...existingStds, ...stdsToAdd.map((s) => ({ body: s.body, number: s.number, part: null, year: null, status: "Verified", confidence: 85, source: { sourceType: DOC_ZONE_6.sourceType, sourceId: DOC_ZONE_6.sourceId, url: DOC_ZONE_6.url } }))]), product.id);
  stdsAdded += stdsToAdd.length;

  const acb = getAcb.get();
  if (!acb) throw new Error("IDP-ACB not found");
  if (existingAccessory.get(product.id, acb.id)) { console.log("SKIP (already present): IDP-ZONE-6 -> IDP-ACB"); accSkipped += 1; }
  else {
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: IDP-ZONE-6 -> Compatible Cabinet: IDP-ACB`);
    if (apply) insertAccessory.run(id("productaccessory"), product.id, acb.id, JSON.stringify([{ sourceType: DOC_ZONE_6.sourceType, sourceId: DOC_ZONE_6.sourceId, url: DOC_ZONE_6.url }]));
    accAdded += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${attrsAdded} attributes (${attrsSkipped} skipped); ${stdsAdded} standards (${stdsSkipped} skipped); ${accAdded} accessory relationships (${accSkipped} skipped).`);
