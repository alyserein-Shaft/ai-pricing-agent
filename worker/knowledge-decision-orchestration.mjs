// KN-DECISION-1 -- the packet decision transaction.
//
// THE STRUCTURAL PROBLEM THIS SOLVES. Promotion resolves a fact's canonical
// product THROUGH the document, not through the caller: it looks for exactly one
// `Part Number` fact in the SAME knowledge file carrying the SAME
// `observationKey` whose value is the fact's `partNumber`, and then for exactly
// one `knowledge_product_links` row on that anchor. That is a sound contract --
// "this value belongs to the product this document says is X" -- but it means a
// human who researched a value has to walk to the UI four separate times:
//
//   1. review the fact            (POST /api/knowledge/review/fact/:id)
//   2. find/create the anchor    (no route: none of the 70 Batch-1 research
//                                  facts had a Part Number anchor at all)
//   3. link the anchor           (POST /api/knowledge/link/fact/:id, which
//                                  only accepts fact_type === "Part Number")
//   4. promote                    (POST /api/knowledge/promote/fact/:id)
//
// Four round trips, each capable of half-succeeding, and step 2 has no route at
// all. So this module performs the sequence in one transaction -- while calling
// the EXISTING governed operations rather than restating their rules.
//
// WHAT IT ORCHESTRATES, AND WHAT IT DELIBERATELY DOES NOT:
//
//   * canonical target verification -- `comparisonPartNumber`, one visible live
//     product, never an arbitrary pick from several;
//   * fact review decisions -- `confirmKnowledgeFactReview`, the same function
//     the review route calls;
//   * product linking -- `linkKnowledgeFactToProduct`, the same function the
//     manual link route calls;
//   * promotion -- `promoteKnowledgeFact`, unmodified.
//
// The identity anchor is the one row this module creates, and it exists only
// because promotion's contract requires one. It is created by the human's own
// packet confirmation, so it is born `Reviewed` and explicitly marked as a
// decision anchor rather than an extracted value -- a row that claimed to have
// been read out of the PDF would be a fabrication. It is never created for a
// product without the human's confirmation, and it never carries a value the
// human did not confirm.
//
// ORDERING. Link first, then review, then promote. Linking requires the anchor
// to be Reviewed, so the anchor is inserted as part of the link step; the
// research facts are reviewed before promotion because promotion refuses a fact
// that is not `Reviewed`. Every step reports its own outcome, and a failure in
// one fact does not abort the packet: the caller gets a per-fact ledger showing
// what landed, what did not, and why. A packet that half-succeeds silently is
// how canonical truth acquires a fact nobody actually approved.

import {
  confirmKnowledgeFactReview,
  linkKnowledgeFactToProduct,
} from "./knowledge-product-link-review.mjs";
import { promoteKnowledgeFact } from "./knowledge-promotion.mjs";
import { comparisonPartNumber } from "../app/domain/knowledge-product-identity-resolver.mjs";
import { canonicalScopeVisible } from "./knowledge-product-resolver-runtime.mjs";
import { isHumanDecisionActor, humanDecisionActorRefusal } from "../app/domain/human-authority.mjs";
import {
  DECISION_CATEGORIES,
  DOWNSTREAM_CONSUMERS,
  loadKnowledgeDecisionPackets,
  promotionDisposition,
} from "../app/domain/knowledge-decision-packet.mjs";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();

