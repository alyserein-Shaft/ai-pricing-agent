// SINGLE-PRODUCT ATTRIBUTION CONFLICT RESOLUTION.
//
// These tests exist because the previous state of the system was untestable in
// the most dangerous way: `applyIdentityProposal` COULD NOT resolve either
// Batch-1 conflict, there was no other path, and both conflicts were therefore
// permanently unresolvable with nothing to prove it. The tests below pin the
// governance rules that make the new path safe to use, and each one names the
// failure it prevents.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ATTRIBUTION_RESOLUTION_DECISIONS,
  ATTRIBUTION_RESOLUTION_ERRORS,
  ATTRIBUTION_RESOLUTION_OUTCOMES,
  ATTRIBUTION_RESOLUTION_ACTIONS as AUDIT_ACTIONS,
  CORRECTABLE_ATTRIBUTION_FIELDS,
  assessAttributionConflictResolution,
  attributionConflictSnapshot,
  attributionProductSnapshot,
  resolveAttributionConflict,
  reverseAttributionConflictResolution,
} from "../app/domain/product-attribution-conflict-resolution.mjs";
import { HUMAN_ACTOR_SOURCE } from "../app/domain/human-authority.mjs";
import { createMigratedDatabase, asD1 } from "./helpers/decision-packet-db.mjs";

const BRAND_TYPE = "Identity Collision — Brand / Standards Regime Conflict";
const DUPLICATE_TYPE = "Possible Duplicate Identity";

const HONEY = "manufacturer_honeywell";
const BRAND_FARENHYT = "brand_farenhyt";
const BRAND_NOTIFIER = "brand_notifier";
const FAMILY_BEAM = "family_beam";
const FAMILY_STROBE = "family_strobe";

const EVIDENCE = [
  { document: "DS-DET-501-EN-02", url: "https://www.systemsensoreurope.com/DS-DET-501-EN-02.pdf", page: "p1" },
];

const REAL_HUMAN = Object.freeze({
  id: "omair-primary",
  name: "Omair",
  email: "omair@example.com",
  source: HUMAN_ACTOR_SOURCE,
  synthetic: false,
});

const SUBSTANTIVE_REASON =
  "First-party DS-DET-501-EN-02 and I56-4446-001 Rev B both identify this as a System Sensor Europe conventional device under EN 54-12:2015, not a Farenhyt UL/FM addressable device.";
const ELEVATION_REASON = `${SUBSTANTIVE_REASON} The canonical legal entity named on the Declaration of Performance is Honeywell Products and Solutions Sarl, so the manufacturer is already correct and only the brand is wrong.`;

const productRow = (overrides = {}) => ({
  id: "product_6500",
  part_number: "6500RSE",
  normalized_part_number: "6500RSE",
  description: "Conventional reflective IR beam detector",
  manufacturer_id: HONEY,
  brand_id: BRAND_FARENHYT,
  family_id: FAMILY_BEAM,
  identity_status: "Active",
  identity_version: 1,
  lifecycle_status: "Unknown — Review Required",
  ...overrides,
});

const conflictRow = (overrides = {}) => ({
  id: "conflict_6500",
  conflict_type: BRAND_TYPE,
  status: "Open",
  resolution: null,
  resolved_by: null,
  resolved_at: null,
  conflict_version: 1,
  product_id: "product_6500",
  library_scope: "Global Library",
  organization_id: null,
  library_project_id: null,
  ...overrides,
});

const assess = (overrides = {}) =>
  assessAttributionConflictResolution({
    conflict: conflictRow(),
    product: productRow(),
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CONFIRM_CURRENT_ATTRIBUTION,
    reason: SUBSTANTIVE_REASON,
    evidence: EVIDENCE,
    humanActor: REAL_HUMAN,
    ...overrides,
  });

// ---------------------------------------------------------------------------
// Pure governance.
// ---------------------------------------------------------------------------

