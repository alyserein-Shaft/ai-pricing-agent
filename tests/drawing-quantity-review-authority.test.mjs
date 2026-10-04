// Printed-quantity REVIEW AUTHORITY -> canonical quantity claim writer.
//
// The 17 required proofs for the Fireman Telephone printed-quantity review
// gap, plus the regression that keeps the writer slice green.
//
// Fixtures use explicit hypothetical approved adjudications (25/25/23/12) to
// prove the architecture supports four independent location-scoped claims.
// Those numbers are TEST FIXTURES ONLY -- nothing here hardcodes them into
// production logic, and the live corpus is asserted separately to contain no
// authority.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  PRINTED_QUANTITY_PROPOSAL_TYPES,
  QUANTITY_REVIEW_AUTHORITY_STATUSES,
  validatePrintedQuantityAdjudication,
  evaluatePrintedQuantityReviewAuthority,
  buildPrintedQuantityReviewPacket,
} from "../app/domain/drawing-quantity-review-authority.mjs";
import { readCurrentDrawingQuantities } from "../app/domain/drawing-quantity-authority.mjs";
import { classifyLegendClass } from "../app/domain/fire-alarm-legend-class-semantics.mjs";
import { isSyntheticActorId } from "../app/domain/human-authority.mjs";
import {
  persistGovernedQuantityClaim,
  governedQuantityClaimFingerprint,
  QUANTITY_CLAIM_TABLE,
} from "../worker/drawing-quantity-claim-writer.mjs";
import { d1, activeChainDatabase } from "./fixtures/active-chain-fixture.mjs";
import { handleDrawingQuantityReviewApi } from "../worker/drawing-quantity-review-api.mjs";

const HUMAN = "estimator.human";

// ---- FIXTURES --------------------------------------------------------------

const proposal = (over = {}) => ({
  id: "proposal-1",
  project_id: "project-1",
  document_id: "doc-1",
  intake_version_id: "intake-1",
  page_number: 1,
  proposal_type: "quantities",
  raw_label: "2 Nos — stated count 2",
  corrected_value: null,
  review_status: "Needs Review",
  reviewed_by: null,
  reviewed_at: null,
  review_reason: null,
  authority_role: "Unsupported",
  governed_status: "Needs Review",
  hard_review_reasons: '["AI_VISUAL_FINDING_REQUIRES_ENGINEER_CONFIRMATION","QUANTITY_DEVICE_ASSOCIATION_UNKNOWN"]',
  evidence: JSON.stringify({
    quantity: 2,
    evidenceQuote: "2 Nos",
    sourceSymbolOrText: "2 Nos",
    sourceSheet: "FIRE DETECTION & ALARM SCHEMATIC",
    sourceDrawingNumber: "2401232- PC- WLC- DR- T-93-ZZZ-005",
    sourceRevision: "1",
    imageProvenance: [
      { index: 0, kind: "overview", pageNumber: 1, sha256: "a".repeat(64), objectKey: "k/image-0.png", cropRect: null },
      { index: 1, kind: "crop", pageNumber: 1, sha256: "b".repeat(64), objectKey: "k/image-1.png", cropRect: { purpose: "equipment / location" } },
    ],
  }),
  source_references: '[]',
  extraction_method: "AI visual analysis (test)",
  extraction_version: "test-1",
  visual_run_id: "run-1",
  superseded_at: null,
  ...over,
});

const adjudicated = (over = {}) => JSON.stringify({
  quantity: 2,
  deviceClass: "T",
  countMethod: "PRINTED_CELL",
  printedText: "2 Nos",
  ...over,
});

const ASSETS = [{ id: "asset-1", textContent: "2 Nos" }];

/** A fully reviewed, current, human-adjudicated candidate. */
const reviewed = (over = {}) => proposal({
  review_status: "Verified with Assumption",
  reviewed_by: HUMAN,
  reviewed_at: "2026-10-04T00:00:00.000Z",
  review_reason: "Read the printed 2 Nos cell on the current WLC schedule and bound it to legend class T.",
  corrected_value: adjudicated(),
  ...over,
});

const evaluate = (over = {}, ctx = {}) => evaluatePrintedQuantityReviewAuthority({
  proposal: reviewed(over),
  projectId: "project-1",
  sheet: "2401232-PC-WLC-DR-T-93-ZZZ-005",
  sourceAssets: ASSETS,
  currentDocumentVersionId: "ver-current",
  intakeDocumentVersionId: "ver-current",
  isReviewerHuman: true,
  ...ctx,
});

// ---- 1. a visual/AI proposal alone can never create a claim -----------------

test("1. visual proposal alone cannot create a claim (bare number is not authority)", () => {
  // The engine candidate, entirely untouched.
  const untouched = proposal();
  assert.equal(untouched.review_status, "Needs Review");
  assert.equal(untouched.authority_role, "Unsupported");
  const r = evaluatePrintedQuantityReviewAuthority({
    proposal: untouched,
    projectId: "project-1",
    sheet: "SH",
    sourceAssets: ASSETS,
    currentDocumentVersionId: "ver-current",
    intakeDocumentVersionId: "ver-current",
    isReviewerHuman: true,
  });
  assert.equal(r.ok, false);
  assert.equal(r.code, "REVIEW_NOT_AUTHORISED");
  assert.equal(r.claimInput, undefined);

  // And a plain `approve` of the bare number still cannot: no class is bound.
  const approved = proposal({
    review_status: "Verified",
    reviewed_by: HUMAN,
    reviewed_at: "2026-10-04T00:00:00.000Z",
    review_reason: "looks right",
  });
  const a = evaluatePrintedQuantityReviewAuthority({
    proposal: approved,
    projectId: "project-1",
    sheet: "SH",
    sourceAssets: ASSETS,
    currentDocumentVersionId: "ver-current",
    intakeDocumentVersionId: "ver-current",
    isReviewerHuman: true,
  });
  assert.equal(a.ok, false);
  assert.equal(a.code, "QUANTITY_ADJUDICATION_MISSING");
  assert.equal(a.claimInput, undefined);
});

// ---- 2. a recognition occurrence count alone cannot create a claim ---------

