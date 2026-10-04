// KN-DECISION-1 -- DECLARED decision gaps and declared source-authority
// corrections for Farenhyt Knowledge Wave Batch 1.
//
// WHY THESE ARE DATA AND NOT INFERENCE. The packet read model builds packets from
// observations, which means it cannot report a decision dimension that was never
// observed -- correctly, but silently. "B200S-LF-IV has an Address Model packet"
// and "B200S-LF-IV has NO Address Model evidence" are different engineering
// situations and the queue has to show the second one. Guessing which dimensions
// *ought* to exist would flood the queue (SFPE class 9 spacing is not a gap in
// the SLC address model), so gaps are DECLARED here, each with the research
// finding that produced it and who declared it.
//
// Declaring them is also the honest provenance: a gap is a research conclusion,
// and a conclusion with no written reason behind it is indistinguishable from an
// oversight. Every entry names the document that was searched and what it was
// found to say -- including "silent", which is a real and citable result.
//
// NOTHING HERE IS APPROVABLE. Every entry below becomes a packet with
// `reviewState: "evidence_gap"` and `isConfirmable: false`. Confirm and Reject
// are refused at the API; the only legal action is Needs Investigation. That is
// the point of declaring them: to make the absence of evidence visible and
// routable, without manufacturing a yes/no question nobody can answer.

import { DECISION_CATEGORIES } from "./knowledge-decision-packet.mjs";

const BATCH1 = Object.freeze({
  batch: "Farenhyt Knowledge Wave Batch 1",
  declaredBy: "Batch 1 research pass (first-party manufacturer sources only)",
  declaredOn: "2026-10-01",
});

/**
 * Declared evidence gaps. `partNumber` + `category` is the identity; the rest is
 * the reason the reviewer sees when they open it.
 */
export const DECLARED_DECISION_GAPS = Object.freeze([
  Object.freeze({
    ...BATCH1,
    partNumber: "2151-CH",
    category: DECISION_CATEGORIES.LIFECYCLE,
    reason:
      "No first-party manufacturer document names the 2151-CH variant. Honeywell I56-2806-007R documents the 2151 and 2151T only, and its own scope note states that the 2151-CH regional variant is NOT covered by that manual.",
    note:
      "The 2151 lifecycle evidence that exists is bound to product 2151 and was promoted to 2151, not 2151-CH. 2151-CH currently holds 0 lifecycle events and 0 promotions. Only distributor and price-list listings mention -CH, and a reseller listing is not canonical authority.",
    researchedBy: "Batch 1 research pass",
  }),
  Object.freeze({
    ...BATCH1,
    partNumber: "2151-CH",
    category: DECISION_CATEGORIES.IDENTITY,
    reason:
      "The manufacturer meaning of the -CH regional suffix is not documented in any first-party source located. Whether it denotes a regional certification variant, a housing, or a channel designation is unresolved.",
    note:
      "A decision here would set catalogue identity for a regional variant, which is a Library Manager identity question, not an engineering approval.",
    researchedBy: "Batch 1 research pass",
  }),
  Object.freeze({
    ...BATCH1,
    partNumber: "B200S-LF-IV",
    category: DECISION_CATEGORIES.ADDRESS_MODEL,
    reason:
      "Honeywell document 351630 Rev A p2 lists B200S-LF-IV as an 'Ivory, Low Frequency Intelligent, programmable sounder base', but the document is silent on whether the base consumes its own SLC address or shares the detector's.",
    note:
      "Authoring SHARED_WITH_DETECTOR here would be an inference, not evidence. It is a sizing input, so a guess mis-sizes every panel the base appears in. Needs manufacturer confirmation.",
    researchedBy: "Batch 1 research pass",
  }),
  Object.freeze({
    ...BATCH1,
    partNumber: "B200SR-LF-WH",
    category: DECISION_CATEGORIES.ADDRESS_MODEL,
    reason:
      "Honeywell document 351630 Rev A p2 lists B200SR-LF-WH as a 'White, Low Frequency Intelligent sounder base for retrofit applications' with no 'programmable' qualifier. The document is silent on SLC address consumption.",
    note:
      "B200SR-LF-WH is a distinct catalogue product from B200S-LF-IV (different colour, different retrofit purpose, no programmable qualifier). Facts must not be inherited from B200S-LF-IV by family similarity.",
    researchedBy: "Batch 1 research pass",
  }),
  Object.freeze({
    ...BATCH1,
    partNumber: "IDP-PULL-DA",
    category: DECISION_CATEGORIES.ADDRESS_MODEL,
    reason:
      "Honeywell document 350286 Rev H states the module is for use on a System Sensor SLC but does not use the terms 'address', 'point' or 'device' to describe its SLC footprint.",
    note:
      "This is a low-risk gap rather than a blocking one: the model was not authored as SHARED_WITH_DETECTOR precisely because the manual does not say so. Needs Investigation until a manufacturer statement exists.",
    researchedBy: "Batch 1 research pass",
  }),
]);

