// KN-DECISION-1 -- Knowledge Decision Packets.
//
// WHAT THIS IS. The Knowledge review surface presents ATOMIC FACTS: "24
// Learned facts" is not a work queue, it is a spreadsheet row count. An
// engineer does not decide "a fact"; they decide an ENGINEERING QUESTION --
// how many loops does this panel have, what does this detector consume on the
// SLC, is this product still current, does this base accept this head. A
// packet is the governed read model for exactly one such question, carrying
// every observation that bears on it WITHOUT collapsing them.
//
// WHY IT DOES NOT COLLAPSE. A packet's `observations` are the atomic facts.
// `values` is a DERIVED, per-fact-type inventory of what has been observed,
// and any fact-type with more than one distinct value is reported in
// `conflicts` with each side's evidence. Two documents that disagree about
// relative humidity are two observations and two conflict entries, not one
// silently chosen number. Losing an observation is a correctness bug, not a
// display preference, because the whole purpose of the batch is that
// provenance-correct observations survive human handling.
//
// THREE DISTINCT NON-APPROVABLE STATES. This is the part a naive queue gets
// wrong. A fact awaiting approval, a contradiction awaiting interpretation,
// and a dimension with NO observation at all are three different situations
// with three different correct answers, and conflating them is how an
// evidence gap silently becomes an approval:
//
//   reviewable  -- an observation exists and carries evidence; a human may
//                  Confirm or Reject it.
//   conflict    -- two or more observations disagree; a blind Confirm is
//                  refused; the human must name the interpretation they
//                  support (or reject one side, or hold for investigation).
//   evidenceGap -- NO observation exists for this decision. There is nothing
//                  to approve. The only honest action is Needs Investigation,
//                  because inventing a yes/no packet here manufactures
//                  authority nobody has.
//
// Only `reviewable` packets offer Confirm. `evidenceGap` packets are declared,
// never inferred: this module does not guess which dimensions ought to have
// been researched, because "SFPE class 9 spacing" is not a gap in the SLC
// address model and listing it as one would bury the real one.
//
// NOTHING HERE WRITES. This module is a read model. Confirm/Reject/Investigate
// live in `knowledge-decision-confirm.mjs`, which orchestrates the existing
// review/link/promotion domain functions and may not re-implement their SQL.

import { KNOWLEDGE_PROMOTION_ELIGIBILITY } from "./knowledge-promotion-policy.mjs";
import { comparisonPartNumber } from "./knowledge-product-identity-resolver.mjs";
import { storedSourceAuthority } from "./knowledge-source-authority.mjs";

export const KNOWLEDGE_DECISION_PACKET_VERSION = "knowledge-decision-packet-v1";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const parse = (value, fallback = {}) => {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
};

/** Every decision category the read model can expose. */
export const DECISION_CATEGORIES = Object.freeze({
  PANEL_CAPACITY: "Panel Capacity",
  ADDRESS_MODEL: "Address Model",
  LIFECYCLE: "Lifecycle",
  COMPATIBILITY: "Compatibility",
  ELECTRICAL_CONDITIONS: "Electrical Operating Conditions",
  CERTIFICATION_SCOPE: "Certification Scope",
  IDENTITY: "Product Identity",
  PROTOCOL: "Protocol and Device Role",
});

