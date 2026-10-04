import assert from "node:assert/strict";
import test from "node:test";

import {
  FIRST_PARTY_MANUFACTURER_SOURCE_TYPES,
  evaluateProductAttributeReview,
  evaluateProductCertificationReview,
} from "../worker/product-attribute-review.mjs";

// FIRST-PARTY MANUFACTURER EVIDENCE GATE
//
// Gate 3 of the attribute review accepted ONLY source_type "Product Datasheet".
// That is narrower than the governing evidence hierarchy itself
// (ai-pricing-agent-workflow §9A.2), whose FIRST-listed product-truth source is the
// exact-model INSTALLATION AND OPERATION MANUAL, ahead of the datasheet.
//
// Measured consequence: the official Honeywell IFP-2100 / IFP-2100ECS
// Installation and Operation Manual (P/N LS10143-001SK-E rev C) was refused as
// evidence -- so the strongest first-party evidence of panel capabilities was
// blocked while a weaker form of the same manufacturer's evidence was accepted.
//
// The repair widens the accepted set to a CLOSED allowlist of first-party
// manufacturer document types, and additionally requires authority "Official
// Manufacturer", so a same-named source from any other authority is still refused.

// Every attribute here is backed by source "s1"; the "no source" case is covered
// by its own test with `withSource: false`.
const attribute = () => ({
  id: "attr-1",
  product_id: "p",
  attribute_name: "peer_to_peer_network",
  normalized_value: "true",
  review_status: "Needs Review",
  deleted_at: null,
  superseded_at: null,
  evidence_json: JSON.stringify({ exactText: "a verbatim quote from the document", page: 12, documentVersionId: "v1" }),
  source_id: "s1",
});

const source = (row) => ({
  id: "s1",
  source_type: "Product Datasheet",
  authority: "Official Manufacturer",
  review_status: "Needs Review",
  file_name: "official.pdf",
  ...row,
});

const gate = (gates, name) => gates.find((g) => g.name === name);

// The evaluator issues several queries; every mocked statement must answer both
// .first() and .all() regardless of which branch it is routed to.
const statement = (row) => ({ first: async () => row ?? null, all: async () => ({ results: row ? [row] : [] }), run: async () => ({ changes: 1 }) });
const reviewDb = (sourceRow, productRow) => ({
  prepare: (sql) => {
    if (sql.includes("product_sources")) return { bind: () => statement(sourceRow) };
    if (sql.includes("library_products")) return { bind: () => statement(productRow ?? { id: "p", identity_status: "Active", superseded_by_product_id: null }) };
    return { bind: () => statement({ ...attribute(), identity_status: "Active" }) };
  },
});

test("an attribute with NO source at all is still refused", async () => {
  const noSource = { prepare: (sql) => (sql.includes("product_sources") ? { bind: () => statement(null) } : { bind: () => statement({ ...attribute(), identity_status: "Active" }) }) };
  const result = await evaluateProductAttributeReview(noSource, "attr-1");
  assert.equal(gate(result.gates, "authoritative_source").pass, false);
  assert.match(gate(result.gates, "authoritative_source").reason, /No source record/);
});

test("the allowlist is closed and contains every governed first-party manufacturer form", () => {
  assert.ok(FIRST_PARTY_MANUFACTURER_SOURCE_TYPES instanceof Set, "it must be a closed set, not an open pattern");
  assert.ok(FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has("Product Datasheet"));
  assert.ok(FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has("Installation and Operation Manual"));
  // The third entry is the SLC Wiring Manual (LS10179-000FH-E rev B), whose
  // section 1.6 is the manufacturer's only statement of the built-in surge
  // suppressors. Relabelling it to satisfy the previous two-entry list was
  // rejected: that writes a false document type into canonical provenance.
  assert.ok(FIRST_PARTY_MANUFACTURER_SOURCE_TYPES.has("Product Manual"));
  // Assert the EXACT set, not merely a count: a fourth source type must be named
  // here with its own evidence rationale before it may back product truth. Every
  // entry additionally requires `authority === "Official Manufacturer"` at gate 3,
  // so widening the TYPE can never admit a same-named document from a weaker
  // authority.
  assert.deepEqual([...FIRST_PARTY_MANUFACTURER_SOURCE_TYPES].sort(), ["Installation and Operation Manual", "Product Datasheet", "Product Manual"]);
});

