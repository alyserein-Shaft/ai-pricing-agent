import test from "node:test";
import assert from "node:assert/strict";

// KN-SCALE-2/3: the governed internet-research write path, its idempotency
// contract, the targeted-vs-general ingestion distinction, candidate-link
// precision, and truthful human-authority semantics.
//
// Every assertion below is about a boundary: what the authoring agent CANNOT
// write, what replay does and does not duplicate, and which identities may
// claim a human engineering decision.
import {
  assessResearchFactSubmission,
  researchFactId,
  RESEARCH_FACT_TYPES,
  normalizeResearchFactType,
} from "../app/domain/knowledge-research-fact.mjs";
import {
  classifyCandidateDisposition,
  qualifiesAsLinkCandidate,
  normalizeIngestionMode,
  KNOWLEDGE_INGESTION_MODES,
} from "../app/domain/knowledge-candidate-qualification.mjs";
import {
  assessKnowledgeSourceAuthority,
  hasTechnicalSourceAuthority,
  SOURCE_AUTHORITY_CLASSES,
  isFirstPartyManufacturerSource,
} from "../app/domain/knowledge-source-authority.mjs";
import { requireHumanActor, resolveHumanActor } from "../worker/human-actor.mjs";

const ORG = "organization_bd_shaft_internal_pilot";

const file = {
  id: "knowledgeFile_datasheet",
  organization_id: ORG,
  file_name: "Honeywell_Farenhyt_IFP-75_DataSheet.pdf",
  summary: JSON.stringify({ ingestionMode: KNOWLEDGE_INGESTION_MODES.TARGETED }),
};