const CATEGORY_BY_FACT_TYPE = Object.freeze({
  // Panel sizing consumes exactly these four canonical attributes. Grouping
  // them is not cosmetic: "how big is this panel" is ONE engineering question
  // answered by four numbers, and an engineer who has to approve them as four
  // unrelated facts cannot tell whether they are mutually consistent.
  "SLC Loops": DECISION_CATEGORIES.PANEL_CAPACITY,
  "Detector Capacity": DECISION_CATEGORIES.PANEL_CAPACITY,
  "Module Capacity": DECISION_CATEGORIES.PANEL_CAPACITY,
  "System Points": DECISION_CATEGORIES.PANEL_CAPACITY,
  "Network Panels": DECISION_CATEGORIES.PANEL_CAPACITY,
  "NAC Outputs": DECISION_CATEGORIES.PANEL_CAPACITY,
  "Auxiliary Power Outputs": DECISION_CATEGORIES.PANEL_CAPACITY,

  // The SLC address model decides loop/point budgeting, so an incorrect value
  // silently mis-sizes every panel the device appears in. It is its own
  // decision and must never be merged into a capacity packet.
  "Address Model": DECISION_CATEGORIES.ADDRESS_MODEL,
  "SLC Addresses Consumed": DECISION_CATEGORIES.ADDRESS_MODEL,
  "Device Role": DECISION_CATEGORIES.PROTOCOL,
  "Detector Technology": DECISION_CATEGORIES.PROTOCOL,
  "Protocol": DECISION_CATEGORIES.PROTOCOL,

  Lifecycle: DECISION_CATEGORIES.LIFECYCLE,

  "Product Relationship": DECISION_CATEGORIES.COMPATIBILITY,
  "Compatible Base": DECISION_CATEGORIES.COMPATIBILITY,
  "Expansion Hardware": DECISION_CATEGORIES.COMPATIBILITY,

  "Voltage Range": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "Standby Current": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "Alarm Current": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "SLC Current": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "Auxiliary Power Current": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "Power Supply Input": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "Power Supply Total Current": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "NAC Current per Circuit": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "Operating Temperature": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,
  "Relative Humidity": DECISION_CATEGORIES.ELECTRICAL_CONDITIONS,

  Certification: DECISION_CATEGORIES.CERTIFICATION_SCOPE,
  Standard: DECISION_CATEGORIES.CERTIFICATION_SCOPE,
});

/**
 * Which system capability actually consumes the canonical truth a category
 * produces. Shown on the packet BEFORE the human decides, because a reviewer
 * who cannot see the consequence cannot prioritise, and shown again after
 * promotion as proof the decision landed somewhere real.
 */
export const DOWNSTREAM_CONSUMERS = Object.freeze({
  [DECISION_CATEGORIES.PANEL_CAPACITY]: Object.freeze([
    "Panel sizing and capacity warnings",
    "System-point budget against the Farenhyt <=2000 / Gamewell >2000 brand threshold",
  ]),
  [DECISION_CATEGORIES.ADDRESS_MODEL]: Object.freeze([
    "SLC loop/point budgeting",
    "Panel sizing resource model",
    "Detector substitution matching",
  ]),
  [DECISION_CATEGORIES.PROTOCOL]: Object.freeze([
    "Protocol compatibility matching",
    "Device substitution matching",
  ]),
  [DECISION_CATEGORIES.COMPATIBILITY]: Object.freeze([
    "Governed compatibility evidence for matching",
    "Base/head assembly validation",
  ]),
  [DECISION_CATEGORIES.LIFECYCLE]: Object.freeze([
    "Lifecycle history for the product",
  ]),
  [DECISION_CATEGORIES.ELECTRICAL_CONDITIONS]: Object.freeze([
    "Reference only: these fact types are safety-terminal and do not become canonical attributes",
  ]),
  [DECISION_CATEGORIES.CERTIFICATION_SCOPE]: Object.freeze([
    "Reference only: certification observations are documentation-terminal",
  ]),
  [DECISION_CATEGORIES.IDENTITY]: Object.freeze([
    "Product identity resolution",
  ]),
});

/** The decision category for one governed fact type. */
export const decisionCategoryForFactType = (factType) =>
  CATEGORY_BY_FACT_TYPE[clean(factType)] || null;

/**
 * Whether confirming this fact type can ever produce canonical truth, read
 * from the promotion policy rather than restated here. Restating it would be a
 * second source of truth that could drift from the gate that actually runs.
 */
export const promotionDisposition = (factType) => {
  const rule = KNOWLEDGE_PROMOTION_ELIGIBILITY[clean(factType)];
  if (!rule) return { promotable: false, path: null, destination: null, attributeName: null };
  return {
    promotable: Boolean(rule.eligible),
    path: rule.eligible ? rule.path : null,
    destination: rule.eligible ? rule.destination : null,
    attributeName: rule.eligible ? rule.attributeName || null : null,
  };
};

const packetId = (partNumber, category) =>
  `knowledgePacket_${hash(`${clean(partNumber).toUpperCase()}::${category}`)}`;

