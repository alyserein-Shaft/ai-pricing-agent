import test from "node:test";
import assert from "node:assert/strict";
import { compareAttribute, generateCandidates, runProductMatching } from "../app/domain/product-matching-engine.mjs";

const profile = (overrides = {}) => ({ versionNumber: 1, boqItem: { id: "boq-1", description: "Addressable smoke detector", system: "Fire Alarm", category: "Detection Device", productFamily: "Addressable Smoke Detector" }, readiness: { status: "Ready for Matching", blockingReasons: [] }, consolidatedRequirements: [{ id: "r-voltage", normalizedRequirement: "24 V operation", priority: "Critical Mandatory", attributes: [{ name: "Voltage", operator: "Equal", normalizedValue: 24, normalizedUnit: "V" }] }], standards: [{ body: "EN54", number: "7" }], manufacturers: [], compatibility: [{ targetItem: "Farenhyt protocol" }], accessories: [{ accessory: "Detector base" }], derivedRequirements: [], clarifications: [], ...overrides });
const product = (overrides = {}) => ({ id: "p1", manufacturer: "Honeywell", family: "Addressable Smoke Detector", partNumber: "IDP-PHOTO-W", description: "Addressable photoelectric smoke detector", lifecycleStatus: "Active", reviewStatus: "Reviewed", attributes: [{ name: "Voltage", normalizedValue: 24, normalizedUnit: "V" }], standards: [{ body: "EN54", number: "7", evidence: { documentId: "d1" } }], compatibility: [{ targetItem: "Farenhyt protocol", relationshipType: "Compatible With" }], accessories: [{ name: "Detector base" }], source: { sheet: "Catalogue", row: 12 }, ...overrides });

test("compares numeric requirements with canonical unit conversion", () => { const result = compareAttribute({ name: "Power", operator: "Minimum", value: 1, unit: "kW" }, { name: "Power", value: 1200, unit: "W" }); assert.equal(result.result, "Pass"); assert.equal(result.conversion.product.normalizedValue, 1.2); });
test("exact identity search is staged ahead of structured discovery", () => { const exactProfile = profile({ boqItem: { ...profile().boqItem, partNumber: "IDP-PHOTO-W" } }); const result = generateCandidates({ profile: exactProfile, products: [product(), product({ id: "p2", partNumber: "OTHER" })] }); assert.equal(result.candidates[0].stage, "Exact Identity"); assert.deepEqual(result.candidates[0].basis, ["Exact Part Number"]); });
test("mandatory technical failure overrides commercial availability", () => { const result = runProductMatching({ profile: profile(), products: [product({ attributes: [{ name: "Voltage", normalizedValue: 12, normalizedUnit: "V" }] })], prices: [{ productId: "p1", approvalStatus: "Approved", downstreamUse: "Costing", validUntil: "2099-01-01" }] }); assert.equal(result.candidates[0].technicalStatus, "Non-Compliant"); assert.equal(result.candidates[0].recommendationTier, "Rejected Candidate"); assert.equal(result.candidates[0].components.mandatoryCompliance, 0); assert.equal(result.noMatch.reason.includes("mandatory"), true); });
test("missing certification and compatibility cannot produce high confidence", () => { const result = runProductMatching({ profile: profile(), products: [product({ standards: [], compatibility: [] })] }); assert.ok(result.candidates[0].mandatoryFailures.length >= 2); assert.notEqual(result.candidates[0].confidence, "High Confidence"); assert.equal(result.candidates[0].approvalReady, false); });
test("an unstructured mandatory statement fails closed as missing product evidence", () => { const result = runProductMatching({ profile: profile({ consolidatedRequirements: [{ id: "r-text", normalizedRequirement: "Device shall be authority approved", priority: "Mandatory", attributes: [] }], standards: [], compatibility: [], accessories: [] }), products: [product()] }); assert.equal(result.candidates[0].technicalStatus, "Non-Compliant"); assert.ok(result.candidates[0].comparisons.some((entry) => entry.result === "Missing Product Data")); });
test("a compliant candidate is ranked with decomposable scoring and explanation", () => { const result = runProductMatching({ profile: profile(), products: [product()] }); const candidate = result.candidates[0]; assert.equal(candidate.technicalStatus, "Technically Compliant"); assert.equal(candidate.recommendationTier, "Recommended Candidate"); assert.equal(candidate.rank, 1); assert.ok(candidate.components.mandatoryCompliance > 0); assert.match(candidate.explanation, /Commercial state/); assert.equal(candidate.approvalReady, false); });
test("a classified but technically unready item remains discovery-only", () => { const result = runProductMatching({ profile: profile({ readiness: { status: "Missing Critical Information", blockingReasons: ["Compatibility target missing"] } }), products: [product()] }); assert.equal(result.status, "Discovery Only"); assert.equal(result.candidates[0].recommendationTier, "Discovery Candidate"); assert.equal(result.candidates[0].approvalReady, false); });
test("an unclassified item cannot enter product discovery", () => { const result = runProductMatching({ profile: profile({ boqItem: { description: "Unclassified equipment" }, readiness: { status: "Classification Required", blockingReasons: ["Discipline missing"] } }), products: [product()] }); assert.equal(result.status, "Not Ready"); assert.equal(result.candidates.length, 0); assert.deepEqual(result.noMatch.blockers, ["Discipline missing"]); });
test("semantic-only discovery cannot become recommended", () => { const discoveryProduct = product({ family: "Other", category: "Other", compatibility: [], description: "Addressable smoke detector device" }); const result = runProductMatching({ profile: profile({ compatibility: [] }), products: [discoveryProduct] }); assert.equal(result.candidates[0].recommendationTier, "Discovery Candidate"); assert.equal(result.candidates[0].confidence, "Discovery Only"); });
test("manufacturer model stage is not capped at the discovery-tier ceiling", () => { const modelProfile = profile({ boqItem: { ...profile().boqItem, manufacturer: "Honeywell", partNumber: "IDP-PHOTO" } }); const result = runProductMatching({ profile: modelProfile, products: [product({ partNumber: "IDP-PHOTO-W" })] }); const candidate = result.candidates[0]; assert.equal(candidate.searchStage, "Manufacturer Model"); assert.ok(candidate.confidenceScore > 85, `expected confidenceScore above the old default ceiling of 49 (and above Structured's 85), got ${candidate.confidenceScore}`); assert.notEqual(candidate.confidence, "Discovery Only"); assert.notEqual(candidate.confidence, "Low Confidence"); });
test("manufacturer family stage is not capped at the discovery-tier ceiling and stays below manufacturer model", () => { const familyProfile = profile({ boqItem: { ...profile().boqItem, manufacturer: "Honeywell", partNumber: undefined } }); const result = runProductMatching({ profile: familyProfile, products: [product()] }); const candidate = result.candidates[0]; assert.equal(candidate.searchStage, "Manufacturer Family"); assert.ok(candidate.confidenceScore > 49, `expected confidenceScore above the old default ceiling of 49, got ${candidate.confidenceScore}`); assert.ok(candidate.confidenceScore <= 88, `Manufacturer Family ceiling must not exceed 88, got ${candidate.confidenceScore}`); assert.notEqual(candidate.confidence, "Discovery Only"); });
test("stage confidence ceilings remain monotonic: Exact Identity >= Manufacturer Model >= Manufacturer Family >= Structured", () => { const exact = runProductMatching({ profile: profile({ boqItem: { ...profile().boqItem, partNumber: "IDP-PHOTO-W" } }), products: [product()] }).candidates[0]; const model = runProductMatching({ profile: profile({ boqItem: { ...profile().boqItem, manufacturer: "Honeywell", partNumber: "IDP-PHOTO" } }), products: [product({ partNumber: "IDP-PHOTO-W" })] }).candidates[0]; const family = runProductMatching({ profile: profile({ boqItem: { ...profile().boqItem, manufacturer: "Honeywell", partNumber: undefined } }), products: [product()] }).candidates[0]; const structured = runProductMatching({ profile: profile(), products: [product()] }).candidates[0]; assert.ok(exact.confidenceScore >= model.confidenceScore, `Exact Identity (${exact.confidenceScore}) should be >= Manufacturer Model (${model.confidenceScore})`); assert.ok(model.confidenceScore >= family.confidenceScore, `Manufacturer Model (${model.confidenceScore}) should be >= Manufacturer Family (${family.confidenceScore})`); assert.ok(family.confidenceScore >= structured.confidenceScore, `Manufacturer Family (${family.confidenceScore}) should be >= Structured (${structured.confidenceScore})`); });

