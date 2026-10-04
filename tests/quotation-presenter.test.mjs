import test from "node:test";
import assert from "node:assert/strict";

import { buildClientQuotationModel } from "../app/domain/quotation-presenter.mjs";

const revision = {
  id: "q1",
  project_id: "p1",
  revision_number: 2,
  quotation_fingerprint: "internal-qf",
  currency: "SAR",
  subtotal_minor: 250000,
  vat_basis_points: 1500,
  vat_minor: 37500,
  total_minor: 287500,
  status: "Approved",
  created_at: "2026-08-29T19:00:00.000Z",
  approved_at: "2026-08-29T19:20:00.000Z",
  terms_json: JSON.stringify({
    validityDays: 30,
    warrantyMonths: 12,
    delivery: "4-6 weeks",
    paymentTerms: "50% advance, 50% on delivery",
    exclusions: ["Civil works"],
    client: "Client A",
  }),
  source_summary_json: JSON.stringify({
    quotationHeader: {
      projectName: "Central Kitchen",
      client: "Client A",
      tenderNumber: "T-100",
      location: "Makkah",
      packageName: "Fire Alarm",
      currency: "SAR",
      quotationDate: "2026-08-29T19:00:00.000Z",
    },
  }),
  evidence_fingerprint: "internal-ef",
  evidence_manifest_json: '{"internal":true}',
  terms_provenance_json: '{"internal":true}',
};

const lines = [
  {
    id: "ql1",
    quotation_revision_id: "q1",
    project_id: "p1",
    boq_item_id: "b1",
    sequence: 1,
    item_number: "FA-01",
    description: "Addressable smoke detector",
    unit: "EA",
    quantity: "10",
    candidate_id: "candidate1",
    product_id: "product1",
    manufacturer_name: "Honeywell",
    part_number: "ABC-123",
    product_description: "Addressable Photoelectric Smoke Detector",
    pricing_run_id: "run1",
    pricing_run_version: 3,
    pricing_line_id: "pricingLine1",
    pricing_line_version: 1,
    pricing_input_fingerprint: "pricing-fp",
    commercial_approval_id: "approval1",
    commercial_approval_version: 3,
    currency: "SAR",
    total_cost_minor: 150000,
    net_selling_minor: 250000,
    source_snapshot_json: '{"internal":true}',
  },
];

test("builds client quotation only from immutable revision and line snapshots", () => {
  const model = buildClientQuotationModel({ revision, lines });

  // ONBOARDING RECOVERY E: attention/contactTitle/contactName are new,
  // additive header fields (captured from the current confirmed NPQ at
  // draft-creation time) -- null here because this fixture's stored
  // snapshot never set them, exactly as a real historical revision created
  // before this wave would read back.
  assert.deepEqual(model.header, {
    quotationRevision: 2,
    projectName: "Central Kitchen",
    client: "Client A",
    tenderNumber: "T-100",
    location: "Makkah",
    packageName: "Fire Alarm",
    currency: "SAR",
    quotationDate: "2026-08-29T19:00:00.000Z",
    status: "Approved",
    attention: null,
    contactTitle: null,
    contactName: null,
  });

  assert.deepEqual(model.lines, [{
    sequence: 1,
    itemNumber: "FA-01",
    description: "Addressable smoke detector",
    manufacturer: "Honeywell",
    partNumber: "ABC-123",
    productDescription: "Addressable Photoelectric Smoke Detector",
    unit: "EA",
    quantity: 10,
    currency: "SAR",
    unitSellingMinor: 25000,
    lineTotalMinor: 250000,
  }]);

  assert.deepEqual(model.summary, {
    currency: "SAR",
    subtotalMinor: 250000,
    vatBasisPoints: 1500,
    vatMinor: 37500,
    totalMinor: 287500,
  });

  assert.deepEqual(model.terms, {
    validityDays: 30,
    warrantyMonths: 12,
    delivery: "4-6 weeks",
    paymentTerms: "50% advance, 50% on delivery",
    exclusions: ["Civil works"],
  });
});

test("never exposes internal cost, authority, provenance or evidence fields", () => {
  const model = buildClientQuotationModel({ revision, lines });
  const serialized = JSON.stringify(model);

  for (const forbidden of [
    "total_cost_minor",
    "candidate_id",
    "product_id",
    "pricing_run_id",
    "pricing_line_id",
    "commercial_approval_id",
    "pricing_input_fingerprint",
    "quotation_fingerprint",
    "evidence_fingerprint",
    "evidence_manifest",
    "terms_provenance",
    "source_snapshot",
  ]) {
    assert.equal(
      serialized.includes(forbidden),
      false,
      `client quotation leaked ${forbidden}`,
    );
  }
});

test("omits unknown or empty client terms instead of displaying placeholders", () => {
  const model = buildClientQuotationModel({
    revision: {
      ...revision,
      terms_json: JSON.stringify({
        validityDays: 30,
        warrantyMonths: 12,
        delivery: "Unknown",
        paymentTerms: "Unknown",
        exclusions: [],
        client: "Client A",
      }),
    },
    lines,
  });

  assert.deepEqual(model.terms, {
    validityDays: 30,
    warrantyMonths: 12,
  });
});

test("line total remains authoritative when derived unit price requires rounding", () => {
  const model = buildClientQuotationModel({
    revision: {
      ...revision,
      subtotal_minor: 10000,
      vat_minor: 1500,
      total_minor: 11500,
    },
    lines: [{
      ...lines[0],
      quantity: "3",
      net_selling_minor: 10000,
    }],
  });

  assert.equal(model.lines[0].unitSellingMinor, 3333.333333);
  assert.equal(model.lines[0].lineTotalMinor, 10000);
});

test("fails closed when stored quotation lines do not reconcile with revision subtotal", () => {
  assert.throws(
    () => buildClientQuotationModel({
      revision: { ...revision, subtotal_minor: 999999 },
      lines,
    }),
    /QUOTATION_PRESENTATION_RECONCILIATION_FAILED/,
  );
});

test("fails closed on missing historical header snapshot", () => {
  assert.throws(
    () => buildClientQuotationModel({
      revision: { ...revision, source_summary_json: "{}" },
      lines,
    }),
    /QUOTATION_HEADER_SNAPSHOT_REQUIRED/,
  );
});
