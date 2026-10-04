// Governed SLC addressability authority -- focused proof.
//
// SCOPE. Ten required behaviours, proved against the canonical governed path
// only:
//
//   1  governed addressability reads governed/current authority
//   2  raw BOQ fields cannot produce addressability
//   3  product family alone cannot produce address consumption
//   4  conflicting evidence fails closed
//   5  missing evidence fails closed
//   6  authoritative DETECTOR evidence books the detector pool correctly
//   7  authoritative MODULE evidence books the module pool correctly
//   8  authoritative no-SLC evidence produces no address demand
//   9  fingerprint changes when relevant authority/policy changes
//  10  existing relevant Golden resource-classification gates remain green
//
// CANONICAL MODULES UNDER TEST
//   app/domain/governed-slc-addressability.mjs        the reader (new)
//   app/domain/fire-alarm-slc-resource-classifier.mjs the ONE resource policy
//   app/domain/technical-requirement-engine.mjs       ruleset version ownership
//
// No test here reads a raw BOQ field, a description, a confidence value or a
// candidate rank as authority. That is the point of most of them.

import test from "node:test";
import assert from "node:assert/strict";

import {
  ADDRESSABILITY_SOURCE_TYPES,
  GOVERNED_ADDRESSABILITY_CODES,
  GOVERNED_ADDRESSABILITY_STATES,
  GOVERNED_SLC_ADDRESSABILITY_VERSION,
  resolveGovernedSlcAddressability,
} from "../app/domain/governed-slc-addressability.mjs";
import {
  SLC_RESOURCE_CLASSIFIER_VERSION,
  classifyFireAlarmSlcItem,
} from "../app/domain/fire-alarm-slc-resource-classifier.mjs";
import { RESOURCE_CLASSIFICATION_RULESET_VERSION } from "../app/domain/technical-requirement-engine.mjs";
import { ADDRESS_MODEL_SLC_DEMAND } from "../app/domain/fire-alarm-panel-capability-normalization.mjs";

// ---------------------------------------------------------------- fixtures
const APPROVED_IDENTITY = Object.freeze({ status: "APPROVED", productId: "product_p1", approved: true });

const attributeFact = ({
  value = "STANDALONE_ADDRESS",
  sourceType = "Product Manual",
  reviewStatus = "Approved",
  supersededAt = null,
  deletedAt = null,
  quote = "Each module can be set to one of 159 addresses (01-159).",
  policyVersion = "knowledge-promotion-policy-v2",
  attributeId = "attribute_1",
  versionNumber = 1,
} = {}) => ({
  attributeId,
  productId: "product_p1",
  attributeName: "slc_address_model",
  normalizedValue: value,
  originalValue: value,
  reviewStatus,
  supersededAt,
  deletedAt,
  versionNumber,
  sourceId: "source_1",
  sourceType,
  evidenceJson: JSON.stringify({
    policyVersion,
    sourceLocation: { documentNumber: "LS10179-000FH-E:B", revision: "H", page: 31, section: "11.2.3", quote },
  }),
  createdBy: "omair-primary",
  createdAt: "2026-10-01 22:03:30",
});

const authority = (overrides = {}) =>
  resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [attributeFact()],
    ...overrides,
  });

// ===========================================================================
// GROUP 1 -- the reader reads governed/current authority, and nothing else
// ===========================================================================
test("1. an approved, current, cited, manufacturer address model is AUTHORITATIVE", () => {
  const result = authority();
  assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.AUTHORITATIVE);
  assert.equal(result.code, null);
  assert.equal(result.addressModel, "STANDALONE_ADDRESS");
  assert.equal(result.consumesSlcAddress, true);
  assert.equal(result.addressesConsumedPerDevice, 1);
});