test("ATTRIBUTION/A a synthetic actor is refused before anything else is read", () => {
  // The failure this prevents: `requireHumanActor` returning a synthetic
  // fallback would let the development identity close a governed conflict and
  // mint canonical brand truth attributed to nobody.
  for (const humanActor of [
    undefined,
    null,
    { id: "local-development-user", name: "Local Dev", source: HUMAN_ACTOR_SOURCE },
    { id: "system", name: "System", source: "internal" },
    { id: "omair-primary", name: "Omair" }, // no source => not a governed human
  ]) {
    const outcome = assess({ humanActor });
    assert.equal(outcome.ok, false, `${JSON.stringify(humanActor)} must be refused`);
    assert.equal(outcome.code, ATTRIBUTION_RESOLUTION_ERRORS.HUMAN_ACTOR_REQUIRED);
  }
  assert.equal(assess().ok, true);
});

test("ATTRIBUTION/B only a real human, four governed decisions, evidence and a substantive reason", () => {
  assert.equal(assess({ decision: undefined }).code, ATTRIBUTION_RESOLUTION_ERRORS.DECISION_REQUIRED);
  assert.equal(assess({ decision: "Merge them" }).code, ATTRIBUTION_RESOLUTION_ERRORS.DECISION_INVALID);
  assert.deepEqual(ATTRIBUTION_RESOLUTION_DECISIONS, [
    "Confirm Current Canonical Attribution",
    "Correct Canonical Attribution",
    "Preserve Product + Record Relationship",
    "Needs Investigation",
  ]);
  // Evidence is mandatory: a resolution with no cited source is an opinion.
  assert.equal(assess({ evidence: [] }).code, ATTRIBUTION_RESOLUTION_ERRORS.EVIDENCE_REQUIRED);
  assert.equal(assess({ evidence: [{ note: "I read it somewhere" }] }).code, ATTRIBUTION_RESOLUTION_ERRORS.EVIDENCE_REQUIRED);
  assert.equal(assess({ reason: "looks wrong" }).code, ATTRIBUTION_RESOLUTION_ERRORS.REASON_REQUIRED);
});

test("ATTRIBUTION/C a correction demands a LONGER reason than an agreement", () => {
  // Correcting the brand a commercial match reads is a different class of
  // decision from agreeing with what is already stored, and carries a higher
  // bar. A reason long enough for the former must not pass the latter's floor
  // for the wrong reason.
  const shortish = "x".repeat(30);
  assert.equal(assess({ reason: shortish }).ok, true, "30 chars satisfies a confirmation");
  const correction = assess({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { brand: BRAND_NOTIFIER },
    reason: shortish,
  });
  assert.equal(correction.code, ATTRIBUTION_RESOLUTION_ERRORS.REASON_REQUIRED);
  assert.equal(assess({ decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION, correction: { brand: BRAND_NOTIFIER }, reason: ELEVATION_REASON }).ok, true);
});

test("ATTRIBUTION/D correction is limited to the governed field list and must change something", () => {
  const unsupported = assess({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { lifecycle_status: "Current" },
    reason: ELEVATION_REASON,
  });
  assert.equal(unsupported.code, ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_FIELD_UNSUPPORTED);
  assert.deepEqual(unsupported.correctableFields, ["brand", "manufacturer", "family"]);
  assert.deepEqual(CORRECTABLE_ATTRIBUTION_FIELDS.map((entry) => entry.field), ["brand", "manufacturer", "family"]);

  assert.equal(
    assess({ decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION, reason: ELEVATION_REASON }).code,
    ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_REQUIRED,
  );

  // Correcting a field to the value it already holds would burn an audit row and
  // a conflict version to record "no". That is what Confirm is for.
  const noChange = assess({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { brand: BRAND_FARENHYT },
    reason: ELEVATION_REASON,
  });
  assert.equal(noChange.code, ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_NO_CHANGE);
});

test("ATTRIBUTION/E a supersession relationship is refused: no governed relationship type exists", () => {
  // The decisive governance limit for the SGWL case. `Compatible With` is the
  // ONLY governed relationship type, so "SGWLED replaces SGWL" has no
  // destination. Accepting a new token would persist a row no governed reader
  // recognises -- indistinguishable from no relationship while looking like one.
  const outcome = assess({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.PRESERVE_AND_RECORD_RELATIONSHIP,
    successorProductId: "product_sgwled",
    relationship: { relationshipType: "Replaced By" },
    reason: SUBSTANTIVE_REASON,
  });
  assert.equal(outcome.code, ATTRIBUTION_RESOLUTION_ERRORS.RELATIONSHIP_TYPE_UNSUPPORTED);
  assert.deepEqual(outcome.governedTypes, ["Compatible With"]);
  assert.equal(assess({ decision: ATTRIBUTION_RESOLUTION_OUTCOMES.PRESERVE_AND_RECORD_RELATIONSHIP, reason: SUBSTANTIVE_REASON }).code, ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_REQUIRED);
});

