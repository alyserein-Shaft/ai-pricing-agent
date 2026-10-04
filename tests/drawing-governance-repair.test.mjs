import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { handleDrawingMetadataReviewApi } from "../worker/drawing-metadata-review-api.mjs";
import { handleDrawingQuantityEvidenceApi } from "../worker/drawing-quantity-evidence-api.mjs";
import { buildOccurrenceEvidenceFromAssets } from "../app/domain/drawing-occurrence-evidence.mjs";
import { extractDrawingNumberFromCompositeText, extractGovernedDrawingNumber, normalizeDrawingNumberToken, parseDrawingNumberFromTranscription } from "../app/domain/drawing-title-block-metadata.mjs";

const PROJECT = "project_p";
const DOCUMENT = "doc_1";
const HUMAN = { APP_HUMAN_ID: "omair", APP_HUMAN_NAME: "Omair", APP_HUMAN_EMAIL: "Omair@almespar.com" };

// Recording DB double: proves a refused call performed no mutation.
const recorderFor = () => ({ writes: [] });
const fakeDb = (recorder, { intake = { id: "iv_1", status: "Completed", superseded_at: null } } = {}) => {
  const state = {
    intake,
    metadata: { id: "md_1", drawing_number: "", review_status: "Needs Review", extraction_method: "Explicit title-block labels only" },
    currentVersionId: "ver_1",
  };
  const handle = (sql, binds = []) => ({
    sql,
    binds,
    bind: (...args) => handle(sql, [...binds, ...args]),
    first: async () => {
      if (/FROM documents d JOIN projects p/.test(sql)) return { id: DOCUMENT, project_id: PROJECT, current_version_id: state.currentVersionId, logical_name: "2401232-PC-AMS-DR-T-00-ZZZ-002 (1).pdf" };
      if (/FROM drawing_intake_versions WHERE document_id/.test(sql)) return state.intake;
      if (/FROM drawing_metadata WHERE intake_version_id/.test(sql)) return state.metadata;
      return null;
    },
    all: async () => ({ results: [] }),
    run: async () => {
      recorder.writes.push({ sql, binds });
      // The double applies metadata updates so a read-back reflects the write.
      if (/UPDATE drawing_metadata SET drawing_number/.test(sql) && binds.length) state.metadata = { ...state.metadata, drawing_number: binds[0], review_status: "Approved" };
      return { success: true };
    },
  });
  return {
    state,
    prepare: (sql) => handle(sql),
    batch: async (statements) => {
      for (const statement of statements || []) {
        recorder.writes.push({ sql: statement.sql, binds: statement.binds });
        if (/UPDATE drawing_metadata SET drawing_number/.test(statement.sql) && statement.binds?.length) {
          state.metadata = { ...state.metadata, drawing_number: statement.binds[0], review_status: "Approved" };
        }
      }
      return recorder.writes;
    },
  };
};

const envFor = (db) => ({
  DB: db,
  APP_ACCESS_MODE: "single-user",
  APP_USER_ID: "local-development-user",
  APP_ORGANIZATION_ID: "org_1",
  ...HUMAN,
});

const confirmRequest = (body) => new Request(`http://localhost:4183/api/documents/${DOCUMENT}/drawing-metadata/drawing-number`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ reason: "Title-block evidence reviewed and confirmed by the human reviewer.", ...body }),
});

test("1. a bare drawing number is refused: a filename is not evidence", async () => {
  const recorder = recorderFor();
  const response = await handleDrawingMetadataReviewApi(
    confirmRequest({ drawingNumber: "2401232-PC-AMS-DR-T-00-ZZZ-002" }),
    envFor(fakeDb(recorder)),
  );
  assert.equal(response.status, 422);
  assert.equal((await response.json()).error.code, "DRAWING_NUMBER_EVIDENCE_REQUIRED");
  assert.equal(recorder.writes.length, 0, "no metadata may change without provenance");
});

test("2. title-block evidence populates the governed drawing number under the human actor", async () => {
  const recorder = recorderFor();
  const db = fakeDb(recorder);
  const response = await handleDrawingMetadataReviewApi(
    confirmRequest({
      drawingNumber: "2401232-PC-AMS-DR-T-00-ZZZ-002",
      transcriptionDigest: "a".repeat(64),
      cropArtifact: "out/titleblock-vision/crops/ams.png",
      extractionMethod: "TITLE_BLOCK_CROP_VISION_TRANSCRIPTION",
    }),
    envFor(db),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.drawingNumber, "2401232-PC-AMS-DR-T-00-ZZZ-002");
  assert.equal(body.decidedBy, "omair");
  assert.equal(db.state.metadata.review_status !== "Needs Review", true);
  const audit = recorder.writes.find((write) => /INSERT INTO drawing_intake_audit_events/.test(write.sql));
  assert.ok(audit, "the provenance must be audited");
  assert.ok(audit.binds.includes("omair"), "the human, not the synthetic user, decided");
  assert.ok(!JSON.stringify(audit.binds).includes("local-development-user"));
});

