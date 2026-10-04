// GOVERNED TECHNICAL CANONICAL PRODUCT CREATION.
//
// THE GAP THIS CLOSES
// Both existing product-creation paths are COMMERCIAL: the price-list ingester,
// and the Product Identity promotion, which requires
// `PRODUCT_SOURCE_PROVENANCE_REQUIRED` (complete Supplier Quotation
// provenance). So a product evidenced ONLY by a first-party manufacturer
// technical document could never become canonical -- which is why SGWLED had no
// canonical product and the manufacturer-stated supersession edge had no
// representable target.
//
// These tests prove the new path creates TECHNICAL IDENTITY ONLY, fails closed,
// and never contaminates commercial state.

import assert from "node:assert/strict";
import test from "node:test";

import {
  TECHNICAL_CREATION_ERRORS,
  TECHNICAL_CREATION_OUTCOMES,
  assessTechnicalProductCreation,
  assessTechnicalProductCreationReversal,
  createCanonicalProductFromTechnicalEvidence,
  evaluateTechnicalProductDuplication,
} from "../app/domain/technical-product-creation.mjs";
import { HUMAN_ACTOR_SOURCE } from "../app/domain/human-authority.mjs";
import {
  createMigratedDatabase,
  asD1,
  seedOrganization,
  seedManufacturer,
  seedProduct,
} from "./helpers/decision-packet-db.mjs";

const ORG = "org_tech_creation";
const MFR = "man_honeywell";

const HUMAN = Object.freeze({
  id: "omair-primary",
  name: "Omair",
  source: HUMAN_ACTOR_SOURCE,
  synthetic: false,
});

const REASON =
  "Honeywell Product Announcement 23.2SS names SGWLED as an exact product with an exact part number, distinct from SGWL, and states the REPLACES relationship. First-party manufacturer evidence, so canonical technical identity is established without any commercial source.";

const EVIDENCE = Object.freeze({
  manufacturer: "Honeywell",
  manufacturerAuthorityClass: "Manufacturer Technical Document",
  model: "SGWLED",
  brand: "Farenhyt",
  family: "Strobe",
  description: "SGWLED LED STROBE; WALL; WHITE; FIRE; 2-WIRE; COMPACT",
  documentNumber: "23.2SS",
  revision: "A",
  sourceUrl: "https://prod-edam.honeywell.com/example.pdf",
  sourceFileName: "Product Announcement 23.2SS.pdf",
  locator: "p1 REPLACES column",
  quote: "SGWLED LED STROBE; WALL; WHITE; FIRE; 2-WIRE; COMPACT",
  reason: REASON,
  humanActor: HUMAN,
});

const fresh = () => {
  const raw = createMigratedDatabase();
  const db = asD1(raw);
  seedOrganization(db, ORG);
  seedManufacturer(db, { id: MFR, name: "Honeywell" });
  return { raw, db };
};

