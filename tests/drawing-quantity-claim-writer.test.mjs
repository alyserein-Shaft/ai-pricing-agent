// FOCUSED tests for the governed Drawing Quantity claim writer.
//
// Every test runs against a DISPOSABLE in-memory database built from the real
// canonical active chain, and every write is rolled back. No test touches
// canonical D1 and no production claim is persisted.
//
// The suite pins the writer's REFUSAL behaviour as much as its success
// behaviour: a writer that can only say yes is not authority.

import assert from "node:assert/strict";
import test from "node:test";
import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import {
  persistGovernedQuantityClaim,
  validateGovernedQuantityClaimInput,
  governedQuantityClaimFingerprint,
} from "../worker/drawing-quantity-claim-writer.mjs";
import {
  readCurrentDrawingQuantityAuthority,
  DRAWING_QUANTITY_AUTHORITY_STATES,
  computeQuantityAuthorityFingerprint,
  isCurrentQuantityClaim,
} from "../app/domain/drawing-quantity-authority.mjs";
import { handleDrawingQuantityClaimApi } from "../worker/drawing-quantity-claim-api.mjs";
import {
  evaluateLinkWrite,
  evaluateLinkCurrency,
  DRAWING_QUANTITY_BOQ_LINK_STATES,
} from "../app/domain/drawing-quantity-boq-links.mjs";

// A real human identity: "local-development-user" is synthetic and the actor
// gate refuses it as a decision-maker, so the fixture must not use it.
const OWNER = "estimator.human";

const seed = () => {
  const raw = activeChainDatabase({ foreignKeys: true });
  raw.prepare("INSERT INTO organizations (id,name) VALUES ('org1','Org')").run();
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES (?,?,?,?)").run("proj1", "P", OWNER, "org1");

  // A second project, owned by somebody else. 'docX' lives there, so both the
  // ownership refusal and the cross-project refusal are exercised for real.
  raw.prepare("INSERT INTO projects (id,name,owner_user_id,organization_id) VALUES ('proj2','P2',?,'org1')").run("other.human");
  raw.prepare("INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('doc1',?,'DWG',?)").run("proj1", OWNER);
  raw.prepare("INSERT INTO documents (id,project_id,logical_name,created_by) VALUES ('docX',?,'OTHER',?)").run("proj2", OWNER);
  raw.prepare("INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from) VALUES ('ver1','doc1',1,'a.pdf','a.pdf','pdf','application/pdf',4,'sha1','o',?,'2020-01-01')").run(OWNER);
  raw.prepare("INSERT INTO document_versions (id,document_id,version_number,original_filename,stored_filename,extension,mime_type,byte_size,sha256,object_key,uploaded_by,effective_from) VALUES ('ver2','doc1',2,'b.pdf','b.pdf','pdf','application/pdf',4,'sha2','o',?,'2020-01-02')").run(OWNER);
  raw.prepare("UPDATE documents SET current_version_id='ver1' WHERE id='doc1'").run();

  // A real governed intake -> page -> asset chain, so source-asset verification
  // is not vacuous and the asset genuinely hangs off the CURRENT drawing.
  raw.prepare(
    "INSERT INTO drawing_intake_versions (id,project_id,document_id,document_version_id,version_number,input_fingerprint,output_fingerprint,parser_version,status,summary,created_by)"
    + " VALUES ('iv1','proj1','doc1','ver1',1,'ifp','ofp','p1','Completed','{}',?)",
  ).run(OWNER);
  raw.prepare(
    "INSERT INTO drawing_pages (id,intake_version_id,page_number,coordinate_mode,classifications,text_count,source_review_status,extraction_method)"
    + " VALUES ('pg1','iv1',1,'normalized','[]',1,'Approved','fixture')",
  ).run();
  raw.prepare(
    "INSERT INTO drawing_assets (id,intake_version_id,page_id,asset_type,text_content,bounding_box,coordinates_available,detection_confidence,detection_method,review_status)"
    + " VALUES ('asset1','iv1','pg1','text','FIREMAN TELEPHONE JACK','{}',1,90,'fixture','Approved')",
  ).run();

  return raw;
};