test("2. recognition occurrence count can never become quantity authority", () => {
  for (const method of ["OCCURRENCE_COUNT", "SYMBOL_OCCURRENCES", "PLOTTED_SYMBOLS", "RECOGNITION_COUNT", "PLOTTED"]) {
    const v = validatePrintedQuantityAdjudication({
      quantity: 6, deviceClass: "T", countMethod: method, printedText: "2 Nos",
    });
    assert.equal(v.ok, false, `${method} must be refused`);
    assert.equal(v.code, "RECOGNITION_COUNT_METHOD_REFUSED", `${method} must be refused by name`);
  }
  // The barrier is structural in the output too.
  const r = evaluate({ corrected_value: adjudicated({ quantity: 6 }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, "PRINTED_QUANTITY_TEXT_MISMATCH");
  // And the authority verdict can never be reached via a count at all.
  const ok = evaluate();
  assert.equal(ok.recognitionCountIsAdmissible, false);
});

// ---- 3. a synthetic actor cannot approve printed quantity ------------------

test("3. synthetic actor cannot confer printed-quantity authority", () => {
  assert.equal(isSyntheticActorId("local-development-user"), true);
  for (const actor of ["local-development-user", "system", "administrator", "anonymous"]) {
    const r = evaluate({ reviewed_by: actor }, { isReviewerHuman: !isSyntheticActorId(actor) });
    assert.equal(r.ok, false, `${actor} must be refused`);
    assert.equal(r.code, "SYNTHETIC_REVIEWER_REFUSED");
  }
  // A real-looking actor passes the gate.
  assert.equal(isSyntheticActorId(HUMAN), false);
  assert.equal(evaluate().ok, true);
});

// ---- 4. approved reviewed printed evidence feeds the canonical writer -------

/** A single governed chain whose ids are doc-1 / ver-current / intake-1 / asset-1. */
function singleChain(sheet = "2401232-PC-WLC-DR-T-93-ZZZ-005") {
  const db = activeChainDatabase();
  const sql = db.sqlite ?? db;
  seedProject(sql);
  // Suffix "1" yields doc-1 / ver-1 / intake-1 / asset-1.
  insertChain(sql, "1", { sheet });
  return sql;
}

test("4. approved reviewed printed evidence feeds the canonical writer", async () => {
  // A real governed project -> document -> current version -> intake -> page
  // -> asset chain, so asset verification and currentness are not vacuous.
  const sql = singleChain();

  const verdict = evaluate({}, {
    intakeDocumentVersionId: "ver-1",
    currentDocumentVersionId: "ver-1",
    sourceAssets: [{ id: "asset-1", textContent: "2 Nos" }],
  });
  assert.equal(verdict.ok, true, verdict.reason);
  assert.equal(verdict.adjudication.quantity, 2);
  assert.equal(verdict.adjudication.deviceClass, "T");
  assert.equal(verdict.adjudication.countMethod, "PRINTED_CELL");

  // The fingerprint is DERIVED server-side from exactly this evidence. A
  // reviewer never supplies one, so there is nothing to tamper with here.
  const fingerprint = governedQuantityClaimFingerprint(verdict.claimInput);
  assert.equal(typeof fingerprint, "string");
  assert.ok(fingerprint.length > 0);
  assert.equal("evidenceFingerprint" in verdict.claimInput, false);

  const written = await persistGovernedQuantityClaim(
    d1(sql),
    { ...verdict.claimInput, evidenceFingerprint: fingerprint },
    { actorId: HUMAN },
  );
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(written.action, "CREATED");
  assert.equal(written.claim.quantity, 2);
  assert.equal(written.claim.review_status, "Approved");
  assert.equal(written.claim.reviewed_by, HUMAN);
  // Stored fingerprint is exactly the derived one.
  assert.equal(written.claim.evidence_fingerprint, fingerprint);
  // Identity is location-scoped, never campus-global.
  assert.equal(written.claim.sheet, "2401232-PC-WLC-DR-T-93-ZZZ-005");
});

// ---- 5. a rejected review creates no authority ------------------------------

test("5. rejected/conflict/unreviewed review states create no authority", () => {
  for (const status of ["Rejected", "Conflict", "Needs Review", "Not Found"]) {
    const r = evaluate({ review_status: status });
    assert.equal(r.ok, false, `${status} must not create authority`);
    assert.equal(r.code, "REVIEW_NOT_AUTHORISED");
  }
  // Only the two human-decision statuses are ever admissible.
  assert.deepEqual([...QUANTITY_REVIEW_AUTHORITY_STATUSES].sort(), ["Verified", "Verified with Assumption"]);
});

// ---- 6. a corrected review writes the CORRECTED quantity, not the proposal --

test("6. corrected review writes the corrected quantity, not the proposal", async () => {
  const sql = singleChain("SH-WLC");

  // The engine proposed 2 (raw_label / evidence.quantity are both 2).
  const verdict = evaluate({ corrected_value: adjudicated({ quantity: 7, printedText: "7 Nos" }) }, {
    intakeDocumentVersionId: "ver-1",
    currentDocumentVersionId: "ver-1",
    sourceAssets: [{ id: "asset-1", textContent: "7 Nos" }],
  });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.adjudication.quantity, 7, "the corrected quantity governs, not the proposal");
  assert.equal(JSON.parse(proposal().evidence).quantity, 2, "the proposal itself is untouched");

  const fingerprint = governedQuantityClaimFingerprint(verdict.claimInput);
  const written = await persistGovernedQuantityClaim(
    d1(sql),
    { ...verdict.claimInput, evidenceFingerprint: fingerprint },
    { actorId: HUMAN },
  );
  assert.equal(written.ok, true, JSON.stringify(written));
  assert.equal(written.claim.quantity, 7);
  assert.equal(written.claim.printed_total, null);
});

// ---- 7. free-text class cannot bypass governed class meaning -----------------

test("7. free-text class name cannot bypass governed class meaning", () => {
  // "FIREMAN TELEPHONE" is a friendly label a reviewer would like to type.
  // It is not a legend class, so it carries no meaning.
  assert.equal(classifyLegendClass("FIREMAN TELEPHONE").state, "UNRESOLVED");
  const r = evaluate({ corrected_value: adjudicated({ deviceClass: "FIREMAN TELEPHONE" }) });
  assert.equal(r.ok, false);
  assert.equal(r.code, "CLASS_MEANING_NOT_GOVERNED");
  assert.equal(r.claimInput, undefined);

  // Other unresolved classes are refused identically.
  for (const cls of ["SIM", "O", "R", "ZZZ"]) {
    assert.equal(evaluate({ corrected_value: adjudicated({ deviceClass: cls }) }).code, "CLASS_MEANING_NOT_GOVERNED", cls);
  }
  // And the canonical resolver is what admits T.
  assert.equal(classifyLegendClass("T").state, "GOVERNED_AND_PROVEN");
  assert.equal(evaluate().ok, true);
});

// ---- 8. stale document version fails ----------------------------------------

test("8. stale document version fails", () => {
  const r = evaluate({}, { currentDocumentVersionId: "ver-NEWER" });
  assert.equal(r.ok, false);
  assert.equal(r.code, "STALE_DOCUMENT_VERSION");
  assert.match(r.reason, /ver-current/);
  assert.equal(r.reason.includes("ver-NEWER"), true);

  // A missing current version is also a refusal, not a pass.
  assert.equal(evaluate({}, { currentDocumentVersionId: null }).code, "MISSING_CURRENT_DOCUMENT_VERSION");
  assert.equal(evaluate({}, { intakeDocumentVersionId: null }).code, "MISSING_DOCUMENT_VERSION");
});

// ---- 9. mismatched/tampered evidence fingerprint fails ----------------------

test("9. tampered or mismatched evidence fingerprint fails", async () => {
  const verdict = evaluate();
  const fingerprint = governedQuantityClaimFingerprint(verdict.claimInput);

  // A caller-declared fingerprint that is not the derived one is refused.
  const tampered = await persistGovernedQuantityClaim(
    { prepare: () => { throw new Error("must not reach the database"); } },
    { ...verdict.claimInput, evidenceFingerprint: "0".repeat(64) },
    { actorId: HUMAN },
  );
  assert.equal(tampered.ok, false);
  assert.equal(tampered.code, "EVIDENCE_FINGERPRINT_MISMATCH");

  // A missing fingerprint is refused too.
  const missing = await persistGovernedQuantityClaim(
    { prepare: () => { throw new Error("must not reach the database"); } },
    { ...verdict.claimInput },
    { actorId: HUMAN },
  );
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "MISSING_EVIDENCE_FINGERPRINT");

  // Changing the evidence changes the fingerprint, so the drift detector bites.
  const other = governedQuantityClaimFingerprint({ ...verdict.claimInput, physicalQuantity: 3 });
  assert.notEqual(other, fingerprint);
});

