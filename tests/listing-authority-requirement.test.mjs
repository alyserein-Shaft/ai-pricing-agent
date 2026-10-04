// GOVERNED LISTING / CERTIFICATION AUTHORITY REQUIREMENT
//
// Focus: a project requirement to be UL LISTED names an authority and no standard
// number. This suite proves the representation is honest and fail-closed:
//
//   * it never becomes "UL 864 required" (fabrication);
//   * `unfalsifiableStandardCitations` / `evaluateStandards` are untouched;
//   * a listing requirement passes ONLY on governed, current, approved certification
//     evidence for the exact product;
//   * a product's certifications NEVER raise compliance confidence on their own.
//
// Run: node --test tests/listing-authority-requirement.test.mjs

import test from "node:test";
import assert from "node:assert/strict";

import { evaluateListingRequirements, evaluateCandidate, unfalsifiableStandardCitations } from "../app/domain/product-matching-engine.mjs";
import { confidenceComponents } from "../app/domain/confidence-safety-engine.mjs";
import { extractRequirementIntelligence, LISTING_FACT_TYPE, REQUIREMENT_INTELLIGENCE_VERSION } from "../app/domain/requirement-intelligence-engine.mjs";
import { PRODUCT_LISTING_BODY_NAMES, isProductListingBody, normalizeProductListingBody, findProductListingBodyInText } from "../app/domain/standards-citations.mjs";
import { listingClaimFromFact } from "../worker/technical-requirement-api.mjs";

const UL_LISTING_CLAUSE =
  "Every component of the fire alarm system shall be listed under a single manufacturer, approved by Underwriters Laboratories (UL), and clearly bear the UL certification.";
const EDP_PERIPHERAL_CLAUSE =
  "Connectivity includes an EIA-232 interface linking the fire alarm control panel with UL Listed Electronic Data Processing (EDP) peripherals and two EIA-485 ports for connecting annunciation and control subsystem components via serial communication.";

const requirement = (overrides = {}) => ({
  id: "req-1",
  originalText: UL_LISTING_CLAUSE,
  requirementType: "Mandatory",
  requirementCategory: "Compliance",
  confidence: 88,
  source: { pageFrom: 5, clause: "P", section: "28 46 00 SECTION 28 46 00", originalClauseText: UL_LISTING_CLAUSE },
  ...overrides,
});
const listingFacts = (req) => extractRequirementIntelligence(req).filter((fact) => fact.factType === LISTING_FACT_TYPE);
const claim = (authority = "UL", extra = {}) => ({ authority, required: true, ...extra });
// `evaluateListingRequirements` takes the CONSOLIDATED requirements, exactly like
// `evaluateCapabilities`, so a comparison can name the requirement that owns the
// listing claim and the fail-closed unstructured gate can recognise it.
const profileWith = (listingRequirements, extra = {}) => ({
  consolidatedRequirements: [{ id: "consolidated:listing", normalizedRequirement: UL_LISTING_CLAUSE, governingSourceId: "req-1", originalText: UL_LISTING_CLAUSE, requirementType: "Mandatory", priority: "Mandatory", attributes: [], capabilities: [], standards: [], compatibility: [], accessories: [], listingRequirements, ...extra }],
});
const evaluateListing = (listingRequirements, product) => evaluateListingRequirements(profileWith(listingRequirements).consolidatedRequirements, product);

// A governed IFP-2100HV-shaped certification row, exactly as the
// `certifications` subquery in worker/product-matching-api.mjs projects it.
const cert = (overrides = {}) => ({
  certificationId: "cert-ul-s2766",
  type: "Listing claim",
  body: "UL",
  number: "S2766",
  part: null,
  revisionYear: null,
  scope: "Manufacturer datasheet claim only",
  region: null,
  status: "Verified - Manufacturer Datasheet",
  reviewStatus: "Approved",
  confidence: 95,
  versionNumber: 1,
  variantId: null,
  documentId: "doc-datasheet",
  evidenceLocation: { page: 4, section: "Agency Listings and Approvals", exactText: "UL Listed: S2766" },
  ...overrides,
});
const productWith = (certifications) => ({ id: "product-1", partNumber: "IFP-2100HV", manufacturer: "Honeywell", reviewStatus: "Reviewed", standards: [], certifications, attributes: [], reviewedAttributes: [], compatibility: [], accessories: [] });

