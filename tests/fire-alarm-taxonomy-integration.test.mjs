import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as library from "../app/domain/product-price-library.mjs";
import * as understanding from "../app/domain/boq-understanding-engine.mjs";
import * as requirement from "../app/domain/requirement-intelligence-engine.mjs";
import { FIRE_ALARM_ATTRIBUTE_PROFILES, FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY_VERSION, buildFireAlarmTaxonomyContext, classifyFireAlarmFamilyFromText, fireAlarmRequiresPanelCompatibility } from "../app/domain/fire-alarm-taxonomy.mjs";
import { requiresPanelCompatibility } from "../app/domain/system-knowledge-registry.mjs";

const fact = (value, origin = "INFERRED", confidence = 85) => ({ value, origin, confidence });
const row = (description) => understanding.prepareBoqUnderstandingInput({ id: "boq-taxonomy-test", rowType: "BOQ Item", description, originalQuantity: 1, originalUnit: "No" });
const validOutput = (overrides = {}) => ({
  normalizedDescription: fact("Addressable optical smoke detector with built-in isolator", "EXTRACTED", 100),
  system: fact("Fire Alarm"), category: fact("Detection Devices"), equipmentType: fact("Addressable optical smoke detector"),
  productFamily: fact("Addressable Smoke Detector"), technicalAttributes: [{ name: "addressing", value: "Addressable", origin: "EXTRACTED", confidence: 100 }],
  confidence: "HIGH", ...overrides,
});

test("all three domains consume the same canonical taxonomy object and version", () => {
  assert.strictEqual(library.FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY);
  assert.strictEqual(understanding.FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY);
  assert.strictEqual(requirement.FIRE_ALARM_TAXONOMY, FIRE_ALARM_TAXONOMY);
  assert.strictEqual(library.FIRE_ALARM_ATTRIBUTE_PROFILES, FIRE_ALARM_ATTRIBUTE_PROFILES);
  assert.equal(understanding.FIRE_ALARM_TAXONOMY_VERSION, FIRE_ALARM_TAXONOMY_VERSION);
  assert.equal(requirement.FIRE_ALARM_TAXONOMY_VERSION, FIRE_ALARM_TAXONOMY_VERSION);
});