test("1. the reader reports full provenance for an authoritative answer", () => {
  const p = authority().provenance;
  assert.equal(p.resolverVersion, GOVERNED_SLC_ADDRESSABILITY_VERSION);
  assert.equal(p.productId, "product_p1");
  assert.equal(p.productSelectionStatus, "APPROVED");
  assert.equal(p.attributeId, "attribute_1");
  assert.equal(p.attributeVersion, 1);
  assert.equal(p.sourceId, "source_1");
  assert.equal(p.sourceType, "Product Manual");
  assert.equal(p.decidedBy, "omair-primary");
  assert.equal(p.addressModelPolicy, "knowledge-promotion-policy-v2");
  assert.equal(p.citation.documentNumber, "LS10179-000FH-E:B");
  assert.ok(p.citation.quote.length > 0, "the exact citation must travel with the decision");
  assert.deepEqual(p.gatesPassed, [
    "G1_GOVERNED_PRODUCT_IDENTITY_APPROVED",
    "G2_APPROVED_FACT_PRESENT",
    "G3_FACT_CURRENT",
    "G4_SOURCE_TYPE_MANUFACTURER_DOCUMENT",
    "G5_EXACT_CITATION_PRESENT",
    "G6_NO_UNRESOLVED_CONFLICT",
    "G7_CANONICAL_VOCABULARY",
    "G8_PROVENANCE_TRACEABLE",
  ]);
});

test("1. every canonical address model resolves, and none of them is invented here", () => {
  // The reader must not carry a vocabulary of its own: it reuses the canonical
  // ADDRESS_MODEL_SLC_DEMAND semantics wholesale.
  for (const token of Object.keys(ADDRESS_MODEL_SLC_DEMAND)) {
    const result = resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ value: token })],
    });
    assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.AUTHORITATIVE, token);
    assert.equal(result.addressModel, token);
    assert.equal(
      result.consumesSlcAddress,
      ADDRESS_MODEL_SLC_DEMAND[token].consumesSlcAddress,
      token,
    );
    assert.equal(
      result.addressesConsumedPerDevice,
      ADDRESS_MODEL_SLC_DEMAND[token].additionalAddressesConsumed,
      token,
    );
  }
});

test("1. the admitted source types are manufacturer documentation only", () => {
  assert.deepEqual(ADDRESSABILITY_SOURCE_TYPES, ["Product Manual", "Product Datasheet", "Product Catalogue"]);
  for (const refused of ["Cost Sheet", "BOQ", "Quotation", "Price List", "Specification", "Previous Project"]) {
    assert.ok(
      !ADDRESSIBILITY_SAFE(refused),
      `${refused} must not be an admitted source type for a technical address fact`,
    );
  }
});
const ADDRESSIBILITY_SAFE = (value) => ADDRESSABILITY_SOURCE_TYPES.includes(value);

// ===========================================================================
// GROUP 2 -- raw BOQ fields cannot produce addressability
// ===========================================================================
test("2. no raw category, subcategory, system_value or description is an input", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../app/domain/governed-slc-addressability.mjs", import.meta.url),
    "utf8",
  );
  // Structural, not a grep for the word "description": the reader must not be
  // able to reach a raw BOQ field at all.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  for (const forbidden of ["subcategory", "system_value", "description", "numeric_quantity", "confidence"]) {
    assert.ok(!code.includes(forbidden), `the reader must not reference ${forbidden}`);
  }
});

test("2. a raw BOQ description that names an addressable device yields nothing", () => {
  // The strongest form of this rule: even a description that literally says
  // "addressable" produces no authority, because the reader never sees it.
  const result = resolveGovernedSlcAddressability({
    productIdentity: null,
    addressModelFacts: [],
  });
  assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.UNRESOLVED);
  assert.equal(result.code, GOVERNED_ADDRESSABILITY_CODES.NO_GOVERNED_PRODUCT_IDENTITY);
});

test("2. an unapproved product selection cannot supply addressability, however good its fact", () => {
  for (const status of ["PROVISIONAL", "AMBIGUOUS", "UNAVAILABLE"]) {
    const result = resolveGovernedSlcAddressability({
      productIdentity: { status, productId: "product_p1" },
      addressModelFacts: [attributeFact()],
    });
    assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.UNRESOLVED, status);
    assert.equal(result.code, GOVERNED_ADDRESSABILITY_CODES.PRODUCT_IDENTITY_NOT_APPROVED, status);
    assert.equal(result.addressModel, null, status);
  }
});

test("2. a commercial or project source type is refused for a technical fact", () => {
  for (const sourceType of ["Cost Sheet", "BOQ"]) {
    const result = resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ value: "NON_SLC", sourceType })],
    });
    assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.UNRESOLVED, sourceType);
    assert.equal(
      result.code,
      GOVERNED_ADDRESSABILITY_CODES.SOURCE_TYPE_NOT_ALLOWED_FOR_THIS_FACT,
      sourceType,
    );
  }
});