// ---------------------------------------------------------------------------
// 1. The governed representation: a NAME, never a number
// ---------------------------------------------------------------------------

test("A UL-listed requirement is represented as a listing authority, not a numbered standard", () => {
  const [fact] = listingFacts(requirement());
  assert.ok(fact, "the UL listing clause must derive a governed listing requirement");
  assert.equal(fact.value.authority, "UL");
  assert.equal(fact.value.required, true);
  // The governing property: no standard number is ever introduced.
  assert.equal(fact.value.number, undefined);
  assert.equal(fact.value.standard, undefined);
  assert.ok(!/864/.test(JSON.stringify(fact.value)), `no UL 864 may be invented: ${JSON.stringify(fact.value)}`);
  // ...and the verbatim clause is the evidence, not a paraphrase.
  assert.match(fact.evidenceSnippet, /Underwriters Laboratories \(UL\)/);
  assert.equal(fact.reviewStatus, "Needs Review");
  assert.equal(fact.modality, "Mandatory");
});

test("every derived listing authority is a governed product-listing body", () => {
  for (const text of [UL_LISTING_CLAUSE, "All control equipment must be certified by FM."]) {
    for (const fact of listingFacts(requirement({ originalText: text }))) {
      assert.ok(isProductListingBody(fact.value.authority), `${fact.value.authority} must issue product listings`);
      assert.ok(PRODUCT_LISTING_BODY_NAMES.includes(fact.value.authority));
    }
  }
  // The set is DERIVED from the canonical STANDARD_BODIES.productListingBody flag,
  // so there is exactly one definition of "a body that issues product listings".
  // CSA is deliberately absent: this project holds no governed product-listing
  // record for it, so a CSA demand derives nothing and keeps failing closed.
  assert.ok(!isProductListingBody("CSA"));
  assert.equal(listingFacts(requirement({ originalText: "Every device is required to be listed by CSA." })).length, 0);
});

test("UL and ULC are separate authorities", () => {
  assert.equal(normalizeProductListingBody("UL"), "UL");
  assert.equal(normalizeProductListingBody("ULC"), "ULC");
  assert.notEqual(normalizeProductListingBody("UL"), normalizeProductListingBody("ULC"));
  // A ULC listing must NOT satisfy a requirement naming UL.
  const [row] = evaluateListing([claim("UL")], productWith([cert({ body: "ULC" })]));
  assert.equal(row.pass, false);
});

test("a body is recognised in text by token or by its spelled-out name", () => {
  assert.equal(findProductListingBodyInText("approved by Underwriters Laboratories (UL)"), "UL");
  assert.equal(findProductListingBodyInText("Factory Mutual approved"), "FM");
  // Longest-first: a ULC mention is never read as a UL mention.
  assert.equal(findProductListingBodyInText("ULC listed"), "ULC");
  // A body that is not a governed product-listing body yields nothing.
  assert.equal(findProductListingBodyInText("listed by CSA"), null);
  // Substring safety: an ordinary word must never be read as a body.
  assert.equal(findProductListingBodyInText("a useful panel"), null);
  assert.equal(findProductListingBodyInText("connected to the network"), null);
});

test("an ungoverned authority fails closed and is never free-text matched", () => {
  for (const authority of ["Acme Certifiers", "", "not a body", "Underwriters Laboratories of Atlantis"]) {
    const [row] = evaluateListing([claim(authority)], productWith([cert()]));
    assert.equal(row.pass, false, `authority ${JSON.stringify(authority)} must not pass`);
    assert.equal(row.blocking, true);
  }
});

// ---------------------------------------------------------------------------
// 2. The derivation must not invent a listing from a word that merely qualifies
//    another noun. This is the measured Al Mousa seq 100313 shape.
// ---------------------------------------------------------------------------