test("an empty product family does not satisfy a family match", () => { const unrelated = product({ family: "", category: undefined, compatibility: [], description: "Completely unrelated widget xyz" }); const result = generateCandidates({ profile: profile(), products: [unrelated] }); assert.equal(result.candidates.length, 0, "a product with no family must not be returned as a Structured candidate merely because scope.productFamily is set"); });
test("a null product family does not satisfy a family match", () => { const unrelated = product({ family: null, category: undefined, compatibility: [], description: "Completely unrelated widget xyz" }); const result = generateCandidates({ profile: profile(), products: [unrelated] }); assert.equal(result.candidates.length, 0, "a product with a null family must not be returned as a Structured candidate merely because scope.productFamily is set"); });
// Sprint 8 -- recall fix: a product with no family/category classification
// but a REAL, approved compatibility relationship pointing at what the
// requirement profile's own confirmed evidence names must still be
// retrievable -- this is evidence-backed, not a guess, and must not be
// crowded out by the flat top-10 cap the way weak Semantic Discovery token
// matches can be.
test("missing family/category classification is rescued by matching compatibility evidence, not by manufacturer or part number alone", () => { const unclassified = product({ family: null, category: undefined, description: "Completely unrelated widget xyz", compatibility: [{ targetItem: "Farenhyt protocol", relationshipType: "Compatible With" }] }); const result = generateCandidates({ profile: profile(), products: [unclassified] }); assert.equal(result.candidates.length, 1); assert.equal(result.candidates[0].stage, "Compatibility Evidence"); assert.equal(result.candidates[0].searchScore, 75); assert.deepEqual(result.candidates[0].basis, ["Compatibility Evidence"]); });
test("compatibility-evidence recall stays below an exact family match and above a bare category match", () => { const exactFamily = generateCandidates({ profile: profile(), products: [product()] }).candidates[0]; const compatOnly = generateCandidates({ profile: profile(), products: [product({ family: null, category: undefined })] }).candidates[0]; const categoryOnly = generateCandidates({ profile: profile(), products: [product({ family: "Unrelated Family", category: "Detection Device", compatibility: [] })] }).candidates[0]; assert.equal(exactFamily.stage, "Structured"); assert.equal(compatOnly.stage, "Compatibility Evidence"); assert.equal(categoryOnly.stage, "Structured"); assert.ok(exactFamily.searchScore > compatOnly.searchScore); assert.ok(compatOnly.searchScore > categoryOnly.searchScore); });
test("compatibility evidence with no matching target never rescues an unrelated, unclassified product", () => { const unrelated = product({ family: null, category: undefined, description: "Completely unrelated widget xyz", compatibility: [{ targetItem: "Some other panel entirely", relationshipType: "Compatible With" }] }); const result = generateCandidates({ profile: profile(), products: [unrelated] }); assert.equal(result.candidates.length, 0, "compatibility evidence must only rescue a candidate when its target matches the requirement's own evidence, never merely because the product has *some* compatibility relationship"); });
// Sprint 8 -- precision guard: a product that IS already classified into a
// genuinely different family must never be pulled into an unrelated item's
// candidate pool merely because it happens to share the same compatibility
// target (e.g. the same FACP) -- this is the flooding failure mode the
// unclassified-only gate exists to prevent (real regression found while
// proving item 34/Manual Call Point recall: a smoke detector was being
// recalled as a candidate purely because both it and the pull station cite
// "the control unit").
test("compatibility evidence never rescues a product that is already classified into a different, unrelated family", () => { const classifiedButDifferentFamily = product({ family: "Addressable Smoke Detector", category: "Detection Devices", description: "Addressable photoelectric smoke detector", compatibility: [{ targetItem: "Farenhyt protocol", relationshipType: "Compatible With" }] }); const mclpProfile = profile({ boqItem: { ...profile().boqItem, description: "Manual call point breakglass station", productFamily: "Pull Station", category: "Manual Initiation" } }); const result = generateCandidates({ profile: mclpProfile, products: [classifiedButDifferentFamily] }); assert.equal(result.candidates.length, 0, "a classified product's genuine family mismatch is a correct exclusion, not a data gap -- compatibility evidence must not override it"); });
test("exact normalized family equality still matches", () => { const result = generateCandidates({ profile: profile(), products: [product()] }); assert.equal(result.candidates[0].stage, "Structured"); assert.equal(result.candidates[0].searchScore, 80); });
test("legitimate non-empty family containment still matches", () => { const narrowScope = profile({ boqItem: { ...profile().boqItem, productFamily: "Smoke Detector" } }); const broaderProductFamily = product({ family: "Addressable Smoke Detector" }); const result = generateCandidates({ profile: narrowScope, products: [broaderProductFamily] }); assert.equal(result.candidates[0].stage, "Structured", "a non-empty scope family that is a substring of a non-empty product family must still match"); });

