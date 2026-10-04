#!/usr/bin/env node
/**
 * Fire Alarm E2E fix (Product Knowledge gap closure) -- real Central Kitchen
 * - Makkah gap: none of the Monitor Module family's five active SKUs carried
 * a structured `addressing` fact, so a correctly-classified "Monitor module
 * Addressable type." BOQ line had no attribute-level evidence to discriminate
 * among siblings, even though every wired SKU's own official document
 * literally titles itself "Addressable Monitor Module":
 *
 * - IDP-MONITOR (Doc 350288, Rev K, 11/17): title "IDP-MONITOR | Addressable
 *   Monitor Module"; body: "The IDP-MONITOR is an addressable monitor
 *   module for use with the Honeywell Farenhyt Series fire alarm control
 *   panels (FACPs)."
 * - IDP-MINIMON (Doc 350279, Rev H, 08/17): title "IDP-MINIMON | Addressable
 *   Monitor Module"; body: "The IDP-MINIMON is a compact and light weight
 *   addressable monitor module..."
 * - IDP-MONITOR-2 (Doc 350289, Rev G, 11/17): title "IDP-MONITOR-2 |
 *   Addressable Dual Monitor Module"; body: "The IDP-MONITOR-2 is an
 *   addressable monitor module with two initiating circuits..."
 * - IDP-MONITOR-10 (Doc 350296, Rev G, 09/17): title "Addressable Monitor
 *   Module | IDP-Monitor-10"; body: "The IDP-Monitor-10 is a 10 point
 *   addressable monitor module..."
 *
 * WIDP-MONITOR is deliberately EXCLUDED: its own official document (Doc
 * 350617, Rev B, 10/18) never uses the word "addressable" for itself --
 * it is a SWIFT wireless module reaching a panel only indirectly through a
 * WIDP-WGI gateway (already recorded as
 * compatible_control_panels_via_gateway: "...not a direct SLC connection"),
 * and it carries no `protocol` fact either, unlike every wired sibling
 * (protocol="IDP"). Asserting "Addressable" for it would contradict its own
 * documented, indirect, gateway-mediated architecture -- a genuine,
 * evidence-based exclusion, not an oversight.
 *
 * No other attribute, no other family, and no other SKU is touched.
 *
 * Idempotent: skips a product that already has `addressing` recorded.
 *
 * Usage:
 *   node scripts/seed-monitor-module-addressing-attribute.mjs <db-path> --dry-run
 *   node scripts/seed-monitor-module-addressing-attribute.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-monitor-module-addressing-attribute.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";
const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();

const TARGETS = [
  { partNumber: "IDP-MONITOR", doc: { sourceId: "Honeywell Farenhyt \"IDP-MONITOR: Addressable Monitor Module\" (Doc 350288, Rev K, 11/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-MONITOR-Datasheet.pdf" }, sourceText: "IDP-MONITOR is an addressable monitor module" },
  { partNumber: "IDP-MINIMON", doc: { sourceId: "Honeywell Farenhyt \"IDP-MINIMON: Addressable Monitor Module\" (Doc 350279, Rev H, 08/17)", url: "https://esis-egy.com/wp-content/uploads/2022/07/IDPMINIMON_Datasheet.pdf" }, sourceText: "IDP-MINIMON is a compact and light weight addressable monitor module" },
  { partNumber: "IDP-MONITOR-2", doc: { sourceId: "Honeywell Farenhyt \"IDP-MONITOR-2: Addressable Dual Monitor Module\" (Doc 350289, Rev G, 11/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/350289-G-IDP-Monitor-2.pdf" }, sourceText: "IDP-MONITOR-2 is an addressable monitor module with two initiating circuits" },
  { partNumber: "IDP-MONITOR-10", doc: { sourceId: "Honeywell Farenhyt \"IDP-Monitor-10: Addressable Monitor Module\" (Doc 350296, Rev G, 09/17)", url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_Monitor_10_Datasheet.pdf" }, sourceText: "IDP-Monitor-10 is a 10 point addressable monitor module" },
];

const getProduct = db.prepare("SELECT id, part_number, attributes FROM library_products WHERE part_number = ? AND identity_status = 'Active'");
const updateAttributes = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let added = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const target of TARGETS) {
    const product = getProduct.get(target.partNumber);
    if (!product) { console.log(`SKIP (not found): ${target.partNumber}`); skipped += 1; continue; }
    const existing = JSON.parse(product.attributes || "[]");
    if (existing.some((entry) => norm(entry.name) === "addressing")) { console.log(`SKIP (already present): ${target.partNumber} -> addressing`); skipped += 1; continue; }
    const attribute = { name: "addressing", operator: "Equal", normalizedValue: "Addressable", confidence: 90, source: { sourceType: "Manufacturer Official Datasheet", sourceId: target.doc.sourceId, url: target.doc.url, page: 1, section: "Product Description" }, sourceText: target.sourceText };
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${target.partNumber} -> addressing = "Addressable"`);
    if (apply) updateAttributes.run(JSON.stringify([...existing, attribute]), product.id);
    added += 1;
  }
  const widp = getProduct.get("WIDP-MONITOR");
  if (widp) console.log(`SKIP (deliberate exclusion, documented above): WIDP-MONITOR -- no "addressable" wording in its own official document`);
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${added} attribute${added === 1 ? "" : "s"} ${apply ? "added" : "would be added"}, ${skipped} skipped.`);