test("3. a stale document version cannot bind metadata to the current drawing", async () => {
  const recorder = recorderFor();
  const db = fakeDb(recorder);
  const response = await handleDrawingMetadataReviewApi(
    confirmRequest({ drawingNumber: "2401232-PC-AMS-DR-T-00-ZZZ-002", transcriptionDigest: "b".repeat(64), documentVersionId: "ver_superseded" }),
    envFor(db),
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, "STALE_DOCUMENT_VERSION_REFUSED");
  assert.equal(recorder.writes.length, 0);
});

test("3b. no human identity configured means the governed write is refused", async () => {
  const recorder = recorderFor();
  const env = { ...envFor(fakeDb(recorder)), ...HUMAN, APP_HUMAN_ID: "", APP_HUMAN_NAME: "" };
  const response = await handleDrawingMetadataReviewApi(confirmRequest({ drawingNumber: "2401232-PC-AMS-DR-T-00-ZZZ-002", transcriptionDigest: "c".repeat(64) }), env);
  assert.equal(response.status, 403);
  assert.equal(recorder.writes.length, 0);
});

test("4. the architecture review route is mounted in the worker entrypoint", () => {
  const source = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  for (const handler of ["handleDrawingArchitectureReviewApi", "handleDrawingQuantityEvidenceApi", "handleDrawingMetadataReviewApi"]) {
    assert.ok(source.includes(`import { ${handler} }`), `${handler} must be imported`);
    assert.ok(source.includes(`await ${handler}(request, env)`), `${handler} must be dispatched`);
  }
});

test("5. an explicit DWG NO reference never yields the sheet's own drawing number", () => {
  // Same run: a note that REFERENCES another sheet.
  const assets = [
    { id: "a1", text_content: "1. FOR ELV LEGENDS, GENERAL NOTES & ABBREVIATIONS REFER", bounding_box: JSON.stringify({ x: 538, y: 3061, width: 300, height: 8 }) },
    { id: "a2", text_content: "DWG NO. 2401232-PC-AMS-T-00-ZZZ-002", bounding_box: JSON.stringify({ x: 547, y: 3069, width: 200, height: 8 }) },
  ];
  const result = extractGovernedDrawingNumber({ assets, pageNumber: 1 });
  assert.equal(result.ok, false, "a referenced number is not this sheet's number");
  assert.equal(result.reason, "ONLY_CROSS_SHEET_REFERENCE_NUMBER");

  // A transcription of the same reference sentence is rejected too.
  assert.equal(parseDrawingNumberFromTranscription("REFER DWG NO. 2401232-PC-AMS-T-00-ZZZ-002").ok, false);
  // The real title block value is accepted, with the revision column excluded.
  const real = parseDrawingNumberFromTranscription("DRAWING NUMBER        REVISION\n2401232- PC- AMS- DR- T-00-ZZZ-002        1");
  assert.equal(real.ok, true);
  assert.equal(real.drawingNumber, "2401232-PC-AMS-DR-T-00-ZZZ-002");
});

test("5b. a filename-shaped token is not accepted as a drawing number value", () => {
  // Structured but not a drawing number: no digits, or too few segments.
  assert.equal(normalizeDrawingNumberToken("SOURCE FILE"), null);
  assert.equal(normalizeDrawingNumberToken("ELV LEGENDS"), null);
  assert.equal(normalizeDrawingNumberToken("2401232-PC-AMS-DR-T-00-ZZZ-002"), "2401232-PC-AMS-DR-T-00-ZZZ-002");
});

const asset = (id, text, x, y, w = 6, h = 8) => ({ id, text_content: text, bounding_box: JSON.stringify({ x, y, width: w, height: h }), page_id: "pg_1", intake_version_id: "iv_1" });