// Sprint 1.23 -- real Opera family-precision bug: a bare "Strobe" family
// product must never tie an exact "Speaker/Strobe" (or "Sounder/Strobe")
// family match merely because "strobe" is a substring of the compound name.
// Exact governed family equality must outrank a partial/substring family
// relationship, and a partial family relationship must itself score below
// even a bare category match -- it is real but weak evidence, nothing more.
test("a bare Strobe family does not tie an exact Speaker/Strobe family match -- exact family equality outranks substring containment", () => {
  const notificationScope = profile({ boqItem: { ...profile().boqItem, category: "Notification Devices", productFamily: "Speaker/Strobe" } });
  const exactMatch = generateCandidates({ profile: notificationScope, products: [product({ id: "p-exact", family: "Speaker/Strobe", category: "Notification Devices" })] }).candidates[0];
  const bareStrobeSameCategory = generateCandidates({ profile: notificationScope, products: [product({ id: "p-bare-cat", family: "Strobe", category: "Notification Devices" })] }).candidates[0];
  const bareStrobeNoCategory = generateCandidates({ profile: notificationScope, products: [product({ id: "p-bare-nocat", family: "Strobe", category: "Other Devices" })] }).candidates[0];
  assert.equal(exactMatch.stage, "Structured"); assert.equal(exactMatch.searchScore, 80);
  assert.equal(bareStrobeSameCategory.stage, "Structured"); assert.equal(bareStrobeSameCategory.searchScore, 65, "a same-category bare Strobe product must fall back to the category tier, not tie the exact family tier");
  assert.equal(bareStrobeNoCategory.stage, "Structured"); assert.equal(bareStrobeNoCategory.searchScore, 55, "a bare Strobe product with no matching category must still be retrievable via partial family containment, but strictly below the category tier");
  assert.ok(exactMatch.searchScore > bareStrobeSameCategory.searchScore);
  assert.ok(bareStrobeSameCategory.searchScore > bareStrobeNoCategory.searchScore);
});

test("compareAttribute accepts canonical Equals operator", () => {
  const result = compareAttribute(
    {
      name: "Voltage",
      operator: "Equals",
      value: 24,
      unit: "V",
    },
    {
      name: "Voltage",
      originalValue: "24 V DC",
      normalizedValue: 24,
      normalizedUnit: "V",
    },
  );

  assert.equal(result.pass, true);
  assert.equal(result.result, "Pass");
  assert.equal(result.blocking, false);
  assert.equal(result.difference, 0);
});