// Sprint 0.3 Phase 1: classifyFireAlarmFamilyFromText is the single conservative
// classification-write rule shared by the Farenhyt price-list importer
// (product-price-library.mjs) and the catalog family backfill
// (scripts/classify-fire-alarm-product-families.mjs) -- neither re-derives it.
test("classifyFireAlarmFamilyFromText only accepts a literal exact-phrase match, never a lone token-overlap guess", () => {
  const literal = classifyFireAlarmFamilyFromText("Intelligent Addressable Photoelectric Smoke Detector (Ivory Color)");
  assert.deepEqual(literal, { category: "Detection Devices", family: "Addressable Smoke Detector" });
  // Sprint 1.16 -- "thermal detector" is now a governed manufacturer-wording
  // alias for "Addressable Heat Detector" (real catalog case: IDP-HEAT-ROR-IV
  // literally reads "...thermal detector..."), so this is now a genuine
  // EXACT_PHRASE match, not the false "Detector Base" token-overlap guess a
  // prior version of this test locked in before that alias existed -- the
  // literal phrase decisively outscores the weaker token overlap.
  const heatDetector = classifyFireAlarmFamilyFromText("Intelligent Addressable Fixed temperature and rate-of rise thermal detector (Rate-of-rise detection 15F/min (9C/min) (Base Not Included)(Ivory Color)");
  assert.deepEqual(heatDetector, { category: "Detection Devices", family: "Addressable Heat Detector" });
  // A genuinely different text with the same false-token-overlap shape (two
  // unrelated words each separately present, no real phrase for any family)
  // must still fail closed to null, never guess from a lone token overlap.
  const falseTokenMatch = classifyFireAlarmFamilyFromText("Intelligent Addressable Weatherproof Enclosure Assembly (Base Not Included)(Ivory Color)");
  assert.equal(falseTokenMatch, null);
});
// Sprint 1.23 -- real Opera Product Knowledge gap: this manufacturer's own
// catalog wording for a combination audible+visual notification appliance is
// "Horn/strobe" or "Horn cum Strobe", never literally "Sounder/Strobe" -- and
// its bare audible-only wording is "Horn", never literally "Sounder". Both
// are genuine, real synonyms for the taxonomy's existing "Sounder/Strobe" and
// "Sounder" families (the identical physical device categories), not a new
// family concept.
test("Horn/Horn-Strobe manufacturer wording resolves to the existing governed Sounder/Sounder-Strobe families", () => {
  assert.deepEqual(classifyFireAlarmFamilyFromText("Horn/strobe, 12/24 volt, multi-candela 15, 15/75, 30, 75, 110, 115, red, outdoor, includes backbox"), { category: "Notification Devices", family: "Sounder/Strobe" });
  assert.deepEqual(classifyFireAlarmFamilyFromText("HORN STROBE 2W RED WALL"), { category: "Notification Devices", family: "Sounder/Strobe" });
  assert.deepEqual(classifyFireAlarmFamilyFromText("System Sensor Horn cum Strobe, Wall, Red, Standard Candela"), { category: "Notification Devices", family: "Sounder/Strobe" });
  // A bare Horn/Strobe device must never be confused with the voice/Speaker
  // family, and a bare Strobe-only device (no Horn/Sounder wording at all)
  // must remain unaffected.
  assert.notEqual(classifyFireAlarmFamilyFromText("Horn/strobe, 12/24 volt, multi-candela 15, 15/75, 30, 75, 110, 115, red, outdoor").family, "Speaker/Strobe");
  assert.deepEqual(classifyFireAlarmFamilyFromText("STROBE WHITE WALL"), { category: "Notification Devices", family: "Strobe" });
  assert.deepEqual(classifyFireAlarmFamilyFromText("System Sensor Strobe, Wall, Red, Multi Candela"), { category: "Notification Devices", family: "Strobe" });
  // Regression check: the existing Speaker/Speaker-Strobe, Manual Call Point
  // and FACP phrase matches from prior sprints are untouched by this change.
  assert.deepEqual(classifyFireAlarmFamilyFromText("Voice Evacuation Speaker with strobe Ceiling Mounted"), { category: "Notification Devices", family: "Speaker/Strobe" });
  assert.deepEqual(classifyFireAlarmFamilyFromText("Manual Call Point MCLP WP"), { category: "Manual Initiation", family: "Manual Call Point" });
  assert.deepEqual(classifyFireAlarmFamilyFromText("Fire Alarm Control Panel FACP"), { category: "Control Equipment", family: "Fire Alarm Control Panel" });
});
// Sprint 1.23 -- documents a known, human-reviewed false-positive shape: an
// accessory description that only MENTIONS horn/strobe devices ("...for use
// with horns, strobes, and horn strobes...", "Horn Strobe Cover...") still
// contains the literal "horn strobe" substring and is not distinguishable
// from a genuine device by text alone. This is handled the same way the
// project has always handled this class of problem (Sprint 1.16/1.20): a
// documented, per-part-number reviewer exclusion at the Product Knowledge
// correction script's invocation, never a classifier-level special case.
// This test exists so a future change to these phrases cannot silently
// re-widen or narrow this already-reviewed shape without being noticed.
test("a plate/cover accessory that only mentions Horn/Strobe devices is a documented correction-script exclusion, not a classifier guard", () => {
  assert.deepEqual(classifyFireAlarmFamilyFromText("Weatherproof plate, for use with horns, strobes, and horn strobes, red"), { category: "Notification Devices", family: "Sounder/Strobe" });
  assert.deepEqual(classifyFireAlarmFamilyFromText("Horn Strobe Cover, surface mount."), { category: "Notification Devices", family: "Sounder/Strobe" });
});
test("classifyFireAlarmFamilyFromText never invents a classification for free text with no taxonomy signal", () => {
  assert.equal(classifyFireAlarmFamilyFromText("Detectors"), null);
  assert.equal(classifyFireAlarmFamilyFromText("Unclassified Farenhyt Products"), null);
  assert.equal(classifyFireAlarmFamilyFromText(""), null);
});
test("the Farenhyt importer's family classification is the same shared function, not a second taxonomy", () => {
  assert.equal(library.productFamily("Manual Call Point").engineeringDomain, classifyFireAlarmFamilyFromText("Manual Call Point").category);
  assert.equal(library.productFamily("Random Heading Text").engineeringDomain, null);
});