/** FNV-1a hex, matching the knowledge-fact id style so ids stay comparable. */
const hash = (value) => {
  let out = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    out ^= value.charCodeAt(index);
    out = Math.imul(out, 0x01000193) >>> 0;
  }
  return out.toString(16).padStart(8, "0");
};

// The family is reported only when the catalogue actually declares one. Guessing
// "Honeywell IDP" from a part-number prefix would manufacture a family that no
// catalogue row backs, and a reviewer would reasonably trust it.
const familyOf = (product) => clean(product?.family_name || "");

const observationView = (row) => {
  const attributes = parse(row.attributes);
  const sourceLocation = parse(row.source_location);
  const fileSummary = parse(row.source_summary);
  const authority = storedSourceAuthority({ summary: fileSummary });
  return {
    factId: row.id,
    factType: row.fact_type,
    // The value exactly as authored. Never reformat it here: the reviewer is
    // judging the manufacturer's words, not a normalized form of them.
    value: row.original_value,
    normalizedValue: row.normalized_value,
    unit: attributes.unit || null,
    reviewStatus: row.review_status,
    confidence: row.confidence ?? null,
    observationKey: clean(attributes.observationKey),
    partNumber: clean(attributes.partNumber),
    // Read the extractor's key too. Otherwise a reviewer is shown a blank
    // relationship type for every engine-authored fact and cannot see that the
    // document actually said "Requires" -- which is the same invisibility that
    // made the P0 laundering defect possible.
    relationshipType: clean(attributes.relationshipType) || clean(attributes.relationship),
    targetPartNumber: clean(attributes.targetPartNumber),
    authoringChannel: clean(attributes.authoringChannel),
    retrievalMethod:
      clean(sourceLocation.retrievalMethod) || clean(attributes.researchMethod) || null,
    evidence: {
      knowledgeFileId: row.knowledge_file_id,
      fileName: row.file_name,
      documentNumber: clean(sourceLocation.documentNumber),
      revision: clean(sourceLocation.revision),
      page: sourceLocation.page ?? null,
      section: clean(sourceLocation.section) || null,
      quote: clean(sourceLocation.quote) || null,
      url: clean(sourceLocation.url) || null,
      sourceAuthority: authority?.authorityClass || null,
      sourceAuthorityEvidence: authority?.evidence || [],
      detectedType: row.detected_type,
    },
    policyPromotion: promotionDisposition(row.fact_type),
  };
};

/**
 * Fact types where a product can legitimately hold SEVERAL distinct values at
 * once. A detector is certified to UL, FM and CSFM simultaneously, and it can be
 * compatible with a dozen bases and a dozen panels. Reporting "three distinct
 * Certification values" as a contradiction would train the reviewer to dismiss
 * conflict warnings as noise, which is precisely how a real conflict on a
 * single-valued attribute gets waved through.
 *
 * Everything NOT in this set is single-valued: one voltage range, one operating
 * temperature, one address model, one lifecycle status. Two different answers
 * there genuinely disagree.
 */
const MULTI_VALUE_FACT_TYPES = Object.freeze(new Set([
  "Product Relationship",
  "Certification",
  "Standard",
  "Compatible Base",
  "Expansion Hardware",
  "Product Description",
  "Product Family",
]));

/**
 * Per-fact-type inventory of observed values.
 *
 * TWO DISTINCT SIGNATURES, and the distinction matters:
 *
 *   * The CONFLICT signature uses the NORMALIZED value. Two documents quoting the
 *     same manufacturer wording differently ("conventional long range projected
 *     beam smoke detector; conventional zone device" vs "combined
 *     transmitter/receiver units that can be directly connected to a conventional
 *     detector circuit") both normalize to NON_SLC. Those are two corroborating
 *     observations of one value, and comparing the raw quotes would have
 *     manufactured a conflict out of agreement.
 *
 *   * The GROUPING signature additionally carries the relationship target,
 *     because two relationships to different products are two relationships, not
 *     two answers to one question.
 */