// Sprint 9 -- "provide initiating devices and notification appliances made by
// the same manufacturer" is a cross-item project consistency rule, not an
// approved-manufacturer-list rule. No single candidate can prove consistency
// against OTHER items' eventual selections, but a candidate with one clear,
// resolvable manufacturer identity (via the same canonical manufacturer
// module used elsewhere) genuinely CAN participate in an all-one-manufacturer
// selection -- that must not fall through to the generic "Missing Product
// Data" unstructured-requirement gate forever.
const manufacturerConsistencyRequirement = (overrides = {}) => ({ id: "r-mfr-consistency", normalizedRequirement: "provide initiating devices and notification appliances made by the same manufacturer", requirementCategory: "Manufacturer", priority: "Mandatory", attributes: [], manufacturers: [], ...overrides });
test("a manufacturer-consistency requirement (no named manufacturer) resolves for a candidate with a clear canonical manufacturer identity, not as a generic missing-data block", () => {
  const result = runProductMatching({ profile: profile({ consolidatedRequirements: [manufacturerConsistencyRequirement()], standards: [], compatibility: [], accessories: [] }), products: [product({ standards: [], compatibility: [], accessories: [] })] });
  const candidate = result.candidates[0];
  assert.ok(candidate.comparisons.some((entry) => entry.comparisonType === "Manufacturer Consistency" && entry.pass), "expected a passing Manufacturer Consistency comparison");
  assert.equal(candidate.comparisons.some((entry) => entry.comparisonType === "Technical Requirement" && entry.requirement?.id === "r-mfr-consistency"), false, "must not also fall through to the generic unstructured Missing Product Data gate");
  assert.equal(candidate.mandatoryFailures.some((entry) => entry.requirement?.id === "r-mfr-consistency"), false);
});
test("a manufacturer-consistency requirement still blocks a candidate with no resolvable manufacturer", () => {
  const result = runProductMatching({ profile: profile({ consolidatedRequirements: [manufacturerConsistencyRequirement()], standards: [], compatibility: [], accessories: [] }), products: [product({ manufacturer: "", standards: [], compatibility: [], accessories: [] })] });
  const candidate = result.candidates[0];
  const consistency = candidate.comparisons.find((entry) => entry.comparisonType === "Manufacturer Consistency");
  assert.ok(consistency, "expected a Manufacturer Consistency comparison to be present");
  assert.equal(consistency.pass, false);
  assert.equal(consistency.blocking, true);
  assert.equal(candidate.technicalStatus, "Non-Compliant");
});
test("a manufacturer requirement that DOES name a specific required manufacturer is not treated as a self-consistency rule", () => {
  const result = runProductMatching({ profile: profile({ consolidatedRequirements: [manufacturerConsistencyRequirement({ id: "r-mfr-named", manufacturers: [{ manufacturer: "Siemens", status: "Approved" }] })], manufacturers: [{ manufacturer: "Siemens", status: "Approved" }], standards: [], compatibility: [], accessories: [] }), products: [product({ manufacturer: "Honeywell", standards: [], compatibility: [], accessories: [] })] });
  const candidate = result.candidates[0];
  assert.equal(candidate.comparisons.some((entry) => entry.comparisonType === "Manufacturer Consistency"), false, "a requirement naming a specific manufacturer must keep going through evaluateManufacturer, not the consistency path");
  assert.equal(candidate.manufacturer.pass, false, "the approved-manufacturer-list gate (Siemens required, Honeywell offered) must still block as before");
});

// Sprint 10 -- a "Standard" citation with no real, citable number (just the
// placeholder word "Standard" itself, an extraction artifact) is not a
// certifiable manufacturer listing and must not block forever; a genuine
// citation like UL 268 must still block exactly as before.
test("a Standard citation with a placeholder number (no real identifier) is excluded from the Standard gate, but a genuine numbered citation still blocks", () => {
  const malformed = runProductMatching({ profile: profile({ standards: [{ body: "IEEE", number: "Standard", part: null }], compatibility: [], accessories: [] }), products: [product({ standards: [], compatibility: [], accessories: [] })] });
  assert.equal(malformed.candidates[0].comparisons.some((entry) => entry.comparisonType === "Standard"), false, "a placeholder-number citation must not appear as a Standard comparison at all");
  assert.equal(malformed.candidates[0].mandatoryFailures.some((entry) => entry.comparisonType === "Standard"), false);
  const genuine = runProductMatching({ profile: profile({ standards: [{ body: "UL", number: "268" }], compatibility: [], accessories: [] }), products: [product({ standards: [], compatibility: [], accessories: [] })] });
  assert.equal(genuine.candidates[0].mandatoryFailures.some((entry) => entry.comparisonType === "Standard"), true, "a real, numbered standard citation must still block when unmet");
});
// Sprint 10 -- a compatibility target that is itself a bare standard
// citation ("IEEE Standard 802...") leaked from the same mis-extraction is
// excluded from the Compatibility gate; a genuine target naming a real
// thing (e.g. "the control unit") must still block exactly as before.
test("a compatibility target that is itself a leaked standard citation is excluded from the Compatibility gate, but a genuine target still blocks", () => {
  const malformed = runProductMatching({ profile: profile({ standards: [], compatibility: [{ targetItem: "IEEE Standard 802" }], accessories: [] }), products: [product({ standards: [], compatibility: [], accessories: [] })] });
  assert.equal(malformed.candidates[0].comparisons.some((entry) => entry.comparisonType === "Compatibility"), false, "a leaked standard-citation target must not appear as a Compatibility comparison at all");
  const genuine = runProductMatching({ profile: profile({ standards: [], compatibility: [{ targetItem: "the control unit" }], accessories: [] }), products: [product({ standards: [], compatibility: [], accessories: [] })] });
  assert.equal(genuine.candidates[0].mandatoryFailures.some((entry) => entry.comparisonType === "Compatibility"), true, "a real compatibility target must still block when unmet");
});
// Sprint 10 -- the derived "compatible detector base" requirement names a
// generic role, not a specific product name, so it can never match by name
// alone. An already-approved "Compatible Base" product_accessories
// relationship (surfaced as accessory.relationshipType) proves the
// requirement without needing an exact name match. This must never rescue a
// DIFFERENT accessory requirement (e.g. a sounder base) that simply has no
// matching evidence, and must never rescue the detector-base rule from a
// relationship of a different type (e.g. "Sounding Base").
const detectorBaseRequirement = (overrides = {}) => ({ id: "derived:boq-1:detector-base", statement: "A compatible detector base is required for each detector unless the approved product includes one.", ruleId: "accessory.detector-base", output: { accessory: "Compatible detector base" }, ...overrides });
test("an already-approved Compatible Base relationship satisfies the detector-base accessory rule even though its name does not match the generic role label", () => {
  const result = runProductMatching({ profile: profile({ standards: [], compatibility: [], accessories: [detectorBaseRequirement()] }), products: [product({ standards: [], compatibility: [], accessories: [{ name: "B501-IV", relationshipType: "Compatible Base" }] })] });
  const accessory = result.candidates[0].comparisons.find((entry) => entry.comparisonType === "Accessory");
  assert.equal(accessory.pass, true);
  assert.equal(accessory.result, "Pass");
});
test("the Compatible Base rescue never applies to an unrelated accessory requirement with no matching relationship type", () => {
  const result = runProductMatching({ profile: profile({ standards: [], compatibility: [], accessories: [{ accessory: "Sounder Base", statement: "A sounder base is required." }] }), products: [product({ standards: [], compatibility: [], accessories: [{ name: "B501-IV", relationshipType: "Compatible Base" }] })] });
  const accessory = result.candidates[0].comparisons.find((entry) => entry.comparisonType === "Accessory");
  assert.equal(accessory.pass, false, "a Compatible Base relationship must not satisfy a differently-named accessory requirement that isn't the detector-base rule");
});
test("the detector-base rule is not satisfied by a relationship of a different type", () => {
  const result = runProductMatching({ profile: profile({ standards: [], compatibility: [], accessories: [detectorBaseRequirement()] }), products: [product({ standards: [], compatibility: [], accessories: [{ name: "B200S-IV", relationshipType: "Sounding Base" }] })] });
  const accessory = result.candidates[0].comparisons.find((entry) => entry.comparisonType === "Accessory");
  assert.equal(accessory.pass, false, "a Sounding Base relationship must not satisfy the detector-base rule");
});