test("6. a governed legend symbol inside a governed legend region is never a field occurrence", () => {
  const assets = [
    asset("sym_t", "T", 777, 967),
    asset("desc", "FIREMAN TELEPHONE JACK", 776, 1032, 120, 8),
    asset("title", "SHEET TITLE", 2900, 2250, 80, 8),
  ];
  const location = { projectId: PROJECT, documentId: DOCUMENT, documentVersionId: "ver_1", sheet: "LEGEND" };
  // Without the governed region the definition is indistinguishable from a device
  // (this is exactly the defect being fixed).
  const unguarded = buildOccurrenceEvidenceFromAssets({ assets, allTexts: assets, location, resolution: { applicable: false } });
  assert.equal(unguarded.accepted.length, 1, "baseline: the delimiter heuristic misses the delimiter-free legend");

  const guarded = buildOccurrenceEvidenceFromAssets({
    assets,
    allTexts: assets,
    location,
    resolution: { applicable: true, authority: "SAME_DOCUMENT_LEGEND" },
    governedLegendRegions: [{ boundingBox: { x: 500, y: 900, width: 700, height: 200 }, source: "structural:table:legend" }],
  });
  assert.equal(guarded.accepted.length, 0, "a governed legend definition is not a device");
  assert.equal(guarded.excludedNonPhysical.some((entry) => entry.assetId === "sym_t" && entry.reason === "GOVERNED_LEGEND_REGION"), true);
});

test("6b. governed legend membership excludes the symbol even outside any region box", () => {
  // The occurrence engine is token-specific, so the governed symbol here is the
  // same token the engine detects; membership must exclude it wherever it sits.
  const assets = [asset("sym_x", "T", 100, 100), asset("other", "T", 900, 900)];
  const guarded = buildOccurrenceEvidenceFromAssets({
    assets,
    allTexts: assets,
    location: { projectId: PROJECT, documentId: DOCUMENT, documentVersionId: "ver_1", sheet: "SHEET" },
    resolution: { applicable: false },
    governedLegendSymbols: [{ assetId: "sym_x", token: "T" }],
  });
  assert.deepEqual(guarded.accepted.map((entry) => entry.source_object_ids[0]), ["other"], "field occurrences stay intact");
  assert.equal(guarded.excludedNonPhysical.some((entry) => entry.assetId === "sym_x"), true);
});

test("7. field occurrences are untouched when no legend region applies", () => {
  const assets = [asset("t1", "T", 1406, 2114), asset("t2", "T", 1500, 2200), asset("note", "2 Nos", 1400, 2122)];
  const result = buildOccurrenceEvidenceFromAssets({
    assets,
    allTexts: assets,
    location: { projectId: PROJECT, documentId: "doc_field", documentVersionId: "ver_1", sheet: "WLC T-93" },
    resolution: { applicable: true, authority: "EXPLICIT_CROSS_SHEET_LEGEND_REFERENCE", provenance: [{ kind: "LEGEND_FOR" }] },
    governedLegendRegions: [{ boundingBox: { x: 0, y: 0, width: 10, height: 10 }, source: "unrelated" }],
  });
  assert.equal(result.accepted.length, 2, "both field symbols remain occurrences");
  assert.equal(result.accepted.every((entry) => entry.identity_authority === "EXPLICIT_CROSS_SHEET_LEGEND_REFERENCE"), true);
});

test("8. occurrence evidence carries no quantity authority and leaves printed multiplicity ambiguous", () => {
  const assets = [asset("t1", "T", 1406, 2114), asset("nos", "2 Nos", 1400, 2100, 30, 8), asset("note", "1 PAIR TELEPHONE CABLE FOR EACH FIREMAN TELEPHONE JACK", 1534, 1141, 300, 8)];
  const result = buildOccurrenceEvidenceFromAssets({
    assets,
    allTexts: assets,
    location: { projectId: PROJECT, documentId: "doc_wlc", documentVersionId: "ver_1", sheet: "WLC T-93" },
    resolution: { applicable: true, authority: "EXPLICIT_CROSS_SHEET_LEGEND_REFERENCE" },
  });
  const serialized = JSON.stringify(result);
  assert.ok(!/"quantity"\s*:/.test(serialized), "no quantity field may be produced");
  assert.ok(!/\b6\s*[*x×]\s*2\b/.test(serialized), "printed multiplicity must never be multiplied out");
  assert.equal(result.accepted.length, 1);
});

test("9. the quantity evidence route is read-only: a mutating call is refused and writes nothing", async () => {
  const recorder = recorderFor();
  const db = fakeDb(recorder);
  const post = new Request(`http://localhost:4183/api/documents/${DOCUMENT}/drawing-quantity-evidence`, { method: "POST", body: "{}" });
  const response = await handleDrawingQuantityEvidenceApi(post, { DB: db, ...HUMAN, APP_ACCESS_MODE: "single-user", APP_USER_ID: "local-development-user", APP_ORGANIZATION_ID: "org_1" });
  assert.ok(response === null || response.status >= 400, "a POST must not be served as a governed quantity write");
  assert.equal(recorder.writes.length, 0, "quantity claims created = 0");
});

