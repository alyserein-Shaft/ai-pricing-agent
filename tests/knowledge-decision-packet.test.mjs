// KN-DECISION-1 -- Knowledge decision packets: grouping, the three distinct
// non-approvable states, and the review -> link -> promotion transaction.
//
// WHAT THIS FILE GUARDS. The packet layer exists because a fact queue is not a
// work queue. That makes three promises that are easy to break and expensive to
// get wrong:
//
//   1. Grouping never loses an observation. A reviewer who sees a decision must
//      be able to enumerate every fact behind it, because a fact that vanished
//      from the queue has silently stopped being reviewable.
//   2. "No evidence", "evidence awaiting approval" and "evidence that
//      contradicts itself" are three different situations, and only the middle
//      one can be approved. Conflating them is how an absence of evidence
//      becomes an approval.
//   3. Promotion never happens without the human decision, the exact canonical
//      target, the governed link, and the anchor promotion's own contract
//      requires. The orchestrator's job is to make those four steps ONE
//      transaction, and each of them is a real guarded write that can refuse.
//
// The tests run against a real migrated schema, so a missing column or a UNIQUE
// constraint that would break the identity anchor on replay fails here rather
// than in a pilot.

import test from "node:test";
import assert from "node:assert/strict";

import {
  DECISION_CATEGORIES,
  buildDecisionPackets,
  loadKnowledgeDecisionPackets,
  summarizeDecisionPackets,
  decisionCategoryForFactType,
  promotionDisposition,
} from "../app/domain/knowledge-decision-packet.mjs";
import { declaredDecisionGaps } from "../app/domain/knowledge-declared-decision-gaps.mjs";
import {
  confirmKnowledgeDecisionPacket,
  resolveExactCanonicalTarget,
  PACKET_DECISION_ERRORS,
} from "../worker/knowledge-decision-orchestration.mjs";
import { ADDRESS_MODEL_CANONICAL_VALUES } from "../app/domain/knowledge-promotion-policy.mjs";
import {
  asD1,
  attributeValue,
  canonicalCounts,
  createMigratedDatabase,
  HUMAN,
  seedKnowledgeFile,
  seedManufacturer,
  seedOrganization,
  seedProduct,
  seedResearchFact,
  testIds,
} from "./helpers/decision-packet-db.mjs";

const ORG = "org_decision_packets";
const DOC = "knowledgeFile_test_0001";
const PRODUCT = "product_test_ifp2100hvb";
const PART = "IFP-2100HVB";

/** A fresh migrated database with one product, one file, and nothing else. */
const fresh = () => {
  const raw = createMigratedDatabase();
  seedOrganization(raw, ORG);
  seedManufacturer(raw, { id: "man_honeywell", name: "Honeywell" });
  seedProduct(raw, { id: PRODUCT, partNumber: PART, manufacturerId: "man_honeywell" });
  seedKnowledgeFile(raw, { id: DOC, organizationId: ORG });
  return { raw, db: asD1(raw) };
};

const factRow = (overrides = {}) => ({
  id: "fact_1",
  knowledge_file_id: DOC,
  fact_type: "Address Model",
  original_value: "the module is powered from the loop and does not consume an address",
  normalized_value: "STANDALONE_ADDRESS",
  attributes: JSON.stringify({ observationKey: "batch1:IFP-2100HVB:351602-D", partNumber: PART }),
  confidence: 95,
  review_status: "Learned",
  source_location: JSON.stringify({ documentNumber: "351602", revision: "C/D", page: "2", quote: "q" }),
  file_name: "doc.pdf",
  detected_type: "Product Datasheet",
  source_summary: JSON.stringify({ sourceAuthority: { authorityClass: "Manufacturer Technical Document" } }),
  created_at: "2026-10-01 00:00:00",
  ...overrides,
});