const buildValueInventory = (observations) => {
  const byType = new Map();
  for (const observation of observations) {
    const key = observation.factType;
    if (!byType.has(key)) byType.set(key, []);
    byType.get(key).push(observation);
  }
  return Array.from(byType.entries()).map(([factType, entries]) => {
    const distinct = new Map();
    const conflictGroups = new Map();
    for (const entry of entries) {
      const groupingKey = [
        entry.normalizedValue.trim().toUpperCase(),
        entry.relationshipType.toUpperCase(),
        entry.targetPartNumber.toUpperCase(),
      ].join("|");
      if (!distinct.has(groupingKey)) distinct.set(groupingKey, []);
      distinct.get(groupingKey).push(entry);
      const conflictKey = [
        entry.normalizedValue.trim().toUpperCase(),
        entry.relationshipType.toUpperCase(),
        entry.targetPartNumber.toUpperCase(),
      ].join("|");
      if (!conflictGroups.has(conflictKey)) conflictGroups.set(conflictKey, []);
      conflictGroups.get(conflictKey).push(entry);
    }
    const observedValues = Array.from(distinct.values()).map((group) => ({
      value: group[0].value,
      normalizedValue: group[0].normalizedValue,
      relationshipType: group[0].relationshipType || null,
      targetPartNumber: group[0].targetPartNumber || null,
      observationCount: group.length,
      corroboratingObservations: group.map((entry) => ({
        factId: entry.factId,
        documentNumber: entry.evidence.documentNumber || null,
        revision: entry.evidence.revision || null,
        fileName: entry.evidence.fileName,
        quote: entry.evidence.quote,
        reviewStatus: entry.reviewStatus,
      })),
    }));
    const multiValued = MULTI_VALUE_FACT_TYPES.has(factType);
    const distinctAnswers = new Set(
      Array.from(distinct.values()).map((group) =>
        group[0].normalizedValue.trim().toUpperCase(),
      ),
    );
    return {
      factType,
      canonicalAttribute: promotionDisposition(factType).attributeName,
      multiValued,
      observedValues,
      // >1 distinct normalized answer for a SINGLE-valued fact type is a real
      // contradiction. Absence of another observation is NOT a conflict and is
      // never reported as one.
      conflicting: !multiValued && distinctAnswers.size > 1,
    };
  });
};

/**
 * Build packets from pre-loaded rows. Exported separately from the loader so
 * the grouping, conflict and state rules are testable without a database.
 */