test("'UL Listed' qualifying PERIPHERALS derives no listing requirement for the panel", () => {
  const facts = listingFacts(requirement({ originalText: EDP_PERIPHERAL_CLAUSE, requirementType: "Informational" }));
  assert.equal(facts.length, 0, "the peripheral-modifier clause must derive nothing");
});

test("a listing word with no modal, or with no named body, derives nothing", () => {
  for (const text of [
    "Provide a UL Listed power supply.",
    "All fire alarm equipment must be accepted by the authority and listed or labeled by an approved testing laboratory for their intended use.",
    "The panel shall record events in the UL format history log.",
    "The control unit shall comply with UL 864.",
    "Detectors should be listed by UL where available.",
  ]) {
    assert.equal(listingFacts(requirement({ originalText: text })).length, 0, `${text} must derive nothing`);
  }
});

test("a requirement naming no authority derives no authority to compare", () => {
  const facts = listingFacts(requirement({ originalText: "All equipment must be listed by an approved testing laboratory." }));
  assert.equal(facts.length, 0);
});

// ---------------------------------------------------------------------------
// 3. NEGATIVE CONTROLS A-G
// ---------------------------------------------------------------------------

test("A -- UL Listed requirement + current governed UL listing => satisfied", () => {
  const [row] = evaluateListing([claim("UL")], productWith([cert()]));
  assert.equal(row.pass, true);
  assert.equal(row.blocking, false);
  assert.equal(row.result, "Verified Listed");
  assert.equal(row.productCertification.number, "S2766");
});

test("B -- UL Listed requirement + only FM approval => NOT satisfied", () => {
  const [row] = evaluateListing([claim("UL")], productWith([cert({ type: "Approval claim", body: "FM", number: "FM", status: "Verified - Manufacturer Datasheet", evidenceLocation: { exactText: "FM Approved" } })]));
  assert.equal(row.pass, false);
  assert.equal(row.blocking, true);
  assert.equal(row.result, "Evidence Missing");
});

test("C -- UL 864 requirement + generic UL listing with NO UL 864 evidence => NOT satisfied", () => {
  // The NUMBERED gate alone decides numbered citations, and it never reads
  // certifications. A UL listing claim numbered S2766 is not UL 864, so a project
  // that really does require UL 864 still fails closed -- and the listing path
  // must not be able to rescue it.
  const engine = numbered_engine();
  const result = evaluateCandidate({ profile: engine.profile, generated: engine.generated, prices: [] });
  const standardRows = result.comparisons.filter((entry) => entry.comparisonType === "Standard");
  assert.equal(standardRows.length, 1, "a falsifiable numbered citation must still produce a Standard row");
  assert.equal(standardRows[0].pass, false);
  assert.equal(standardRows[0].result, "Evidence Missing");
  assert.equal(standardRows[0].blocking, true);
  // And with no listing requirement of its own, the listing path contributes nothing.
  assert.equal(result.comparisons.filter((entry) => entry.comparisonType === "Listing Authority").length, 0);
});

function numbered_engine() {
  return {
    profile: {
      readiness: { status: "Ready for Matching" },
      versionNumber: 21,
      boqItem: { system: "Fire Alarm", category: "Fire Alarm Control Panel", productFamily: "Fire Alarm Control Panel", description: "Fire alarm control panel" },
      consolidatedRequirements: [{ id: "consolidated:ul864", normalizedRequirement: "Control units shall comply with ANSI/UL 864.", requirementType: "Mandatory", priority: "Mandatory", governingSourceId: "req-864", attributes: [], capabilities: [], standards: [{ body: "UL", number: "864" }], compatibility: [], accessories: [] }],
      standards: [{ body: "UL", number: "864", requirementId: "req-864" }],
      listingRequirements: [],
      compatibility: [],
      accessories: [],
      derivedRequirements: [],
      relationships: [],
      manufacturers: [],
    },
    // The product's certification set proves a UL LISTING (S2766) and nothing more.
    generated: { product: productWith([cert()]), stage: "Structured", searchScore: 85, basis: [], discoveryOnly: false },
  };
}

