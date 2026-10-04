// GOVERNED SUPERSESSION RELATIONSHIP.
//
// THE GAP
// `engineering_relationships` carried exactly one relationship type
// ("Compatible With"), so first-party manufacturer evidence that SGWLED REPLACES
// SGWL had nowhere canonical to go. The evidence was parked in a lifecycle
// STATUS VALUE as prose -- which the closed lifecycle vocabulary now correctly
// refuses -- leaving the successor relationship unrepresentable.
//
// THE MODEL
//   One DIRECTIONAL canonical row:   SGWL  "Superseded By"  SGWLED
//   The inverse is a READ-MODEL projection, never a second row.
//
// These tests prove the model, the separation from compatibility, and that
// supersession is ADVISORY. They do NOT assert that the SGWL -> SGWLED row exists:
// no governed path can create a canonical SGWLED product from first-party
// manufacturer evidence (see SUCCESSOR_PRODUCT_CREATION_PATH: MISSING), so the
// relationship is deliberately NOT created. Every row used here is seeded
// explicitly as a fixture.

import assert from "node:assert/strict";
import test from "node:test";

import {
  COMPATIBILITY_RELATIONSHIP_TYPES,
  isCompatibilityRelationship,
  isSupersessionRelationship,
  normalizeKnowledgeFactForPromotion,
} from "../app/domain/knowledge-promotion-policy.mjs";
import {
  SUCCESSOR_READ_MODEL_VERSION,
  compatibilityEdgesFor,
  splitRelationshipEdges,
  successorOf,
  supersededBy,
} from "../app/domain/successor-relationship.mjs";
import { normalizeLifecycle } from "../app/domain/fire-alarm-panel-capability-normalization.mjs";
import {
  createMigratedDatabase,
  asD1,
  seedOrganization,
  seedManufacturer,
  seedProduct,
} from "./helpers/decision-packet-db.mjs";

const ORG = "org_supersession";
const SGWL = "product_sgwl";
const SGWLED = "product_sgwled";
const OTHER = "product_other";

const relationship = (value) =>
  normalizeKnowledgeFactForPromotion({
    factType: "Product Relationship",
    originalValue: value,
    relationshipType: value,
    targetPartNumber: "SGWLED",
  });

const fresh = () => {
  const raw = createMigratedDatabase();
  const db = asD1(raw);
  seedOrganization(db, ORG);
  seedManufacturer(db, { id: "man_honeywell", name: "Honeywell" });
  seedProduct(db, { id: SGWL, partNumber: "SGWL", manufacturerId: "man_honeywell" });
  seedProduct(db, { id: SGWLED, partNumber: "SGWLED", manufacturerId: "man_honeywell" });
  seedProduct(db, { id: OTHER, partNumber: "FSP-951-IV", manufacturerId: "man_honeywell" });
  return { raw, db };
};

const addRelationship = (raw, {
  id,
  left = SGWL,
  right,
  type,
  status = "Approved",
} = {}) => {
  raw.exec(
    `INSERT INTO engineering_relationships
       (id, left_entity_type, left_entity_id, relationship_type, right_entity_type, right_entity_id,
        conditions, exceptions, fact_type, scope_type, scope_id, confidence, status, version_number,
        effective_from, created_by, created_at)
     VALUES ('${id}','Product','${left}','${type}','Product','${right}','[]','[]','Manufacturer Rule','Product','${left}',95,'${status}',1,'2026-10-01','test','2026-10-01 00:00:00')`,
  );
  return id;
};

// ---------------------------------------------------------------------------
// Vocabulary and direction.
// ---------------------------------------------------------------------------