export const buildDecisionPackets = ({
  facts = [],
  products = [],
  conflicts = [],
  promotions = [],
  links = [],
  packetDecisions = [],
  declaredGaps = [],
} = {}) => {
  const productByPart = new Map();
  for (const product of products) {
    const key = clean(product.part_number).toUpperCase();
    if (!productByPart.has(key)) productByPart.set(key, []);
    productByPart.get(key).push(product);
  }
  const liveProductFor = (partNumber) => {
    const rows = productByPart.get(clean(partNumber).toUpperCase()) || [];
    const live = rows.filter(
      (row) => !clean(row.superseded_by_product_id) && clean(row.identity_status) !== "Superseded",
    );
    // Ambiguity is reported, never resolved. Two live catalogue rows for one
    // part number is a catalogue defect; picking one here would let a research
    // fact bind to an arbitrary product.
    return { live, ambiguous: live.length > 1 };
  };

  const decisionByPacket = new Map();
  for (const decision of packetDecisions) {
    const id = clean(decision.packetId);
    if (!id) continue;
    if (!decisionByPacket.has(id)) decisionByPacket.set(id, []);
    decisionByPacket.get(id).push(decision);
  }

  const grouped = new Map();
  // Grouping resolves partNumber from the FACT's own attributes only. It must
  // never fall back to the observation's value: doing so manufactured three
  // phantom "products" named "1 (expandable)", "Discontinued" and "IDP
  // (Intelligent Device Protocol) / System Sensor, or Hochiki SD" from facts that
  // simply carry no part number, and a product row whose name is a quantity is
  // worse than a product row that is missing.
  for (const fact of facts) {
    const observation = observationView(fact);
    if (!observation.observationKey) continue;
    const category = decisionCategoryForFactType(observation.factType);
    if (!category) continue;
    const partNumber = observation.partNumber;
    if (!partNumber) continue;
    const key = `${clean(partNumber).toUpperCase()}::${category}`;
    if (!grouped.has(key)) {
      grouped.set(key, { partNumber, category, observations: [] });
    }
    grouped.get(key).observations.push(observation);
  }

  const packets = [];

  for (const { partNumber, category, observations } of grouped.values()) {
    const id = packetId(partNumber, category);
    const { live, ambiguous } = liveProductFor(partNumber);
    const product = live[0] || null;
    const inventory = buildValueInventory(observations);
    const conflictingEntries = inventory.filter((entry) => entry.conflicting);
    const openConflicts = conflicts.filter(
      (conflict) =>
        clean(conflict.status) === "Open" &&
        clean(conflict.product_id) &&
        product &&
        clean(conflict.product_id) === clean(product.id),
    );
    const promotionsByFact = new Map(promotions.map((row) => [clean(row.knowledge_fact_id), row]));
    const linksByFact = new Map(links.map((row) => [clean(row.knowledge_fact_id), row]));
    const recordedDecisions = decisionByPacket.get(id) || [];
    const latestByFact = new Map();
    for (const decision of recordedDecisions) {
      for (const factId of decision.factIds || []) {
        latestByFact.set(factId, decision);
      }
    }

    const observationsWithState = observations.map((observation) => {
      const link = linksByFact.get(observation.factId);
      const promotion = promotionsByFact.get(observation.factId);
      const packetDecision = latestByFact.get(observation.factId);
      return {
        ...observation,
        link: link
          ? {
              linkId: link.id,
              linkState: link.link_state,
              existingProductId: link.existing_product_id || null,
            }
          : null,
        // Stays null until a promotion actually runs for this observation.
        promotion: promotion
          ? {
              promotionId: promotion.id,
              action: promotion.action,
              canonicalEntityType: promotion.canonical_entity_type,
              canonicalEntityId: promotion.canonical_entity_id,
              decidedBy: promotion.decided_by,
              createdAt: promotion.created_at,
            }
          : null,
        packetDecision: packetDecision
          ? {
              decision: packetDecision.decision,
              reason: packetDecision.reason,
              decidedBy: packetDecision.decidedBy,
              decidedAt: packetDecision.decidedAt,
            }
          : null,
      };
    });

    const packetLevelHold = recordedDecisions.find(
      (decision) => clean(decision.decision) === "needs_investigation",
    );

    // "Conflict" means ONE THING ONLY: two observations of the same
    // single-valued fact type disagree. An open identity conflict on the product
    // is a DIFFERENT problem -- the product's identity is unresolved, not this
    // dimension's value -- and conflating them marked every dimension of SGWL and
    // 6500RSE as contradicted, which is both false and exactly how a reviewer
    // learns to ignore the conflict badge. It gets its own flag below.
    const identityConflictOpen = openConflicts.length > 0;

    let reviewState = "pending";
    if (packetLevelHold) reviewState = "needs_investigation";
    else if (conflictingEntries.length > 0) reviewState = "conflict";
    else if (observations.every((entry) => entry.reviewStatus === "Reviewed")) reviewState = "confirmed";
    else if (observations.every((entry) => entry.reviewStatus === "Rejected")) reviewState = "rejected";
    else if (observations.some((entry) => entry.reviewStatus === "Reviewed" || entry.reviewStatus === "Rejected"))
      reviewState = "partially_decided";

    // `policyPromotion` is the read from the promotion table, fixed at build
    // time. `promotion` is the per-observation slot the orchestrator later
    // overwrites with the outcome of an actual promotion, so counting the wrong
    // one would report every fact as terminal after a successful review.
    const promotable = observationsWithState.filter((entry) => entry.policyPromotion.promotable);

    const blockReason = ambiguous
      ? "AMBIGUOUS_CATALOGUE_TARGET"
      : !product
        ? "NO_CANONICAL_PRODUCT"
        // An unresolved product identity blocks promotion into canonical truth
        // even when the value itself is uncontested, because the destination
        // product is not yet known to be the right one. Reviewing the evidence
        // stays legal -- the observation is real either way -- but nothing may be
        // promoted until a Library Manager resolves the identity.
        : identityConflictOpen
          ? "OPEN_PRODUCT_CONFLICT"
          : null;

    packets.push({
      packetId: id,
      packetVersion: KNOWLEDGE_DECISION_PACKET_VERSION,
      partNumber: clean(partNumber),
      canonicalProductId: product?.id || null,
      canonicalPartNumber: product ? clean(product.part_number) : null,
      family: familyOf(product),
      manufacturerName: clean(product?.manufacturer_name),
      category,
      // "Evidence Missing" vs "awaiting review" is the distinction a naive
      // queue loses. A packet here always HAS observations; gaps are emitted
      // separately and can never be confirmed.
      reviewState,
      identityConflictOpen,
      // Confirmable means "a human may approve this evidence". It does NOT mean
      // "promotion will succeed": an open identity conflict blocks promotion
      // while leaving review legal, and the orchestrator reports that distinction
      // rather than refusing the review outright.
      isConfirmable:
        reviewState !== "conflict"
        && reviewState !== "needs_investigation"
        && !ambiguous
        // No catalogue row means there is nothing to approve evidence *onto*.
        // Offering a Confirm here and refusing it in the orchestrator would be
        // the read model and the write path disagreeing about the same packet.
        && Boolean(product),
      blockReason,
      proposedInterpretation:
        conflictingEntries.length > 0
          ? null
          : inventory.map((entry) => ({
              factType: entry.factType,
              value: entry.observedValues[0]?.value ?? null,
              canonicalAttribute: entry.canonicalAttribute,
              observationCount: entry.observedValues[0]?.observationCount ?? 0,
            })),
      values: inventory,
      conflictingValues: conflictingEntries.map((entry) => ({
        factType: entry.factType,
        sides: entry.observedValues,
      })),
      openProductConflicts: openConflicts.map((conflict) => ({
        conflictId: conflict.id,
        conflictType: conflict.conflict_type,
        leftValue: conflict.left_value,
        rightValue: conflict.right_value,
        status: conflict.status,
        sourceIds: conflict.source_ids,
        // Resolution stays a Library Manager decision and there is currently no
        // governed write path for it. The packet says so instead of implying
        // that reviewing the facts settles the conflict.
        resolutionPathAvailable: false,
      })),
      observations: observationsWithState,
      sources: Array.from(
        observationsWithState.reduce((acc, entry) => {
          const evidence = entry.evidence;
          const key = `${evidence.fileName}::${evidence.documentNumber}::${evidence.revision}`;
          if (!acc.has(key)) {
            acc.set(key, {
              fileName: evidence.fileName,
              documentNumber: evidence.documentNumber || null,
              revision: evidence.revision || null,
              sourceAuthority: evidence.sourceAuthority,
              detectedType: evidence.detectedType,
              knowledgeFileId: evidence.knowledgeFileId,
              url: evidence.url || null,
            });
          }
          return acc;
        }, new Map()).values(),
      ),
      downstreamConsumers: DOWNSTREAM_CONSUMERS[category] || [],
      promotableFactCount: promotable.length,
      terminalFactCount: observationsWithState.length - promotable.length,
      recommendationFromResearch: null,
      history: recordedDecisions.map((decision) => ({
        decision: decision.decision,
        reason: decision.reason,
        decidedBy: decision.decidedBy,
        decidedByName: decision.decidedByName,
        decidedAt: decision.decidedAt,
        factCount: (decision.factIds || []).length,
        outcomeSummary: decision.outcomeSummary || null,
      })),
    });
  }

  for (const gap of declaredGaps) {
    const partNumber = clean(gap.partNumber);
    const category = clean(gap.category);
    const id = packetId(partNumber, category);
    if (packets.some((packet) => packet.packetId === id)) continue;
    const { live, ambiguous } = liveProductFor(partNumber);
    const product = live[0] || null;
    packets.push({
      packetId: id,
      packetVersion: KNOWLEDGE_DECISION_PACKET_VERSION,
      partNumber,
      canonicalProductId: product?.id || null,
      canonicalPartNumber: product ? clean(product.part_number) : null,
      family: familyOf(product),
      manufacturerName: clean(product?.manufacturer_name),
      category,
      reviewState: "evidence_gap",
      // Present on every packet so a client never has to test for its
      // existence: a gap packet trivially has no open identity conflict, but it
      // would be absent from the JSON otherwise and a `packet.identityConflictOpen`
      // read would be `undefined` rather than `false`.
      identityConflictOpen: false,
      // The single most important field in this file. There is no observation,
      // so there is nothing to approve, and this packet can never transition to
      // "confirmed" no matter what a caller sends.
      isConfirmable: false,
      blockReason: "EVIDENCE_MISSING",
      evidenceGap: {
        reason: clean(gap.reason) || "No manufacturer observation for this decision was recorded.",
        researchedBy: clean(gap.researchedBy) || null,
        note: clean(gap.note) || null,
      },
      proposedInterpretation: null,
      values: [],
      conflictingValues: [],
      openProductConflicts: [],
      observations: [],
      sources: [],
      downstreamConsumers: DOWNSTREAM_CONSUMERS[category] || [],
      promotableFactCount: 0,
      terminalFactCount: 0,
      recommendationFromResearch: null,
      history: [],
      ...(ambiguous ? { blockReason: "AMBIGUOUS_CATALOGUE_TARGET" } : {}),
    });
  }

  packets.sort(
    (a, b) =>
      a.partNumber.localeCompare(b.partNumber) || a.category.localeCompare(b.category),
  );
  return packets;
};