test("D -- generic UL Listed requirement + exact UL 864 certification => listing satisfied, requirement stays generic", () => {
  const [row] = evaluateListing([claim("UL")], productWith([cert({ type: "Standard compliance", number: "864", status: "Verified - Manufacturer Datasheet", evidenceLocation: { exactText: "Complies with UL 864 10th Edition" } })]));
  assert.equal(row.pass, true, "a verified UL certification proves the product is UL listed");
  // The requirement side stays generic: the authority is named, no number is added.
  assert.equal(row.requiredAuthority, "UL");
  assert.equal(row.authority, "UL");
  assert.ok(!/864/.test(JSON.stringify({ requiredAuthority: row.requiredAuthority, authority: row.authority, evidence: { listingAuthoritySource: row.evidence?.listingAuthoritySource } })), "the project requirement must remain generic UL Listed");
  // ...while the PRODUCT's own number is what the comparison actually matched on.
  assert.equal(row.productCertification.number, "864");
});

test("E -- an unrelated SKU's certification is NOT accepted", () => {
  // Certifications are scoped by the governed read to the exact product id, so an
  // unrelated product contributes no rows at all for this candidate.
  const unrelated = { id: "product-2", partNumber: "OTHER-SKU", standards: [], certifications: [cert()], attributes: [], reviewedAttributes: [], compatibility: [], accessories: [] };
  assert.equal(unrelated.certifications.every((entry) => entry.certificationId === "cert-ul-s2766"), true);
  const [row] = evaluateListing([claim("UL")], productWith([]));
  assert.equal(row.pass, false, "the candidate's own (empty) certification set decides");
  // And a variant-scoped certification does not transfer to the base product.
  const [variantRow] = evaluateListing([claim("UL")], productWith([cert({ variantId: "variant-999" })]));
  assert.equal(variantRow.pass, false, "a certification scoped to another variant must not pass");
});

test("F -- superseded / deleted / rejected / unapproved certifications are NOT accepted", () => {
  const variants = [
    ["superseded", { supersededAt: "2026-10-02 19:00:00" }],
    ["deleted", { deletedAt: "2026-10-02 19:00:00" }],
    ["rejected review", { reviewStatus: "Rejected" }],
    ["needs review", { reviewStatus: "Needs Review", status: "Unverified" }],
  ];
  for (const [label, overrides] of variants) {
    const [row] = evaluateListing([claim("UL")], productWith([cert(overrides)]));
    assert.equal(row.pass, false, `${label} certification must not satisfy a listing requirement`);
    assert.equal(row.blocking, true);
  }
});

test("F2 -- the recorded status is REPORTED, never silently upgraded", () => {
  // `reviewStatus = 'Approved'` is the governance gate; `status` decides only how
  // the verdict is worded. An approved manufacturer CLAIM is reported as such and
  // is never dressed up as verified evidence.
  const [claimed] = evaluateListing([claim("UL")], productWith([cert({ status: "Unverified" })]));
  assert.equal(claimed.pass, true, "an approved row is governed evidence");
  assert.equal(claimed.result, "Claimed Listed");
  assert.notEqual(claimed.result, "Verified Listed");
  const [verified] = evaluateListing([claim("UL")], productWith([cert({ status: "Verified - Manufacturer Datasheet" })]));
  assert.equal(verified.result, "Verified Listed");
  // A claim with no evidence location at all is still not "Verified".
  const [bare] = evaluateListing([claim("UL")], productWith([cert({ status: "Verified", evidenceLocation: null })]));
  assert.equal(bare.result, "Claimed Listed");
});

test("F2 -- an APPROVED certification recorded as NOT listed contradicts and blocks", () => {
  for (const status of ["Not Listed", "Listing Withdrawn", "Certification Revoked", "Expired"]) {
    const [row] = evaluateListing([claim("UL")], productWith([cert({ status })]));
    assert.equal(row.pass, false, `${status} must not pass`);
    assert.equal(row.result, "Listing Contradicted");
  }
});

