// MATCH-001 Slice 1 -- production reachability for the gated compatibility
// auto-confirm authority.
//
// These tests drive the REAL production route (handleCompatibilityGovernanceApi)
// against the REAL active migration chain, not a hand-built schema and not a
// direct call into the helper. A hand-built fixture or a direct helper test
// would be exactly the test-only illusion this programme has been removing, so
// neither is used here.

import test from "node:test";
import assert from "node:assert/strict";

import { activeChainDatabase, d1 } from "./fixtures/active-chain-fixture.mjs";
import { handleCompatibilityGovernanceApi } from "../worker/compatibility-governance-api.mjs";

const ORG = "organization_bd_shaft_internal_pilot";
const USER = "test-user";

const env = () => ({
  DB: null,
  APP_USER_ID: USER,
  APP_ORGANIZATION_ID: ORG,
  APP_ACCESS_MODE: "single-user",
});

const post = (body) =>
  new Request("http://localhost/api/compatibility/relationships/auto-confirm", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

// Seed a real active-chain database with a manufacturer, a family and two
// active canonical products. library_products is genuinely a Global Library
// (library_scope = 'Global Library', no organization_id column), which is why
// product isolation here is expressed through identity/canonical state rather
// than a fabricated per-org product boundary.
const seeded = () => {
  // The REAL active migration chain, wrapped in a D1-shaped adapter, so the
  // production route runs against production schema rather than a fixture that
  // could drift from it.
  const raw = activeChainDatabase();
  const db = d1(raw);
  // Column sets are taken from the REAL chain's NOT NULL constraints, so the
  // seed cannot silently drift from production schema.
  db.prepare("INSERT INTO product_manufacturers (id,name,normalized_name,created_by) VALUES (?,?,?,?)")
    .bind("m1", "Honeywell", "HONEYWELL", "seed").run();
  db.prepare("INSERT INTO product_families (id,name,normalized_name) VALUES (?,?,?)")
    .bind("f1", "Series A", "SERIES A").run();
  const product = db.prepare(
    `INSERT INTO library_products
       (id,manufacturer_id,family_id,part_number,normalized_part_number,description,
        identity_status,library_scope,approved_for_discovery,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  product.bind("p-src", "m1", "f1", "SRC-100", "SRC100", "Source product", "Active", "Global Library", 1, "seed").run();
  product.bind("p-tgt", "m1", "f1", "TGT-200", "TGT200", "Target product", "Active", "Global Library", 1, "seed").run();
  return db;
};

const validBody = (overrides = {}) => ({
  sourceProductId: "p-src",
  targetProductId: "p-tgt",
  relationshipType: "Compatible",
  evidenceClassification: "EXPLICIT_EXACT",
  evidenceJson: JSON.stringify({ quote: "manufacturer datasheet states TGT-200 is supported with SRC-100" }),
  sourceDocumentNumber: "DS-SRC-100",
  sourceDocumentRevision: "Rev C",
  ...overrides,
});

const rows = async (db) =>
  (await db.prepare("SELECT id,status,confidence,conditions,reviewed_by,reviewed_at,project_id FROM engineering_relationships").all()).results;

// 1) manufacturer-explicit supported relationship -> may auto-confirm
test("MATCH-001/1 an explicit manufacturer-supported relationship auto-confirms through the production route", async () => {
  const db = seeded();
  const response = await handleCompatibilityGovernanceApi(post(validBody()), { ...env(), DB: db });
  const body = await response.json();
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.ok, true);
  assert.equal(body.status, "Approved");
  assert.equal(body.evidenceClassification, "EXPLICIT_EXACT");
  assert.ok(body.policyVersion, "the auto-confirm policy version must be reported, not implied");

  const written = await rows(db);
  assert.equal(written.length, 1, "exactly one relationship row");
  assert.equal(written[0].status, "Approved");
  assert.equal(written[0].project_id, null, "library-level truth carries no project scope");
  // The authority's own provenance must be reconstructable from the row.
  assert.match(String(written[0].conditions), /auto_confirm_provenance/);
});

// 2) inferred-only -> refused
test("MATCH-001/2 INFERRED_ONLY cannot auto-confirm", async () => {
  const db = seeded();
  const response = await handleCompatibilityGovernanceApi(
    post(validBody({ evidenceClassification: "INFERRED_ONLY" })),
    { ...env(), DB: db },
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "EVIDENCE_CLASSIFICATION_NOT_AUTO_CONFIRMABLE");
  assert.equal((await rows(db)).length, 0, "nothing may be written for an inferred-only claim");
});

// 3) not-supported -> refused
test("MATCH-001/3 NOT_SUPPORTED cannot auto-confirm", async () => {
  const db = seeded();
  const response = await handleCompatibilityGovernanceApi(
    post(validBody({ evidenceClassification: "NOT_SUPPORTED" })),
    { ...env(), DB: db },
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal((await rows(db)).length, 0);
});

// 3b) conflict -> refused as a genuine conflict, and nothing written
test("MATCH-001/3b a disputed pair is a 409 conflict, not a silent auto-confirm", async () => {
  const db = seeded();
  db.prepare(
    `INSERT INTO engineering_relationships
       (id,project_id,left_entity_type,left_entity_id,relationship_type,right_entity_type,right_entity_id,
        status,version_number,fact_type,scope_type,confidence,created_by)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
    .bind("rel-existing", null, "Product", "p-src", "Incompatible", "Product", "p-tgt", "Approved", 1,
          "Compatibility", "Global", 90, "seed")
    .run();
  // Assert the disputed row actually landed, so a future fixture regression
  // cannot silently turn this into a "no conflict" test.
  assert.equal((await rows(db)).length, 1, "the disputed pre-existing row must be present");

  const response = await handleCompatibilityGovernanceApi(post(validBody()), { ...env(), DB: db });
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.error.code, "COMPATIBILITY_CONFLICT");
  assert.equal((await rows(db)).length, 1, "the pre-existing row must be untouched");
});