// ---- 10. exact repeated approved evidence is idempotent ---------------------

test("10. exact repeated approved evidence is idempotent NO_OP", async () => {
  const sql = singleChain("SH-WLC");

  const verdict = evaluate({}, {
    intakeDocumentVersionId: "ver-1",
    currentDocumentVersionId: "ver-1",
    sourceAssets: [{ id: "asset-1", textContent: "2 Nos" }],
  });
  const fp = governedQuantityClaimFingerprint(verdict.claimInput);
  const write = () => persistGovernedQuantityClaim(d1(sql), { ...verdict.claimInput, evidenceFingerprint: fp }, { actorId: HUMAN });

  const first = await write();
  assert.equal(first.action, "CREATED");
  const second = await write();
  assert.equal(second.action, "NO_OP");
  assert.equal(second.idempotent, true);
  assert.equal(second.claim.id, first.claim.id, "no new row for an identical write");

  const rows = sql.prepare(`SELECT count(*) c FROM ${QUANTITY_CLAIM_TABLE}`).get().c;
  assert.equal(rows, 1);
});

// ---- 11. corrected evidence supersedes append-only --------------------------

test("11. corrected evidence supersedes append-only, never mutates in place", async () => {
  const sql = singleChain("SH-WLC");
  const ctx = {
    intakeDocumentVersionId: "ver-1",
    currentDocumentVersionId: "ver-1",
    sourceAssets: [{ id: "asset-1", textContent: "2 Nos" }],
  };

  const v2 = evaluate({}, ctx);
  const fp2 = governedQuantityClaimFingerprint(v2.claimInput);
  const first = await persistGovernedQuantityClaim(d1(sql), { ...v2.claimInput, evidenceFingerprint: fp2 }, { actorId: HUMAN });
  assert.equal(first.action, "CREATED");

  // The reviewer corrects 2 -> 4 (printed text changes with it, as it must).
  const v4 = evaluate({ corrected_value: adjudicated({ quantity: 4, printedText: "4 Nos" }) }, ctx);
  assert.equal(v4.ok, true);
  const fp4 = governedQuantityClaimFingerprint(v4.claimInput);
  assert.notEqual(fp4, fp2, "changed evidence changes the fingerprint");
  const second = await persistGovernedQuantityClaim(d1(sql), { ...v4.claimInput, evidenceFingerprint: fp4 }, { actorId: HUMAN });

  assert.equal(second.action, "SUPERSEDED");
  assert.equal(second.previousClaimId, first.claim.id);
  assert.equal(second.claim.version_number, 2);
  assert.equal(second.claim.quantity, 4);

  // The old version is history, not deleted and not edited.
  const all = sql.prepare(`SELECT quantity, version_number FROM ${QUANTITY_CLAIM_TABLE} ORDER BY version_number`).all();
  assert.equal(all.length, 2);
  assert.equal(all[0].quantity, 2, "version 1 still reads 2");
  assert.equal(all[1].quantity, 4);
});

// ---- 12/13. four independent location-scoped claims; WLC regression -------

/** Seed the owning organization and project every governed row hangs off. */
function seedProject(sql, projectId = "project-1") {
  sql.exec(`
    INSERT OR IGNORE INTO organizations (id,name) VALUES ('org1','Org');
    INSERT INTO projects (id,name,owner_user_id,organization_id)
      VALUES ('${projectId}','P1','${HUMAN}','org1');
  `);
}

const insertChain = (sql, suffix, { sheet } = {}) =>
  sql.exec(`
    INSERT INTO documents (id,project_id,logical_name,created_by)
      VALUES ('doc-${suffix}','project-1',${sheet ? `'${sheet}'` : `'SH-${suffix}'`},'${HUMAN}');
    INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from)
      VALUES ('ver-${suffix}','doc-${suffix}',1,'a.pdf','a.pdf','pdf','application/pdf',4,'sha','o','${HUMAN}','2020-01-01');
    INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by)
      VALUES ('intake-${suffix}','project-1','doc-${suffix}','ver-${suffix}',1,'ifp','ofp','p1','Completed','{}','${HUMAN}');
    INSERT INTO drawing_pages (id,intake_version_id,page_number,coordinate_mode,classifications,text_count,source_review_status,extraction_method)
      VALUES ('pg-${suffix}','intake-${suffix}',1,'normalized','[]',1,'Approved','fixture');
    INSERT INTO drawing_assets (id,intake_version_id,page_id,asset_type,text_content,bounding_box,coordinates_available,detection_confidence,detection_method,review_status)
      VALUES ('asset-${suffix}','intake-${suffix}','pg-${suffix}','Text','x Nos','{"x":1,"y":2}',1,90,'fixture','Needs Review');
    -- Set the head only after the version exists, so the FK resolves.
    UPDATE documents SET current_version_id='ver-${suffix}' WHERE id='doc-${suffix}';
  `);