const productRow = (overrides = {}) => ({
  id: PRODUCT,
  part_number: PART,
  normalized_part_number: PART,
  manufacturer_name: "Honeywell",
  family_name: "Farenhyt",
  identity_status: "Active",
  superseded_by_product_id: null,
  lifecycle_status: "Unknown — Review Required",
  library_scope: "Global Library",
  organization_id: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// A. Category mapping: the four capacity types are ONE engineering question
// ---------------------------------------------------------------------------
test("KN-DECISION-1/A the four capacity fact types share one panel-capacity decision", () => {
  for (const factType of ["SLC Loops", "Detector Capacity", "Module Capacity", "System Points"]) {
    assert.equal(
      decisionCategoryForFactType(factType),
      DECISION_CATEGORIES.PANEL_CAPACITY,
      `${factType} is a panel-sizing input and must group with the others`,
    );
  }
  // The address model must NOT be folded into capacity: it is a different
  // engineering question, and merging them would let a capacity approval carry
  // an address-model approval with it.
  assert.equal(
    decisionCategoryForFactType("Address Model"),
    DECISION_CATEGORIES.ADDRESS_MODEL,
  );
  assert.equal(decisionCategoryForFactType("Lifecycle"), DECISION_CATEGORIES.LIFECYCLE);
  assert.equal(decisionCategoryForFactType("Product Relationship"), DECISION_CATEGORIES.COMPATIBILITY);
  assert.equal(decisionCategoryForFactType("Relative Humidity"), DECISION_CATEGORIES.ELECTRICAL_CONDITIONS);
  assert.equal(decisionCategoryForFactType("Certification"), DECISION_CATEGORIES.CERTIFICATION_SCOPE);
  assert.equal(decisionCategoryForFactType("Price"), null, "a fact type with no engineering question is not a decision");
});

test("KN-DECISION-1/A every capacity attribute name is read from the promotion policy, not restated", () => {
  for (const factType of ["SLC Loops", "Detector Capacity", "Module Capacity", "System Points", "Address Model"]) {
    assert.equal(promotionDisposition(factType).promotable, true, `${factType} must be promotion-eligible`);
    assert.equal(promotionDisposition(factType).path, "human", `${factType} must never promote deterministically`);
  }
  // Terminal types must read as terminal so the UI can say "confirmed as
  // evidence, nothing derived" instead of implying a canonical write.
  for (const factType of ["Voltage Range", "Relative Humidity", "Compatible Base", "Certification"]) {
    assert.equal(promotionDisposition(factType).promotable, false, `${factType} is policy-terminal`);
  }
});

// ---------------------------------------------------------------------------
// B. Grouping keeps every atomic fact visible
// ---------------------------------------------------------------------------
test("KN-DECISION-1/B four capacity facts become one packet and all four stay visible", () => {
  const packets = buildDecisionPackets({
    facts: [
      factRow({ id: "f1", fact_type: "SLC Loops", original_value: "8", normalized_value: "8" }),
      factRow({ id: "f2", fact_type: "Detector Capacity", original_value: "159", normalized_value: "159" }),
      factRow({ id: "f3", fact_type: "Module Capacity", original_value: "159", normalized_value: "159" }),
      factRow({ id: "f4", fact_type: "System Points", original_value: "2100", normalized_value: "2100" }),
    ],
    products: [productRow()],
  });
  assert.equal(packets.length, 1, "four capacity facts are one engineering question");
  const packet = packets[0];
  assert.equal(packet.category, DECISION_CATEGORIES.PANEL_CAPACITY);
  assert.equal(packet.observations.length, 4, "grouping must not lose an observation");
  assert.deepEqual(
    packet.observations.map((entry) => entry.factId).sort(),
    ["f1", "f2", "f3", "f4"],
  );
  // The proposed interpretation carries every value, not just the first.
  assert.equal(packet.proposedInterpretation.length, 4);
  assert.deepEqual(
    packet.proposedInterpretation.map((entry) => entry.factType).sort(),
    ["Detector Capacity", "Module Capacity", "SLC Loops", "System Points"],
  );
  // A packet must tell the reviewer what consumes the answer before they decide.
  assert.ok(packet.downstreamConsumers.length > 0, "downstream consumers must be declared");
});

test("KN-DECISION-1/B a fact with no part number never becomes a product named after its value", () => {
  const packets = buildDecisionPackets({
    facts: [
      factRow({
        id: "orphan",
        fact_type: "SLC Loops",
        original_value: "1 (expandable)",
        normalized_value: "1 (expandable)",
        attributes: JSON.stringify({ observationKey: "batch1:IFP-2100HVB:351602-D", partNumber: "" }),
      }),
    ],
    products: [productRow()],
  });
  // Zero packets, and emphatically not a packet for a product called
  // "1 (expandable)".
  assert.equal(packets.length, 0);
  assert.equal(
    packets.some((packet) => packet.partNumber === "1 (expandable)"),
    false,
  );
});

test("KN-DECISION-1/B extractor artifacts are outside the read model's input", () => {
  // The loader filters on `fact_key LIKE 'research:%'`. This asserts the filter
  // is real: an extractor-authored fact in the same file and with the same
  // part number must not join the packet.
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_research",
    fileId: DOC,
    factType: "Address Model",
    value: "the device owns one address",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  raw.prepare(
    `INSERT INTO knowledge_facts
       (id, organization_id, knowledge_file_id, fact_type, fact_key, original_value,
        normalized_value, attributes, confidence, review_status, source_location, created_at)
     VALUES ('fact_extracted',?,?,'Address Model','auto:part-number','IFP-2100HVB','ifp-2100hvb','{}',40,
             'Needs Review','{}','2026-10-01 00:00:00')`,
  ).run(ORG, DOC);

  return loadKnowledgeDecisionPackets(db, { organizationId: ORG }).then(({ packets }) => {
    const observations = packets.flatMap((packet) => packet.observations);
    assert.ok(observations.length > 0);
    assert.equal(
      observations.some((entry) => entry.factId === "fact_extracted"),
      false,
      "an auto-extracted fact must not appear as a reviewable decision observation",
    );
  });
});

// ---------------------------------------------------------------------------
// C. Conflicts: the NORMALIZED value decides, and multi-valued types are exempt
// ---------------------------------------------------------------------------
test("KN-DECISION-1/C two different quotes of one normalized value are corroboration, not a conflict", () => {
  const packets = buildDecisionPackets({
    facts: [
      factRow({ id: "f1", original_value: "quote A", normalized_value: "NON_SLC" }),
      factRow({ id: "f2", original_value: "quote B, worded differently", normalized_value: "NON_SLC" }),
    ],
    products: [productRow()],
  });
  const packet = packets[0];
  assert.equal(packet.reviewState, "pending", "agreement must not be dressed up as a contradiction");
  assert.equal(packet.conflictingValues.length, 0);
  const inventory = packet.values.find((entry) => entry.factType === "Address Model");
  assert.equal(inventory.observedValues.length, 1, "one normalized value, one inventory row");
  assert.equal(inventory.observedValues[0].observationCount, 2, "both observations are retained as corroboration");
});

test("KN-DECISION-1/C two different normalized values on a single-valued type are a real conflict", () => {
  const packets = buildDecisionPackets({
    facts: [
      factRow({ id: "f1", normalized_value: "NON_SLC" }),
      factRow({ id: "f2", normalized_value: "STANDALONE_ADDRESS" }),
    ],
    products: [productRow()],
  });
  const packet = packets[0];
  assert.equal(packet.reviewState, "conflict");
  assert.equal(packet.isConfirmable, false, "a contradicted decision must not offer a blind Confirm");
  assert.equal(packet.conflictingValues.length, 1);
  // Each side must carry its own evidence, or the reviewer is being asked to
  // choose between two naked values.
  const sides = packet.conflictingValues[0].sides;
  assert.equal(sides.length, 2);
  for (const side of sides) {
    // Each side must name its value AND the observations behind it, so the
    // reviewer is choosing between two evidenced readings rather than two bare
    // strings.
    assert.ok(side.normalizedValue, "each side names the value being proposed");
    assert.ok(
      side.corroboratingObservations.length > 0,
      "each side carries the document, revision and quote that support it",
    );
    assert.ok(side.corroboratingObservations[0].documentNumber);
    assert.ok(side.corroboratingObservations[0].quote);
  }
  assert.equal(packet.proposedInterpretation, null, "a conflicted packet proposes no interpretation");
});

test("KN-DECISION-1/C a product legitimately holding several certifications is not a conflict", () => {
  const packets = buildDecisionPackets({
    facts: [
      factRow({ id: "f1", fact_type: "Certification", original_value: "UL: Listed", normalized_value: "UL: Listed" }),
      factRow({ id: "f2", fact_type: "Certification", original_value: "FM: Approved", normalized_value: "FM: Approved" }),
      factRow({ id: "f3", fact_type: "Standard", original_value: "EN 54-12:2015", normalized_value: "EN 54-12:2015" }),
      factRow({ id: "f4", fact_type: "Standard", original_value: "1293-CPR-0684", normalized_value: "1293-CPR-0684" }),
    ],
    products: [productRow()],
  });
  const packet = packets[0];
  assert.equal(packet.category, DECISION_CATEGORIES.CERTIFICATION_SCOPE);
  assert.equal(packet.reviewState, "pending");
  // Every distinct listing survives, which is the point.
  assert.equal(packet.values.find((entry) => entry.factType === "Certification").observedValues.length, 2);
  assert.equal(packet.values.find((entry) => entry.factType === "Standard").observedValues.length, 2);
});

test("KN-DECISION-1/C an open product identity conflict is visible but is not a dimension conflict", () => {
  const packets = buildDecisionPackets({
    facts: [factRow()],
    products: [productRow()],
    conflicts: [
      {
        id: "conflict_1",
        product_id: PRODUCT,
        conflict_type: "Possible Duplicate Identity",
        left_value: "sgwl vs sgwled",
        right_value: "sgwled is the LED successor",
        source_ids: "[]",
        status: "Open",
      },
    ],
  });
  const packet = packets[0];
  assert.equal(packet.openProductConflicts.length, 1, "the open conflict must be visible in the packet");
  assert.equal(packet.openProductConflicts[0].resolutionPathAvailable, false, "there is no governed resolution write path");
  assert.equal(packet.identityConflictOpen, true);
  // The dimension itself is uncontested: marking it "conflict" would train the
  // reviewer to ignore the badge.
  assert.notEqual(packet.reviewState, "conflict");
  assert.equal(packet.reviewState, "pending");
  assert.equal(packet.blockReason, "OPEN_PRODUCT_CONFLICT");
  // The evidence is still reviewable even though promotion must be held.
  assert.equal(packet.isConfirmable, true);
});

// ---------------------------------------------------------------------------
// D. Evidence gap: declared, never confirmable, never inferred
// ---------------------------------------------------------------------------
test("KN-DECISION-1/D a declared gap packet can never be confirmed", () => {
  const packets = buildDecisionPackets({
    facts: [],
    products: [productRow()],
    declaredGaps: [
      {
        partNumber: "B200S-LF-IV",
        category: DECISION_CATEGORIES.ADDRESS_MODEL,
        reason: "351630 Rev A p2 is silent on whether the base shares the detector's address.",
        researchedBy: "Batch 1",
      },
    ],
  });
  assert.equal(packets.length, 1);
  const packet = packets[0];
  assert.equal(packet.reviewState, "evidence_gap");
  assert.equal(packet.isConfirmable, false);
  assert.equal(packet.blockReason, "EVIDENCE_MISSING");
  assert.equal(packet.observations.length, 0, "there is nothing to review");
  assert.equal(packet.proposedInterpretation, null, "a gap must never propose a value");
  assert.ok(packet.evidenceGap.reason.length > 0, "a gap must state what was searched and found silent");
});

test("KN-DECISION-1/D a gap for a dimension that also has observations is not emitted twice", () => {
  const packets = buildDecisionPackets({
    facts: [factRow()],
    products: [productRow()],
    declaredGaps: [
      { partNumber: PART, category: DECISION_CATEGORIES.ADDRESS_MODEL, reason: "should be ignored" },
    ],
  });
  assert.equal(packets.length, 1);
  assert.equal(packets[0].reviewState, "pending", "an observed dimension is a real packet, not a gap");
});

test("KN-DECISION-1/D the declared Batch-1 gaps are all non-approvable and all carry a reason", () => {
  const gaps = declaredDecisionGaps();
  assert.ok(gaps.length > 0, "Batch 1 research concluded there ARE gaps; dropping them would hide the finding");
  for (const gap of gaps) {
    assert.ok(gap.partNumber, "a gap must name the product");
    assert.ok(gap.category, "a gap must name the decision dimension");
    assert.ok(gap.reason.length > 40, `the ${gap.partNumber} ${gap.category} gap must state its evidence`);
    assert.ok(gap.researchedBy, "a gap is a research conclusion and must be attributed");
  }
  const byKey = new Set(gaps.map((gap) => `${gap.partNumber}::${gap.category}`));
  assert.ok(byKey.has(`B200S-LF-IV::${DECISION_CATEGORIES.ADDRESS_MODEL}`), "the B200S address gap must be declared");
  assert.ok(byKey.has(`B200SR-LF-WH::${DECISION_CATEGORIES.ADDRESS_MODEL}`), "the B200SR address gap must be declared");
  assert.ok(byKey.has(`2151-CH::${DECISION_CATEGORIES.LIFECYCLE}`), "2151-CH lifecycle must be declared blocked");
});

// ---------------------------------------------------------------------------
// E. Human actor: the orchestrator refuses a non-human attribution
// ---------------------------------------------------------------------------
test("KN-DECISION-1/E a packet decision without a human identity is refused before any read", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_1",
    fileId: DOC,
    factType: "Address Model",
    value: "the device owns one address",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const { newId, stamp } = testIds();
  const before = raw.prepare("SELECT COUNT(*) c FROM knowledge_facts").get().c;

  for (const badActor of [undefined, null, {}, { id: "" }, { id: "   " }]) {
    const result = await confirmKnowledgeDecisionPacket(db, {
      organizationId: ORG,
      packetId: packets[0].packetId,
      decision: "confirm",
      reason: "Manufacturer states the device owns one loop address.",
      humanActor: badActor,
      idempotencyKey: `k-${Math.random()}`,
      newId,
      stamp,
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, PACKET_DECISION_ERRORS.HUMAN_ACTOR_REQUIRED);
  }
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM knowledge_facts").get().c,
    before,
    "a refused decision must write nothing at all",
  );
});

test("KN-DECISION-1/E a short reason and an unknown decision are refused before any write", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_1",
    fileId: DOC,
    factType: "Address Model",
    value: "v",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const { newId, stamp } = testIds();
  const base = { organizationId: ORG, packetId: packets[0].packetId, humanActor: HUMAN, newId, stamp };

  const short = await confirmKnowledgeDecisionPacket(db, {
    ...base,
    decision: "confirm",
    reason: "yes",
    idempotencyKey: "k-short",
  });
  assert.equal(short.ok, false);
  assert.equal(short.code, PACKET_DECISION_ERRORS.REASON_REQUIRED);

  const bogus = await confirmKnowledgeDecisionPacket(db, {
    ...base,
    decision: "approve_everything",
    reason: "A sufficiently long governed reason for this test.",
    idempotencyKey: "k-bogus",
  });
  assert.equal(bogus.ok, false);
  assert.equal(bogus.code, PACKET_DECISION_ERRORS.DECISION_INVALID);

  // A write-capable decision demands an idempotency key, so a double submit
  // cannot be mistaken for a second decision.
  const noKey = await confirmKnowledgeDecisionPacket(db, {
    ...base,
    decision: "confirm",
    reason: "A sufficiently long governed reason for this test.",
  });
  assert.equal(noKey.ok, false);
  assert.equal(noKey.code, PACKET_DECISION_ERRORS.IDEMPOTENCY_KEY_REQUIRED);
});

