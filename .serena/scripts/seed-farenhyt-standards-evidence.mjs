#!/usr/bin/env node
/**
 * Sprint 9 -- Product-side standards/certification evidence for Farenhyt
 * products already used in Opera Block Townhouses.
 *
 * Writes into the EXISTING library_products.standards JSON column -- the
 * same structure worker/product-matching-api.mjs's loadProducts() already
 * reads into product.standards, already consumed by
 * app/domain/product-matching-engine.mjs's evaluateStandards() (matched
 * against a requirement's standardKey = norm(`${body} ${number} ${part}`)).
 * No schema change, no new table, no parallel compliance subsystem. This
 * mirrors the exact entry shape already present on IFP-2100HV/HVB
 * (body/number/part/year/originalText/status/confidence), adding a
 * `source` object so evaluateStandards resolves "Verified Compliant"
 * (real cited evidence) rather than "Claimed Compliant".
 *
 * Scope: only IDP-PHOTO-IV, closing the one standards gap traced against
 * Opera's real req_30 (UL 268) requirement for items 28/29's actual top
 * candidate. No catalog-wide standards backfill.
 *
 * Evidence: "IDP-PHOTO-W SERIES Addressable Photoelectric Smoke Detectors",
 * Honeywell Document 351629, Rev C (05/20),
 * https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-PHOTO-IV-Datasheet.pdf
 * - Page 1, "Features and Benefits": "Designed to meet UL 268 7th Edition"
 * - Page 2, "Product Line Information": explicitly names "IDP-PHOTO-IV:
 *   Ivory, low-profile intelligent photoelectric sensor" as part of this
 *   same document/family -- not a part-number-family inference, IDP-PHOTO-IV
 *   is named directly.
 *
 * The requirement's own extracted standard (req_30, technical_requirements
 * table) stores body="UL", number="268", part="Standard" -- an extraction
 * artifact (the source text "UL 268 - Standard" was parsed literally). To
 * make evaluateStandards' key match resolve, this entry mirrors that same
 * body/number/part shape; the real, specific evidence (document, page,
 * edition, exact quoted text) is carried in full in originalText/source,
 * never collapsed into the matched key itself.
 *
 * Idempotent: skips a product that already has a standards entry with the
 * same normalized (body, number, part) key. Never overwrites or removes an
 * existing standards entry.
 *
 * Usage:
 *   node scripts/seed-farenhyt-standards-evidence.mjs <db-path> --dry-run
 *   node scripts/seed-farenhyt-standards-evidence.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-farenhyt-standards-evidence.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const key = (body, number, part) => norm(`${body} ${number} ${part || ""}`);

const DOC = {
  sourceId: "Honeywell Document 351629, Rev C (05/20) -- \"IDP-PHOTO-W SERIES Addressable Photoelectric Smoke Detectors\"",
  url: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/IDP-PHOTO-IV-Datasheet.pdf",
};

const STANDARDS = [
  {
    partNumber: "IDP-PHOTO-IV",
    body: "UL", number: "268", part: "Standard",
    originalText: "Designed to meet UL 268 7th Edition",
    page: 1, section: "Features and Benefits",
    confidence: 95,
  },
];

const getProduct = db.prepare("SELECT id, standards FROM library_products WHERE part_number = ?");
const updateStandards = db.prepare("UPDATE library_products SET standards = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let inserted = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const entry of STANDARDS) {
    const row = getProduct.get(entry.partNumber);
    if (!row) throw new Error(`Product not found in catalog: ${entry.partNumber}`);
    const existing = JSON.parse(row.standards || "[]");
    const targetKey = key(entry.body, entry.number, entry.part);
    const alreadyPresent = existing.some((s) => key(s.body, s.number, s.part) === targetKey);
    const label = `${entry.partNumber} -> ${entry.body} ${entry.number} (${entry.part})`;
    if (alreadyPresent) { console.log(`SKIP (already present): ${label}`); skipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${label} | confidence=${entry.confidence} | ${DOC.sourceId}, p.${entry.page} (${entry.section})`);
    if (apply) {
      const next = [...existing, {
        body: entry.body, number: entry.number, part: entry.part, year: null,
        originalText: entry.originalText, status: "Verified", confidence: entry.confidence,
        source: { sourceType: "Manufacturer Official Datasheet", sourceId: DOC.sourceId, url: DOC.url, page: entry.page, section: entry.section },
      }];
      updateStandards.run(JSON.stringify(next), row.id);
    }
    inserted += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} standards entr${inserted === 1 ? "y" : "ies"} ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped).`);