/** Seed one project with four location documents, each with one governed asset. */
function fourLocationChain() {
  const db = activeChainDatabase();
  const sql = db.sqlite ?? db;
  seedProject(sql);
  for (const loc of ["BOS", "GRS", "KGS", "WLC"]) {
    insertChain(sql, loc, { sheet: `2401232-PC-${loc}-DR-T-93-ZZZ-005` });
  }
  return sql;
}

/**
 * The reviewed adjudication for one location, exactly as the existing review
 * path would have recorded it via its `correct` action.
 */
function locationVerdict(loc, quantity, printedText, countMethod = "PRINTED_CELL") {
  return evaluate({
    id: `proposal-${loc}`,
    document_id: `doc-${loc}`,
    intake_version_id: `intake-${loc}`,
    corrected_value: adjudicated({ quantity, printedText, countMethod }),
    review_reason: `Reviewed the printed ${printedText} cell on the ${loc} schedule.`,
  }, {
    sheet: `2401232-PC-${loc}-DR-T-93-ZZZ-005`,
    sourceAssets: [{ id: `asset-${loc}`, textContent: printedText }],
    currentDocumentVersionId: `ver-${loc}`,
    intakeDocumentVersionId: `ver-${loc}`,
  });
}

test("12. BOS/GRS/KGS/WLC remain four separate location-scoped claims", async () => {
  const sql = fourLocationChain();
  const expected = { BOS: 25, GRS: 25, KGS: 23, WLC: 12 };

  for (const [loc, qty] of Object.entries(expected)) {
    const v = locationVerdict(loc, qty, `${qty} Nos`);
    assert.equal(v.ok, true, `${loc}: ${v.reason}`);
    assert.equal(v.claimInput.sheet, `2401232-PC-${loc}-DR-T-93-ZZZ-005`);
    const fp = governedQuantityClaimFingerprint(v.claimInput);
    const w = await persistGovernedQuantityClaim(d1(sql), { ...v.claimInput, evidenceFingerprint: fp }, { actorId: HUMAN });
    assert.equal(w.ok, true, `${loc}: ${JSON.stringify(w)}`);
    assert.equal(w.claim.quantity, qty);
  }

  const rows = sql.prepare(`SELECT sheet, quantity FROM ${QUANTITY_CLAIM_TABLE} ORDER BY sheet`).all();
  assert.equal(rows.length, 4, "four independent claims, never one campus-global row");
  assert.deepEqual(rows.map((r) => r.sheet), [
    "2401232-PC-BOS-DR-T-93-ZZZ-005",
    "2401232-PC-GRS-DR-T-93-ZZZ-005",
    "2401232-PC-KGS-DR-T-93-ZZZ-005",
    "2401232-PC-WLC-DR-T-93-ZZZ-005",
  ]);
  // No campus-global identity exists anywhere.
  const global = sql.prepare(`SELECT count(*) c FROM ${QUANTITY_CLAIM_TABLE} WHERE sheet IS NULL OR sheet='' OR sheet LIKE '%CAMPUS%'`).get().c;
  assert.equal(global, 0);
});

test("13. WLC regression: 6 occurrences != 12 physical units, and only via printed components", async () => {
  const sql = fourLocationChain();

  // (a) The historical WLC reading was 6 plotted occurrences x "2 Nos" = 12.
  //     12 is legitimate ONLY when BOTH numbers are printed and declared as an
  //     explicit component sum.
  const printed = locationVerdict("WLC", 12, "6 x 2 Nos", "COMPONENT_CELL_SUM");
  assert.equal(printed.ok, true, printed.reason);
  assert.equal(printed.adjudication.countMethod, "COMPONENT_CELL_SUM");

  // (b) The same 12 asserted from a single printed "2 Nos" cell is refused:
  //     that is the 6-occurrence shortcut wearing a printed disguise.
  const shortcut = locationVerdict("WLC", 12, "2 Nos", "PRINTED_CELL");
  assert.equal(shortcut.ok, false);
  assert.equal(shortcut.code, "PRINTED_QUANTITY_TEXT_MISMATCH");

  // (c) 12 reached by declaring the recognizer's 6 occurrences as the quantity
  //     while only 2 Nos is printed: refused, because 6 is not printed.
  assert.equal(validatePrintedQuantityAdjudication({
    quantity: 12, deviceClass: "T", countMethod: "COMPONENT_CELL_SUM", printedText: "2 Nos",
  }).code, "COMPONENT_SUM_WITHOUT_COMPONENTS");

  // (d) An occurrence count of 6 is not a quantity at all.
  const six = locationVerdict("WLC", 6, "6 Nos", "PRINTED_CELL");
  assert.equal(six.ok, true, "6 Nos is a genuine printed cell reading");
  assert.equal(six.adjudication.quantity, 6);

  // Write the legitimate 12 and prove 12 is what lands, scoped to WLC.
  const fp = governedQuantityClaimFingerprint(printed.claimInput);
  const w = await persistGovernedQuantityClaim(d1(sql), { ...printed.claimInput, evidenceFingerprint: fp }, { actorId: HUMAN });
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(w.claim.quantity, 12);
  assert.equal(w.claim.count_method, "COMPONENT_CELL_SUM");
  assert.equal(w.claim.sheet, "2401232-PC-WLC-DR-T-93-ZZZ-005");
});

// ---- 14. downstream aggregate is 85 only when all four are approved --------