/**
 * A well-formed governed claim input, with its evidence fingerprint DERIVED from
 * its own evidence -- which is what a real caller must do, and what the writer
 * enforces. Overrides are applied first so the fingerprint always matches the
 * overridden evidence unless a test deliberately breaks that.
 */
const baseInput = (over = {}) => {
  const input = {
    projectId: "proj1",
    documentId: "doc1",
    documentVersionId: "ver1",
    sheet: "2401232- PC- WLC- DR- T-93-ZZZ-005",
    page: 1,
    floorOrArea: "LEVEL 01",
    deviceClass: "T",
    deviceVariant: "STANDARD",
    physicalQuantity: 12,
    countMethod: "PRINTED_CELL",
    sourceAssetIds: ["asset1"],
    reviewedBy: OWNER,
    reviewReason: "printed quantity on the current drawing",
    ...over,
  };
  if (over.evidenceFingerprint === undefined) {
    // A deliberately-invalid input cannot have a derived fingerprint; the
    // sentinel keeps the SPECIFIC refusal reason visible instead of masking it
    // behind a missing-fingerprint complaint.
    input.evidenceFingerprint = governedQuantityClaimFingerprint(input) ?? "dqa_unbuildable_fixture";
  }
  return input;
};

const write = (raw, input, opts) => persistGovernedQuantityClaim(d1(raw), input, { actorId: OWNER, ...opts });

// ---- refusals ---------------------------------------------------------------

test("refuses an unknown project", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ projectId: "" }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "UNKNOWN_PROJECT");
});

test("refuses a cross-project document", async () => {
  const raw = seed();
  const res = await write(raw, baseInput({ documentId: "docX", projectId: "proj1" }));
  assert.equal(res.ok, false);
  assert.equal(res.code, "CROSS_PROJECT_DOCUMENT");
  raw.close();
});

test("refuses a non-current document version", async () => {
  const raw = seed();
  const res = await write(raw, baseInput({ documentVersionId: "ver2" }));
  assert.equal(res.ok, false);
  assert.equal(res.code, "STALE_DOCUMENT_VERSION");
  raw.close();
});

test("refuses a missing sheet identity", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ sheet: "" }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "MISSING_SHEET_IDENTITY");
});

test("refuses a missing device class", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ deviceClass: "" }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "MISSING_DEVICE_CLASS");
});

test("refuses an unknown device variant", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ deviceVariant: "EXPLOSIVE" }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "UNKNOWN_VARIANT");
});

test("refuses a class whose meaning is not governed (free text cannot confer authority)", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ deviceClass: "NOT_A_REAL_LEGEND_CODE" }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "CLASS_MEANING_NOT_GOVERNED");
});

test("refuses a negative quantity", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ physicalQuantity: -1 }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "NEGATIVE_PHYSICAL_QUANTITY");
});

test("refuses an unknown unit", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ unit: "" }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "UNKNOWN_UNIT");
});

test("refuses a missing evidence fingerprint", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ evidenceFingerprint: "" }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "MISSING_EVIDENCE_FINGERPRINT");
});

test("refuses unverifiable source assets", () => {
  const a = validateGovernedQuantityClaimInput(baseInput({ sourceAssetIds: [] }));
  assert.equal(a.ok, false);
  assert.equal(a.code, "MISSING_SOURCE_ASSETS");
  const b = validateGovernedQuantityClaimInput(baseInput({ sourceAssetIds: ["asset_missing"] }));
  assert.equal(b.ok, true, "shape is valid; existence is checked at persistence");
});

test("refuses a source asset that does not exist in governed evidence", async () => {
  const raw = seed();
  const res = await write(raw, baseInput({ sourceAssetIds: ["asset_does_not_exist"] }));
  assert.equal(res.ok, false);
  assert.equal(res.code, "UNVERIFIABLE_SOURCE_ASSETS");
  raw.close();
});

