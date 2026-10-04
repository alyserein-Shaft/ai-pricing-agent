#!/usr/bin/env node
/**
 * Sprint 10 -- correct comparison-type classification for two Opera Fire
 * Alarm requirements that were being evaluated through the generic
 * unstructured "Missing Product Data" fallback (req_364) or a malformed
 * Standard/Compatibility citation (req_326), when each is actually a real,
 * verifiable structured technical attribute.
 *
 * Writes into the EXISTING requirement_attributes table (the same structure
 * technical-requirement-api.mjs's loadInputs already reads into
 * consolidatedRequirements[].attributes, already consumed by
 * app/domain/product-matching-engine.mjs's attributeComparisons) and the
 * EXISTING library_products.attributes JSON column. No schema change, no new
 * table.
 *
 * req_364 -- "Manual pull stations shall be individually addressable...
 * Stations shall include an ADA compliant single action operating mechanism
 * with a mechanical latch to hold an operated station open until reset."
 * (specjob_14d2a128..._requirement_364, page 32, clause A). "ADA compliant"
 * is not itself a citable, listable manufacturer certification the way UL
 * 268 is -- there is no per-product ADA listing/agency number. The genuinely
 * verifiable, narrow assertion in this clause is the operating mechanism
 * type: "single action". The catalog ALREADY carries this as a governed
 * attribute -- library_products.attributes already has action_type="Single
 * Action" on IDP-PULL-SA and action_type="Dual Action" on IDP-PULL-DA
 * (fire-alarm-product-attribute-extraction-1.0.0, confidence 90) -- so only
 * the REQUIREMENT side is missing the structured capture; the product side
 * needs no change. This is a strict tightening, not a weakening: IDP-PULL-DA
 * will now correctly fail this comparison (a dual-action station does not
 * satisfy "single action"), where before it only failed on an unrelated
 * generic mandatory-clause placeholder.
 * The "mechanical latch to hold an operated station open until reset"
 * portion is NOT captured as a separate attribute here -- there is no
 * existing governed attribute name or catalog evidence for it, and
 * inventing one would not be a "smallest fix"; it is reported as a residual,
 * honestly unverified aspect of the clause.
 *
 * req_326 -- "Fire Alarm Control Panel (FACP) shall have the capability to
 * provide supplemental notification and remote user access to the FACP
 * using Ethernet and TCP/IP communications protocol compatible with IEEE
 * Standard 802.3." (specjob_14d2a128..._requirement_326, page 30, clause 1).
 * Traced against the project's OWN full specification set: the SAME project
 * document set contains a separate, extensive Division 27 "Communications
 * Equipment Room Fittings" section (structured cabling, access switches,
 * IEEE802.1s/w/X, IEEE802.3ad/af/at/u/ab/ae/z, etc.) that is the project's
 * real, rigorous network-equipment specification. req_326, by contrast,
 * appears under "28 46 00 FIRE DETECTION AND ALARM SYSTEM" and only asks
 * that the FACP itself be able to plug into that broader network via
 * standard Ethernet/TCP-IP -- it is a communications-capability requirement
 * on the panel, not an independent FACP product-selection/certification
 * gate. Confirmed no official Honeywell/Farenhyt document (including the
 * full IFP-2100/IFP-2100ECS manual's own "Section 2: Agency Listings,
 * Approvals, and Requirements" -- FCC/UL/NFPA only) ever lists "IEEE 802.3"
 * as a certifiable listing for this panel; there is no vendor-issued
 * certificate to cite the way UL 268 has one. Compliance is therefore never
 * inferred from "Ethernet" being mentioned -- instead, the genuinely
 * verifiable capability (does this FACP have a documented Ethernet/TCP-IP
 * interface for remote access) is captured as a structured attribute,
 * verified against the panel's own official manual text describing exactly
 * that capability. The malformed body="IEEE"/number="Standard" and
 * target="IEEE Standard 802" citations that this same clause was also
 * mis-extracted into (requirement_standards / requirement_compatibility)
 * are excluded from blocking at the evaluation layer in
 * product-matching-engine.mjs (structural detection of an unfalsifiable
 * citation with no real standard number -- never touches a real citation
 * like "UL 268"), not deleted here, preserving full extraction history.
 *
 * Idempotent: skips a requirement/product that already has an attribute
 * entry with the same normalized name. Never overwrites or removes an
 * existing entry.
 *
 * Usage:
 *   node scripts/seed-farenhyt-requirement-attribute-corrections.mjs <db-path> --dry-run
 *   node scripts/seed-farenhyt-requirement-attribute-corrections.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-farenhyt-requirement-attribute-corrections.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const norm = (value) => String(value ?? "").trim().toLowerCase();

const REQ_364 = "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_364";
const REQ_326 = "specjob_14d2a128-e64d-47a4-a861-52e6f75617ae_chunk_000001_requirement_326";

const REQUIREMENT_ATTRIBUTES = [
  {
    requirementId: REQ_364, name: "action_type", operator: "Equal",
    originalValue: "single action operating mechanism", normalizedValue: "Single Action",
    confidence: 88,
  },
  {
    requirementId: REQ_326, name: "communication_interface", operator: "Equal",
    originalValue: "Ethernet and TCP/IP communications protocol", normalizedValue: "Ethernet/TCP-IP",
    confidence: 85,
  },
];

const PRODUCT_ATTRIBUTES = [
  {
    partNumber: "IFP-2100HV", name: "communication_interface", value: "Ethernet/TCP-IP",
    sourceText: "The Ethernet connect is used for IP communication.",
    doc: "Honeywell Document LS10143-001SK-E, Rev E (8/29/2022) -- \"IFP-2100/IFP-2100ECS Addressable Fire Alarm Control Panel Manual\", Section 4.1.3 \"Ethernet Connection\"",
    confidence: 90,
  },
  {
    partNumber: "IFP-2100HVB", name: "communication_interface", value: "Ethernet/TCP-IP",
    sourceText: "The Ethernet connect is used for IP communication.",
    doc: "Honeywell Document LS10143-001SK-E, Rev E (8/29/2022) -- \"IFP-2100/IFP-2100ECS Addressable Fire Alarm Control Panel Manual\", Section 4.1.3 \"Ethernet Connection\"",
    confidence: 90,
  },
];

const getRequirement = db.prepare("SELECT source_location FROM technical_requirements WHERE id = ?");
const getExistingAttrs = db.prepare("SELECT name FROM requirement_attributes WHERE requirement_id = ?");
const insertReqAttr = db.prepare("INSERT INTO requirement_attributes (id, requirement_id, name, operator, original_value, parsed_value, original_unit, normalized_value, normalized_unit, confidence, source_location) VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, NULL, ?, ?)");
const getProduct = db.prepare("SELECT id, attributes FROM library_products WHERE part_number = ?");
const updateProductAttrs = db.prepare("UPDATE library_products SET attributes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?");

let inserted = 0, skipped = 0;
if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const entry of REQUIREMENT_ATTRIBUTES) {
    const requirement = getRequirement.get(entry.requirementId);
    if (!requirement) throw new Error(`Requirement not found: ${entry.requirementId}`);
    const existing = (getExistingAttrs.all(entry.requirementId) || []).map((row) => norm(row.name));
    const label = `${entry.requirementId} -> ${entry.name} = "${entry.normalizedValue}"`;
    if (existing.includes(norm(entry.name))) { console.log(`SKIP (already present): ${label}`); skipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: requirement_attributes: ${label}`);
    if (apply) {
      const id = `${entry.requirementId}_attribute_correction_${entry.name}`;
      insertReqAttr.run(id, entry.requirementId, entry.name, entry.operator, entry.originalValue, JSON.stringify(entry.normalizedValue), entry.confidence, requirement.source_location);
    }
    inserted += 1;
  }
  for (const entry of PRODUCT_ATTRIBUTES) {
    const row = getProduct.get(entry.partNumber);
    if (!row) throw new Error(`Product not found in catalog: ${entry.partNumber}`);
    const existingAttrs = JSON.parse(row.attributes || "[]");
    const label = `${entry.partNumber} -> ${entry.name} = "${entry.value}"`;
    if (existingAttrs.some((a) => norm(a.name) === norm(entry.name))) { console.log(`SKIP (already present): ${label}`); skipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: library_products.attributes: ${label} | ${entry.doc}`);
    if (apply) {
      const next = [...existingAttrs, { name: entry.name, value: entry.value, origin: "EXTRACTED", confidence: entry.confidence, sourceText: entry.sourceText, extractionMethod: "manual-research-official-documentation", source: { sourceType: "Manufacturer Official Manual", sourceId: entry.doc } }];
      updateProductAttrs.run(JSON.stringify(next), row.id);
    }
    inserted += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} attribute entr${inserted === 1 ? "y" : "ies"} ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped).`);