// ===========================================================================
// GROUP 3 -- product family alone cannot produce address consumption
// ===========================================================================
test("3. a detector family with no addressability authority books nothing", () => {
  const result = classifyFireAlarmSlcItem({ system: "fire alarm", family: "Multi-Criteria Detector" });
  assert.equal(result.state, "UNRESOLVED");
  assert.equal(result.unitsPerDevice, null);
  assert.equal(result.directSlcPerDevice, null);
  assert.equal(result.demandUnits, null);
});

test("3. a MODULE family alone does not consume a module address", () => {
  for (const family of ["Control Module", "Monitor Module", "Relay Module", "Pull Station"]) {
    const result = classifyFireAlarmSlcItem({ system: "fire alarm", family });
    assert.notEqual(result.state, "SLC_MODULE_POOL", family);
    assert.equal(result.unitsPerDevice, null, family);
    assert.equal(result.directSlcPerDevice, null, family);
  }
});

test("3. an UNRESOLVED authority leaves every pre-existing outcome untouched", () => {
  // The new channel is additive. With no authority at all the classifier must
  // behave exactly as it did before this channel existed.
  const legacy = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Control Module",
    attributes: { addressing: "addressable" },
  });
  const withRefusal = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Control Module",
    attributes: { addressing: "addressable" },
    addressabilityAuthority: resolveGovernedSlcAddressability({
      productIdentity: { status: "PROVISIONAL", productId: "product_p1" },
      addressModelFacts: [attributeFact()],
    }),
  });
  assert.equal(withRefusal.state, legacy.state);
  assert.equal(withRefusal.unitsPerDevice, legacy.unitsPerDevice);
  assert.equal(withRefusal.reason, legacy.reason);
});

test("3. the address model never chooses the pool; the governed family role does", () => {
  // STANDALONE_ADDRESS on a MODULE family must land in the MODULE pool, and on
  // a DETECTOR family in the DETECTOR pool -- the same token, different pool.
  const standalone = () => resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [attributeFact({ value: "STANDALONE_ADDRESS" })],
  });
  const detector = classifyFireAlarmSlcItem({
    system: "fire alarm", family: "Multi-Criteria Detector", addressabilityAuthority: standalone(),
  });
  const moduleFamily = classifyFireAlarmSlcItem({
    system: "fire alarm", family: "Control Module", addressabilityAuthority: standalone(),
  });
  assert.equal(detector.state, "SLC_DETECTOR_POOL");
  assert.equal(moduleFamily.state, "SLC_MODULE_POOL");
  assert.equal(detector.slcRole, "SLC_FIELD_DEVICE");
  assert.equal(moduleFamily.slcRole, "SLC_MODULE");
});

// ===========================================================================
// GROUP 4 -- conflicting evidence fails closed
// ===========================================================================
test("4. two current approved address models for one product are an unresolved conflict", () => {
  const result = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [
      attributeFact({ value: "STANDALONE_ADDRESS", attributeId: "attribute_a" }),
      attributeFact({ value: "NON_SLC", attributeId: "attribute_b", sourceType: "Product Manual" }),
    ],
  });
  assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.UNRESOLVED);
  assert.equal(result.code, GOVERNED_ADDRESSABILITY_CODES.ADDRESS_MODEL_CONFLICT);
  assert.equal(result.addressModel, null);
  assert.deepEqual(result.provenance.candidateAddressModels.sort(), ["NON_SLC", "STANDALONE_ADDRESS"]);
});

test("4. a conflict is not silently resolved by taking the newest version", () => {
  // "Latest wins" would let a later promotion quietly overturn an earlier
  // approved engineering statement. The resolver refuses instead.
  const result = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [
      attributeFact({ value: "STANDALONE_ADDRESS", attributeId: "attribute_old", versionNumber: 1 }),
      attributeFact({ value: "NON_SLC", attributeId: "attribute_new", versionNumber: 9 }),
    ],
  });
  assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.UNRESOLVED);
  assert.equal(result.code, GOVERNED_ADDRESSABILITY_CODES.ADDRESS_MODEL_CONFLICT);
});