// The flattened-title-block blob shape measured on the current sheets: it carries
// the sheet's own drawing number, a bracketed SOURCE FILE filename, AND a
// cross-sheet "DWG NO." reference, all in one run.
const GRS_BLOB = "O R O R O R F S H F CE ... FIREMAN TELPHONE ... 1No. 17Nos. 3Nos. STAIR 2Nos. H 1No. 65Nos. 41Nos. S HC 8Nos. 5Nos. T T T T T STAIR ... DRAWING NUMBER REVISION SHEET TITLE STAGE SCALE PROJECT NUMBER PHASE PROJECT TITLE CLIENT DATE BUILDING ASSET CODE SOURCE FILE DRAWN CHECKED APPROVED N.T.S@A0 6/21/2026 5:12:07 PM 1 2401232 ALMOOSA K12 QUALITY CARE EDUCATION COMPANY 2401232- PC- GRS- DR- T-93-ZZZ-005 FIRE DETECTION & ALARM SCHEMATIC 5 1 GRS APRIL 2025 <2401232-PC-GRS-M3-E-ZZ-ZZZ-001 > MH KV AM SCALE -N.T.S";

test("11. a flattened title block yields its OWN drawing number, not the filename and not a reference", () => {
  const result = extractDrawingNumberFromCompositeText(GRS_BLOB);
  assert.equal(result.ok, true);
  assert.equal(result.drawingNumber, "2401232-PC-GRS-DR-T-93-ZZZ-005");
  // The two traps on this exact blob:
  assert.ok(!result.drawingNumber.includes("M3-E-ZZ-ZZZ"), "a bracketed SOURCE FILE filename is never authority");
  assert.notEqual(result.drawingNumber, "2401232-PC-AMS-T-00-ZZZ-002");
});

test("12. a composite run never absorbs the sheet title printed next to the number", () => {
  // The title is glued to the number with no separator, so no boundary exists.
  // Failing closed is the correct outcome; absorbing the title never is.
  const result = extractDrawingNumberFromCompositeText("DRAWING NUMBER REVISION SHEET TITLE 2401232-PC-BOS-DR-T-93-ZZZ-005FIREDETECTION&ALARMSCHEMATIC");
  if (result.ok) assert.ok(!/FIRE|ALARM/.test(result.drawingNumber), "a sheet title must never be absorbed into a drawing number");
  else assert.equal(result.reason, "NO_DRAWING_NUMBER_VALUE");
  // With a real separator the number is still recovered exactly.
  const clean = extractDrawingNumberFromCompositeText("DRAWING NUMBER REVISION SHEET TITLE 2401232-PC-BOS-DR-T-93-ZZZ-005 FIRE DETECTION & ALARM SCHEMATIC");
  assert.equal(clean.ok, true);
  assert.equal(clean.drawingNumber, "2401232-PC-BOS-DR-T-93-ZZZ-005");
});

test("13. a bare DWG NO. run that continues a reference sentence is not an own number", () => {
  const assets = [
    { id: "n1", text_content: "1. FOR ELV LEGENDS, GENERAL NOTES & ABBREVIATIONS REFER", bounding_box: null },
    { id: "n2", text_content: "DWG NO. 2401232-PC-AMS-T-00-ZZZ-002", bounding_box: null },
  ];
  const result = extractGovernedDrawingNumber({ assets, pageNumber: 1 });
  assert.equal(result.ok, false);
  assert.ok(["ONLY_CROSS_SHEET_REFERENCE_NUMBER", "NO_DRAWING_NUMBER_LABEL"].includes(result.reason));
});

test("14. the composite rule reproduces the sheet's own number where a reference also exists", () => {
  // Real ordering seen on the current sheets: the reference first, then the
  // title block's own DRAWING NUMBER label and value.
  const text = "1. FOR ELV LEGENDS REFER DWG NO. 2401232-PC-AMS-T-00-ZZZ-002 DRAWING NUMBER REVISION SHEET TITLE 2401232-PC-KGS-DR-T-93-ZZZ-005 FIRE DETECTION & ALARM SCHEMATIC";
  const result = extractDrawingNumberFromCompositeText(text);
  assert.equal(result.ok, true);
  assert.equal(result.drawingNumber, "2401232-PC-KGS-DR-T-93-ZZZ-005");
});