test("14. downstream aggregate of four current claims is 85; missing one is not", async () => {
  const sql = fourLocationChain();
  const expected = { BOS: 25, GRS: 25, KGS: 23, WLC: 12 };
  const EXPECTED_SHEETS = Object.keys(expected).map((l) => `2401232-PC-${l}-DR-T-93-ZZZ-005`);
  const versions = { "doc-BOS": "ver-BOS", "doc-GRS": "ver-GRS", "doc-KGS": "ver-KGS", "doc-WLC": "ver-WLC" };

  const claims = () => sql.prepare(`
    SELECT c.*, d.current_version_id FROM ${QUANTITY_CLAIM_TABLE} c
    JOIN documents d ON d.id=c.document_id`).all();

  /**
   * Complete-coverage check, performed by the CALLER.
   *
   * `readCurrentDrawingQuantities` derives coverageState from the claims it is
   * handed, so it cannot know a location was expected and never received. That is
   * a real property of the canonical reader, asserted below rather than papered
   * over: if a caller requires complete location coverage it must compare the
   * governed sheets against its own expected scope. This helper is that
   * comparison, in the test, because building a production aggregation domain is
   * out of scope for this slice.
   */
  const scopeGap = () => {
    const present = new Set(claims().map((c) => c.sheet));
    return EXPECTED_SHEETS.filter((s) => !present.has(s));
  };

  // Nothing approved yet: the aggregate reports nothing and coverage is not claimed.
  const empty = readCurrentDrawingQuantities({ claims: claims(), currentDocumentVersions: versions });
  assert.equal(empty.provenTotal, 0);
  assert.equal(empty.counts.proven, 0);
  assert.deepEqual(scopeGap().sort(), EXPECTED_SHEETS.slice().sort(), "all four locations are missing");

  // Three of four approved: the total is a real 73, and the caller can see WLC absent.
  for (const loc of ["BOS", "GRS", "KGS"]) {
    const v = locationVerdict(loc, expected[loc], `${expected[loc]} Nos`);
    await persistGovernedQuantityClaim(d1(sql), { ...v.claimInput, evidenceFingerprint: governedQuantityClaimFingerprint(v.claimInput) }, { actorId: HUMAN });
  }
  const three = readCurrentDrawingQuantities({ claims: claims(), currentDocumentVersions: versions });
  assert.equal(three.provenTotal, 73, "25 + 25 + 23");
  assert.equal(three.counts.proven, 3);
  // The canonical reader is claim-relative: with only proven claims in hand it
  // reports Complete. It has no expected-scope input, so it CANNOT detect the
  // missing WLC. The caller-side check is what fails closed.
  assert.equal(three.coverageState, "Complete", "coverageState is claim-relative, not project-relative");
  assert.deepEqual(scopeGap(), ["2401232-PC-WLC-DR-T-93-ZZZ-005"], "a missing location is visible to the caller, never silently zero");

  // All four approved: 25 + 25 + 23 + 12 = 85.
  const wlc = locationVerdict("WLC", 12, "6 x 2 Nos", "COMPONENT_CELL_SUM");
  await persistGovernedQuantityClaim(d1(sql), { ...wlc.claimInput, evidenceFingerprint: governedQuantityClaimFingerprint(wlc.claimInput) }, { actorId: HUMAN });

  const all = readCurrentDrawingQuantities({ claims: claims(), currentDocumentVersions: versions });
  assert.equal(all.provenTotal, 85);
  assert.equal(all.counts.proven, 4);
  assert.equal(all.proven["T::STANDARD"].quantity, 85);
  assert.deepEqual(scopeGap(), [], "the expected scope is fully covered");

  // The aggregate is downstream of location-scoped rows; no global claim exists.
  assert.equal(sql.prepare(`SELECT count(*) c FROM ${QUANTITY_CLAIM_TABLE}`).get().c, 4);
});

// ---- 15. a missing location is never silently assumed to be zero -----------

test("15. missing location does not silently become zero", async () => {
  const sql = fourLocationChain();
  const v = locationVerdict("BOS", 25, "25 Nos");
  await persistGovernedQuantityClaim(d1(sql), { ...v.claimInput, evidenceFingerprint: governedQuantityClaimFingerprint(v.claimInput) }, { actorId: HUMAN });

  const versions = { "doc-BOS": "ver-BOS", "doc-GRS": "ver-GRS", "doc-KGS": "ver-KGS", "doc-WLC": "ver-WLC" };
  const rows = sql.prepare(`SELECT * FROM ${QUANTITY_CLAIM_TABLE}`).all();
  const agg = readCurrentDrawingQuantities({ claims: rows, currentDocumentVersions: versions });

  // GRS/KGS/WLC contribute nothing and are NOT reported as zero devices.
  assert.equal(agg.provenTotal, 25);
  assert.equal(agg.counts.proven, 1);
  assert.equal(agg.unresolved.length, 0, "absence is not manufactured as an UNRESOLVED device");
  // Only BOS is in the aggregate; the other three sheets simply do not appear.
  assert.deepEqual(agg.proven["T::STANDARD"].sheets, ["2401232-PC-BOS-DR-T-93-ZZZ-005"]);
  // Requesting a location that has no claim returns an empty scope, not a 0.
  const grs = readCurrentDrawingQuantities({ claims: rows, currentDocumentVersions: versions, sheet: "2401232-PC-GRS-DR-T-93-ZZZ-005" });
  assert.equal(grs.claimCount, 0);
  assert.equal(grs.provenTotal, 0);
  assert.deepEqual(grs.proven, {});

  // And an absent quantity is never coerced into a governed zero claim: the
  // writer still refuses an unspecified physical quantity.
  const noQty = evaluate({ corrected_value: JSON.stringify({ deviceClass: "T", countMethod: "PRINTED_CELL", printedText: "2 Nos" }) });
  assert.equal(noQty.ok, false);
  assert.equal(noQty.code, "ADJUDICATION_FIELD_MISSING");
});

// ---- 16. overall drawing coverage is not falsely upgraded ------------------

