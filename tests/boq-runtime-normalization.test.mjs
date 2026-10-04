// CLEAN_GOLDEN_BOQ_RUNTIME_NORMALIZATION -- regression suite.
//
// The live intake path must derive review candidates from uploaded workbook
// bytes through extractBoqBytes + normalizeBoqRows. The hand-authored
// frontend fixture survives ONLY as the expected-output oracle below
// (tests/fixtures/clean-golden-boq-oracle.mjs) plus the recorded workbook
// bytes (tests/fixtures/boq-golden-workbook.xlsx, SHA-256 e7d9e3d1…).
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { zipSync, strToU8 } from "fflate";
import { extractBoqBytes, normalizeBoqRows, BOQ_NORMALIZATION_VERSION } from "../app/domain/boq-extractor.mjs";
import { handleBoqExtractionApi } from "../worker/boq-extraction-api.mjs";
import { CLEAN_GOLDEN_BOQ_ORACLE, CLEAN_GOLDEN_DISPLAY_VARIANCES } from "./fixtures/clean-golden-boq-oracle.mjs";

const GOLDEN_XLSX = new URL("./fixtures/boq-golden-workbook.xlsx", import.meta.url);
const GOLDEN_SHA256 = "e7d9e3d15eab9b143a339f21f26dca51e9436fecb904779d4f4de5fa8eb7a82c";

const goldenBytes = async () => new Uint8Array(await readFile(GOLDEN_XLSX));
const goldenExtraction = async () => extractBoqBytes(await goldenBytes(), { extension: "xlsx", fileName: "BOQ.xlsx" });

// §7 oracle: recorded bytes -> runtime extraction -> runtime normalization.
test("oracle: golden workbook bytes derive 21 candidates matching the fixture oracle", async () => {
  const extraction = await goldenExtraction();
  const items = extraction.rows.filter((row) => row.rowType === "BOQ Item");
  const structural = extraction.rows.filter((row) => row.rowType !== "BOQ Item");
  assert.equal(extraction.rows.length, 108, "raw content rows come from bytes, never hardcoded");
  assert.equal(items.length, 90, "item rows come from bytes, never hardcoded");
  assert.equal(structural.length, 18, "structural rows come from bytes, never hardcoded");
  const candidates = normalizeBoqRows(items);
  assert.equal(candidates.length, 21, "runtime grouping derives exactly 21 candidates");
  const anchors = candidates.flatMap((entry) => entry.sourceRows);
  assert.equal(anchors.length, 90, "90/90 source rows reconciled");
  assert.equal(new Set(anchors).size, 90, "0 duplicate anchors");
  assert.ok(candidates.every((entry) => entry.sourceRows.length > 0), "0 unanchored rows");
  assert.equal(candidates.length, CLEAN_GOLDEN_BOQ_ORACLE.length);
  const varianceByOracle = new Map(CLEAN_GOLDEN_DISPLAY_VARIANCES.map((entry) => [entry.oracle, entry.sourceTrue]));
  candidates.forEach((candidate, index) => {
    const expected = CLEAN_GOLDEN_BOQ_ORACLE[index];
    assert.deepEqual(candidate.sourceRows, [...expected.sourceRows], `group ${index + 1} anchors must match the oracle`);
    assert.equal(candidate.qty, expected.qty, `group ${index + 1} quantity must match the oracle`);
    assert.equal(candidate.unit, expected.unit, `group ${index + 1} unit must match the oracle`);
    const allowed = varianceByOracle.get(expected.description);
    if (allowed) assert.equal(candidate.item, allowed, `group ${index + 1} carries source-true display text (documented oracle variance)`);
    else assert.equal(candidate.item, expected.description, `group ${index + 1} description must match the oracle`);
  });
});