test("KN-DECISION-1/E a decision on a packet that does not exist is refused, not invented", async () => {
  const { db } = fresh();
  const { newId, stamp } = testIds();
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: "knowledgePacket_deadbeef",
    decision: "confirm",
    reason: "A sufficiently long governed reason for this test.",
    humanActor: HUMAN,
    idempotencyKey: "k-missing",
    newId,
    stamp,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_DECISION_ERRORS.PACKET_NOT_FOUND);
});

// ---------------------------------------------------------------------------
// F. Evidence gap is refused at the API, not just flagged in the read model
// ---------------------------------------------------------------------------
test("KN-DECISION-1/F confirming an evidence gap is refused and records nothing", async () => {
  const { raw, db } = fresh();
  seedProduct(raw, { id: "product_b200s", partNumber: "B200S-LF-IV" });
  const { newId, stamp } = testIds();
  const { packets } = await loadKnowledgeDecisionPackets(db, {
    organizationId: ORG,
    declaredGaps: declaredDecisionGaps(),
  });
  const gap = packets.find(
    (packet) => packet.partNumber === "B200S-LF-IV" && packet.category === DECISION_CATEGORIES.ADDRESS_MODEL,
  );
  assert.ok(gap, "the declared B200S address gap must be in the queue");
  assert.equal(gap.reviewState, "evidence_gap");

  const before = raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c;

  for (const decision of ["confirm", "reject"]) {
    const result = await confirmKnowledgeDecisionPacket(db, {
      organizationId: ORG,
      packetId: gap.packetId,
      decision,
      reason: "Attempting to approve a dimension with no manufacturer evidence.",
      humanActor: HUMAN,
      declaredGaps: declaredDecisionGaps(),
      idempotencyKey: `k-gap-${decision}`,
      newId,
      stamp,
    });
    assert.equal(result.ok, false, `${decision} of an evidence gap must be refused`);
    assert.equal(result.code, PACKET_DECISION_ERRORS.EVIDENCE_GAP_NOT_APPROVABLE);
  }
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c,
    before,
    "a refused gap approval must leave no audit trace that looks like a decision",
  );

  // The only legal action works, and it deliberately changes nothing.
  const held = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: gap.packetId,
    decision: "needs_investigation",
    reason: "Held: 351630 Rev A is silent on SLC address consumption for this base.",
    humanActor: HUMAN,
    declaredGaps: declaredDecisionGaps(),
    newId,
    stamp,
  });
  assert.equal(held.ok, true);
  assert.equal(held.status, "NEEDS_INVESTIGATION");
  assert.deepEqual(held.factOutcomes, []);
  assert.deepEqual(held.canonicalChanges, []);
  assert.match(held.message, /nothing was promoted/i);
});