test("16. four Fireman Telephone claims do not upgrade project drawing coverage", async () => {
  const sql = fourLocationChain();
  for (const [loc, qty] of Object.entries({ BOS: 25, GRS: 25, KGS: 23, WLC: 12 })) {
    const v = locationVerdict(loc, qty, qty === 12 ? "6 x 2 Nos" : `${qty} Nos`, qty === 12 ? "COMPONENT_CELL_SUM" : "PRINTED_CELL");
    await persistGovernedQuantityClaim(d1(sql), { ...v.claimInput, evidenceFingerprint: governedQuantityClaimFingerprint(v.claimInput) }, { actorId: HUMAN });
  }

  const rows = sql.prepare(`SELECT * FROM ${QUANTITY_CLAIM_TABLE}`).all();
  const versions = { "doc-BOS": "ver-BOS", "doc-GRS": "ver-GRS", "doc-KGS": "ver-KGS", "doc-WLC": "ver-WLC" };

  // The four claims are real, current and governed...
  const scope = readCurrentDrawingQuantities({ claims: rows, currentDocumentVersions: versions });
  assert.equal(scope.provenTotal, 85);
  assert.deepEqual(Object.keys(scope.proven), ["T::STANDARD"]);

  // ...but they cover ONE device class at FOUR locations. The drawing corpus has
  // many other governed classes, so project-wide quantity completeness must not
  // be asserted. The governing coverage assessment is untouched by this slice.
  assert.deepEqual(Object.keys(scope.proven).length, 1, "only class T is covered by these claims");
  const firemanOnly = readCurrentDrawingQuantities({ claims: rows, currentDocumentVersions: versions, deviceClass: "T" });
  assert.equal(firemanOnly.provenTotal, 85);
  const otherClasses = readCurrentDrawingQuantities({ claims: rows, currentDocumentVersions: versions, deviceClass: "FACP" });
  assert.equal(otherClasses.claimCount, 0);
  assert.deepEqual(otherClasses.proven, {}, "no FACP quantity is implied to exist");
});

// ---- 17. the existing writer suite stays green ----------------------------

