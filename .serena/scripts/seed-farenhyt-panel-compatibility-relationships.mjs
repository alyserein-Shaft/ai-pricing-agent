#!/usr/bin/env node
/**
 * Sprint 7 -- Farenhyt Product/Family -> Panel/System/Protocol compatibility.
 *
 * Inserts evidence-backed rows into engineering_facts + engineering_fact_provenance
 * + engineering_relationships -- the existing, already-runtime-wired knowledge
 * structure (see app/domain/engineering-knowledge.mjs's createKnowledgeFact /
 * validateProvenance, and worker/product-matching-api.mjs's loadProducts, which
 * already reads engineering_relationships WHERE left_entity_type='Product' AND
 * status='Approved' into product.compatibility, consumed by
 * app/domain/product-matching-engine.mjs's evaluateCompatibility against each
 * BOQ item's profile.compatibility targetItem). No schema change, no new table,
 * no parallel subsystem. This is deliberately a SEPARATE structure from
 * product_accessories (scripts/seed-fire-alarm-accessory-relationships.mjs),
 * which already covers detector-to-mounting-base pairing -- a different
 * relationship concept (physical accessory fit) from panel/protocol
 * compatibility (which product-matching-engine.mjs's evaluateCompatibility
 * actually reads).
 *
 * Scope: only the products the Sprint 7 brief names, and only because they are
 * already used in the Opera Block Townhouses project: IFP-2100HV / IFP-2100HVB
 * (the FACP variants actually in the library), IDP-PHOTO-IV, IDP-HEAT-ROR-IV,
 * IDP-PULL-SA, IDP-PULL-DA, IDP-RELAY, B501-IV, B200S-IV. No catalog-wide
 * enrichment; no other Farenhyt part numbers are touched.
 *
 * Evidence: a single official Honeywell document names every one of these
 * products together as compatible with the IFP-2100/RFP-2100 Series FACP on
 * its SLC loop --
 *   "IFP-2100/RFP-2100 SERIES product caption -- Intelligent Fire Alarm
 *   Control Panel with Communicator", Honeywell Document 351602, Rev C (04-22),
 *   https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351602-C.pdf
 *   - Page 1: "The IFP-2100, IFP-2100HV, RFP-2100, and RFP-2100HV (red) and
 *     IFP-2100B, IFP-2100HVB, RFP-2100B, and RFP-2100HVB (black) are the
 *     latest intelligent addressable FACPs ... from Honeywell's Farenhyt line"
 *     and "The FACPs have one built-in SLC (signaling line circuit), which can
 *     support 159 System Sensor IDP/SK detectors and 159 IDP/SK modules".
 *   - Page 3, "IDP COMPATIBLE ADDRESSABLE DEVICES": explicitly lists
 *     IDP-PHOTO-IV, IDP-HEAT-ROR-IV, IDP-PULL-SA, IDP-PULL-DA, IDP-RELAY by
 *     exact part number.
 *   - Page 3, "SK/IDP BASES": lists "B501: 4" Flangeless mounting base" and
 *     "B200S: Intelligent sounder base". The document does not print a
 *     "-IV" suffix in this bases list (unlike the detectors list, which does
 *     print "-IV" ivory variants by name) -- B501-IV/B200S-IV are treated
 *     here as the ivory-color variant of the same documented base part
 *     number family, the same documented naming convention visible on the
 *     same page for IDP-PHOTO-IV/IDP-HEAT-ROR-IV/IDP-FIRE-CO-IV. This is a
 *     disclosed part-number-family reading of the primary source, not a
 *     same-manufacturer inference, and is recorded at reduced confidence.
 *
 * This document is the SOLE source for every relationship below; no
 * manufacturer-only inference is made (a bare "Honeywell makes both" is never
 * sufficient here -- every row cites the specific page/list this document
 * uses to name that exact product against the IFP-2100/RFP-2100 Series).
 *
 * The panel products (IFP-2100HV/HVB) get a relationship too: because
 * downstream (technical-requirement-engine.mjs's PANEL_COMPATIBILITY_REQUIRED_CATEGORIES)
 * already requires a compatibilityTarget for "Control Equipment" family
 * items, not only detection/initiation/module items -- this sprint does not
 * change that rule, only supplies real evidence for it. The relationship
 * records, honestly, that this FACP model IS the documented Farenhyt control
 * unit that hosts the SLC loop these devices communicate on -- not that the
 * panel is "compatible with itself".
 *
 * The right_entity_id is deliberately the literal string "the control unit"
 * -- not a product id, not "IFP-2100" -- because that is the EXACT normalized
 * targetItem text stored on Opera's real, approved, system-wide-propagated
 * requirement (req_160: "components must be compatible with the control unit
 * ..."), which is what app/domain/product-matching-engine.mjs's
 * evaluateCompatibility exact-matches against (see norm()/valuesEqual() --
 * lowercase, alphanumeric-only, no fuzzy matching). Storing a different
 * string here would make the relationship real but functionally inert for
 * Opera's current profile.compatibility. The SPECIFIC real evidence (which
 * panel, which protocol, which document/page) lives in `conditions` and in
 * the linked engineering_facts/engineering_fact_provenance rows, never
 * collapsed into the matched string itself.
 *
 * Idempotent: skips a (left_entity_type, left_entity_id, relationship_type,
 * right_entity_id) tuple that already has a status='Approved' row with no
 * effective_to. Never updates or deletes an existing engineering_relationships
 * or engineering_facts row. Never touches library_products.
 *
 * Usage:
 *   node scripts/seed-farenhyt-panel-compatibility-relationships.mjs <db-path> --dry-run
 *   node scripts/seed-farenhyt-panel-compatibility-relationships.mjs <db-path> --apply
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { createKnowledgeFact, KNOWLEDGE_MODEL_VERSION } from "../app/domain/engineering-knowledge.mjs";

const [dbPath, mode] = process.argv.slice(2);
if (!dbPath || !["--dry-run", "--apply"].includes(mode)) throw new Error("Usage: seed-farenhyt-panel-compatibility-relationships.mjs <db-path> --dry-run|--apply");
const apply = mode === "--apply";

const db = new DatabaseSync(dbPath);
const findId = (partNumber) => { const row = db.prepare("SELECT id FROM library_products WHERE part_number = ?").get(partNumber); if (!row) throw new Error(`Product not found in catalog: ${partNumber}`); return row.id; };
const now = () => new Date().toISOString();

const DOC = {
  sourceId: "Honeywell Document 351602, Rev C (04-22) -- \"IFP-2100/RFP-2100 SERIES product caption\"",
  evidenceId: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/hbt-fire-351602-C.pdf",
};

const RELATIONSHIPS = [
  {
    product: "IDP-PHOTO-IV", confidence: 96,
    page: 3, section: "IDP COMPATIBLE ADDRESSABLE DEVICES",
    originalText: "IDP-PHOTO-IV: Photoelectric smoke detector, ivory",
    note: "Explicitly named by exact part number in the IFP-2100/RFP-2100 Series' own IDP-compatible device list.",
  },
  {
    product: "IDP-HEAT-ROR-IV", confidence: 96,
    page: 3, section: "IDP COMPATIBLE ADDRESSABLE DEVICES",
    originalText: "IDP-HEAT-ROR-IV: Fixed rate of rise detector, ivory",
    note: "Explicitly named by exact part number in the IFP-2100/RFP-2100 Series' own IDP-compatible device list.",
  },
  {
    product: "IDP-PULL-SA", confidence: 96,
    page: 3, section: "IDP COMPATIBLE ADDRESSABLE DEVICES",
    originalText: "IDP-PULL-SA Addressable single action pull station",
    note: "Explicitly named by exact part number in the IFP-2100/RFP-2100 Series' own IDP-compatible device list.",
  },
  {
    product: "IDP-PULL-DA", confidence: 96,
    page: 3, section: "IDP COMPATIBLE ADDRESSABLE DEVICES",
    originalText: "IDP-PULL-DA: Addressable dual action pull station",
    note: "Explicitly named by exact part number in the IFP-2100/RFP-2100 Series' own IDP-compatible device list.",
  },
  {
    product: "IDP-RELAY", confidence: 96,
    page: 3, section: "IDP COMPATIBLE ADDRESSABLE DEVICES",
    originalText: "IDP-RELAY: Addressable relay module",
    note: "Explicitly named by exact part number in the IFP-2100/RFP-2100 Series' own IDP-compatible device list.",
  },
  {
    product: "B501-IV", confidence: 82,
    page: 3, section: "SK/IDP BASES",
    originalText: "B501: 4\" Flangeless mounting base",
    note: "Document lists the B501 base family without a color suffix (unlike the detector list on the same page, which does print \"-IV\" variants by name). B501-IV is read here as the ivory-color member of this documented base family -- a part-number-family reading of the primary source, not a same-manufacturer inference. Confidence reduced to reflect the unconfirmed suffix.",
  },
  {
    product: "B200S-IV", confidence: 82,
    page: 3, section: "SK/IDP BASES",
    originalText: "B200S: Intelligent sounder base",
    note: "Document lists the B200S base family without a color suffix. B200S-IV is read here as the ivory-color member of this documented base family -- a part-number-family reading of the primary source, not a same-manufacturer inference. Confidence reduced to reflect the unconfirmed suffix.",
  },
  {
    product: "IFP-2100HV", confidence: 95,
    page: 1, section: "Product description",
    originalText: "The IFP-2100, IFP-2100HV, RFP-2100, and RFP-2100HV (red) ... are the latest intelligent addressable FACPs (Fire Alarm Control Panels) from Honeywell's Farenhyt line.",
    note: "This FACP model is the documented Farenhyt control unit that hosts the IDP-protocol SLC loop the other devices in this list communicate on -- not asserted as \"compatible with itself\".",
  },
  {
    product: "IFP-2100HVB", confidence: 95,
    page: 1, section: "Product description",
    originalText: "IFP-2100B, IFP-2100HVB, RFP-2100B, and RFP-2100HVB (black) are the latest intelligent addressable FACPs (Fire Alarm Control Panels) from Honeywell's Farenhyt line.",
    note: "This FACP model is the documented Farenhyt control unit that hosts the IDP-protocol SLC loop the other devices in this list communicate on -- not asserted as \"compatible with itself\".",
  },
];

let inserted = 0, skipped = 0;
const findExisting = db.prepare("SELECT id FROM engineering_relationships WHERE left_entity_type='Product' AND left_entity_id=? AND relationship_type=? AND right_entity_id=? AND status='Approved' AND effective_to IS NULL");
const insertFact = db.prepare("INSERT INTO engineering_facts (id, project_id, entity_type, entity_id, predicate, value, data_type, operator, fact_type, scope_type, scope_id, status, confidence, model_version) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const insertProvenance = db.prepare("INSERT INTO engineering_fact_provenance (id, fact_id, source_type, source_id, evidence_id, page, section, original_text, extraction_method, confidence, user_id, user_role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
const insertRelationship = db.prepare("INSERT INTO engineering_relationships (id, project_id, left_entity_type, left_entity_id, relationship_type, right_entity_type, right_entity_id, conditions, exceptions, quantity_rule, fact_type, scope_type, scope_id, provenance_fact_id, confidence, status, version_number, effective_from, created_by) VALUES (?, NULL, 'Product', ?, 'Compatible With', 'System', 'the control unit', ?, '[]', NULL, 'Manufacturer Rule', 'Product', ?, ?, ?, 'Approved', 1, ?, ?)");

if (apply) db.exec("BEGIN IMMEDIATE");
try {
  for (const rel of RELATIONSHIPS) {
    const productId = findId(rel.product);
    const existing = findExisting.get(productId, "Compatible With", "the control unit");
    const label = `${rel.product} -> Compatible With -> "the control unit" (panel/protocol: Honeywell Farenhyt IFP-2100/RFP-2100 Series, IDP SLC loop)`;
    if (existing) { console.log(`SKIP (already exists, id=${existing.id}): ${label}`); skipped += 1; continue; }
    console.log(`${apply ? "INSERT" : "WOULD INSERT"}: ${label} | confidence=${rel.confidence} | ${DOC.sourceId}, p.${rel.page} (${rel.section})`);
    if (apply) {
      const factId = `fact_farenhyt_compat_${rel.product.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`;
      const fact = createKnowledgeFact({
        id: factId, projectId: null, entityType: "Product", entityId: productId,
        predicate: "Compatible With Control Unit",
        value: { targetRole: "the control unit", panelFamily: "Honeywell Farenhyt IFP-2100/RFP-2100 Series", protocol: "IDP (Intelligent Device Protocol) SLC loop", note: rel.note },
        dataType: "Object", operator: "Compatible With", factType: "Manufacturer Rule",
        scopeType: "Product", scopeId: productId, status: "Approved", confidence: rel.confidence,
        provenance: { sourceType: "Manufacturer Official Product Caption", sourceId: DOC.sourceId, evidenceId: DOC.evidenceId, extractionMethod: "Manual Research -- Official Manufacturer Documentation", confidence: rel.confidence, createdAt: now() },
      });
      insertFact.run(fact.id, fact.entityType, fact.entityId, fact.predicate, JSON.stringify(fact.value), fact.dataType, fact.operator, fact.factType, fact.scopeType, fact.scopeId, fact.status, fact.confidence, KNOWLEDGE_MODEL_VERSION);
      insertProvenance.run(randomUUID(), fact.id, "Manufacturer Official Datasheet", DOC.sourceId, DOC.evidenceId, rel.page, rel.section, rel.originalText, "Manual Research", rel.confidence, "sprint-7-farenhyt-compat-seed", "System");
      insertRelationship.run(randomUUID(), productId, JSON.stringify([{ type: "documented_evidence", panelFamily: "IFP-2100/RFP-2100 Series", protocol: "IDP", note: rel.note }]), productId, fact.id, rel.confidence, now(), "sprint-7-farenhyt-compat-seed");
    }
    inserted += 1;
  }
  if (apply) db.exec("COMMIT");
} catch (error) { if (apply) db.exec("ROLLBACK"); throw error; }

console.log(`\n${apply ? "Applied" : "Dry run"}: ${inserted} relationship(s) ${apply ? "inserted" : "would be inserted"}, ${skipped} already present (skipped).`);