// Fire Alarm E2E fix (candidate discrimination) -- real Central Kitchen -
// Makkah gap: a same-family catalog larger than the top-10 retrieval cap
// (e.g. this project's own 33-SKU Sounder/Strobe family) could tie-break
// purely on an arbitrary product.id string comparison, losing the one real
// candidate whose OWN recorded attribute already agrees with a structured
// fact already known from the BOQ (e.g. indoor_outdoor="Outdoor" from an
// "IP-65" BOQ line) before it ever reached attribute-level evaluation.
test("an attribute-aligned candidate wins the top-10 retrieval tie-break over a same-stage candidate with no matching attribute, and over one that actively conflicts", () => {
  const requirementProfile = profile({ boqItem: { ...profile().boqItem, productFamily: "Sounder/Strobe", attributes: { indoor_outdoor: "Outdoor" } } });
  const aligned = product({ id: "outdoor-1", partNumber: "OUT-1", family: "Sounder/Strobe", attributes: [{ name: "indoor_outdoor", value: "Outdoor (weatherproof, NEMA 4X/IP56)", origin: "EXTRACTED", confidence: 90 }] });
  const conflicting = product({ id: "aaa-indoor", partNumber: "IND-1", family: "Sounder/Strobe", attributes: [{ name: "indoor_outdoor", value: "Indoor", origin: "EXTRACTED", confidence: 90 }] });
  const noEvidence = product({ id: "zzz-unknown", partNumber: "UNK-1", family: "Sounder/Strobe", attributes: [] });
  const result = generateCandidates({ profile: requirementProfile, products: [conflicting, noEvidence, aligned] });
  assert.equal(result.candidates[0].product.partNumber, "OUT-1", "the Outdoor-attributed candidate must win the tie-break even though its product.id sorts after the others alphabetically");
});
test("structured attribute alignment never lets a wrong-family candidate outrank the requirement's own family, and never boosts a wrong-family candidate's evidence at evaluation time", () => {
  const requirementProfile = profile({ boqItem: { ...profile().boqItem, productFamily: "Annunciator", attributes: { addressing: "Addressable" } } });
  const rightFamilyNoEvidence = product({ id: "right-1", partNumber: "ANN-1", family: "Annunciator", category: "Control Equipment", attributes: [] });
  const wrongFamilyWithEvidence = product({ id: "wrong-1", partNumber: "PANEL-1", family: "Fire Alarm Control Panel", category: "Control Equipment", attributes: [{ name: "addressing", value: "Addressable", origin: "EXTRACTED", confidence: 90 }] });
  const result = runProductMatching({ profile: requirementProfile, products: [wrongFamilyWithEvidence, rightFamilyNoEvidence], prices: [] });
  assert.equal(result.candidates[0].product.partNumber, "ANN-1", "the correct family's own candidate must not be outranked by a different, already-classified family merely because it happens to share an unrelated attribute value");
});
// Fire Alarm E2E fix (candidate discrimination) -- the BOQ's own clean
// "Outdoor"/"Indoor" deterministic fact must still recognize the catalog's
// real, richer descriptive attribute text (a strict Equal comparison would
// treat "Outdoor" and "Outdoor (weatherproof, NEMA 4X/IP56)" as unrelated).
test("indoor_outdoor/ip_rating/detector_technology use loose text matching against descriptive catalog values, without loosening addressing", () => {
  const outdoorProfile = profile({ boqItem: { ...profile().boqItem, productFamily: "Sounder/Strobe", attributes: { indoor_outdoor: "Outdoor" } } });
  const richOutdoor = product({ family: "Sounder/Strobe", attributes: [{ name: "indoor_outdoor", value: "Outdoor (weatherproof, NEMA 4X/IP56)", origin: "EXTRACTED", confidence: 90 }] });
  const outdoorResult = runProductMatching({ profile: outdoorProfile, products: [richOutdoor], prices: [] });
  const outdoorComparison = outdoorResult.candidates[0].comparisons.find((entry) => entry.requirement?.attributeName === "indoor_outdoor");
  assert.equal(outdoorComparison.pass, true, "Outdoor must match the catalog's richer 'Outdoor (weatherproof, NEMA 4X/IP56)' text");
  const addressableProfile = profile({ boqItem: { ...profile().boqItem, productFamily: "Addressable Smoke Detector", attributes: { addressing: "Addressable" } } });
  const nonAddressable = product({ family: "Addressable Smoke Detector", attributes: [{ name: "addressing", value: "Non-Addressable", origin: "EXTRACTED", confidence: 90 }] });
  const addressableResult = runProductMatching({ profile: addressableProfile, products: [nonAddressable], prices: [] });
  const addressingComparison = addressableResult.candidates[0].comparisons.find((entry) => entry.requirement?.attributeName === "addressing");
  assert.equal(addressingComparison.pass, false, "addressing must keep strict Equal semantics -- 'Addressable' must never loosely match 'Non-Addressable' through substring containment");
});