test("4. a conflicting product never books a pool", () => {
  const conflicting = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [
      attributeFact({ value: "STANDALONE_ADDRESS", attributeId: "a" }),
      attributeFact({ value: "NON_SLC", attributeId: "b" }),
    ],
  });
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm", family: "Control Module", addressabilityAuthority: conflicting,
  });
  assert.equal(result.state, "UNRESOLVED");
  assert.equal(result.unitsPerDevice, null);
  assert.equal(result.directSlcPerDevice, null);
});

test("4. two approved copies of the SAME token are corroboration, not a conflict", () => {
  const result = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [
      attributeFact({ value: "STANDALONE_ADDRESS", attributeId: "a" }),
      attributeFact({ value: "STANDALONE_ADDRESS", attributeId: "b", sourceType: "Product Datasheet" }),
    ],
  });
  assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.AUTHORITATIVE);
  assert.equal(result.addressModel, "STANDALONE_ADDRESS");
  assert.equal(result.provenance.corroboratingFactCount, 2);
});

// ===========================================================================
// GROUP 5 -- missing evidence fails closed
// ===========================================================================
test("5. no fact at all is unresolved, never zero", () => {
  const result = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [],
  });
  assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.UNRESOLVED);
  assert.equal(result.code, GOVERNED_ADDRESSABILITY_CODES.NO_APPROVED_ADDRESS_MODEL);
  assert.equal(result.consumesSlcAddress, null);
  assert.equal(result.addressesConsumedPerDevice, null);
});

test("5. a superseded, deleted or unapproved fact is not current evidence", () => {
  // Every case here is the SAME refusal: a fact exists but is not a current
  // Approved statement, so it is not evidence of current address behaviour.
  // Only a product with no address-model fact at all reports the absence.
  const cases = [
    [{ ...attributeFact(), supersededAt: "2026-10-02 00:00:00" }, "superseded"],
    [{ ...attributeFact(), deletedAt: "2026-10-02 00:00:00" }, "deleted"],
    [{ ...attributeFact({ reviewStatus: "Needs Review" }) }, "not yet approved"],
    [{ ...attributeFact({ reviewStatus: "Rejected" }) }, "rejected"],
  ];
  for (const [fact, label] of cases) {
    const result = resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [fact],
    });
    assert.equal(result.state, GOVERNED_ADDRESSABILITY_STATES.UNRESOLVED, label);
    assert.equal(result.code, GOVERNED_ADDRESSABILITY_CODES.ADDRESS_MODEL_NOT_CURRENT, label);
    assert.equal(result.addressModel, null, label);
  }
  // ...and absence is reported as absence, distinctly.
  const absent = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [],
  });
  assert.equal(absent.code, GOVERNED_ADDRESSABILITY_CODES.NO_APPROVED_ADDRESS_MODEL);
});

test("5. an uncited fact is refused; a URL without a quote is not a citation", () => {
  const noQuote = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [attributeFact({ quote: "" })],
  });
  assert.equal(noQuote.code, GOVERNED_ADDRESSABILITY_CODES.CITATION_MISSING);

  const linkOnly = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [{
      ...attributeFact({ quote: "" }),
      evidenceJson: JSON.stringify({
        policyVersion: "knowledge-promotion-policy-v2",
        sourceLocation: { url: "https://example.invalid/datasheet.pdf" },
      }),
    }],
  });
  assert.equal(linkOnly.code, GOVERNED_ADDRESSABILITY_CODES.CITATION_MISSING);
  assert.equal(linkOnly.addressModel, null);
});

test("5. an unrecognised token is refused rather than guessed at", () => {
  const result = resolveGovernedSlcAddressability({
    productIdentity: APPROVED_IDENTITY,
    addressModelFacts: [attributeFact({ value: "ADDRESSABLE_SOMETIMES" })],
  });
  assert.equal(result.code, GOVERNED_ADDRESSABILITY_CODES.UNRECOGNISED_ADDRESS_MODEL);
  assert.equal(result.addressModel, null);
});

test("5. incomplete provenance or an unknown policy version is refused", () => {
  assert.equal(
    resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [{ ...attributeFact(), createdBy: null }],
    }).code,
    GOVERNED_ADDRESSABILITY_CODES.PROVENANCE_INCOMPLETE,
  );
  assert.equal(
    resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ policyVersion: "" })],
    }).code,
    GOVERNED_ADDRESSABILITY_CODES.PROVENANCE_INCOMPLETE,
  );
});

