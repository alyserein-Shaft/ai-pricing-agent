// KN-MASTER-1 — governed Product Attribute review contract.
//
// Mirrors the established governance- suite pattern (real in-memory SQLite,
// never a mock DB) so the SQL bindings, gate logic, and audit writes are
// exercised against the same statements production runs.
//
// The contract under test:
//   * A product attribute may be approved ONLY through deterministic evidence
//     gates modelled on the live, consumed precedent
//     (worker/compatibility-auto-confirm.mjs 12-gate auto-confirm), which
//     already produces `Approved` engineering facts consumed by matching.
//   * Every approval writes a product_library_decisions row with
//     entity_type 'Product Attribute', so review debt is exception-driven.
//   * Fail-closed everywhere: missing evidence, stale source, conflicting
//     value, dual-valued capacity, or bookkeeping names are NOT approvable.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";

import {
  PRODUCT_ATTRIBUTE_REVIEW_POLICY_VERSION,
  evaluateProductAttributeReview,
  reviewProductAttribute,
} from "../product-attribute-review.mjs";
import {
  resolveFireAlarmAttributeAlias,
  validateFireAlarmAttributeValue,
} from "../../app/domain/fire-alarm-taxonomy.mjs";
import { requireLibraryCapability } from "../library-auth.mjs";

// r7-style adapter: the module speaks the D1 interface (first/all/run +
// batch), the test drives a real in-memory SQLite database through it.
const d1 = (raw) => ({
  prepare(sql) {
    const operation = (values = []) => ({
      first: async () => raw.prepare(sql).get(...values) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...values) }),
      run: async () => raw.prepare(sql).run(...values),
    });
    return { ...operation(), bind: (...values) => operation(values) };
  },
});

