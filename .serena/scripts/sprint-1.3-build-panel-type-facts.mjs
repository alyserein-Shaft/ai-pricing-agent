#!/usr/bin/env node
/**
 * Sprint 1.3 (Drawing Intake) -- build governed engineering_facts for the 6
 * real Fire Alarm panel/riser TYPES, from the drawing-intake data ingested by
 * scripts/sprint-1.3-ingest-fas-drawings.mjs. Reuses the existing generic
 * engineering_facts + engineering_fact_provenance tables (Sprint 1.2's Step 1
 * audit already found these are the right, reusable home for this) -- no new
 * topology tables.
 *
 * native_slc_loops facts are DETERMINISTIC: derived by counting distinct
 * LOOP-N text entries in the real, already-ingested drawing_search_entries
 * for each riser (query below), never hand-counted from an image.
 *
 * The panel type LABEL itself is only deterministically extractable for 2 of
 * 6 risers ("MALE/FEMALE CH", "FAMILY CH" -- real embedded text). The other
 * 4 risers' titles ("Small TH"/"Large TH"/"Corner A"/"Corner B") are drawn as
 * vector artwork in their source PDFs, not text, and the current text-only
 * drawing-intake engine cannot extract them -- confirmed by their absence
 * from every drawing_search_entries row for those 4 documents. These 4
 * labels are recorded with source_type='Human Visual Inspection' (the person
 * -- Claude, this session -- directly viewing the rendered PDF page during
 * this investigation), honestly distinguished from the deterministic
 * text-extraction provenance used for everything else, per Sprint 1.2's
 * evidence-classification discipline.
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

const dbPath = process.argv[2];
if (!dbPath) throw new Error("Usage: sprint-1.3-build-panel-type-facts.mjs <db-path>");
const raw = new DatabaseSync(dbPath);
const PROJECT_ID = "project_c8d6ffe8-a781-4bdf-94aa-a40eea873920";
const USER_ID = "local-development-user";
const id = (prefix) => `${prefix}_${randomUUID()}`;
const MODEL_VERSION = "sprint-1.3-fas-drawing-topology-1.0.0";

const documents = raw.prepare(`
  SELECT d.id document_id, d.logical_name, v.id intake_version_id, v.document_version_id
  FROM documents d
  JOIN drawing_intake_versions v ON v.document_id = d.id AND v.superseded_at IS NULL
  WHERE d.project_id = ? AND d.document_type = 'Riser Diagram'
`).all(PROJECT_ID); // node:sqlite's .all() returns a plain array directly (not a {results:[]} D1 wrapper).

// Panel type key -> { label, labelSource, labelConfidence }. Loop count is
// NEVER hardcoded here -- it is queried live below from the real ingested
// drawing_search_entries for each document, per riser.
const TYPE_LABELS = {
  "FAS Riser -- Small TH (Sheet 01)": { key: "small_th", label: "Small TH", labelSource: "Human Visual Inspection (title rendered as vector artwork, not extractable text)" },
  "FAS Riser -- Large TH (Sheet 02)": { key: "large_th", label: "Large TH", labelSource: "Human Visual Inspection (title rendered as vector artwork, not extractable text)" },
  "FAS Riser -- Corner A (Sheet 03)": { key: "corner_a", label: "Corner A", labelSource: "Human Visual Inspection (title rendered as vector artwork, not extractable text)" },
  "FAS Riser -- Corner B (Sheet 04)": { key: "corner_b", label: "Corner B", labelSource: "Human Visual Inspection (title rendered as vector artwork, not extractable text)" },
  "FAS Riser -- Male/Female Clubhouse (Sheet 01)": { key: "male_female_ch", label: "Male/Female CH", labelSource: "Deterministic drawing-intake text extraction" },
  "FAS Riser -- Family Clubhouse (Sheet 01)": { key: "family_ch", label: "Family CH", labelSource: "Deterministic drawing-intake text extraction" },
};

const statements = [];
const summary = [];
for (const doc of documents) {
  const type = TYPE_LABELS[doc.logical_name];
  if (!type) continue;
  const loopRows = raw.prepare(`
    SELECT DISTINCT text_content FROM drawing_search_entries
    WHERE intake_version_id = ? AND text_content GLOB 'LOOP-[0-9]*'
  `).all(doc.intake_version_id);
  const loopNumbers = loopRows.map((r) => Number(r.text_content.match(/\d+/)[0]));
  const nativeLoops = loopNumbers.length ? Math.max(...loopNumbers) : null;
  if (!nativeLoops || loopNumbers.length !== nativeLoops) {
    console.log(`SKIP ${doc.logical_name}: loop numbering not contiguous/complete (found ${JSON.stringify(loopNumbers.sort())}) -- refusing to guess a loop count.`);
    continue;
  }

  const entityId = `fas_panel_type_${type.key}`;
  const existing = raw.prepare("SELECT id FROM engineering_facts WHERE entity_type='Fire Alarm Panel Type' AND entity_id=? AND predicate='native_slc_loops' AND status='Active' AND deleted_at IS NULL").get(entityId);
  if (existing) { console.log(`SKIP ${doc.logical_name}: native_slc_loops fact already exists (${existing.id})`); summary.push({ type: type.label, entityId, nativeLoops, status: "already exists" }); continue; }

  const loopFactId = id("fact");
  statements.push(() => raw.prepare(`INSERT INTO engineering_facts (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,model_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(loopFactId, PROJECT_ID, "Fire Alarm Panel Type", entityId, "native_slc_loops", String(nativeLoops), "Integer", "Equals", "Source Fact", "Project", PROJECT_ID, "Active", 95, MODEL_VERSION));
  statements.push(() => raw.prepare(`INSERT INTO engineering_fact_provenance (id,fact_id,source_type,source_id,document_id,document_version_id,original_text,extraction_method,parser_version,confidence) VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(id("provenance"), loopFactId, "Drawing Intake -- Riser Diagram", doc.intake_version_id, doc.document_id, doc.document_version_id, loopNumbers.sort().map((n) => `LOOP-${n}`).join(", "), "Deterministic count of distinct LOOP-N text entries", "drawing-intake-1.0.0", 95));

  const labelFactId = id("fact");
  statements.push(() => raw.prepare(`INSERT INTO engineering_facts (id,project_id,entity_type,entity_id,predicate,value,data_type,operator,fact_type,scope_type,scope_id,status,confidence,model_version) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(labelFactId, PROJECT_ID, "Fire Alarm Panel Type", entityId, "panel_type_label", type.label, "String", "Equals", "Source Fact", "Project", PROJECT_ID, "Active", type.labelSource.startsWith("Deterministic") ? 90 : 70, MODEL_VERSION));
  statements.push(() => raw.prepare(`INSERT INTO engineering_fact_provenance (id,fact_id,source_type,source_id,document_id,document_version_id,original_text,extraction_method,confidence) VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id("provenance"), labelFactId, type.labelSource, doc.intake_version_id, doc.document_id, doc.document_version_id, type.label, type.labelSource, type.labelSource.startsWith("Deterministic") ? 90 : 70));

  summary.push({ type: type.label, entityId, nativeLoops, labelSource: type.labelSource, status: "created" });
}

raw.exec("BEGIN IMMEDIATE");
try { for (const s of statements) s(); raw.exec("COMMIT"); } catch (e) { raw.exec("ROLLBACK"); throw e; }

console.log(JSON.stringify(summary, null, 2));