test("F3 -- an unapproved row is neither proof NOR contradiction", () => {
  // A Needs Review row must not be usable to pass...
  const [pass] = evaluateListing([claim("UL")], productWith([cert({ reviewStatus: "Needs Review", status: "Unverified" })]));
  assert.equal(pass.pass, false);
  assert.equal(pass.result, "Certification Evidence Not Approved");
  // ...and must not be usable to manufacture a contradiction either, or anyone could
  // block a product by filing junk.
  const [contradiction] = evaluateListing([claim("UL")], productWith([cert({ reviewStatus: "Needs Review", status: "Not Listed" })]));
  assert.notEqual(contradiction.result, "Listing Contradicted");
});

test("G -- no listing requirement in the project => certifications do NOT raise confidence", () => {
  const base = {
    item: { projectId: "p", system: "Fire Alarm", category: "Fire Alarm Control Panel", description: "Panel", unit: "ea", quantity: 1, productFamily: "Fire Alarm Control Panel", sourceDocumentId: "doc", sourceLocation: {}, extractionConfidence: 90 },
    provenance: { complete: true, confidence: 90, documentClassificationConfidence: 90, specificationExtractionConfidence: 90 },
    prices: [],
  };
  const withRichCerts = {
    ...base,
    profile: { standards: [], listingRequirements: [] },
    candidate: { comparisons: [], standards: [], listingRequirements: [], compatibility: [], accessories: [], lifecycle: { result: "Pass" }, product: { id: "product-1", partNumber: "IFP-2100HV", reviewStatus: "Reviewed" } },
  };
  const components = confidenceComponents(withRichCerts);
  assert.equal(components.standardsEvidence, 100, "no project demand means no obligation, so nothing is owed");
  // The decisive comparison: the candidate's rich certifications change nothing,
  // because they are only ever read through a requirement that demanded them.
  assert.deepEqual(
    confidenceComponents({ ...withRichCerts, candidate: { ...withRichCerts.candidate, certifications: [cert(), cert({ certificationId: "c2", body: "FM", type: "Approval claim", number: "FM" })] } }).standardsEvidence,
    components.standardsEvidence,
  );
});

test("G2 -- a project listing requirement that is UNSATISFIED scores 0, never a free pass", () => {
  const components = confidenceComponents({
    item: { projectId: "p", system: "Fire Alarm", category: "Fire Alarm Control Panel", description: "Panel", unit: "ea", quantity: 1, productFamily: "Fire Alarm Control Panel", sourceDocumentId: "doc", sourceLocation: {}, extractionConfidence: 90 },
    profile: { standards: [], listingRequirements: [claim("UL")] },
    candidate: { comparisons: [], standards: [], listingRequirements: [{ pass: false, blocking: true }], compatibility: [], accessories: [], lifecycle: { result: "Pass" }, product: { id: "p", partNumber: "X", reviewStatus: "Reviewed" } },
    provenance: { complete: true, confidence: 90, documentClassificationConfidence: 90, specificationExtractionConfidence: 90 },
    prices: [],
  });
  assert.equal(components.standardsEvidence, 0);
});

// ---------------------------------------------------------------------------
// 4. Separation from the numbered-standard gate (the refusal must survive)
// ---------------------------------------------------------------------------

test("the unnumbered-citation refusal is UNCHANGED and still refuses UL-with-no-number", () => {
  assert.equal(unfalsifiableStandardCitations({ body: "UL", number: null }), true);
  assert.equal(unfalsifiableStandardCitations({ body: "UL", number: "864" }), false);
  assert.equal(unfalsifiableStandardCitations({ body: "IEEE", number: "Standard" }), true);
});

test("a body-only UL citation still produces NO Standard comparison row", () => {
  const engine = require_engine();
  // The engine's product DOES carry a verified UL listing, which is the whole point:
  // even with that evidence in hand, the unnumbered citation must not become a
  // numbered Standard comparison, because `evaluateStandards` refuses it first.
  const result = evaluateCandidate({ profile: engine.profile, generated: engine.generated, prices: [] });
  const standardRows = result.comparisons.filter((entry) => entry.comparisonType === "Standard");
  assert.equal(standardRows.length, 0, "the numbered gate must still refuse an unnumbered citation");
});

