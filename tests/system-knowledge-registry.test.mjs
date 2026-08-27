import test from "node:test";
import assert from "node:assert/strict";

import {
  hasGovernedTaxonomy, registeredSystems, registerSystemPack, unregisterSystemPack,
  buildTaxonomyContext, resolveSystemNameFromText, isCanonicalPair, systemTaxonomyMetadata,
} from "../app/domain/system-knowledge-registry.mjs";
import { prepareBoqUnderstandingInput, validateAndMergeBoqInterpretation } from "../app/domain/boq-understanding-engine.mjs";
import { handleProductPriceLibraryApi } from "../worker/product-price-library-api.mjs";

const fact = (value, origin = "EXTRACTED", confidence = 100) => ({ value, origin, confidence });
const row = (description, overrides = {}) => ({ id: "boq-registry-test", rowType: "BOQ Item", description, originalQuantity: 1, originalUnit: "No", ...overrides });

test("Fire Alarm remains the only registered system today", () => {
  assert.deepEqual(registeredSystems(), ["Fire Alarm"]);
  assert.equal(hasGovernedTaxonomy("Fire Alarm"), true);
});

test("Fire Alarm understanding: a governed candidate is still classified through the registry unchanged", () => {
  const input = prepareBoqUnderstandingInput(row("Intelligent Addressable Pull Station, Dual Action"));
  assert.equal(input.taxonomyContext.system, "Fire Alarm");
  const candidate = input.taxonomyContext.families.find((entry) => entry.family === "Pull Station");
  assert.ok(candidate, "the registry must still surface the Pull Station candidate for governed selection");
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: fact("Intelligent Addressable Pull Station, Dual Action"),
    system: fact("Fire Alarm", "INFERRED", 70), category: fact("Manual Initiation", "INFERRED", 70),
    equipmentType: fact("Pull Station", "EXTRACTED", 100), productFamily: fact("Pull Station", "INFERRED", 70),
    taxonomyCandidateKey: fact(candidate.selectionKey, "EXTRACTED", 100), confidence: "HIGH",
  });
  assert.equal(result.interpretation.system.value, "Fire Alarm");
  assert.equal(result.interpretation.category.value, "Manual Initiation");
  assert.equal(result.interpretation.productFamily.value, "Pull Station");
});

test("Fire Alarm category/family validation still rejects a non-canonical pair through the registry", () => {
  assert.equal(isCanonicalPair("Fire Alarm", "Manual Initiation", "Pull Station"), true);
  assert.equal(isCanonicalPair("Fire Alarm", "Manual Initiation", "Relay Module"), false);
});

test("a non-governed item never receives Fire Alarm taxonomy candidates or attribute enforcement, even if its proposed productFamily collides with a real Fire Alarm family name", () => {
  // Nothing about this row's own evidence looks like Fire Alarm, and the AI's
  // proposed system is explicitly CCTV -- but it names "Relay Module" (a real
  // Fire Alarm family) as its productFamily. Before this refactor this could
  // accidentally trigger Fire Alarm's mandatory-attribute enforcement.
  const input = prepareBoqUnderstandingInput(row("PTZ Camera 30X Zoom Outdoor Housing"));
  assert.equal(input.taxonomyContext.system, null, "row evidence must not be recognized as Fire Alarm");
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: fact("PTZ Camera 30X Zoom Outdoor Housing"),
    system: fact("CCTV", "EXTRACTED", 100), category: fact("Cameras", "EXTRACTED", 90),
    equipmentType: fact("PTZ Camera", "EXTRACTED", 100), productFamily: fact("Relay Module", "INFERRED", 60),
    technicalAttributes: [{ name: "resolution", value: "5MP", origin: "EXTRACTED", confidence: 90 }],
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.system.value, "CCTV");
  assert.equal(result.interpretation.category.value, "Cameras");
  assert.equal(result.interpretation.productFamily.value, "Relay Module");
  // A real Fire Alarm Relay Module has mandatory attributes (product_type,
  // protocol, compatible_panel_family, loop_compatibility, operating_voltage).
  // None of them may be silently injected as MISSING/required on this CCTV row.
  for (const name of ["product_type", "protocol", "compatible_panel_family", "loop_compatibility", "operating_voltage"]) {
    assert.equal(name in result.interpretation.attributes, false, `${name} must not be enforced on an ungoverned system`);
  }
  assert.equal(result.interpretation.attributes.resolution.value, "5MP", "the row's own raw attribute name is preserved for an ungoverned system");
});

test("an unregistered system safely falls back to generic grounded understanding", () => {
  const input = prepareBoqUnderstandingInput(row("Category 6 UTP Cable, 305m Box"));
  assert.equal(input.taxonomyContext.system, null);
  assert.deepEqual(input.taxonomyContext.families, []);
  const result = validateAndMergeBoqInterpretation(input, {
    normalizedDescription: fact("Category 6 UTP Cable, 305m Box"),
    system: fact("Structured Cabling", "EXTRACTED", 100), category: fact("Cabling", "EXTRACTED", 90),
    equipmentType: fact("UTP Cable", "EXTRACTED", 100), productFamily: fact("Cat6 Cable", "EXTRACTED", 90),
    technicalAttributes: [{ name: "cablingCategory", value: "Cat6", origin: "EXTRACTED", confidence: 90 }],
    confidence: "HIGH",
  });
  assert.equal(result.interpretation.system.value, "Structured Cabling");
  assert.equal(result.interpretation.productFamily.value, "Cat6 Cable");
  assert.equal(result.interpretation.attributes.cablingCategory.value, "Cat6");
});