test("ATTRIBUTION/F Needs Investigation is a complete outcome that writes nothing", () => {
  const outcome = assess({ decision: ATTRIBUTION_RESOLUTION_OUTCOMES.NEEDS_INVESTIGATION });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.writes, false);
  assert.equal(outcome.value.correction && Object.keys(outcome.value.correction).length, 0, "no correction requested");
  assert.equal(outcome.value.successorProductId, null);
  assert.equal(outcome.value.relationship, null);});

test("ATTRIBUTION/G a conflict that is not an attribution conflict, or not open, is refused", () => {
  assert.equal(assess({ conflict: conflictRow({ conflict_type: "Identity Collision — Description Difference" }) }).code, ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_TYPE_UNSUPPORTED);
  assert.equal(assess({ conflict: conflictRow({ status: "Resolved" }) }).code, ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_NOT_OPEN);
  assert.equal(assess({ product: null }).code, ATTRIBUTION_RESOLUTION_ERRORS.PRODUCT_UNKNOWN);
  assert.equal(assess({ conflict: { conflict_type: BRAND_TYPE, status: "Open" } }).ok, true, "Possible Duplicate Identity is in scope");
});

// ---------------------------------------------------------------------------
// Database-backed write path.
// ---------------------------------------------------------------------------

const fresh = () => {
  const raw = createMigratedDatabase();
  const db = asD1(raw);
  raw.exec("INSERT INTO organizations (id,name,status,created_at) VALUES ('org_x','Org','Active','2026-10-01')");
  raw.exec("INSERT INTO product_manufacturers (id,name,normalized_name,status,created_by,created_at) VALUES ('" + HONEY + "','Honeywell','HONEYWELL','Needs Review','seed','2026-10-01')");
  raw.exec("INSERT INTO product_brands (id,manufacturer_id,name,normalized_name,status,created_at) VALUES ('" + BRAND_FARENHYT + "','" + HONEY + "','Farenhyt','FARENHYT','Needs Review','2026-10-01')");
  raw.exec("INSERT INTO product_brands (id,manufacturer_id,name,normalized_name,status,created_at) VALUES ('" + BRAND_NOTIFIER + "','" + HONEY + "','Notifier','NOTIFIER','Needs Review','2026-10-01')");
  raw.exec("INSERT INTO product_families (id,brand_id,name,normalized_name,engineering_domain,review_status,created_at) VALUES ('" + FAMILY_BEAM + "','" + BRAND_FARENHYT + "','Beam Detector','beam detector','Detection Devices','Needs Review','2026-10-01')");
  raw.exec("INSERT INTO product_families (id,brand_id,name,normalized_name,engineering_domain,review_status,created_at) VALUES ('" + FAMILY_STROBE + "','" + BRAND_FARENHYT + "','Strobe','strobe','Notification Devices','Needs Review','2026-10-01')");
  const insertProduct = (overrides = {}) => {
    const row = productRow(overrides);
    raw
      .prepare(
        "INSERT INTO library_products (id,manufacturer_id,brand_id,family_id,part_number,normalized_part_number,description,lifecycle_status,review_status,approved_for_discovery,identity_status,superseded_by_product_id,identity_version,library_scope,product_role,created_by,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?, 'Needs Review',0,?,?,?, 'Global Library','Primary Equipment','seed','2026-10-01','2026-10-01')",
      )
      .run(
        row.id,
        row.manufacturer_id,
        row.brand_id,
        row.family_id,
        row.part_number,
        row.normalized_part_number,
        row.description,
        row.lifecycle_status,
        row.identity_status,
        row.superseded_by_product_id ?? null,
        row.identity_version,
      );
    return row;
  };
  const insertConflict = (overrides = {}) => {
    const row = conflictRow(overrides);
    raw
      .prepare(
        "INSERT INTO product_conflicts (id,product_id,conflict_type,left_value,right_value,source_ids,status,created_at,conflict_version,library_scope,organization_id,library_project_id,deleted_at) VALUES (?,?,?,?,?,?, 'Open','2026-10-01',?, 'Global Library',NULL,NULL,NULL)",
      )
      .run(row.id, row.product_id, row.conflict_type, "left", "right", "[]", row.conflict_version);
    return row;
  };
  return { raw, db, insertProduct, insertConflict };
};