const schema = `
CREATE TABLE product_attributes (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  variant_id TEXT,
  attribute_definition_id TEXT,
  attribute_name TEXT NOT NULL,
  value_json TEXT,
  original_value TEXT,
  normalized_value TEXT,
  unit TEXT,
  source_id TEXT,
  evidence_json TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  review_status TEXT NOT NULL,
  version_number INTEGER NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  superseded_at TEXT,
  deleted_at TEXT
);
CREATE TABLE library_products (
  id TEXT PRIMARY KEY,
  part_number TEXT NOT NULL,
  requested_product_id TEXT,
  identity_status TEXT NOT NULL,
  review_status TEXT NOT NULL,
  approved_for_discovery INTEGER NOT NULL DEFAULT 0,
  superseded_by_product_id TEXT,
  identity_version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE product_sources (
  id TEXT PRIMARY KEY,
  document_id TEXT,
  document_version_id TEXT,
  source_type TEXT NOT NULL,
  scope_type TEXT NOT NULL,
  file_name TEXT,
  validity_state TEXT,
  review_status TEXT NOT NULL,
  downstream_use TEXT,
  checksum TEXT,
  release_version TEXT
);
CREATE TABLE product_library_decisions (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT NOT NULL,
  decided_by TEXT NOT NULL,
  decided_role TEXT NOT NULL,
  decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const evidence = (overrides = {}) => JSON.stringify({
  sourceId: "source-1",
  documentId: "doc-1",
  documentVersionId: "ver-1",
  page: 1,
  section: "Product overview",
  exactText: "The IFP-75 has one SLC loop for connecting addressable detectors",
  parserVersion: "ifp75-datasheet-parser-1.0.0",
  sourceVersion: "351605:C:2022-03-08",
  ...overrides,
});

const seed = (overrides = {}) => {
  const raw = new DatabaseSync(":memory:");
  raw.exec(schema);
  raw.exec(`
    INSERT INTO library_products VALUES
      ('product-a', 'IFP-75', 'product-a', 'Active', 'Needs Review', 0, NULL, 1),
      ('product-superseded', 'OLD-PANEL', 'product-a', 'Active', 'Needs Review', 0, 'product-a', 1);
    INSERT INTO product_sources VALUES
      ('source-1', 'doc-1', 'ver-1', 'Product Datasheet', 'Global', 'hbt-fire-351605-C.pdf',
       'Current Document — Applicability Review Required', 'Needs Review', 'Discovery Only',
       'sha256:abc', '351605:C:2022-03-08'),
      ('source-historical', 'doc-2', 'ver-2', 'Product Datasheet', 'Global', 'old.pdf',
       'Historical — Superseded By Current Pricing Unknown', 'Needs Review', 'Discovery Only', NULL, NULL),
      ('source-catalog', 'doc-3', 'ver-3', 'Product Catalogue', 'Global', 'catalog.xlsx',
       'Current Document — Applicability Review Required', 'Needs Review', 'Discovery Only', NULL, NULL);
  `);
  const attributeId = overrides.attributeId ?? "attr-1";
  raw.prepare(`INSERT INTO product_attributes VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, 98, 'Needs Review', 1, 'seed', 'now', NULL, NULL)`).run(
    attributeId,
    overrides.productId ?? "product-a",
    overrides.attributeName ?? "slc_loop_count",
    overrides.valueJson ?? JSON.stringify({ original: "one SLC loop", normalized: "1", unit: "loop" }),
    overrides.originalValue ?? "one SLC (signaling line circuit) loop",
    overrides.normalizedValue ?? "1",
    overrides.unit ?? "loop",
    overrides.sourceId ?? "source-1",
    overrides.evidenceJson ?? evidence(),
  );
  return { raw, attributeId };
};

const actor = { id: "eng-1", permission: "Library Manager", role: "Library Manager" };
const REASON = "Verified against the checksum-pinned manufacturer datasheet; explicit quoted evidence on the current document version.";

const decisionRows = (raw, entityId) =>
  raw.prepare("SELECT * FROM product_library_decisions WHERE entity_id=? ORDER BY rowid").all(entityId);

// ---------------------------------------------------------------------------
// 1. Canonical vocabulary: the alias seam the sizing consumer depends on.
// ---------------------------------------------------------------------------
test("KN-MASTER-1 taxonomy: governed attribute names resolve onto the sizing contract names", () => {
  assert.equal(resolveFireAlarmAttributeAlias("slc_loop_count"), "native_slc_loops");
  assert.equal(resolveFireAlarmAttributeAlias("detector_capacity"), "max_detectors_per_loop");
  assert.equal(resolveFireAlarmAttributeAlias("module_capacity"), "max_modules_per_loop");
  assert.equal(resolveFireAlarmAttributeAlias("panel_capacity"), "max_system_points");
  assert.equal(resolveFireAlarmAttributeAlias("cabinet_color"), "color");
  assert.equal(resolveFireAlarmAttributeAlias("ac_input"), "input_voltage");
  assert.equal(resolveFireAlarmAttributeAlias("total_power_output"), "power_rating");
  assert.equal(resolveFireAlarmAttributeAlias("supported_interfaces"), "communication_interface");
  assert.equal(resolveFireAlarmAttributeAlias("battery_capacity_in_cabinet"), "battery_capacity");
  // Already-canonical and unknown names must fall through untouched.
  assert.equal(resolveFireAlarmAttributeAlias("native_slc_loops"), null);
  assert.equal(resolveFireAlarmAttributeAlias("totally_unknown_name"), null);
});

test("KN-MASTER-1 taxonomy: capacity names reject non-scalar values (fail closed on ambiguity)", () => {
  assert.equal(validateFireAlarmAttributeValue("max_detectors_per_loop", "75").valid, true);
  assert.equal(validateFireAlarmAttributeValue("native_slc_loops", "1").valid, true);
  assert.equal(validateFireAlarmAttributeValue("added_slc_loops", "1").valid, true);
  assert.equal(validateFireAlarmAttributeValue("max_system_points", "150").valid, true);
  // The real dual-valued datasheet string must be INVALID, never silently
  // coerced -- this is the panel_capacity ambiguity failing closed.
  assert.equal(validateFireAlarmAttributeValue("max_system_points", "150 IDP/SK points; 75 SD points").valid, false);
  assert.equal(validateFireAlarmAttributeValue("max_detectors_per_loop", "seventy five").valid, false);
});

// ---------------------------------------------------------------------------
// 2. The deterministic evidence gates.
// ---------------------------------------------------------------------------
test("KN-MASTER-1 gates: an explicit datasheet-backed attribute is ELIGIBLE", async () => {
  const { raw, attributeId } = seed();
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, true, JSON.stringify(evaluation.gates));
  assert.equal(evaluation.policyVersion, PRODUCT_ATTRIBUTE_REVIEW_POLICY_VERSION);
  assert.ok(evaluation.gates.length >= 9);
  assert.ok(evaluation.gates.every((gate) => gate.pass));
});

test("KN-MASTER-1 gates: missing explicit evidence is NOT eligible", async () => {
  const { raw, attributeId } = seed({ evidenceJson: evidence({ exactText: undefined }) });
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.gates.some((gate) => gate.name === "explicit_evidence" && !gate.pass));
});

test("KN-MASTER-1 gates: a stale (non-current) source is NOT eligible", async () => {
  const { raw, attributeId } = seed({ sourceId: "source-historical", evidenceJson: evidence({ documentId: "doc-2", documentVersionId: "ver-2" }) });
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.gates.some((gate) => gate.name === "source_currency" && !gate.pass));
});

test("KN-MASTER-1 gates: a non-datasheet source is NOT eligible", async () => {
  const { raw, attributeId } = seed({ sourceId: "source-catalog", evidenceJson: evidence({ documentId: "doc-3", documentVersionId: "ver-3" }) });
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.gates.some((gate) => gate.name === "authoritative_source" && !gate.pass));
});

test("KN-MASTER-1 gates: evidence pointing at a stale document version is NOT eligible", async () => {
  // The source's current document version is ver-1; this evidence cites ver-9.
  const { raw, attributeId } = seed({ evidenceJson: evidence({ documentVersionId: "ver-9" }) });
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.gates.some((gate) => gate.name === "document_version_match" && !gate.pass));
});

test("KN-MASTER-1 gates: a conflicting current value for the same canonical name is NOT eligible", async () => {
  const { raw, attributeId } = seed();
  raw.prepare(`INSERT INTO product_attributes VALUES ('attr-2', 'product-a', NULL, NULL, 'slc_loop_count', '{}', 'two SLC loops', '2', 'loop', 'source-1', ?, 98, 'Approved', 1, 'seed', 'now', NULL, NULL)`).run(evidence());
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.gates.some((gate) => gate.name === "no_conflicting_value" && !gate.pass));
});

test("KN-MASTER-1 gates: a dual-valued capacity fails the canonical value gate and is NOT eligible", async () => {
  const { raw, attributeId } = seed({
    attributeName: "panel_capacity",
    normalizedValue: "150 IDP/SK points; 75 SD points",
    originalValue: "150 points (IDP/SK) or 75 points (SD)",
    unit: "points",
    valueJson: JSON.stringify({ original: "150 points (IDP/SK) or 75 points (SD)", normalized: "150 IDP/SK points; 75 SD points", unit: "points" }),
  });
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.gates.some((gate) => gate.name === "canonical_value_valid" && !gate.pass));
});

test("KN-MASTER-1 gates: bookkeeping (source_*) names are NOT eligible", async () => {
  const { raw, attributeId } = seed({ attributeName: "source_sheet_row" });
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.gates.some((gate) => gate.name === "technical_attribute" && !gate.pass));
});

test("KN-MASTER-1 gates: a superseded product is NOT eligible", async () => {
  const { raw, attributeId } = seed({ productId: "product-superseded" });
  const evaluation = await evaluateProductAttributeReview(d1(raw), attributeId);
  assert.equal(evaluation.eligible, false);
  assert.ok(evaluation.gates.some((gate) => /product_identity/.test(gate.name) && !gate.pass));
});

// ---------------------------------------------------------------------------
// 3. The governed transition + audit trail.
// ---------------------------------------------------------------------------
test("KN-MASTER-1 review: Approve transitions the row and writes the decision audit", async () => {
  const { raw, attributeId } = seed();
  const result = await reviewProductAttribute(d1(raw), { attributeId, decision: "Approve", reason: REASON, decidedBy: actor.id, decidedRole: actor.role });
  assert.equal(result.success, true, JSON.stringify(result.evaluation?.gates));
  const row = raw.prepare("SELECT review_status FROM product_attributes WHERE id=?").get(attributeId);
  assert.equal(row.review_status, "Approved");

  const decisions = decisionRows(raw, attributeId);
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].entity_type, "Product Attribute");
  assert.equal(decisions[0].action, "Approved");
  assert.equal(decisions[0].previous_value, "Needs Review");
  assert.equal(decisions[0].new_value, "Approved");
  assert.equal(decisions[0].decided_by, "eng-1");
  assert.equal(decisions[0].decided_role, "Library Manager");
  assert.ok(decisions[0].reason.length >= 20);
});

test("KN-MASTER-1 review: the consumer gate actually sees the approved row (the loop closes)", async () => {
  const { raw, attributeId } = seed();
  await reviewProductAttribute(d1(raw), { attributeId, decision: "Approve", reason: REASON, decidedBy: actor.id, decidedRole: actor.role });
  const consumerView = raw.prepare(
    "SELECT COUNT(*) n FROM product_attributes WHERE product_id=? AND review_status='Approved' AND deleted_at IS NULL"
  ).get("product-a");
  assert.equal(consumerView.n, 1);
});

test("KN-MASTER-1 review: Approve is idempotent and never stacks audit rows", async () => {
  const { raw, attributeId } = seed();
  await reviewProductAttribute(d1(raw), { attributeId, decision: "Approve", reason: REASON, decidedBy: actor.id, decidedRole: actor.role });
  const second = await reviewProductAttribute(d1(raw), { attributeId, decision: "Approve", reason: REASON, decidedBy: actor.id, decidedRole: actor.role });
  assert.equal(second.alreadyApproved, true);
  assert.equal(decisionRows(raw, attributeId).length, 1);
});

test("KN-MASTER-1 review: an ineligible attribute is refused with its gates (fail closed)", async () => {
  const { raw, attributeId } = seed({ evidenceJson: evidence({ exactText: undefined }) });
  const result = await reviewProductAttribute(d1(raw), { attributeId, decision: "Approve", reason: REASON, decidedBy: actor.id, decidedRole: actor.role });
  assert.equal(result.success, false);
  assert.equal(raw.prepare("SELECT review_status FROM product_attributes WHERE id=?").get(attributeId).review_status, "Needs Review");
  assert.equal(decisionRows(raw, attributeId).length, 0);
});

test("KN-MASTER-1 review: Reject is always available and is the reversal path", async () => {
  const { raw, attributeId } = seed();
  await reviewProductAttribute(d1(raw), { attributeId, decision: "Approve", reason: REASON, decidedBy: actor.id, decidedRole: actor.role });
  const rejected = await reviewProductAttribute(d1(raw), { attributeId, decision: "Reject", reason: "Superseding evidence contradicts the quoted claim; reverting while re-verified.", decidedBy: actor.id, decidedRole: actor.role });
  assert.equal(rejected.success, true);
  assert.equal(raw.prepare("SELECT review_status FROM product_attributes WHERE id=?").get(attributeId).review_status, "Rejected");
  const decisions = decisionRows(raw, attributeId);
  assert.equal(decisions.length, 2);
  assert.equal(decisions[1].action, "Rejected");
  assert.equal(decisions[1].previous_value, "Approved");
});

// ---------------------------------------------------------------------------
// 4. Authority: the never-enforced `approve` tier becomes the gate.
// ---------------------------------------------------------------------------
test("KN-MASTER-1 authority: the approve capability is required and correctly tiered", () => {
  assert.equal(requireLibraryCapability({ permission: "Library Manager" }, "approve"), null);
  assert.equal(requireLibraryCapability({ permission: "Administrator" }, "approve"), null);
  const denied = requireLibraryCapability({ permission: "Library Reviewer" }, "approve");
  assert.equal(denied?.status, 403);
  assert.equal(denied?.code, "LIBRARY_PERMISSION_DENIED");
  const viewerDenied = requireLibraryCapability({ permission: "Library Viewer" }, "approve");
  assert.equal(viewerDenied?.status, 403);
});