// §5 endpoint: document bytes -> HTTP preview payload with version binding.
test("endpoint: normalize-preview returns runtime candidates bound to the file version", async () => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`
    CREATE TABLE processing_logs (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_versions (id TEXT PRIMARY KEY, document_id TEXT, document_version_id TEXT, version_number INTEGER, status TEXT, superseded_at TEXT);
    CREATE TABLE boq_extraction_sources (id TEXT PRIMARY KEY);
    CREATE TABLE boq_sections (id TEXT PRIMARY KEY);
    CREATE TABLE boq_items (id TEXT PRIMARY KEY, extraction_version_id TEXT, review_status TEXT, source_location TEXT, row_type TEXT);
    CREATE TABLE boq_extraction_evidence (id TEXT PRIMARY KEY);
    CREATE TABLE boq_extraction_warnings (id TEXT PRIMARY KEY);
    CREATE TABLE boq_review_decisions (id TEXT PRIMARY KEY);
    CREATE TABLE boq_revision_comparisons (id TEXT PRIMARY KEY);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT, owner_user_id TEXT, archived_at TEXT);
    CREATE TABLE documents (id TEXT PRIMARY KEY, project_id TEXT, document_type TEXT, classification_source TEXT, current_version_id TEXT, deleted_at TEXT, archived_at TEXT);
    CREATE TABLE document_versions (id TEXT PRIMARY KEY, document_id TEXT, original_filename TEXT, extension TEXT, object_key TEXT, revision TEXT, sha256 TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_supersessions (id TEXT PRIMARY KEY, superseding_version_id TEXT, superseded_version_id TEXT, effective_from TEXT, effective_to TEXT);
    CREATE TABLE document_classifications (id TEXT PRIMARY KEY, document_id TEXT, primary_type TEXT, status TEXT, manual_review_required INTEGER, error_code TEXT, superseded_at TEXT, classified_at TEXT);
  `);
  raw.prepare("INSERT INTO projects VALUES (?,?,?,?)").run("proj-1", "P", "local-development-user", null);
  raw.prepare("INSERT INTO documents VALUES (?,?,?,?,?,?,?)").run("doc-1", "proj-1", null, null, "ver-1", null, null);
  raw.prepare("INSERT INTO document_versions VALUES (?,?,?,?,?,?,?,?,?)").run("ver-1", "doc-1", "BOQ.xlsx", "xlsx", "obj-1", null, GOLDEN_SHA256, null, null);
  raw.prepare("INSERT INTO boq_extraction_versions VALUES (?,?,?,?,?,?)").run("verx-1", "doc-1", "ver-1", 1, "Needs Review", null);
  const bytes = await goldenBytes();
  const operation = (sql, args = []) => {
    const statement = raw.prepare(sql);
    return {
      first: async () => { const row = statement.get(...args); return row === undefined ? null : row; },
      all: async () => ({ results: statement.all(...args) }),
      run: async () => ({ meta: statement.run(...args) }),
    };
  };
  const env = {
    DB: { prepare: (sql) => ({ bind: (...args) => operation(sql, args) }), batch: async (statements) => { for (const s of statements) await s.run(); } },
    FILES: { get: async (key) => key === "obj-1" ? { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } : null },
  };
  const response = await handleBoqExtractionApi(new Request("http://localhost/api/documents/doc-1/boq-extraction/normalize-preview", { method: "GET" }), env);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.documentId, "doc-1");
  assert.equal(body.versionId, "ver-1");
  assert.equal(body.sha256, GOLDEN_SHA256, "candidates are bound to the file version fingerprint");
  assert.equal(body.normalizationVersion, BOQ_NORMALIZATION_VERSION);
  assert.deepEqual(body.counts, { contentRows: 108, itemRows: 90, structuralRows: 18, candidates: 21 });
  assert.equal(body.candidates.length, 21);
  assert.ok(body.candidates.every((entry) => entry.sourceRows.length > 0));
  const totalAnchors = body.candidates.flatMap((entry) => entry.sourceRows);
  assert.equal(new Set(totalAnchors).size, 90, "endpoint output carries 90 unique anchors");
  assert.equal(body.extractionVersionId, "verx-1", "member resolution binds to the current extraction version");
  assert.ok(body.candidates.every((entry) => entry.unresolvedAnchors.length === entry.sourceRows.length), "no persisted rows exist here, so every anchor is honestly unresolved");
  raw.close();
});

// §8 negative: the live intake path must not reference the frontend fixture.
test("negative: intake/upload/apply/modal code never reads initialItems", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const markers = ["boqRuntimeCandidates", "normalize-preview", "applyKnownBoqExtraction", "visibleBoqCandidates", "anchorIntegrity", "boqLineDecisions", "openBoqRuntimeCandidates"];
  for (const line of page.split("\n")) {
    if (!line.includes("initialItems")) continue;
    for (const marker of markers) {
      assert.ok(!line.includes(marker), `fixture line must not participate in intake flow: ${line.trim().slice(0, 120)}`);
    }
  }
});