const goodSubmission = (overrides = {}) => ({
  factType: "Detector Capacity",
  originalValue: "159",
  normalizedValue: "159",
  observationKey: "pilot2:IFP-75HV:351605-C",
  partNumber: "IFP-75HV",
  confidence: 95,
  sourceLocation: {
    page: 3,
    section: "SYSTEM CAPACITY",
    quote: "Intelligent Signaling Line Circuits: 1 (expandable)",
    documentNumber: "351605",
    revision: "C",
    url: "https://prod-edam.honeywell.com/hbt-fire-351605-C.pdf",
    retrievedAt: "2026-09-30",
  },
  retrievalMethod: "first-party manufacturer data sheet, prod-edam.honeywell.com",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Fact authoring: accepted, bounded, observation-only.
// ---------------------------------------------------------------------------
test("KN-SCALE-2 a complete research submission is accepted as an observation", () => {
  const result = assessResearchFactSubmission({ file, organizationId: ORG, payload: goodSubmission() });
  assert.equal(result.ok, true);
  assert.equal(result.fact.knowledgeFileId, file.id);
  assert.equal(result.fact.factType, "Detector Capacity");
  assert.equal(result.fact.reviewStatus, "Learned");
  assert.equal(result.fact.sourceLocation.documentNumber, "351605");
  assert.equal(result.fact.sourceLocation.page, 3);
  assert.equal(result.fact.attributes.observationKey, "pilot2:IFP-75HV:351605-C");
  assert.equal(result.fact.attributes.partNumber, "IFP-75HV");
  assert.equal(result.fact.attributes.authoringChannel, "research-fact-api");
});

test("KN-SCALE-2 low confidence yields Needs Review, and review status is never caller-controlled", () => {
  const learned = assessResearchFactSubmission({ file, organizationId: ORG, payload: goodSubmission({ confidence: 95 }) });
  assert.equal(learned.fact.reviewStatus, "Learned");
  const needsReview = assessResearchFactSubmission({ file, organizationId: ORG, payload: goodSubmission({ confidence: 40 }) });
  assert.equal(needsReview.fact.reviewStatus, "Needs Review");
  // A caller asserting an authoritative state is ignored: the state is derived.
  const spoofed = assessResearchFactSubmission({
    file,
    organizationId: ORG,
    payload: goodSubmission({ reviewStatus: "Approved", confidence: 95, factType: "Protocol" }),
  });
  assert.ok(["Learned", "Needs Review"].includes(spoofed.fact.reviewStatus));
  assert.equal(spoofed.fact.reviewStatus, "Learned");
});

test("KN-SCALE-2 every mandatory provenance element is enforced", () => {
  const cases = [
    ["factType", { factType: "" }, "KNOWLEDGE_FACT_TYPE_UNSUPPORTED"],
    ["factType vocabulary", { factType: "Whatever The Agent Wants" }, "KNOWLEDGE_FACT_TYPE_UNSUPPORTED"],
    ["originalValue", { originalValue: "  " }, "KNOWLEDGE_FACT_VALUE_REQUIRED"],
    ["observationKey", { observationKey: "" }, "KNOWLEDGE_FACT_OBSERVATION_KEY_REQUIRED"],
    ["retrievalMethod", { retrievalMethod: "" }, "KNOWLEDGE_FACT_RETRIEVAL_REQUIRED"],
  ];
  for (const [label, overrides, expected] of cases) {
    const result = assessResearchFactSubmission({ file, organizationId: ORG, payload: goodSubmission(overrides) });
    assert.equal(result.ok, false, `${label} must be refused`);
    assert.equal(result.status, expected, `${label} -> ${result.status}`);
  }
});

test("KN-SCALE-2 provenance must be locatable, quotable and attributable to a document", () => {
  const noLocation = assessResearchFactSubmission({
    file,
    organizationId: ORG,
    payload: goodSubmission({ sourceLocation: { documentNumber: "351605", quote: "q", url: "u" } }),
  });
  assert.equal(noLocation.status, "KNOWLEDGE_FACT_LOCATION_REQUIRED");

  const noQuote = assessResearchFactSubmission({
    file,
    organizationId: ORG,
    payload: goodSubmission({ sourceLocation: { page: 3, documentNumber: "351605", url: "u" } }),
  });
  assert.equal(noQuote.status, "KNOWLEDGE_FACT_QUOTE_REQUIRED");

  const noDocument = assessResearchFactSubmission({
    file,
    organizationId: ORG,
    payload: goodSubmission({ sourceLocation: { page: 3, quote: "q", url: "u" } }),
  });
  assert.equal(noDocument.status, "KNOWLEDGE_FACT_DOCUMENT_REQUIRED");
});

test("KN-SCALE-2 a file outside the organization is refused", () => {
  const result = assessResearchFactSubmission({
    file: { ...file, organization_id: "organization_other" },
    organizationId: ORG,
    payload: goodSubmission(),
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, "KNOWLEDGE_FILE_NOT_FOUND");
});

test("KN-SCALE-2 the governed vocabulary is the promotion policy's own classification table", () => {
  assert.ok(RESEARCH_FACT_TYPES.includes("Detector Capacity"));
  assert.ok(RESEARCH_FACT_TYPES.includes("Lifecycle"));
  assert.equal(normalizeResearchFactType("  detector capacity "), "Detector Capacity");
  assert.equal(normalizeResearchFactType("Not A Type"), "");
});

// ---------------------------------------------------------------------------
// Idempotency: content-addressed identity.
// ---------------------------------------------------------------------------
test("KN-SCALE-2 an exact replay resolves to the same fact identity", () => {
  const a = researchFactId({ knowledgeFileId: "f1", organizationId: ORG, sourceLocation: { page: 3, section: "S", documentNumber: "D", quote: "Q" }, factType: "Detector Capacity", normalizedValue: "159", partNumber: "IFP-75HV" });
  const b = researchFactId({ knowledgeFileId: "f1", organizationId: ORG, sourceLocation: { page: 3, section: "S", documentNumber: "D", quote: "Q" }, factType: "Detector Capacity", normalizedValue: "159", partNumber: "IFP-75HV" });
  assert.equal(a, b, "the same finding must resolve to one identity, so replay cannot duplicate it");
});

test("KN-SCALE-2 two independent sources stay two evidence records", () => {
  const base = { knowledgeFileId: "f1", organizationId: ORG, sourceLocation: { page: 3, section: "S", documentNumber: "D", quote: "Q" }, factType: "Detector Capacity", normalizedValue: "159", partNumber: "IFP-75HV" };
  const other = researchFactId({ ...base, knowledgeFileId: "f2" });
  assert.notEqual(base.knowledgeFileId && researchFactId(base), other, "corroboration from a second document must not be deduplicated into the first");
});

test("KN-SCALE-2 a changed value and a changed location are both new observations", () => {
  const base = { knowledgeFileId: "f1", organizationId: ORG, factType: "Detector Capacity", partNumber: "IFP-75HV", normalizedValue: "159" };
  const original = researchFactId({ ...base, sourceLocation: { page: 3, documentNumber: "D", quote: "Q" } });
  const changedValue = researchFactId({ ...base, normalizedValue: "250", sourceLocation: { page: 3, documentNumber: "D", quote: "Q" } });
  const changedLocation = researchFactId({ ...base, sourceLocation: { page: 4, documentNumber: "D", quote: "Q" } });
  assert.notEqual(original, changedValue, "a corrected value is a new observation, not a silent overwrite");
  assert.notEqual(original, changedLocation, "the same value at a different location is distinct evidence");
});

test("KN-SCALE-2 identity is organization-scoped", () => {
  const base = { knowledgeFileId: "f1", sourceLocation: { page: 1, documentNumber: "D", quote: "Q" }, factType: "Protocol", normalizedValue: "SLC", partNumber: "X" };
  assert.notEqual(
    researchFactId({ ...base, organizationId: "org-a" }),
    researchFactId({ ...base, organizationId: "org-b" }),
  );
});

// ---------------------------------------------------------------------------
// Candidate precision.
// ---------------------------------------------------------------------------
test("KN-SCALE-1 measurement values, dates, ranges and document numbers are never product candidates", () => {
  const notProducts = [
    "0.05", "24", "159", "0-49", "1000-1500", "01/01", "1-800-328-0103", "1-3/8",
    "1.1.1", "1.04A", "24VDC", "I56-2806", "DN-60977", "151391", "000FH-E",
    "FM-980", "UL 864", "Customer Service - Software Support Agreements",
  ];
  for (const token of notProducts) {
    const result = qualifiesAsLinkCandidate(token, { ingestionMode: KNOWLEDGE_INGESTION_MODES.GENERAL });
    assert.equal(result.qualifies, false, `${token} must not enter the candidate queue (${result.reason})`);
  }
});

test("KN-SCALE-1 known residual: some document-shaped tokens still reach the queue", () => {
  // Pinned deliberately. Measured against the 1,059 distinct tokens Pilot 1
  // created, the guard suppresses 638 outright and demotes 131 to
  // known-products-only, but a few document-shaped tokens (LS10143-001SK-E,
  // I56-2806-007R) are indistinguishable from an ordering code by shape alone
  // and still candidate. This test exists so the residual cannot grow silently:
  // under TARGETED_PRODUCT_ENRICHMENT these are never linked at all.
  const residual = classifyCandidateDisposition("LS10143-001SK-E");
  assert.equal(residual.disposition, "candidate");
  assert.equal(
    qualifiesAsLinkCandidate("LS10143-001SK-E", { ingestionMode: KNOWLEDGE_INGESTION_MODES.TARGETED }).qualifies,
    false,
    "targeted enrichment must not queue it",
  );
});

test("KN-SCALE-1 identifier-shaped tokens from outside a known family still candidate", () => {
  // A manufacturer's own ordering codes that are not device-family references
  // must still be able to open a discovery.
  for (const token of ["C-14", "H-215", "M-24"]) {
    const result = qualifiesAsLinkCandidate(token, { ingestionMode: KNOWLEDGE_INGESTION_MODES.GENERAL });
    assert.equal(result.disposition, "candidate", `${token}: ${result.reason}`);
    assert.equal(result.mode, "candidate");
  }
});

test("KN-SCALE-1 a referenced device may link a KNOWN product but never opens a candidate", () => {
  const referenced = qualifiesAsLinkCandidate("SD505-6AB", { ingestionMode: KNOWLEDGE_INGESTION_MODES.GENERAL });
  assert.equal(referenced.disposition, "referenced");
  assert.equal(referenced.mode, "referenced-known-product-only");
  // The route resolves this with an INNER JOIN, so an unknown referenced part
  // produces no row and cannot become a candidate.
  assert.equal(referenced.qualifies, true);
});

test("KN-SCALE-1 a bare number is never auto-candidated even when it is a real part", () => {
  // 6815 (SLC expander) and 5496 (NAC expander) are real purely-numeric
  // Honeywell parts, but a bare number is indistinguishable from a measurement
  // (Pilot 1: 21.5% of candidates were bare numbers). The deliberate trade-off
  // is that such a part is discovered by an asserted research observation
  // instead of by an incidental mention.
  const result = classifyCandidateDisposition("6815");
  assert.equal(result.disposition, "discovery-only");
  assert.match(result.reason, /bare number/);
  assert.equal(qualifiesAsLinkCandidate("6815", { ingestionMode: KNOWLEDGE_INGESTION_MODES.GENERAL }).qualifies, false);
});

test("KN-SCALE-1 accessories and compatible devices are recorded but not auto-candidated", () => {
  for (const token of ["B300-6", "B501-IV", "B224BI-IV", "IDP-ISO", "SK-NIC"]) {
    const result = classifyCandidateDisposition(token);
    assert.equal(result.disposition, "referenced", `${token} -> ${result.reason}`);
    // recorded as an observation, and linkable only to a product we already know
    assert.equal(qualifiesAsLinkCandidate(token, { ingestionMode: KNOWLEDGE_INGESTION_MODES.GENERAL }).mode, "referenced-known-product-only");
  }
});

test("KN-SCALE-3 targeted enrichment never auto-candidates an extracted mention", () => {
  const extracted = qualifiesAsLinkCandidate("SPDS-62165-B", { ingestionMode: KNOWLEDGE_INGESTION_MODES.TARGETED });
  assert.equal(extracted.qualifies, false);
  assert.match(extracted.reason, /targeted enrichment/);
  // Only an explicitly asserted research observation may candidate.
  const asserted = qualifiesAsLinkCandidate("SPDS-62165-B", { ingestionMode: KNOWLEDGE_INGESTION_MODES.TARGETED, asserted: true });
  assert.equal(asserted.qualifies, true);
});

test("KN-SCALE-3 ingestion mode normalization defaults to general intake", () => {
  assert.equal(normalizeIngestionMode(undefined), KNOWLEDGE_INGESTION_MODES.GENERAL);
  assert.equal(normalizeIngestionMode("targeted_product_enrichment"), KNOWLEDGE_INGESTION_MODES.TARGETED);
  assert.equal(normalizeIngestionMode("nonsense"), KNOWLEDGE_INGESTION_MODES.GENERAL);
});

// ---------------------------------------------------------------------------
// Source authority is independent of classification.
// ---------------------------------------------------------------------------
test("KN-SCALE-4 a misclassified manufacturer manual keeps technical source authority", () => {
  // Pilot 1 reality: this manual was classified "Cost Sheet".
  const authority = assessKnowledgeSourceAuthority({
    fileName: "Honeywell_Farenhyt_IFP-2100_Manual_LS10143-001SK-E-C.pdf",
    text: "Honeywell Farenhyt IFP-2100/IFP-2100ECS Installation and Operations Manual LS10143-001SK-E Section 7.5 Maximum Number of SLC Devices. Addressable device capacity 2100.",
    sourceUrl: "https://prod-edam.honeywell.com/content/dam/honeywell-edam/hbt/en-us/documents/manuals-and-guides/installation-guides/IFP-2100-Manual.pdf",
  });
  assert.equal(authority.authorityClass, SOURCE_AUTHORITY_CLASSES.MANUFACTURER_TECHNICAL);
  assert.ok(authority.evidence.some((line) => /first-party manufacturer document channel/.test(line)));
  assert.ok(authority.evidence.some((line) => /document number/.test(line)));
  // The assessment never reads a classification.
  assert.ok(!("detected_type" in authority) && !("classification" in authority));
});

test("KN-SCALE-4 a manufacturer price list is commercial authority, not technical", () => {
  const authority = assessKnowledgeSourceAuthority({
    fileName: "KSA Honeywell Farenhyt Series Price List -2023.xlsx",
    text: "Honeywell Farenhyt price list 2023. List price SAR 1,250 per unit. Distributor and quotation terms apply.",
    sourceUrl: "https://prod-edam.honeywell.com/price-list.xlsx",
  });
  assert.equal(authority.authorityClass, SOURCE_AUTHORITY_CLASSES.MANUFACTURER_COMMERCIAL);
  assert.equal(hasTechnicalSourceAuthority({ summary: JSON.stringify({ sourceAuthority: authority }) }), false);
});

test("KN-SCALE-4 authority is read back off the file, not off detected_type", () => {
  const withAuthority = {
    detected_type: "Cost Sheet",
    summary: JSON.stringify({ sourceAuthority: { authorityClass: SOURCE_AUTHORITY_CLASSES.MANUFACTURER_TECHNICAL } }),
  };
  assert.equal(hasTechnicalSourceAuthority(withAuthority), true);
  assert.equal(hasTechnicalSourceAuthority({ detected_type: "Cost Sheet", summary: "{}" }), false);
  assert.equal(hasTechnicalSourceAuthority({ detected_type: "Product Datasheet", summary: null }), false);
});

test("KN-SCALE-4 first-party host detection is exact, not a substring guess", () => {
  assert.equal(isFirstPartyManufacturerSource("https://prod-edam.honeywell.com/x.pdf"), true);
  assert.equal(isFirstPartyManufacturerSource("https://evil-honeywell.com.attacker.test/x.pdf"), false);
  assert.equal(isFirstPartyManufacturerSource("not a url"), false);
});

// ---------------------------------------------------------------------------
// Human-authority integrity.
// ---------------------------------------------------------------------------
test("KN-HUMAN-1 the pilot-1 development identity is synthetic and cannot be a human decision-maker", () => {
  // This is the finding: Pilot 1 recorded its human-path decisions as
  // local-development-user, which this module classifies as synthetic.
  assert.equal(resolveHumanActor({ APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "Local" }), null);
  const refused = requireHumanActor({ APP_HUMAN_ID: "local-development-user", APP_HUMAN_NAME: "Local" });
  assert.equal(refused.error, "HUMAN_ACTOR_ID_INVALID");
});

test("KN-HUMAN-1 human-authority writes fail closed when no human is configured", () => {
  const absent = requireHumanActor({});
  assert.equal(absent.error, "HUMAN_ACTOR_NOT_CONFIGURED");
  const noName = requireHumanActor({ APP_HUMAN_ID: "op-1" });
  assert.equal(noName.error, "HUMAN_ACTOR_NAME_REQUIRED");
});

test("KN-HUMAN-1 an explicitly configured test human satisfies the gate", () => {
  const gate = requireHumanActor({
    APP_HUMAN_ID: "op-knowledge-pilot-2",
    APP_HUMAN_NAME: "Knowledge Pilot Reviewer",
    APP_HUMAN_EMAIL: "reviewer@development.invalid",
  });
  assert.equal(gate.error, undefined);
  assert.equal(gate.actor.id, "op-knowledge-pilot-2");
  assert.equal(gate.actor.synthetic, false);
  assert.equal(gate.actor.source, "server-configured-human-operator");
});

// ---------------------------------------------------------------------------
// The authoring path can only write observations: a table-level proof that the
// domain layer has no canonical write statement at all.
// ---------------------------------------------------------------------------
test("KN-SCALE-2 the research-fact domain contains no canonical-truth write", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("../app/domain/knowledge-research-fact.mjs", import.meta.url).pathname,
    "utf8",
  );
  for (const forbidden of [
    "INSERT INTO product_attributes",
    "INSERT INTO engineering_relationships",
    "INSERT INTO product_compatibility",
    "INSERT INTO product_lifecycle_events",
    "INSERT INTO knowledge_promotions",
    "UPDATE product_attributes",
    "UPDATE knowledge_facts SET review_status",
  ]) {
    assert.ok(!source.includes(forbidden), `the authoring domain must not contain: ${forbidden}`);
  }
  assert.ok(source.includes("knowledge_facts"), "it writes observations");
});