// ---- the recognition barrier -------------------------------------------------

test("RECOGNITION COUNT CANNOT become physical authority: no countMethod expresses it", () => {
  for (const method of ["OCCURRENCE_COUNT", "SYMBOL_OCCURRENCES", "PLOTTED_SYMBOLS", "RECOGNITION_COUNT"]) {
    const v = validateGovernedQuantityClaimInput(baseInput({ countMethod: method }));
    assert.equal(v.ok, false, `${method} must not be accepted`);
    assert.equal(v.code, "INVALID_COUNT_METHOD");
  }
});

test("a missing count method is refused (a quantity with no method is not evidence)", () => {
  const v = validateGovernedQuantityClaimInput(baseInput({ countMethod: null }));
  assert.equal(v.ok, false);
  assert.equal(v.code, "INVALID_COUNT_METHOD");
});

// ---- zero semantics ----------------------------------------------------------

test("an unknown quantity does NOT become zero", () => {
  const missing = validateGovernedQuantityClaimInput(baseInput({ physicalQuantity: undefined }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "MISSING_PHYSICAL_QUANTITY");
  const nul = validateGovernedQuantityClaimInput(baseInput({ physicalQuantity: null }));
  assert.equal(nul.ok, false);
  assert.equal(nul.code, "MISSING_PHYSICAL_QUANTITY");
});

test("a governed ZERO survives (an explicit printed 0 is real evidence)", async () => {
  const raw = seed();
  const res = await write(raw, baseInput({ physicalQuantity: 0 }));
  assert.equal(res.ok, true);
  assert.equal(res.claim.quantity, 0, "0 is persisted as 0, never dropped or treated as absent");
  assert.notEqual(res.claim.quantity, null);
  raw.close();
});

// ---- write / idempotency / supersession -------------------------------------

test("a valid claim is written", async () => {
  const raw = seed();
  const res = await write(raw, baseInput());
  assert.equal(res.ok, true);
  assert.equal(res.action, "CREATED");
  assert.equal(res.claim.quantity, 12);
  assert.equal(res.claim.state, "PROVEN");
  const n = raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c;
  assert.equal(n, 1);
  raw.close();
});

test("an identical repeat is an idempotent no-op", async () => {
  const raw = seed();
  const first = await write(raw, baseInput());
  const second = await write(raw, baseInput());
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
  assert.equal(second.action, "NO_OP");
  assert.equal(second.claim.id, first.claim.id, "the same authority row is returned");
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 1, "no second row");
  raw.close();
});

test("a changed quantity SUPERSEDES rather than editing in place", async () => {
  const raw = seed();
  const first = await write(raw, baseInput());
  const second = await write(raw, baseInput({ physicalQuantity: 14 }));
  assert.equal(second.ok, true);
  assert.equal(second.action, "SUPERSEDED");
  assert.equal(second.previousClaimId, first.claim.id);
  assert.equal(second.claim.version_number, 2);

  const rows = raw.prepare("SELECT id,quantity,superseded_at,version_number FROM drawing_quantity_claims ORDER BY version_number").all();
  assert.equal(rows.length, 2, "history is retained, never deleted");
  assert.equal(rows[0].quantity, 12, "the old governed value is untouched");
  assert.ok(rows[0].superseded_at, "the old row is retired");
  assert.equal(rows[1].quantity, 14);
  assert.equal(rows[1].superseded_at, null, "the new row is current");
  raw.close();
});

test("changed EVIDENCE also requires supersession", async () => {
  const raw = seed();
  const first = await write(raw, baseInput());
  // Same quantity, different source evidence: the claim is about different
  // evidence now, so it is a new version, not a no-op.
  const second = await write(raw, baseInput({ sourceRegion: { page: 1, bbox: { x: 10, y: 20, w: 5, h: 5 } } }));
  assert.equal(second.ok, true);
  assert.equal(second.action, "SUPERSEDED");
  assert.equal(second.claim.version_number, 2);
  assert.equal(second.previousClaimId, first.claim.id);
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 2);

  // The superseded row keeps the fingerprint of the evidence it actually claimed.
  const old = raw.prepare("SELECT evidence_fingerprint FROM drawing_quantity_claims WHERE id=?").get(first.claim.id);
  assert.equal(old.evidence_fingerprint, first.claim.evidence_fingerprint, "history is not rewritten");
  raw.close();
});