test("SUPERSESSION/A the governed vocabulary is exactly two types, kept distinct", () => {
  assert.deepEqual([...COMPATIBILITY_RELATIONSHIP_TYPES], ["Compatible With"]);
  assert.ok(isCompatibilityRelationship("Compatible With"));
  assert.ok(isSupersessionRelationship("Superseded By"));
  // The distinction that matters: a supersession edge is NOT a compatibility
  // claim, in either direction.
  assert.equal(isCompatibilityRelationship("Superseded By"), false);
  assert.equal(isSupersessionRelationship("Compatible With"), false);
  // No speculative types were added.
  for (const speculative of ["Part Of", "Replaces", "Supersedes", "Powers", "Alternative To"]) {
    assert.equal(relationship(speculative).status, "UNSUPPORTED_RELATIONSHIP_TYPE", `${speculative} must not be governed`);
  }
});

test("SUPERSESSION/B a Superseded By relationship promotes; a missing exact target is refused", () => {
  const ok = relationship("Superseded By");
  assert.equal(ok.status, "SUPPORTED");
  assert.equal(ok.relationshipType, "Superseded By");
  assert.equal(ok.targetTable, "engineering_relationships");
  assert.equal(ok.targetPartNumber, "SGWLED", "the target must be an exact part number, never free text");

  // A free-text successor is not a canonical target.
  const noTarget = normalizeKnowledgeFactForPromotion({
    factType: "Product Relationship",
    originalValue: "SGWLED replaces SGWL",
    relationshipType: "Superseded By",
  });
  assert.equal(noTarget.status, "MISSING_RELATIONSHIP_TARGET");
});

test("SUPERSESSION/C the inverse is derived, so one fact yields one canonical row", async () => {
  const { raw, db } = fresh();
  addRelationship(raw, { id: "rel_s1", left: SGWL, right: SGWLED, type: "Superseded By" });

  // Forward read.
  const forward = await supersededBy(db, { productId: SGWLED });
  assert.equal(forward.length, 1);
  assert.equal(forward[0].subjectProductId, SGWL);
  assert.equal(forward[0].subjectPartNumber, "SGWL");

  // Inverse read, from the SAME row.
  const inverse = await successorOf(db, { productId: SGWL });
  assert.equal(inverse.subjectProductId, SGWL);
  assert.equal(inverse.targetProductId, SGWLED);
  assert.equal(inverse.targetPartNumber, "SGWLED");
  assert.equal(inverse.readModelVersion, SUCCESSOR_READ_MODEL_VERSION);

  const rowCount = raw.prepare("SELECT COUNT(*) c FROM engineering_relationships").get().c;
  assert.equal(rowCount, 1, "the inverse must not be stored as a second row");
});

test("SUPERSESSION/D a compatibility consumer never sees a supersession edge", async () => {
  const { raw, db } = fresh();
  addRelationship(raw, { id: "rel_s", left: SGWL, right: SGWLED, type: "Superseded By" });
  addRelationship(raw, { id: "rel_c", left: SGWL, right: OTHER, type: "Compatible With" });

  const compat = await compatibilityEdgesFor(db, { productId: SGWL });
  assert.equal(compat.length, 1, "exactly the Compatible With edge");
  assert.equal(compat[0].relationship_type, "Compatible With");
  assert.ok(!compat.some((row) => row.relationship_type === "Superseded By"), "a supersession edge must never read as compatibility");

  const split = await splitRelationshipEdges(db, { productId: SGWL });
  assert.equal(split.compatibility.length, 1);
  assert.equal(split.succession.length, 1);
  assert.equal(split.succession[0].targetPartNumber, "SGWLED");
});

test("SUPERSESSION/E supersession is ADVISORY: no gating field exists on the result", async () => {
  const { raw, db } = fresh();
  addRelationship(raw, { id: "rel_s", left: SGWL, right: SGWLED, type: "Superseded By" });
  const successor = await successorOf(db, { productId: SGWL });
  // The advisory wording an engineer sees.
  assert.equal(successor.advisory, "Superseded — successor: SGWLED");
  assert.equal(successor.advisoryOnly, true);
  // LABEL, DO NOT GATE: there is deliberately no eligibility field to consume.
  for (const forbidden of ["blocking", "excluded", "eligible", "matchesAsCompatible", "available", "inStock"]) {
    assert.equal(forbidden in successor, false, `the read model must not offer "${forbidden}" to gate on`);
  }
  // And the legacy product is untouched: both identities remain distinct and Active.
  assert.equal(raw.prepare(`SELECT COUNT(*) c FROM library_products WHERE id IN ('${SGWL}','${SGWLED}')`).get().c, 2, "both products retained, not merged");
  assert.equal(raw.prepare(`SELECT identity_status FROM library_products WHERE id='${SGWL}'`).get().identity_status, "Active", "the legacy product stays Active and selectable");
});