test("candidate taxonomy context is bounded and excludes irrelevant families", () => {
  const context = buildFireAlarmTaxonomyContext({ description: "Addressable optical smoke detector with built-in isolator" });
  assert.ok(context.families.length > 0 && context.families.length <= 6);
  assert.ok(context.attributeNames.length <= 10);
  assert.equal(context.families[0].family, "Addressable Smoke Detector");
  assert.equal(context.families[0].selectionKey, "FA-1");
  assert.deepEqual(context.families.map(({ selectionKey }) => selectionKey), context.families.map((_, index) => `FA-${index + 1}`));
  assert.equal(context.families.some(({ family }) => family === "Fire Alarm Control Panel" || family === "Battery Cabinet"), false);
  assert.ok(JSON.stringify(context).length < 1600);
});

test("weatherproof Fire Alarm evidence exposes indoor_outdoor in bounded taxonomy context", () => {
  for (const description of ["Addressable Flasher Weather Proof", "Weatherproof Addressable Sounder With Flasher", "Outdoor Addressable Manual Call Point", "External Addressable Flasher"]) {
    const context = buildFireAlarmTaxonomyContext({ description, system: "Fire Alarm" });
    assert.ok(context.attributeNames.includes("indoor_outdoor"), description);
    assert.equal(context.attributeNames.includes("ip_rating"), false, description);
    assert.equal(context.attributeNames.includes("environmental_rating"), false, description);
  }
});

test("real sounder-flasher descriptions prefer the governed composite notification family", () => {
  for (const description of ["Addressable Sounder With Flasher", "Weatherproof Addressable Sounder With Flasher"]) {
    const context = buildFireAlarmTaxonomyContext({ description, system: "Fire Alarm" });
    assert.equal(context.families.length, 1);
    assert.equal(context.families[0].category, "Notification Devices");
    assert.equal(context.families[0].family, "Sounder/Strobe");
  }
});

// Fire Alarm E2E fix 2 -- these seven phrasings are the exact real Fire Alarm
// BOQ lines proven unclassifiable during the Central Kitchen - Makkah unseen-
// project evaluation, later confirmed against that project's own historical
// BOM. Locks in both the newly-added vocabulary and (for "Flasher" alone) the
// pre-existing behavior that was already correct.
test("Fire Alarm E2E fix 2 -- real Central Kitchen phrasings resolve to their historically-confirmed governed family", () => {
  const cases = [
    ["Multi detector", "Detection Devices", "Addressable Smoke Detector"],
    ["Multi detector.with short circuit isolator.", "Detection Devices", "Addressable Smoke Detector"],
    ["FARP Addressable type.", "Control Equipment", "Annunciator"],
    ["Flasher", "Notification Devices", "Strobe"],
    ["siren with bult in flusher , IP-65", "Notification Devices", "Sounder/Strobe"],
    ["Indoor siren with built flasher", "Notification Devices", "Sounder/Strobe"],
    ["Smoke wall mounted , addresable type", "Detection Devices", "Addressable Smoke Detector"],
    ["dual monitor moudule ", "Modules and Interfaces", "Monitor Module"],
  ];
  for (const [description, category, family] of cases) {
    assert.deepEqual(classifyFireAlarmFamilyFromText(description), { category, family }, description);
    const context = buildFireAlarmTaxonomyContext({ description, system: "Fire Alarm" });
    assert.equal(context.families.length, 1, description);
    assert.equal(context.families[0].category, category, description);
    assert.equal(context.families[0].family, family, description);
  }
});

// Fire Alarm E2E fix 2 -- the new Sounder/Strobe siren+flasher/flusher
// phrases must not swallow a bare notification appliance that genuinely has
// no siren/horn wording of its own -- "flasher"/"beacon" alone must keep
// resolving to standalone Strobe exactly as before.
test("Fire Alarm E2E fix 2 -- new siren+flasher/flusher vocabulary does not widen bare Strobe/Sounder matching", () => {
  for (const description of ["Flasher", "Red Wall Strobe", "Sounder"]) {
    const context = buildFireAlarmTaxonomyContext({ description, system: "Fire Alarm" });
    assert.equal(context.families.length, 1, description);
    assert.notEqual(context.families[0].family, "Sounder/Strobe", description);
  }
});