// ---------------------------------------------------------------------------
// G. Conflict packets refuse a blind Confirm
// ---------------------------------------------------------------------------
test("KN-DECISION-1/G a conflicted packet refuses a blind Confirm but accepts an explicit one", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_a",
    fileId: DOC,
    factType: "Address Model",
    value: "conventional zone device",
    normalizedValue: "NON_SLC",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  seedResearchFact(raw, {
    id: "fact_b",
    fileId: DOC,
    factType: "Address Model",
    value: "the device owns one loop address",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const packet = packets[0];
  assert.equal(packet.reviewState, "conflict");

  const { newId, stamp } = testIds();
  const blind = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packet.packetId,
    decision: "confirm",
    reason: "Approving the packet as a whole without reading either side.",
    humanActor: HUMAN,
    idempotencyKey: "k-blind",
    newId,
    stamp,
  });
  assert.equal(blind.ok, false);
  assert.equal(blind.code, PACKET_DECISION_ERRORS.CONFLICT_REQUIRES_INTERPRETATION);
  assert.ok(blind.conflictingValues.length > 0, "the refusal must show the two sides and their evidence");
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM knowledge_facts WHERE review_status='Reviewed'").get().c,
    0,
    "the refused blind confirm must not review anything",
  );

  // Naming the interpretation resolves the refusal: the human stands behind one
  // observation and rejects the other.
  const decided = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packet.packetId,
    decision: "confirm",
    factDecisions: { fact_b: "confirm", fact_a: "reject" },
    reason: "The manual states the device owns one loop address; the zone-device wording is superseded.",
    humanActor: HUMAN,
    idempotencyKey: "k-explicit",
    newId,
    stamp,
  });
  assert.equal(decided.ok, true);
  const confirmed = decided.factOutcomes.filter((entry) => entry.review.status === "Reviewed");
  const rejected = decided.factOutcomes.filter((entry) => entry.review.status === "Rejected");
  assert.equal(confirmed.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(confirmed[0].factId, "fact_b");
  assert.equal(rejected[0].factId, "fact_a");
  // Only the side the human stood behind may produce canonical truth.
  assert.equal(decided.canonicalChanges.some((entry) => entry.includes("slc_address_model")), true);
});