test("SUPERSESSION/F lifecycle and successor stay SEPARATE concepts", async () => {
  // Lifecycle state and successor identity are different facts and must not be
  // collapsed into one another -- the defect this whole slice exists to fix.
  const successor = normalizeKnowledgeFactForPromotion({
    factType: "Lifecycle",
    originalValue: "Superseded",
    normalizedValue: "Superseded",
  });
  assert.equal(successor.status, "SUPPORTED");
  assert.equal(successor.normalizedValue, "Superseded");
  assert.equal(successor.targetTable, "product_lifecycle_events", "lifecycle goes to the lifecycle table");
  assert.equal(successor.attributeName, "lifecycle_status");
  // The lifecycle value never names a successor.
  assert.doesNotMatch(successor.normalizedValue, /SGWLED/);

  const rel = relationship("Superseded By");
  assert.equal(rel.targetTable, "engineering_relationships", "the successor goes to the relationship table");
  // A relationship evaluation carries NO lifecycle attribute at all -- the two
  // concepts do not share a destination or a field.
  assert.equal(rel.attributeName, undefined);
  assert.equal(rel.relationshipType, "Superseded By");

  // And a successor edge must not imply discontinuation, unavailability or stock.
  const lifecycle = normalizeLifecycle({ lifecycleEvents: [{ lifecycle_status: "Superseded" }] });
  assert.equal(lifecycle.lifecycleStatus, "REPLACED");
  assert.equal(lifecycle.commercialAvailability, undefined);
  assert.equal(lifecycle.technicalSuitability, undefined);
});

test("SUPERSESSION/G a product with no governed successor reports none, never a guess", async () => {
  const { db } = fresh();
  assert.equal(await successorOf(db, { productId: SGWL }), null);
  assert.equal(await successorOf(db, { productId: "" }), null);
  assert.deepEqual(await supersededBy(db, { productId: SGWLED }), []);
});

test("SUPERSESSION/H a retired target is not presented as an actionable successor", async () => {
  const { raw, db } = fresh();
  // `raw.exec` cannot bind parameters, so the retirement is written through the
  // D1 wrapper rather than interpolated.
  db.prepare("UPDATE library_products SET identity_status='Superseded' WHERE id=?").bind(SGWLED).run();
  addRelationship(raw, { id: "rel_s", left: SGWL, right: SGWLED, type: "Superseded By" });
  const successor = await successorOf(db, { productId: SGWL });
  assert.equal(successor.targetUsable, false, "a retired successor is reported as unusable, not offered");
  assert.equal(successor.targetIdentityStatus, "Superseded");
});