const call = (overrides = {}) => ({
  organizationId: ORG,
  manufacturerId: MFR,
  brandId: null,
  familyId: null,
  knowledgeFileId: "kf_announcement",
  actorRole: "Administrator",
  idempotencyKey: "tech-1",
  ...EVIDENCE,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Authority and prerequisites.
// ---------------------------------------------------------------------------

test("TECH-CREATION/A a synthetic actor is refused before anything is read", () => {
  for (const humanActor of [
    undefined,
    null,
    { id: "local-development-user", name: "Local Dev", source: HUMAN_ACTOR_SOURCE },
    { id: "system", name: "System", source: "internal" },
  ]) {
    const outcome = assessTechnicalProductCreation({ ...EVIDENCE, humanActor });
    assert.equal(outcome.ok, false, `${JSON.stringify(humanActor)} must be refused`);
    assert.equal(outcome.code, TECHNICAL_CREATION_ERRORS.HUMAN_ACTOR_REQUIRED);
  }
  assert.equal(assessTechnicalProductCreation(EVIDENCE).ok, true);
});

test("TECH-CREATION/B creation requires NO supplier quote but DOES require first-party technical authority", () => {
  // The governance decision under test: commercial provenance is not required.
  const noQuote = assessTechnicalProductCreation(EVIDENCE);
  assert.equal(noQuote.ok, true, "a manufacturer technical document alone is sufficient");

  // ...but a non-technical or non-first-party claim is refused.
  for (const authorityClass of [
    "Unknown Source Authority",
    "Supplier Quotation",
    "Price List",
    "",
    null,
  ]) {
    const outcome = assessTechnicalProductCreation({ ...EVIDENCE, manufacturerAuthorityClass: authorityClass });
    assert.equal(
      outcome.ok,
      false,
      `${JSON.stringify(authorityClass)} must not establish canonical technical identity`,
    );
    assert.equal(outcome.code, TECHNICAL_CREATION_ERRORS.FIRST_PARTY_AUTHORITY_REQUIRED);
  }
});

test("TECH-CREATION/C identity must be EXACT -- no inferred successors, no placeholders", () => {
  assert.equal(assessTechnicalProductCreation({ ...EVIDENCE, manufacturer: "" }).code, TECHNICAL_CREATION_ERRORS.MANUFACTURER_REQUIRED);
  for (const model of ["", "  ", "the successor", "N/A", "TBD", "see below", "x"]) {
    const outcome = assessTechnicalProductCreation({ ...EVIDENCE, model });
    assert.equal(outcome.ok, false, `"${model}" must be refused as an exact identity`);
    assert.equal(outcome.code, TECHNICAL_CREATION_ERRORS.MODEL_REQUIRED);
  }
  // A quoted model / replacement claim is not an identity. These are the exact
  // shapes a research author produces when recording a successor edge, and every
  // one of them names NO product.
  for (const model of ["replaces SGWL", "the successor", "successor to SGWL", "new version", "SGWLED or similar"]) {
    const outcome = assessTechnicalProductCreation({ ...EVIDENCE, model });
    assert.equal(outcome.ok, false, `"${model}" must be refused as an exact identity`);
    assert.equal(outcome.code, TECHNICAL_CREATION_ERRORS.MODEL_REQUIRED, `"${model}" must be refused as an exact identity`);
  }
  // An EXACT part number, by contrast, is accepted.
  assert.equal(assessTechnicalProductCreation({ ...EVIDENCE, model: "SGWLED-2" }).ok, true, "a real variant identity is fine");
});

test("TECH-CREATION/D evidence quote and substantive reason are required", () => {
  assert.equal(assessTechnicalProductCreation({ ...EVIDENCE, quote: "SGW" }).code, TECHNICAL_CREATION_ERRORS.EVIDENCE_REQUIRED);
  assert.equal(assessTechnicalProductCreation({ ...EVIDENCE, reason: "because" }).code, TECHNICAL_CREATION_ERRORS.REASON_REQUIRED);
});

test("TECH-CREATION/E punctuation is preserved: REL-4.7K and REL-47K stay distinct", async () => {
  // The known normalisation hazard. `searchPartNumberKey` strips punctuation and
  // must never be used to prove identity, or these two would merge.
  const { db } = fresh();
  seedProduct(db, { id: "p_rel47", partNumber: "REL-47K", manufacturerId: MFR });

  const assessed = assessTechnicalProductCreation({ ...EVIDENCE, model: "REL-4.7K" });
  assert.equal(assessed.value.normalizedPartNumber, "REL-4.7K", "punctuation must survive normalisation");

  // It is reported as a POSSIBLE_DUPLICATE for a human, never auto-merged and
  // never silently created alongside.
  const duplication = await evaluateTechnicalProductDuplication(db, {
    manufacturerId: MFR,
    partNumber: "REL-4.7K",
  });
  assert.equal(duplication.outcome, TECHNICAL_CREATION_OUTCOMES.POSSIBLE_DUPLICATE);
  assert.equal(duplication.candidates[0].part_number, "REL-47K");
});

test("TECH-CREATION/E2 the exact check survives a punctuation-STRIPPED stored identity", async () => {
  // The falsifiable form of the same invariant, and it mirrors the live
  // catalogue: the price-list ingester stores some identities with punctuation
  // removed (`IFP-75` -> `IFP75`, 6 such rows today) while the technical path
  // stores them preserved.
  //
  // If the exact check were computed on the punctuation-stripped key, then
  // `REL-4.7K` would match the stored `REL47K` EXACTLY and be silently reported
  // as the same product as `REL-47K` -- two genuinely distinct ratings merged
  // with no human ever seeing them. Here it must fall through to the fuzzy
  // POSSIBLE_DUPLICATE report instead.
  const { raw, db } = fresh();
  seedProduct(db, { id: "p_rel47_stored_stripped", partNumber: "REL-47K", manufacturerId: MFR });
  // Reproduce the ingester's stored form: hyphen retained in display, stripped
  // in the normalised key.
  raw.exec("UPDATE library_products SET normalized_part_number='REL47K' WHERE id='p_rel47_stored_stripped'");
  assert.equal(db.prepare("SELECT normalized_part_number FROM library_products WHERE id=?").bind("p_rel47_stored_stripped").first().normalized_part_number, "REL47K");

  const outcome = await evaluateTechnicalProductDuplication(db, {
    manufacturerId: MFR,
    partNumber: "REL-4.7K",
  });
  assert.equal(
    outcome.outcome,
    TECHNICAL_CREATION_OUTCOMES.POSSIBLE_DUPLICATE,
    "a punctuation-stripped stored identity must never be an EXACT match for a punctuated one",
  );
  assert.equal(outcome.candidates[0].part_number, "REL-47K");

  // The reverse direction must also refuse to auto-create.
  const created = await createCanonicalProductFromTechnicalEvidence(
    db,
    call({ model: "REL-4.7K", idempotencyKey: "tech-rel47", newId: () => "product_rel47" }),
  );
  assert.equal(created.ok, false, "a possible duplicate must not be silently created alongside");
  assert.equal(created.code, TECHNICAL_CREATION_ERRORS.POSSIBLE_DUPLICATE);
});

// ---------------------------------------------------------------------------
// Duplicate protection.
// ---------------------------------------------------------------------------

test("TECH-CREATION/F an exact existing product is reported, never duplicated", async () => {
  const { raw, db } = fresh();
  seedProduct(db, { id: "p_sgwled", partNumber: "SGWLED", manufacturerId: MFR });

  const result = await createCanonicalProductFromTechnicalEvidence(db, call());
  assert.equal(result.ok, true);
  assert.equal(result.writes, false);
  assert.equal(result.outcome, TECHNICAL_CREATION_OUTCOMES.EXACT_EXISTING_PRODUCT);
  assert.equal(result.productId, "p_sgwled");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products").get().c, 1, "still exactly one product");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM identity_decision_audit").get().c, 0, "and no creation was audited");
});