test("taxonomy API returns Fire Alarm data only when Fire Alarm is requested, and an honest unsupported result otherwise", async () => {
  // localhost triggers the server's own controlled single-user MVP context
  // (worker/application-context.mjs) with no further mocking needed; the
  // taxonomy route never touches env.DB itself.
  const env = { DB: {} };

  const defaultRes = await handleProductPriceLibraryApi(new Request("https://localhost/api/library/taxonomy"), env);
  const defaultBody = await defaultRes.json();
  assert.equal(defaultRes.status, 200);
  assert.equal(defaultBody.engineeringDomain, "Fire Alarm");
  assert.ok(defaultBody.taxonomy["Manual Initiation"]);

  const explicitRes = await handleProductPriceLibraryApi(new Request("https://localhost/api/library/taxonomy?system=Fire%20Alarm"), env);
  const explicitBody = await explicitRes.json();
  assert.equal(explicitRes.status, 200);
  assert.equal(explicitBody.engineeringDomain, "Fire Alarm");

  const unknownRes = await handleProductPriceLibraryApi(new Request("https://localhost/api/library/taxonomy?system=CCTV"), env);
  const unknownBody = await unknownRes.json();
  assert.equal(unknownRes.status, 404);
  assert.equal(unknownBody.error.code, "SYSTEM_TAXONOMY_UNAVAILABLE");
  assert.equal(unknownBody.taxonomy, undefined, "an unregistered system must never receive Fire Alarm taxonomy data");
});

test("a dummy/test system pack can register and be fully usable through the registry without editing boq-understanding-engine.mjs, estimator-understanding-review.mjs, or the taxonomy API", async () => {
  const DUMMY_SYSTEM = "Dummy Test System";
  const dummyPack = {
    version: "dummy-taxonomy-0.0.1",
    taxonomy: Object.freeze({ "Dummy Category": Object.freeze(["Dummy Family"]) }),
    attributeProfiles: Object.freeze({ "Dummy Family": Object.freeze({ attributes: ["dummy_attribute"], matchingImportance: { dummy_attribute: "Mandatory" } }) }),
    buildTaxonomyContext: (evidence) => /dummy widget/i.test(String(evidence.description || ""))
      ? { version: "dummy-taxonomy-0.0.1", system: DUMMY_SYSTEM, families: [{ selectionKey: "DUMMY-1", category: "Dummy Category", family: "Dummy Family", basis: ["dummy widget"] }], attributeNames: ["dummy_attribute"] }
      : { version: null, system: null, families: [], attributeNames: [] },
    isCanonicalPair: (category, family) => category === "Dummy Category" && family === "Dummy Family",
    normalizeCategory: (value) => value === "Dummy Category" ? value : null,
    normalizeFamily: (value) => value === "Dummy Family" ? value : null,
    normalizeAttributeName: (value, family) => family === "Dummy Family" && String(value).toLowerCase().replace(/\s+/g, "_") === "dummy_attribute" ? "dummy_attribute" : null,
    matchesSystemName: (value) => String(value ?? "").trim() === DUMMY_SYSTEM,
  };
  registerSystemPack(DUMMY_SYSTEM, dummyPack);
  try {
    assert.ok(registeredSystems().includes(DUMMY_SYSTEM));
    assert.equal(hasGovernedTaxonomy(DUMMY_SYSTEM), true);
    assert.equal(resolveSystemNameFromText(DUMMY_SYSTEM), DUMMY_SYSTEM);
    assert.deepEqual(systemTaxonomyMetadata(DUMMY_SYSTEM), { system: DUMMY_SYSTEM, version: dummyPack.version, taxonomy: dummyPack.taxonomy, attributeProfiles: dummyPack.attributeProfiles });

    // The generic core (unedited) now recognizes and grounds this row through the newly registered pack.
    const input = prepareBoqUnderstandingInput(row("Dummy Widget Model X"));
    assert.equal(input.taxonomyContext.system, DUMMY_SYSTEM);
    const candidate = input.taxonomyContext.families[0];
    const result = validateAndMergeBoqInterpretation(input, {
      normalizedDescription: fact("Dummy Widget Model X"),
      system: fact(DUMMY_SYSTEM, "INFERRED", 70), category: fact("Dummy Category", "INFERRED", 70),
      equipmentType: fact("Dummy Widget", "EXTRACTED", 100), productFamily: fact("Dummy Family", "INFERRED", 70),
      taxonomyCandidateKey: fact(candidate.selectionKey, "EXTRACTED", 100), confidence: "HIGH",
    });
    assert.equal(result.interpretation.system.value, DUMMY_SYSTEM);
    assert.equal(result.interpretation.category.value, "Dummy Category");
    assert.equal(result.interpretation.productFamily.value, "Dummy Family");

    // The taxonomy API (unedited) now serves it too.
    const req = new Request(`https://localhost/api/library/taxonomy?system=${encodeURIComponent(DUMMY_SYSTEM)}`);
    const res = await handleProductPriceLibraryApi(req, { DB: {} });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.engineeringDomain, DUMMY_SYSTEM);

    // Fire Alarm remains completely unaffected by the dummy registration.
    assert.equal(isCanonicalPair("Fire Alarm", "Manual Initiation", "Pull Station"), true);
  } finally {
    unregisterSystemPack(DUMMY_SYSTEM);
  }
  assert.equal(hasGovernedTaxonomy(DUMMY_SYSTEM), false, "cleanup must fully remove the dummy pack");
  assert.deepEqual(registeredSystems(), ["Fire Alarm"]);
});