// Fire Alarm E2E fix (cross-family ranking) -- real Central Kitchen - Makkah
// gap: a governed, generic project requirement (via profile.consolidatedRequirements,
// e.g. propagated system-wide, NEVER family-gated the way boqAttributeComparisons/
// structuredAttributeAlignment already are) can be trivially satisfied by an
// unrelated but well-attributed candidate, while the correct family's own
// candidate carries ONE MORE (family-gated) comparison it happens to lack
// evidence for -- a lower ratio despite being the only technically valid
// family. This is the exact "sparse-attribute ratio" mechanism: fewer total
// comparisons (the wrong family, ungated evidence only) can look "cleaner"
// than more comparisons (the right family, gated evidence included) even
// though the right family is the only one that should ever be considered.
test("Fire Alarm E2E fix (cross-family ranking) -- Beam Detector's correct governed family outranks unrelated Duct/Smoke/Heat Detector candidates despite a lower requirement-evidence ratio", () => {
  const beamProfile = profile({
    boqItem: { ...profile().boqItem, description: "Beam detector", category: "Detection Devices", productFamily: "Beam Detector", attributes: { detector_technology: "Optical" } },
    consolidatedRequirements: [{ id: "r-addr", normalizedRequirement: "the entire fire detection system shall be analogue addressable type", priority: "Mandatory", attributes: [{ name: "addressing", operator: "Equal", normalizedValue: "Addressable" }] }],
    standards: [], compatibility: [], accessories: [],
  });
  // The correct family's own real candidate: passes the ungated system-wide
  // requirement, but lacks detector_technology on this specific SKU -- a
  // second, family-gated comparison it fails/lacks (non-blocking, but it
  // drags its ratio down to 0.5).
  const beamCandidate = product({ id: "beam-1", partNumber: "OSI-RI-FH", family: "Beam Detector", category: "Detection Devices", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });
  // Unrelated families: retrieved via the same real Category-stage path a
  // wrong-family candidate genuinely gets found through in production (both
  // sides share "Detection Devices"), never invented just for this test.
  // The family-gated boq-attribute comparison never applies to them at all
  // (zero comparisons from that source), so they score a "clean" 1.0 ratio
  // on the ungated system-wide requirement alone.
  const duct = product({ id: "duct-1", partNumber: "IDP-PHOTO-R-IV", family: "Duct Detector", category: "Detection Devices", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });
  const smoke = product({ id: "smoke-1", partNumber: "IDP-PHOTO-IV", family: "Addressable Smoke Detector", category: "Detection Devices", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });
  const heat = product({ id: "heat-1", partNumber: "IDP-HEAT-ROR-IV", family: "Addressable Heat Detector", category: "Detection Devices", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });

  const result = runProductMatching({ profile: beamProfile, products: [duct, smoke, heat, beamCandidate], prices: [] });
  assert.equal(result.candidates[0].product.partNumber, "OSI-RI-FH", `Top-1 must be the correct governed family; got ${result.candidates[0].product.partNumber}`);
  assert.equal(result.candidates[0].mandatoryFailures.length, 0);
  // Sanity check the mechanism this test targets is genuinely exercised: the
  // wrong-family candidates really do have a higher (or equal) evidenceStrength
  // than the correct family's own candidate -- proving the tier, not evidence,
  // is what won.
  const beamResult = result.candidates.find((entry) => entry.product.partNumber === "OSI-RI-FH");
  const ductResult = result.candidates.find((entry) => entry.product.partNumber === "IDP-PHOTO-R-IV");
  assert.ok(ductResult.evidenceStrength >= beamResult.evidenceStrength, "this test only proves the fix if the wrong-family candidate genuinely has the stronger (or equal) evidenceStrength");
});