test("a declared fingerprint that is not the claim's own is REFUSED", async () => {
  const raw = seed();
  await write(raw, baseInput());
  // A label the caller attached, not derived from the evidence being persisted.
  const res = await write(raw, baseInput({ physicalQuantity: 14, evidenceFingerprint: "dqa_asserted_by_hand" }));
  assert.equal(res.ok, false);
  assert.equal(res.code, "EVIDENCE_FINGERPRINT_MISMATCH");
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 1,
    "nothing was written, so the first claim is still current and correct");
  raw.close();
});

test("in-place mutation of an existing authority is refused BY THE DATABASE", async () => {
  const raw = seed();
  const { claim } = await write(raw, baseInput());
  assert.throws(() => raw.prepare("UPDATE drawing_quantity_claims SET quantity=999 WHERE id=?").run(claim.id), /EVIDENCE_IMMUTABLE/);
  raw.close();
});

test("deleting a claim is refused BY THE DATABASE", async () => {
  const raw = seed();
  const { claim } = await write(raw, baseInput());
  assert.throws(() => raw.prepare("DELETE FROM drawing_quantity_claims WHERE id=?").run(claim.id), /APPEND_ONLY/);
  raw.close();
});

test("a superseded claim cannot be un-retired", async () => {
  const raw = seed();
  await write(raw, baseInput());
  const v2 = await write(raw, baseInput({ physicalQuantity: 14 }));
  assert.throws(() => raw.prepare("UPDATE drawing_quantity_claims SET superseded_at=NULL WHERE id=?").run(v2.previousClaimId), /ALREADY_SUPERSEDED/);
  raw.close();
});