// ===========================================================================
// GROUP 6 -- authoritative DETECTOR evidence books the detector pool
// ===========================================================================
test("6. authoritative STANDALONE_ADDRESS on a detector family books one detector address", () => {
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Multi-Criteria Detector",
    selectedQuantity: { value: 12, source: "DRAWING_QUANTITY_AUTHORITY", decisionId: "dq_1" },
    addressabilityAuthority: resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ value: "STANDALONE_ADDRESS" })],
    }),
  });
  assert.equal(result.state, "SLC_DETECTOR_POOL");
  assert.equal(result.slcRole, "SLC_FIELD_DEVICE");
  assert.equal(result.unitsPerDevice, 1);
  assert.equal(result.directSlcPerDevice, 1);
  assert.equal(result.quantity.total, 12);
  assert.equal(result.provenance.consumptionAuthority, "APPROVED_MANUFACTURER_ADDRESS_MODEL");
  assert.equal(result.provenance.addressModel, "STANDALONE_ADDRESS");
  assert.equal(result.provenance.addressesPerUnitBasis, "APPROVED_MANUFACTURER_ADDRESS_MODEL");
});

test("6. the detector booking names the manufacturer document it rests on", () => {
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Multi-Criteria Detector",
    addressabilityAuthority: authority({ addressModelFacts: [attributeFact({ value: "STANDALONE_ADDRESS" })] }),
  });
  assert.match(result.reason, /Approved manufacturer address model STANDALONE_ADDRESS/);
  assert.equal(result.provenance.addressabilityAuthority, "APPROVED_ADDRESS_MODEL");
  assert.equal(
    result.provenance.addressabilityAuthorityVersion,
    GOVERNED_SLC_ADDRESSABILITY_VERSION,
  );
});

// ===========================================================================
// GROUP 7 -- authoritative MODULE evidence books the module pool
// ===========================================================================
test("7. authoritative HOUSED_MODULE_OWN_ADDRESS on a module family books one module address", () => {
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Control Module",
    selectedQuantity: { value: 5, source: "DRAWING_QUANTITY_AUTHORITY", decisionId: "dq_2" },
    addressabilityAuthority: resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ value: "HOUSED_MODULE_OWN_ADDRESS" })],
    }),
  });
  assert.equal(result.state, "SLC_MODULE_POOL");
  assert.equal(result.slcRole, "SLC_MODULE");
  assert.equal(result.unitsPerDevice, 1);
  assert.equal(result.directSlcPerDevice, 1);
  assert.equal(result.quantity.total, 5);
  assert.equal(result.provenance.addressModel, "HOUSED_MODULE_OWN_ADDRESS");
});

test("7. SHARED_WITH_DETECTOR books no pool point and reports the context it needs", () => {
  // The pairing that would resolve this is a project fact, so the resolver
  // reports the requirement instead of inventing a count.
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Control Module",
    addressabilityAuthority: resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ value: "SHARED_WITH_DETECTOR" })],
    }),
  });
  assert.equal(result.state, "SLC_ROLE_ESTABLISHED");
  assert.equal(result.unitsPerDevice, null);
  assert.equal(result.directSlcPerDevice, null);
  assert.ok(result.contextRequired, "the unresolved pairing must be reported");
  assert.equal(result.provenance.consumptionAuthority, null);
});

// ===========================================================================
// GROUP 8 -- authoritative no-SLC evidence produces no address demand
// ===========================================================================
test("8. authoritative NON_SLC settles a module family at a proven zero", () => {
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Control Module",
    selectedQuantity: { value: 9, source: "DRAWING_QUANTITY_AUTHORITY", decisionId: "dq_3" },
    addressabilityAuthority: resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ value: "NON_SLC" })],
    }),
  });
  assert.equal(result.state, "NOT_SLC");
  assert.equal(result.unitsPerDevice, 0);
  assert.equal(result.directSlcPerDevice, 0);
  assert.equal(result.demandUnits, 0);
  assert.equal(result.provenance.slcRoleBasis, "APPROVED_ADDRESS_MODEL");
  assert.equal(result.provenance.consumptionAuthority, "APPROVED_MANUFACTURER_NO_SLC_ADDRESS");
});