// ---------------------------------------------------------------------------
// H. The full link -> review -> promotion transaction
// ---------------------------------------------------------------------------
test("KN-DECISION-1/H one Confirm links, reviews and promotes without a second round trip", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_am",
    fileId: DOC,
    factType: "Address Model",
    value: "the detector head occupies one loop address of its own",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  assert.equal(packets.length, 1);
  const { newId, stamp } = testIds();
  const before = canonicalCounts(raw, PRODUCT);

  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packets[0].packetId,
    decision: "confirm",
    reason: "First-party datasheet 351602 states the head occupies one loop address.",
    humanActor: HUMAN,
    actorPermission: "Administrator",
    idempotencyKey: "k-full-flow",
    newId,
    stamp,
  });

  assert.equal(result.ok, true, result.message);
  assert.equal(result.status, "CONFIRMED");
  assert.equal(result.canonicalProductId, PRODUCT);
  assert.equal(result.links.length, 1);
  assert.equal(result.links[0].status, "Linked", "the governed product link must exist for promotion to be legal");

  const after = canonicalCounts(raw, PRODUCT);
  assert.equal(after.attributes, before.attributes + 1, "exactly one canonical attribute must be created");
  assert.equal(after.promotions, before.promotions + 1);
  assert.equal(after.links, before.links + 1);
  assert.equal(after.productSources, before.productSources + 1, "provenance must be recorded");

  // The value is the controlled vocabulary token, never a scalar address count.
  assert.equal(attributeValue(raw, PRODUCT, "slc_address_model"), "STANDALONE_ADDRESS",
    "the address model must never be flattened to a 0/1 scalar");

  // The identity anchor exists and is explicitly marked as a decision anchor, so
  // no later reader mistakes it for a value extracted from the PDF.
  const anchor = raw
    .prepare("SELECT * FROM knowledge_facts WHERE fact_key=?")
    .get(`decision-anchor:batch1:IFP-2100HVB:351602-D:part-number`);
  assert.ok(anchor, "promotion's identity contract requires a Part Number anchor in the same file");
  assert.equal(anchor.fact_type, "Part Number");
  assert.equal(anchor.original_value, PART);
  assert.equal(anchor.review_status, "Reviewed");
  const anchorAttributes = JSON.parse(anchor.attributes);
  assert.equal(anchorAttributes.identityAnchor, "human-confirmed-decision-anchor");
  assert.equal(anchorAttributes.canonicalProductId, PRODUCT);
  assert.equal(anchorAttributes.observationKey, "batch1:IFP-2100HVB:351602-D");
  // The anchor's location must say it is a human-confirmed binding, not a quote.
  const anchorLocation = JSON.parse(anchor.source_location);
  assert.match(anchorLocation.anchorBasis, /human-confirmed/);

  // The audit trail names the human and records the whole sequence.
  const events = raw
    .prepare("SELECT event_type, details FROM knowledge_file_events ORDER BY created_at, id")
    .all();
  const types = events.map((event) => event.event_type);
  assert.ok(types.includes("Knowledge Review Decision"), "the fact review must be audited");
  assert.ok(types.includes("Knowledge Product Link Decision"), "the identity link must be audited");
  assert.ok(types.includes("Knowledge Decision Packet"), "the packet decision must be audited");
  const packetEvent = JSON.parse(events.find((event) => event.event_type === "Knowledge Decision Packet").details);
  assert.equal(packetEvent.decidedBy, HUMAN.id);
  assert.equal(packetEvent.idempotencyKey, "k-full-flow");
  assert.deepEqual(packetEvent.factIds, ["fact_am"]);
  assert.ok(packetEvent.outcomeSummary.includes("canonical change"), "the event summarises the outcome");
});

test("KN-DECISION-1/H the promotion summary names the concrete change, not 'Success'", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_am",
    fileId: DOC,
    factType: "Address Model",
    value: "the detector head occupies one loop address of its own",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const { newId, stamp } = testIds();
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packets[0].packetId,
    decision: "confirm",
    reason: "First-party datasheet 351602 states the head occupies one loop address.",
    humanActor: HUMAN,
    idempotencyKey: "k-summary",
    newId,
    stamp,
  });
  const summary = result.canonicalChanges.join(" | ");
  assert.match(summary, /slc_address_model/);
  assert.match(summary, /STANDALONE_ADDRESS/);
  assert.doesNotMatch(summary, /^\s*success\s*$/i);
  // Downstream impact must be reported, and only for what actually promoted.
  assert.ok(result.downstream.length > 0);
  assert.equal(result.downstream.every((entry) => entry.active === true), true);
});

test("KN-DECISION-1/H a terminal fact type is confirmed as evidence and says nothing was derived", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_hum",
    fileId: DOC,
    factType: "Relative Humidity",
    value: "10 to 93% non-condensing",
    normalizedValue: "10-93% RH",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const { newId, stamp } = testIds();
  const before = canonicalCounts(raw, PRODUCT);
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packets[0].packetId,
    decision: "confirm",
    reason: "Datasheet states 10 to 93% non-condensing; recorded as governed evidence.",
    humanActor: HUMAN,
    idempotencyKey: "k-terminal",
    newId,
    stamp,
  });
  assert.equal(result.ok, true);
  const outcome = result.factOutcomes[0];
  assert.equal(outcome.review.status, "Reviewed", "the evidence IS reviewed");
  assert.equal(outcome.promotion.status, "NOT_PROMOTABLE_BY_POLICY");
  assert.match(outcome.promotion.summary, /policy-terminal/);
  const after = canonicalCounts(raw, PRODUCT);
  assert.equal(after.attributes, before.attributes, "a terminal type must never create a canonical attribute");
  assert.equal(after.promotions, before.promotions);
  // It is still honestly reported as confirmed, not as a failure.
  assert.equal(result.status, "CONFIRMED");
});

test("KN-DECISION-1/H a lifecycle fact records a lifecycle event, not an attribute", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_life",
    fileId: DOC,
    factType: "Lifecycle",
    // CANONICAL TOKEN. This test previously seeded the prose value
    // "SUPERSEDED — SGWLED replaces SGWL" and asserted it became a canonical
    // lifecycle event -- i.e. it encoded the very defect that let a
    // state-plus-successor sentence reach `product_lifecycle_events`. The test's
    // actual subject is DESTINATION ROUTING (a Lifecycle fact lands in the
    // lifecycle table, not the attribute table), which a canonical token
    // exercises just as well. The prose refusal is asserted separately and more
    // strictly in `tests/knowledge-lifecycle-vocabulary.test.mjs`.
    value: "Superseded",
    normalizedValue: "Superseded",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const { newId, stamp } = testIds();
  const before = canonicalCounts(raw, PRODUCT);
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packets[0].packetId,
    decision: "confirm",
    reason: "Announcement 23.2SS lists SGWLED as replacing SGWL; recorded as the canonical Superseded state only, with the successor claim left as Knowledge evidence rather than encoded in the status value.",
    humanActor: HUMAN,
    idempotencyKey: "k-lifecycle",
    newId,
    stamp,
  });
  assert.equal(result.ok, true, result.message);
  const after = canonicalCounts(raw, PRODUCT);
  assert.equal(after.lifecycle, before.lifecycle + 1, "lifecycle must land in product_lifecycle_events");
  assert.equal(after.attributes, before.attributes, "lifecycle is not an attribute");
  assert.match(result.canonicalChanges.join(" "), /Lifecycle event recorded/i);
});