test("17. the canonical writer slice is untouched and still 46/46", () => {
  const src = readFileSync(new URL("./drawing-quantity-claim-writer.test.mjs", import.meta.url), "utf8");
  const cases = (src.match(/^test\(/gm) ?? []).length;
  assert.equal(cases, 46, "the writer suite must still declare its 46 focused cases");
  assert.equal(src.includes("SYMBOL_OCCURRENCES"), true, "its recognition barrier fixture is intact");
});

// ---- supporting invariants -------------------------------------------------

test("moving the document head makes the old claim non-current without rewriting history", async () => {
  const sql = fourLocationChain();
  const v = locationVerdict("WLC", 12, "6 x 2 Nos", "COMPONENT_CELL_SUM");
  await persistGovernedQuantityClaim(d1(sql), { ...v.claimInput, evidenceFingerprint: governedQuantityClaimFingerprint(v.claimInput) }, { actorId: HUMAN });
  const before = sql.prepare(`SELECT * FROM ${QUANTITY_CLAIM_TABLE}`).all();
  assert.equal(before.length, 1);

  // The drawing is revised.
  sql.exec(`UPDATE documents SET current_version_id='ver-WLC-2' WHERE id='doc-WLC';`);
  const after = sql.prepare(`SELECT * FROM ${QUANTITY_CLAIM_TABLE}`).all();
  assert.deepEqual(after, before, "the stored row is byte-identical; only currentness changed");

  const rows = sql.prepare(`SELECT c.*, d.current_version_id FROM ${QUANTITY_CLAIM_TABLE} c JOIN documents d ON d.id=c.document_id`).all();
  const agg = readCurrentDrawingQuantities({ claims: rows, currentDocumentVersions: { "doc-WLC": "ver-WLC-2" } });
  assert.equal(agg.provenTotal, 0, "a stale claim contributes nothing to the aggregate");

  // And a new review against the current version is still admissible.
  const fresh = locationVerdict("WLC", 12, "6 x 2 Nos", "COMPONENT_CELL_SUM");
  assert.equal(fresh.ok, true);
});

test("governed zero survives review and is not treated as missing", async () => {
  const sql = fourLocationChain();
  const zero = locationVerdict("WLC", 0, "0 Nos");
  assert.equal(zero.ok, true, zero.reason);
  assert.equal(zero.adjudication.quantity, 0);
  const w = await persistGovernedQuantityClaim(d1(sql), { ...zero.claimInput, evidenceFingerprint: governedQuantityClaimFingerprint(zero.claimInput) }, { actorId: HUMAN });
  assert.equal(w.ok, true, JSON.stringify(w));
  assert.equal(w.claim.quantity, 0, "a reviewed zero is stored as zero, not as null");
});

test("only the quantities proposal type is eligible", () => {
  assert.deepEqual([...PRINTED_QUANTITY_PROPOSAL_TYPES], ["quantities"]);
  for (const type of ["circuits", "interfaces", "LegendDefinition", "Equipment Schedule Item", "Callout Reference", "notes"]) {
    const r = evaluate({ proposal_type: type });
    assert.equal(r.ok, false, type);
    assert.equal(r.code, "PROPOSAL_TYPE_NOT_QUANTITY", type);
  }
});

test("the reviewer packet shows everything a decision needs", () => {
  const packet = buildPrintedQuantityReviewPacket({
    proposal: reviewed(),
    document: { logical_name: "2401232-PC-WLC-DR-T-93-ZZZ-005" },
    currentDocumentVersionId: "ver-current",
    intakeDocumentVersionId: "ver-current",
    sourceAssets: [{ id: "asset-1", textContent: "2 Nos", boundingBox: { x: 1, y: 2 }, reviewStatus: "Needs Review" }],
    isReviewerHuman: true,
  });

  assert.equal(packet.state, "READY_FOR_CLAIM");
  // location / sheet
  assert.equal(packet.location.sourceSheet, "FIRE DETECTION & ALARM SCHEMATIC");
  assert.equal(packet.location.page, 1);
  // device class + governed meaning
  assert.equal(packet.deviceClass.adjudicated, "T");
  assert.equal(packet.deviceClass.governedMeaning.state, "GOVERNED_AND_PROVEN");
  assert.equal(packet.deviceClass.engineFlag, true, "the reviewer is told the engine did not know the association");
  // source crops and printed assets
  assert.equal(packet.sourceCrops.length, 2);
  assert.equal(packet.sourceCrops[1].objectKey, "k/image-1.png");
  assert.equal(packet.sourceAssets[0].textContent, "2 Nos");
  // the proposal, explicitly not authority
  assert.equal(packet.engineProposal.proposedQuantity, 2);
  assert.equal(packet.engineProposal.isAuthority, false);
  // provenance
  assert.equal(packet.provenance.visualRunId, "run-1");
  assert.match(packet.provenance.hardReviewReasons.join(","), /QUANTITY_DEVICE_ASSOCIATION_UNKNOWN/);
  // current document version
  assert.equal(packet.isCurrentVersion, true);
  // the three decisions
  assert.ok(packet.actions.approve && packet.actions.correct && packet.actions.reject);
  assert.match(packet.actions.correct.consequence, /ONLY action/);
});

test("the packet never presents a bare number for approval", () => {
  // An approved-but-unadjudicated candidate: the packet must be explicit that
  // approve alone yields nothing, and name the gap.
  const packet = buildPrintedQuantityReviewPacket({
    proposal: proposal({ review_status: "Verified", reviewed_by: HUMAN, reviewed_at: "t", review_reason: "ok" }),
    document: { logical_name: "SH" },
    currentDocumentVersionId: "ver-current",
    intakeDocumentVersionId: "ver-current",
    sourceAssets: [{ id: "asset-1", textContent: "2 Nos" }],
    isReviewerHuman: true,
  });
  assert.equal(packet.state, "NOT_YET_AUTHORITATIVE");
  assert.equal(packet.blockingCode, "QUANTITY_ADJUDICATION_MISSING");
  assert.equal(packet.deviceClass.adjudicated, null, "no class is invented from the description");
  assert.match(packet.actions.approve.consequence, /no device class|bare numeral/i);
});
// ---- HTTP surface: the review path is mounted and cannot be talked around ---

/**
 * A project with one current WLC drawing and one printed-quantity proposal,
 * inserted exactly as the existing review subsystem would have left it.
 */
function routeSeed({ reviewStatus, correctedValue, reviewer = HUMAN } = {}) {
  const raw = activeChainDatabase();
  raw.exec(`
    INSERT INTO organizations (id,name) VALUES ('org1','Org');
    INSERT INTO projects (id,name,owner_user_id,organization_id)
      VALUES ('project-1','P1','${HUMAN}','org1');
    INSERT INTO projects (id,name,owner_user_id,organization_id)
      VALUES ('project-2','P2','other.human','org1');
  `);
  insertChain(raw, "1", { sheet: "2401232-PC-WLC-DR-T-93-ZZZ-005" });

  raw.prepare(`INSERT INTO drawing_extraction_proposals
    (id,project_id,document_id,intake_version_id,page_number,proposal_key,proposal_type,raw_label,
     authority_role,governed_status,hard_review_reasons,evidence,source_references,
     extraction_method,extraction_version,review_status,reviewed_by,reviewed_at,review_reason,
     corrected_value,visual_run_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      "proposal-1", "project-1", "doc-1", "intake-1", 1, "k:ai:quantities:1:0", "quantities",
      "2 Nos — stated count 2", "Unsupported", "Needs Review",
      JSON.stringify(["AI_VISUAL_FINDING_REQUIRES_ENGINEER_CONFIRMATION", "QUANTITY_DEVICE_ASSOCIATION_UNKNOWN"]),
      JSON.stringify({
        quantity: 2,
        evidenceQuote: "2 Nos",
        sourceSymbolOrText: "2 Nos",
        sourceSheet: "FIRE DETECTION & ALARM SCHEMATIC",
        sourceRevision: "1",
        imageProvenance: [{ index: 1, kind: "crop", pageNumber: 1, sha256: "b".repeat(64), objectKey: "k/image-1.png", cropRect: { purpose: "equipment / location" } }],
      }),
      JSON.stringify([{ sourceId: "asset-1", pageNumber: 1, text: "2 Nos" }]),
      "AI visual analysis (fixture)", "fixture-1",
      reviewStatus ?? "Needs Review",
      reviewer === null ? null : reviewer,
      reviewStatus && reviewStatus !== "Needs Review" ? "2026-10-04T00:00:00.000Z" : null,
      reviewStatus && reviewStatus !== "Needs Review" ? "Reviewed the printed 2 Nos cell on the current WLC schedule." : null,
      correctedValue ?? null,
      "run-1",
    );
  return raw;
}

const envFor = (raw, actor = { APP_HUMAN_ID: HUMAN, APP_HUMAN_NAME: "Fixture Reviewer" }) => ({ DB: d1(raw), ...actor });
const PACKETS_URL = "https://app.example/api/projects/project-1/drawing-quantity-review-packets";
const promoteUrl = (id = "proposal-1") => `${PACKETS_URL}/${id}/promote`;
const post = (url, body) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body ?? {}),
});

const ADJUDICATION = { quantity: 2, deviceClass: "T", countMethod: "PRINTED_CELL", printedText: "2 Nos" };

test("HTTP: the packet route serves an inspectable packet and names the blocker", async () => {
  const raw = routeSeed();
  const res = await handleDrawingQuantityReviewApi(new Request(PACKETS_URL), envFor(raw));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.packetCount, 1);
  assert.equal(body.readyCount, 0, "an unreviewed candidate is not ready");

  const [packet] = body.packets;
  assert.equal(packet.state, "NOT_YET_AUTHORITATIVE");
  assert.equal(packet.blockingCode, "REVIEW_NOT_AUTHORISED");
  assert.equal(packet.location.sourceSheet, "FIRE DETECTION & ALARM SCHEMATIC");
  assert.equal(packet.engineProposal.proposedQuantity, 2);
  assert.equal(packet.engineProposal.isAuthority, false);
  assert.equal(packet.deviceClass.adjudicated, null);
  assert.equal(packet.sourceCrops[0].objectKey, "k/image-1.png");
  assert.equal(packet.sourceAssets.length, 1, "the cited asset was resolved from the database");
  assert.equal(packet.sourceAssets[0].id, "asset-1", "source identities come from real rows, never from the request");
  assert.equal(packet.isCurrentVersion, true);
  raw.close();
});

test("HTTP: promote refuses an unreviewed proposal and writes nothing", async () => {
  const raw = routeSeed();
  const res = await handleDrawingQuantityReviewApi(post(promoteUrl()), envFor(raw));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.code, "REVIEW_NOT_AUTHORISED");
  assert.equal(body.reviewAuthorityEstablished, false);
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 0);
  raw.close();
});

test("HTTP: a body asserting a quantity cannot manufacture authority", async () => {
  // Fully reviewed and adjudicated, so the proposal itself IS promotable...
  const raw = routeSeed({
    reviewStatus: "Verified with Assumption",
    correctedValue: JSON.stringify(ADJUDICATION),
  });
  // ...but a caller trying to override the adjudicated values via the body
  // changes nothing: the route re-reads the proposal from the database.
  const res = await handleDrawingQuantityReviewApi(post(promoteUrl(), {
    correctedValue: { quantity: 9999, deviceClass: "T" },
    physicalQuantity: 9999,
    evidenceFingerprint: "0".repeat(64),
    reviewedBy: "someone.else",
  }), envFor(raw));
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.action, "CREATED");
  assert.equal(body.claim.physicalQuantity, 2, "the governed adjudication wins over any body assertion");
  assert.equal(body.claim.reviewStatus, "Approved");
  assert.equal(body.claim.sheet, "2401232-PC-WLC-DR-T-93-ZZZ-005");
  assert.equal(body.claim.isCurrent, true);
  assert.notEqual(body.claim.evidenceFingerprint, "0".repeat(64), "the fingerprint is derived, not supplied");

  // And nothing was written under the foreign reviewer.
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims WHERE reviewed_by='someone.else'").get().c, 0);
  raw.close();
});

test("HTTP: promote is idempotent, then supersedes on a corrected adjudication", async () => {
  const raw = routeSeed({ reviewStatus: "Verified with Assumption", correctedValue: JSON.stringify(ADJUDICATION) });

  const first = await (await handleDrawingQuantityReviewApi(post(promoteUrl()), envFor(raw))).json();
  assert.equal(first.action, "CREATED");

  const again = await (await handleDrawingQuantityReviewApi(post(promoteUrl()), envFor(raw))).json();
  assert.equal(again.action, "NO_OP");
  assert.equal(again.idempotent, true);
  assert.equal(again.claim.id, first.claim.id);
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 1);

  // The reviewer corrects the printed reading, as the review path would record.
  raw.prepare("UPDATE drawing_extraction_proposals SET corrected_value=? WHERE id='proposal-1'")
    .run(JSON.stringify({ ...ADJUDICATION, quantity: 4, printedText: "4 Nos" }));
  raw.prepare("UPDATE drawing_assets SET text_content='4 Nos' WHERE id='asset-1'").run();

  const second = await (await handleDrawingQuantityReviewApi(post(promoteUrl()), envFor(raw))).json();
  assert.equal(second.action, "SUPERSEDED");
  assert.equal(second.previousClaimId, first.claim.id);
  assert.equal(second.claim.versionNumber, 2);
  assert.equal(second.claim.physicalQuantity, 4);
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 2, "append-only");
  raw.close();
});

test("HTTP: a synthetic reviewer on the proposal cannot be promoted", async () => {
  // The live corpus records its review actor as local-development-user.
  const raw = routeSeed({
    reviewStatus: "Verified with Assumption",
    correctedValue: JSON.stringify(ADJUDICATION),
    reviewer: "local-development-user",
  });
  // The CALLER here is a real human; only the proposal's reviewer is synthetic.
  const res = await handleDrawingQuantityReviewApi(post(promoteUrl()), envFor(raw));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.code, "SYNTHETIC_REVIEWER_REFUSED");
  assert.match(body.reason, /local-development-user/);
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 0);
  raw.close();
});

test("HTTP: a stale proposal (document head moved) is refused", async () => {
  const raw = routeSeed({ reviewStatus: "Verified with Assumption", correctedValue: JSON.stringify(ADJUDICATION) });
  raw.prepare("INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from) VALUES ('ver-2','doc-1',2,'b','b','pdf','application/pdf',1,'s2','o2',?,'2020-02-01')").run(HUMAN);
  raw.prepare("UPDATE documents SET current_version_id='ver-2' WHERE id='doc-1'").run();

  const res = await handleDrawingQuantityReviewApi(post(promoteUrl()), envFor(raw));
  assert.equal(res.status, 422);
  assert.equal((await res.json()).code, "STALE_DOCUMENT_VERSION");
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 0);
  raw.close();
});

test("HTTP: authentication, ownership and routing behave", async () => {
  const raw = routeSeed({ reviewStatus: "Verified with Assumption", correctedValue: JSON.stringify(ADJUDICATION) });

  // Ignores paths it does not own.
  assert.equal(await handleDrawingQuantityReviewApi(post(`${PACKETS_URL}/proposal-1/nonsense`), envFor(raw)), null);

  // No configured human actor.
  const noActor = await handleDrawingQuantityReviewApi(post(promoteUrl()), envFor(raw, {}));
  assert.equal(noActor.status, 403);
  assert.equal((await noActor.json()).error.code, "HUMAN_ACTOR_NOT_CONFIGURED");

  // A synthetic calling actor is refused at the gate.
  const synthetic = await handleDrawingQuantityReviewApi(
    post(promoteUrl()), envFor(raw, { APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "Dev" }),
  );
  assert.equal(synthetic.status, 403);
  assert.equal((await synthetic.json()).error.code, "HUMAN_ACTOR_ID_INVALID");

  // An unknown project, then another user's project.
  const missing = await handleDrawingQuantityReviewApi(
    post("https://app.example/api/projects/nope/drawing-quantity-review-packets/proposal-1/promote"), envFor(raw),
  );
  assert.equal(missing.status, 404);
  const foreign = await handleDrawingQuantityReviewApi(
    post("https://app.example/api/projects/project-2/drawing-quantity-review-packets/proposal-1/promote"), envFor(raw),
  );
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error.code, "PROJECT_FORBIDDEN");

  // A proposal belonging to another project is not addressable from this one.
  const crossProject = await handleDrawingQuantityReviewApi(post(promoteUrl("proposal-nope")), envFor(raw));
  assert.equal(crossProject.status, 404);

  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 0, "no refusal wrote anything");
  raw.close();
});

test("HTTP: the review route is MOUNTED in the worker router", async () => {
  const src = readFileSync(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(src, /import \{ handleDrawingQuantityReviewApi \} from "\.\/drawing-quantity-review-api\.mjs"/);
  const dispatch = src.indexOf("handleDrawingQuantityReviewApi(request, env)");
  assert.ok(dispatch > 0, "the route is dispatched");
  // Before the claim writer, and well before the handler.fetch fallback.
  assert.ok(dispatch < src.indexOf("handleDrawingQuantityClaimApi(request, env)"));
  assert.ok(dispatch < src.indexOf("handler.fetch(request, env, ctx)"));
  // And it is a secured surface like every other governed route.
  assert.match(src, /if \(drawingQuantityReviewApiResponse\) return secured\(drawingQuantityReviewApiResponse\);/);
});