/** Every declared gap as the shape `buildDecisionPackets` consumes. */
export const declaredDecisionGaps = () =>
  DECLARED_DECISION_GAPS.map((gap) => ({
    partNumber: gap.partNumber,
    category: gap.category,
    reason: gap.reason,
    note: gap.note,
    researchedBy: gap.researchedBy,
  }));

/**
 * Declared source-authority corrections for Batch 1.
 *
 * These are the two Batch-1 manufacturer documents whose stored
 * `sourceAuthority.authorityClass` is `Unknown Source Authority` because they
 * were ingested while the assessor received `undefined` for the document body.
 * Selection is by declared criteria, never by a hard-coded row id, so the list
 * stays correct if a file is re-ingested.
 *
 * The declaration is NOT authority. The governed correction path
 * (`app/domain/knowledge-source-authority-review.mjs`) re-derives the decision per
 * file: it refuses any elevation that cannot show a first-party signal retained on
 * the stored row. This module only says which files Batch 1 has already proven to
 * be first-party technical documents, and it says why.
 */
export const DECLARED_BATCH1_SOURCE_AUTHORITY_CORRECTIONS = Object.freeze([
  Object.freeze({
    ...BATCH1,
    partNumber: "6500RSE",
    expectedCurrentAuthorityClass: "Unknown Source Authority",
    proposedAuthorityClass: "Manufacturer Technical Document",
    fileNamePattern: "6500RSE_Manual_I56-4446-001_B.pdf",
    documentNumber: "I56-4446-001",
    revision: "B",
    retrievalChannel: "https://www.systemsensoreurope.com/wp-content/uploads/2026/04/I56-4446-001_B-6500RSE.pdf",
    reason:
      "Honeywell installation manual for the 6500RSE, retrieved from System Sensor Europe, which is first-party Honeywell infrastructure: the 6500RSE Declaration of Performance names the entity 'Honeywell Products and Solutions Sarl (Trading as System Sensor Europe)'. Stored as Unknown Source Authority only because the assessor received an undefined document body at ingest; the assessor is now correct and this row is frozen.",
  }),
  Object.freeze({
    ...BATCH1,
    partNumber: "IDP-HEAT-ROR-IV",
    expectedCurrentAuthorityClass: "Unknown Source Authority",
    proposedAuthorityClass: "Manufacturer Technical Document",
    fileNamePattern: "ID-HEAT_351630-A.pdf",
    documentNumber: "351630",
    revision: "A",
    retrievalChannel: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/literature-and-specs/datasheets/farenhyt/hbt-fire-IDP_HEAT_W_Datasheet.pdf",
    reason:
      "Honeywell Farenhyt IDP-HEAT-W datasheet retrieved from prod-edam.honeywell.com. Stored as Unknown Source Authority only because the assessor received an undefined document body at ingest. Note that this row also lost its filename signal: the stored file_name is the local 'ID-HEAT_351630-A.pdf', so filename-only re-evaluation cannot reach the correct grade for this file. Only the recorded retrieval URL establishes authority.",
  }),
]);