/**
 * Load everything the read model needs in a bounded number of queries, then
 * group in memory. Only research-authored facts are eligible: extractor
 * artifacts (numeric strings misread as part numbers, BOQ-shaped detections of
 * a datasheet) are not engineering decisions and must never appear in a
 * review queue.
 */
export const loadKnowledgeDecisionPackets = async (db, input = {}) => {
  const organizationId = clean(input.organizationId);
  if (!organizationId) return { packets: [], products: [], conflicts: [], total: 0 };
  const partNumberFilter = (input.partNumbers || []).map((value) => clean(value).toUpperCase()).filter(Boolean);
  const maxPackets = Number(input.limit) > 0 ? Number(input.limit) : 400;

  const facts = await db
    .prepare(
      `SELECT f.id, f.knowledge_file_id, f.fact_type, f.original_value, f.normalized_value,
              f.attributes, f.confidence, f.review_status, f.source_location,
              k.file_name, k.detected_type, k.summary AS source_summary
       FROM knowledge_facts f
       JOIN knowledge_files k ON k.id = f.knowledge_file_id
       WHERE f.organization_id = ?
         AND f.fact_key LIKE 'research:%'
       ORDER BY f.created_at ASC, f.id ASC`,
    )
    .bind(organizationId)
    .all();

  const partNumbers = Array.from(
    new Set(
      (facts.results || [])
        .map((row) => clean(parse(row.attributes).partNumber).toUpperCase())
        .filter(Boolean),
    ),
  );
  for (const value of partNumberFilter) {
    if (!partNumbers.includes(value)) partNumbers.push(value);
  }

  const placeholders = partNumbers.map(() => "?").join(",") || "''";
  // `library_products` stores manufacturer and family as foreign keys, not
// columns, so the joins are required rather than cosmetic: joining them keeps the
// packet's "which family is this" answer real instead of derived from a
// part-number prefix, which would invent a family the catalogue does not have.
const products = await db
    .prepare(
      `SELECT p.id, p.part_number, p.normalized_part_number,
              m.name AS manufacturer_name, f.name AS family_name,
              p.identity_status, p.superseded_by_product_id, p.lifecycle_status,
              p.library_scope, p.organization_id
       FROM library_products p
       LEFT JOIN product_manufacturers m ON m.id = p.manufacturer_id
       LEFT JOIN product_families f ON f.id = p.family_id
       WHERE UPPER(p.part_number) IN (${placeholders})`,
    )
    .bind(...partNumbers)
    .all();

  const productIds = (products.results || []).map((row) => clean(row.id));
  const productIdPlaceholders = productIds.map(() => "?").join(",") || "''";

  const [conflicts, promotions, links] = await Promise.all([
    db
      .prepare(
        `SELECT id, product_id, conflict_type, left_value, right_value, source_ids, status
         FROM product_conflicts
         WHERE status='Open' AND product_id IN (${productIdPlaceholders})`,
      )
      .bind(...productIds)
      .all(),
    db
      .prepare(
        `SELECT knowledge_fact_id, id, action, canonical_entity_type, canonical_entity_id, decided_by, created_at
         FROM knowledge_promotions
         WHERE organization_id = ?`,
      )
      .bind(organizationId)
      .all(),
    db
      .prepare(
        `SELECT knowledge_fact_id, id, link_state, existing_product_id
         FROM knowledge_product_links
         WHERE organization_id = ?`,
      )
      .bind(organizationId)
      .all(),
  ]);

  const packetDecisions = await loadPacketDecisions(db, organizationId);

  const packets = buildDecisionPackets({
    facts: (facts.results || []).filter((row) => {
      if (!partNumberFilter.length) return true;
      const partNumber = clean(parse(row.attributes).partNumber).toUpperCase();
      return partNumberFilter.includes(partNumber);
    }),
    products: products.results || [],
    conflicts: conflicts.results || [],
    promotions: promotions.results || [],
    links: links.results || [],
    packetDecisions,
    declaredGaps: input.declaredGaps || [],
  });

  return {
    packets: packets.slice(0, maxPackets),
    products: products.results || [],
    conflicts: conflicts.results || [],
    total: packets.length,
  };
};