test("Sprint 1.9 -- Manual Call Point and Pull Station are recognized as synonyms, not competing families (real Opera item 34 collision)", () => {
  // Confirmed specification text using "pull stations" (American term) must
  // not make an already-unambiguous BOQ description ("Manual Call Point")
  // fail closed, since these are the same real device in fire alarm
  // terminology, not two different products.
  const context = buildFireAlarmTaxonomyContext({
    description: "Manual Call Point MCLP",
    system: "Fire Alarm",
    confirmedSpecification: [{ normalizedRequirement: "manual pull stations shall be individually addressable suitable for two wire operation with a high impact red lexan body and raised white lettering" }],
  });
  assert.equal(context.families.length, 1);
  assert.equal(context.families[0].family, "Manual Call Point");
});

test("Sprint 1.9 -- a bare 'Pull Station' description alone still resolves to its own family, unaffected by the synonym fix", () => {
  const context = buildFireAlarmTaxonomyContext({ description: "Intelligent Addressable Pull Station, Dual Action, Key Reset", system: "Fire Alarm" });
  assert.equal(context.families.length, 1);
  assert.equal(context.families[0].family, "Pull Station");
});

test("Sprint 1.9 -- Manual Call Point vs a genuinely different, non-synonym family still fails closed as ambiguous", () => {
  // Sanity check that the synonym fix is narrowly scoped and does not
  // suppress real ambiguity between two actually-different families.
  const context = buildFireAlarmTaxonomyContext({
    description: "Manual Call Point",
    system: "Fire Alarm",
    confirmedSpecification: [{ normalizedRequirement: "provide a break glass unit at each floor landing" }],
  });
  assert.deepEqual(context.families, []);
});

test("generic Fire Alarm and panel tokens cannot misclassify firefighter telephone equipment", () => {
  const telephone = buildFireAlarmTaxonomyContext({ description: "Fire Man Telephone Panel", system: "Fire Alarm" });
  assert.deepEqual(telephone.families, []);
  for (const description of ["Fire panel device", "Addressable fire alarm system panel", "Fire suppression panel"]) {
    const context = buildFireAlarmTaxonomyContext({ description });
    assert.equal(context.families.some(({ family }) => family === "Fire Alarm Control Panel"), false);
  }
  assert.equal(buildFireAlarmTaxonomyContext({ description: "Fire Alarm Control Panel" }).families[0]?.family, "Fire Alarm Control Panel");
});

test("ambiguous BOQ family evidence yields no governed candidate", () => {
  const context = buildFireAlarmTaxonomyContext({ description: "Monitor Module and Control Module" });
  assert.deepEqual(context.families, []);
});

test("valid candidate key maps server-side to canonical inferred system, category and family", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector with built-in isolator"), validOutput({
    taxonomyCandidateKey: fact("FA-1", "EXTRACTED", 100), system: fact(null, "MISSING", 0), category: fact("Detector Things"), productFamily: fact("Paraphrased Optical Sensor"),
  }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.deepEqual(result.interpretation.system, { value: "Fire Alarm", origin: "INFERRED", confidence: 70 });
  assert.deepEqual(result.interpretation.category, { value: "Detection Devices", origin: "INFERRED", confidence: 70 });
  assert.deepEqual(result.interpretation.productFamily, { value: "Addressable Smoke Detector", origin: "INFERRED", confidence: 70 });
  assert.equal(["system", "category", "equipmentType", "productFamily"].some((field) => result.interpretation[field].origin === "MISSING"), false);
  assert.equal("taxonomyCandidateKey" in result.interpretation, false);
});

test("unknown or altered candidate keys fail closed", () => {
  for (const key of ["FA-2", "fa-1", "FA-1-modified"]) {
    const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), validOutput({ taxonomyCandidateKey: fact(key) }));
    assert.equal(result.status, "NEEDS_REVIEW");
    assert.equal(result.interpretation.category.origin, "MISSING");
    assert.equal(result.interpretation.productFamily.origin, "MISSING");
    assert.match(result.interpretation.ambiguities[0].value, /candidate selection/i);
  }
});