test("duplicate current identity is refused by 0020 when written directly", () => {
  const raw = seed();
  const now = new Date().toISOString();
  const ins = (id, qty, sheet) => raw.prepare(
    `INSERT INTO drawing_quantity_claims (id,project_id,document_id,document_version_id,sheet,floor_or_area,device_class,device_variant,semantics_version,quantity_type,quantity,count_method,evidence_fingerprint,state,authority_version,review_status,source_asset_ids,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(id, "proj1", "doc1", "ver1", sheet, "LEVEL 01", "T", "STANDARD", "s1", "PHYSICAL_DEVICE", qty, "PRINTED_CELL", "dqa_x", "PROVEN", "v1", "Approved", "[]", OWNER);
  ins("a1", 12, "SH-1");
  assert.throws(() => ins("a2", 12, "SH-1"), /UNIQUE constraint failed/);
  // NULL-safe: two rows differing only by a NULL sheet must still collide.
  ins("n1", 5, null);
  assert.throws(() => ins("n2", 5, null), /UNIQUE constraint failed/);
  void now;
  raw.close();
});

// ---- the WLC 6 x 2 case, and 79 vs 85 ----------------------------------------

test("WLC 6 x 2 Nos -> 12 physical quantity is persisted AS 12, never 6", async () => {
  const raw = seed();
  const res = await write(raw, baseInput({ physicalQuantity: 12 }));
  assert.equal(res.ok, true);
  assert.equal(res.claim.physicalQuantity ?? res.claim.quantity, 12,
    "6 recognition occurrences x an explicit '2 Nos' multiplier is 12 physical devices");
  const stored = raw.prepare("SELECT quantity FROM drawing_quantity_claims").get();
  assert.equal(stored.quantity, 12);
  assert.notEqual(stored.quantity, 6, "the occurrence count must never overwrite physical quantity");
  raw.close();
});

test("79 recognition occurrences does NOT overwrite the physical total 85", async () => {
  const raw = seed();
  // Four sheets, exactly as the drawing set splits them.
  const sheets = [["BOS", 25], ["GRS", 25], ["KGS", 23], ["WLC", 12]];
  for (const [tag, qty] of sheets) {
    const res = await write(raw, baseInput({ sheet: `2401232- PC- ${tag}- DR- T-93-ZZZ-005`, physicalQuantity: qty }));
    assert.equal(res.ok, true, `${tag} claim written`);
  }
  const total = raw.prepare("SELECT sum(quantity) t FROM drawing_quantity_claims WHERE device_class='T'").get().t;
  assert.equal(total, 85, "physical total is 85");

  // Now write a bogus recognition-count claim and prove it cannot replace it.
  const bogus = validateGovernedQuantityClaimInput(baseInput({ countMethod: "OCCURRENCE_COUNT", physicalQuantity: 79 }));
  assert.equal(bogus.ok, false, "79 occurrences cannot be written as physical authority");

  const after = raw.prepare("SELECT sum(quantity) t FROM drawing_quantity_claims WHERE device_class='T'").get().t;
  assert.equal(after, 85, "the physical total is unchanged by the refused occurrence count");
  raw.close();
});

// ---- canonical reader round-trip --------------------------------------------

test("writer -> storage -> CANONICAL READER returns the same governed value", async () => {
  const raw = seed();
  await write(raw, baseInput({ physicalQuantity: 12 }));

  // Read back through the canonical reader, not raw SQL, using the stored row.
  const row = raw.prepare("SELECT * FROM drawing_quantity_claims").get();
  const claim = {
    ...row,
    source_asset_ids: JSON.parse(row.source_asset_ids || "[]"),
    source_region: row.source_region ? JSON.parse(row.source_region) : null,
    discrepancy: row.discrepancy ? JSON.parse(row.discrepancy) : null,
    evidence_fingerprint: row.evidence_fingerprint,
    review: { status: row.review_status, reviewed_by: row.reviewed_by, reason: row.review_reason },
  };
  assert.equal(computeQuantityAuthorityFingerprint(claim), row.evidence_fingerprint,
    "the stored fingerprint matches the canonical derivation from the stored content");

  const read = readCurrentDrawingQuantityAuthority({
    claims: [claim],
    currentDocumentVersions: { doc1: "ver1" },
  });
  assert.equal(read.state, DRAWING_QUANTITY_AUTHORITY_STATES.READY);
  assert.equal(read.ready, true);
  assert.equal(read.quantity, 12, "the canonical reader reports the same governed quantity");
  raw.close();
});

test("the canonical reader reports MISSING, not a substitute, when a claim is stale", async () => {
  const raw = seed();
  await write(raw, baseInput());
  const row = raw.prepare("SELECT * FROM drawing_quantity_claims").get();
  const claim = {
    ...row,
    source_asset_ids: JSON.parse(row.source_asset_ids || "[]"),
    review: { status: row.review_status },
  };
  // The drawing moved on: the claim's version is no longer the head.
  const read = readCurrentDrawingQuantityAuthority({
    claims: [claim],
    currentDocumentVersions: { doc1: "ver2" },
  });
  assert.equal(read.ready, false);
  assert.equal(read.state, DRAWING_QUANTITY_AUTHORITY_STATES.STALE);
  assert.equal(read.quantity, null, "a stale claim yields no quantity, never a stale number");
  raw.close();
});

test("no claims at all -> MISSING, never zero and never an occurrence count", () => {
  const read = readCurrentDrawingQuantityAuthority({ claims: [], currentDocumentVersions: {} });
  assert.equal(read.state, DRAWING_QUANTITY_AUTHORITY_STATES.MISSING);
  assert.equal(read.quantity, null);
});

// ---- moved drawing head: currentness without rewriting history --------------

test("moving the drawing head makes the claim non-current WITHOUT rewriting it", async () => {
  const raw = seed();
  const first = await write(raw, baseInput());
  const before = raw.prepare("SELECT * FROM drawing_quantity_claims WHERE id=?").get(first.claim.id);

  // A new drawing revision arrives and becomes the head. Nothing about the claim
  // changes in storage -- it is simply no longer about the current drawing.
  raw.prepare("UPDATE documents SET current_version_id='ver2' WHERE id='doc1'").run();

  const after = raw.prepare("SELECT * FROM drawing_quantity_claims WHERE id=?").get(first.claim.id);
  assert.deepEqual(after, before, "historical evidence is untouched by the drawing moving on");
  assert.equal(after.superseded_at, null, "it is not retired either -- it is simply out of date");

  const claim = { ...after, source_asset_ids: JSON.parse(after.source_asset_ids), review: { status: after.review_status } };
  assert.equal(isCurrentQuantityClaim(claim, { currentDocumentVersionId: "ver2" }), false);
  assert.equal(isCurrentQuantityClaim(claim, { currentDocumentVersionId: "ver1" }), true, "current while the head is unchanged");

  // And the old version can no longer be written against: quantity authority must
  // be re-derived against the current drawing revision, not carried forward.
  const stale = await write(raw, baseInput({ documentVersionId: "ver1" }));
  assert.equal(stale.ok, false);
  assert.equal(stale.code, "STALE_DOCUMENT_VERSION");
  assert.match(stale.reason, /not the current head/, "the reason names the actual head");
  raw.close();
});

// ---- HTTP surface -----------------------------------------------------------

const ROUTE_URL = "https://app.example/api/projects/proj1/drawing-quantity-claims";
const envWith = (raw, actor = { APP_HUMAN_ID: OWNER, APP_HUMAN_NAME: "Fixture Reviewer" }) => ({ DB: d1(raw), ...actor });
const post = (url, body) => new Request(url, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: typeof body === "string" ? body : JSON.stringify(body),
});

test("the route ignores paths it does not own", async () => {
  const raw = seed();
  const res = await handleDrawingQuantityClaimApi(post("https://app.example/api/projects/proj1/other", {}), envWith(raw));
  assert.equal(res, null);
  raw.close();
});

test("the route refuses a write with no human actor configured", async () => {
  const raw = seed();
  const res = await handleDrawingQuantityClaimApi(post(ROUTE_URL, baseInput()), envWith(raw, {}));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "HUMAN_ACTOR_NOT_CONFIGURED");
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 0);
  raw.close();
});

test("the route refuses a synthetic actor", async () => {
  const raw = seed();
  const res = await handleDrawingQuantityClaimApi(
    post(ROUTE_URL, baseInput()),
    envWith(raw, { APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "Dev" }),
  );
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error.code, "HUMAN_ACTOR_ID_INVALID");
  raw.close();
});

test("the route refuses an unknown project and a project owned by someone else", async () => {
  const raw = seed();
  const missing = await handleDrawingQuantityClaimApi(
    post("https://app.example/api/projects/proj_nope/drawing-quantity-claims", baseInput()),
    envWith(raw),
  );
  assert.equal(missing.status, 404);
  assert.equal((await missing.json()).error.code, "PROJECT_NOT_FOUND");

  const foreign = await handleDrawingQuantityClaimApi(
    post("https://app.example/api/projects/proj2/drawing-quantity-claims", baseInput()),
    envWith(raw),
  );
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error.code, "PROJECT_FORBIDDEN");
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 0, "nothing written");
  raw.close();
});

test("the route refuses a non-JSON body", async () => {
  const raw = seed();
  const res = await handleDrawingQuantityClaimApi(post(ROUTE_URL, "not json"), envWith(raw));
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error.code, "INVALID_JSON");
  raw.close();
});

test("the route refuses a body naming someone else as the reviewer", async () => {
  const raw = seed();
  const res = await handleDrawingQuantityClaimApi(post(ROUTE_URL, baseInput({ reviewedBy: "someone_else" })), envWith(raw));
  assert.equal(res.status, 201, "the write is allowed but attribution is not forgeable");
  const row = raw.prepare("SELECT reviewed_by, created_by FROM drawing_quantity_claims").get();
  assert.equal(row.reviewed_by, OWNER, "attribution is the configured actor, not the request body");
  assert.equal(row.created_by, OWNER);
  raw.close();
});

test("a body claiming a different project than the URL is refused", async () => {
  const raw = seed();
  // The URL owns project identity, so a body naming another project is a body
  // whose evidence fingerprint was derived for a different project. Refusing is
  // the correct outcome -- the claim is not silently re-homed.
  const res = await handleDrawingQuantityClaimApi(post(ROUTE_URL, baseInput({ projectId: "proj2" })), envWith(raw));
  assert.equal(res.status, 409);
  assert.equal((await res.json()).error.code, "EVIDENCE_FINGERPRINT_MISMATCH");
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 0);
  raw.close();
});

test("the route writes, repeats idempotently, and supersedes -- 201 / 200 / 201", async () => {
  const raw = seed();
  const env = envWith(raw);
  const created = await handleDrawingQuantityClaimApi(post(ROUTE_URL, baseInput()), env);
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.action, "CREATED");
  assert.equal(createdBody.idempotent, false);
  assert.equal(createdBody.previousClaimId, null);
  assert.equal(createdBody.claim.physicalQuantity, 12);
  assert.equal(createdBody.claim.reviewStatus, "Approved");
  assert.equal(createdBody.claim.current, true);
  assert.ok(createdBody.claim.evidenceFingerprint);

  const repeat = await handleDrawingQuantityClaimApi(post(ROUTE_URL, baseInput()), env);
  assert.equal(repeat.status, 200);
  const repeatBody = await repeat.json();
  assert.equal(repeatBody.action, "NO_OP");
  assert.equal(repeatBody.idempotent, true);
  assert.equal(repeatBody.claim.id, createdBody.claim.id);

  const changed = await handleDrawingQuantityClaimApi(post(ROUTE_URL, baseInput({ physicalQuantity: 14 })), env);
  assert.equal(changed.status, 201);
  const changedBody = await changed.json();
  assert.equal(changedBody.action, "SUPERSEDED");
  assert.equal(changedBody.claim.versionNumber, 2);
  assert.equal(changedBody.previousClaimId, createdBody.claim.id);
  assert.equal(raw.prepare("SELECT count(*) c FROM drawing_quantity_claims").get().c, 2);
  raw.close();
});

test("the route surfaces the exact blocking reason for an ungoverned claim", async () => {
  const raw = seed();
  const res = await handleDrawingQuantityClaimApi(post(ROUTE_URL, baseInput({ countMethod: "OCCURRENCE_COUNT" })), envWith(raw));
  assert.equal(res.status, 422);
  const body = await res.json();
  assert.equal(body.error.code, "INVALID_COUNT_METHOD");
  assert.match(body.error.message, /no permitted method for turning a symbol-occurrence count/i);
  raw.close();
});

test("the route response never exposes a foreign-project row identity", async () => {
  const raw = seed();
  const res = await handleDrawingQuantityClaimApi(post(ROUTE_URL, baseInput()), envWith(raw));
  const text = await res.text();
  assert.doesNotMatch(text, /docX|proj2/, "no foreign row identity appears in the response");
  raw.close();
});

// ---- downstream contract: the Quantity -> BOQ link domain -------------------

test("a claim written here satisfies the downstream link domain's contract", async () => {
  const raw = seed();
  await write(raw, baseInput({ physicalQuantity: 12 }));
  // Handed over exactly as stored -- a D1 row, no shaping by the writer.
  const row = raw.prepare("SELECT * FROM drawing_quantity_claims").get();

  const verdict = evaluateLinkWrite({
    claim: row,
    boqItem: { id: "boq1", project_id: "proj1" },
    projectId: "proj1",
    currentDocumentVersionId: "ver1",
  });
  assert.equal(verdict.allowed, true, `expected no refusals, got ${JSON.stringify(verdict.refusals ?? [])}`);
  raw.close();
});

test("the downstream link domain refuses a stale, superseded, or unapproved claim", async () => {
  const raw = seed();
  const first = await write(raw, baseInput());
  const boqItem = { id: "boq1", project_id: "proj1" };
  const codeOf = (r) => (r.refusals ?? []).map((x) => x.code);

  // Superseded by a newer version.
  const v2 = await write(raw, baseInput({ physicalQuantity: 14 }));
  assert.match(codeOf(evaluateLinkWrite({ claim: raw.prepare("SELECT * FROM drawing_quantity_claims WHERE id=?").get(first.claim.id), boqItem, projectId: "proj1" })).join(), /SUPERSEDED_CLAIM/);
  assert.match(codeOf(evaluateLinkWrite({ claim: raw.prepare("SELECT * FROM drawing_quantity_claims WHERE id=?").get(v2.claim.id), boqItem, projectId: "proj1" })).join(), /^$/, "the replacement is linkable");

  // Bound to a superseded drawing revision.
  raw.prepare("UPDATE documents SET current_version_id='ver2' WHERE id='doc1'").run();
  assert.match(codeOf(evaluateLinkWrite({
    claim: raw.prepare("SELECT * FROM drawing_quantity_claims WHERE id=?").get(v2.claim.id),
    boqItem,
    projectId: "proj1",
    currentDocumentVersionId: "ver2",
  })).join(), /CLAIM_SUPERSEDED_DOCUMENT_VERSION/);

  // Fingerprint that does not describe its own content.
  const tampered = { ...raw.prepare("SELECT * FROM drawing_quantity_claims WHERE id=?").get(v2.claim.id), evidence_fingerprint: "dqa_not_its_own" };
  assert.match(codeOf(evaluateLinkWrite({ claim: tampered, boqItem, projectId: "proj1" })).join(), /CLAIM_FINGERPRINT_DRIFT/,
    "the derived fingerprint the writer stores is what makes the link domain able to detect drift");
  raw.close();
});

test("with no link authority at all, Address Demand stays blocked rather than zero", () => {
  // No link row exists, so the link domain refuses at its first gate. Which
  // named gate fires is the link domain's business; what matters here is that
  // nothing downstream can read a quantity.
  const verdict = evaluateLinkCurrency(null, { projectId: "proj1" });
  assert.equal(verdict.consumable, false);
  assert.equal(verdict.ready, false);
  assert.equal(verdict.quantity, null, "no authority means no quantity, never a zero");
  assert.ok(Object.values(DRAWING_QUANTITY_BOQ_LINK_STATES).includes(verdict.state), "the refusal names a governed link state");
});

test("no claims means the canonical quantity authority is MISSING, so no BOQ quantity flows", () => {
  const read = readCurrentDrawingQuantityAuthority({ claims: [], currentDocumentVersions: { doc1: "ver1" } });
  assert.equal(read.state, DRAWING_QUANTITY_AUTHORITY_STATES.MISSING);
  assert.equal(read.ready, false);
  for (const bucket of Object.values(read.byClass ?? {})) {
    assert.notEqual(bucket.quantity, 12, "no class silently acquires the WLC quantity");
  }
});

// ---- mount ------------------------------------------------------------------

test("the writer route is MOUNTED in the worker router", async () => {
  const { readFile } = await import("node:fs/promises");
  const index = await readFile(new URL("../worker/index.ts", import.meta.url), "utf8");
  assert.match(index, /import \{ handleDrawingQuantityClaimApi \}/, "the handler is imported");
  assert.match(index, /await handleDrawingQuantityClaimApi\(request, env\)/, "the handler is dispatched");
  assert.match(index, /if \(drawingQuantityClaimApiResponse\) return secured\(drawingQuantityClaimApiResponse\)/, "the response is returned through the secured path");
});