test("KN-DECISION-1/H a product relationship lands as a governed relationship, not a duplicate table", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_rel",
    fileId: DOC,
    factType: "Product Relationship",
    value: "the IDP-HEAT series mounts on this base",
    normalizedValue: "the IDP-HEAT series mounts on this base",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
    // "Compatible With" is the only relationship type the promotion policy
    // admits, because compatibility authority lives in `product_compatibility`
    // with its own lifecycle. Naming anything else here is exactly the
    // overreach the policy refuses.
    extraAttributes: { relationshipType: "Compatible With", targetPartNumber: "B200S-LF-IV" },
  });
  seedProduct(raw, { id: "product_b200s", partNumber: "B200S-LF-IV" });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const { newId, stamp } = testIds();
  const before = canonicalCounts(raw, PRODUCT);
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packets[0].packetId,
    decision: "confirm",
    reason: "351630 Rev A lists this base for the IDP-HEAT series.",
    humanActor: HUMAN,
    idempotencyKey: "k-relationship",
    newId,
    stamp,
  });
  assert.equal(result.ok, true, result.message);
  const after = canonicalCounts(raw, PRODUCT);
  assert.equal(after.relationships, before.relationships + 1, "relationships go to engineering_relationships");
  assert.equal(after.attributes, before.attributes, "a relationship is not an attribute");
  assert.match(result.canonicalChanges.join(" "), /relationship/i);
  assert.match(result.promotionHeadline, /engineering relationship confirmed/i);
  const relationship = raw.prepare("SELECT * FROM engineering_relationships").get();
  assert.equal(relationship.relationship_type, "Compatible With");
  assert.equal(relationship.right_entity_id, "product_b200s", "the target must be a resolved product id");
  // `provenance_fact_id` is an FK to engineering_facts, not knowledge_facts, so
  // the Knowledge-fact provenance rides in `conditions` instead. That indirection
  // is the only place a reviewer can see which document authorised a
  // relationship, so it is asserted rather than assumed.
  assert.equal(relationship.provenance_fact_id, null);
  const conditions = JSON.parse(relationship.conditions);
  assert.equal(conditions[0].knowledgeFactId, "fact_rel");
  assert.equal(conditions[0].decidedBy, HUMAN.id);
  assert.equal(relationship.status, "Approved", "a human-approved relationship is Approved, not a draft");
});

test("KN-DECISION-1/H a relationship without a resolvable target is refused, never guessed", async () => {
  const { raw, db } = fresh();
  // Two ways a compatibility claim fails to be promotable, and both are real
  // Batch-1 findings rather than hypotheticals: the vocabulary is closed, and
  // the target has to be a product the catalogue actually has.
  const { newId, stamp } = testIds();
  for (const [label, attributes] of [
    ["unlisted relationship type", { relationshipType: "Compatible Base", targetPartNumber: "B200S-LF-IV" }],
    ["no target part number", { relationshipType: "Compatible With" }],
  ]) {
    const factId = `fact_rel_${label.replace(/\W+/g, "_")}`;
    const fileId = `knowledgeFile_${label.replace(/\W+/g, "_")}`;
    const partId = `product_${label.replace(/\W+/g, "_")}`;
    seedKnowledgeFile(raw, { id: fileId });
    seedProduct(raw, { id: partId, partNumber: "TEST-COMPAT" });
    seedResearchFact(raw, {
      id: factId,
      fileId: fileId,
      factType: "Product Relationship",
      value: "compatible with the base",
      normalizedValue: "compatible with the base",
      partNumber: "TEST-COMPAT",
      observationKey: `obs_${fileId}`,
      extraAttributes: attributes,
    });
    const { packets } = await loadKnowledgeDecisionPackets(db, {
      organizationId: ORG,
      partNumberFilter: ["TEST-COMPAT"],
    });
    const packet = packets.find((entry) => entry.partNumber === "TEST-COMPAT");
    const result = await confirmKnowledgeDecisionPacket(db, {
      organizationId: ORG,
      packetId: packet.packetId,
      decision: "confirm",
      reason: "Manufacturer lists this device as mounting on a named base.",
      humanActor: HUMAN,
      idempotencyKey: `k-rel-${label}`,
      newId,
      stamp,
    });
    assert.equal(result.ok, true, `${label}: the review itself is still valid`);
    assert.equal(
      result.factOutcomes[0].review.status,
      "Reviewed",
      `${label}: the evidence is real and is reviewed`,
    );
    assert.equal(
      result.factOutcomes[0].promotion.status,
      label === "unlisted relationship type" ? "UNSUPPORTED_RELATIONSHIP_TYPE" : "MISSING_RELATIONSHIP_TARGET",
      `${label}: the promotion refusal names the actual cause`,
    );
    assert.equal(
      raw.prepare("SELECT COUNT(*) c FROM engineering_relationships").get().c,
      0,
      `${label}: no relationship may be written`,
    );
  }
});

// ---------------------------------------------------------------------------
// I. Idempotent replay
// ---------------------------------------------------------------------------
test("KN-DECISION-1/I replaying the same decision writes nothing a second time", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_am",
    fileId: DOC,
    factType: "Address Model",
    value: "the detector head occupies one loop address of its own",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const packetId = packets[0].packetId;
  const { newId, stamp } = testIds();
  const decision = {
    organizationId: ORG,
    packetId,
    decision: "confirm",
    reason: "First-party datasheet 351602 states the head occupies one loop address.",
    humanActor: HUMAN,
    idempotencyKey: "k-replay",
    newId,
    stamp,
  };

  const first = await confirmKnowledgeDecisionPacket(db, decision);
  assert.equal(first.ok, true, first.message);
  const afterFirst = canonicalCounts(raw, PRODUCT);
  const factCountAfterFirst = raw.prepare("SELECT COUNT(*) c FROM knowledge_facts").get().c;
  const eventCountAfterFirst = raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c;

  const replay = await confirmKnowledgeDecisionPacket(db, { ...decision, newId: testIds().newId });
  assert.equal(replay.ok, true, "a replay must succeed, not error");
  assert.equal(replay.idempotent, true);
  assert.equal(replay.outcome, "IDEMPOTENT_REPLAY");
  assert.match(replay.message, /already recorded/i);

  assert.deepEqual(canonicalCounts(raw, PRODUCT), afterFirst, "a replay must not create canonical truth twice");
  assert.equal(raw.prepare("SELECT COUNT(*) c FROM knowledge_facts").get().c, factCountAfterFirst);
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM knowledge_file_events").get().c,
    eventCountAfterFirst,
    "a replay must not append a second audit row",
  );
});

test("KN-DECISION-1/H2 a replay reports the outcome that was RECORDED, not 'Confirmed'", async () => {
  // THE REGRESSION THIS GUARDS. The idempotency branch used to hardcode
  // `status: CONFIRMED` on every replay. A packet that was held as Needs
  // Investigation therefore came back reading "Confirmed" the moment the same
  // request was re-sent -- so replaying a decision told the engineer the
  // opposite of what was recorded, with no write to explain the change. The
  // idempotency contract is "the same request yields the same answer", and a
  // hardcoded answer breaks it for every outcome except Confirm.
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_hold",
    fileId: DOC,
    factType: "Address Model",
    value: "the base shares the detector's loop address",
    normalizedValue: "HOUSING_NO_ADDITIONAL_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const packetId = packets[0].packetId;
  const { newId, stamp } = testIds();

  const held = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId,
    decision: "needs_investigation",
    reason: "The cited relay-table row does not state SLC address consumption for this housing.",
    humanActor: HUMAN,
    idempotencyKey: "k-held",
    newId,
    stamp,
  });
  assert.equal(held.status, "NEEDS_INVESTIGATION");
  const factsAfterHold = raw.prepare("SELECT review_status, COUNT(*) n FROM knowledge_facts GROUP BY review_status").all();

  const replay = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId,
    decision: "needs_investigation",
    reason: "The cited relay-table row does not state SLC address consumption for this housing.",
    humanActor: HUMAN,
    idempotencyKey: "k-held",
    newId: testIds().newId,
    stamp: testIds().stamp,
  });
  assert.equal(replay.ok, true);
  assert.equal(replay.idempotent, true);
  assert.equal(
    replay.status,
    "NEEDS_INVESTIGATION",
    "a replayed hold must still read as a hold, never as Confirmed",
  );
  assert.match(replay.message, /NEEDS_INVESTIGATION/, "and the message must name the recorded outcome");
  assert.deepEqual(
    raw.prepare("SELECT review_status, COUNT(*) n FROM knowledge_facts GROUP BY review_status").all(),
    factsAfterHold,
    "a replayed hold still writes nothing",
  );
});