// Fire Alarm E2E fix 3 -- this test's own name and assertions predate the
// Central Kitchen unseen-project evaluation, which proved this exact prior
// behavior was actively harmful: "FACP Addressable type." and "siren with
// bult in flusher , IP-65" both had exactly one confident governed candidate
// and the model returned nothing at all (no key, no category, no
// productFamily, no ambiguities) -- and the old rule erased the confident
// deterministic classification down to MISSING rather than letting it stand.
// The correct, deliberately narrow rule: a truly silent model (no key, no
// classification of its own, no explicit contradiction) no longer erases a
// SOLE confident candidate -- it adopts it, at INFERRED/<=70 confidence, and
// still forces the row to NEEDS_REVIEW (never silently promoted to
// high-confidence/COMPLETED) with an explicit, auditable reason. A model
// that instead asserts its own out-of-context classification, or raises an
// explicit ambiguity, is unaffected by this change and still fails closed
// exactly as before (see "existing exact category and family output remains
// backward compatible" and tests/boq-understanding.test.mjs's own
// "missing governed candidate key cannot preserve sole Strobe classification").
test("a truly silent missing candidate key now adopts the sole confident candidate, flagged and still forced to review", () => {
  const output = validOutput();
  output.system = fact(null, "MISSING", 0);
  delete output.category;
  delete output.productFamily;
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), output);
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.category.value, "Detection Devices");
  assert.equal(result.interpretation.category.origin, "INFERRED");
  assert.ok(result.interpretation.category.confidence <= 70);
  assert.equal(result.interpretation.productFamily.value, "Addressable Smoke Detector");
  assert.equal(result.interpretation.productFamily.origin, "INFERRED");
  assert.equal(result.interpretation.system.value, "Fire Alarm");
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_ACCEPTED_OVER_SILENT_MODEL_NULL"));
});

test("Fire Alarm E2E fix 3 -- a model that asserts its own out-of-context classification (not silence) still fails closed to MISSING, unaffected by the silent-null fix", () => {
  const output = validOutput({
    category: fact("Modules and Interfaces", "INFERRED", 70),
    productFamily: fact("Monitor Module", "INFERRED", 70),
  });
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), output);
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
  assert.ok(result.interpretation.ambiguities.some((entry) => entry.value === "Proposed classification is outside the governed candidate context"));
  assert.equal(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_ACCEPTED_OVER_SILENT_MODEL_NULL"), false);
});

test("Fire Alarm E2E fix 3 -- a model that raises its own explicit ambiguity (not silence) still fails closed to MISSING", () => {
  const output = validOutput({ category: undefined, productFamily: undefined });
  delete output.category;
  delete output.productFamily;
  output.ambiguities = [fact("This description could also be a duct-mounted variant", "INFERRED", 100)];
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), output);
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
  assert.equal(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_ACCEPTED_OVER_SILENT_MODEL_NULL"), false);
});

test("existing exact category and family output remains backward compatible", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), validOutput());
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.category.value, "Detection Devices");
  assert.equal(result.interpretation.productFamily.value, "Addressable Smoke Detector");
  assert.ok(result.interpretation.reviewReasons.includes("GOVERNED_CANDIDATE_KEY_MISSING"));
});