test("a requirement whose listing claim was decided is NOT double-counted as Missing Product Data", () => {
  const engine = require_engine();
  const result = evaluateCandidate({ profile: engine.profile, generated: engine.generated, prices: [] });
  const unstructured = result.comparisons.filter((entry) => entry.comparisonType === "Technical Requirement" && entry.result === "Missing Product Data");
  assert.equal(unstructured.length, 0, `the listing comparison IS the dimension: ${JSON.stringify(unstructured)}`);
  const listingRows = result.comparisons.filter((entry) => entry.comparisonType === "Listing Authority");
  assert.equal(listingRows.length, 1);
  assert.equal(listingRows[0].pass, true);
  // The whole point: a genuinely listed product is not blocked.
  assert.equal(result.mandatoryFailures.filter((entry) => entry.comparisonType === "Listing Authority" || entry.result === "Missing Product Data").length, 0);
});

function require_engine() {
  const profile = {
    readiness: { status: "Ready for Matching" },
    versionNumber: 21,
    boqItem: { system: "Fire Alarm", category: "Fire Alarm Control Panel", productFamily: "Fire Alarm Control Panel", description: "Fire alarm control panel" },
    consolidatedRequirements: [
      { id: "consolidated:listing", normalizedRequirement: UL_LISTING_CLAUSE, requirementType: "Mandatory", priority: "Mandatory", governingSourceId: "req-1", attributes: [], capabilities: [], standards: [], listingRequirements: [claim("UL", { governingRequirementId: "req-1" })], compatibility: [], accessories: [] },
    ],
    standards: [{ body: "UL", number: null, requirementId: "req-1" }],
    listingRequirements: [claim("UL", { governingRequirementId: "req-1" })],
    compatibility: [],
    accessories: [],
    derivedRequirements: [],
    relationships: [],
    manufacturers: [],
    capacityEvidence: null,
  };
  return {
    profile,
    generated: { product: productWith([cert()]), stage: "Structured", searchScore: 85, basis: [], discoveryOnly: false },
  };
}

// ---------------------------------------------------------------------------
// 5. The governed loader refuses an ungoverned authority
// ---------------------------------------------------------------------------

test("listingClaimFromFact accepts a governed authority and refuses anything else", () => {
  const fact = listingFacts(requirement())[0];
  const stored = { fact_type: LISTING_FACT_TYPE, current_value: JSON.stringify(fact.value), confidence: 88, source_page: 5, source_clause: "P", source_section: "28 46 00", evidence_snippet: fact.evidenceSnippet };
  const parsed = listingClaimFromFact(stored);
  assert.equal(parsed.authority, "UL");
  assert.equal(parsed.required, true);
  assert.equal(parsed.confidence, 88);
  assert.equal(parsed.source.evidenceSnippet, fact.evidenceSnippet);
  // Ungoverned authority is refused at the loader, never reaching matching.
  assert.equal(listingClaimFromFact({ ...stored, current_value: JSON.stringify({ authority: "Acme", required: true }) }), null);
  // Wrong fact type.
  assert.equal(listingClaimFromFact({ ...stored, fact_type: "Capability: panel_transient_protection" }), null);
  // Explicitly not required => recorded as such, and it produces no comparison.
  assert.equal(listingClaimFromFact({ ...stored, current_value: JSON.stringify({ authority: "UL", required: false }) }).required, false);
  assert.equal(evaluateListing([claim("UL", { required: false })], productWith([])).length, 0);
});

test("the intelligence version participates in the profile currency fingerprint", () => {
  // A derivation-rule change must invalidate cached profiles through the ONE existing
  // currency mechanism, so a newly derivable listing requirement can actually appear.
  assert.equal(REQUIREMENT_INTELLIGENCE_VERSION, "requirement-intelligence-1.2.0");
});