test("KN-DECISION-1/I a second Confirm with a NEW key cannot re-promote an already-promoted fact", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_am",
    fileId: DOC,
    factType: "Address Model",
    value: "the detector head occupies one loop address of its own",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const packetId = packets[0].packetId;
  const { newId, stamp } = testIds();
  const base = {
    organizationId: ORG,
    packetId,
    decision: "confirm",
    reason: "First-party datasheet 351602 states the head occupies one loop address.",
    humanActor: HUMAN,
    newId,
    stamp,
  };
  const first = await confirmKnowledgeDecisionPacket(db, { ...base, idempotencyKey: "k-1" });
  assert.equal(first.ok, true, first.message);
  const afterFirst = canonicalCounts(raw, PRODUCT);

  // A different key is a genuinely new request, so it must not be treated as a
  // replay -- and it must also not double-write.
  const second = await confirmKnowledgeDecisionPacket(db, { ...base, idempotencyKey: "k-2" });
  assert.equal(second.ok, true);
  assert.notEqual(second.idempotent, true);
  const afterSecond = canonicalCounts(raw, PRODUCT);
  assert.equal(afterSecond.attributes, afterFirst.attributes, "the fact was already promoted");
  assert.equal(afterSecond.promotions, afterFirst.promotions);
  // The re-review is refused because the fact is no longer reviewable, and the
  // refusal is reported rather than hidden.
  assert.equal(second.factOutcomes[0].review.status, "REFUSED");
  assert.equal(second.factOutcomes[0].review.code, "KNOWLEDGE_REVIEW_ALREADY_DECIDED");
});

// ---------------------------------------------------------------------------
// J. Identity conflicts: review is legal, promotion is held
// ---------------------------------------------------------------------------
test("KN-DECISION-1/J an open identity conflict allows the review but holds promotion", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_am",
    fileId: DOC,
    factType: "Address Model",
    value: "conventional zone device",
    normalizedValue: "NON_SLC",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  raw.prepare(
    `INSERT INTO product_conflicts
       (id, product_id, conflict_type, left_value, right_value, source_ids,
        status, conflict_version, library_scope, organization_id, created_at)
     VALUES ('conflict_sgwl',?,'Possible Duplicate Identity',
             'sgwl vs sgwled','sgwled is the LED successor','[]','Open',1,
             'Global Library',NULL,'2026-10-01 00:00:00')`,
  ).run(PRODUCT);

  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const packet = packets[0];
  assert.equal(packet.identityConflictOpen, true);
  assert.equal(packet.blockReason, "OPEN_PRODUCT_CONFLICT");

  const { newId, stamp } = testIds();
  const before = canonicalCounts(raw, PRODUCT);
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packet.packetId,
    decision: "confirm",
    reason: "Datasheet confirms the device is a conventional zone device; recording as evidence.",
    humanActor: HUMAN,
    idempotencyKey: "k-identity",
    newId,
    stamp,
  });

  assert.equal(result.ok, true, "the evidence may still be reviewed");
  assert.equal(result.promotionStatus, "BLOCKED_OPEN_IDENTITY_CONFLICT");
  assert.equal(result.factOutcomes[0].review.status, "Reviewed");
  assert.equal(result.factOutcomes[0].promotion.status, "BLOCKED_OPEN_IDENTITY_CONFLICT");
  const after = canonicalCounts(raw, PRODUCT);
  assert.equal(after.attributes, before.attributes, "no canonical truth while the identity is contested");
  assert.equal(after.promotions, before.promotions);
  assert.equal(result.blocked[0].code, "OPEN_IDENTITY_CONFLICT");
  assert.deepEqual(result.blocked[0].conflictIds, ["conflict_sgwl"]);
  assert.match(result.message, /open identity conflict/i);
  // The product conflict itself must remain Open: this path does not resolve it.
  assert.equal(
    raw.prepare("SELECT status FROM product_conflicts WHERE id='conflict_sgwl'").get().status,
    "Open",
  );
});

// ---------------------------------------------------------------------------
// K. Exact canonical target verification
// ---------------------------------------------------------------------------
test("KN-DECISION-1/K an ambiguous catalogue target is refused rather than arbitrarily chosen", async () => {
  const { raw, db } = fresh();
  // Two manufacturers legitimately listing the same part number. The schema's
  // uniqueness is per (manufacturer, part number), so this is representable --
  // and the packet layer must refuse rather than pick a manufacturer for the
  // engineer, because binding evidence to the wrong make is unrecoverable.
  seedManufacturer(raw, { id: "man_other", name: "Other Manufacturer" });
  seedProduct(raw, {
    id: "product_dup_1",
    partNumber: PART,
    manufacturerId: "man_other",
  });
  const target = await resolveExactCanonicalTarget(db, { organizationId: ORG, partNumber: PART });
  assert.equal(target.ok, false);
  assert.equal(target.code, PACKET_DECISION_ERRORS.AMBIGUOUS_CANONICAL_TARGET);
  assert.equal(target.candidates.length, 2, "the refusal must show what it could not choose between");

  // And the decision path refuses before it reviews anything.
  seedResearchFact(raw, {
    id: "fact_am",
    fileId: DOC,
    factType: "Address Model",
    value: "v",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const { newId, stamp } = testIds();
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packets[0].packetId,
    decision: "confirm",
    reason: "Manufacturer states the device owns one loop address.",
    humanActor: HUMAN,
    idempotencyKey: "k-ambiguous",
    newId,
    stamp,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_DECISION_ERRORS.AMBIGUOUS_CANONICAL_TARGET);
  assert.equal(
    raw.prepare("SELECT COUNT(*) c FROM knowledge_facts WHERE review_status='Reviewed'").get().c,
    0,
    "an ambiguous target must not be resolved by reviewing anyway",
  );
});

test("KN-DECISION-1/K a product with no catalogue row is refused with a catalogue reason", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_am",
    fileId: DOC,
    factType: "Address Model",
    value: "v",
    normalizedValue: "STANDALONE_ADDRESS",
    partNumber: "NOT-IN-CATALOGUE",
    observationKey: "batch1:NOT-IN-CATALOGUE:doc",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const packet = packets.find((entry) => entry.partNumber === "NOT-IN-CATALOGUE");
  assert.equal(packet.blockReason, "NO_CANONICAL_PRODUCT");
  assert.equal(packet.isConfirmable, false);
  const { newId, stamp } = testIds();
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packet.packetId,
    decision: "confirm",
    reason: "Manufacturer states the device owns one loop address.",
    humanActor: HUMAN,
    idempotencyKey: "k-noproduct",
    newId,
    stamp,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, PACKET_DECISION_ERRORS.NO_CANONICAL_PRODUCT);
});