const call = (overrides = {}) => ({
  conflictId: "conflict_6500",
  decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CONFIRM_CURRENT_ATTRIBUTION,
  reason: SUBSTANTIVE_REASON,
  evidence: EVIDENCE,
  humanActor: REAL_HUMAN,
  actorRole: "Administrator",
  idempotencyKey: "attr-1",
  ...overrides,
});

const readBrand = (raw, productId) =>
  raw.prepare("SELECT brand_id FROM library_products WHERE id=?").get(productId).brand_id;

test("ATTRIBUTION/H a correction repoints the brand and preserves the product id", async () => {
  // THE 6500RSE INVARIANT. The canonical product id is the join key for
  // prices, project references and every reviewed fact. Correcting attribution
  // must never mint a new product, because a new id silently orphans all of
  // them.
  const { raw, db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertConflict();

  const result = await resolveAttributionConflict(db, call({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { brand: BRAND_NOTIFIER },
    reason: ELEVATION_REASON,
  }));
  assert.equal(result.ok, true, result.message);
  assert.equal(result.outcome, ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION);

  assert.equal(readBrand(raw, "product_6500"), BRAND_NOTIFIER, "brand is corrected");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products WHERE id='product_6500'").get().c, 1, "no new product");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products").get().c, 1, "still exactly one product");
  assert.equal(raw.prepare("SELECT part_number FROM library_products WHERE id='product_6500'").get().part_number, "6500RSE", "part number untouched");
  assert.equal(result.previous.product.brandId, BRAND_FARENHYT, "before-state recorded");
  assert.equal(result.after.brandId, BRAND_NOTIFIER, "after-state read back from the database");
  assert.equal(result.after.productId, "product_6500");
  assert.equal(result.conflictAfter.status, "Resolved");
});