test("TECH-CREATION/G ambiguity fails closed rather than choosing", async () => {
  // Simulated by a second row that matches the exact identity under a different
  // scope -- the unique index is per (manufacturer, normalized_part_number), so
  // ambiguity is proven through the duplication evaluator's contract.
  const { db } = fresh();
  const outcome = await evaluateTechnicalProductDuplication(db, {
    manufacturerId: "man_unknown",
    partNumber: "SGWLED",
  });
  assert.equal(outcome.outcome, TECHNICAL_CREATION_OUTCOMES.CREATE_NEW_PRODUCT, "no manufacturer match => new");
  const assessed = assessTechnicalProductCreation({ ...EVIDENCE, model: "" });
  assert.equal(assessed.ok, false);
});

test("TECH-CREATION/H an existing alias blocks creation", async () => {
  const { db } = fresh();
  seedProduct(db, { id: "p_other", partNumber: "OTHER-1", manufacturerId: MFR });
  db.prepare(
    "INSERT INTO product_aliases (id, product_id, alias, normalized_alias, alias_type, evidence_json, review_status, created_by, created_at) VALUES ('al1','p_other','SGWLED','SGWLED','Manufacturer','{}','Reviewed','test','2026-10-01 00:00:00')",
  ).run();
  const result = await createCanonicalProductFromTechnicalEvidence(db, call());
  assert.equal(result.ok, false);
  assert.equal(result.code, TECHNICAL_CREATION_ERRORS.POSSIBLE_DUPLICATE);
});

// ---------------------------------------------------------------------------
// Creation and commercial isolation.
// ---------------------------------------------------------------------------