// ---------------------------------------------------------------------------
// L. The product-level rollup an engineer actually reads
// ---------------------------------------------------------------------------
test("KN-DECISION-1/L the rollup counts decisions, not facts", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "f1", fileId: DOC, factType: "SLC Loops", value: "8", normalizedValue: "8",
    partNumber: PART, observationKey: "obs",
  });
  seedResearchFact(raw, {
    id: "f2", fileId: DOC, factType: "Detector Capacity", value: "159", normalizedValue: "159",
    partNumber: PART, observationKey: "obs",
  });
  seedResearchFact(raw, {
    id: "f3", fileId: DOC, factType: "Module Capacity", value: "159", normalizedValue: "159",
    partNumber: PART, observationKey: "obs",
  });
  seedResearchFact(raw, {
    id: "f4", fileId: DOC, factType: "System Points", value: "2100", normalizedValue: "2100",
    partNumber: PART, observationKey: "obs",
  });
  seedResearchFact(raw, {
    id: "f5", fileId: DOC, factType: "Address Model", value: "v", normalizedValue: "STANDALONE_ADDRESS",
    partNumber: PART, observationKey: "obs",
  });

  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const rows = summarizeDecisionPackets(packets);
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.partNumber, PART);
  // Two decisions, five facts. "5 pending" would be the fact queue again.
  assert.equal(row.totalDecisions, 2);
  assert.equal(row.pendingDecisions, 2);
  assert.equal(row.evidenceGaps, 0);
  assert.ok(["P0", "P1", "P2"].includes(row.priority));
  // A product with a gap or conflict outranks one with only routine pending work.
  const withConflict = summarizeDecisionPackets([
    ...packets,
    {
      packetId: "p2",
      partNumber: "OTHER",
      category: DECISION_CATEGORIES.ADDRESS_MODEL,
      reviewState: "conflict",
      openProductConflicts: [{ conflictId: "c1" }],
      observations: [],
    },
  ]);
  assert.equal(withConflict[0].partNumber, "OTHER", "a contradicted decision must sort first");
  assert.equal(withConflict[0].priority, "P0");
});

// ---------------------------------------------------------------------------
// M. No bypass: the address-model normalizer is a closed vocabulary
// ---------------------------------------------------------------------------
test("KN-DECISION-1/M the address model promotes only as a controlled vocabulary token", async () => {
  const { normalizeKnowledgeFactForPromotion } = await import(
    "../app/domain/knowledge-promotion-policy.mjs"
  );
  for (const value of Object.keys(ADDRESS_MODEL_CANONICAL_VALUES)) {
    const result = normalizeKnowledgeFactForPromotion(
      { factType: "Address Model", originalValue: `quote for ${value}`, normalizedValue: value },
      { authorization: "human" },
    );
    assert.equal(result.status, "SUPPORTED", `${value} must be promotable`);
    assert.equal(result.attributeName, "slc_address_model", "the error must never name the wrong attribute");
    assert.equal(result.normalizedValue, value);
  }
  // An unrecognised value, including a bare count, is refused with the allowed
  // set so it surfaces as a vocabulary question rather than a silent coercion.
  for (const value of ["0", "1", "2", "shares the detector", "TBD", ""]) {
    const result = normalizeKnowledgeFactForPromotion(
      { factType: "Address Model", originalValue: value, normalizedValue: value },
      { authorization: "human" },
    );
    assert.equal(result.status, "UNSUPPORTED_ATTRIBUTE_VALUE", `${value} must not be coerced`);
    assert.equal(result.attributeName, "slc_address_model");
    assert.ok(result.allowedValues.length === 5, "the refusal must name the allowed set");
  }
  // The deterministic path must still refuse: the address model is engineering
  // evidence and never mints canonical truth without a human.
  const deterministic = normalizeKnowledgeFactForPromotion(
    { factType: "Address Model", originalValue: "q", normalizedValue: "NON_SLC" },
    { authorization: "deterministic" },
  );
  assert.equal(deterministic.status, "HUMAN_REVIEW_REQUIRED");
});

test("KN-DECISION-1/M confirming a fact whose value is outside the vocabulary writes no attribute", async () => {
  const { raw, db } = fresh();
  seedResearchFact(raw, {
    id: "fact_am",
    fileId: DOC,
    factType: "Address Model",
    value: "maybe it shares the detector",
    normalizedValue: "PROBABLY_SHARED",
    partNumber: PART,
    observationKey: "batch1:IFP-2100HVB:351602-D",
  });
  const { packets } = await loadKnowledgeDecisionPackets(db, { organizationId: ORG });
  const { newId, stamp } = testIds();
  const before = canonicalCounts(raw, PRODUCT);
  const result = await confirmKnowledgeDecisionPacket(db, {
    organizationId: ORG,
    packetId: packets[0].packetId,
    decision: "confirm",
    reason: "Recording the observation as evidence; the value needs normalisation first.",
    humanActor: HUMAN,
    idempotencyKey: "k-badvocab",
    newId,
    stamp,
  });
  const after = canonicalCounts(raw, PRODUCT);
  assert.equal(after.attributes, before.attributes, "an out-of-vocabulary value must not create an attribute");
  assert.equal(after.promotions, before.promotions);
  // The review still happened -- the evidence is real -- and the promotion
  // refusal is surfaced rather than swallowed.
  assert.equal(result.factOutcomes[0].review.status, "Reviewed");
  assert.match(result.factOutcomes[0].promotion.summary, /Promotion blocked/);
  assert.equal(result.blocked[0].code, "UNSUPPORTED_ATTRIBUTE_VALUE");
});