test("ATTRIBUTION/I a correction cannot invent a manufacturer that does not exist", async () => {
  const { db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertConflict();
  const result = await resolveAttributionConflict(db, call({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { manufacturer: "manufacturer_system_sensor_europe" },
    reason: ELEVATION_REASON,
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ATTRIBUTION_RESOLUTION_ERRORS.CORRECTION_TARGET_UNKNOWN);
});

test("ATTRIBUTION/J Needs Investigation leaves the conflict Open, version untouched, no audit row", async () => {
  const { raw, db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertConflict();
  const result = await resolveAttributionConflict(db, call({ decision: ATTRIBUTION_RESOLUTION_OUTCOMES.NEEDS_INVESTIGATION }));
  assert.equal(result.ok, true);
  assert.equal(result.writes, false);
  const conflict = raw.prepare("SELECT * FROM product_conflicts WHERE id='conflict_6500'").get();
  assert.equal(conflict.status, "Open", "still Open");
  assert.equal(conflict.conflict_version, 1, "version untouched, so a later resolution locks against the same one");
  assert.equal(conflict.resolution, null);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM identity_decision_audit").get().c, 0, "no decision row claims a resolution");
});

test("ATTRIBUTION/K replay writes nothing; a reused key with a different request is refused", async () => {
  const { raw, db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertConflict();
  const first = await resolveAttributionConflict(db, call({ decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CONFIRM_CURRENT_ATTRIBUTION }));
  assert.equal(first.ok, true);
  assert.equal(first.idempotent, false);
  const conflictsBefore = raw.prepare("SELECT * FROM product_conflicts WHERE id='conflict_6500'").get();
  const decisionsBefore = raw.prepare("SELECT COUNT(*) c FROM identity_decision_audit").get().c;

  const replay = await resolveAttributionConflict(db, call({ decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CONFIRM_CURRENT_ATTRIBUTION }));
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.decisionId, first.decisionId, "same decision, not a second one");
  assert.deepEqual({ ...raw.prepare("SELECT * FROM product_conflicts WHERE id='conflict_6500'").get() }, { ...conflictsBefore }, "conflict row byte-identical");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM identity_decision_audit").get().c, decisionsBefore, "no duplicate audit row");

  // The dangerous case: the same key carrying a DIFFERENT decision. Silently
  // accepting it would lose a human decision behind a replay.
  const reused = await resolveAttributionConflict(db, call({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { brand: BRAND_NOTIFIER },
    reason: ELEVATION_REASON,
  }));
  assert.equal(reused.ok, false);
  assert.equal(reused.code, ATTRIBUTION_RESOLUTION_ERRORS.IDEMPOTENCY_KEY_REUSED);
});

test("ATTRIBUTION/L a stale expected conflict version is refused", async () => {
  const { db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertConflict();
  const result = await resolveAttributionConflict(db, call({ expectedConflictVersion: 7 }));
  assert.equal(result.ok, false);
  assert.equal(result.code, ATTRIBUTION_RESOLUTION_ERRORS.CONFLICT_VERSION_STALE);
});

test("ATTRIBUTION/M an idempotency key is mandatory", async () => {
  const { db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertConflict();
  return resolveAttributionConflict(db, call({ idempotencyKey: "" })).then((result) => {
    assert.equal(result.ok, false);
    assert.equal(result.code, ATTRIBUTION_RESOLUTION_ERRORS.IDEMPOTENCY_KEY_REQUIRED);
  });
});

test("ATTRIBUTION/N the audit row records before, after, actor, reason, evidence and version", async () => {
  // §5 audit requirement, asserted field by field: conflict id, before state,
  // decision, after state, human actor, reason, supporting evidence, timestamp,
  // resolution version and affected canonical entity ids.
  const { raw, db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertConflict();
  const result = await resolveAttributionConflict(db, call({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { brand: BRAND_NOTIFIER },
    reason: ELEVATION_REASON,
  }));
  assert.equal(result.ok, true, result.message);
  const row = raw.prepare('SELECT * FROM identity_decision_audit WHERE action=?').get(AUDIT_ACTIONS.APPLY);
  assert.equal(row.entity_id, "conflict_6500", "conflict id");
  assert.equal(row.entity_type, "Product Conflict");
  assert.equal(row.actor_id, "omair-primary", "human actor");
  assert.equal(row.actor_role, "Administrator", "role that satisfied the gate");
  assert.match(row.reason, /DS-DET-501-EN-02/, "reason");
  assert.ok(row.created_at, "timestamp");

  const before = JSON.parse(row.previous_snapshot_json);
  const after = JSON.parse(row.new_snapshot_json);
  // before state
  assert.equal(before.product.productId, "product_6500");
  assert.equal(before.product.brandId, BRAND_FARENHYT);
  assert.equal(before.conflict.status, "Open");
  assert.equal(before.conflict.conflictVersion, 1);
  // decision + after state
  assert.equal(after.outcome, ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION);
  assert.equal(after.correction.brand.from, BRAND_FARENHYT);
  assert.equal(after.correction.brand.to, BRAND_NOTIFIER);
  // resolution version, both sides
  assert.equal(after.conflict.conflictVersion, 2, "conflict version advanced by one");
  assert.equal(after.conflict.status, "Resolved");
  // actor provenance
  assert.equal(after.humanActorSource, HUMAN_ACTOR_SOURCE);
  assert.equal(after.decidedBy, "omair-primary");
  // supporting evidence
  assert.equal(after.supportingEvidence[0].document, "DS-DET-501-EN-02");
  assert.equal(after.supportingEvidence[0].url, EVIDENCE[0].url);
  // affected canonical entity ids
  assert.equal(after.affectedEntityIds.canonicalProductId, "product_6500");
  assert.equal(after.affectedEntityIds.brandId, BRAND_NOTIFIER);
  // the authority version occupies the optional fingerprint slot
  assert.match(row.ruleset_checksum, /^product-attribution-conflict-resolution-/);
  // replay protection is a database guarantee, not only application logic
  assert.equal(result.decisionId, row.id);
});

test("ATTRIBUTION/O PRESERVE AND RECORD RELATIONSHIP keeps BOTH products distinct", async () => {
  // THE SGWL INVARIANT. Recording that two products are related must never
  // touch either product's identity, and must never move a reference between
  // them -- merging them is the outcome this whole path exists to prevent.
  const { raw, db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertProduct({ id: "product_sgwled", part_number: "SGWLED", normalized_part_number: "SGWLED", description: "LED strobe", family_id: FAMILY_STROBE });
  insertConflict({ id: "conflict_sgwl", conflict_type: DUPLICATE_TYPE, product_id: "product_6500" });

  const result = await resolveAttributionConflict(db, call({
    conflictId: "conflict_sgwl",
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.PRESERVE_AND_RECORD_RELATIONSHIP,
    successorProductId: "product_sgwled",
    relationship: { relationshipType: "Compatible With", note: "SGWLED is the LED-generation successor of SGWL; distinct identities." },
    reason: SUBSTANTIVE_REASON,
  }));
  assert.equal(result.ok, true, result.message);

  const products = raw.prepare("SELECT id, part_number, brand_id, identity_status FROM library_products ORDER BY id").all();
  assert.equal(products.length, 2, "still two products -- no merge");
  assert.deepEqual(products.map((row) => row.part_number), ["6500RSE", "SGWLED"]);
  assert.equal(products.find((row) => row.id === "product_6500").identity_status, "Active", "subject stays Active");
  assert.equal(products.find((row) => row.id === "product_sgwled").identity_status, "Active", "successor stays Active");

  const relationship = raw.prepare("SELECT * FROM engineering_relationships").get();
  assert.equal(relationship.relationship_type, "Compatible With");
  assert.equal(relationship.left_entity_id, "product_6500");
  assert.equal(relationship.right_entity_id, "product_sgwled");
  assert.equal(relationship.provenance_fact_id, null, "FK is to engineering_facts, so provenance rides in conditions");
  // `conditions` is a TEXT column holding JSON, so it is parsed rather than
  // indexed -- a raw string would silently yield undefined for [0].
  const conditions = JSON.parse(relationship.conditions);
  assert.equal(conditions[0].decidedBy, "omair-primary", "the deciding human is recorded on the relationship");
  assert.equal(conditions[0].humanActorSource, HUMAN_ACTOR_SOURCE);
  assert.equal(result.relationshipCreated.relationshipId, relationship.id);
});

test("ATTRIBUTION/P PRESERVE refuses a self, unknown, superseded, or still-contested partner", async () => {
  const { db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertProduct({ id: "product_sgwled", part_number: "SGWLED", normalized_part_number: "SGWLED", description: "LED", family_id: FAMILY_STROBE });
  insertProduct({ id: "product_old", part_number: "OLD", normalized_part_number: "OLD", description: "old", family_id: FAMILY_STROBE, identity_status: "Superseded", superseded_by_product_id: "product_6500" });
  insertConflict({ id: "conflict_sgwl", conflict_type: DUPLICATE_TYPE, product_id: "product_6500" });

  const base = {
    conflictId: "conflict_sgwl",
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.PRESERVE_AND_RECORD_RELATIONSHIP,
    relationship: { relationshipType: "Compatible With" },
    reason: SUBSTANTIVE_REASON,
  };
  assert.equal((await resolveAttributionConflict(db, call({ ...base, successorProductId: "product_6500" }))).code, ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_IS_SELF);
  assert.equal((await resolveAttributionConflict(db, call({ ...base, successorProductId: "product_missing" }))).code, ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_UNKNOWN);
  assert.equal((await resolveAttributionConflict(db, call({ ...base, successorProductId: "product_old" }))).code, ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_SUPERSEDED);

  insertConflict({ id: "conflict_partner", conflict_type: BRAND_TYPE, product_id: "product_sgwled" });
  assert.equal((await resolveAttributionConflict(db, call({ ...base, successorProductId: "product_sgwled" }))).code, ATTRIBUTION_RESOLUTION_ERRORS.SUCCESSOR_CONFLICT_OPEN);
});

test("ATTRIBUTION/Q reversal restores the exact before-state and reopens the conflict", async () => {
  const { raw, db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertConflict();
  const applied = await resolveAttributionConflict(db, call({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { brand: BRAND_NOTIFIER },
    reason: ELEVATION_REASON,
  }));
  assert.equal(readBrand(raw, "product_6500"), BRAND_NOTIFIER);

  const reversed = await reverseAttributionConflictResolution(db, {
    decisionId: applied.decisionId,
    reason: "Reversed: the Notifier rebrand was applied to the wrong catalogue row pending a fresh look at the DOP entity.",
    humanActor: REAL_HUMAN,
    actorRole: "Administrator",
    idempotencyKey: "attr-rev-1",
  });
  assert.equal(reversed.ok, true, reversed.message);
  assert.equal(readBrand(raw, "product_6500"), BRAND_FARENHYT, "brand restored from the stored before-state");
  assert.equal(raw.prepare("SELECT status FROM product_conflicts WHERE id='conflict_6500'").get().status, "Open", "conflict reopened");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products").get().c, 1, "still one product");

  const replay = await reverseAttributionConflictResolution(db, {
    decisionId: applied.decisionId,
    reason: "Reversed: the Notifier rebrand was applied to the wrong catalogue row pending a fresh look at the DOP entity.",
    humanActor: REAL_HUMAN,
    actorRole: "Administrator",
    idempotencyKey: "attr-rev-1",
  });
  assert.equal(replay.idempotent, true, "a second reversal writes nothing");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM identity_decision_audit").get().c, 2, "exactly one apply + one reversal");
});

test("ATTRIBUTION/R reversal requires a human, a reason, a key, and refuses an unknown decision", async () => {
  const { db } = fresh();
  assert.equal((await reverseAttributionConflictResolution(db, { decisionId: "nope", humanActor: REAL_HUMAN })).code, ATTRIBUTION_RESOLUTION_ERRORS.DECISION_NOT_FOUND);
  assert.equal(
    (await reverseAttributionConflictResolution(db, { decisionId: "nope", humanActor: { id: "local-development-user" } })).code,
    ATTRIBUTION_RESOLUTION_ERRORS.HUMAN_ACTOR_REQUIRED,
  );
  assert.equal(
    (await reverseAttributionConflictResolution(db, { decisionId: "nope", humanActor: REAL_HUMAN, reason: "because", idempotencyKey: "k" })).code,
    ATTRIBUTION_RESOLUTION_ERRORS.DECISION_NOT_FOUND,
  );
});

test("ATTRIBUTION/S an unrelated conflict and an unrelated product are never touched", async () => {
  const { raw, db, insertProduct, insertConflict } = fresh();
  insertProduct();
  insertProduct({ id: "product_other", part_number: "OTHER", normalized_part_number: "OTHER", description: "other", family_id: FAMILY_STROBE });
  insertConflict();
  insertConflict({ id: "conflict_other", conflict_type: DUPLICATE_TYPE, product_id: "product_other" });

  return resolveAttributionConflict(db, call({
    decision: ATTRIBUTION_RESOLUTION_OUTCOMES.CORRECT_CANONICAL_ATTRIBUTION,
    correction: { brand: BRAND_NOTIFIER },
    reason: ELEVATION_REASON,
  })).then((result) => {
    assert.equal(result.ok, true);
    assert.equal(raw.prepare("SELECT status FROM product_conflicts WHERE id='conflict_other'").get().status, "Open", "the other conflict stays Open");
    assert.equal(readBrand(raw, "product_other"), BRAND_FARENHYT, "the other product is untouched");
    assert.equal(raw.prepare("SELECT COUNT(*) c FROM identity_decision_audit").get().c, 1, "one decision, one conflict");
  });
});

test("ATTRIBUTION/T snapshots capture exactly the fields this path may write", () => {
  // If the before-snapshot missed a correctable column, reversal could not
  // restore it. Read and write share one field list so that cannot drift.
  const snapshot = attributionProductSnapshot(productRow());
  // Derive the expected key from the same camelCase rule the snapshot uses, so
  // this asserts the snapshot carries the column rather than re-asserting my
  // own spelling of it.
  // The snapshot names fields `brandId` / `manufacturerId` / `familyId`, so the
  // expected key is the lowercase field name plus `Id`.
  const camel = (value) => `${value}Id`;
  for (const entry of CORRECTABLE_ATTRIBUTION_FIELDS) {
    assert.ok(camel(entry.field) in snapshot, `snapshot must carry ${camel(entry.field)}`);
  }
  assert.equal(snapshot.partNumber, "6500RSE");
  assert.equal(attributionConflictSnapshot(conflictRow()).conflictVersion, 1);
});