test("a supplied key cannot select outside the bounded request context", () => {
  const input = row("Addressable optical smoke detector");
  assert.deepEqual(input.taxonomyContext.families.map(({ selectionKey }) => selectionKey), ["FA-1"]);
  const result = understanding.validateAndMergeBoqInterpretation(input, validOutput({ taxonomyCandidateKey: fact("FA-2") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.system.origin, "MISSING");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
});

test("duplicate request-local keys cannot classify a row", () => {
  const input = row("Addressable optical smoke detector");
  input.taxonomyContext = { ...input.taxonomyContext, families: [...input.taxonomyContext.families, { ...input.taxonomyContext.families[0] }] };
  const result = understanding.validateAndMergeBoqInterpretation(input, validOutput({ taxonomyCandidateKey: fact("FA-1") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
});

test("canonical category and family pairing is enforced", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), validOutput({ category: fact("Control Equipment") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
});

test("out-of-taxonomy values cannot pass as completed", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector"), validOutput({ category: fact("AI Devices"), productFamily: fact("Magic Sensor") }));
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.category.origin, "MISSING");
  assert.equal(result.interpretation.productFamily.origin, "MISSING");
});

test("valid mocked response expands to canonical classification without creating downstream authority", () => {
  const result = understanding.validateAndMergeBoqInterpretation(row("Addressable optical smoke detector with built-in isolator"), validOutput());
  assert.equal(result.status, "NEEDS_REVIEW");
  assert.equal(result.interpretation.category.value, "Detection Devices");
  assert.equal(result.interpretation.productFamily.value, "Addressable Smoke Detector");
  assert.equal(result.interpretation.productFamily.origin, "INFERRED");
  assert.equal("productId" in result.interpretation, false);
  assert.equal("price" in result.interpretation, false);
  const source = fs.readFileSync(new URL("../app/domain/boq-understanding-engine.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /from\s+["'][^"']*(?:product-matching|pricing-engine)[^"']*["']/);
});

// Sprint 1.14 -- real Opera gap: Requirement Profile's "compatibilityTarget"
// blocking rule applied to every Fire Alarm item uniformly. Real evidence
// from this project distinguishes addressable-loop devices (proprietary
// panel/protocol lock-in -- requirement_334 for detectors, requirement_363/
// 364 "individually addressable" for manual call points, requirement_326 for
// the FACP itself) from conventional notification appliances (sounder,
// strobe, bell, horn, speaker), for which nothing in the approved spec
// proves addressable-loop membership or panel lock-in.
test("Sprint 1.14 -- panel/loop compatibility is genuinely required for addressable-loop families (detectors, manual call points, modules, the panel itself), not for conventional notification appliances", () => {
  assert.equal(fireAlarmRequiresPanelCompatibility("Detection Devices", "Addressable Smoke Detector"), true);
  assert.equal(fireAlarmRequiresPanelCompatibility("Manual Initiation", "Manual Call Point"), true);
  assert.equal(fireAlarmRequiresPanelCompatibility("Modules and Interfaces", "Monitor Module"), true);
  assert.equal(fireAlarmRequiresPanelCompatibility("Control Equipment", "Fire Alarm Control Panel"), true);
  assert.equal(fireAlarmRequiresPanelCompatibility("Notification Devices", "Sounder/Strobe"), false);
  assert.equal(fireAlarmRequiresPanelCompatibility("Power and Batteries", "Battery"), false);
  assert.equal(fireAlarmRequiresPanelCompatibility("Accessories", "Back Box"), false);
  // family alone (no category passed) still resolves correctly via the taxonomy's own family->category mapping
  assert.equal(fireAlarmRequiresPanelCompatibility(null, "Addressable Smoke Detector"), true);
  assert.equal(fireAlarmRequiresPanelCompatibility(null, "Sounder/Strobe"), false);
  // dispatched the same way through the registry a system-agnostic caller (technical-requirement-engine.mjs) actually uses
  assert.equal(requiresPanelCompatibility("Fire Alarm", "Detection Devices", "Addressable Smoke Detector"), true);
  assert.equal(requiresPanelCompatibility("Fire Alarm", "Notification Devices", "Sounder/Strobe"), false);
  assert.equal(requiresPanelCompatibility("CCTV", "Detection Devices", "Addressable Smoke Detector"), false, "an unregistered/other system must never inherit Fire Alarm's opinion");
});

test("candidate-key schema and prompt remain compact and explicit", () => {
  const input = row("Addressable optical smoke detector with built-in isolator");
  const prompt = understanding.buildBoqUnderstandingPrompt(input);
  assert.ok("taxonomyCandidateKey" in understanding.BOQ_UNDERSTANDING_RESPONSE_SCHEMA.properties);
  assert.match(prompt.system, /exactly as supplied/i);
  assert.match(prompt.system, /never invent, alter, or paraphrase a key/i);
  assert.ok(JSON.stringify(understanding.BOQ_UNDERSTANDING_RESPONSE_SCHEMA).length < 2300);
  assert.ok(prompt.system.length + prompt.user.length < 3000);
});