test("an official manufacturer installation and operation manual IS first-party evidence", async () => {
  const result = await evaluateProductAttributeReview(reviewDb(source({ source_type: "Installation and Operation Manual" })), "attr-1");
  assert.equal(gate(result.gates, "authoritative_source").pass, true, JSON.stringify(result.gates));
});

test("a datasheet remains accepted", async () => {
  const result = await evaluateProductAttributeReview(reviewDb(source({})), "attr-1");
  assert.equal(gate(result.gates, "authoritative_source").pass, true);
});

test("a NON-manufacturer source type is still refused", async () => {
  for (const sourceType of ["Cost Sheet", "Historical Supplier Quotation", "Price List", "Installation and Operation Manual ", null]) {
    const result = await evaluateProductAttributeReview(reviewDb(source({ source_type: sourceType })), "attr-1");
    assert.equal(gate(result.gates, "authoritative_source").pass, false, `source_type ${JSON.stringify(sourceType)} must be refused`);
  }
});

test("the right source type from the WRONG authority is still refused", async () => {
  // This is the guard that keeps the widened allowlist honest: widening the TYPE
  // must never admit a same-named document published by anyone but the manufacturer.
  for (const authority of ["Historical Project Evidence — Review Required", "Distributor", null, ""]) {
    const result = await evaluateProductAttributeReview(reviewDb(source({ authority })), "attr-1");
    assert.equal(gate(result.gates, "authoritative_source").pass, false, `authority ${JSON.stringify(authority)} must be refused`);
  }
});

test("a rejected source is still refused whatever its type", async () => {
  const result = await evaluateProductAttributeReview(reviewDb(source({ source_type: "Installation and Operation Manual", review_status: "Rejected" })), "attr-1");
  assert.equal(gate(result.gates, "authoritative_source").pass, false);
});

test("a certification must be backed by the same closed first-party allowlist", async () => {
  const certification = {
    id: "c1",
    product_id: "p",
    standard_body: "UL",
    standard_number: "864",
    document_id: "doc-1",
    evidence_location: JSON.stringify({ exactText: "Complies with UL 864 10th Edition", page: 1, documentVersionId: "v1" }),
    deleted_at: null,
    superseded_at: null,
    review_status: "Needs Review",
  };
  const db = (sourceRow) => ({
    prepare: (sql) => {
      if (sql.includes("product_sources")) return { bind: () => statement(sourceRow) };
      if (sql.includes("library_products")) return { bind: () => statement({ id: "p", identity_status: "Active", superseded_by_product_id: null }) };
      return { bind: () => statement(certification) };
    },
  });

  const allowed = await evaluateProductCertificationReview(db(source({ source_type: "Installation and Operation Manual" })), "c1");
  assert.equal(gate(allowed.gates, "first_party_source").pass, true, JSON.stringify(allowed.gates));

  const refused = await evaluateProductCertificationReview(db(source({ source_type: "Cost Sheet" })), "c1");
  assert.equal(gate(refused.gates, "first_party_source").pass, false);
});

test("every gate the certification review reports is numbered without collisions", async () => {
  const certification = {
    id: "c1",
    product_id: "p",
    standard_body: "UL",
    standard_number: "864",
    document_id: "doc-1",
    evidence_location: JSON.stringify({ exactText: "quote", page: 1, documentVersionId: "v1" }),
    deleted_at: null,
    superseded_at: null,
    review_status: "Needs Review",
  };
  const db = {
    prepare: (sql) => {
      if (sql.includes("product_sources")) return { bind: () => statement(source({ source_type: "Installation and Operation Manual" })) };
      if (sql.includes("library_products")) return { bind: () => statement({ id: "p", identity_status: "Active", superseded_by_product_id: null }) };
      return { bind: () => statement(certification) };
    },
  };
  const result = await evaluateProductCertificationReview(db, "c1");
  const numbers = result.gates.map((g) => g.gate);
  assert.equal(new Set(numbers).size, numbers.length, `gate numbers must be unique: ${numbers.join(",")}`);
  assert.equal(result.eligible, true, JSON.stringify(result.gates));
});