// Conventional Beam Detector candidates must still fail the mandatory
// addressing requirement and rank below the compliant Beam Detector
// candidate, but ABOVE every wrong-family candidate -- visible as
// technically rejected alternatives within the correct family tier, never
// promoted to "compliant", and never simply deleted from discovery.
test("Fire Alarm E2E fix (cross-family ranking) -- a same-family candidate that fails a mandatory requirement still outranks every wrong-family candidate, and is never marked compliant", () => {
  const beamProfile = profile({
    boqItem: { ...profile().boqItem, description: "Beam detector", category: "Detection Devices", productFamily: "Beam Detector" },
    consolidatedRequirements: [{ id: "r-addr", normalizedRequirement: "the entire fire detection system shall be analogue addressable type", priority: "Mandatory", attributes: [{ name: "addressing", operator: "Equal", normalizedValue: "Addressable" }] }],
    standards: [], compatibility: [], accessories: [],
  });
  const addressableBeam = product({ id: "beam-1", partNumber: "OSI-RI-FH", family: "Beam Detector", category: "Detection Devices", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });
  const conventionalBeam = product({ id: "beam-2", partNumber: "6500RE", family: "Beam Detector", category: "Detection Devices", attributes: [{ name: "addressing", normalizedValue: "Conventional" }], standards: [], compatibility: [], accessories: [] });
  const duct = product({ id: "duct-1", partNumber: "IDP-PHOTO-R-IV", family: "Duct Detector", category: "Detection Devices", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });

  const result = runProductMatching({ profile: beamProfile, products: [duct, conventionalBeam, addressableBeam], prices: [] });
  const ranked = result.candidates.map((entry) => entry.product.partNumber);
  assert.deepEqual(ranked.slice(0, 3), ["OSI-RI-FH", "6500RE", "IDP-PHOTO-R-IV"], `expected the compliant same-family candidate first, the failing same-family candidate second (still visible, still above the wrong family), the wrong family last; got ${ranked.join(", ")}`);
  const conventional = result.candidates.find((entry) => entry.product.partNumber === "6500RE");
  assert.equal(conventional.mandatoryFailures.length > 0, true, "the conventional candidate must genuinely fail the mandatory addressing requirement");
  assert.notEqual(conventional.technicalStatus, "Technically Compliant", "a same-family candidate that violates a mandatory requirement must never be marked compliant");
  assert.equal(conventional.recommendationTier, "Rejected Candidate");
});

// Pull Station / Manual Call Point are a real, registered synonym pair
// (system-knowledge-registry.mjs's familiesAreSynonyms, reused here -- no
// new equivalence rule). A synonym-family candidate must tier the same as
// an exact match, never demoted to the wrong-family tier.
test("Fire Alarm E2E fix (cross-family ranking) -- Pull Station (a registered synonym of Manual Call Point) tiers with the exact family match, not with an unrelated family", () => {
  const mcpProfile = profile({
    boqItem: { ...profile().boqItem, description: "Manual call point", category: "Manual Initiation", productFamily: "Manual Call Point" },
    consolidatedRequirements: [{ id: "r-addr", normalizedRequirement: "system shall be addressable", priority: "Mandatory", attributes: [{ name: "addressing", operator: "Equal", normalizedValue: "Addressable" }] }],
    standards: [], compatibility: [], accessories: [],
  });
  const pullStation = product({ id: "ps-1", partNumber: "IDP-PULL-SA", family: "Pull Station", category: "Manual Initiation", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });
  const monitorModule = product({ id: "mm-1", partNumber: "IDP-MONITOR", family: "Monitor Module", category: "Manual Initiation", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });
  const result = runProductMatching({ profile: mcpProfile, products: [monitorModule, pullStation], prices: [] });
  assert.equal(result.candidates[0].product.partNumber, "IDP-PULL-SA", "a registered synonym family must tier with the exact family, outranking an unrelated Modules and Interfaces candidate");
  assert.equal(result.candidates[0].familyMatchTier, 0);
});

// Annunciator vs FACP: both Control Equipment, both plausible panel-adjacent
// products, but genuinely different governed families -- a generic,
// ungated consolidatedRequirements attribute both can trivially satisfy
// must not let the wrong one (FACP) outrank the correct one (Annunciator).
test("Fire Alarm E2E fix (cross-family ranking) -- Annunciator outranks a wrong-family FACP candidate despite both trivially satisfying a generic requirement", () => {
  const annunciatorProfile = profile({
    boqItem: { ...profile().boqItem, description: "Annunciator", productFamily: "Annunciator" },
    consolidatedRequirements: [{ id: "r-addr", normalizedRequirement: "system shall be addressable", priority: "Mandatory", attributes: [{ name: "addressing", operator: "Equal", normalizedValue: "Addressable" }] }],
    standards: [], compatibility: [], accessories: [],
  });
  const annunciator = product({ id: "ann-1", partNumber: "ANN-1", family: "Annunciator", category: "Control Equipment", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [], compatibility: [], accessories: [] });
  const facp = product({ id: "facp-1", partNumber: "IFP-2100HVB", family: "Fire Alarm Control Panel", category: "Control Equipment", attributes: [{ name: "addressing", normalizedValue: "Addressable" }], standards: [{ body: "UL", number: "864" }], compatibility: [], accessories: [] });
  const result = runProductMatching({ profile: annunciatorProfile, products: [facp, annunciator], prices: [] });
  assert.equal(result.candidates[0].product.partNumber, "ANN-1", "the correct governed family must outrank a wrong-family candidate, even one carrying extra (irrelevant) evidence");
});