// §9 generalization: a synthetic workbook with different content yields
// different runtime candidates through the same code -- no hash/filename
// special case anywhere in the normalizer or endpoint.
const syntheticWorkbook = () => {
  const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cell = (ref, value) => typeof value === "number"
    ? `<c r="${ref}"><v>${value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
  const row = (n, values) => `<row r="${n}">${values.map((v, i) => cell(`${String.fromCharCode(65 + i)}${n}`, v)).join("")}</row>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${row(1, ["Ref", "Description", "Unit", "Qty"])}${row(2, ["A1", "Chilled water pump 5HP", "No", 2])}${row(3, ["A2", "Chilled water pump 5HP", "No", 3])}${row(4, ["B1", "Control valve DN50", "No", 7])}</sheetData></worksheet>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SYNTH" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
};

test("generalization: synthetic bytes produce different candidates via the same normalizer", async () => {
  const extraction = extractBoqBytes(new Uint8Array(syntheticWorkbook()), { extension: "xlsx", fileName: "SYNTH.xlsx" });
  const items = extraction.rows.filter((row) => row.rowType === "BOQ Item");
  assert.ok(items.length >= 3, "synthetic rows must parse as items");
  const candidates = normalizeBoqRows(items);
  assert.equal(candidates.length, 2, "two distinct descriptions collapse to two candidates");
  const pumps = candidates.find((entry) => /pump/i.test(entry.item));
  assert.equal(pumps.qty, 5, "repeated pump rows SUM (2+3)");
  assert.deepEqual(pumps.sourceRows, [2, 3]);
  assert.ok(!JSON.stringify(candidates).includes("e7d9e3d1"), "no golden hash anywhere in the normalization path");
});

// BOQ_RUNTIME_GROUPING_BOUNDARY_FIX -- hard system boundary + scoped synonym.
const systemWorkbook = () => {
  const esc = (value) => String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const cell = (ref, value) => typeof value === "number"
    ? `<c r="${ref}"><v>${value}</v></c>`
    : `<c r="${ref}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`;
  const row = (n, values) => `<row r="${n}">${values.map((v, i) => cell(`${String.fromCharCode(65 + i)}${n}`, v)).join("")}</row>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${row(1, ["Ref", "Description", "Unit", "Qty", "System"])}${row(2, ["A1", "Smoke detector test", "No", 5, "Fire Alarm"])}${row(3, ["A2", "Smoke detector test", "No", 7, "Fire Alarm"])}${row(4, ["B1", "Smoke detector test", "No", 3, "Electrical"])}${row(5, ["C1", "Motion sensor alpha", "No", 2, "Electrical"])}${row(6, ["C2", "Motion detector alpha", "No", 4, "Electrical"])}</sheetData></worksheet>`;
  return zipSync({
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SYS" sheetId="1" r:id="rId1"/></sheets></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });
};

test("boundary: same description+unit across different known systems never merges", async () => {
  const extraction = extractBoqBytes(new Uint8Array(systemWorkbook()), { extension: "xlsx", fileName: "SYS.xlsx" });
  const items = extraction.rows.filter((row) => row.rowType === "BOQ Item");
  assert.ok(items.every((row) => row.system?.explicitlyStated === true), "System column must yield explicit systems");
  const candidates = normalizeBoqRows(items);
  const smoke = candidates.filter((entry) => /smoke detector test/i.test(entry.item));
  assert.equal(smoke.length, 2, "Fire Alarm and Electrical rows with identical description+unit stay separate");
  const fa = smoke.find((entry) => entry.systems.includes("Fire Alarm"));
  const el = smoke.find((entry) => entry.systems.includes("Electrical"));
  assert.deepEqual(fa.sourceRows, [2, 3]);
  assert.equal(fa.qty, 12);
  assert.deepEqual(el.sourceRows, [4]);
  assert.equal(el.qty, 3);
  assert.equal(fa.systemConflict, false);
  assert.equal(el.systemConflict, false);
});

test("boundary: sensor/detector synonym cannot collapse cross-system rows", async () => {
  const extraction = extractBoqBytes(new Uint8Array(systemWorkbook()), { extension: "xlsx", fileName: "SYS.xlsx" });
  const items = extraction.rows.filter((row) => row.rowType === "BOQ Item");
  const candidates = normalizeBoqRows(items);
  const motion = candidates.filter((entry) => /motion (sensor|detector) alpha/i.test(entry.item));
  assert.equal(motion.length, 2, "Motion sensor vs Motion detector outside fire alarm must stay separate");
  assert.equal(candidates.length, 4, "2 smoke groups + sensor + detector, nothing else merged");
});