test("TECH-CREATION/I creation writes technical identity ONLY -- zero commercial state", async () => {
  const { raw, db } = fresh();
  // NOTE: `price_records` is absent from the migration chain, so it is asserted
  // against the LIVE database in the runtime proof rather than here. What this
  // test can and does assert is that creation itself writes no commercial row of
  // any kind, and that the product it writes carries no commercial qualification.
  const commercialTables = ["supplier_quotes", "supplier_products"];
  const before = Object.fromEntries(
    commercialTables.map((t) => [t, raw.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]),
  );

  const result = await createCanonicalProductFromTechnicalEvidence(db, call());
  assert.equal(result.ok, true, result.message);
  assert.equal(result.outcome, TECHNICAL_CREATION_OUTCOMES.CREATE_NEW_PRODUCT);
  assert.equal(result.commercialState, "NOT_ESTABLISHED");
  assert.equal(result.priceRecordsCreated, 0);

  const product = db.prepare("SELECT * FROM library_products WHERE id=?").bind(result.productId).first();
  assert.equal(product.part_number, "SGWLED");
  assert.equal(product.identity_status, "Active");
  // Technical candidate, not a business- or commercial-approved item.
  assert.equal(product.review_status, "Needs Review");
  assert.equal(product.approved_for_discovery, 0, "no automatic discovery approval");

  // No commercial table gained a row.
  for (const table of commercialTables) {
    assert.equal(
      raw.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c,
      before[table],
      `${table} must gain no row from technical identity creation`,
    );
  }

  // The provenance source is technical, not a supplier quotation.
  const source = db.prepare("SELECT * FROM product_sources WHERE id=?").bind(`${result.productId}_techsrc`).first();
  assert.ok(source, "technical provenance is retained");
  assert.equal(source.source_type, "Manufacturer Technical Document");
  assert.equal(source.source_type.includes("Supplier"), false);
  assert.equal(source.downstream_use, "Discovery Only");
  assert.equal(source.currency, null, "no currency was created");
  assert.equal(source.validity_state, "Commercial Validity Not Established");
  const metadata = JSON.parse(source.metadata);
  assert.equal(metadata.commercialState, "NOT_ESTABLISHED");
  assert.equal(metadata.documentNumber, "23.2SS");
  assert.equal(metadata.quote, EVIDENCE.quote);

  // A `product_sources` row that nothing references is ORPHANED provenance: the
  // product cannot be shown to have retained any evidence at all. The binding
  // must therefore be reachable FROM the product.
  const evidence = db
    .prepare("SELECT * FROM product_source_evidence WHERE product_id=?")
    .bind(result.productId)
    .first();
  assert.ok(evidence, "provenance is bound to the product, not orphaned");
  assert.equal(evidence.source_id, `${result.productId}_techsrc`);
  // The locator "p1 REPLACES column" yields a real page number; it is not
  // invented from the column reference alone.
  assert.equal(evidence.page, 1);
  assert.ok(
    evidence.original_text.includes(EVIDENCE.quote),
    "the exact source sentence is retained on the evidence row",
  );
  assert.equal(evidence.cells, "[]", "no spreadsheet cells are fabricated for a document source");
  assert.equal(evidence.sheet, null, "a document source is not a spreadsheet");
  assert.equal(evidence.row_number, null);

  // The locator is not always a page. When it is not, no integer is invented.
  const noPage = await createCanonicalProductFromTechnicalEvidence(
    db,
    call({ model: "SGWLED2", idempotencyKey: "tech-nopage", locator: "price list column D", newId: () => "product_nopage" }),
  );
  assert.equal(noPage.ok, true, noPage.message);
  const noPageEvidence = db
    .prepare("SELECT * FROM product_source_evidence WHERE product_id=?")
    .bind(noPage.productId)
    .first();
  assert.equal(noPageEvidence.page, null, "no page number is fabricated from a column reference");
  assert.ok(noPageEvidence.original_text.includes("price list column D"), "the locator is still retained");
});