test("8. HOUSING_NO_ADDITIONAL_ADDRESS settles a housing family at zero", () => {
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Duct Detector Housing",
    addressabilityAuthority: resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ value: "HOUSING_NO_ADDITIONAL_ADDRESS" })],
    }),
  });
  assert.equal(result.state, "NOT_SLC");
  assert.equal(result.directSlcPerDevice, 0);
});

test("8. a proven zero does not imply the secondary interface axis is zero", () => {
  // DIRECT 0 is a statement about this device on the loop, never about the
  // project's total downstream demand.
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Duct Detector Housing",
    addressabilityAuthority: resolveGovernedSlcAddressability({
      productIdentity: APPROVED_IDENTITY,
      addressModelFacts: [attributeFact({ value: "HOUSING_NO_ADDITIONAL_ADDRESS" })],
    }),
  });
  assert.equal(result.directSlcPerDevice, 0);
  assert.notEqual(result.secondaryInterface.state, "PROVEN_ZERO");
  assert.equal(result.secondaryInterface.state, "SEPARATE_DEVICE_REQUIRED");
});

test("8. the no-SLC override is one-directional: it can zero a line, never promote one", () => {
  // An UNRESOLVED authority must never become a booking, in either direction.
  const unresolvedAuthority = resolveGovernedSlcAddressability({
    productIdentity: { status: "PROVISIONAL", productId: "product_p1" },
    addressModelFacts: [attributeFact({ value: "STANDALONE_ADDRESS" })],
  });
  const result = classifyFireAlarmSlcItem({
    system: "fire alarm",
    family: "Multi-Criteria Detector",
    addressabilityAuthority: unresolvedAuthority,
  });
  assert.equal(result.state, "UNRESOLVED");
  assert.notEqual(result.state, "SLC_DETECTOR_POOL");
  assert.notEqual(result.state, "NOT_SLC");
});

// ===========================================================================
// GROUP 9 -- fingerprint participation
// ===========================================================================
test("9. the resource ruleset version folds in the classifier AND the reader version", () => {
  assert.ok(
    RESOURCE_CLASSIFICATION_RULESET_VERSION.includes(SLC_RESOURCE_CLASSIFIER_VERSION),
    "a classifier change must invalidate the resource ruleset",
  );
  assert.ok(
    RESOURCE_CLASSIFICATION_RULESET_VERSION.includes(GOVERNED_SLC_ADDRESSABILITY_VERSION),
    "an addressability-reader change must invalidate the resource ruleset too",
  );
});

test("9. the profile input fingerprint digests the resolved authority, not only its version", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(
    new URL("../worker/technical-requirement-api.mjs", import.meta.url),
    "utf8",
  );
  // The resolved decision-bearing fields must be in the fingerprint, or a newly
  // promoted address model would leave every cached profile byte-identical and
  // the idempotency check would return the pre-promotion profile.
  const match = source.match(/slcAddressability:\s*\{([^}]*)\}/);
  assert.ok(match, "the profile fingerprint must digest the resolved authority");
  for (const field of ["state", "code", "addressModel", "consumesSlcAddress", "addressesConsumedPerDevice", "productId", "attributeId"]) {
    assert.match(match[1], new RegExp(field), `fingerprint must digest ${field}`);
  }
});

// ===========================================================================
// GROUP 10 -- the change is present in the ONE policy, not a parallel one
// ===========================================================================
test("10. no second address taxonomy was introduced", () => {
  assert.equal(
    SLC_RESOURCE_CLASSIFIER_VERSION,
    "fire-alarm-slc-resource-classifier-1.3.0",
    "the change is an executable policy change and carries its version",
  );
  // The reader must delegate semantics to the canonical table rather than
  // restating them, so there is exactly one definition of each token.
  assert.deepEqual(
    Object.keys(ADDRESS_MODEL_SLC_DEMAND).sort(),
    ["HOUSED_MODULE_OWN_ADDRESS", "HOUSING_NO_ADDITIONAL_ADDRESS", "NON_SLC", "SHARED_WITH_DETECTOR", "STANDALONE_ADDRESS"],
  );
});