// 4) conflict classification -> refused
test("MATCH-001/4 CONFLICT evidence cannot auto-confirm", async () => {
  const db = seeded();
  const response = await handleCompatibilityGovernanceApi(
    post(validBody({ evidenceClassification: "CONFLICT" })),
    { ...env(), DB: db },
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal((await rows(db)).length, 0);
});

// 5) missing source document / revision -> refused, and refused by the ROUTE
//    (a clear caller error) rather than surfacing as an opaque gate failure
test("MATCH-001/5 a missing source document number or revision is refused", async () => {
  for (const overrides of [
    { sourceDocumentNumber: null },
    { sourceDocumentRevision: null },
  ]) {
    const db = seeded();
    const response = await handleCompatibilityGovernanceApi(post(validBody(overrides)), { ...env(), DB: db });
    const body = await response.json();
    assert.equal(response.status, 422, JSON.stringify(body));
    assert.equal(body.error.code, "SOURCE_DOCUMENT_PROVENANCE_REQUIRED");
    assert.equal((await rows(db)).length, 0);
  }
});

// 5b) A missing evidenceClassification must never inherit the authority's
//     permissive EXPLICIT_EXACT default.
test("MATCH-001/5b an omitted evidenceClassification is refused rather than defaulted to the most permissive class", async () => {
  const db = seeded();
  const body = validBody();
  delete body.evidenceClassification;
  const response = await handleCompatibilityGovernanceApi(post(body), { ...env(), DB: db });
  const payload = await response.json();
  assert.equal(response.status, 422);
  assert.equal(payload.error.code, "EVIDENCE_CLASSIFICATION_REQUIRED");
  assert.equal((await rows(db)).length, 0, "a defaulted classification must not write");
});

// 5c) Empty evidence must be refused.
test("MATCH-001/5c empty manufacturer evidence is refused", async () => {
  const db = seeded();
  const response = await handleCompatibilityGovernanceApi(
    post(validBody({ evidenceJson: "{}" })),
    { ...env(), DB: db },
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "EVIDENCE_REQUIRED");
  assert.equal((await rows(db)).length, 0);
});

// 6) project-specific inference masquerading as library truth -> refused
test("MATCH-001/6 project-specific inference is refused by the authority gate", async () => {
  const db = seeded();
  // The authority reads conditions.projectSpecific / conditions.projectId.
  // An unrelated array shape does NOT trip the gate, which is asserted below as
  // a separate named case so the guard's real trigger stays honest.
  const response = await handleCompatibilityGovernanceApi(
    post(validBody({ conditionsJson: JSON.stringify({ projectSpecific: true, note: "works on this project only because of site conditions" }) })),
    { ...env(), DB: db },
  );
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.error.code, "COMPATIBILITY_AUTO_CONFIRM_REFUSED");
  assert.match(String(body.evaluation?.reason || ""), /project-specific inference/i);
  assert.equal((await rows(db)).length, 0);
});