// Event details are audit records, so a corrupt or absent payload must degrade
// to "unknown" rather than throw inside the idempotency check: refusing to
// answer a replay because the audit row is unreadable would be worse than
// reporting a missing outcome.
const parseJsonObject = (value) => {
  if (value && typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};

export const PACKET_DECISION_OUTCOMES = Object.freeze({
  CONFIRMED: "CONFIRMED",
  // Some observations confirmed and some rejected in a single decision. Kept
  // distinct from CONFIRMED because the packet still carries unresolved
  // evidence, and a queue that showed it as settled would hide that.
  PARTIALLY_DECIDED: "PARTIALLY_DECIDED",
  REJECTED: "REJECTED",
  NEEDS_INVESTIGATION: "NEEDS_INVESTIGATION",
  BLOCKED: "BLOCKED",
});

export const PACKET_DECISION_ERRORS = Object.freeze({
  PACKET_NOT_FOUND: "PACKET_NOT_FOUND",
  HUMAN_ACTOR_REQUIRED: "HUMAN_ACTOR_REQUIRED",
  REASON_REQUIRED: "REASON_REQUIRED",
  DECISION_INVALID: "DECISION_INVALID",
  PACKET_NOT_CONFIRMABLE: "PACKET_NOT_CONFIRMABLE",
  CONFLICT_REQUIRES_INTERPRETATION: "CONFLICT_REQUIRES_INTERPRETATION",
  EVIDENCE_GAP_NOT_APPROVABLE: "EVIDENCE_GAP_NOT_APPROVABLE",
  AMBIGUOUS_CANONICAL_TARGET: "AMBIGUOUS_CANONICAL_TARGET",
  NO_CANONICAL_PRODUCT: "NO_CANONICAL_PRODUCT",
  FACT_NOT_IN_PACKET: "FACT_NOT_IN_PACKET",
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENT_REPLAY: "IDEMPOTENT_REPLAY",
});

const error = (code, message, extra = {}) => ({ ok: false, code, message, ...extra });

/**
 * Resolve the exact canonical product for a part number using the resolver's
 * comparison form. Returns the failure rather than guessing when zero or several
 * products match: binding a research fact to an arbitrary product is precisely
 * the provenance failure this system exists to prevent.
 */
export const resolveExactCanonicalTarget = async (db, { organizationId, partNumber }) => {
  const comparison = comparisonPartNumber(partNumber);
  if (!comparison) {
    return error(PACKET_DECISION_ERRORS.NO_CANONICAL_PRODUCT, "The packet carries no part number.");
  }
  const rows = await db
    .prepare(
      // The joins are load-bearing. `library_products` stores the manufacturer
      // and the family as foreign keys, so selecting `manufacturer_name`
      // straight off the table is a hard SQL error -- and dropping the columns
      // instead would quietly make the confirmation message unable to say which
      // product, of which make, it wrote to. Every confirmation names the
      // product it changed, so the display columns have to survive the lookup.
      `SELECT p.id, p.part_number, m.name AS manufacturer_name, fam.name AS product_family,
              p.lifecycle_status, p.identity_status, p.superseded_by_product_id,
              p.library_scope, p.organization_id
       FROM library_products p
       LEFT JOIN product_manufacturers m ON m.id = p.manufacturer_id
       LEFT JOIN product_families fam ON fam.id = p.family_id
       WHERE p.superseded_by_product_id IS NULL AND p.identity_status <> 'Superseded'
         AND UPPER(p.normalized_part_number) = ?`,
    )
    .bind(comparison.toUpperCase())
    .all();
  const visible = (rows.results || []).filter((row) => canonicalScopeVisible(row, organizationId, []));
  if (visible.length === 0) {
    return error(
      PACKET_DECISION_ERRORS.NO_CANONICAL_PRODUCT,
      `No visible canonical product carries part number ${clean(partNumber)}.`,
    );
  }
  if (visible.length > 1) {
    return error(
      PACKET_DECISION_ERRORS.AMBIGUOUS_CANONICAL_TARGET,
      `${visible.length} visible canonical products carry part number ${clean(partNumber)}.`,
      { candidates: visible.map((row) => ({ id: row.id, partNumber: row.part_number })) },
    );
  }
  return { ok: true, product: visible[0] };
};

/**
 * The governed identity anchor: one `Part Number` fact per
 * (file, observationKey, partNumber), created only by an explicit human packet
 * confirmation. Marked `attributes.identityAnchor` so no later reader can
 * mistake it for a value read out of the document.
 */
const ensureIdentityAnchor = async (db, { organizationId, observation, targetProductId, humanActor, reason, newId }) => {
  const fileId = observation.evidence?.knowledgeFileId;
  const observationKey = clean(observation.observationKey);
  const partNumber = clean(observation.partNumber);
  if (!fileId || !observationKey || !partNumber) {
    return { status: "ANCHOR_PREREQUISITES_MISSING" };
  }
  const partNumberFactKey = `decision-anchor:${observationKey}:part-number`;
  const factId = newId("knowledgeFact");
  const anchorAttributes = {
    observationKey,
    partNumber,
    identityAnchor: "human-confirmed-decision-anchor",
    authoringChannel: "knowledge-decision-packet",
    confirmedBy: clean(humanActor?.id),
    confirmedAt: new Date().toISOString(),
    canonicalProductId: targetProductId,
  };
  const sourceLocation = {
    ...(observation.evidence || {}),
    knowledgeFileId: fileId,
    // Recorded truthfully: the anchor states the identity the human confirmed,
    // citing the observation and its quote. It does not claim to be a token
    // extracted from the page.
    anchorBasis: "human-confirmed decision anchor",
    anchorReason: clean(reason),
  };
  // UNIQUE(knowledge_file_id, fact_type, fact_key, normalized_value) makes this
  // idempotent: a replay collides and INSERT OR IGNORE writes nothing, so the
  // anchor cannot be duplicated by a double submit.
  await db
    .prepare(
      `INSERT OR IGNORE INTO knowledge_facts
         (id, organization_id, knowledge_file_id, fact_type, fact_key, original_value,
          normalized_value, attributes, confidence, review_status, source_location, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      factId,
      organizationId,
      fileId,
      "Part Number",
      partNumberFactKey,
      partNumber,
      partNumber,
      JSON.stringify(anchorAttributes),
      100,
      "Reviewed",
      JSON.stringify(sourceLocation),
      new Date().toISOString(),
    )
    .run();

  const stored = await db
    .prepare(
      "SELECT id FROM knowledge_facts WHERE organization_id=? AND knowledge_file_id=? AND fact_type='Part Number' AND fact_key=? LIMIT 1",
    )
    .bind(organizationId, fileId, partNumberFactKey)
    .first();
  return {
    status: "ANCHORED",
    anchorFactId: stored?.id || factId,
    created: stored?.id !== factId,
  };
};

/** Human-readable, specific consequence text for the confirmed decision. */
const canonicalChangeSummary = (promotion) => {
  if (promotion.status !== "PROMOTED" && promotion.status !== "EVIDENCE_ONLY") {
    return `Promotion blocked: ${promotion.status}`;
  }
  // The entity types are the ones `promoteKnowledgeFact` actually returns
  // ("Product Attribute", "Product Lifecycle Event", "Engineering
  // Relationship"). Matching anything else here produced a useless "Canonical
  // <entity> recorded" with no attribute name and no value -- which is the
  // generic-success failure this summary exists to prevent, reached by
  // mistyping a constant rather than by being lazy.
  const attribute =
    promotion.attributeName && promotion.attributeName !== "lifecycle_status"
      ? promotion.attributeName
      : null;
  if (promotion.canonicalEntityType === "Product Attribute") {
    if (promotion.status === "EVIDENCE_ONLY") {
      return attribute
        ? `Evidence attached to existing product attribute ${attribute} = ${promotion.normalizedValue}`
        : "Evidence attached to an existing product attribute of equal value (no duplicate written)";
    }
    return attribute
      ? `Approved product attribute created: ${attribute} = ${promotion.normalizedValue}`
      : `Approved product attribute created: ${promotion.normalizedValue}`;
  }
  if (promotion.canonicalEntityType === "Engineering Relationship") {
    const target = clean(promotion.targetProductId);
    const relationshipType = clean(promotion.relationshipType);
    if (promotion.status === "EVIDENCE_ONLY") {
      return `Evidence attached to existing relationship${relationshipType ? ` ${relationshipType}` : ""}${target ? ` to ${target}` : ""}`;
    }
    return `Engineering relationship confirmed${relationshipType ? `: ${relationshipType}` : ""}${target ? ` to ${target}` : ""}`;
  }
  if (promotion.canonicalEntityType === "Product Lifecycle Event") {
    return `Lifecycle event recorded: ${promotion.normalizedValue}`;
  }
  return promotion.status === "EVIDENCE_ONLY"
    ? "Evidence attached to an existing canonical value already equal to this observation (no duplicate written)"
    : `Canonical ${promotion.canonicalEntityType || "value"} recorded`;
};

/**
 * One line the engineer reads instead of "Success".
 *
 * The rule this encodes: a count of concrete artefacts, or the specific reason
 * nothing was written. Never a bare "promoted", because "promoted" and
 * "reviewed as evidence" and "held by an open conflict" are three different
 * outcomes with three different consequences for panel sizing.
 */
const promotionHeadline = (outcomes, promotionStatus) => {
  const promoted = outcomes.filter(
    (entry) => entry.promotion?.status === "PROMOTED" || entry.promotion?.status === "EVIDENCE_ONLY",
  );
  if (promotionStatus) {
    return `Evidence confirmed. No canonical attribute written: ${promotionStatus
      .toLowerCase()
      .replace(/_/g, " ")}.`;
  }
  if (!promoted.length) {
    const terminal = outcomes.find((entry) => entry.promotion?.status === "NOT_PROMOTABLE_BY_POLICY");
    if (terminal) {
      return `Confirmed as governed evidence. No canonical attribute is derived from this fact type by policy.`;
    }
    const blocked = outcomes.filter(
      (entry) => entry.promotion?.status && entry.promotion.status !== "NOT_PROMOTABLE_BY_POLICY",
    );
    if (blocked.length) {
      return `Review recorded; promotion blocked: ${[...new Set(blocked.map((entry) => entry.promotion.status))].join(", ")}.`;
    }
    return "Review recorded. Nothing was promoted.";
  }
  const attributes = promoted.filter((entry) => entry.promotion.canonicalEntityType === "Product Attribute");
  const relationships = promoted.filter(
    (entry) => entry.promotion.canonicalEntityType === "Engineering Relationship",
  );
  const lifecycle = promoted.filter(
    (entry) => entry.promotion.canonicalEntityType === "Product Lifecycle Event",
  );
  const written = promoted.filter((entry) => entry.promotion.status === "PROMOTED");
  const evidenceOnly = promoted.filter((entry) => entry.promotion.status === "EVIDENCE_ONLY");
  const parts = [];
  const count = (n) => `${n} ${n === 1 ? "attribute" : "attributes"}`;
  if (written.some((entry) => entry.promotion.canonicalEntityType === "Product Attribute")) {
    parts.push(`${count(attributes.filter((entry) => entry.promotion.status === "PROMOTED").length)} approved and created`);
  }
  if (relationships.length) {
    parts.push(`${relationships.length} engineering relationship${relationships.length === 1 ? "" : "s"} confirmed`);
  }
  if (lifecycle.length) {
    parts.push(`${lifecycle.length} lifecycle event${lifecycle.length === 1 ? "" : "s"} recorded`);
  }
  if (!parts.length && evidenceOnly.length) {
    parts.push("evidence attached to existing canonical values already equal to the observation");
  }
  if (!parts.length) {
    parts.push(`${promoted.length} canonical change${promoted.length === 1 ? "" : "s"} recorded`);
  }
  return `${parts.join("; ")}.`;
};

const downstreamSummary = (category, outcomes) => {
  const promoted = outcomes.filter((entry) => entry.promotion?.status === "PROMOTED");
  if (!promoted.length) return [];
  const consumers = DOWNSTREAM_CONSUMERS[category] || [];
  return consumers.map((consumer) => ({
    capability: consumer,
    // Never claim a consumer benefits when nothing was actually promoted. The
    // whole point of this list is engineering trust, and a trust list that
    // overstates is worse than no list.
    active: true,
    factIds: promoted.map((entry) => entry.factId),
  }));
};

/**
 * Perform one packet decision.
 *
 * `decision` is one of confirm / reject / needs_investigation. `factDecisions`
 * allows a per-fact override so a human can confirm the values a datasheet gets
 * right and reject the one it gets wrong -- the alternative, approving a whole
 * document because a single value is correct, is how a wrong value reaches
 * canonical truth with a human's name on it.
 */
export const confirmKnowledgeDecisionPacket = async (
  db,
  {
    organizationId,
    packetId,
    decision,
    factDecisions = {},
    reason,
    humanActor,
    actorPermission = null,
    declaredGaps = [],
    idempotencyKey,
    newId,
    stamp = () => new Date().toISOString(),
  } = {},
) => {
  const org = clean(organizationId);
  const id = clean(packetId);
  const normalizedDecision = clean(decision).toLowerCase();
  const cleanReason = clean(reason);
  const actorId = clean(humanActor?.id);

  if (!id) return error(PACKET_DECISION_ERRORS.PACKET_NOT_FOUND, "No packet was named.");
  // The actor is re-verified here rather than trusted from the caller, because
  // this function is also called directly. A non-blank id is not enough: the
  // Batch-1 research findings are attributed to `local-development-user`, which
  // is a legitimate DISCOVERY actor, and that same id must never be able to
  // APPROVE them. `humanActor.synthetic === false` is an attestation a caller can
  // make for any id it likes, so only the config-derived source is checked.
  if (!isHumanDecisionActor(humanActor)) {
    return error(
      PACKET_DECISION_ERRORS.HUMAN_ACTOR_REQUIRED,
      `A packet decision must be attributed to a configured human identity: ${humanDecisionActorRefusal(humanActor)}.`,
      { actorId: actorId || null },
    );
  }
  if (cleanReason.length < 20) {
    return error(PACKET_DECISION_ERRORS.REASON_REQUIRED, "Provide a substantive governed reason.");
  }
  if (!["confirm", "reject", "needs_investigation"].includes(normalizedDecision)) {
    return error(
      PACKET_DECISION_ERRORS.DECISION_INVALID,
      "Choose Confirm, Reject or Needs Investigation.",
    );
  }

  const { packets } = await loadKnowledgeDecisionPackets(db, {
    organizationId: org,
    declaredGaps,
  });
  const packet = packets.find((entry) => entry.packetId === id);
  if (!packet) {
    return error(
      PACKET_DECISION_ERRORS.PACKET_NOT_FOUND,
      "This decision packet is no longer available; reload the queue.",
    );
  }

  const key = clean(idempotencyKey);
  if (normalizedDecision !== "needs_investigation" && !key) {
    return error(
      PACKET_DECISION_ERRORS.IDEMPOTENCY_KEY_REQUIRED,
      "A decision that can write canonical truth must carry an idempotency key.",
    );
  }
  if (key) {
    const prior = await db
      .prepare(
        "SELECT id, details FROM knowledge_file_events WHERE organization_id=? AND event_type='Knowledge Decision Packet' AND json_extract(details,'$.idempotencyKey')=? LIMIT 1",
      )
      .bind(org, key)
      .first();
    if (prior) {
      // A replay must report the outcome that was actually RECORDED, not
      // "CONFIRMED". Hardcoding CONFIRMED here would tell an engineer that a
      // packet held as Needs Investigation was confirmed the moment they
      // re-sent the same decision, which is the one thing a replay must not do.
      // Older events predate `packetOutcome`, so fall back to the stored
      // `decision` rather than guessing from the fact ids.
      const priorDetails = parseJsonObject(prior.details);
      const recordedOutcome =
        clean(priorDetails.packetOutcome) ||
        (clean(priorDetails.decision) === "needs_investigation"
          ? PACKET_DECISION_OUTCOMES.NEEDS_INVESTIGATION
          : PACKET_DECISION_OUTCOMES.CONFIRMED);
      return {
        ok: true,
        idempotent: true,
        status: recordedOutcome,
        packetId: id,
        partNumber: clean(priorDetails.partNumber) || null,
        category: clean(priorDetails.category) || null,
        outcome: "IDEMPOTENT_REPLAY",
        message: `This exact decision was already recorded as ${recordedOutcome}; nothing was written again.`,
        factOutcomes: [],
        canonicalChanges: [],
        downstream: [],
        links: [],
        priorEventId: prior.id,
      };
    }
  }

  const recordEvent = async (fileId, details) => {
    const eventId = newId("knowledgeEvent");
    await db
      .prepare(
        "INSERT INTO knowledge_file_events (id,organization_id,knowledge_file_id,event_type,details,actor_user_id) VALUES (?,?,?,?,?,?)",
      )
      .bind(
        eventId,
        org,
        fileId,
        "Knowledge Decision Packet",
        JSON.stringify({ ...details, decidedAt: stamp() }),
        actorId,
      )
      .run();
    return eventId;
  };

  const anyObservation = packet.observations[0];
  const eventFileId =
    anyObservation?.evidence?.knowledgeFileId
    || (await db.prepare("SELECT id FROM knowledge_files WHERE organization_id=? LIMIT 1").bind(org).first())?.id;

  // A packet holding no observation has nothing to approve. This is the guard
  // that keeps an evidence gap from becoming an approval: an "Evidence Missing"
  // packet can be held for investigation, but Confirm and Reject are refused,
  // because both would record a decision about a value nobody recorded.
  if (packet.reviewState === "evidence_gap") {
    if (normalizedDecision !== "needs_investigation") {
      return error(
        PACKET_DECISION_ERRORS.EVIDENCE_GAP_NOT_APPROVABLE,
        `${packet.partNumber} ${packet.category}: no manufacturer observation exists, so there is nothing to confirm or reject. Record it as Needs Investigation.`,
        { evidenceGap: packet.evidenceGap },
      );
    }
  }

  // A contradicted packet must not offer a blind Confirm. The human has to name
  // which observation they are standing behind, or reject one side, or hold.
  if (normalizedDecision === "confirm" && packet.reviewState === "conflict") {
    const hasExplicitSelection = Object.values(factDecisions).some(
      (value) => clean(value).toLowerCase() === "confirm",
    );
    if (!hasExplicitSelection) {
      return error(
        PACKET_DECISION_ERRORS.CONFLICT_REQUIRES_INTERPRETATION,
        `${packet.partNumber} ${packet.category}: the observations disagree. Confirm the individual facts you are standing behind, reject the others, or record Needs Investigation.`,
        { conflictingValues: packet.conflictingValues },
      );
    }
  }

  // A catalogue defect blocks the review itself: there is no single defensible
  // destination, and inventing one is the whole failure mode.
  //
  // An OPEN IDENTITY CONFLICT does NOT appear here. The observation is real
  // whichever way the identity question resolves, so the human may still confirm
  // the evidence; only PROMOTION is held, further down, and it reports why. That
  // distinction matters: refusing the review would push the reviewer to mark it
  // Needs Investigation, which is the wrong answer -- the evidence is not in
  // doubt, the destination is.
  if (
    normalizedDecision === "confirm" &&
    packet.isConfirmable === false &&
    ["AMBIGUOUS_CATALOGUE_TARGET", "NO_CANONICAL_PRODUCT"].includes(packet.blockReason)
  ) {
    return error(
      packet.blockReason === "AMBIGUOUS_CATALOGUE_TARGET"
        ? PACKET_DECISION_ERRORS.AMBIGUOUS_CANONICAL_TARGET
        : PACKET_DECISION_ERRORS.NO_CANONICAL_PRODUCT,
      `${packet.partNumber} ${packet.category}: ${packet.blockReason}. This is a catalogue question, not a review decision.`,
      { blockReason: packet.blockReason },
    );
  }

  const baseSummary = {
    packetId: id,
    partNumber: packet.partNumber,
    category: packet.category,
    packetVersion: packet.packetVersion,
    decision: normalizedDecision,
    reason: cleanReason,
    decidedBy: actorId,
    decidedByName: clean(humanActor?.name),
    humanActorSource: clean(humanActor?.source),
    actorPermission,
    ...(key ? { idempotencyKey: key } : {}),
  };

  if (normalizedDecision === "needs_investigation") {
    const eventId = await recordEvent(eventFileId, {
      ...baseSummary,
      packetOutcome: PACKET_DECISION_OUTCOMES.NEEDS_INVESTIGATION,
      factIds: packet.observations.map((entry) => entry.factId),
      outcomeSummary: `Held for investigation: ${packet.evidenceGap?.reason || "conflicting or insufficient evidence"}. No fact state changed and nothing was promoted.`,
    });
    return {
      ok: true,
      status: PACKET_DECISION_OUTCOMES.NEEDS_INVESTIGATION,
      packetId: id,
      partNumber: packet.partNumber,
      category: packet.category,
      eventId,
      factOutcomes: [],
      canonicalChanges: [],
      downstream: [],
      links: [],
      message:
        "Recorded as Needs Investigation. No fact state changed, nothing was promoted, and no conflict was resolved.",
    };
  }

  // PER-FACT DECISIONS. Every observation in the packet gets a decision, and
  // that decision is what is executed -- not a single packet-wide flag with
  // some facts quietly left behind. An explicit override always wins over the
  // packet default, so a reviewer standing behind one datasheet line and
  // against another produces two governed review records, not one.
  //
  // The earlier shape of this -- select the facts that match the packet
  // decision, call the rest "not part of the decision" -- looked equivalent but
  // was not: an explicit per-fact Reject was recorded as a non-decision, so
  // the human's stated intent to discard bad evidence vanished from the audit
  // trail and the fact stayed in the queue as if still awaiting review.
  const overrides = new Map(
    Object.entries(factDecisions || {})
      .map(([factId, value]) => [clean(factId), clean(value).toLowerCase()])
      .filter(([factId, value]) => factId && value),
  );
  const packetFactIds = new Set(packet.observations.map((observation) => observation.factId));
  const unknownFactIds = [...overrides.keys()].filter((factId) => !packetFactIds.has(factId));
  if (unknownFactIds.length) {
    return error(
      PACKET_DECISION_ERRORS.FACT_NOT_IN_PACKET,
      `This packet does not contain: ${unknownFactIds.join(", ")}.`,
      { unknownFactIds, packetFactIds: [...packetFactIds] },
    );
  }
  const invalidOverrides = [...overrides.entries()].filter(
    ([, value]) => !["confirm", "reject"].includes(value),
  );
  if (invalidOverrides.length) {
    // Needs Investigation is a packet-level hold. Accepting it per fact would
    // mean some facts in a "held" packet were nonetheless written, which is the
    // opposite of a hold.
    return error(
      PACKET_DECISION_ERRORS.DECISION_INVALID,
      "A per-fact decision must be Confirm or Reject. Needs Investigation is recorded on the whole packet.",
      { invalidFactDecisions: invalidOverrides.map(([factId, value]) => ({ factId, value })) },
    );
  }
  const decisionFor = (observation) =>
    overrides.get(observation.factId) || normalizedDecision;
  const selected = packet.observations.filter(
    (observation) => decisionFor(observation) === "confirm",
  );
  const rejected = packet.observations.filter(
    (observation) => decisionFor(observation) === "reject",
  );
  const excluded = packet.observations.filter(
    (observation) => !selected.includes(observation) && !rejected.includes(observation),
  );

  if (!selected.length && !rejected.length) {
    return error(
      PACKET_DECISION_ERRORS.FACT_NOT_IN_PACKET,
      "The decision named no observation from this packet.",
    );
  }

  const target = await resolveExactCanonicalTarget(db, {
    organizationId: org,
    partNumber: packet.partNumber,
  });
  if (!target.ok) return target;

  const factOutcomes = [];
  const links = [];
  const canonicalChanges = [];

  const reviewed = [];
  // Confirmed and rejected facts are both written through the same guarded
  // primitive and the same audit event, so a Reject is as traceable as a
  // Confirm. Only the confirmed ones can go on to be linked and promoted.
  for (const [observation, action] of [
    ...selected.map((observation) => [observation, "confirm"]),
    ...rejected.map((observation) => [observation, "reject"]),
  ]) {
    const result = await confirmKnowledgeFactReview(db, {
      organizationId: org,
      itemId: observation.factId,
      kind: "fact",
      action,
      reason: cleanReason,
      humanActor,
      actorPermission,
      eventId: newId("knowledgeEvent"),
      stamp,
    });
    factOutcomes.push({
      factId: observation.factId,
      factType: observation.factType,
      value: observation.value,
      documentNumber: observation.evidence?.documentNumber || null,
      revision: observation.evidence?.revision || null,
      review: result.ok
        ? { status: result.status, previousStatus: result.previousStatus }
        : { status: "REFUSED", code: result.code },
      promotion: null,
    });
    if (result.ok && action === "confirm") reviewed.push(observation);
  }

  // Only a confirmed decision may link. A rejected observation asserts nothing
  // about identity, so rejecting a fact must not create the link that would let
  // something else be promoted through it.
  let anchor = null;
  if (reviewed.length) {
    for (const observation of reviewed) {
      anchor = await ensureIdentityAnchor(db, {
        organizationId: org,
        observation,
        targetProductId: target.product.id,
        humanActor,
        reason: cleanReason,
        newId,
      });
      if (anchor.status !== "ANCHORED") break;
      const linkResult = await linkKnowledgeFactToProduct(db, {
        organizationId: org,
        factId: anchor.anchorFactId,
        productId: target.product.id,
        reason: cleanReason,
        humanActor,
        actorPermission,
        linkId: newId("knowledgeLink"),
        eventId: newId("knowledgeEvent"),
        stamp,
      });
      links.push({
        anchorFactId: anchor.anchorFactId,
        observationKey: observation.observationKey,
        status: linkResult.ok ? linkResult.status : "REFUSED",
        code: linkResult.ok ? null : linkResult.code,
        idempotent: linkResult.ok ? Boolean(linkResult.idempotent) : false,
        productId: target.product.id,
      });
      if (!linkResult.ok) break;
    }
  }

  if (links.some((entry) => entry.status === "REFUSED")) {
    await recordEvent(eventFileId, {
      ...baseSummary,
      factIds: selected.map((entry) => entry.factId),
      links,
      outcomeSummary:
        "Review decisions recorded but the governed product link was refused, so promotion was not attempted. No canonical truth was written.",
    });
    return {
      ok: false,
      status: PACKET_DECISION_OUTCOMES.BLOCKED,
      packetId: id,
      partNumber: packet.partNumber,
      category: packet.category,
      code: links.find((entry) => entry.status === "REFUSED")?.code || "LINK_REFUSED",
      message:
        "The facts were reviewed but the governed product link was refused, so promotion was not attempted.",
      factOutcomes,
      links,
      canonicalChanges: [],
      downstream: [],
    };
  }

  if (reviewed.length && packet.identityConflictOpen) {
    // The evidence was just confirmed and attributed; PROMOTION is held. The
    // destination product's identity is still contested, so writing canonical
    // truth now would bind a verified value to a product nobody has agreed is
    // the right one. This is a distinct outcome rather than a failure, because
    // the review itself succeeded -- and the distinction is the point: a reviewer
    // told only "blocked" would wrongly conclude the evidence is in doubt.
    const holdMessage =
      `Evidence confirmed. No canonical attribute was written: ${packet.partNumber} has an open identity conflict, so promotion stays held until a Library Manager resolves it.`;
    for (const observation of reviewed) {
      const outcome = factOutcomes.find((entry) => entry.factId === observation.factId);
      if (!outcome) continue;
      outcome.promotion = {
        status: "BLOCKED_OPEN_IDENTITY_CONFLICT",
        summary: observation.policyPromotion?.promotable
          ? holdMessage
          : `Confirmed as governed evidence. Fact type "${observation.factType}" is policy-terminal, so no canonical attribute is derived from it.`,
      };
    }
    const heldEventId = await recordEvent(eventFileId, {
      ...baseSummary,
      factIds: selected.map((entry) => entry.factId),
      excludedFactIds: excluded.map((entry) => entry.factId),
      links,
      canonicalChanges: [],
      openProductConflicts: packet.openProductConflicts.map((entry) => entry.conflictId),
      outcomeSummary: holdMessage,
    });
    return {
      ok: true,
      status: PACKET_DECISION_OUTCOMES.CONFIRMED,
      promotionStatus: "BLOCKED_OPEN_IDENTITY_CONFLICT",
      packetId: id,
      partNumber: packet.partNumber,
      category: packet.category,
      canonicalProductId: target.product.id,
      eventId: heldEventId,
      factOutcomes: [
        ...factOutcomes,
        ...excluded.map((observation) => ({
          factId: observation.factId,
          factType: observation.factType,
          value: observation.value,
          review: { status: "NOT_PART_OF_DECISION", previousStatus: observation.reviewStatus },
          promotion: null,
        })),
      ],
      links,
      canonicalChanges: [],
      blocked: [
        {
          code: "OPEN_IDENTITY_CONFLICT",
          conflictIds: packet.openProductConflicts.map((entry) => entry.conflictId),
        },
      ],
      downstream: [],
      promotionHeadline: promotionHeadline(factOutcomes, "BLOCKED_OPEN_IDENTITY_CONFLICT"),
      message: holdMessage,
    };
  }

  {
    for (const observation of reviewed) {
      const outcome = factOutcomes.find((entry) => entry.factId === observation.factId);
      if (!outcome) continue;
      if (!observation.policyPromotion?.promotable) {
        // Say it plainly instead of reporting a generic success. A safety- or
        // documentation-terminal fact type being confirmed is a real outcome
        // with a real consequence: the evidence is now governed and attributed,
        // and no canonical attribute will ever be derived from it.
        outcome.promotion = {
          status: "NOT_PROMOTABLE_BY_POLICY",
          summary: `Confirmed as governed evidence. Fact type "${observation.factType}" is policy-terminal, so no canonical attribute is derived from it.`,
        };
        canonicalChanges.push(outcome.promotion.summary);
        continue;
      }
      const promotion = await promoteKnowledgeFact(db, {
        factId: observation.factId,
        organizationId: org,
        actor: { id: actorId, name: clean(humanActor?.name), role: actorPermission },
        reason: cleanReason,
        idempotencyKey: `${key}:${observation.factId}`,
        authorization: "human",
      });
      outcome.promotion = {
        status: promotion.status,
        summary: canonicalChangeSummary(promotion),
        canonicalProductId: promotion.canonicalProductId || null,
        canonicalEntityType: promotion.canonicalEntityType || null,
        attributeName: promotion.attributeName || null,
        normalizedValue: promotion.normalizedValue || null,
      };
      canonicalChanges.push(outcome.promotion.summary);
    }
  }

  const excludedOutcomes = excluded.map((observation) => {
    const existing = factOutcomes.find((entry) => entry.factId === observation.factId);
    if (existing) return existing;
    return {
      factId: observation.factId,
      factType: observation.factType,
      value: observation.value,
      review: { status: "NOT_PART_OF_DECISION", previousStatus: observation.reviewStatus },
      promotion: null,
    };
  });

  const blocked = factOutcomes.filter((entry) => entry.review?.status === "REFUSED" || (entry.promotion?.status && !["PROMOTED", "EVIDENCE_ONLY", "NOT_PROMOTABLE_BY_POLICY"].includes(entry.promotion.status)));

  // A decision that confirms some facts and rejects others is neither
  // "confirmed" nor "rejected" at packet level. Reporting it as one of the two
  // would tell the engineer their discard was accepted while the packet still
  // reads as settled, which is the opposite of what a partial decision means.
  const confirmedCount = reviewed.length;
  const rejectedCount = rejected.filter((observation) => {
    const outcome = factOutcomes.find((entry) => entry.factId === observation.factId);
    return outcome?.review?.status === "Rejected";
  }).length;
  const packetOutcome =
    confirmedCount && rejectedCount
      ? PACKET_DECISION_OUTCOMES.PARTIALLY_DECIDED
      : confirmedCount
        ? PACKET_DECISION_OUTCOMES.CONFIRMED
        : PACKET_DECISION_OUTCOMES.REJECTED;

  const summary = confirmedCount
    ? `${confirmedCount} observation(s) confirmed, ${rejectedCount} rejected; ${canonicalChanges.length} canonical change(s).`
    : `${rejectedCount} observation(s) rejected; no canonical truth written.`;

  const eventId = await recordEvent(eventFileId, {
    ...baseSummary,
    packetOutcome,
    factIds: selected.map((entry) => entry.factId),
    rejectedFactIds: rejected.map((entry) => entry.factId),
    links,
    canonicalChanges,
    outcomeSummary: summary,
  });

  const allOutcomes = [...factOutcomes, ...excludedOutcomes];
  return {
    ok: true,
    status: packetOutcome,
    packetId: id,
    partNumber: packet.partNumber,
    category: packet.category,
    canonicalProductId: target.product.id,
    eventId,
    factOutcomes: allOutcomes,
    links,
    canonicalChanges,
    blocked: blocked.map((entry) => ({ factId: entry.factId, code: entry.review?.code || entry.promotion?.status })),
    downstream: downstreamSummary(packet.category, factOutcomes),
    // The line the UI shows instead of "Success".
    promotionHeadline: promotionHeadline(allOutcomes),
    message: summary,
  };
};

export { DECISION_CATEGORIES, promotionDisposition };