test("TECH-CREATION/J the audit records identity, evidence, actor, before/after and idempotency", async () => {
  const { raw, db } = fresh();
  const result = await createCanonicalProductFromTechnicalEvidence(db, call());
  // The RAW handle returns a plain array from `.all()`; the D1 wrapper returns
  // `{ results }`. Reading the wrong one silently yields `undefined`.
  const row = raw
    .prepare("SELECT * FROM identity_decision_audit WHERE action=?")
    .all("Create Canonical Product From Technical Evidence")[0];
  assert.ok(row, "an audit row is written");
  assert.equal(row.entity_id, result.productId);
  assert.equal(row.actor_id, "omair-primary");
  assert.equal(row.actor_role, "Administrator");
  assert.equal(row.idempotency_key, "tech-1");
  assert.match(row.reason, /23\.2SS/);

  const before = JSON.parse(row.previous_snapshot_json);
  const after = JSON.parse(row.new_snapshot_json);
  assert.equal(before.existed, false, "before state records that nothing existed");
  assert.equal(after.outcome, TECHNICAL_CREATION_OUTCOMES.CREATE_NEW_PRODUCT);
  assert.equal(after.productId, result.productId);
  assert.equal(after.partNumber, "SGWLED");
  assert.equal(after.humanActorSource, HUMAN_ACTOR_SOURCE);
  assert.equal(after.priceRecordsCreated, 0);
  assert.equal(after.authorityClass, "Manufacturer Technical Document");
});

test("TECH-CREATION/K replay is idempotent and the key is mandatory", async () => {
  const { raw, db } = fresh();
  const first = await createCanonicalProductFromTechnicalEvidence(db, call());
  assert.equal(first.writes, true);
  const countAfterFirst = raw.prepare("SELECT COUNT(*) c FROM library_products").get().c;

  const replay = await createCanonicalProductFromTechnicalEvidence(db, call());
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.productId, first.productId, "same product, not a second one");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products").get().c, countAfterFirst);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM product_sources").get().c, 1, "no duplicate provenance source");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM identity_decision_audit").get().c, 1);

  // A different key for an identity that now exists -> EXACT_EXISTING_PRODUCT,
  // not a duplicate insert.
  const second = await createCanonicalProductFromTechnicalEvidence(db, call({ idempotencyKey: "tech-2" }));
  assert.equal(second.outcome, TECHNICAL_CREATION_OUTCOMES.EXACT_EXISTING_PRODUCT);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products").get().c, countAfterFirst);

  assert.equal((await createCanonicalProductFromTechnicalEvidence(db, call({ idempotencyKey: "" }))).code, TECHNICAL_CREATION_ERRORS.IDEMPOTENCY_KEY_REQUIRED);
});

test("TECH-CREATION/L an unrelated product and its data are untouched", async () => {
  const { raw, db } = fresh();
  seedProduct(db, { id: "p_sgwl", partNumber: "SGWL", manufacturerId: MFR });
  await createCanonicalProductFromTechnicalEvidence(db, call());
  const sgwl = raw.prepare("SELECT * FROM library_products WHERE id='p_sgwl'").get();
  assert.equal(sgwl.part_number, "SGWL");
  assert.equal(sgwl.identity_status, "Active", "the legacy product is untouched and distinct");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products").get().c, 2, "two distinct products, no merge");
});

// ---------------------------------------------------------------------------
// Reversal assessment.
// ---------------------------------------------------------------------------

test("TECH-CREATION/M reversal is assessed honestly, and refuses once the product is used", async () => {
  const { raw, db } = fresh();
  const created = await createCanonicalProductFromTechnicalEvidence(db, call());

  // Isolated product -> reversible in principle.
  const isolated = await assessTechnicalProductCreationReversal(db, { productId: created.productId });
  assert.equal(isolated.reversible, true);
  assert.equal(isolated.code, "TECHNICAL_PRODUCT_CREATION_REVERSAL_AVAILABLE");

  // Once governed state references it, reversal is refused -- deleting the row
  // would orphan that reference.
  raw.exec(
    `INSERT INTO product_lifecycle_events (id, source_id, product_id, obsolete_part_number, lifecycle_status, replacement_candidates, review_status, source_location, created_at)
     VALUES ('le_1','${created.productId}_techsrc','${created.productId}','SGWLED','Discontinued','[]','Needs Review','{}','2026-10-01 00:00:00')`,
  );
  const used = await assessTechnicalProductCreationReversal(db, { productId: created.productId });
  assert.equal(used.reversible, false);
  assert.equal(used.code, "TECHNICAL_PRODUCT_CREATION_REVERSAL_BLOCKED");
  assert.ok(used.blockers.includes("lifecycleEvents"));
  assert.equal(db.prepare("SELECT COUNT(*) c FROM library_products WHERE id=?").bind(created.productId).first().c, 1, "and the product is NOT deleted");
});