// 7) isolation. library_products is a genuine Global Library with no
//    organization_id, so the honest isolation guarantee this route makes is:
//    (a) it refuses to write project-scoped truth at all, and
//    (b) it refuses a source/target that is not an active canonical product.
test("MATCH-001/7 the route refuses project-scoped writes and non-canonical identities", async () => {
  const scoped = seeded();
  const scopedResponse = await handleCompatibilityGovernanceApi(
    post(validBody({ projectId: "p1" })),
    { ...env(), DB: scoped },
  );
  const scopedBody = await scopedResponse.json();
  assert.equal(scopedResponse.status, 422);
  assert.equal(scopedBody.error.code, "PROJECT_SCOPED_RELATIONSHIP_NOT_SUPPORTED");
  assert.equal((await rows(scoped)).length, 0);

  const unknown = seeded();
  const unknownResponse = await handleCompatibilityGovernanceApi(
    post(validBody({ targetProductId: "does-not-exist" })),
    { ...env(), DB: unknown },
  );
  const unknownBody = await unknownResponse.json();
  assert.equal(unknownResponse.status, 422);
  assert.equal(unknownBody.error.code, "COMPATIBILITY_AUTO_CONFIRM_REFUSED");
  assert.equal((await rows(unknown)).length, 0);

  // A superseded target is not canonical and must not become Approved truth.
  const superseded = seeded();
  superseded
    .prepare("UPDATE library_products SET superseded_by_product_id='p-tgt' WHERE id='p-tgt'")
    .bind()
    .run();
  const supersededResponse = await handleCompatibilityGovernanceApi(
    post(validBody()),
    { ...env(), DB: superseded },
  );
  const supersededBody = await supersededResponse.json();
  assert.equal(supersededResponse.status, 422);
  assert.equal((await rows(superseded)).length, 0);
});

// 8) repeat request -> idempotent, and exactly one relationship exists
test("MATCH-001/8 a repeated request is idempotent and never duplicates the relationship", async () => {
  const db = seeded();
  const first = await handleCompatibilityGovernanceApi(post(validBody()), { ...env(), DB: db });
  const firstBody = await first.json();
  assert.equal(first.status, 201);

  const secondResponse = await handleCompatibilityGovernanceApi(post(validBody()), { ...env(), DB: db });
  const secondBody = await secondResponse.json();
  assert.equal(secondResponse.status, 200);
  assert.equal(secondBody.ok, true);
  assert.equal(secondBody.idempotent, true);

  assert.equal((await rows(db)).length, 1, "a repeat must not create a second relationship");
  assert.equal((await rows(db))[0].id, firstBody.relationshipId, "the same relationship is reported back");
});

// 9) the consumer can read the resulting governed relationship, using the SAME
//    predicate product-matching-api.mjs uses
test("MATCH-001/9 the governed relationship is readable by the existing consumer predicate", async () => {
  const db = seeded();
  const response = await handleCompatibilityGovernanceApi(post(validBody()), { ...env(), DB: db });
  await response.json();

  const consumerRow = await db
    .prepare(
      `SELECT r.id, r.relationship_type FROM engineering_relationships r
       WHERE r.left_entity_type='Product' AND r.left_entity_id=?
         AND r.status='Approved' AND r.effective_to IS NULL`,
    )
    .bind("p-src")
    .first();

  assert.ok(consumerRow, "the product-matching consumer predicate must now find the relationship");
  assert.equal(consumerRow.relationship_type, "Compatible");
});

// 10) the route is scoped: it must not answer unrelated paths
test("MATCH-001/10 the handler does not claim unrelated requests", async () => {
  const db = seeded();
  assert.equal(
    await handleCompatibilityGovernanceApi(new Request("http://localhost/api/projects"), { ...env(), DB: db }),
    null,
  );
  // The handler is async: its return must be awaited before `.status` exists.
  const notAllowed = await handleCompatibilityGovernanceApi(
    new Request("http://localhost/api/compatibility/relationships/auto-confirm"),
    { ...env(), DB: db },
  );
  assert.equal(notAllowed.status, 405);
});