/** Packet-level human decisions are recorded as Knowledge file events. */
export const PACKET_DECISION_EVENT_TYPE = "Knowledge Decision Packet";

export const loadPacketDecisions = async (db, organizationId) => {
  const rows = await db
    .prepare(
      `SELECT e.id, e.knowledge_file_id, e.details, e.actor_user_id, e.created_at
       FROM knowledge_file_events e
       WHERE e.organization_id = ?
         AND e.event_type = ?
       ORDER BY e.created_at ASC, e.id ASC`,
    )
    .bind(organizationId, PACKET_DECISION_EVENT_TYPE)
    .all();
  return (rows.results || [])
    .map((row) => {
      const details = parse(row.details);
      if (!clean(details.packetId)) return null;
      return { ...details, decidedAt: row.created_at };
    })
    .filter(Boolean);
};

/** Products grouped the way the engineer reads them: decisions, not facts. */
export const summarizeDecisionPackets = (packets) => {
  const byProduct = new Map();
  for (const packet of packets) {
    const key = clean(packet.partNumber).toUpperCase();
    if (!byProduct.has(key)) {
      byProduct.set(key, {
        partNumber: packet.partNumber,
        canonicalProductId: packet.canonicalProductId,
        family: packet.family,
        manufacturerName: packet.manufacturerName,
        pendingDecisions: 0,
        confirmedDecisions: 0,
        rejectedDecisions: 0,
        needsInvestigation: 0,
        conflicts: 0,
        evidenceGaps: 0,
        totalDecisions: 0,
        openConflictIds: [],
      });
    }
    const row = byProduct.get(key);
    row.totalDecisions += 1;
    if (packet.reviewState === "pending" || packet.reviewState === "partially_decided") {
      row.pendingDecisions += 1;
    }
    if (packet.reviewState === "confirmed") row.confirmedDecisions += 1;
    if (packet.reviewState === "rejected") row.rejectedDecisions += 1;
    if (packet.reviewState === "needs_investigation") row.needsInvestigation += 1;
    if (packet.reviewState === "conflict") row.conflicts += 1;
    if (packet.reviewState === "evidence_gap") row.evidenceGaps += 1;
    for (const conflict of packet.openProductConflicts || []) {
      if (!row.openConflictIds.includes(conflict.conflictId)) row.openConflictIds.push(conflict.conflictId);
    }
  }
  const rows = Array.from(byProduct.values());
  // Priority is engineering consequence, not fact count: a blocked SLC address
  // model outranks a confirmed environmental note.
  const weight = (row) =>
    row.conflicts * 100 + row.needsInvestigation * 60 + row.evidenceGaps * 40 + row.pendingDecisions;
  rows.sort((a, b) => weight(b) - weight(a) || a.partNumber.localeCompare(b.partNumber));
  return rows.map((row, index) => ({ ...row, priority: index === 0 ? "P0" : row.conflicts ? "P0" : row.pendingDecisions ? "P1" : "P2" }));
};

export { comparisonPartNumber };