test("SUPERSESSION/I end-to-end: promote, replay idempotently, and refuse a competing successor", async () => {
  // The real governed promotion path, seeded the way it actually resolves a
  // product: a `Part Number` anchor fact in the SAME knowledge file with the same
  // observationKey, plus exactly one product link on that anchor. This is the
  // setup the promotion function requires, so the test exercises the production
  // contract rather than a hand-built shortcut.
  const { raw, db } = fresh();
  const { seedKnowledgeFile, seedResearchFact } = await import("./helpers/decision-packet-db.mjs");
  const { promoteKnowledgeFact } = await import("../worker/knowledge-promotion.mjs");
  const FILE = "kf_rel";
  seedKnowledgeFile(db, { id: FILE, fileName: "announcement.pdf", organizationId: ORG });

  const seedRelationshipFact = (id, target) => {
    seedResearchFact(db, {
      id,
      fileId: FILE,
      organizationId: ORG,
      factType: "Product Relationship",
      value: "SGWLED LED STROBE; WALL; WHITE; FIRE; 2-WIRE; COMPACT",
      partNumber: "SGWL",
      observationKey: "announcement:23.2SS",
      extraAttributes: { relationshipType: "Superseded By", targetPartNumber: target },
    });
    // The reviewed decision: the fact is Reviewed before it may promote.
    db.prepare("UPDATE knowledge_facts SET review_status='Reviewed' WHERE id=?").bind(id).run();
  };

  // Anchor + link for the SUBJECT product.
  seedResearchFact(db, {
    id: "anchor_pn",
    fileId: FILE,
    organizationId: ORG,
    factType: "Part Number",
    value: "SGWL",
    partNumber: "SGWL",
    observationKey: "announcement:23.2SS",
  });
  db.prepare("UPDATE knowledge_facts SET review_status='Reviewed' WHERE id=?").bind("anchor_pn").run();
  db.prepare(
    "INSERT INTO knowledge_product_links (id,organization_id,knowledge_fact_id,part_number,existing_product_id,link_state,new_information,created_at) VALUES ('lnk1',?,'anchor_pn','SGWL',?,'Active','{}','2026-10-01 00:00:00')",
  ).bind(ORG, SGWL).run();

  const reason = "Manufacturer Product Announcement 23.2SS lists SGWLED in the REPLACES column against SGWL, so SGWL is superseded by SGWLED. Both are distinct canonical products and the legacy product is retained.";

  // 1. First promotion creates the canonical relationship.
  seedRelationshipFact("fact_rel_1", "SGWLED");
  const first = await promoteKnowledgeFact(db, {
    organizationId: ORG,
    factId: "fact_rel_1",
    actor: { id: "omair-primary", name: "Omair", role: "Administrator" },
    reason,
    idempotencyKey: "sup-1",
    authorization: "human",
  });
  assert.equal(first.status, "PROMOTED", JSON.stringify(first).slice(0, 300));
  assert.equal(first.canonicalEntityType, "Engineering Relationship");
  const created = raw.prepare("SELECT COUNT(*) c FROM engineering_relationships WHERE relationship_type='Superseded By'").get().c;
  assert.equal(created, 1, "exactly one canonical successor row");

  // 2. Identical evidence replayed -> Evidence Only, no duplicate row.
  seedRelationshipFact("fact_rel_2", "SGWLED");
  const again = await promoteKnowledgeFact(db, {
    organizationId: ORG,
    factId: "fact_rel_2",
    actor: { id: "omair-primary", name: "Omair", role: "Administrator" },
    reason,
    idempotencyKey: "sup-2",
    authorization: "human",
  });
  assert.equal(again.status, "EVIDENCE_ONLY", `second independent source must be evidence only, got ${again.status}`);
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_relationships WHERE relationship_type='Superseded By'").get().c, 1, "still exactly one row");

  // 3. A COMPETING successor must fail closed, never be appended.
  seedRelationshipFact("fact_rel_3", "FSP-951-IV");
  const competing = await promoteKnowledgeFact(db, {
    organizationId: ORG,
    factId: "fact_rel_3",
    actor: { id: "omair-primary", name: "Omair", role: "Administrator" },
    reason,
    idempotencyKey: "sup-3",
    authorization: "human",
  });
  assert.equal(competing.status, "CONFLICT", `a competing successor must be refused, got ${competing.status}`);
  assert.equal(competing.existingValue, "SGWLED");
  assert.equal(competing.proposedValue, "FSP-951-IV");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM engineering_relationships WHERE relationship_type='Superseded By'").get().c, 1, "no second successor row was written");

  // 4. The read model sees it, and the legacy product is still Active/selectable.
  const successor = await successorOf(db, { productId: SGWL });
  assert.equal(successor.targetPartNumber, "SGWLED");
  assert.equal(raw.prepare(`SELECT identity_status FROM library_products WHERE id='${SGWL}'`).get().identity_status, "Active");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM library_products").get().c, 3, "no product was merged or created");
});