// Sounder/Strobe vs a standalone Strobe: NOT a registered synonym pair
// (only a textual/partial family relationship), so a standalone Strobe must
// still tier as a different family when the item needs Sounder/Strobe --
// visible as a fallback, never promoted above a genuine Sounder/Strobe match.
test("Fire Alarm E2E fix (cross-family ranking) -- a standalone Strobe (not a registered synonym) never outranks a genuine Sounder/Strobe candidate", () => {
  const sounderStrobeProfile = profile({
    boqItem: { ...profile().boqItem, description: "Sounder with strobe", productFamily: "Sounder/Strobe" },
    consolidatedRequirements: [], standards: [], compatibility: [], accessories: [],
  });
  const sounderStrobe = product({ id: "ss-1", partNumber: "P2RK", family: "Sounder/Strobe", category: "Notification Devices", attributes: [], standards: [], compatibility: [], accessories: [] });
  const bareStrobe = product({ id: "s-1", partNumber: "SRK", family: "Strobe", category: "Notification Devices", attributes: [], standards: [], compatibility: [], accessories: [] });
  const result = runProductMatching({ profile: sounderStrobeProfile, products: [bareStrobe, sounderStrobe], prices: [] });
  assert.equal(result.candidates[0].product.partNumber, "P2RK", "the genuine Sounder/Strobe family match must outrank a standalone, non-synonym Strobe");
  assert.equal(result.candidates.find((entry) => entry.product.partNumber === "SRK").familyMatchTier, 2, "a real but different governed family is tier 2, not silently treated as equivalent");
  assert.ok(result.candidates.some((entry) => entry.product.partNumber === "SRK"), "the wrong-family candidate must remain visible as a lower-tier fallback, never deleted");
});

// Monitor Module vs other Modules and Interfaces families (Control/Relay/
// Isolator Module): same category, genuinely different governed families.
test("Fire Alarm E2E fix (cross-family ranking) -- Monitor Module outranks other Modules and Interfaces families that are not registered synonyms", () => {
  const monitorProfile = profile({
    boqItem: { ...profile().boqItem, description: "Monitor module", productFamily: "Monitor Module" },
    consolidatedRequirements: [], standards: [], compatibility: [], accessories: [],
  });
  const monitorModule = product({ id: "mm-1", partNumber: "IDP-MONITOR", family: "Monitor Module", category: "Modules and Interfaces", attributes: [], standards: [], compatibility: [], accessories: [] });
  const relayModule = product({ id: "rm-1", partNumber: "IDP-RELAY-6", family: "Relay Module", category: "Modules and Interfaces", attributes: [], standards: [], compatibility: [], accessories: [] });
  const isolatorModule = product({ id: "im-1", partNumber: "ISO-1", family: "Isolator Module", category: "Modules and Interfaces", attributes: [], standards: [], compatibility: [], accessories: [] });
  const result = runProductMatching({ profile: monitorProfile, products: [relayModule, isolatorModule, monitorModule], prices: [] });
  assert.equal(result.candidates[0].product.partNumber, "IDP-MONITOR", "Monitor Module must outrank other, genuinely different module families in the same category");
});

// Legitimate variant ranking WITHIN the same family must keep using
// technical evidence exactly as before -- the tier only ever discriminates
// ACROSS families, never within one.
test("Fire Alarm E2E fix (cross-family ranking) -- within the same family, the candidate with genuinely stronger technical evidence still outranks a weaker one", () => {
  const smokeProfile = profile({
    boqItem: { ...profile().boqItem, productFamily: "Addressable Smoke Detector", attributes: { detector_technology: "Optical" } },
    consolidatedRequirements: [], standards: [], compatibility: [], accessories: [],
  });
  const wellAttributed = product({ id: "sm-1", partNumber: "IDP-PHOTO-IV", family: "Addressable Smoke Detector", attributes: [{ name: "detector_technology", normalizedValue: "Optical" }], standards: [], compatibility: [], accessories: [] });
  const sparse = product({ id: "sm-2", partNumber: "IDP-PHOTO-T-IV", family: "Addressable Smoke Detector", attributes: [], standards: [], compatibility: [], accessories: [] });
  const result = runProductMatching({ profile: smokeProfile, products: [sparse, wellAttributed], prices: [] });
  assert.equal(result.candidates[0].product.partNumber, "IDP-PHOTO-IV", "within the SAME family, genuinely stronger technical evidence must still decide ranking exactly as before");
  assert.equal(result.candidates[0].familyMatchTier, result.candidates[1].familyMatchTier, "both are the same family -- the tier must not be what discriminated this pair");
});

// When the BOQ item has no confident governed family, familyMatchTier must
// be a complete no-op -- discovery-only/category-level items keep their
// exact prior ranking behavior.
test("Fire Alarm E2E fix (cross-family ranking) -- an item with no confident governed family is unaffected by tiering (a no-op)", () => {
  const noFamilyProfile = profile({ boqItem: { ...profile().boqItem, productFamily: null }, consolidatedRequirements: [], standards: [], compatibility: [], accessories: [] });
  const anyFamily = product({ id: "any-1", partNumber: "ANY-1", family: "Duct Detector", attributes: [], standards: [], compatibility: [], accessories: [] });
  const result = runProductMatching({ profile: noFamilyProfile, products: [anyFamily], prices: [] });
  assert.equal(result.candidates[0].familyMatchTier, 0, "with no confident boqItem family, every candidate ties at tier 0 -- a no-op, never a blocker");
});
